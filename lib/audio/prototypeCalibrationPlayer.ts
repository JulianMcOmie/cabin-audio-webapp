import { getAudioContext, resumeAudioContext } from "./audioContext"
import { dbToGain, clamp } from "../utils/audioMath"

export type PrototypePositionId = "FL" | "FC" | "FR" | "BL" | "BC" | "BR"

export interface PrototypePosition {
  id: PrototypePositionId
  pan: number
  y: number
  depthGain: number
}

export interface PrototypeEqCandidate {
  frequency: number
  gainDb: number
  q: number
}

export type PrototypeTask =
  | {
      kind: "pair"
      pair: [PrototypePositionId, PrototypePositionId]
      correctedIndex: 0 | 1
    }
  | {
      kind: "edge"
      edges: [[PrototypePositionId, PrototypePositionId], [PrototypePositionId, PrototypePositionId]]
      correctedEdgeIndex: 0 | 1
    }

export interface PrototypePlayerSettings {
  task: PrototypeTask
  eq: PrototypeEqCandidate
  eqEnabled: boolean
  intervalMs: number
  restMs: number
  volumeDb: number
}

const POSITIONS: Record<PrototypePositionId, PrototypePosition> = {
  FL: { id: "FL", pan: -0.78, y: 0.5, depthGain: 1 },
  FC: { id: "FC", pan: 0, y: 0.5, depthGain: 1 },
  FR: { id: "FR", pan: 0.78, y: 0.5, depthGain: 1 },
  BL: { id: "BL", pan: -0.78, y: 0.5, depthGain: 0.55 },
  BC: { id: "BC", pan: 0, y: 0.5, depthGain: 0.55 },
  BR: { id: "BR", pan: 0.78, y: 0.5, depthGain: 0.55 },
}

const NOISE_BUFFER_SECONDS = 2
const MASTER_GAIN_SCALAR = 0.22
const BURST_ATTACK_S = 0.008
const BURST_HOLD_S = 0.12
const BURST_RELEASE_S = 0.055
const SCHEDULER_INTERVAL_MS = 50
const LOOKAHEAD_S = 0.16
const MIN_FREQ = 20
const MAX_FREQ = 20000
const POSITION_BANDWIDTH_OCTAVES = 6
const BANDPASS_Q = 0.7

type PatternEvent = {
  position: PrototypePositionId | null
  corrected: boolean
  durationMs: number
}

function generatePinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)

  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0

  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    b6 = white * 0.5362
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11
  }

  let peak = 1e-6
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]))
  const scale = 0.85 / peak
  for (let i = 0; i < length; i += 1) data[i] *= scale

  return buffer
}

function yToFreqEdges(y: number): { low: number; high: number } {
  const bottomLowerEdge = MIN_FREQ
  const topUpperEdge = MAX_FREQ
  const topLowerEdge = topUpperEdge / Math.pow(2, POSITION_BANDWIDTH_OCTAVES)
  const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, clamp(y, 0, 1))
  const upperEdge = lowerEdge * Math.pow(2, POSITION_BANDWIDTH_OCTAVES)

  return {
    low: clamp(lowerEdge, MIN_FREQ, MAX_FREQ),
    high: clamp(upperEdge, MIN_FREQ, MAX_FREQ),
  }
}

function sanitizeSettings(settings: PrototypePlayerSettings): PrototypePlayerSettings {
  return {
    ...settings,
    eq: {
      frequency: clamp(settings.eq.frequency, MIN_FREQ, MAX_FREQ),
      gainDb: clamp(settings.eq.gainDb, -15, 9),
      q: clamp(settings.eq.q, 0.25, 12),
    },
    intervalMs: clamp(settings.intervalMs, 120, 1400),
    restMs: clamp(settings.restMs, 120, 2400),
    volumeDb: clamp(settings.volumeDb, -50, 0),
  }
}

function buildPattern(settings: PrototypePlayerSettings): PatternEvent[] {
  const intervalMs = settings.intervalMs
  const restMs = settings.restMs

  if (settings.task.kind === "pair") {
    const [a, b] = settings.task.pair
    return [
      { position: a, corrected: settings.task.correctedIndex === 0, durationMs: intervalMs },
      { position: b, corrected: settings.task.correctedIndex === 1, durationMs: restMs },
    ]
  }

  const firstCorrected = settings.task.correctedEdgeIndex === 0
  const secondCorrected = settings.task.correctedEdgeIndex === 1
  const [edgeA, edgeB] = settings.task.edges

  return [
    { position: edgeA[0], corrected: firstCorrected, durationMs: intervalMs },
    { position: edgeA[1], corrected: firstCorrected, durationMs: intervalMs },
    { position: edgeA[0], corrected: firstCorrected, durationMs: intervalMs },
    { position: edgeA[1], corrected: firstCorrected, durationMs: restMs },
    { position: edgeB[0], corrected: secondCorrected, durationMs: intervalMs },
    { position: edgeB[1], corrected: secondCorrected, durationMs: intervalMs },
    { position: edgeB[0], corrected: secondCorrected, durationMs: intervalMs },
    { position: edgeB[1], corrected: secondCorrected, durationMs: restMs },
  ]
}

export class PrototypeCalibrationPlayer {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private schedulerTimer: number | null = null
  private nextEventTime = 0
  private eventIndex = 0
  private pattern: PatternEvent[] = []
  private _isPlaying = false

  private settings: PrototypePlayerSettings

  constructor(initialSettings: PrototypePlayerSettings) {
    this.settings = sanitizeSettings(initialSettings)
    this.pattern = buildPattern(this.settings)
  }

  async start(): Promise<void> {
    if (this._isPlaying) return

    const ctx = getAudioContext()
    await resumeAudioContext()
    this.ctx = ctx
    this.noiseBuffer = generatePinkNoiseBuffer(ctx)
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = dbToGain(this.settings.volumeDb) * MASTER_GAIN_SCALAR
    this.masterGain.connect(ctx.destination)

    this.nextEventTime = ctx.currentTime + 0.04
    this.eventIndex = 0
    this._isPlaying = true
    this.schedule()
    this.schedulerTimer = window.setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS)
  }

  stop(): void {
    if (!this._isPlaying) return
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
    this.masterGain?.disconnect()
    this.masterGain = null
    this.noiseBuffer = null
    this.ctx = null
    this._isPlaying = false
  }

  dispose(): void {
    this.stop()
  }

  setSettings(partial: Partial<PrototypePlayerSettings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...partial })
    this.pattern = buildPattern(this.settings)

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        dbToGain(this.settings.volumeDb) * MASTER_GAIN_SCALAR,
        this.ctx.currentTime,
        0.01
      )
    }
  }

  get isPlaying(): boolean {
    return this._isPlaying
  }

  private schedule(): void {
    if (!this.ctx || !this._isPlaying) return

    const horizon = this.ctx.currentTime + LOOKAHEAD_S
    while (this.nextEventTime < horizon) {
      const event = this.pattern[this.eventIndex % this.pattern.length]
      if (event.position) this.fireBurst(event.position, event.corrected, this.nextEventTime)
      this.nextEventTime += event.durationMs / 1000
      this.eventIndex += 1
    }
  }

  private fireBurst(positionId: PrototypePositionId, corrected: boolean, when: number): void {
    const ctx = this.ctx
    if (!ctx || !this.noiseBuffer || !this.masterGain) return

    const position = POSITIONS[positionId]
    const source = ctx.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true

    const { low, high } = yToFreqEdges(position.y)
    const hpf = ctx.createBiquadFilter()
    hpf.type = "highpass"
    hpf.frequency.value = low
    hpf.Q.value = BANDPASS_Q

    const lpf = ctx.createBiquadFilter()
    lpf.type = "lowpass"
    lpf.frequency.value = high
    lpf.Q.value = BANDPASS_Q

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, when)
    envelope.gain.linearRampToValueAtTime(1, when + BURST_ATTACK_S)
    envelope.gain.setValueAtTime(1, when + BURST_ATTACK_S + BURST_HOLD_S)
    envelope.gain.linearRampToValueAtTime(0, when + BURST_ATTACK_S + BURST_HOLD_S + BURST_RELEASE_S)

    const positionGain = ctx.createGain()
    positionGain.gain.value = position.depthGain

    const panner = ctx.createStereoPanner()
    panner.pan.value = position.pan

    source.connect(hpf)
    hpf.connect(lpf)

    let cleanupNodes: AudioNode[] = [hpf, lpf, envelope]
    if (corrected && this.settings.eqEnabled) {
      const eq = ctx.createBiquadFilter()
      eq.type = "peaking"
      eq.frequency.value = this.settings.eq.frequency
      eq.Q.value = this.settings.eq.q
      eq.gain.value = this.settings.eq.gainDb
      lpf.connect(eq)
      eq.connect(envelope)
      cleanupNodes = [hpf, lpf, eq, envelope]
    } else {
      lpf.connect(envelope)
    }

    envelope.connect(positionGain)
    positionGain.connect(panner)
    panner.connect(this.masterGain)
    cleanupNodes.push(positionGain, panner)

    const startOffset = Math.random() * NOISE_BUFFER_SECONDS
    const stopTime = when + BURST_ATTACK_S + BURST_HOLD_S + BURST_RELEASE_S + 0.02
    source.start(when, startOffset)
    source.stop(stopTime)

    source.onended = () => {
      source.disconnect()
      for (const node of cleanupNodes) node.disconnect()
    }
  }
}

export function getPrototypePosition(positionId: PrototypePositionId): PrototypePosition {
  return POSITIONS[positionId]
}
