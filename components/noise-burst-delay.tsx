"use client"

import type React from "react"
import { useRef, useEffect, useState, useCallback } from "react"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { FrequencyEQ } from "@/components/parametric-eq"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { v4 as uuidv4 } from 'uuid'

// Constants matching other components
const NUM_BANDS = 20
const SLOPE_REF_FREQUENCY = 800
const MIN_AUDIBLE_FREQ = 20
const MAX_AUDIBLE_FREQ = 20000
const BAND_Q_VALUE = 1.5
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0
const TARGET_SLOPE_DB_PER_OCT = -4.5
const OUTPUT_GAIN_SCALAR = 0.3

interface NoiseBurstDelayProps {
  disabled?: boolean
}

// Reuse the SlopedPinkNoiseGenerator class
class SlopedPinkNoiseGenerator {
  private ctx: AudioContext
  private inputGainNode: GainNode
  private outputGainNode: GainNode
  private bandFilters: BiquadFilterNode[] = []
  private bandGains: GainNode[] = []
  private centerFrequencies: number[] = []

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx
    this.inputGainNode = this.ctx.createGain()
    this.outputGainNode = this.ctx.createGain()
    this.outputGainNode.gain.value = OUTPUT_GAIN_SCALAR

    const logMinFreq = Math.log2(MIN_AUDIBLE_FREQ)
    const logMaxFreq = Math.log2(MAX_AUDIBLE_FREQ)
    const step = (logMaxFreq - logMinFreq) / (NUM_BANDS + 1)

    for (let i = 0; i < NUM_BANDS; i++) {
      const centerFreq = Math.pow(2, logMinFreq + (i + 1) * step)
      this.centerFrequencies.push(centerFreq)

      const filter = this.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = centerFreq
      filter.Q.value = BAND_Q_VALUE
      this.bandFilters.push(filter)

      const gain = this.ctx.createGain()
      this.bandGains.push(gain)

      this.inputGainNode.connect(filter)
      filter.connect(gain)
      gain.connect(this.outputGainNode)
    }

    this.setSlope(TARGET_SLOPE_DB_PER_OCT)
  }

  public getInputNode(): GainNode {
    return this.inputGainNode
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode
  }

  public setSlope(targetOverallSlopeDbPerOctave: number): void {
    const shapingSlope = targetOverallSlopeDbPerOctave - PINK_NOISE_SLOPE_DB_PER_OCT
    for (let i = 0; i < NUM_BANDS; i++) {
      const fc = this.centerFrequencies[i]
      const gainDb = shapingSlope * Math.log2(fc / SLOPE_REF_FREQUENCY)
      const linearGain = Math.pow(10, gainDb / 20)
      this.bandGains[i].gain.value = linearGain
    }
  }

  public dispose(): void {
    this.inputGainNode.disconnect()
    this.outputGainNode.disconnect()
    this.bandFilters.forEach(filter => filter.disconnect())
    this.bandGains.forEach(gain => gain.disconnect())
  }
}

// EQ Processor for the delayed signal
class DelayedSignalEQProcessor {
  private ctx: AudioContext
  private inputNode: GainNode
  private outputNode: GainNode
  private eqFilters: BiquadFilterNode[] = []

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext
    this.inputNode = this.ctx.createGain()
    this.outputNode = this.ctx.createGain()

    // Connect input directly to output initially (no EQ)
    this.inputNode.connect(this.outputNode)
  }

  public getInputNode(): GainNode {
    return this.inputNode
  }

  public getOutputNode(): GainNode {
    return this.outputNode
  }

  public updateEQBands(bands: Array<{frequency: number, gain: number, q: number, type: BiquadFilterType}>) {
    // Disconnect existing filters
    this.clearFilters()

    if (bands.length === 0) {
      // No EQ bands, connect directly
      this.inputNode.connect(this.outputNode)
      return
    }

    // Create filter chain
    let previousNode: AudioNode = this.inputNode

    bands.forEach(band => {
      const filter = this.ctx.createBiquadFilter()
      filter.type = band.type || 'peaking'
      filter.frequency.value = band.frequency
      filter.gain.value = band.gain
      filter.Q.value = band.q

      previousNode.connect(filter)
      previousNode = filter
      this.eqFilters.push(filter)
    })

    // Connect last filter to output
    previousNode.connect(this.outputNode)
  }

  private clearFilters() {
    // Disconnect all existing connections
    this.inputNode.disconnect()
    this.eqFilters.forEach(filter => filter.disconnect())
    this.eqFilters = []
  }

  public dispose() {
    this.clearFilters()
    this.inputNode.disconnect()
    this.outputNode.disconnect()
  }
}

export function NoiseBurstDelay({ disabled = false }: NoiseBurstDelayProps) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastBurstTimeRef = useRef(0)
  const noiseBufferRef = useRef<AudioBuffer | null>(null)
  const delayedEQProcessorRef = useRef<DelayedSignalEQProcessor | null>(null)

  const [, setIsDarkMode] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [delayTime, setDelayTime] = useState(100) // ms
  const [delayVolume, setDelayVolume] = useState(50) // percentage
  const [showEQ, setShowEQ] = useState(false)

  const BURST_INTERVAL = 1000 // ms between bursts
  const BURST_DURATION = 300 // ms per burst

  // EQ Profile management
  const { addProfile, getProfileById } = useEQProfileStore()
  const [delayEQProfileId] = useState(() => {
    const profileId = `delay-eq-${uuidv4()}`
    // Create a profile for the delayed signal's EQ
    addProfile({
      id: profileId,
      name: 'Delayed Signal EQ',
      bands: [],
      volume: 0,
      lastModified: Date.now(),
      syncStatus: 'modified'
    })
    return profileId
  })

  // Get the current EQ profile for the delayed signal
  const delayEQProfile = getProfileById(delayEQProfileId)

  // Detect theme changes
  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"))
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          setIsDarkMode(document.documentElement.classList.contains("dark"))
        }
      })
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

    // Create the EQ processor for the delayed signal
    delayedEQProcessorRef.current = new DelayedSignalEQProcessor(audioContextRef.current)

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      if (delayedEQProcessorRef.current) {
        delayedEQProcessorRef.current.dispose()
      }
    }
  }, [])

  // Update EQ processor when profile changes
  useEffect(() => {
    if (delayedEQProcessorRef.current && delayEQProfile) {
      delayedEQProcessorRef.current.updateEQBands(
        delayEQProfile.bands.map(band => ({
          frequency: band.frequency,
          gain: band.gain,
          q: band.q,
          type: (band.type || 'peaking') as BiquadFilterType
        }))
      )
    }
  }, [delayEQProfile])

  // Create pink noise buffer
  const createPinkNoiseBuffer = useCallback((duration: number = 2) => {
    if (!audioContextRef.current) return null

    const audioContext = audioContextRef.current
    const bufferSize = audioContext.sampleRate * duration
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
    const data = buffer.getChannelData(0)

    // Paul Kellet's pink noise algorithm
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < bufferSize; i++) {
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
    for (let i = 0; i < bufferSize; i++) {
      const abs = Math.abs(data[i])
      if (abs > peak) peak = abs
    }
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor
    }

    return buffer
  }, [])

  // Create noise buffer once
  useEffect(() => {
    if (audioContextRef.current && !noiseBufferRef.current) {
      noiseBufferRef.current = createPinkNoiseBuffer(2)
    }
  }, [createPinkNoiseBuffer])

  // Play a burst with original and delayed copy
  const playBurst = useCallback(() => {
    const audioContext = audioContextRef.current
    const noiseBuffer = noiseBufferRef.current
    const delayedEQProcessor = delayedEQProcessorRef.current

    if (!audioContext || !noiseBuffer || !delayedEQProcessor) return

    const startTime = audioContext.currentTime
    const burstDurationSec = BURST_DURATION / 1000

    // Create envelope for smooth burst
    const envelopeGain = audioContext.createGain()
    envelopeGain.gain.setValueAtTime(0, startTime)

    const attackTime = 0.05
    const releaseTime = 0.05
    const sustainTime = burstDurationSec - attackTime - releaseTime
    const peakGain = 0.8

    // Envelope shape
    envelopeGain.gain.setValueAtTime(0.001, startTime)
    envelopeGain.gain.exponentialRampToValueAtTime(peakGain, startTime + attackTime)
    envelopeGain.gain.setValueAtTime(peakGain, startTime + attackTime + sustainTime)
    envelopeGain.gain.exponentialRampToValueAtTime(0.001, startTime + attackTime + sustainTime + releaseTime)

    // === ORIGINAL SIGNAL PATH ===
    const originalSource = audioContext.createBufferSource()
    originalSource.buffer = noiseBuffer
    originalSource.loop = true

    const originalSlopeGen = new SlopedPinkNoiseGenerator(audioContext)
    originalSource.connect(originalSlopeGen.getInputNode())
    originalSlopeGen.getOutputNode().connect(envelopeGain)

    // === DELAYED SIGNAL PATH ===
    const delayedSource = audioContext.createBufferSource()
    delayedSource.buffer = noiseBuffer
    delayedSource.loop = true

    const delayedSlopeGen = new SlopedPinkNoiseGenerator(audioContext)
    const delayNode = audioContext.createDelay(0.5) // Max 500ms delay
    const delayGainNode = audioContext.createGain()

    // Set delay time and volume
    delayNode.delayTime.value = delayTime / 1000 // Convert ms to seconds
    delayGainNode.gain.value = delayVolume / 100 // Convert percentage to 0-1

    // Connect delayed signal chain
    delayedSource.connect(delayedSlopeGen.getInputNode())
    delayedSlopeGen.getOutputNode().connect(delayNode)
    delayNode.connect(delayGainNode)
    delayGainNode.connect(delayedEQProcessor.getInputNode())
    delayedEQProcessor.getOutputNode().connect(envelopeGain)

    // Connect to destination (both signals mix at center)
    envelopeGain.connect(audioContext.destination)

    // Start both sources
    originalSource.start(startTime)
    delayedSource.start(startTime)

    // Stop after burst duration
    const stopTime = startTime + burstDurationSec
    originalSource.stop(stopTime)
    delayedSource.stop(stopTime)

    // Cleanup after burst
    setTimeout(() => {
      originalSlopeGen.dispose()
      delayedSlopeGen.dispose()
    }, (burstDurationSec + 0.1) * 1000)
  }, [delayTime, delayVolume, BURST_DURATION])

  // Animation loop for regular bursts
  const animate = useCallback(() => {
    const now = performance.now()

    if (now - lastBurstTimeRef.current >= BURST_INTERVAL) {
      lastBurstTimeRef.current = now
      playBurst()
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }, [isPlaying, playBurst, BURST_INTERVAL])

  // Start/stop playback
  useEffect(() => {
    if (isPlaying) {
      lastBurstTimeRef.current = performance.now()
      playBurst() // Play immediately
      animate()
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, animate, playBurst])

  return (
    <div className="space-y-4">
      <div className="bg-background/50 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-4">Noise Burst with Delayed Copy</h3>

        <div className="space-y-4">
          {/* Controls */}
          <div className="flex gap-2">
            <Button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={disabled}
              size="sm"
              variant="outline"
            >
              {isPlaying ? 'Stop' : 'Play'}
            </Button>

            <Button
              onClick={() => setShowEQ(!showEQ)}
              disabled={disabled}
              size="sm"
              variant="outline"
            >
              {showEQ ? 'Hide' : 'Show'} Delayed Signal EQ
            </Button>
          </div>

          {/* Delay Time Control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Delay Time</span>
              <span className="font-mono">{delayTime}ms</span>
            </div>
            <Slider
              value={[delayTime]}
              onValueChange={(value) => setDelayTime(value[0])}
              min={0}
              max={500}
              step={1}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0ms</span>
              <span>500ms</span>
            </div>
          </div>

          {/* Delayed Copy Volume Control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Delayed Copy Volume</span>
              <span className="font-mono">{delayVolume}%</span>
            </div>
            <Slider
              value={[delayVolume]}
              onValueChange={(value) => setDelayVolume(value[0])}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Status */}
          <div className="text-xs text-muted-foreground">
            <div>Status: {isPlaying ? 'Playing noise bursts every 1s' : 'Stopped'}</div>
            <div>Original: Center (full spectrum)</div>
            <div>Delayed: Center @ {delayTime}ms delay, {delayVolume}% volume{delayEQProfile && delayEQProfile.bands.length > 0 ? `, ${delayEQProfile.bands.length} EQ band(s)` : ''}</div>
          </div>

          {/* EQ Control for Delayed Signal */}
          {showEQ && (
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-medium mb-2">Delayed Signal EQ</h4>
              <div className="bg-background rounded-lg p-2">
                <FrequencyEQ
                  profileId={delayEQProfileId}
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}