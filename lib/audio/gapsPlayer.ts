import { getAudioContext, resumeAudioContext } from "./audioContext"
import { dbToGain, clamp } from "../utils/audioMath"

// ─── Constants ──────────────────────────────────────────────────────────────

const NUM_BANDS = 40 // Number of parallel noise bands across the spectrum
const MIN_FREQ = 20 // Hz
const MAX_FREQ = 20000 // Hz
const SLOPE_DB_PER_OCT = -4.5 // Target spectral slope
const PINK_NOISE_INHERENT_SLOPE = -3.0 // Pink noise already falls at -3dB/oct
const SLOPE_REF_FREQ = 800 // Hz – reference for slope calculation
const BAND_Q = 2.5 // Q for each bandpass filter
const MASTER_GAIN_SCALAR = 0.18 // Overall output level
const NOISE_BUFFER_DURATION = 2 // seconds

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FrequencyGap {
  id: string
  startHz: number
  endHz: number
}

export interface BandInfo {
  index: number
  centerHz: number
  lowerHz: number
  upperHz: number
  active: boolean // false = in a gap
}

// ─── GapsPlayer ─────────────────────────────────────────────────────────────

export class GapsPlayer {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private bands: {
    source: AudioBufferSourceNode
    filter: BiquadFilterNode
    slopeGain: GainNode
    muteGain: GainNode
    centerHz: number
    lowerHz: number
    upperHz: number
  }[] = []
  private pinkNoiseBuffer: AudioBuffer | null = null
  private _gaps: FrequencyGap[] = []
  private _isPlaying = false
  private _volume = 0 // dB

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._isPlaying) return

    const ctx = getAudioContext()
    await resumeAudioContext()
    this.ctx = ctx

    // Master gain → analyser → destination
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = dbToGain(this._volume) * MASTER_GAIN_SCALAR

    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 4096
    this.analyser.smoothingTimeConstant = 0.8

    this.masterGain.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    // Generate pink noise buffer
    this.pinkNoiseBuffer = this.generatePinkNoise(ctx)

    // Create bands
    this.buildBands(ctx)

    this._isPlaying = true
  }

  stop(): void {
    if (!this._isPlaying) return

    for (const band of this.bands) {
      try { band.source.stop() } catch { /* already stopped */ }
      band.source.disconnect()
      band.filter.disconnect()
      band.slopeGain.disconnect()
      band.muteGain.disconnect()
    }
    this.bands = []

    this.masterGain?.disconnect()
    this.analyser?.disconnect()
    this.masterGain = null
    this.analyser = null
    this.pinkNoiseBuffer = null
    this._isPlaying = false
  }

  dispose(): void {
    this.stop()
  }

  // ── Band construction ───────────────────────────────────────────────────

  private buildBands(ctx: AudioContext): void {
    const logMin = Math.log2(MIN_FREQ)
    const logMax = Math.log2(MAX_FREQ)
    const step = (logMax - logMin) / NUM_BANDS

    for (let i = 0; i < NUM_BANDS; i++) {
      const lowerHz = Math.pow(2, logMin + i * step)
      const upperHz = Math.pow(2, logMin + (i + 1) * step)
      const centerHz = Math.sqrt(lowerHz * upperHz) // geometric mean

      // Source: looping pink noise
      const source = ctx.createBufferSource()
      source.buffer = this.pinkNoiseBuffer!
      source.loop = true

      // Bandpass filter
      const filter = ctx.createBiquadFilter()
      filter.type = "bandpass"
      filter.frequency.value = centerHz
      filter.Q.value = BAND_Q

      // Slope shaping gain: compensate pink noise to reach -4.5dB/oct
      const shapingSlope = SLOPE_DB_PER_OCT - PINK_NOISE_INHERENT_SLOPE
      const gainDb = shapingSlope * Math.log2(centerHz / SLOPE_REF_FREQ)
      const slopeGain = ctx.createGain()
      slopeGain.gain.value = dbToGain(gainDb)

      // Mute gain: 1 if active, 0 if in a gap
      const muteGain = ctx.createGain()
      const active = !this.isFrequencyInGap(centerHz)
      muteGain.gain.value = active ? 1 : 0

      // Connect: source → filter → slopeGain → muteGain → master
      source.connect(filter)
      filter.connect(slopeGain)
      slopeGain.connect(muteGain)
      muteGain.connect(this.masterGain!)

      source.start()

      this.bands.push({ source, filter, slopeGain, muteGain, centerHz, lowerHz, upperHz })
    }
  }

  // ── Pink noise generation (Voss-McCartney) ─────────────────────────────

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

    // Normalize
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

  // ── Gap management ──────────────────────────────────────────────────────

  get gaps(): FrequencyGap[] {
    return this._gaps
  }

  setGaps(gaps: FrequencyGap[]): void {
    this._gaps = gaps
    this.applyGapsToBands()
  }

  private isFrequencyInGap(hz: number): boolean {
    return this._gaps.some((g) => hz >= g.startHz && hz <= g.endHz)
  }

  private applyGapsToBands(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime

    for (const band of this.bands) {
      const active = !this.isFrequencyInGap(band.centerHz)
      // Quick crossfade to avoid clicks
      band.muteGain.gain.cancelScheduledValues(now)
      band.muteGain.gain.setTargetAtTime(active ? 1 : 0, now, 0.015)
    }
  }

  // ── Volume ──────────────────────────────────────────────────────────────

  get volume(): number {
    return this._volume
  }

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

  getBandInfos(): BandInfo[] {
    return this.bands.map((b, i) => ({
      index: i,
      centerHz: b.centerHz,
      lowerHz: b.lowerHz,
      upperHz: b.upperHz,
      active: !this.isFrequencyInGap(b.centerHz),
    }))
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.analyser
  }
}
