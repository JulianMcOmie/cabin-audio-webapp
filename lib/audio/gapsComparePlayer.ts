import { getAudioContext, resumeAudioContext } from "./audioContext"
import { dbToGain, clamp } from "../utils/audioMath"

// ─── Constants ──────────────────────────────────────────────────────────────

const NUM_BANDS = 40
const MIN_FREQ = 20
const MAX_FREQ = 20000
const SLOPE_DB_PER_OCT = -4.5
const PINK_NOISE_INHERENT_SLOPE = -3.0
const SLOPE_REF_FREQ = 800
const BAND_Q = 2.5
const MASTER_GAIN_SCALAR = 0.18
const NOISE_BUFFER_DURATION = 2

// Burst envelope (per play)
const BURST_ATTACK_MAX_S = 0.012
const BURST_HOLD_MAX_S = 0.09
const BURST_RELEASE_MAX_S = 0.06
const BURST_DUTY_CYCLE = 0.82
const BURST_MIN_TOTAL_S = 0.04

// Scheduling
const LOOKAHEAD_S = 0.25
const SCHEDULER_INTERVAL_MS = 60

// Bell cut
const BELL_CUT_DB = -12

export type CompareSoundId = "A" | "B"

export interface CompareSettings {
  freqA: number
  freqB: number
  q: number
  burstsPerSecond: number
  playsPerSound: number
}

// ─── Player ─────────────────────────────────────────────────────────────────

export class GapsComparePlayer {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private analyser: AnalyserNode | null = null

  // Two parallel signal chains, each with its own bell filter and gate.
  private chainA: {
    bellFilter: BiquadFilterNode
    gateGain: GainNode
    sources: AudioBufferSourceNode[]
  } | null = null
  private chainB: {
    bellFilter: BiquadFilterNode
    gateGain: GainNode
    sources: AudioBufferSourceNode[]
  } | null = null

  private pinkNoiseBuffer: AudioBuffer | null = null

  // Scheduler
  private schedulerTimer: number | null = null
  private nextBurstTime = 0
  private burstIndex = 0 // counts bursts since start

  private _isPlaying = false
  private _volume = -6 // dB

  private settings: CompareSettings = {
    freqA: 500,
    freqB: 2000,
    q: 2,
    burstsPerSecond: 2,
    playsPerSound: 2,
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._isPlaying) return

    const ctx = getAudioContext()
    await resumeAudioContext()
    this.ctx = ctx

    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = dbToGain(this._volume) * MASTER_GAIN_SCALAR

    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 4096
    this.analyser.smoothingTimeConstant = 0.8

    this.masterGain.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    this.pinkNoiseBuffer = this.generatePinkNoise(ctx)

    this.chainA = this.buildChain(ctx, this.settings.freqA, this.settings.q)
    this.chainB = this.buildChain(ctx, this.settings.freqB, this.settings.q)

    this._isPlaying = true
    this.nextBurstTime = ctx.currentTime + 0.1
    this.burstIndex = 0
    this.startScheduler()
  }

  stop(): void {
    if (!this._isPlaying) return

    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }

    for (const chain of [this.chainA, this.chainB]) {
      if (!chain) continue
      for (const src of chain.sources) {
        try { src.stop() } catch { /* already stopped */ }
        src.disconnect()
      }
      chain.bellFilter.disconnect()
      chain.gateGain.disconnect()
    }
    this.chainA = null
    this.chainB = null

    this.masterGain?.disconnect()
    this.analyser?.disconnect()
    this.masterGain = null
    this.analyser = null
    this.pinkNoiseBuffer = null
    this.nextBurstTime = 0
    this.burstIndex = 0
    this._isPlaying = false
  }

  dispose(): void {
    this.stop()
  }

  // ── Chain construction ──────────────────────────────────────────────────

  private buildChain(
    ctx: AudioContext,
    bellFreqHz: number,
    q: number
  ): {
    bellFilter: BiquadFilterNode
    gateGain: GainNode
    sources: AudioBufferSourceNode[]
  } {
    // Bell (peaking) filter, then gate, then to master.
    const bellFilter = ctx.createBiquadFilter()
    bellFilter.type = "peaking"
    bellFilter.frequency.value = clamp(bellFreqHz, MIN_FREQ, MAX_FREQ)
    bellFilter.Q.value = q
    bellFilter.gain.value = BELL_CUT_DB

    const gateGain = ctx.createGain()
    gateGain.gain.value = 0

    bellFilter.connect(gateGain)
    gateGain.connect(this.masterGain!)

    // Build the band stack feeding into bellFilter.
    const sources: AudioBufferSourceNode[] = []
    const logMin = Math.log2(MIN_FREQ)
    const logMax = Math.log2(MAX_FREQ)
    const step = (logMax - logMin) / NUM_BANDS

    for (let i = 0; i < NUM_BANDS; i++) {
      const lowerHz = Math.pow(2, logMin + i * step)
      const upperHz = Math.pow(2, logMin + (i + 1) * step)
      const centerHz = Math.sqrt(lowerHz * upperHz)

      const source = ctx.createBufferSource()
      source.buffer = this.pinkNoiseBuffer!
      source.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = "bandpass"
      filter.frequency.value = centerHz
      filter.Q.value = BAND_Q

      const shapingSlope = SLOPE_DB_PER_OCT - PINK_NOISE_INHERENT_SLOPE
      const gainDb = shapingSlope * Math.log2(centerHz / SLOPE_REF_FREQ)
      const slopeGain = ctx.createGain()
      slopeGain.gain.value = dbToGain(gainDb)

      source.connect(filter)
      filter.connect(slopeGain)
      slopeGain.connect(bellFilter)

      source.start()
      sources.push(source)
    }

    return { bellFilter, gateGain, sources }
  }

  // ── Pink noise (Voss-McCartney) ─────────────────────────────────────────

  private generatePinkNoise(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * NOISE_BUFFER_DURATION
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.96900 * b2 + white * 0.1538520
      b3 = 0.86650 * b3 + white * 0.3104856
      b4 = 0.55000 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.0168980
      b6 = white * 0.5362
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11
    }

    let peak = 0
    for (let i = 0; i < length; i++) {
      const abs = Math.abs(data[i])
      if (abs > peak) peak = abs
    }
    if (peak > 0.8) {
      const norm = 0.8 / peak
      for (let i = 0; i < length; i++) data[i] *= norm
    }

    return buffer
  }

  // ── Scheduler ───────────────────────────────────────────────────────────

  private startScheduler(): void {
    this.schedulerTimer = window.setInterval(() => this.scheduleBursts(), SCHEDULER_INTERVAL_MS)
    // Schedule immediately as well.
    this.scheduleBursts()
  }

  private scheduleBursts(): void {
    if (!this.ctx || !this.chainA || !this.chainB || !this._isPlaying) return

    const period = 1 / Math.max(0.1, this.settings.burstsPerSecond)
    const horizon = this.ctx.currentTime + LOOKAHEAD_S
    const playsPerSound = Math.max(1, Math.floor(this.settings.playsPerSound))

    while (this.nextBurstTime < horizon) {
      // Determine which sound this burst belongs to. Group of `playsPerSound`
      // bursts of A, then `playsPerSound` of B, alternating.
      const cycleLen = playsPerSound * 2
      const phase = this.burstIndex % cycleLen
      const isA = phase < playsPerSound
      const chain = isA ? this.chainA : this.chainB

      this.scheduleBurstEnvelope(chain.gateGain.gain, this.nextBurstTime, period)

      this.burstIndex += 1
      this.nextBurstTime += period
    }
  }

  private scheduleBurstEnvelope(param: AudioParam, startTime: number, period: number): void {
    const totalDuration = Math.max(
      BURST_MIN_TOTAL_S,
      Math.min(period * BURST_DUTY_CYCLE, BURST_ATTACK_MAX_S + BURST_HOLD_MAX_S + BURST_RELEASE_MAX_S)
    )
    const attack = Math.min(BURST_ATTACK_MAX_S, totalDuration * 0.2)
    const release = Math.min(BURST_RELEASE_MAX_S, totalDuration * 0.42)
    const hold = Math.min(BURST_HOLD_MAX_S, Math.max(0.004, totalDuration - attack - release))
    const attackEnd = startTime + attack
    const sustainEnd = attackEnd + hold
    const releaseEnd = sustainEnd + release

    param.setValueAtTime(0, startTime)
    param.linearRampToValueAtTime(1, attackEnd)
    param.setValueAtTime(1, sustainEnd)
    param.linearRampToValueAtTime(0, releaseEnd)
  }

  // ── Settings ────────────────────────────────────────────────────────────

  setSettings(partial: Partial<CompareSettings>): void {
    const next = { ...this.settings, ...partial }
    next.freqA = clamp(next.freqA, MIN_FREQ, MAX_FREQ)
    next.freqB = clamp(next.freqB, MIN_FREQ, MAX_FREQ)
    next.q = clamp(next.q, 0.1, 18)
    next.burstsPerSecond = clamp(next.burstsPerSecond, 0.25, 20)
    next.playsPerSound = Math.max(1, Math.floor(next.playsPerSound))
    this.settings = next

    if (!this.ctx) return
    const now = this.ctx.currentTime

    if (this.chainA) {
      this.chainA.bellFilter.frequency.setTargetAtTime(this.settings.freqA, now, 0.02)
      this.chainA.bellFilter.Q.setTargetAtTime(this.settings.q, now, 0.02)
    }
    if (this.chainB) {
      this.chainB.bellFilter.frequency.setTargetAtTime(this.settings.freqB, now, 0.02)
      this.chainB.bellFilter.Q.setTargetAtTime(this.settings.q, now, 0.02)
    }
  }

  getSettings(): CompareSettings {
    return { ...this.settings }
  }

  // ── Volume ──────────────────────────────────────────────────────────────

  setVolume(db: number): void {
    this._volume = clamp(db, -60, 6)
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        dbToGain(this._volume) * MASTER_GAIN_SCALAR,
        this.ctx.currentTime,
        0.02
      )
    }
  }

  // ── State queries ───────────────────────────────────────────────────────

  get isPlaying(): boolean {
    return this._isPlaying
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.analyser
  }

  /** Approximate dB at frequency `hz` for a peaking biquad — for visualization. */
  static peakingResponseDb(hz: number, centerHz: number, q: number, gainDb: number): number {
    // Standard RBJ peaking EQ magnitude in dB at frequency hz given centerHz, Q, gainDb.
    // Use a simple analytic approximation: gain * exp(-(ln(f/fc))^2 * Q^2 * k)
    // This isn't physically exact but is a clean visual that matches the bell shape.
    const ratio = Math.log2(hz / centerHz)
    const bandwidth = 1 / Math.max(0.1, q)
    const x = ratio / bandwidth
    return gainDb * Math.exp(-x * x * Math.LN2 * 2)
  }

  static get bellCutDb(): number {
    return BELL_CUT_DB
  }
}
