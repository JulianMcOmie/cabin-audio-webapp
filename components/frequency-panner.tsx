"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { CrossfeedPanner } from "@/lib/audio/crossfeed-panner"

// Constants matching other components
const NUM_BANDS = 20
const SLOPE_REF_FREQUENCY = 800
const MIN_AUDIBLE_FREQ = 20
const MAX_AUDIBLE_FREQ = 20000
const BAND_Q_VALUE = 1.5
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0
const TARGET_SLOPE_DB_PER_OCT = -4.5
const OUTPUT_GAIN_SCALAR = 0.3

interface FrequencyPannerProps {
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

export function FrequencyPanner({ disabled = false }: FrequencyPannerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastBeatTimeRef = useRef(0)
  const beatPositionRef = useRef(0)
  const frequencyRef = useRef(1000)
  const panningRef = useRef(0)

  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [frequency, setFrequency] = useState(1000) // Hz
  const [panning, setPanning] = useState(0) // -1 to 1
  const [isDragging, setIsDragging] = useState(false)
  const [beatPosition, setBeatPosition] = useState(0)
  const [isNotchedState, setIsNotchedState] = useState(false)
  const [notchBandwidth, setNotchBandwidth] = useState(4) // Bandwidth multiplier for notch
  const [notchMethod, setNotchMethod] = useState<'split' | 'bandstop'>('split') // Toggle between methods
  const [notchQ, setNotchQ] = useState(8) // Q factor for bandstop notch (higher = narrower)
  const [useCrossfeed, setUseCrossfeed] = useState(false) // Toggle between crossfeed and normal panning

  const BEAT_DURATION = 200 // ms per beat
  const BURST_DURATION = 150 // ms per burst

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

  // Play a burst with frequency gap (notch) or full spectrum
  const playBurst = (hasNotch: boolean, currentFreq: number, currentPan: number) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    const envelopeGain = audioContext.createGain()
    envelopeGain.gain.setValueAtTime(0, audioContext.currentTime)

    const attackTime = 0.1
    const releaseTime = 0.05
    const startTime = audioContext.currentTime
    const peakGain = 0.8

    envelopeGain.gain.setValueAtTime(0.001, startTime)
    envelopeGain.gain.exponentialRampToValueAtTime(peakGain, startTime + attackTime)
    envelopeGain.gain.exponentialRampToValueAtTime(0.001, startTime + attackTime + releaseTime)

    // Create merger node
    const merger = audioContext.createGain()
    merger.connect(envelopeGain)

    // Add panning (crossfeed or standard) - use current panning value
    let pannerCleanup: (() => void) | null = null

    if (useCrossfeed) {
      const crossfeedPanner = new CrossfeedPanner(audioContext, currentPan)
      envelopeGain.connect(crossfeedPanner.getInputNode())
      crossfeedPanner.connect(audioContext.destination)
      pannerCleanup = () => crossfeedPanner.dispose()
    } else {
      const panner = audioContext.createStereoPanner()
      panner.pan.value = currentPan
      envelopeGain.connect(panner)
      panner.connect(audioContext.destination)
    }

    const slopedNoiseGens: SlopedPinkNoiseGenerator[] = []

    if (hasNotch) {
      if (notchMethod === 'bandstop') {
        // Method 2: Use bandstop (notch) filter for a deep, precise notch
        const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
        const noiseSource = audioContext.createBufferSource()
        noiseSource.buffer = noiseBuffer
        noiseSource.loop = true

        const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
        slopedNoiseGens.push(slopedNoiseGen)

        // Create a bandstop (notch) filter
        const notchFilter = audioContext.createBiquadFilter()
        notchFilter.type = 'notch'
        notchFilter.frequency.value = currentFreq
        notchFilter.Q.value = notchQ // Higher Q = narrower notch

        // Optional: Add a second notch for more attenuation
        const notchFilter2 = audioContext.createBiquadFilter()
        notchFilter2.type = 'notch'
        notchFilter2.frequency.value = currentFreq
        notchFilter2.Q.value = notchQ * 1.5 // Slightly different Q for deeper notch

        // Connect: source -> slopedNoise -> notch1 -> notch2 -> merger
        noiseSource.connect(slopedNoiseGen.getInputNode())
        slopedNoiseGen.getOutputNode().connect(notchFilter)
        notchFilter.connect(notchFilter2)
        notchFilter2.connect(merger)

        noiseSource.start(startTime)
        noiseSource.stop(startTime + BURST_DURATION / 1000)

      } else {
        // Method 1: Original split method using lowpass and highpass filters
        // Path 1: Low frequencies (everything below the notch)
        const noiseBuffer1 = createPinkNoiseBuffer(audioContext, 1.0)
        const noiseSource1 = audioContext.createBufferSource()
        noiseSource1.buffer = noiseBuffer1
        noiseSource1.loop = true

        const slopedNoiseGen1 = new SlopedPinkNoiseGenerator(audioContext)
        slopedNoiseGens.push(slopedNoiseGen1)

        const lowpass = audioContext.createBiquadFilter()
        lowpass.type = 'lowpass'
        lowpass.frequency.value = currentFreq / notchBandwidth
        lowpass.Q.value = 1.0

        noiseSource1.connect(slopedNoiseGen1.getInputNode())
        slopedNoiseGen1.getOutputNode().connect(lowpass)
        lowpass.connect(merger)

        // Path 2: High frequencies (everything above the notch)
        const noiseBuffer2 = createPinkNoiseBuffer(audioContext, 1.0)
        const noiseSource2 = audioContext.createBufferSource()
        noiseSource2.buffer = noiseBuffer2
        noiseSource2.loop = true

        const slopedNoiseGen2 = new SlopedPinkNoiseGenerator(audioContext)
        slopedNoiseGens.push(slopedNoiseGen2)

        const highpass = audioContext.createBiquadFilter()
        highpass.type = 'highpass'
        highpass.frequency.value = currentFreq * notchBandwidth
        highpass.Q.value = 1.0

        noiseSource2.connect(slopedNoiseGen2.getInputNode())
        slopedNoiseGen2.getOutputNode().connect(highpass)
        highpass.connect(merger)

        // Start both sources
        noiseSource1.start(startTime)
        noiseSource1.stop(startTime + BURST_DURATION / 1000)
        noiseSource2.start(startTime)
        noiseSource2.stop(startTime + BURST_DURATION / 1000)
      }

    } else {
      // Full spectrum
      const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
      const noiseSource = audioContext.createBufferSource()
      noiseSource.buffer = noiseBuffer
      noiseSource.loop = true

      const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
      slopedNoiseGens.push(slopedNoiseGen)

      noiseSource.connect(slopedNoiseGen.getInputNode())
      slopedNoiseGen.getOutputNode().connect(merger)

      noiseSource.start(startTime)
      noiseSource.stop(startTime + BURST_DURATION / 1000)
    }

    setTimeout(() => {
      slopedNoiseGens.forEach(gen => gen.dispose())
      if (pannerCleanup) pannerCleanup()
    }, (BURST_DURATION + 100))
  }

  // Animation loop for F-N-N-F-N-N-F-N pattern
  const animate = () => {
    const now = performance.now()

    if (now - lastBeatTimeRef.current >= BEAT_DURATION) {
      lastBeatTimeRef.current = now

      // F-N-N-F-N-N-F-N pattern (positions 0,3,6 are full spectrum)
      const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

      // Always play bursts, passing current frequency and panning values from refs
      playBurst(shouldBeNotched, frequencyRef.current, panningRef.current)

      beatPositionRef.current = (beatPositionRef.current + 1) % 8
      setBeatPosition(beatPositionRef.current)
      setIsNotchedState(shouldBeNotched)
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }

  // Start/stop playback
  useEffect(() => {
    if (isPlaying) {
      lastBeatTimeRef.current = performance.now()
      beatPositionRef.current = 0
      setBeatPosition(0)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Convert coordinates to frequency and panning
  const coordsToValues = (x: number, y: number, width: number, height: number) => {
    // X axis: panning (-1 to 1)
    const pan = (x / width) * 2 - 1

    // Y axis: frequency (logarithmic, inverted so high freq is at top)
    const normalizedY = 1 - (y / height)
    const minLog = Math.log2(MIN_AUDIBLE_FREQ)
    const maxLog = Math.log2(MAX_AUDIBLE_FREQ)
    const freqLog = minLog + normalizedY * (maxLog - minLog)
    const freq = Math.pow(2, freqLog)

    return { pan: Math.max(-1, Math.min(1, pan)), freq }
  }

  // Convert values to coordinates
  const valuesToCoords = (freq: number, pan: number, width: number, height: number) => {
    // Panning to X
    const x = ((pan + 1) / 2) * width

    // Frequency to Y (inverted)
    const minLog = Math.log2(MIN_AUDIBLE_FREQ)
    const maxLog = Math.log2(MAX_AUDIBLE_FREQ)
    const freqLog = Math.log2(freq)
    const normalizedY = (freqLog - minLog) / (maxLog - minLog)
    const y = (1 - normalizedY) * height

    return { x, y }
  }

  // Handle mouse/touch events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const { pan, freq } = coordsToValues(x, y, rect.width, rect.height)
    setPanning(pan)
    setFrequency(freq)
    frequencyRef.current = freq
    panningRef.current = pan
    setIsDragging(true)

    // Auto-start pattern playback if not already playing
    if (!isPlaying) {
      setIsPlaying(true)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging || disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const { pan, freq } = coordsToValues(x, y, rect.width, rect.height)
    setPanning(pan)
    setFrequency(freq)
    frequencyRef.current = freq
    panningRef.current = pan
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  // Draw visualization
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

    // Draw background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, rect.height)
    if (isDarkMode) {
      gradient.addColorStop(0, "#0a0a0a")
      gradient.addColorStop(1, "#1a1a1a")
    } else {
      gradient.addColorStop(0, "#f8f8f8")
      gradient.addColorStop(1, "#e8e8e8")
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, rect.width, rect.height)

    // Draw frequency gridlines
    ctx.strokeStyle = isDarkMode ? "#333" : "#ddd"
    ctx.lineWidth = 0.5
    ctx.font = "10px monospace"
    ctx.fillStyle = isDarkMode ? "#666" : "#999"
    ctx.textAlign = "left"

    const freqLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
    freqLabels.forEach(freq => {
      const { y } = valuesToCoords(freq, 0, rect.width, rect.height)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()

      const label = freq >= 1000 ? `${freq/1000}k` : `${freq}`
      ctx.fillText(label, 5, y - 3)
    })

    // Draw panning gridlines
    ctx.textAlign = "center"
    ctx.textBaseline = "top"

    const panLabels = [-1, -0.5, 0, 0.5, 1]
    panLabels.forEach(pan => {
      const { x } = valuesToCoords(1000, pan, rect.width, rect.height)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()

      const label = pan === 0 ? "C" : pan < 0 ? "L" : "R"
      ctx.fillText(label, x, rect.height - 15)
    })

    // Draw the dot
    const { x, y } = valuesToCoords(frequency, panning, rect.width, rect.height)
    const dotRadius = 12

    // Draw pulse if playing and on a notched beat
    if (isPlaying && isNotchedState) {
      const pulseSize = 1.5 + Math.sin(Date.now() / 100) * 0.3
      ctx.beginPath()
      ctx.arc(x, y, dotRadius * pulseSize, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)"
      ctx.fill()
    }

    // Draw the main dot
    ctx.beginPath()
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7"
    ctx.fill()

    // Draw dot border
    ctx.strokeStyle = isDarkMode ? "#1e40af" : "#1e3a8a"
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw status text
    ctx.fillStyle = isDarkMode ? "#aaa" : "#666"
    ctx.font = "12px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "bottom"

    const freqText = frequency >= 1000 ? `${(frequency/1000).toFixed(1)}kHz` : `${Math.round(frequency)}Hz`
    const panText = panning === 0 ? "Center" : panning < 0 ? `${Math.round(Math.abs(panning * 100))}% Left` : `${Math.round(panning * 100)}% Right`

    ctx.fillText(`${freqText} | ${panText}`, rect.width / 2, rect.height - 20)

    if (isPlaying) {
      const pattern = ["FULL", "GAP", "GAP", "FULL", "GAP", "GAP", "FULL", "GAP"]
      ctx.fillText(`Pattern: F-N-N-F-N-N-F-N | Beat ${beatPosition + 1}/8 (${pattern[beatPosition]})`, rect.width / 2, rect.height - 5)
    }

  }, [frequency, panning, isDarkMode, isPlaying, beatPosition, isNotchedState])

  return (
    <div className="space-y-4">
      <div className="bg-background/50 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Frequency Panner</h3>

        <canvas
          ref={canvasRef}
          className={`w-full h-80 cursor-crosshair rounded ${disabled ? "opacity-70" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        <div className="mt-4 space-y-3">
          {/* Notch method toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Notch Method:</span>
            <div className="flex gap-2">
              <button
                onClick={() => setNotchMethod('split')}
                className={`px-3 py-1 text-xs rounded border ${
                  notchMethod === 'split'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                }`}
                disabled={disabled}
              >
                Split (Wide)
              </button>
              <button
                onClick={() => setNotchMethod('bandstop')}
                className={`px-3 py-1 text-xs rounded border ${
                  notchMethod === 'bandstop'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                }`}
                disabled={disabled}
              >
                Bandstop (Precise)
              </button>
            </div>
          </div>

          {/* Notch width control - different for each method */}
          {notchMethod === 'split' ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Gap Width</span>
                <span className="font-mono">{notchBandwidth.toFixed(1)}x</span>
              </div>
              <Slider
                value={[notchBandwidth]}
                onValueChange={(value) => setNotchBandwidth(value[0])}
                min={1}
                max={8}
                step={0.5}
                disabled={disabled}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Narrow</span>
                <span>Wide</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Notch Q (Width)</span>
                <span className="font-mono">Q:{notchQ.toFixed(1)}</span>
              </div>
              <Slider
                value={[notchQ]}
                onValueChange={(value) => setNotchQ(value[0])}
                min={0.5}
                max={20}
                step={0.5}
                disabled={disabled}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Wide (0.5)</span>
                <span>Narrow (20)</span>
              </div>
            </div>
          )}

          {/* Manual frequency input */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-20">Frequency:</span>
            <input
              type="number"
              min="20"
              max="20000"
              value={Math.round(frequency)}
              onChange={(e) => {
                const newFreq = Math.max(20, Math.min(20000, parseInt(e.target.value) || 1000))
                setFrequency(newFreq)
                frequencyRef.current = newFreq
              }}
              className="flex-1 px-2 py-1 text-sm rounded border bg-background"
              disabled={disabled}
            />
            <span className="text-xs text-muted-foreground w-12">Hz</span>
          </div>

          {/* Manual panning input */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-20">Panning:</span>
            <input
              type="range"
              min="-100"
              max="100"
              value={Math.round(panning * 100)}
              onChange={(e) => {
                const newPan = parseInt(e.target.value) / 100
                setPanning(newPan)
                panningRef.current = newPan
              }}
              className="flex-1"
              disabled={disabled}
            />
            <span className="text-xs font-mono text-muted-foreground w-12">
              {Math.round(panning * 100)}%
            </span>
          </div>

          {/* Crossfeed toggle */}
          <div className="flex items-center space-x-2 mt-3">
            <Switch
              id="use-crossfeed-panner"
              checked={useCrossfeed}
              onCheckedChange={setUseCrossfeed}
              disabled={disabled || isPlaying}
            />
            <Label htmlFor="use-crossfeed-panner" className="text-sm">
              Crossfeed Panning
            </Label>
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
                setFrequency(1000)
                setPanning(0)
                setNotchBandwidth(4)
                frequencyRef.current = 1000
                panningRef.current = 0
              }}
              disabled={disabled}
              size="sm"
              variant="outline"
            >
              Reset
            </Button>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>Drag the dot to adjust frequency (vertical) and panning (horizontal).</div>
            <div>Pattern: Full spectrum on beats 1, 4, 7 | Frequency gap on beats 2, 3, 5, 6, 8</div>
            <div>
              {notchMethod === 'split'
                ? 'Split mode: Creates a wide gap by splitting audio into low and high bands'
                : 'Bandstop mode: Creates a precise, deep notch at the exact frequency'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}