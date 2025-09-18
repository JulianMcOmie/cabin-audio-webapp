"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

// Constants matching other components
const NUM_BANDS = 20
const SLOPE_REF_FREQUENCY = 800
const MIN_AUDIBLE_FREQ = 20
const MAX_AUDIBLE_FREQ = 20000
const BAND_Q_VALUE = 1.5
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0
const TARGET_SLOPE_DB_PER_OCT = -4.5
const OUTPUT_GAIN_SCALAR = 0.3

interface CheckerboardPatternProps {
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

export function CheckerboardPattern({ disabled = false }: CheckerboardPatternProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastBeatTimeRef = useRef(0)
  const currentBeatRef = useRef(0)

  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [rows, setRows] = useState(4)
  const [columns, setColumns] = useState(4)
  const [isInverted, setIsInverted] = useState(false)
  const [tempo, setTempo] = useState(120) // BPM
  const [currentBeat, setCurrentBeat] = useState(0)
  const [staggerMs, setStaggerMs] = useState(20) // Milliseconds delay between columns

  const BEAT_DURATION = 60000 / tempo / 2 // Convert BPM to ms per eighth note
  const BURST_DURATION = 200 // ms per burst

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

  // Calculate frequency bands for rows
  const getFrequencyBands = (numRows: number) => {
    const bands: { low: number, high: number, center: number }[] = []
    const logMin = Math.log2(MIN_AUDIBLE_FREQ)
    const logMax = Math.log2(MAX_AUDIBLE_FREQ)
    const step = (logMax - logMin) / numRows

    for (let i = 0; i < numRows; i++) {
      const lowLog = logMin + i * step
      const highLog = logMin + (i + 1) * step
      const low = Math.pow(2, lowLog)
      const high = Math.pow(2, highLog)
      const center = Math.sqrt(low * high) // Geometric mean
      bands.push({ low, high, center })
    }

    return bands
  }

  // Get panning value for column
  const getPanningForColumn = (column: number, totalColumns: number) => {
    if (totalColumns === 1) return 0
    return (2 * column / (totalColumns - 1)) - 1
  }

  // Check if a cell should be active in checkerboard pattern
  const isCellActive = (row: number, col: number, inverted: boolean) => {
    const isCheckerboard = (row + col) % 2 === 0
    return inverted ? !isCheckerboard : isCheckerboard
  }

  // Play a burst (either full spectrum or checkerboard filtered)
  const playBurst = (isFullSpectrum: boolean) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    const attackTime = 0.1
    const releaseTime = 0.05
    const startTime = audioContext.currentTime
    const peakGain = 0.8

    if (isFullSpectrum) {
      // Full spectrum: play unfiltered pink noise with column staggering
      const slopedNoiseGens: SlopedPinkNoiseGenerator[] = []

      // Create separate playback for each column with stagger
      for (let col = 0; col < columns; col++) {
        const colStartTime = startTime + (col * staggerMs) / 1000

        // Create envelope for this column
        const colEnvelope = audioContext.createGain()
        colEnvelope.gain.setValueAtTime(0, audioContext.currentTime)
        colEnvelope.gain.setValueAtTime(0.001, colStartTime)
        colEnvelope.gain.exponentialRampToValueAtTime(peakGain, colStartTime + attackTime)
        colEnvelope.gain.exponentialRampToValueAtTime(0.001, colStartTime + attackTime + releaseTime)

        // Create panner for this column
        const panning = getPanningForColumn(col, columns)
        const panner = audioContext.createStereoPanner()
        panner.pan.value = panning

        colEnvelope.connect(panner)
        panner.connect(audioContext.destination)

        // Create noise source for this column
        const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
        const noiseSource = audioContext.createBufferSource()
        noiseSource.buffer = noiseBuffer
        noiseSource.loop = true

        const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
        slopedNoiseGens.push(slopedNoiseGen)

        noiseSource.connect(slopedNoiseGen.getInputNode())
        slopedNoiseGen.getOutputNode().connect(colEnvelope)

        noiseSource.start(colStartTime)
        noiseSource.stop(colStartTime + BURST_DURATION / 1000)
      }

      // Clean up
      setTimeout(() => {
        slopedNoiseGens.forEach(gen => gen.dispose())
      }, BURST_DURATION + (columns * staggerMs) + 100)
    } else {
      // Checkerboard pattern: play filtered noise for each active cell with column stagger
      const frequencyBands = getFrequencyBands(rows)
      const slopedNoiseGens: SlopedPinkNoiseGenerator[] = []

      // Create separate playback for each column with stagger
      for (let col = 0; col < columns; col++) {
        const colStartTime = startTime + (col * staggerMs) / 1000

        // Create envelope for this column
        const colEnvelope = audioContext.createGain()
        colEnvelope.gain.setValueAtTime(0, audioContext.currentTime)
        colEnvelope.gain.setValueAtTime(0.001, colStartTime)
        colEnvelope.gain.exponentialRampToValueAtTime(peakGain, colStartTime + attackTime)
        colEnvelope.gain.exponentialRampToValueAtTime(0.001, colStartTime + attackTime + releaseTime)
        colEnvelope.connect(audioContext.destination)

        const merger = audioContext.createGain()
        merger.connect(colEnvelope)

        for (let row = 0; row < rows; row++) {
          if (!isCellActive(row, col, isInverted)) continue

          const band = frequencyBands[row]
          const panning = getPanningForColumn(col, columns)

          // Create noise source for this cell
          const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
          const noiseSource = audioContext.createBufferSource()
          noiseSource.buffer = noiseBuffer
          noiseSource.loop = true

          const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
          slopedNoiseGens.push(slopedNoiseGen)

          // Create bandpass filter for this frequency band
          const bandpass = audioContext.createBiquadFilter()
          bandpass.type = 'bandpass'
          bandpass.frequency.value = band.center
          // Calculate Q to cover the band properly
          bandpass.Q.value = band.center / (band.high - band.low)

          // Create panner for this column
          const panner = audioContext.createStereoPanner()
          panner.pan.value = panning

          // Connect: source -> slopedNoise -> bandpass -> panner -> merger
          noiseSource.connect(slopedNoiseGen.getInputNode())
          slopedNoiseGen.getOutputNode().connect(bandpass)
          bandpass.connect(panner)
          panner.connect(merger)

          noiseSource.start(colStartTime)
          noiseSource.stop(colStartTime + BURST_DURATION / 1000)
        }
      }

      // Clean up
      setTimeout(() => {
        slopedNoiseGens.forEach(gen => gen.dispose())
      }, BURST_DURATION + 100)
    }
  }

  // Animation loop for F-N-N-F-N-N-F-N pattern
  const animate = () => {
    const now = performance.now()

    if (now - lastBeatTimeRef.current >= BEAT_DURATION) {
      lastBeatTimeRef.current = now

      // F-N-N-F-N-N-F-N pattern (F on beats 0,3,6; N on beats 1,2,4,5,7)
      const beat = currentBeatRef.current % 8
      const isFullSpectrum = beat === 0 || beat === 3 || beat === 6

      playBurst(isFullSpectrum)

      currentBeatRef.current = (beat + 1) % 8
      setCurrentBeat(currentBeatRef.current)
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }

  // Start/stop playback
  useEffect(() => {
    if (isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      lastBeatTimeRef.current = performance.now()
      currentBeatRef.current = 0
      setCurrentBeat(0)
      animate()
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      currentBeatRef.current = 0
      setCurrentBeat(0)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, rows, columns, isInverted, tempo, staggerMs])

  // Draw the checkerboard visualization
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

    const cellWidth = rect.width / columns
    const cellHeight = rect.height / rows

    // Draw grid cells
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = col * cellWidth
        const y = row * cellHeight
        const isActive = isCellActive(row, col, isInverted)

        // Draw cell background
        if (isActive) {
          // Active cell - show with color
          const isCurrentlyPlaying = isPlaying && currentBeat !== 0 && currentBeat !== 3 && currentBeat !== 6

          if (isCurrentlyPlaying) {
            // Pulsing effect when playing
            ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7"
            ctx.globalAlpha = 0.8
          } else {
            ctx.fillStyle = isDarkMode ? "#52525b" : "#cbd5e1"
            ctx.globalAlpha = 1
          }
        } else {
          // Inactive cell - lighter color
          ctx.fillStyle = isDarkMode ? "#27272a" : "#f1f5f9"
          ctx.globalAlpha = 1
        }

        ctx.fillRect(x, y, cellWidth, cellHeight)

        // Draw cell border
        ctx.strokeStyle = isDarkMode ? "#404040" : "#e2e8f0"
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, cellWidth, cellHeight)
      }
    }

    // Draw frequency labels on the left
    ctx.fillStyle = isDarkMode ? "#888" : "#666"
    ctx.font = "10px monospace"
    ctx.textAlign = "right"
    ctx.globalAlpha = 1

    const frequencyBands = getFrequencyBands(rows)
    frequencyBands.forEach((band, i) => {
      const y = (i + 0.5) * cellHeight
      const label = band.center >= 1000 ? `${(band.center/1000).toFixed(1)}k` : `${Math.round(band.center)}`
      ctx.fillText(label + "Hz", -5, y + 3)
    })

    // Draw beat indicator at bottom
    if (isPlaying) {
      ctx.textAlign = "center"
      ctx.font = "12px monospace"
      const beat = currentBeat % 8
      const pattern = ['F', 'N', 'N', 'F', 'N', 'N', 'F', 'N']
      const beatText = pattern[beat]
      const isFullSpectrum = beat === 0 || beat === 3 || beat === 6

      ctx.fillStyle = isFullSpectrum ?
        (isDarkMode ? "#22c55e" : "#16a34a") :
        (isDarkMode ? "#38bdf8" : "#0284c7")

      ctx.fillText(`Beat ${beat + 1}: ${beatText}`, rect.width / 2, rect.height + 15)
    }

  }, [rows, columns, isInverted, isDarkMode, isPlaying, currentBeat])

  return (
    <div className="space-y-4">
      <div className="bg-background/50 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Checkerboard Pattern</h3>

        <div className="relative">
          <canvas
            ref={canvasRef}
            className={`w-full aspect-square ${disabled ? "opacity-70" : ""}`}
          />
        </div>

        <div className="mt-4 space-y-3">
          {/* Grid size controls */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Rows</span>
                <span className="font-mono">{rows}</span>
              </div>
              <Slider
                value={[rows]}
                onValueChange={(value) => setRows(value[0])}
                min={2}
                max={10}
                step={1}
                disabled={disabled || isPlaying}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Columns</span>
                <span className="font-mono">{columns}</span>
              </div>
              <Slider
                value={[columns]}
                onValueChange={(value) => setColumns(value[0])}
                min={2}
                max={10}
                step={1}
                disabled={disabled || isPlaying}
                className="w-full"
              />
            </div>
          </div>

          {/* Tempo control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tempo</span>
              <span className="font-mono">{tempo} BPM</span>
            </div>
            <Slider
              value={[tempo]}
              onValueChange={(value) => setTempo(value[0])}
              min={60}
              max={180}
              step={5}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Column stagger control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Column Stagger</span>
              <span className="font-mono">{staggerMs} ms</span>
            </div>
            <Slider
              value={[staggerMs]}
              onValueChange={(value) => setStaggerMs(value[0])}
              min={0}
              max={100}
              step={5}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Invert pattern toggle */}
          <div className="flex items-center space-x-2">
            <Switch
              id="invert-pattern"
              checked={isInverted}
              onCheckedChange={setIsInverted}
              disabled={disabled || isPlaying}
            />
            <Label htmlFor="invert-pattern" className="text-sm">
              Invert Pattern
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
          </div>

          <div className="text-xs text-muted-foreground">
            Pattern: F-N-N-F-N-N-F-N (F = Full Spectrum, N = Checkerboard)
          </div>
        </div>
      </div>
    </div>
  )
}