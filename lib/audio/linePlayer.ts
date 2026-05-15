/**
 * LinePlayer — fires rapid click-train hits that walk back and forth along a
 * polyline on a 2-D soundstage.
 *
 * GridPlayer — plays continuous noise dots arranged in flexible grids,
 * each bandpass-filtered and panned to match the main dot grid audio.
 */

import {
  BandpassedNoiseGenerator,
  CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT,
  ClickTrainGenerator,
  SlopedPinkNoiseGenerator,
} from "./dotGridAudio"

const MASTER_GAIN = 0.55
const NOISE_BUFFER_SECONDS = 2
const DEFAULT_STEP_INTERVAL_MS = 60
const DEFAULT_STEPS = 32
const DEFAULT_HIT_RELEASE_S = 2
const DEFAULT_DEPTH = 1
const DEPTH_DB_PER_LAYER = 10
const LINE_3D_DEPTH_ATTENUATION_DB = 24
const LINE_3D_CLICK_GAIN_MULTIPLIER = 4
const DEFAULT_LINE_3D_RATE_HZ = 1
const DEFAULT_LINE_3D_HIT_INTERVAL_MS = 15
const DEFAULT_LINE_3D_HIT_RELEASE_S = 0.07
const MASTER_GAIN_OSC_INTERVAL_MS = 16
const MIN_POINT_GAIN_DB = -60
const MAX_POINT_GAIN_DB = 24
const MIN_FREQ = 20
const MAX_FREQ = 20000
const DEFAULT_BANDWIDTH_OCTAVES = 6.0
const HIT_ATTACK_S = 0.01
const SCHEDULER_INTERVAL_MS = 50
const LOOKAHEAD_S = 0.15
const DEFAULT_GRID_SIZE: GridSize = { rows: 2, cols: 1 }
const CHECKERBOARD_SWAP_S = 5

// Matching the normal dot grid audio's filter approach
const DEFAULT_BANDPASS_NOISE_SLOPE_DB_PER_OCT = -4.5
const BANDPASS_NOISE_OUTPUT_GAIN = 0.25

export interface LinePoint {
  /** 0 = left edge, 1 = right edge */
  x: number
  /** 0 = bottom, 1 = top */
  y: number
  /** 0 = near/full level, 1 = deeper/quieter. */
  depth?: number
  /** Per-node gain multiplier (0..1). Defaults to 1. */
  gain?: number
  /** Per-node gain trim in dB. Used by 3D line endpoints. Defaults to 0 dB. */
  gainDb?: number
}

export type GridSize = { rows: number; cols: number }
export type GridReadingOrder = "rows" | "columns"

function createAudioContext(): AudioContext {
  return new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/** Q calculation matching the normal dot grid audio's sharper filters. */
function calculateBandpassQ(bandwidthOctaves: number): number {
  const numerator = Math.sqrt(2)
  const denominator = Math.pow(2, bandwidthOctaves / 2) - Math.pow(2, -bandwidthOctaves / 2)
  const baseQ = numerator / denominator
  return clamp(baseQ * 15, 0.7, 100)
}

/** Frequency edge mapping matching the normal dot grid audio. */
function yToFreqEdges(y: number, bandwidthOctaves: number): { low: number; high: number; center: number } {
  const bottomLowerEdge = MIN_FREQ
  const topUpperEdge = MAX_FREQ
  const topLowerEdge = topUpperEdge / Math.pow(2, bandwidthOctaves)

  const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, y)
  const upperEdge = lowerEdge * Math.pow(2, bandwidthOctaves)
  const center = Math.sqrt(lowerEdge * upperEdge)

  return {
    low: clamp(lowerEdge, MIN_FREQ, MAX_FREQ),
    high: clamp(upperEdge, MIN_FREQ, MAX_FREQ),
    center,
  }
}

/** Equal-loudness compensation matching the normal dot grid audio. */
function loudnessCompensationDb(centerFreq: number): number {
  const compensationFreq = clamp(centerFreq, 20, 20000)
  if (compensationFreq < 1000) {
    return Math.log2(1000 / compensationFreq) * 3
  } else if (compensationFreq > 4000) {
    return Math.log2(compensationFreq / 4000) * 2
  }
  return 0
}

function depthLayerGain(depth: number, layer: number): number {
  if (depth <= 1) return 1
  const hitDecayDb = (depth - 1) * DEPTH_DB_PER_LAYER
  const layerDb = -hitDecayDb * (1 - layer / (depth - 1))
  return dbToGain(layerDb)
}

function pointGainToAudioGain(pointGain: number): number {
  const normalized = clamp(pointGain, 0, 1)
  if (normalized <= 0) return 0
  return dbToGain((normalized - 1) * 48)
}

function pointGainDbToAudioGain(gainDb: number): number {
  const clamped = clamp(gainDb, MIN_POINT_GAIN_DB, MAX_POINT_GAIN_DB)
  if (clamped <= MIN_POINT_GAIN_DB) return 0
  return dbToGain(clamped)
}

function pointGainDb(point: LinePoint): number {
  if (point.gainDb !== undefined) return clamp(point.gainDb, MIN_POINT_GAIN_DB, MAX_POINT_GAIN_DB)
  const legacyGain = point.gain ?? 1
  if (legacyGain <= 0) return MIN_POINT_GAIN_DB
  return clamp((clamp(legacyGain, 0, 1) - 1) * 48, MIN_POINT_GAIN_DB, 0)
}

function normalizeLinePoint(point: LinePoint): LinePoint {
  return {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
    depth: point.depth === undefined ? undefined : clamp(point.depth, 0, 1),
    gain: point.gain === undefined ? undefined : clamp(point.gain, 0, 1),
    gainDb: point.gainDb === undefined ? undefined : clamp(point.gainDb, MIN_POINT_GAIN_DB, MAX_POINT_GAIN_DB),
  }
}

function generatePinkNoiseBuffer(ctx: AudioContext | OfflineAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
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
  const scale = 0.9 / peak
  for (let i = 0; i < length; i += 1) data[i] *= scale

  return buffer
}

/**
 * Pre-render a noise buffer shaped to the target dB/oct slope using the canonical
 * SlopedPinkNoiseGenerator from dotGridAudio.
 */
async function generateSlopedNoiseBuffer(
  sampleRate: number,
  targetSlopeDbPerOct = DEFAULT_BANDPASS_NOISE_SLOPE_DB_PER_OCT,
): Promise<AudioBuffer> {
  const length = Math.floor(sampleRate * NOISE_BUFFER_SECONDS)
  const offline = new OfflineAudioContext(1, length, sampleRate)

  const pinkBuf = generatePinkNoiseBuffer(offline)
  const source = offline.createBufferSource()
  source.buffer = pinkBuf

  const generator = new SlopedPinkNoiseGenerator(offline)
  generator.setSlope(targetSlopeDbPerOct)

  source.connect(generator.getInputNode())
  generator.getOutputNode().connect(offline.destination)
  source.start(0)

  const rendered = await offline.startRendering()
  const data = rendered.getChannelData(0)
  let peak = 1e-6
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]))
  const scale = 0.9 / peak
  for (let i = 0; i < length; i++) data[i] *= scale
  return rendered
}

// ═══════════════════════════════════════════════════════════════════════════
// LinePlayer — burst sweep along polyline
// ═══════════════════════════════════════════════════════════════════════════

export class LinePlayer {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private clickTrain: ClickTrainGenerator | null = null
  private bandpass: BandpassedNoiseGenerator | null = null
  private panner: StereoPannerNode | null = null

  private playing = false
  private schedulerId: number | null = null
  private points: LinePoint[] = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]
  private segmentCumulativeT: number[] = [0, 1]
  private steps = DEFAULT_STEPS
  private currentStep = 0
  private direction: 1 | -1 = 1
  private stepIntervalMs = DEFAULT_STEP_INTERVAL_MS
  private bandwidthOctaves = DEFAULT_BANDWIDTH_OCTAVES
  private hitReleaseS = DEFAULT_HIT_RELEASE_S
  private depth = DEFAULT_DEPTH
  private nextBurstTime = 0
  private scheduledHitIndex = 0
  private _volume = 1
  private masterGainDb = 0
  private masterGainOscAmountDb = 0
  private masterGainOscRateHz = 1
  private masterGainOscStartTime = 0
  private masterGainOscTimerId: number | null = null
  private slopeDbPerOct = DEFAULT_BANDPASS_NOISE_SLOPE_DB_PER_OCT
  private activeHits = new Set<{ gainNode: GainNode; envelope: GainNode }>()

  constructor(private sharedContext?: AudioContext, private sharedDestination?: AudioNode) {}

  setLine(start: LinePoint, end: LinePoint) {
    this.setPoints([start, end])
  }

  setPoints(pts: LinePoint[]) {
    if (pts.length < 2) return
    this.points = pts
    this.recomputeSegments()
  }

  private recomputeSegments() {
    const pts = this.points
    if (pts.length < 2) return

    const cumDist: number[] = [0]
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x
      const dy = pts[i].y - pts[i - 1].y
      cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy))
    }
    const total = cumDist[cumDist.length - 1]
    this.segmentCumulativeT = total > 0
      ? cumDist.map(d => d / total)
      : cumDist.map((_, i) => i / (pts.length - 1))
  }

  private interpolatePolyline(t: number): LinePoint {
    const cum = this.segmentCumulativeT
    const pts = this.points
    if (t <= 0) return { ...pts[0], gain: pts[0].gain ?? 1 }
    if (t >= 1) return { ...pts[pts.length - 1], gain: pts[pts.length - 1].gain ?? 1 }

    for (let i = 1; i < cum.length; i++) {
      if (t <= cum[i]) {
        const segLen = cum[i] - cum[i - 1]
        const localT = segLen > 0 ? (t - cum[i - 1]) / segLen : 0
        const g0 = pts[i - 1].gain ?? 1
        const g1 = pts[i].gain ?? 1
        return {
          x: pts[i - 1].x + localT * (pts[i].x - pts[i - 1].x),
          y: pts[i - 1].y + localT * (pts[i].y - pts[i - 1].y),
          gain: g0 + localT * (g1 - g0),
        }
      }
    }
    return { ...pts[pts.length - 1], gain: pts[pts.length - 1].gain ?? 1 }
  }

  setStepInterval(ms: number) { this.stepIntervalMs = Math.max(10, ms) }
  setSteps(steps: number) {
    this.steps = Math.max(2, steps)
    if (this.currentStep >= this.steps) {
      this.currentStep = this.steps - 1
      this.direction = -1
    }
  }
  setBandwidth(octaves: number) {
    this.bandwidthOctaves = clamp(octaves, 0.5, 10)
    this.bandpass?.setBandpassBandwidth(this.bandwidthOctaves)
  }
  setHitRelease(seconds: number) { this.hitReleaseS = clamp(seconds, 0.05, 3) }
  setDepth(depth: number) { this.depth = Math.max(1, Math.min(4, Math.round(depth))) }
  setVolume(vol: number) {
    const v = clamp(vol, 0, 1)
    this._volume = v
    this.updateMasterGain()
  }
  getVolume(): number { return this._volume }

  setMasterGainDb(db: number) {
    this.masterGainDb = clamp(db, -60, 24)
    this.updateMasterGain()
  }

  setMasterGainOscillationAmountDb(db: number) {
    this.masterGainOscAmountDb = clamp(db, 0, 48)
    this.syncMasterGainOscillation()
    this.updateMasterGain()
  }

  setMasterGainOscillationRateHz(rateHz: number) {
    this.masterGainOscRateHz = clamp(rateHz, 0.01, 20)
    this.masterGainOscStartTime = this.getClockTime()
    this.syncMasterGainOscillation()
    this.updateMasterGain()
  }

  async setSlope(dbPerOct: number) {
    if (dbPerOct === this.slopeDbPerOct) return
    this.slopeDbPerOct = dbPerOct
    this.bandpass?.setBandpassSlope(this.slopeDbPerOct)
  }

  async start() {
    await this.ensureGraph()
    const ctx = this.sharedContext ?? this.context
    if (!ctx) return
    if (!this.sharedContext) await ctx.resume()

    this.playing = true
    this.currentStep = 0
    this.direction = 1
    this.scheduledHitIndex = 0
    this.nextBurstTime = ctx.currentTime + 0.02
    this.scheduleBursts()
    this.schedulerId = window.setInterval(() => this.scheduleBursts(), SCHEDULER_INTERVAL_MS)
  }

  async stop() {
    this.playing = false
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }
    this.clearActiveHits()
    if (!this.sharedContext && this.context?.state === "running") {
      await this.context.suspend()
    }
  }

  async destroy() {
    await this.stop()
    this.teardownGraph()
    if (!this.sharedContext && this.context) {
      const ctx = this.context
      this.context = null
      await ctx.close()
    } else {
      this.context = null
    }
  }

  isPlaying(): boolean { return this.playing }

  getCurrentNormalizedStep(): number {
    if (this.steps <= 1) return 0
    return this.currentStep / (this.steps - 1)
  }

  private async ensureGraph() {
    const ctx = this.sharedContext ?? this.context
    if (ctx && this.masterGain && this.clickTrain && this.bandpass && this.panner) return

    const audioCtx = this.sharedContext ?? createAudioContext()
    if (!this.sharedContext) this.context = audioCtx

    this.masterGain = audioCtx.createGain()
    this.masterGainOscStartTime = audioCtx.currentTime
    this.updateMasterGain()
    this.masterGain.connect(this.sharedDestination ?? audioCtx.destination)
    this.syncMasterGainOscillation()

    this.clickTrain = new ClickTrainGenerator(audioCtx, LINE_3D_CLICK_GAIN_MULTIPLIER)
    this.bandpass = new BandpassedNoiseGenerator(audioCtx)
    this.bandpass.setInputSlope(CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT)
    this.bandpass.setBandpassSlope(this.slopeDbPerOct)
    this.bandpass.setBandpassBandwidth(this.bandwidthOctaves)

    this.panner = audioCtx.createStereoPanner()
    this.clickTrain.getOutputNode().connect(this.bandpass.getInputNode())
    this.panner.connect(this.masterGain)
  }

  private teardownGraph() {
    this.clickTrain?.dispose()
    this.bandpass?.dispose()
    this.panner?.disconnect()
    this.masterGain?.disconnect()
    this.clickTrain = null
    this.bandpass = null
    this.panner = null
    this.masterGain = null
    this.stopMasterGainOscillation()
  }

  private updateMasterGain() {
    if (this.masterGain) {
      const oscDb = this.masterGainOscAmountDb <= 0
        ? 0
        : Math.sin((this.getClockTime() - this.masterGainOscStartTime) * Math.PI * 2 * this.masterGainOscRateHz) * this.masterGainOscAmountDb
      this.masterGain.gain.value = this._volume * MASTER_GAIN * dbToGain(this.masterGainDb + oscDb)
    }
  }

  private getClockTime(): number {
    return (this.sharedContext ?? this.context)?.currentTime ?? 0
  }

  private syncMasterGainOscillation() {
    if (!this.masterGain || this.masterGainOscAmountDb <= 0) {
      this.stopMasterGainOscillation()
      return
    }
    if (this.masterGainOscTimerId !== null) return
    this.masterGainOscStartTime = this.getClockTime()
    this.masterGainOscTimerId = window.setInterval(() => this.updateMasterGain(), MASTER_GAIN_OSC_INTERVAL_MS)
  }

  private stopMasterGainOscillation() {
    if (this.masterGainOscTimerId !== null) {
      window.clearInterval(this.masterGainOscTimerId)
      this.masterGainOscTimerId = null
    }
  }

  private clearActiveHits() {
    for (const hit of this.activeHits) {
      try {
        hit.gainNode.disconnect()
        hit.envelope.disconnect()
      } catch {
        // Hit cleanup can race with its timeout during stop/restart.
      }
    }
    this.activeHits.clear()
  }

  private scheduleBursts() {
    const ctx = this.sharedContext ?? this.context
    if (!ctx || !this.playing) return

    const horizon = ctx.currentTime + LOOKAHEAD_S
    const stepIntervalS = this.stepIntervalMs / 1000

    while (this.nextBurstTime < horizon) {
      this.fireBurst(this.nextBurstTime)
      this.scheduledHitIndex += 1
      this.currentStep += this.direction
      if (this.currentStep >= this.steps - 1) {
        this.currentStep = this.steps - 1
        this.direction = -1
      } else if (this.currentStep <= 0) {
        this.currentStep = 0
        this.direction = 1
      }
      this.nextBurstTime += stepIntervalS
    }
  }

  private fireBurst(when: number) {
    const ctx = this.sharedContext ?? this.context
    if (!ctx || !this.bandpass || !this.panner) return

    const t = this.steps <= 1 ? 0 : this.currentStep / (this.steps - 1)
    const pos = this.interpolatePolyline(t)
    const nodeGain = pointGainToAudioGain(pos.gain ?? 1)

    const { center } = yToFreqEdges(pos.y, this.bandwidthOctaves)
    const compensationDb = loudnessCompensationDb(center)
    const totalGainDb = compensationDb
    const volumeLayer = Math.floor(this.scheduledHitIndex / this.steps) % this.depth
    const layerGain = depthLayerGain(this.depth, volumeLayer)

    const hitDurationS = HIT_ATTACK_S + this.hitReleaseS
    this.bandpass.scheduleBandpassFrequencyAndBandwidth(center, this.bandwidthOctaves, when)
    this.panner.pan.setValueAtTime(pos.x * 2 - 1, when)

    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(dbToGain(totalGainDb) * nodeGain * layerGain, when)

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, when)
    envelope.gain.linearRampToValueAtTime(1, when + HIT_ATTACK_S)
    envelope.gain.linearRampToValueAtTime(0, when + hitDurationS)

    this.bandpass.getOutputNode().connect(gainNode)
    gainNode.connect(envelope)
    envelope.connect(this.panner)

    const activeHit = { gainNode, envelope }
    this.activeHits.add(activeHit)

    const cleanupDelayMs = Math.max(0, (when + hitDurationS + 0.05 - ctx.currentTime) * 1000)
    window.setTimeout(() => {
      try {
        gainNode.disconnect()
        envelope.disconnect()
      } catch {
        // Hit may already have been cleared by stop/restart.
      }
      this.activeHits.delete(activeHit)
    }, cleanupDelayMs)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Line3DClickTrainPlayer — continuous click train moving between two points
// ═══════════════════════════════════════════════════════════════════════════

export class Line3DClickTrainPlayer {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private clickTrain: ClickTrainGenerator | null = null
  private bandpass: BandpassedNoiseGenerator | null = null
  private panner: StereoPannerNode | null = null

  private playing = false
  private schedulerId: number | null = null
  private points: [LinePoint, LinePoint] = [
    { x: 0.25, y: 0.45, depth: 0, gainDb: 0 },
    { x: 0.75, y: 0.55, depth: 0.65, gainDb: 0 },
  ]
  private travelRateHz = DEFAULT_LINE_3D_RATE_HZ
  private hitIntervalMs = DEFAULT_LINE_3D_HIT_INTERVAL_MS
  private hitReleaseS = DEFAULT_LINE_3D_HIT_RELEASE_S
  private bandwidthOctaves = DEFAULT_BANDWIDTH_OCTAVES
  private slopeDbPerOct = DEFAULT_BANDPASS_NOISE_SLOPE_DB_PER_OCT
  private startTime = 0
  private nextHitTime = 0
  private scheduledHitIndex = 0
  private currentT = 0
  private _volume = 1
  private masterGainDb = 0
  private masterGainOscAmountDb = 0
  private masterGainOscRateHz = 1
  private masterGainOscStartTime = 0
  private masterGainOscTimerId: number | null = null
  private activeHits = new Set<{ gainNode: GainNode; envelope: GainNode }>()

  constructor(private sharedContext?: AudioContext, private sharedDestination?: AudioNode) {}

  setPoints(points: LinePoint[], options?: { clearActiveHits?: boolean }) {
    if (points.length < 2) return
    this.points = [normalizeLinePoint(points[0]), normalizeLinePoint(points[1])]
    if (options?.clearActiveHits) this.clearActiveHits()
  }

  setTravelRate(rateHz: number) {
    this.travelRateHz = clamp(rateHz, 0.05, 20)
  }

  setHitInterval(ms: number) {
    this.hitIntervalMs = Math.max(5, ms)
  }

  setHitRelease(seconds: number) {
    this.hitReleaseS = clamp(seconds, 0.005, 3)
  }

  setBandwidth(octaves: number) {
    this.bandwidthOctaves = clamp(octaves, 0.5, 10)
    this.bandpass?.setBandpassBandwidth(this.bandwidthOctaves)
  }

  setVolume(vol: number) {
    const v = clamp(vol, 0, 1)
    this._volume = v
    this.updateMasterGain()
  }

  getVolume(): number { return this._volume }

  setMasterGainDb(db: number) {
    this.masterGainDb = clamp(db, -60, 24)
    this.updateMasterGain()
  }

  setMasterGainOscillationAmountDb(db: number) {
    this.masterGainOscAmountDb = clamp(db, 0, 48)
    this.syncMasterGainOscillation()
    this.updateMasterGain()
  }

  setMasterGainOscillationRateHz(rateHz: number) {
    this.masterGainOscRateHz = clamp(rateHz, 0.01, 20)
    this.masterGainOscStartTime = this.getClockTime()
    this.syncMasterGainOscillation()
    this.updateMasterGain()
  }

  setSlope(dbPerOct: number) {
    if (dbPerOct === this.slopeDbPerOct) return
    this.slopeDbPerOct = dbPerOct
    this.bandpass?.setBandpassSlope(this.slopeDbPerOct)
  }

  async start() {
    if (this.playing) await this.stop()
    await this.ensureGraph()
    const ctx = this.sharedContext ?? this.context
    if (!ctx) return
    if (!this.sharedContext) await ctx.resume()

    this.playing = true
    this.startTime = ctx.currentTime
    this.nextHitTime = ctx.currentTime + 0.02
    this.scheduledHitIndex = 0
    this.currentT = 0
    this.scheduleHits()
    this.schedulerId = window.setInterval(() => this.scheduleHits(), SCHEDULER_INTERVAL_MS)
  }

  async stop() {
    this.playing = false
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }
    this.clearActiveHits()
    this.teardownGraph()
    if (!this.sharedContext && this.context?.state === "running") {
      await this.context.suspend()
    }
  }

  async destroy() {
    await this.stop()
    if (!this.sharedContext && this.context) {
      const ctx = this.context
      this.context = null
      await ctx.close()
    } else {
      this.context = null
    }
  }

  isPlaying(): boolean { return this.playing }

  getCurrentT(): number {
    const ctx = this.sharedContext ?? this.context
    if (!this.playing || !ctx) return this.currentT
    return this.computeT(ctx.currentTime)
  }

  private async ensureGraph() {
    const ctx = this.sharedContext ?? this.context
    if (ctx && this.masterGain && this.clickTrain && this.bandpass && this.panner) return

    const audioCtx = this.sharedContext ?? createAudioContext()
    if (!this.sharedContext) this.context = audioCtx

    this.masterGain = audioCtx.createGain()
    this.masterGainOscStartTime = audioCtx.currentTime
    this.updateMasterGain()
    this.masterGain.connect(this.sharedDestination ?? audioCtx.destination)
    this.syncMasterGainOscillation()

    this.clickTrain = new ClickTrainGenerator(audioCtx, LINE_3D_CLICK_GAIN_MULTIPLIER)
    this.bandpass = new BandpassedNoiseGenerator(audioCtx)
    this.bandpass.setInputSlope(CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT)
    this.bandpass.setBandpassSlope(this.slopeDbPerOct)
    this.bandpass.setBandpassBandwidth(this.bandwidthOctaves)

    this.panner = audioCtx.createStereoPanner()

    this.clickTrain.getOutputNode().connect(this.bandpass.getInputNode())
    this.panner.connect(this.masterGain)
  }

  private teardownGraph() {
    this.clickTrain?.dispose()
    this.bandpass?.dispose()
    this.panner?.disconnect()
    this.masterGain?.disconnect()
    this.clickTrain = null
    this.bandpass = null
    this.panner = null
    this.masterGain = null
    this.stopMasterGainOscillation()
  }

  private updateMasterGain() {
    if (this.masterGain) {
      const oscDb = this.masterGainOscAmountDb <= 0
        ? 0
        : Math.sin((this.getClockTime() - this.masterGainOscStartTime) * Math.PI * 2 * this.masterGainOscRateHz) * this.masterGainOscAmountDb
      this.masterGain.gain.value = this._volume * MASTER_GAIN * dbToGain(this.masterGainDb + oscDb)
    }
  }

  private getClockTime(): number {
    return (this.sharedContext ?? this.context)?.currentTime ?? 0
  }

  private syncMasterGainOscillation() {
    if (!this.masterGain || this.masterGainOscAmountDb <= 0) {
      this.stopMasterGainOscillation()
      return
    }
    if (this.masterGainOscTimerId !== null) return
    this.masterGainOscStartTime = this.getClockTime()
    this.masterGainOscTimerId = window.setInterval(() => this.updateMasterGain(), MASTER_GAIN_OSC_INTERVAL_MS)
  }

  private stopMasterGainOscillation() {
    if (this.masterGainOscTimerId !== null) {
      window.clearInterval(this.masterGainOscTimerId)
      this.masterGainOscTimerId = null
    }
  }

  private clearActiveHits() {
    for (const hit of this.activeHits) {
      try {
        hit.gainNode.disconnect()
        hit.envelope.disconnect()
      } catch {
        // Hit cleanup can race with its timeout during stop/restart.
      }
    }
    this.activeHits.clear()
  }

  private computeT(time: number): number {
    const elapsed = Math.max(0, time - this.startTime)
    const travel = elapsed * this.travelRateHz
    const passIndex = Math.floor(travel)
    const passT = travel - passIndex
    return passIndex % 2 === 0 ? passT : 1 - passT
  }

  private interpolate(t: number): LinePoint {
    const [a, b] = this.points
    const depthA = a.depth ?? 0
    const depthB = b.depth ?? 0
    return {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
      depth: depthA + t * (depthB - depthA),
      gainDb: pointGainDb(a) + t * (pointGainDb(b) - pointGainDb(a)),
    }
  }

  private interpolateEndpointAudioGain(t: number): number {
    const [a, b] = this.points
    const gainA = pointGainDbToAudioGain(pointGainDb(a))
    const gainB = pointGainDbToAudioGain(pointGainDb(b))
    const mix = clamp((t - 0.35) / 0.3, 0, 1)
    const smoothMix = mix * mix * (3 - 2 * mix)
    return gainA * (1 - smoothMix) + gainB * smoothMix
  }

  private scheduleHits() {
    const ctx = this.sharedContext ?? this.context
    if (!ctx || !this.playing || !this.bandpass || !this.panner) return

    const horizon = ctx.currentTime + LOOKAHEAD_S
    const hitIntervalS = this.hitIntervalMs / 1000

    while (this.nextHitTime < horizon) {
      this.scheduleClickHit(this.nextHitTime)
      this.nextHitTime += hitIntervalS
      this.scheduledHitIndex += 1
    }
  }

  private scheduleClickHit(when: number) {
    const ctx = this.sharedContext ?? this.context
    if (!ctx || !this.bandpass || !this.panner) return

    this.currentT = this.computeT(when)
    const pos = this.interpolate(this.currentT)
    const { center } = yToFreqEdges(pos.y, this.bandwidthOctaves)
    const depthDb = -clamp(pos.depth ?? 0, 0, 1) * LINE_3D_DEPTH_ATTENUATION_DB
    const totalGain = dbToGain(loudnessCompensationDb(center) + depthDb) * this.interpolateEndpointAudioGain(this.currentT)
    const pan = pos.x * 2 - 1

    this.bandpass.scheduleBandpassFrequencyAndBandwidth(center, this.bandwidthOctaves, when)
    this.panner.pan.setValueAtTime(pan, when)

    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(totalGain, when)

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, when)
    envelope.gain.linearRampToValueAtTime(1, when + HIT_ATTACK_S)
    envelope.gain.linearRampToValueAtTime(0, when + HIT_ATTACK_S + this.hitReleaseS)

    this.bandpass.getOutputNode().connect(gainNode)
    gainNode.connect(envelope)
    envelope.connect(this.panner)

    const activeHit = { gainNode, envelope }
    this.activeHits.add(activeHit)

    const cleanupDelayMs = Math.max(0, (when + HIT_ATTACK_S + this.hitReleaseS + 0.05 - ctx.currentTime) * 1000)
    window.setTimeout(() => {
      try {
        gainNode.disconnect()
        envelope.disconnect()
      } catch {
        // Hit may already have been cleared by stop/restart.
      }
      this.activeHits.delete(activeHit)
    }, cleanupDelayMs)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GridPlayer — continuous dots in a flexible grid arrangement
// ═══════════════════════════════════════════════════════════════════════════

interface GridDotNodes {
  source: AudioBufferSourceNode
  hpf: BiquadFilterNode
  lpf: BiquadFilterNode
  gain: GainNode
  panner: StereoPannerNode
  activeEnvelopes: Set<{ envelope: GainNode; layerGain: GainNode }>
}

export interface GridRect {
  cx: number; cy: number
  hw: number; hh: number
}

export class GridPlayer {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private dots: GridDotNodes[] = []
  private noiseBuffer: AudioBuffer | null = null
  private playing = false
  private schedulerId: number | null = null
  private rect: GridRect = { cx: 0.5, cy: 0.5, hw: 0.15, hh: 0.15 }
  private gridSize: GridSize = DEFAULT_GRID_SIZE
  private readingOrder: GridReadingOrder = "columns"
  private bandwidthOctaves = DEFAULT_BANDWIDTH_OCTAVES
  private stepIntervalMs = DEFAULT_STEP_INTERVAL_MS
  private hitReleaseS = DEFAULT_HIT_RELEASE_S
  private depth = DEFAULT_DEPTH
  private sequenceStartTime = 0
  private nextStepTime = 0
  private scheduledStepIndex = 0
  private activeDotIndex = 0
  private _volume = 1
  private _checkerboard = false
  private checkerboardGroups: [number[], number[]] = [[], []]
  private _checkerboardVolumeDiffDb = 0
  private _checkerboardOscillate = false
  /** Full period of one oscillation cycle (loud→quiet→loud) in ms. */
  private _checkerboardOscillatePeriodMs = 4000
  /** "continuous" = sine wave, "instant" = square wave (hard flip each half-period). */
  private _checkerboardOscillateMode: "continuous" | "instant" = "continuous"
  /** "auto" = flip every CHECKERBOARD_SWAP_S, "manual" = stays on _manualGroup until user toggles. */
  private _checkerboardSwitchMode: "auto" | "manual" = "auto"
  private _manualGroup: 0 | 1 = 0
  /** When true, every step fires ALL dots (in the active group) simultaneously instead of walking one-by-one. */
  private _simultaneous = false
  /** When true (and checkerboard OFF), apply a static ± volume diff to the two diagonal parity groups. */
  private _diagonalDiff = false
  private _diagonalDiffDb = 0
  /** Map from dot index → normalized Y (0=bottom, 1=top) for volume diff calculation */
  private dotYPositions: Map<number, number> = new Map()
  private slopeDbPerOct = DEFAULT_BANDPASS_NOISE_SLOPE_DB_PER_OCT

  constructor(private sharedContext?: AudioContext, private sharedDestination?: AudioNode) {}

  setStepInterval(ms: number) {
    this.stepIntervalMs = Math.max(10, ms)
    if (this.playing) this.restartSequence()
  }

  setGridSize(size: GridSize) {
    if (size.rows === this.gridSize.rows && size.cols === this.gridSize.cols) return
    this.gridSize = size
    this.rebuildDotsIfPlaying()
  }

  setReadingOrder(order: GridReadingOrder) {
    if (order === this.readingOrder) return
    this.readingOrder = order
    this.rebuildDotsIfPlaying()
  }

  private rebuildDotsIfPlaying() {
    // Diagonal groups are reused for checkerboard AND diagonal-diff mode.
    this.recomputeCheckerboardGroups()
    const ctx = this.sharedContext ?? this.context
    if (this.playing && ctx) {
      this.clearDotNodes()
      this.createDotNodes(ctx)
      this.restartSequence()
    } else {
      this.updateDotPositions()
    }
  }

  setRect(rect: GridRect) {
    this.rect = rect
    this.updateDotPositions()
  }

  setBandwidth(octaves: number) {
    this.bandwidthOctaves = clamp(octaves, 0.5, 10)
    this.updateDotPositions()
  }

  setHitRelease(seconds: number) {
    this.hitReleaseS = clamp(seconds, 0.05, 3)
  }

  setDepth(depth: number) {
    this.depth = Math.max(1, Math.min(4, Math.round(depth)))
    if (this.playing) this.restartSequence()
  }

  setVolume(vol: number) {
    const v = clamp(vol, 0, 1)
    if (this.masterGain) this.masterGain.gain.value = v * MASTER_GAIN
    this._volume = v
  }

  getVolume(): number { return this._volume }

  async setSlope(dbPerOct: number) {
    if (dbPerOct === this.slopeDbPerOct) return
    this.slopeDbPerOct = dbPerOct
    const ctx = this.sharedContext ?? this.context
    if (!ctx || !this.noiseBuffer) return
    this.noiseBuffer = await generateSlopedNoiseBuffer(ctx.sampleRate, this.slopeDbPerOct)
    if (this.playing) {
      this.clearDotNodes()
      this.createDotNodes(ctx)
      this.restartSequence()
    }
  }

  setCheckerboard(enabled: boolean) {
    this._checkerboard = enabled
    if (enabled) this.recomputeCheckerboardGroups()
    if (this.playing) this.restartSequence()
  }

  getCheckerboard(): boolean { return this._checkerboard }

  /** Which checkerboard group (0 or 1) is currently active. */
  getActiveCheckerboardGroup(): number {
    if (!this._checkerboard) return 0
    if (this._checkerboardSwitchMode === "manual") return this._manualGroup
    const ctx = this.sharedContext ?? this.context
    if (!ctx || this.sequenceStartTime <= 0) return 0
    const elapsed = ctx.currentTime - this.sequenceStartTime
    if (elapsed < 0) return 0
    return Math.floor(elapsed / CHECKERBOARD_SWAP_S) % 2
  }

  setCheckerboardSwitchMode(mode: "auto" | "manual") {
    this._checkerboardSwitchMode = mode
  }

  /** Toggle which group is active in manual switch mode. */
  toggleCheckerboardGroup() {
    this._manualGroup = this._manualGroup === 0 ? 1 : 0
  }

  setCheckerboardManualGroup(group: 0 | 1) {
    this._manualGroup = group
  }

  /** When enabled, every step fires all dots (respecting checkerboard) at once. */
  setSimultaneous(enabled: boolean) {
    if (this._simultaneous === enabled) return
    this._simultaneous = enabled
    if (this.playing) this.restartSequence()
  }

  getSimultaneous(): boolean { return this._simultaneous }

  /** When on (and checkerboard off), the two diagonal groups get opposite-signed static dB offsets. */
  setDiagonalDiff(enabled: boolean) {
    this._diagonalDiff = enabled
    this.recomputeCheckerboardGroups()
  }

  getDiagonalDiff(): boolean { return this._diagonalDiff }

  /** Static dB offset applied to diagonal group 0 (group 1 gets the negative). */
  setDiagonalDiffDb(db: number) {
    this._diagonalDiffDb = clamp(db, -24, 24)
  }

  /** Get the dot indices for each checkerboard group. */
  getCheckerboardGroups(): [number[], number[]] {
    return this.checkerboardGroups
  }

  /**
   * Returns the current per-dot volume offset (in dB) for dots in the active
   * checkerboard group, based on the sequencer's current state. Used by the UI
   * to visualize the oscillation.
   */
  getCheckerboardDotOffsetsDb(): Map<number, number> {
    const result = new Map<number, number>()
    const ctx = this.sharedContext ?? this.context
    if (!ctx || this.sequenceStartTime <= 0) return result
    if (!this._checkerboard && !this._diagonalDiff) return result

    let oscPhase = 1
    if (this._checkerboardOscillate) {
      const elapsed = ctx.currentTime - this.sequenceStartTime
      const periodS = this._checkerboardOscillatePeriodMs / 1000
      if (this._checkerboardOscillateMode === "instant") {
        const halfPeriodS = periodS / 2
        oscPhase = Math.floor(elapsed / halfPeriodS) % 2 === 0 ? 1 : -1
      } else {
        oscPhase = Math.sin((2 * Math.PI * elapsed) / periodS)
      }
    }

    if (this._checkerboard) {
      const activeGroup = this.getActiveCheckerboardGroup()
      const activeDots = this.checkerboardGroups[activeGroup]
      if (!activeDots || activeDots.length === 0) return result

      for (const idx of activeDots) {
        const y = this.dotYPositions.get(idx) ?? 0.5
        const offset = this._checkerboardOscillate
          ? this._checkerboardVolumeDiffDb * (y < 0.5 ? -1 : 1) * oscPhase
          : this._checkerboardVolumeDiffDb * (y - 0.5)
        result.set(idx, offset)
      }
    } else if (this._diagonalDiff) {
      // Static ±diff on each diagonal group.
      for (const idx of this.checkerboardGroups[0]) {
        result.set(idx, this._diagonalDiffDb)
      }
      for (const idx of this.checkerboardGroups[1]) {
        result.set(idx, -this._diagonalDiffDb)
      }
    }
    return result
  }

  /** Volume differential in dB between bottom and top dots. Positive = bottom louder, negative = top louder. */
  setCheckerboardVolumeDiff(db: number) {
    this._checkerboardVolumeDiffDb = clamp(db, -24, 24)
  }

  /** When true, the sign of the volume differential flips every half-period. */
  setCheckerboardOscillate(enabled: boolean) {
    this._checkerboardOscillate = enabled
  }

  getCheckerboardOscillate(): boolean { return this._checkerboardOscillate }

  /** Full oscillation period in ms (loud→quiet→loud). */
  setCheckerboardOscillatePeriod(ms: number) {
    this._checkerboardOscillatePeriodMs = clamp(ms, 80, 30000)
  }

  /** "continuous" = sine wave, "instant" = hard sign flip each half-period. */
  setCheckerboardOscillateMode(mode: "continuous" | "instant") {
    this._checkerboardOscillateMode = mode
  }

  /** Compute which dot indices belong to each checkerboard group, and store Y positions. */
  private recomputeCheckerboardGroups() {
    const groupA: number[] = []
    const groupB: number[] = []
    const { rows, cols } = this.gridSize
    let idx = 0
    this.dotYPositions.clear()

    if (this.readingOrder === "rows") {
      for (let row = rows - 1; row >= 0; row--) {
        const normalizedY = rows > 1 ? row / (rows - 1) : 0.5
        for (let col = 0; col < cols; col++) {
          if ((row + col) % 2 === 0) groupA.push(idx)
          else groupB.push(idx)
          this.dotYPositions.set(idx, normalizedY)
          idx++
        }
      }
    } else {
      for (let col = 0; col < cols; col++) {
        for (let row = rows - 1; row >= 0; row--) {
          const normalizedY = rows > 1 ? row / (rows - 1) : 0.5
          if ((row + col) % 2 === 0) groupA.push(idx)
          else groupB.push(idx)
          this.dotYPositions.set(idx, normalizedY)
          idx++
        }
      }
    }

    this.checkerboardGroups = [groupA, groupB]
  }

  getCurrentDotIndex(): number {
    if (!this.playing) return -1
    const ctx = this.sharedContext ?? this.context
    if (!ctx || this.sequenceStartTime <= 0) return this.activeDotIndex

    const dotCount = this.dots.length || this.gridSize.rows * this.gridSize.cols
    const elapsed = ctx.currentTime - this.sequenceStartTime
    if (elapsed <= 0) return 0

    return Math.floor(elapsed / (this.stepIntervalMs / 1000)) % dotCount
  }

  private get dotPositions(): LinePoint[] {
    const { cx, cy, hw, hh } = this.rect
    const positions: LinePoint[] = []

    const { rows, cols } = this.gridSize
    const pointFor = (row: number, col: number): LinePoint => {
      const tx = cols > 1 ? col / (cols - 1) : 0.5
      const ty = rows > 1 ? row / (rows - 1) : 0.5
      return {
        x: clamp(cx - hw + tx * hw * 2, 0, 1),
        y: clamp(cy - hh + ty * hh * 2, 0, 1),
      }
    }

    if (this.readingOrder === "rows") {
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          positions.push(pointFor(row, col))
        }
      }
    } else {
      for (let col = 0; col < cols; col++) {
        for (let row = rows - 1; row >= 0; row--) {
          positions.push(pointFor(row, col))
        }
      }
    }

    return positions
  }

  private updateDotPositions() {
    const positions = this.dotPositions
    for (let i = 0; i < this.dots.length && i < positions.length; i++) {
      const dot = this.dots[i]
      const pos = positions[i]

      const { low, high, center } = yToFreqEdges(pos.y, this.bandwidthOctaves)
      const qValue = calculateBandpassQ(this.bandwidthOctaves)
      const compensationDb = loudnessCompensationDb(center)
      // Noise source is pre-shaped to the configured slope, so no per-band slope compensation needed here.
    const totalGainDb = compensationDb

      dot.hpf.frequency.value = low
      dot.hpf.Q.value = qValue
      dot.lpf.frequency.value = high
      dot.lpf.Q.value = qValue
      dot.gain.gain.value = dbToGain(totalGainDb) * BANDPASS_NOISE_OUTPUT_GAIN
      dot.panner.pan.value = pos.x * 2 - 1
    }
  }

  async start() {
    if (this.playing) await this.stop()
    await this.ensureGraph()
    const ctx = this.sharedContext ?? this.context
    if (!ctx) return
    if (!this.sharedContext) await ctx.resume()

    this.playing = true
    this.createDotNodes(ctx)
    this.restartSequence()
    this.schedulerId = window.setInterval(() => this.scheduleSteps(), SCHEDULER_INTERVAL_MS)
  }

  private createDotNodes(ctx: AudioContext) {
    const positions = this.dotPositions

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const { low, high, center } = yToFreqEdges(pos.y, this.bandwidthOctaves)
      const qValue = calculateBandpassQ(this.bandwidthOctaves)
      const compensationDb = loudnessCompensationDb(center)
      // Noise source is pre-shaped to the configured slope, so no per-band slope compensation needed here.
    const totalGainDb = compensationDb

      const source = ctx.createBufferSource()
      source.buffer = this.noiseBuffer!
      source.loop = true
      // stagger start offsets for variety
      const startOffset = (i / Math.max(1, positions.length)) * NOISE_BUFFER_SECONDS

      const hpf = ctx.createBiquadFilter()
      hpf.type = "highpass"
      hpf.frequency.value = low
      hpf.Q.value = qValue

      const lpf = ctx.createBiquadFilter()
      lpf.type = "lowpass"
      lpf.frequency.value = high
      lpf.Q.value = qValue

      const gain = ctx.createGain()
      gain.gain.value = dbToGain(totalGainDb) * BANDPASS_NOISE_OUTPUT_GAIN

      const panner = ctx.createStereoPanner()
      panner.pan.value = pos.x * 2 - 1

      source.connect(hpf)
      hpf.connect(lpf)
      lpf.connect(gain)
      panner.connect(this.masterGain!)

      source.start(0, startOffset)
      this.dots.push({ source, hpf, lpf, gain, panner, activeEnvelopes: new Set() })
    }
  }

  private restartSequence(delayS = 0.02) {
    const ctx = this.sharedContext ?? this.context
    if (!ctx) return

    const now = ctx.currentTime
    for (const dot of this.dots) {
      for (const { envelope } of dot.activeEnvelopes) {
        envelope.gain.cancelScheduledValues(now)
        envelope.gain.setValueAtTime(0, now)
      }
    }

    this.sequenceStartTime = now + delayS
    this.nextStepTime = this.sequenceStartTime
    this.scheduledStepIndex = 0
    this.activeDotIndex = 0
    this.scheduleSteps()
  }

  private scheduleSteps() {
    const ctx = this.sharedContext ?? this.context
    if (!ctx || !this.playing || this.dots.length === 0) return

    const horizon = ctx.currentTime + LOOKAHEAD_S
    const stepIntervalS = this.stepIntervalMs / 1000

    while (this.nextStepTime < horizon) {
      const elapsed = this.nextStepTime - this.sequenceStartTime
      const activeGroup = this._checkerboardSwitchMode === "manual"
        ? this._manualGroup
        : Math.floor(elapsed / CHECKERBOARD_SWAP_S) % 2

      const oscPhase = ((): number => {
        if (!this._checkerboardOscillate) return 1
        const periodS = this._checkerboardOscillatePeriodMs / 1000
        if (this._checkerboardOscillateMode === "instant") {
          const halfPeriodS = periodS / 2
          return Math.floor(elapsed / halfPeriodS) % 2 === 0 ? 1 : -1
        }
        return Math.sin((2 * Math.PI * elapsed) / periodS)
      })()

      const checkerboardOffsetFor = (dotIdx: number): number => {
        const y = this.dotYPositions.get(dotIdx) ?? 0.5
        if (this._checkerboardOscillate) {
          return this._checkerboardVolumeDiffDb * (y < 0.5 ? -1 : 1) * oscPhase
        }
        return this._checkerboardVolumeDiffDb * (y - 0.5)
      }

      const diagonalOffsetFor = (dotIdx: number): number => {
        // Static ±diff based on diagonal parity group.
        const sign = this.checkerboardGroups[0].includes(dotIdx) ? 1 : -1
        return this._diagonalDiffDb * sign
      }

      if (this._simultaneous) {
        // Every step fires all dots (or the active checkerboard group) simultaneously.
        const volumeLayer = this.scheduledStepIndex % this.depth
        if (this._checkerboard) {
          const dotsToHit = this.checkerboardGroups[activeGroup]
          for (const dotIdx of dotsToHit) {
            this.scheduleDotHit(dotIdx, this.nextStepTime, volumeLayer, dbToGain(checkerboardOffsetFor(dotIdx)))
          }
        } else {
          for (let dotIdx = 0; dotIdx < this.dots.length; dotIdx++) {
            const extraGain = this._diagonalDiff ? dbToGain(diagonalOffsetFor(dotIdx)) : 1
            this.scheduleDotHit(dotIdx, this.nextStepTime, volumeLayer, extraGain)
          }
        }
      } else {
        const dotIndex = this.scheduledStepIndex % this.dots.length
        const volumeLayer = Math.floor(this.scheduledStepIndex / this.dots.length) % this.depth

        if (this._checkerboard) {
          const activeDots = this.checkerboardGroups[activeGroup]
          if (activeDots.includes(dotIndex)) {
            this.scheduleDotHit(dotIndex, this.nextStepTime, volumeLayer, dbToGain(checkerboardOffsetFor(dotIndex)))
          }
        } else {
          const extraGain = this._diagonalDiff ? dbToGain(diagonalOffsetFor(dotIndex)) : 1
          this.scheduleDotHit(dotIndex, this.nextStepTime, volumeLayer, extraGain)
        }
      }

      this.scheduledStepIndex += 1
      this.nextStepTime += stepIntervalS
    }
  }

  private scheduleDotHit(dotIndex: number, when: number, volumeLayer: number, extraGainMultiplier = 1) {
    const ctx = this.sharedContext ?? this.context
    const dot = this.dots[dotIndex]
    if (!ctx || !dot) return

    const layerGain = ctx.createGain()
    layerGain.gain.value = depthLayerGain(this.depth, volumeLayer) * extraGainMultiplier

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, when)
    envelope.gain.linearRampToValueAtTime(1, when + HIT_ATTACK_S)
    envelope.gain.linearRampToValueAtTime(0, when + HIT_ATTACK_S + this.hitReleaseS)

    dot.gain.connect(layerGain)
    layerGain.connect(envelope)
    envelope.connect(dot.panner)
    const activeEnvelope = { envelope, layerGain }
    dot.activeEnvelopes.add(activeEnvelope)

    const cleanupDelayMs = Math.max(0, (when + HIT_ATTACK_S + this.hitReleaseS + 0.05 - ctx.currentTime) * 1000)
    window.setTimeout(() => {
      try {
        dot.gain.disconnect(layerGain)
        layerGain.disconnect()
        envelope.disconnect()
      } catch {
        // The dot may already have been rebuilt or stopped.
      }
      dot.activeEnvelopes.delete(activeEnvelope)
    }, cleanupDelayMs)

    this.activeDotIndex = dotIndex
  }

  async stop() {
    this.playing = false
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }

    this.clearDotNodes()

    if (!this.sharedContext && this.context?.state === "running") {
      await this.context.suspend()
    }
  }

  private clearDotNodes() {
    const ctx = this.sharedContext ?? this.context
    const now = ctx?.currentTime ?? 0
    for (const dot of this.dots) {
      for (const { envelope, layerGain } of dot.activeEnvelopes) {
        envelope.gain.cancelScheduledValues(now)
        envelope.gain.setValueAtTime(0, now)
        try {
          dot.gain.disconnect(layerGain)
          layerGain.disconnect()
          envelope.disconnect()
        } catch {
          // Envelope may already be disconnected by its cleanup timer.
        }
      }
      dot.activeEnvelopes.clear()
      try {
        dot.source.stop()
      } catch {
        // Source may already be stopped during hot reload cleanup.
      }
      dot.source.disconnect()
      dot.hpf.disconnect()
      dot.lpf.disconnect()
      dot.gain.disconnect()
      dot.panner.disconnect()
    }
    this.dots = []
  }

  async destroy() {
    await this.stop()
    this.masterGain?.disconnect()
    this.masterGain = null
    this.noiseBuffer = null
    if (!this.sharedContext && this.context) {
      const ctx = this.context
      this.context = null
      await ctx.close()
    } else {
      this.context = null
    }
  }

  isCurrentlyPlaying(): boolean { return this.playing }

  private async ensureGraph() {
    const ctx = this.sharedContext ?? this.context
    if (ctx && this.masterGain) return

    const audioCtx = this.sharedContext ?? createAudioContext()
    if (!this.sharedContext) this.context = audioCtx
    this.noiseBuffer = await generateSlopedNoiseBuffer(audioCtx.sampleRate, this.slopeDbPerOct)

    this.masterGain = audioCtx.createGain()
    this.masterGain.gain.value = this._volume * MASTER_GAIN
    this.masterGain.connect(this.sharedDestination ?? audioCtx.destination)
  }
}
