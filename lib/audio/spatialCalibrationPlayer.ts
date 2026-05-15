import { decodeAudioData, getAudioContext, resumeAudioContext } from "@/lib/audio/audioContext"
import { SlopedPinkNoiseGenerator } from "@/lib/audio/dotGridAudio"
import { dbToGain, clamp } from "@/lib/utils/audioMath"

export type SpatialBandChannel = "left" | "both" | "right"

export interface SpatialPlace {
  id: string
  label: string
  index: number
  normalizedY: number
  lowerHz: number
  upperHz: number
  centerHz: number
}

export interface SpatialEqBand {
  id: string
  placeId: string
  label: string
  frequency: number
  gainDb: number
  bandwidthOct: number
  channel: SpatialBandChannel
  bypassed: boolean
}

export const SPATIAL_PLACE_COUNT = 7
export const SPATIAL_BANDPASS_BANDWIDTH_OCTAVES = 2
export const SPATIAL_NOISE_SLOPE_DB_PER_OCT = -4.5
export const SPATIAL_GAIN_MIN_DB = -18
export const SPATIAL_GAIN_MAX_DB = 18
export const SPATIAL_BANDWIDTH_MIN_OCT = 0.5
export const SPATIAL_BANDWIDTH_MAX_OCT = 1

const MIN_AUDIBLE_HZ = 20
const MAX_AUDIBLE_HZ = 20000
const DEPTH_SEQUENCE_DB = [-24, -12, 0, -12]
const CALIBRATION_HIT_INTERVAL_MS = 720
const CALIBRATION_ATTACK_S = 0.01
const CALIBRATION_RELEASE_S = 0.52

function frequencyLabel(frequency: number): string {
  if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency >= 10000 ? 0 : 1)}k`
  return `${Math.round(frequency)}`
}

export function formatSpatialFrequency(frequency: number): string {
  return frequencyLabel(frequency)
}

export function bandwidthOctToQ(bandwidthOct: number): number {
  const bw = clamp(bandwidthOct, SPATIAL_BANDWIDTH_MIN_OCT, SPATIAL_BANDWIDTH_MAX_OCT)
  return 1 / (2 * Math.sinh((Math.log(2) / 2) * bw))
}

export function buildSpatialPlaces(): SpatialPlace[] {
  const topLowerEdge = MAX_AUDIBLE_HZ / Math.pow(2, SPATIAL_BANDPASS_BANDWIDTH_OCTAVES)
  return Array.from({ length: SPATIAL_PLACE_COUNT }, (_, index) => {
    const normalizedY = SPATIAL_PLACE_COUNT <= 1 ? 0.5 : index / (SPATIAL_PLACE_COUNT - 1)
    const lowerHz = MIN_AUDIBLE_HZ * Math.pow(topLowerEdge / MIN_AUDIBLE_HZ, normalizedY)
    const upperHz = lowerHz * Math.pow(2, SPATIAL_BANDPASS_BANDWIDTH_OCTAVES)
    const centerHz = Math.sqrt(lowerHz * upperHz)
    return {
      id: `place-${index}`,
      label: `Place ${index + 1}`,
      index,
      normalizedY,
      lowerHz,
      upperHz,
      centerHz,
    }
  })
}

export function createDefaultSpatialBands(places: SpatialPlace[]): SpatialEqBand[] {
  return places.flatMap((place) => {
    const lowBandFrequency = clamp(place.centerHz / Math.pow(2, 0.38), place.lowerHz, place.upperHz)
    const highBandFrequency = clamp(place.centerHz * Math.pow(2, 0.38), place.lowerHz, place.upperHz)
    return [
      {
        id: `${place.id}-a`,
        placeId: place.id,
        label: "A",
        frequency: lowBandFrequency,
        gainDb: 0,
        bandwidthOct: 0.75,
        channel: "left" as const,
        bypassed: false,
      },
      {
        id: `${place.id}-b`,
        placeId: place.id,
        label: "B",
        frequency: highBandFrequency,
        gainDb: 0,
        bandwidthOct: 0.75,
        channel: "right" as const,
        bypassed: false,
      },
    ]
  })
}

function makePinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const bufferSize = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  for (let i = 0; i < bufferSize; i++) {
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

  let peak = 0
  for (let i = 0; i < bufferSize; i++) peak = Math.max(peak, Math.abs(data[i]))
  const scale = peak > 0.8 ? 0.8 / peak : 1
  for (let i = 0; i < bufferSize; i++) data[i] *= scale
  return buffer
}

class StereoEqChain {
  public readonly inputLeft: GainNode
  public readonly inputRight: GainNode
  public readonly output: GainNode

  private readonly ctx: AudioContext
  private filters: BiquadFilterNode[] = []
  private merger: ChannelMergerNode | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.inputLeft = ctx.createGain()
    this.inputRight = ctx.createGain()
    this.output = ctx.createGain()
    this.rebuild([])
  }

  rebuild(bands: SpatialEqBand[]) {
    this.inputLeft.disconnect()
    this.inputRight.disconnect()
    this.filters.forEach((filter) => filter.disconnect())
    this.filters = []
    this.merger?.disconnect()

    let leftTail: AudioNode = this.inputLeft
    let rightTail: AudioNode = this.inputRight

    bands.forEach((band) => {
      if (band.bypassed || Math.abs(band.gainDb) < 0.001) return
      const channel = band.channel
      if (channel === "left" || channel === "both") {
        const filter = this.makeBandFilter(band)
        leftTail.connect(filter)
        leftTail = filter
        this.filters.push(filter)
      }
      if (channel === "right" || channel === "both") {
        const filter = this.makeBandFilter(band)
        rightTail.connect(filter)
        rightTail = filter
        this.filters.push(filter)
      }
    })

    this.merger = this.ctx.createChannelMerger(2)
    leftTail.connect(this.merger, 0, 0)
    rightTail.connect(this.merger, 0, 1)
    this.merger.connect(this.output)
  }

  dispose() {
    this.inputLeft.disconnect()
    this.inputRight.disconnect()
    this.filters.forEach((filter) => filter.disconnect())
    this.filters = []
    this.merger?.disconnect()
    this.output.disconnect()
  }

  private makeBandFilter(band: SpatialEqBand): BiquadFilterNode {
    const filter = this.ctx.createBiquadFilter()
    filter.type = "peaking"
    filter.frequency.value = band.frequency
    filter.gain.value = band.gainDb
    filter.Q.value = bandwidthOctToQ(band.bandwidthOct)
    return filter
  }
}

export class SpatialCalibrationPlayer {
  private readonly ctx: AudioContext
  private readonly masterGain: GainNode
  private readonly calibrationEq: StereoEqChain
  private readonly musicEq: StereoEqChain

  private calibrationSource: AudioBufferSourceNode | null = null
  private calibrationSloped: SlopedPinkNoiseGenerator | null = null
  private calibrationHighpass: BiquadFilterNode | null = null
  private calibrationLowpass: BiquadFilterNode | null = null
  private calibrationDepthGain: GainNode | null = null
  private calibrationTimeoutId: number | null = null
  private calibrationStep = 0
  private calibrationPlaying = false
  private activePlace: SpatialPlace | null = null

  private musicBuffer: AudioBuffer | null = null
  private musicSource: AudioBufferSourceNode | null = null
  private musicSplitter: ChannelSplitterNode | null = null
  private musicStartedAt = 0
  private musicOffset = 0
  private musicPlaying = false

  constructor(bands: SpatialEqBand[], volumeDb: number = -12) {
    this.ctx = getAudioContext()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = dbToGain(volumeDb)
    this.masterGain.connect(this.ctx.destination)

    this.calibrationEq = new StereoEqChain(this.ctx)
    this.musicEq = new StereoEqChain(this.ctx)
    this.calibrationEq.output.connect(this.masterGain)
    this.musicEq.output.connect(this.masterGain)
    this.updateBands(bands)
  }

  get isCalibrationPlaying(): boolean {
    return this.calibrationPlaying
  }

  get isMusicPlaying(): boolean {
    return this.musicPlaying
  }

  setVolumeDb(volumeDb: number) {
    this.masterGain.gain.setTargetAtTime(dbToGain(volumeDb), this.ctx.currentTime, 0.015)
  }

  updateBands(bands: SpatialEqBand[]) {
    this.calibrationEq.rebuild(bands)
    this.musicEq.rebuild(bands)
  }

  async startCalibration(place: SpatialPlace) {
    await resumeAudioContext()
    this.ensureCalibrationGraph()
    this.activePlace = place
    this.updateCalibrationBandpass(place)
    if (this.calibrationPlaying) return
    this.calibrationPlaying = true
    this.calibrationStep = 0
    this.scheduleCalibrationHit()
  }

  stopCalibration() {
    this.calibrationPlaying = false
    if (this.calibrationTimeoutId !== null) {
      clearTimeout(this.calibrationTimeoutId)
      this.calibrationTimeoutId = null
    }
    const now = this.ctx.currentTime
    this.calibrationDepthGain?.gain.cancelScheduledValues(now)
    this.calibrationDepthGain?.gain.setTargetAtTime(0, now, 0.01)
  }

  async loadMusicFile(file: File): Promise<AudioBuffer> {
    await resumeAudioContext()
    const arrayBuffer = await file.arrayBuffer()
    this.musicBuffer = await decodeAudioData(arrayBuffer)
    this.musicOffset = 0
    return this.musicBuffer
  }

  async playMusic() {
    if (!this.musicBuffer || this.musicPlaying) return
    await resumeAudioContext()

    const source = this.ctx.createBufferSource()
    source.buffer = this.musicBuffer
    source.loop = true

    if (this.musicBuffer.numberOfChannels > 1) {
      const splitter = this.ctx.createChannelSplitter(2)
      source.connect(splitter)
      splitter.connect(this.musicEq.inputLeft, 0)
      splitter.connect(this.musicEq.inputRight, 1)
      this.musicSplitter = splitter
    } else {
      source.connect(this.musicEq.inputLeft)
      source.connect(this.musicEq.inputRight)
      this.musicSplitter = null
    }

    source.onended = () => {
      if (this.musicSource === source) this.musicSource = null
    }
    this.musicSource = source
    this.musicStartedAt = this.ctx.currentTime
    source.start(this.musicStartedAt, this.musicOffset)
    this.musicPlaying = true
  }

  pauseMusic() {
    if (!this.musicSource || !this.musicBuffer || !this.musicPlaying) return
    const elapsed = this.ctx.currentTime - this.musicStartedAt
    this.musicOffset = (this.musicOffset + elapsed) % this.musicBuffer.duration
    this.disposeMusicSource()
    this.musicPlaying = false
  }

  stopMusic() {
    this.disposeMusicSource()
    this.musicOffset = 0
    this.musicPlaying = false
  }

  dispose() {
    this.stopCalibration()
    this.disposeCalibrationGraph()
    this.stopMusic()
    this.calibrationEq.dispose()
    this.musicEq.dispose()
    this.masterGain.disconnect()
  }

  private ensureCalibrationGraph() {
    if (this.calibrationSource) return

    const source = this.ctx.createBufferSource()
    source.buffer = makePinkNoiseBuffer(this.ctx)
    source.loop = true

    const sloped = new SlopedPinkNoiseGenerator(this.ctx)
    sloped.setSlope(SPATIAL_NOISE_SLOPE_DB_PER_OCT)

    const highpass = this.ctx.createBiquadFilter()
    highpass.type = "highpass"
    highpass.Q.value = 1.5
    const lowpass = this.ctx.createBiquadFilter()
    lowpass.type = "lowpass"
    lowpass.Q.value = 1.5
    const depthGain = this.ctx.createGain()
    depthGain.gain.value = 0

    source.connect(sloped.getInputNode())
    sloped.getOutputNode().connect(highpass)
    highpass.connect(lowpass)
    lowpass.connect(depthGain)
    depthGain.connect(this.calibrationEq.inputLeft)
    depthGain.connect(this.calibrationEq.inputRight)
    source.start()

    this.calibrationSource = source
    this.calibrationSloped = sloped
    this.calibrationHighpass = highpass
    this.calibrationLowpass = lowpass
    this.calibrationDepthGain = depthGain
  }

  private updateCalibrationBandpass(place: SpatialPlace) {
    const now = this.ctx.currentTime
    this.calibrationHighpass?.frequency.setTargetAtTime(place.lowerHz, now, 0.015)
    this.calibrationLowpass?.frequency.setTargetAtTime(place.upperHz, now, 0.015)
  }

  private scheduleCalibrationHit() {
    if (!this.calibrationPlaying || !this.calibrationDepthGain) return

    if (this.activePlace) this.updateCalibrationBandpass(this.activePlace)

    const now = this.ctx.currentTime
    const peakGain = dbToGain(DEPTH_SEQUENCE_DB[this.calibrationStep] ?? -12)
    const gain = this.calibrationDepthGain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(0, now)
    gain.linearRampToValueAtTime(peakGain, now + CALIBRATION_ATTACK_S)
    gain.linearRampToValueAtTime(0, now + CALIBRATION_ATTACK_S + CALIBRATION_RELEASE_S)

    this.calibrationStep = (this.calibrationStep + 1) % DEPTH_SEQUENCE_DB.length
    this.calibrationTimeoutId = window.setTimeout(() => {
      this.scheduleCalibrationHit()
    }, CALIBRATION_HIT_INTERVAL_MS)
  }

  private disposeCalibrationGraph() {
    this.calibrationSource?.stop()
    this.calibrationSource?.disconnect()
    this.calibrationSloped?.dispose()
    this.calibrationHighpass?.disconnect()
    this.calibrationLowpass?.disconnect()
    this.calibrationDepthGain?.disconnect()
    this.calibrationSource = null
    this.calibrationSloped = null
    this.calibrationHighpass = null
    this.calibrationLowpass = null
    this.calibrationDepthGain = null
  }

  private disposeMusicSource() {
    if (!this.musicSource) return
    try {
      this.musicSource.stop()
    } catch {
      // Already stopped.
    }
    this.musicSource.disconnect()
    this.musicSplitter?.disconnect()
    this.musicSource = null
    this.musicSplitter = null
  }
}
