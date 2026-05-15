import * as audioContext from "./audioContext"
import {
  BandpassedNoiseGenerator,
  CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT,
  ClickTrainGenerator,
} from "./dotGridAudio"
import { getEQProcessor } from "./eqProcessor"
import { clamp } from "@/lib/utils/audioMath"

const MIN_AUDIBLE_FREQ = 20
const MAX_AUDIBLE_FREQ = 20000
const HEADROOM_GAIN = Math.pow(10, -6 / 20)
const MAINLINE_MASTER_GAIN = 6
const HIT_ATTACK_SECONDS = 0.01
const AUTO_RELEASE_MARGIN_SECONDS = 0.005
const DRY_REFERENCE_RELEASE_BOOST_SECONDS = 0.2

export interface EqPatternExperimentConfig {
  dotKey: string
  position: { normalizedX: number; normalizedY: number } | null
  rows: number
  cols: number
  intervalSeconds: number
  bandwidthOctaves: number
  volumePercent: number
  clickVolumePercent: number
}

export interface EqPatternExperimentVisualState {
  playingDotKey: string | null
  beatIndex: number
  beatInPattern: number
  eqHit: boolean
}

const DEFAULT_CONFIG: EqPatternExperimentConfig = {
  dotKey: "2,1",
  position: null,
  rows: 3,
  cols: 5,
  intervalSeconds: 0.09,
  bandwidthOctaves: 6,
  volumePercent: 100,
  clickVolumePercent: 1400,
}

function getBandpassCenterFrequency(normalizedY: number, bandwidthOctaves: number): number {
  const topUpperEdge = MAX_AUDIBLE_FREQ
  const topLowerEdge = topUpperEdge / Math.pow(2, bandwidthOctaves)
  const bottomLowerEdge = MIN_AUDIBLE_FREQ
  const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, normalizedY)
  const upperEdge = lowerEdge * Math.pow(2, bandwidthOctaves)
  return Math.sqrt(lowerEdge * upperEdge)
}

function getPan(normalizedX: number): number {
  return normalizedX * 2 - 1
}

function getNormalizedPosition(config: EqPatternExperimentConfig): { normalizedX: number; normalizedY: number } {
  if (config.position) {
    return {
      normalizedX: clamp(config.position.normalizedX, 0, 1),
      normalizedY: clamp(config.position.normalizedY, 0, 1),
    }
  }

  const { col, row } = parseDotKey(config.dotKey)
  return {
    normalizedX: config.cols <= 1 ? 0.5 : clamp(col / (config.cols - 1), 0, 1),
    normalizedY: config.rows <= 1 ? 0.5 : clamp(row / (config.rows - 1), 0, 1),
  }
}

function parseDotKey(dotKey: string): { col: number; row: number } {
  const [colRaw, rowRaw] = dotKey.split(",").map(Number)
  return {
    col: Number.isFinite(colRaw) ? colRaw : 0,
    row: Number.isFinite(rowRaw) ? rowRaw : 0,
  }
}

export class EqPatternExperimentAudio {
  private ctx: AudioContext | null = null
  private dryHeadroom: GainNode | null = null
  private config: EqPatternExperimentConfig = DEFAULT_CONFIG
  private playing = false
  private nextBeatIndex = 0
  private timeoutIds = new Set<number>()
  private activeHitCleanups = new Set<() => void>()
  private onVisualState?: (state: EqPatternExperimentVisualState) => void

  public setVisualStateListener(listener: ((state: EqPatternExperimentVisualState) => void) | undefined): void {
    this.onVisualState = listener
  }

  public configure(nextConfig: Partial<EqPatternExperimentConfig>): void {
    this.config = {
      ...this.config,
      ...nextConfig,
      position: nextConfig.position === undefined ? this.config.position : nextConfig.position,
      rows: Math.max(1, Math.round(nextConfig.rows ?? this.config.rows)),
      cols: Math.max(1, Math.round(nextConfig.cols ?? this.config.cols)),
      intervalSeconds: clamp(nextConfig.intervalSeconds ?? this.config.intervalSeconds, 0.025, 0.5),
      bandwidthOctaves: clamp(nextConfig.bandwidthOctaves ?? this.config.bandwidthOctaves, 0.25, 8.5),
      volumePercent: clamp(nextConfig.volumePercent ?? this.config.volumePercent, 0, 100),
      clickVolumePercent: clamp(nextConfig.clickVolumePercent ?? this.config.clickVolumePercent, 0, 2000),
    }

  }

  public async start(): Promise<void> {
    if (this.playing) return
    await audioContext.resumeAudioContext()
    this.ensureNodes()
    getEQProcessor().setEnabled(true)
    this.playing = true
    this.nextBeatIndex = 0
    this.scheduleNextHit(audioContext.getAudioContext().currentTime + 0.04)
  }

  public stop(): void {
    this.playing = false
    this.clearTimers()

    this.activeHitCleanups.forEach((cleanup) => cleanup())
    this.activeHitCleanups.clear()

    this.onVisualState?.({
      playingDotKey: null,
      beatIndex: 0,
      beatInPattern: 0,
      eqHit: false,
    })
  }

  public dispose(): void {
    this.stop()
    this.dryHeadroom?.disconnect()
    this.dryHeadroom = null
    this.ctx = null
  }

  private ensureNodes(): void {
    const ctx = audioContext.getAudioContext()
    this.ctx = ctx

    if (!this.dryHeadroom) {
      this.dryHeadroom = ctx.createGain()
      this.dryHeadroom.gain.value = HEADROOM_GAIN
      this.dryHeadroom.connect(ctx.destination)
    }
  }

  private clearTimers(): void {
    this.timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    this.timeoutIds.clear()
  }

  private setTimer(callback: () => void, delayMs: number): void {
    const timeoutId = window.setTimeout(() => {
      this.timeoutIds.delete(timeoutId)
      callback()
    }, Math.max(0, delayMs))
    this.timeoutIds.add(timeoutId)
  }

  private scheduleNextHit(hitTime: number): void {
    if (!this.playing) return

    const ctx = audioContext.getAudioContext()
    const interval = this.config.intervalSeconds
    const beatIndex = this.nextBeatIndex
    const beatInPattern = beatIndex % 8
    const eqHit = beatInPattern > 0

    this.nextBeatIndex += 1
    this.scheduleHit(hitTime, eqHit)
    this.scheduleVisual(hitTime, beatIndex, beatInPattern, eqHit)

    const nextHitTime = hitTime + interval
    this.setTimer(
      () => this.scheduleNextHit(nextHitTime),
      (nextHitTime - ctx.currentTime - 0.02) * 1000
    )
  }

  private scheduleVisual(hitTime: number, beatIndex: number, beatInPattern: number, eqHit: boolean): void {
    const ctx = audioContext.getAudioContext()
    this.setTimer(() => {
      if (!this.playing) return
      this.onVisualState?.({
        playingDotKey: this.config.dotKey,
        beatIndex,
        beatInPattern,
        eqHit,
      })
    }, (hitTime - ctx.currentTime) * 1000)
  }

  private scheduleHit(hitTime: number, eqHit: boolean): void {
    const ctx = audioContext.getAudioContext()
    this.ensureNodes()

    const { normalizedX, normalizedY } = getNormalizedPosition(this.config)
    const centerFrequency = getBandpassCenterFrequency(normalizedY, this.config.bandwidthOctaves)
    const pan = getPan(normalizedX)
    const attackSeconds = HIT_ATTACK_SECONDS
    const baseReleaseSeconds = Math.max(0.001, this.config.intervalSeconds - HIT_ATTACK_SECONDS - AUTO_RELEASE_MARGIN_SECONDS)
    const releaseSeconds = eqHit ? baseReleaseSeconds : baseReleaseSeconds + DRY_REFERENCE_RELEASE_BOOST_SECONDS
    const durationSeconds = attackSeconds + releaseSeconds + 0.025

    const clickTrainGenerator = new ClickTrainGenerator(ctx, this.config.clickVolumePercent / 100)
    const bandpassGenerator = new BandpassedNoiseGenerator(ctx)
    bandpassGenerator.setInputSlope(CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT)
    bandpassGenerator.setBandpassBandwidth(this.config.bandwidthOctaves)
    bandpassGenerator.setBandpassFrequency(centerFrequency)

    const mainGain = ctx.createGain()
    mainGain.gain.value = MAINLINE_MASTER_GAIN * (this.config.volumePercent / 100)

    const envelope = ctx.createGain()
    envelope.gain.value = 0
    const peakGain = 1
    envelope.gain.setValueAtTime(0, hitTime)
    envelope.gain.linearRampToValueAtTime(peakGain, hitTime + attackSeconds)
    envelope.gain.linearRampToValueAtTime(0, hitTime + attackSeconds + releaseSeconds)

    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(pan, -1, 1)

    clickTrainGenerator.getOutputNode().connect(bandpassGenerator.getInputNode())
    bandpassGenerator.getOutputNode().connect(mainGain)
    mainGain.connect(envelope)
    envelope.connect(panner)
    panner.connect(eqHit ? getEQProcessor().getInputNode() : this.dryHeadroom!)

    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      clickTrainGenerator.dispose()
      bandpassGenerator.dispose()
      mainGain.disconnect()
      envelope.disconnect()
      panner.disconnect()
      this.activeHitCleanups.delete(cleanup)
    }

    this.activeHitCleanups.add(cleanup)
    this.setTimer(cleanup, (hitTime + durationSeconds - ctx.currentTime) * 1000)
  }
}
