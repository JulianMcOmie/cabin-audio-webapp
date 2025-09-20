"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"

// Constants matching the notch filter component
const NUM_BANDS = 20
const SLOPE_REF_FREQUENCY = 800
const MIN_AUDIBLE_FREQ = 20
const MAX_AUDIBLE_FREQ = 20000
const BAND_Q_VALUE = 1.5
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0
const TARGET_SLOPE_DB_PER_OCT = -4.5
const OUTPUT_GAIN_SCALAR = 0.3

// Frequency range for comparison (full audible spectrum)
const MIN_COMPARISON_FREQ = 20
const MAX_COMPARISON_FREQ = 20000
const DEFAULT_REFERENCE_FREQ = 1000 // 1kHz reference

interface TimbreComparisonProps {
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

export function TimbreComparison({ disabled = false }: TimbreComparisonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastBeatTimeRef = useRef(0)
  const currentStepRef = useRef(0)
  const wasPlayingRef = useRef(false)

  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [referenceFreq, setReferenceFreq] = useState(DEFAULT_REFERENCE_FREQ)
  const [adjustableFreq, setAdjustableFreq] = useState(2000) // Start at 2kHz
  const [currentStep, setCurrentStep] = useState(0) // 0-15 for the 16-step pattern (2 cycles of F-N-N-F-N-N-F-N)
  const [isReferenceFixed, setIsReferenceFixed] = useState(true)
  const [qValue, setQValue] = useState(1.5) // Q value for notch filter bandwidth (higher = narrower)
  const [mode, setMode] = useState<'alternating' | 'simultaneous'>('simultaneous') // Mode for comparison

  const BEAT_DURATION = 300 // ms per beat (increased to accommodate longer attack)
  const BURST_DURATION = 250 // ms per burst (200ms attack + 50ms release)

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
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Create pink noise buffer
  const createPinkNoiseBuffer = (audioContext: AudioContext, duration: number = 2) => {
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
  }

  // Play a burst with either full spectrum or notched frequency(ies)
  const playBurst = (frequencies: number | number[] | null, q: number = 1.5) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    const envelopeGain = audioContext.createGain()
    envelopeGain.gain.setValueAtTime(0, audioContext.currentTime)

    const attackTime = 0.2  // Increased from 0.1 to 0.2 seconds
    const releaseTime = 0.05
    const startTime = audioContext.currentTime
    const peakGain = 0.8

    envelopeGain.gain.setValueAtTime(0.001, startTime)
    envelopeGain.gain.exponentialRampToValueAtTime(peakGain, startTime + attackTime)
    envelopeGain.gain.exponentialRampToValueAtTime(0.001, startTime + attackTime + releaseTime)

    const merger = audioContext.createGain()
    merger.connect(envelopeGain)
    envelopeGain.connect(audioContext.destination)

    const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
    const noiseSource = audioContext.createBufferSource()
    noiseSource.buffer = noiseBuffer
    noiseSource.loop = true

    const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)

    if (frequencies !== null) {
      // Notch filter(s) at the specified frequency(ies)
      noiseSource.connect(slopedNoiseGen.getInputNode())

      const freqArray = Array.isArray(frequencies) ? frequencies : [frequencies]
      let lastNode: AudioNode = slopedNoiseGen.getOutputNode()

      // Chain notch filters for multiple frequencies
      freqArray.forEach(freq => {
        const notchFilter = audioContext.createBiquadFilter()
        notchFilter.type = 'notch'
        notchFilter.frequency.value = freq
        notchFilter.Q.value = q
        lastNode.connect(notchFilter)
        lastNode = notchFilter
      })

      lastNode.connect(merger)
    } else {
      // Full spectrum
      noiseSource.connect(slopedNoiseGen.getInputNode())
      slopedNoiseGen.getOutputNode().connect(merger)
    }

    noiseSource.start(startTime)
    noiseSource.stop(startTime + BURST_DURATION / 1000)

    // Clean up
    setTimeout(() => {
      slopedNoiseGen.dispose()
    }, (BURST_DURATION + 100))
  }

  // Animation loop
  const animate = () => {
    const now = performance.now()

    if (now - lastBeatTimeRef.current >= BEAT_DURATION) {
      lastBeatTimeRef.current = now

      if (mode === 'alternating') {
        // Pattern: F-N-N-F-N-N-F-N (8-beat cycle)
        // First 8 beats: reference frequency, Next 8 beats: adjustable frequency
        const step = currentStepRef.current % 16
        const isReferenceCycle = step < 8
        const beatInCycle = step % 8

        // F-N-N-F-N-N-F-N pattern (F on beats 0,3,6; N on beats 1,2,4,5,7)
        const isFullSpectrum = beatInCycle === 0 || beatInCycle === 3 || beatInCycle === 6

        if (isFullSpectrum) {
          // Full spectrum
          playBurst(null)
        } else {
          // Notched at either reference or adjustable frequency
          const frequency = isReferenceCycle ? referenceFreq : adjustableFreq
          playBurst(frequency, qValue)
        }

        currentStepRef.current = (step + 1) % 16
      } else {
        // Simultaneous mode: Both patterns play together
        // Lower notch (reference): F-N-F-N-F-N-F-N (notch on beats 1,3,5,7)
        // Higher notch (adjustable): F-N-N-F-N-N-F-N (notch on beats 1,2,4,5,7)
        const step = currentStepRef.current % 8

        const lowerNotchActive = step === 1 || step === 3 || step === 5 || step === 7
        const higherNotchActive = step === 1 || step === 2 || step === 4 || step === 5 || step === 7

        const activeNotches = []
        if (lowerNotchActive) activeNotches.push(referenceFreq)
        if (higherNotchActive) activeNotches.push(adjustableFreq)

        if (activeNotches.length === 0) {
          // Full spectrum
          playBurst(null)
        } else if (activeNotches.length === 1) {
          // Single notch
          playBurst(activeNotches[0], qValue)
        } else {
          // Both notches
          playBurst(activeNotches, qValue)
        }

        currentStepRef.current = (step + 1) % 8
      }
      setCurrentStep(currentStepRef.current)
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }

  // Start/stop playback - restart when frequencies change
  useEffect(() => {
    if (isPlaying) {
      // Cancel any existing animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      // Only reset timing when starting fresh, not when frequencies change
      if (!wasPlayingRef.current) {
        lastBeatTimeRef.current = performance.now()
        currentStepRef.current = 0
        setCurrentStep(0)
      }

      wasPlayingRef.current = true
      animate()
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      // Reset for next time
      wasPlayingRef.current = false
      currentStepRef.current = 0
      setCurrentStep(0)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, referenceFreq, adjustableFreq, qValue, mode])

  // Convert frequency to Y position (inverted: high freq at top)
  const freqToY = (freq: number, height: number) => {
    const minLog = Math.log2(MIN_COMPARISON_FREQ)
    const maxLog = Math.log2(MAX_COMPARISON_FREQ)
    const freqLog = Math.log2(freq)
    const normalized = (freqLog - minLog) / (maxLog - minLog)
    return height * (1 - normalized) // Inverted
  }

  // Convert Y position to frequency
  const yToFreq = (y: number, height: number) => {
    const normalized = 1 - (y / height) // Inverted
    const minLog = Math.log2(MIN_COMPARISON_FREQ)
    const maxLog = Math.log2(MAX_COMPARISON_FREQ)
    const freqLog = minLog + normalized * (maxLog - minLog)
    return Math.pow(2, freqLog)
  }

  // Draw the visualization
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, rect.width, rect.height)

    const columnX = rect.width / 2
    const dotRadius = 10

    // Draw frequency scale on the left
    ctx.fillStyle = isDarkMode ? "#666" : "#999"
    ctx.font = "10px monospace"
    ctx.textAlign = "right"

    const freqLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
    freqLabels.forEach(freq => {
      if (freq >= MIN_COMPARISON_FREQ && freq <= MAX_COMPARISON_FREQ) {
        const y = freqToY(freq, rect.height)
        const label = freq >= 1000 ? `${freq/1000}kHz` : `${freq}Hz`
        ctx.fillText(label, 45, y + 3)

        // Draw gridline
        ctx.strokeStyle = isDarkMode ? "#333" : "#eee"
        ctx.beginPath()
        ctx.moveTo(50, y)
        ctx.lineTo(rect.width - 20, y)
        ctx.stroke()
      }
    })

    // Draw reference dot (lower frequency)
    const refY = freqToY(referenceFreq, rect.height)
    // Active based on mode
    const isRefActive = isPlaying && (
      mode === 'alternating' ?
        (currentStep < 8 && (currentStep % 8 === 1 || currentStep % 8 === 2 || currentStep % 8 === 4 || currentStep % 8 === 5 || currentStep % 8 === 7)) :
        // Simultaneous mode: F-N-F-N-F-N-F-N (notch on beats 1,3,5,7)
        (currentStep % 8 === 1 || currentStep % 8 === 3 || currentStep % 8 === 5 || currentStep % 8 === 7)
    )

    if (isRefActive) {
      // Draw pulse
      ctx.beginPath()
      ctx.arc(columnX, refY, dotRadius * 1.8, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(34, 197, 94, 0.3)" : "rgba(22, 163, 74, 0.3)"
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(columnX, refY, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = isDarkMode ? "#22c55e" : "#16a34a" // Green for reference
    ctx.fill()

    // Label
    ctx.fillStyle = isDarkMode ? "#aaa" : "#666"
    ctx.font = "11px monospace"
    ctx.textAlign = "left"
    ctx.fillText("LOWER", columnX + 20, refY + 4)

    // Draw adjustable dot (higher frequency)
    const adjY = freqToY(adjustableFreq, rect.height)
    // Active based on mode
    const isAdjActive = isPlaying && (
      mode === 'alternating' ?
        (currentStep >= 8 && (currentStep % 8 === 1 || currentStep % 8 === 2 || currentStep % 8 === 4 || currentStep % 8 === 5 || currentStep % 8 === 7)) :
        // Simultaneous mode: F-N-N-F-N-N-F-N (notch on beats 1,2,4,5,7)
        (currentStep % 8 === 1 || currentStep % 8 === 2 || currentStep % 8 === 4 || currentStep % 8 === 5 || currentStep % 8 === 7)
    )

    if (isAdjActive) {
      // Draw pulse
      ctx.beginPath()
      ctx.arc(columnX, adjY, dotRadius * 1.8, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)"
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(columnX, adjY, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // Blue for adjustable
    ctx.fill()

    // Label
    ctx.fillText("HIGHER", columnX + 20, adjY + 4)

    // Draw status at bottom
    ctx.textAlign = "center"
    ctx.font = "12px monospace"
    ctx.fillStyle = isDarkMode ? "#888" : "#666"

    let statusText = ""
    if (isPlaying) {
      if (mode === 'alternating') {
        const isReferenceCycle = currentStep < 8
        const beatInCycle = currentStep % 8
        const isFullSpectrum = beatInCycle === 0 || beatInCycle === 3 || beatInCycle === 6

        if (isFullSpectrum) {
          statusText = "Full Spectrum"
        } else if (isReferenceCycle) {
          statusText = `Reference: ${Math.round(referenceFreq)}Hz (NOTCH)`
        } else {
          statusText = `Adjustable: ${Math.round(adjustableFreq)}Hz (NOTCH)`
        }
      } else {
        // Simultaneous mode - show which notches are active
        const step = currentStep % 8
        const lowerNotchActive = step === 1 || step === 3 || step === 5 || step === 7
        const higherNotchActive = step === 1 || step === 2 || step === 4 || step === 5 || step === 7

        if (!lowerNotchActive && !higherNotchActive) {
          statusText = "Full Spectrum"
        } else if (lowerNotchActive && higherNotchActive) {
          statusText = `Both Notches: ${Math.round(referenceFreq)}Hz & ${Math.round(adjustableFreq)}Hz`
        } else if (lowerNotchActive) {
          statusText = `Lower Notch: ${Math.round(referenceFreq)}Hz`
        } else {
          statusText = `Higher Notch: ${Math.round(adjustableFreq)}Hz`
        }
      }
    } else {
      statusText = "Click Play to start comparison"
    }
    ctx.fillText(statusText, rect.width / 2, rect.height - 10)

  }, [referenceFreq, adjustableFreq, isDarkMode, isPlaying, currentStep])

  // Handle canvas click to set reference frequency
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled || isReferenceFixed) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const y = e.clientY - rect.top
    const freq = yToFreq(y, rect.height)

    // Clamp to valid range
    const clampedFreq = Math.max(MIN_COMPARISON_FREQ, Math.min(MAX_COMPARISON_FREQ, freq))
    setReferenceFreq(Math.round(clampedFreq))
  }

  // Convert slider value (0-100) to frequency (logarithmic)
  const sliderToFreq = (value: number) => {
    const minLog = Math.log2(MIN_COMPARISON_FREQ)
    const maxLog = Math.log2(MAX_COMPARISON_FREQ)
    const freqLog = minLog + (value / 100) * (maxLog - minLog)
    return Math.pow(2, freqLog)
  }

  // Convert frequency to slider value
  const freqToSlider = (freq: number) => {
    const minLog = Math.log2(MIN_COMPARISON_FREQ)
    const maxLog = Math.log2(MAX_COMPARISON_FREQ)
    const freqLog = Math.log2(freq)
    return ((freqLog - minLog) / (maxLog - minLog)) * 100
  }

  return (
    <div className="space-y-4">
      <div className="bg-background/50 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Timbre Comparison</h3>

        <canvas
          ref={canvasRef}
          className={`w-full h-64 cursor-${isReferenceFixed ? 'default' : 'pointer'} ${disabled ? "opacity-70" : ""}`}
          onClick={handleCanvasClick}
        />

        <div className="mt-4 space-y-3">
          {/* Frequency slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Adjustable Frequency</span>
              <span className="font-mono">{Math.round(adjustableFreq)}Hz</span>
            </div>
            <Slider
              value={[freqToSlider(adjustableFreq)]}
              onValueChange={(value) => setAdjustableFreq(sliderToFreq(value[0]))}
              min={0}
              max={100}
              step={0.1}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>20Hz</span>
              <span>20kHz</span>
            </div>
          </div>

          {/* Notch bandwidth (Q) control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Notch Width (Q)</span>
              <span className="font-mono">{qValue.toFixed(1)}</span>
            </div>
            <Slider
              value={[qValue]}
              onValueChange={(value) => setQValue(value[0])}
              min={0.5}
              max={10}
              step={0.1}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Wide (0.5)</span>
              <span>Narrow (10)</span>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMode(mode === 'alternating' ? 'simultaneous' : 'alternating')}
              className="text-xs px-2 py-1 rounded border hover:bg-muted"
              disabled={disabled}
            >
              Mode: {mode === 'alternating' ? 'Alternating' : 'Simultaneous'}
            </button>
            <span className="text-xs text-muted-foreground">
              {mode === 'alternating' ? '(Ref → Adj cycles)' : '(Simultaneous patterns)'}
            </span>
          </div>

          {/* Reference frequency control */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsReferenceFixed(!isReferenceFixed)}
              className="text-xs px-2 py-1 rounded border hover:bg-muted"
            >
              Reference: {isReferenceFixed ? 'Fixed' : 'Click to set'}
            </button>
            {!isReferenceFixed && (
              <Slider
                value={[freqToSlider(referenceFreq)]}
                onValueChange={(value) => setReferenceFreq(Math.round(sliderToFreq(value[0])))}
                min={0}
                max={100}
                step={0.1}
                disabled={disabled}
                className="flex-1"
              />
            )}
            <span className="text-xs font-mono text-muted-foreground">
              {Math.round(referenceFreq)}Hz
            </span>
          </div>

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
              onClick={() => {
                // Swap frequencies
                const temp = referenceFreq
                setReferenceFreq(adjustableFreq)
                setAdjustableFreq(temp)
              }}
              disabled={disabled}
              size="sm"
              variant="outline"
            >
              Swap
            </Button>

            <Button
              onClick={() => {
                setReferenceFreq(DEFAULT_REFERENCE_FREQ)
                setAdjustableFreq(2000)
              }}
              disabled={disabled}
              size="sm"
              variant="outline"
            >
              Reset
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {mode === 'alternating' ?
              'Pattern: F-N-N-F-N-N-F-N (Ref) → F-N-N-F-N-N-F-N (Adj)' :
              'Lower: F-N-F-N-F-N-F-N | Higher: F-N-N-F-N-N-F-N (Simultaneous)'
            }
          </div>
        </div>
      </div>
    </div>
  )
}