import type { HrtfDataset } from "@/lib/hrtf/types"
import { applyDifferenceReduction, clamp01, getFilterMixGains, removeSharedMagnitude } from "@/lib/hrtf/processing"

const BURSTS_PER_SECOND = 7
const BURST_ATTACK_SECONDS = 0.008
const BURST_DECAY_SECONDS = 0.02
const BURST_HOLD_SECONDS = 0.02
const BURST_RELEASE_SECONDS = 0.05
const BURST_SUSTAIN_LEVEL = 0.72
const BURST_LEVEL_SEQUENCE = [0.4, 0.7, 1] as const
const LOOKAHEAD_SECONDS = 0.3
const SCHEDULER_INTERVAL_MS = 80
const CROSSFADE_SECONDS = 0.04
const MASTER_GAIN = 0.42
const NOISE_BUFFER_SECONDS = 4

type ConvolverSlot = "a" | "b"

function createAudioContext(): AudioContext {
  return new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
}

function createPinkNoiseBuffer(context: AudioContext): AudioBuffer {
  const frameCount = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS)
  const buffer = context.createBuffer(1, frameCount, context.sampleRate)
  const channelData = buffer.getChannelData(0)

  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0

  for (let i = 0; i < frameCount; i += 1) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    b6 = white * 0.5362
    channelData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11
  }

  let peak = 1e-6
  for (let i = 0; i < frameCount; i += 1) {
    peak = Math.max(peak, Math.abs(channelData[i]))
  }

  const scale = 0.9 / peak
  for (let i = 0; i < frameCount; i += 1) {
    channelData[i] *= scale
  }

  return buffer
}

export class HrtfMvpPlayer {
  private dataset: HrtfDataset | null = null
  private context: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null
  private sourceNode: AudioBufferSourceNode | null = null
  private burstGain: GainNode | null = null
  private dryGain: GainNode | null = null
  private wetGain: GainNode | null = null
  private convolverA: ConvolverNode | null = null
  private convolverB: ConvolverNode | null = null
  private convolverGainA: GainNode | null = null
  private convolverGainB: GainNode | null = null
  private masterGain: GainNode | null = null
  private activeSlot: ConvolverSlot | null = null
  private selectedSubjectIndex = 0
  private selectedPositionKey = ""
  private nextBurstTime = 0
  private burstLevelIndex = 0
  private schedulerId: number | null = null
  private playing = false
  private filterEnabled = true
  private filterIntensity = 1
  private differenceReduction = 0
  private removeSharedMagnitudeEnabled = false

  setDataset(dataset: HrtfDataset) {
    const hasCurrentPosition = dataset.positions.some((position) => position.key === this.selectedPositionKey)
    this.dataset = dataset
    this.selectedPositionKey = hasCurrentPosition ? this.selectedPositionKey : dataset.positions[0]?.key ?? ""

    if (this.context) {
      this.activateSubject(this.selectedSubjectIndex, !this.playing || this.activeSlot === null)
    }
  }

  setPositionKey(positionKey: string) {
    this.selectedPositionKey = positionKey

    if (this.context && this.dataset) {
      this.activateSubject(this.selectedSubjectIndex, !this.playing || this.activeSlot === null)
    }
  }

  setFilterEnabled(filterEnabled: boolean) {
    this.filterEnabled = filterEnabled
    this.updateMixGains()
  }

  setFilterIntensity(filterIntensity: number) {
    this.filterIntensity = clamp01(filterIntensity)
    this.updateMixGains()
  }

  setDifferenceReduction(differenceReduction: number) {
    this.differenceReduction = clamp01(differenceReduction)

    if (this.context && this.dataset) {
      this.activateSubject(this.selectedSubjectIndex, !this.playing || this.activeSlot === null)
    }
  }

  setRemoveSharedMagnitudeEnabled(removeSharedMagnitudeEnabled: boolean) {
    this.removeSharedMagnitudeEnabled = removeSharedMagnitudeEnabled

    if (this.context && this.dataset) {
      this.activateSubject(this.selectedSubjectIndex, !this.playing || this.activeSlot === null)
    }
  }

  async start(subjectIndex: number) {
    if (!this.dataset) {
      throw new Error("HRTF dataset is not loaded.")
    }

    this.selectedSubjectIndex = this.clampSubjectIndex(subjectIndex)
    this.ensureGraph()

    if (!this.context) {
      throw new Error("Audio context was not created.")
    }

    await this.context.resume()

    if (!this.sourceNode) {
      this.sourceNode = this.context.createBufferSource()
      this.sourceNode.buffer = this.noiseBuffer
      this.sourceNode.loop = true
      this.sourceNode.connect(this.burstGain!)
      this.sourceNode.start()
    }

    const shouldSnapToSubject = !this.playing || this.activeSlot === null

    if (!this.playing) {
      this.playing = true
      this.burstLevelIndex = 0
      this.nextBurstTime = this.context.currentTime + 0.02
      this.scheduleBursts()
      this.schedulerId = window.setInterval(() => this.scheduleBursts(), SCHEDULER_INTERVAL_MS)
    }

    this.activateSubject(this.selectedSubjectIndex, shouldSnapToSubject)
  }

  async stop() {
    this.playing = false

    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }

    if (this.context && this.burstGain) {
      const now = this.context.currentTime
      this.burstGain.gain.cancelScheduledValues(now)
      this.burstGain.gain.setValueAtTime(0, now)
    }

    this.burstLevelIndex = 0

    if (this.sourceNode) {
      this.sourceNode.stop()
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.context?.state === "running") {
      await this.context.suspend()
    }
  }

  setSubjectIndex(subjectIndex: number) {
    this.selectedSubjectIndex = this.clampSubjectIndex(subjectIndex)

    if (this.context && this.dataset) {
      this.activateSubject(this.selectedSubjectIndex, !this.playing || this.activeSlot === null)
    }
  }

  async destroy() {
    await this.stop()

    this.convolverA?.disconnect()
    this.convolverB?.disconnect()
    this.convolverGainA?.disconnect()
    this.convolverGainB?.disconnect()
    this.burstGain?.disconnect()
    this.dryGain?.disconnect()
    this.wetGain?.disconnect()
    this.masterGain?.disconnect()

    this.convolverA = null
    this.convolverB = null
    this.convolverGainA = null
    this.convolverGainB = null
    this.burstGain = null
    this.dryGain = null
    this.wetGain = null
    this.masterGain = null
    this.noiseBuffer = null
    this.activeSlot = null

    if (this.context) {
      const context = this.context
      this.context = null
      await context.close()
    }
  }

  private clampSubjectIndex(subjectIndex: number) {
    const totalSubjects = this.dataset?.subjects.length ?? 0
    if (totalSubjects === 0) return 0
    return Math.max(0, Math.min(totalSubjects - 1, Math.round(subjectIndex)))
  }

  private ensureGraph() {
    if (!this.dataset) {
      return
    }

    if (this.context) {
      return
    }

    this.context = createAudioContext()
    this.noiseBuffer = createPinkNoiseBuffer(this.context)

    this.burstGain = this.context.createGain()
    this.burstGain.gain.value = 0
    this.dryGain = this.context.createGain()
    this.wetGain = this.context.createGain()

    this.convolverA = this.context.createConvolver()
    this.convolverA.normalize = false
    this.convolverB = this.context.createConvolver()
    this.convolverB.normalize = false

    this.convolverGainA = this.context.createGain()
    this.convolverGainA.gain.value = 0
    this.convolverGainB = this.context.createGain()
    this.convolverGainB.gain.value = 0

    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = MASTER_GAIN

    this.burstGain.connect(this.dryGain)
    this.burstGain.connect(this.convolverA)
    this.burstGain.connect(this.convolverB)
    this.dryGain.connect(this.masterGain)
    this.convolverA.connect(this.convolverGainA)
    this.convolverB.connect(this.convolverGainB)
    this.convolverGainA.connect(this.wetGain)
    this.convolverGainB.connect(this.wetGain)
    this.wetGain.connect(this.masterGain)
    this.masterGain.connect(this.context.destination)

    this.updateMixGains()
  }

  private activateSubject(subjectIndex: number, immediate: boolean) {
    if (!this.context || !this.convolverA || !this.convolverB || !this.convolverGainA || !this.convolverGainB) {
      return
    }

    const buffer = this.createImpulseBuffer(subjectIndex)
    if (!buffer) {
      return
    }

    const now = this.context.currentTime

    if (this.activeSlot === null || immediate) {
      this.convolverA.buffer = buffer
      this.convolverGainA.gain.cancelScheduledValues(now)
      this.convolverGainB.gain.cancelScheduledValues(now)
      this.convolverGainA.gain.setValueAtTime(1, now)
      this.convolverGainB.gain.setValueAtTime(0, now)
      this.activeSlot = "a"
      return
    }

    const nextSlot: ConvolverSlot = this.activeSlot === "a" ? "b" : "a"
    const activeGain = this.activeSlot === "a" ? this.convolverGainA : this.convolverGainB
    const inactiveGain = nextSlot === "a" ? this.convolverGainA : this.convolverGainB
    const inactiveConvolver = nextSlot === "a" ? this.convolverA : this.convolverB

    inactiveConvolver.buffer = buffer

    activeGain.gain.cancelScheduledValues(now)
    inactiveGain.gain.cancelScheduledValues(now)
    activeGain.gain.setValueAtTime(activeGain.gain.value, now)
    inactiveGain.gain.setValueAtTime(inactiveGain.gain.value, now)
    inactiveGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS)
    activeGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECONDS)

    this.activeSlot = nextSlot
  }

  private createImpulseBuffer(subjectIndex: number) {
    if (!this.context || !this.dataset) {
      return null
    }

    const subject = this.dataset.subjects[subjectIndex]
    const measurement = subject?.positions[this.selectedPositionKey]

    if (!subject || !measurement) {
      return null
    }

    const reduced = applyDifferenceReduction(measurement.left, measurement.right, this.differenceReduction)
    const processed = this.removeSharedMagnitudeEnabled ? removeSharedMagnitude(reduced.left, reduced.right) : reduced
    const impulseBuffer = this.context.createBuffer(2, processed.left.length, this.dataset.sampleRate)
    impulseBuffer.copyToChannel(processed.left, 0)
    impulseBuffer.copyToChannel(processed.right, 1)
    return impulseBuffer
  }

  private updateMixGains() {
    if (!this.context || !this.dryGain || !this.wetGain) {
      return
    }

    const { dryGain, wetGain } = getFilterMixGains(this.filterEnabled, this.filterIntensity)
    const now = this.context.currentTime
    this.dryGain.gain.cancelScheduledValues(now)
    this.wetGain.gain.cancelScheduledValues(now)
    this.dryGain.gain.setValueAtTime(this.dryGain.gain.value, now)
    this.wetGain.gain.setValueAtTime(this.wetGain.gain.value, now)
    this.dryGain.gain.linearRampToValueAtTime(dryGain, now + CROSSFADE_SECONDS)
    this.wetGain.gain.linearRampToValueAtTime(wetGain, now + CROSSFADE_SECONDS)
  }

  private scheduleBursts() {
    if (!this.context || !this.burstGain || !this.playing) {
      return
    }

    const gate = this.burstGain.gain
    const period = 1 / BURSTS_PER_SECOND
    const horizon = this.context.currentTime + LOOKAHEAD_SECONDS

    while (this.nextBurstTime < horizon) {
      const burstPeakLevel = BURST_LEVEL_SEQUENCE[this.burstLevelIndex % BURST_LEVEL_SEQUENCE.length]
      const burstSustainLevel = burstPeakLevel * BURST_SUSTAIN_LEVEL
      const attackEnd = this.nextBurstTime + BURST_ATTACK_SECONDS
      const decayEnd = attackEnd + BURST_DECAY_SECONDS
      const holdEnd = decayEnd + BURST_HOLD_SECONDS
      const releaseEnd = holdEnd + BURST_RELEASE_SECONDS

      gate.setValueAtTime(0, this.nextBurstTime)
      gate.linearRampToValueAtTime(burstPeakLevel, attackEnd)
      gate.linearRampToValueAtTime(burstSustainLevel, decayEnd)
      gate.setValueAtTime(burstSustainLevel, holdEnd)
      gate.linearRampToValueAtTime(0, releaseEnd)

      this.burstLevelIndex += 1
      this.nextBurstTime += period
    }
  }
}
