"use client"

import type { HrtfDataset, HrtfMeasurement } from "@/lib/hrtf/types"

export type SpeakerKey = "left" | "right"
type ConvolverSlot = "a" | "b"

export interface VirtualStereoSettings {
  masterGain: number
}

interface SharedMediaSource {
  context: AudioContext
  sourceNode: MediaElementAudioSourceNode
  owners: number
}

interface SpeakerNodes {
  input: GainNode
  convolverA: ConvolverNode
  convolverB: ConvolverNode
  gainA: GainNode
  gainB: GainNode
  activeSlot: ConvolverSlot | null
}

const LEFT_SPEAKER_POSITION_KEY = "front_left"
const RIGHT_SPEAKER_POSITION_KEY = "front_right"
const CROSSFADE_SECONDS = 0.04
const CONTROL_RAMP_SECONDS = 0.02
const sharedMediaSources = new WeakMap<HTMLMediaElement, SharedMediaSource>()

export const DEFAULT_VIRTUAL_STEREO_SETTINGS: VirtualStereoSettings = {
  masterGain: 0.72,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function createAudioContext(): AudioContext {
  return new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
}

function positionKeyForSpeaker(speakerKey: SpeakerKey) {
  return speakerKey === "left" ? LEFT_SPEAKER_POSITION_KEY : RIGHT_SPEAKER_POSITION_KEY
}

export class VirtualStereoPlayer {
  private context: AudioContext | null = null
  private element: HTMLMediaElement | null = null
  private sharedSource: SharedMediaSource | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private splitter: ChannelSplitterNode | null = null
  private masterGainNode: GainNode | null = null
  private speakerNodes: Record<SpeakerKey, SpeakerNodes> | null = null
  private dataset: HrtfDataset | null = null
  private selectedSubjectIndex = 0
  private settings: VirtualStereoSettings = { ...DEFAULT_VIRTUAL_STEREO_SETTINGS }

  attachMediaElement(element: HTMLMediaElement) {
    if (this.element === element) {
      this.ensureGraph()
      return
    }

    this.detachMediaElementListeners()
    this.disposeLocalGraph()
    this.releaseSharedSource()
    this.element = element
    this.element.addEventListener("play", this.handleElementPlay)
    this.ensureGraph()
  }

  setDataset(dataset: HrtfDataset) {
    this.dataset = dataset
    this.selectedSubjectIndex = this.clampSubjectIndex(this.selectedSubjectIndex)

    if (this.speakerNodes) {
      this.activateSubject(this.selectedSubjectIndex, true)
    }
  }

  setSubjectIndex(subjectIndex: number) {
    this.selectedSubjectIndex = this.clampSubjectIndex(subjectIndex)

    if (this.speakerNodes) {
      this.activateSubject(this.selectedSubjectIndex, false)
    }
  }

  setSettings(settings: Partial<VirtualStereoSettings>) {
    this.settings = {
      ...this.settings,
      ...settings,
      masterGain: clamp(settings.masterGain ?? this.settings.masterGain, 0, 1.5),
    }
    this.applySettings()
  }

  async resume() {
    this.ensureGraph()
    if (!this.context) {
      return
    }
    if (this.context.state !== "running") {
      await this.context.resume()
    }
  }

  async destroy() {
    this.detachMediaElementListeners()
    this.disposeLocalGraph()
    this.releaseSharedSource()
    this.element = null
  }

  private detachMediaElementListeners() {
    if (!this.element) {
      return
    }

    this.element.removeEventListener("play", this.handleElementPlay)
  }

  private handleElementPlay = () => {
    void this.resume()
  }

  private ensureGraph() {
    if (!this.element || this.speakerNodes) {
      return
    }

    this.acquireSharedSource()

    if (!this.context || !this.sourceNode) {
      return
    }

    const context = this.context
    const splitter = context.createChannelSplitter(2)
    const masterGainNode = context.createGain()

    const createSpeakerNodes = (): SpeakerNodes => {
      const input = context.createGain()
      const convolverA = context.createConvolver()
      convolverA.normalize = false
      const convolverB = context.createConvolver()
      convolverB.normalize = false
      const gainA = context.createGain()
      gainA.gain.value = 0
      const gainB = context.createGain()
      gainB.gain.value = 0

      input.connect(convolverA)
      input.connect(convolverB)
      convolverA.connect(gainA)
      convolverB.connect(gainB)
      gainA.connect(masterGainNode)
      gainB.connect(masterGainNode)

      return {
        input,
        convolverA,
        convolverB,
        gainA,
        gainB,
        activeSlot: null,
      }
    }

    const speakerNodes: Record<SpeakerKey, SpeakerNodes> = {
      left: createSpeakerNodes(),
      right: createSpeakerNodes(),
    }

    this.sourceNode.connect(splitter)
    splitter.connect(speakerNodes.left.input, 0)
    splitter.connect(speakerNodes.right.input, 1)
    masterGainNode.connect(context.destination)

    this.splitter = splitter
    this.masterGainNode = masterGainNode
    this.speakerNodes = speakerNodes

    this.applySettings()
    this.activateSubject(this.selectedSubjectIndex, true)
  }

  private acquireSharedSource() {
    if (!this.element || this.sharedSource) {
      return
    }

    let shared = sharedMediaSources.get(this.element)
    if (!shared) {
      const context = createAudioContext()
      const sourceNode = context.createMediaElementSource(this.element)
      shared = {
        context,
        sourceNode,
        owners: 0,
      }
      sharedMediaSources.set(this.element, shared)
    }

    shared.owners += 1
    this.sharedSource = shared
    this.context = shared.context
    this.sourceNode = shared.sourceNode
  }

  private releaseSharedSource() {
    if (!this.sharedSource) {
      this.context = null
      this.sourceNode = null
      return
    }

    const shared = this.sharedSource
    shared.owners = Math.max(0, shared.owners - 1)

    if (shared.owners === 0 && shared.context.state === "running") {
      void shared.context.suspend().catch(() => undefined)
    }

    this.sharedSource = null
    this.context = null
    this.sourceNode = null
  }

  private disposeLocalGraph() {
    if (this.sourceNode && this.splitter) {
      try {
        this.sourceNode.disconnect(this.splitter)
      } catch {
        // Ignore disconnect mismatches during development remounts.
      }
    }

    if (this.speakerNodes) {
      Object.values(this.speakerNodes).forEach((speaker) => {
        speaker.input.disconnect()
        speaker.convolverA.disconnect()
        speaker.convolverB.disconnect()
        speaker.gainA.disconnect()
        speaker.gainB.disconnect()
      })
    }

    this.splitter?.disconnect()
    this.masterGainNode?.disconnect()

    this.speakerNodes = null
    this.splitter = null
    this.masterGainNode = null
  }

  private applySettings() {
    if (!this.context || !this.masterGainNode) {
      return
    }

    const now = this.context.currentTime
    this.masterGainNode.gain.cancelScheduledValues(now)
    this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now)
    this.masterGainNode.gain.linearRampToValueAtTime(this.settings.masterGain, now + CONTROL_RAMP_SECONDS)
  }

  private clampSubjectIndex(subjectIndex: number) {
    const totalSubjects = this.dataset?.subjects.length ?? 0
    if (totalSubjects === 0) return 0
    return Math.max(0, Math.min(totalSubjects - 1, Math.round(subjectIndex)))
  }

  private activateSubject(subjectIndex: number, immediate: boolean) {
    if (!this.context || !this.dataset || !this.speakerNodes) {
      return
    }

    ;(["left", "right"] as const).forEach((speakerKey) => {
      const measurement = this.getMeasurement(speakerKey, subjectIndex)
      if (!measurement) {
        return
      }

      const buffer = this.createImpulseBuffer(measurement)
      this.activateSpeaker(speakerKey, buffer, immediate)
    })
  }

  private getMeasurement(speakerKey: SpeakerKey, subjectIndex: number) {
    const subject = this.dataset?.subjects[subjectIndex]
    const positionKey = positionKeyForSpeaker(speakerKey)
    return subject?.positions[positionKey] ?? null
  }

  private createImpulseBuffer(measurement: HrtfMeasurement) {
    if (!this.context || !this.dataset) {
      return null
    }

    const impulseBuffer = this.context.createBuffer(2, measurement.left.length, this.dataset.sampleRate)
    impulseBuffer.copyToChannel(Float32Array.from(measurement.left), 0)
    impulseBuffer.copyToChannel(Float32Array.from(measurement.right), 1)
    return impulseBuffer
  }

  private activateSpeaker(speakerKey: SpeakerKey, buffer: AudioBuffer | null, immediate: boolean) {
    if (!this.context || !this.speakerNodes || !buffer) {
      return
    }

    const speaker = this.speakerNodes[speakerKey]
    const now = this.context.currentTime

    if (speaker.activeSlot === null || immediate) {
      speaker.convolverA.buffer = buffer
      speaker.gainA.gain.cancelScheduledValues(now)
      speaker.gainB.gain.cancelScheduledValues(now)
      speaker.gainA.gain.setValueAtTime(1, now)
      speaker.gainB.gain.setValueAtTime(0, now)
      speaker.activeSlot = "a"
      return
    }

    const nextSlot: ConvolverSlot = speaker.activeSlot === "a" ? "b" : "a"
    const activeGain = speaker.activeSlot === "a" ? speaker.gainA : speaker.gainB
    const inactiveGain = nextSlot === "a" ? speaker.gainA : speaker.gainB
    const inactiveConvolver = nextSlot === "a" ? speaker.convolverA : speaker.convolverB

    inactiveConvolver.buffer = buffer

    activeGain.gain.cancelScheduledValues(now)
    inactiveGain.gain.cancelScheduledValues(now)
    activeGain.gain.setValueAtTime(activeGain.gain.value, now)
    inactiveGain.gain.setValueAtTime(inactiveGain.gain.value, now)
    inactiveGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS)
    activeGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECONDS)

    speaker.activeSlot = nextSlot
  }
}
