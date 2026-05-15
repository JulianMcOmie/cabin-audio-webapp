import type { HrtfDataset } from "@/lib/hrtf/types"

const MASTER_GAIN = 0.55
const CROSSFADE_SECONDS = 0.04
const SCHEDULER_INTERVAL_MS = 80
const LOOKAHEAD_SECONDS = 0.3
const BPM = 104
const SECONDS_PER_BEAT = 60 / BPM
const SIXTEENTH = SECONDS_PER_BEAT / 4

export type DrumName = "hihat" | "snare" | "kick"

type ConvolverSlot = "a" | "b"

interface PositionBlend {
  aKey: string
  bKey: string
  t: number
}

interface DrumVoice {
  name: DrumName
  inputGain: GainNode
  convolverA: ConvolverNode
  convolverB: ConvolverNode
  gainA: GainNode
  gainB: GainNode
  activeSlot: ConvolverSlot | null
  subjectIndex: number
  positionBlend: PositionBlend
}

const DRUM_POSITIONS: Record<DrumName, PositionBlend> = {
  hihat: { aKey: "above", bKey: "above", t: 0 },
  snare: { aKey: "above", bKey: "front", t: 0.5 },
  kick: { aKey: "front", bKey: "front", t: 0 },
}

function createAudioContext(): AudioContext {
  return new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
}

export class HrtfDrumsPlayer {
  private dataset: HrtfDataset | null = null
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private voices: Record<DrumName, DrumVoice> | null = null
  private playing = false
  private schedulerId: number | null = null
  private nextStepTime = 0
  private stepIndex = 0

  setDataset(dataset: HrtfDataset) {
    this.dataset = dataset
    if (this.context && this.voices) {
      ;(Object.keys(this.voices) as DrumName[]).forEach((name) => {
        this.voices![name].subjectIndex = this.clampSubjectIndex(this.voices![name].subjectIndex)
        this.updateVoiceImpulse(name, true)
      })
    }
  }

  setSubjectIndex(drum: DrumName, subjectIndex: number) {
    const clamped = this.clampSubjectIndex(subjectIndex)
    if (this.voices) {
      this.voices[drum].subjectIndex = clamped
    }
    if (this.context && this.dataset) {
      this.updateVoiceImpulse(drum, false)
    }
  }

  async start() {
    if (!this.dataset) {
      throw new Error("HRTF dataset is not loaded.")
    }

    this.ensureGraph()

    if (!this.context) {
      throw new Error("Audio context was not created.")
    }

    await this.context.resume()

    if (!this.playing) {
      this.playing = true
      this.stepIndex = 0
      this.nextStepTime = this.context.currentTime + 0.06
      this.scheduleSteps()
      this.schedulerId = window.setInterval(() => this.scheduleSteps(), SCHEDULER_INTERVAL_MS)
    }
  }

  async stop() {
    this.playing = false

    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }

    if (this.context?.state === "running") {
      await this.context.suspend()
    }
  }

  async destroy() {
    await this.stop()

    if (this.voices) {
      ;(Object.values(this.voices) as DrumVoice[]).forEach((voice) => {
        voice.inputGain.disconnect()
        voice.convolverA.disconnect()
        voice.convolverB.disconnect()
        voice.gainA.disconnect()
        voice.gainB.disconnect()
      })
      this.voices = null
    }

    this.masterGain?.disconnect()
    this.masterGain = null

    if (this.context) {
      const context = this.context
      this.context = null
      await context.close()
    }
  }

  private clampSubjectIndex(subjectIndex: number) {
    const total = this.dataset?.subjects.length ?? 0
    if (total === 0) return 0
    return Math.max(0, Math.min(total - 1, Math.round(subjectIndex)))
  }

  private ensureGraph() {
    if (!this.dataset || this.context) return

    const context = createAudioContext()
    this.context = context

    this.masterGain = context.createGain()
    this.masterGain.gain.value = MASTER_GAIN
    this.masterGain.connect(context.destination)

    const makeVoice = (name: DrumName): DrumVoice => {
      const inputGain = context.createGain()
      inputGain.gain.value = 1

      const convolverA = context.createConvolver()
      convolverA.normalize = false
      const convolverB = context.createConvolver()
      convolverB.normalize = false

      const gainA = context.createGain()
      gainA.gain.value = 0
      const gainB = context.createGain()
      gainB.gain.value = 0

      inputGain.connect(convolverA)
      inputGain.connect(convolverB)
      convolverA.connect(gainA)
      convolverB.connect(gainB)
      gainA.connect(this.masterGain!)
      gainB.connect(this.masterGain!)

      return {
        name,
        inputGain,
        convolverA,
        convolverB,
        gainA,
        gainB,
        activeSlot: null,
        subjectIndex: 0,
        positionBlend: DRUM_POSITIONS[name],
      }
    }

    this.voices = {
      hihat: makeVoice("hihat"),
      snare: makeVoice("snare"),
      kick: makeVoice("kick"),
    }
    ;(Object.keys(this.voices) as DrumName[]).forEach((name) => {
      this.updateVoiceImpulse(name, true)
    })
  }

  private createImpulseBuffer(voice: DrumVoice): AudioBuffer | null {
    if (!this.context || !this.dataset) return null

    const subject = this.dataset.subjects[voice.subjectIndex]
    if (!subject) return null

    const { aKey, bKey, t } = voice.positionBlend
    const a = subject.positions[aKey]
    const b = subject.positions[bKey]
    if (!a || !b) return null

    const length = Math.min(a.left.length, b.left.length)
    const leftBlend = new Float32Array(length)
    const rightBlend = new Float32Array(length)
    const ta = 1 - t
    const tb = t

    for (let i = 0; i < length; i += 1) {
      leftBlend[i] = a.left[i] * ta + b.left[i] * tb
      rightBlend[i] = a.right[i] * ta + b.right[i] * tb
    }

    const buffer = this.context.createBuffer(2, length, this.dataset.sampleRate)
    buffer.copyToChannel(leftBlend, 0)
    buffer.copyToChannel(rightBlend, 1)
    return buffer
  }

  private updateVoiceImpulse(name: DrumName, immediate: boolean) {
    if (!this.context || !this.voices) return
    const voice = this.voices[name]
    const buffer = this.createImpulseBuffer(voice)
    if (!buffer) return

    const now = this.context.currentTime

    if (voice.activeSlot === null || immediate) {
      voice.convolverA.buffer = buffer
      voice.gainA.gain.cancelScheduledValues(now)
      voice.gainB.gain.cancelScheduledValues(now)
      voice.gainA.gain.setValueAtTime(1, now)
      voice.gainB.gain.setValueAtTime(0, now)
      voice.activeSlot = "a"
      return
    }

    const nextSlot: ConvolverSlot = voice.activeSlot === "a" ? "b" : "a"
    const activeGain = voice.activeSlot === "a" ? voice.gainA : voice.gainB
    const inactiveGain = nextSlot === "a" ? voice.gainA : voice.gainB
    const inactiveConvolver = nextSlot === "a" ? voice.convolverA : voice.convolverB

    inactiveConvolver.buffer = buffer

    activeGain.gain.cancelScheduledValues(now)
    inactiveGain.gain.cancelScheduledValues(now)
    activeGain.gain.setValueAtTime(activeGain.gain.value, now)
    inactiveGain.gain.setValueAtTime(inactiveGain.gain.value, now)
    inactiveGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS)
    activeGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECONDS)

    voice.activeSlot = nextSlot
  }

  private scheduleSteps() {
    if (!this.context || !this.voices || !this.playing) return

    const horizon = this.context.currentTime + LOOKAHEAD_SECONDS

    while (this.nextStepTime < horizon) {
      const step = this.stepIndex % 16

      if (step % 2 === 0) {
        this.triggerHiHat(this.nextStepTime)
      }
      if (step === 4 || step === 12) {
        this.triggerSnare(this.nextStepTime)
      }
      if (step === 0 || step === 6 || step === 8) {
        this.triggerKick(this.nextStepTime)
      }

      this.stepIndex += 1
      this.nextStepTime += SIXTEENTH
    }
  }

  private triggerKick(when: number) {
    if (!this.context || !this.voices) return
    const ctx = this.context
    const voice = this.voices.kick

    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(150, when)
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.09)

    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(1.1, when + 0.004)
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.38)

    osc.connect(env).connect(voice.inputGain)
    osc.start(when)
    osc.stop(when + 0.42)
  }

  private triggerSnare(when: number) {
    if (!this.context || !this.voices) return
    const ctx = this.context
    const voice = this.voices.snare

    const noiseDuration = 0.25
    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDuration), ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1
    }
    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const hpf = ctx.createBiquadFilter()
    hpf.type = "highpass"
    hpf.frequency.value = 1400

    const noiseEnv = ctx.createGain()
    noiseEnv.gain.setValueAtTime(0, when)
    noiseEnv.gain.linearRampToValueAtTime(0.75, when + 0.002)
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, when + 0.2)

    noise.connect(hpf).connect(noiseEnv).connect(voice.inputGain)
    noise.start(when)
    noise.stop(when + noiseDuration)

    const osc = ctx.createOscillator()
    osc.type = "triangle"
    osc.frequency.setValueAtTime(220, when)
    osc.frequency.exponentialRampToValueAtTime(155, when + 0.1)

    const oscEnv = ctx.createGain()
    oscEnv.gain.setValueAtTime(0, when)
    oscEnv.gain.linearRampToValueAtTime(0.42, when + 0.002)
    oscEnv.gain.exponentialRampToValueAtTime(0.001, when + 0.13)

    osc.connect(oscEnv).connect(voice.inputGain)
    osc.start(when)
    osc.stop(when + 0.16)
  }

  private triggerHiHat(when: number) {
    if (!this.context || !this.voices) return
    const ctx = this.context
    const voice = this.voices.hihat

    const duration = 0.09
    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1
    }
    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const hpf = ctx.createBiquadFilter()
    hpf.type = "highpass"
    hpf.frequency.value = 7000

    const bpf = ctx.createBiquadFilter()
    bpf.type = "bandpass"
    bpf.frequency.value = 10000
    bpf.Q.value = 0.7

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(0.32, when + 0.001)
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.05)

    noise.connect(hpf).connect(bpf).connect(env).connect(voice.inputGain)
    noise.start(when)
    noise.stop(when + duration)
  }
}
