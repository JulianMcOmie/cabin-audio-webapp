"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"

// Constants matching dotGridAudio.ts
const NUM_BANDS = 20 // Number of frequency bands for shaping
const SLOPE_REF_FREQUENCY = 800 // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20 // Hz
const MAX_AUDIBLE_FREQ = 20000 // Hz
const BAND_Q_VALUE = 1.5 // Q value for the bandpass filters
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0 // Inherent slope of pink noise
const TARGET_SLOPE_DB_PER_OCT = -4.5 // Target slope we want
const OUTPUT_GAIN_SCALAR = 0.3 // Reduced output gain to prevent clipping

interface NotchFilterNoiseGridProps {
  gridSize?: number
  columnCount?: number
  disabled?: boolean
}

// Class to generate sloped pink noise exactly like dotGridAudio
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

      // Connect: input -> filter -> gain -> output
      this.inputGainNode.connect(filter)
      filter.connect(gain)
      gain.connect(this.outputGainNode)
    }

    // Set the slope
    this.setSlope(TARGET_SLOPE_DB_PER_OCT)
  }

  public getInputNode(): GainNode {
    return this.inputGainNode
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode
  }

  public setSlope(targetOverallSlopeDbPerOctave: number): void {
    // Calculate shaping slope relative to the inherent pink noise slope
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

export function NotchFilterNoiseGrid({
  gridSize: initialGridSize = 5,
  columnCount: initialColumnCount = 5,
  disabled = false
}: NotchFilterNoiseGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [selectedDots, setSelectedDots] = useState<Map<number, Set<number>>>(new Map()) // column -> Set of rows
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeColumn, setActiveColumn] = useState(0)
  const [gridSize, setGridSize] = useState(initialGridSize)
  const [columnCount, setColumnCount] = useState(initialColumnCount)
  const [playbackMode, setPlaybackMode] = useState<'sequential' | 'simultaneous'>('sequential')
  const [currentDotIndex, setCurrentDotIndex] = useState(0) // Which dot in the sequence
  const [beatPosition, setBeatPosition] = useState(0) // Current position in 8-beat pattern (0-7)
  const beatPositionRef = useRef(0) // Use ref to avoid closure issues
  const currentDotIndexRef = useRef(0) // Use ref to avoid closure issues
  const [isNotchedState, setIsNotchedState] = useState(true) // true = notched, false = full spectrum
  const animationFrameRef = useRef<number | null>(null)
  const lastBeatTimeRef = useRef(0)
  const BEAT_DURATION = 200 // ms per beat - 150ms burst + 50ms gap
  const BURST_DURATION = 150 // ms per burst - 100ms attack + 50ms release
  const STAGGER_DELAY = 20 // ms stagger between columns

  // Set up observer to detect theme changes
  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"))

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const newIsDarkMode = document.documentElement.classList.contains("dark")
          setIsDarkMode(newIsDarkMode)
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => {
      observer.disconnect()
    }
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

  // Calculate frequency for a given row (exponential spacing) - INVERTED
  const getFrequencyForRow = (row: number) => {
    // Scale frequency range based on grid size
    // Smaller grids: 200Hz-8kHz, Larger grids: approach 20Hz-20kHz
    const gridScale = (gridSize - 3) / (9 - 3) // Normalize 3-9 to 0-1

    // Interpolate min frequency: 200Hz for size 3, down to 20Hz for size 9
    const minFreq = 200 * Math.pow(20/200, gridScale) // Exponential interpolation

    // Interpolate max frequency: 8kHz for size 3, up to 20kHz for size 9
    const maxFreq = 8000 * Math.pow(20000/8000, gridScale) // Exponential interpolation

    // Invert: top row (0) = high freq, bottom row = low freq
    const normalizedPosition = 1 - (row / (gridSize - 1))
    return minFreq * Math.pow(maxFreq / minFreq, normalizedPosition)
  }

  // Calculate panning position for a column (-1 to +1)
  const getPanningForColumn = (column: number) => {
    if (columnCount <= 1) return 0
    // Map column index to panning: leftmost = -1, center = 0, rightmost = +1
    return (2 * column / (columnCount - 1)) - 1
  }

  // Create pink noise buffer using the exact same method as dotGridAudio
  const createPinkNoiseBuffer = (audioContext: AudioContext, duration: number = 2) => {
    const bufferSize = audioContext.sampleRate * duration
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
    const data = buffer.getChannelData(0)

    // Paul Kellet's pink noise algorithm - exact same as dotGridAudio
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

    // Normalize to prevent clipping
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

  // Play a burst for a column with proper sloped noise and notch filtering
  const playColumnBurst = (
    column: number,
    hasNotch: boolean,
    notchFrequency: number | null
  ) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    // Create gain node for envelope (shared by both paths)
    const envelopeGain = audioContext.createGain()
    envelopeGain.gain.setValueAtTime(0, audioContext.currentTime)

    // Short, punchy envelope
    const attackTime = 0.1  // 100ms attack - faster
    const releaseTime = 0.05 // 50ms release - very short
    const startTime = audioContext.currentTime + (column * STAGGER_DELAY) / 1000
    const peakGain = 0.8 // Same as dotGridAudio (ENVELOPE_MAX_GAIN * 0.8)

    // Create envelope matching dotGridAudio
    envelopeGain.gain.setValueAtTime(0.001, startTime) // Start just above zero for exponential
    envelopeGain.gain.exponentialRampToValueAtTime(peakGain, startTime + attackTime)
    envelopeGain.gain.exponentialRampToValueAtTime(0.001, startTime + attackTime + releaseTime)

    // Create merger node to sum the two signal paths
    const merger = audioContext.createGain()
    merger.connect(envelopeGain)

    // Add panning for this column
    const panner = audioContext.createStereoPanner()
    panner.pan.value = getPanningForColumn(column)
    envelopeGain.connect(panner)
    panner.connect(audioContext.destination)

    const slopedNoiseGens: SlopedPinkNoiseGenerator[] = []

    if (hasNotch && notchFrequency !== null) {
      // CREATE TWO SEPARATE PATHS: LOWPASS AND HIGHPASS

      // Path 1: Low frequencies (everything below the notch frequency)
      const noiseBuffer1 = createPinkNoiseBuffer(audioContext, 1.0)
      const noiseSource1 = audioContext.createBufferSource()
      noiseSource1.buffer = noiseBuffer1
      noiseSource1.loop = true

      const slopedNoiseGen1 = new SlopedPinkNoiseGenerator(audioContext)
      slopedNoiseGens.push(slopedNoiseGen1)

      // Lowpass filter - roll off frequencies above the notch
      const lowpass = audioContext.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = notchFrequency * 0.25 // Much lower cutoff for even wider gap
      lowpass.Q.value = 1.0 // Gentler rolloff for smoother transition

      // Connect path 1: source -> slopedNoise -> lowpass -> merger
      noiseSource1.connect(slopedNoiseGen1.getInputNode())
      slopedNoiseGen1.getOutputNode().connect(lowpass)
      lowpass.connect(merger)

      // Path 2: High frequencies (everything above the notch frequency)
      const noiseBuffer2 = createPinkNoiseBuffer(audioContext, 1.0)
      const noiseSource2 = audioContext.createBufferSource()
      noiseSource2.buffer = noiseBuffer2
      noiseSource2.loop = true

      const slopedNoiseGen2 = new SlopedPinkNoiseGenerator(audioContext)
      slopedNoiseGens.push(slopedNoiseGen2)

      // Highpass filter - roll off frequencies below the notch
      const highpass = audioContext.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = notchFrequency * 4.0 // Much higher cutoff for even wider gap
      highpass.Q.value = 1.0 // Gentler rolloff for smoother transition

      // Connect path 2: source -> slopedNoise -> highpass -> merger
      noiseSource2.connect(slopedNoiseGen2.getInputNode())
      slopedNoiseGen2.getOutputNode().connect(highpass)
      highpass.connect(merger)

      // Start both sources
      noiseSource1.start(startTime)
      noiseSource1.stop(startTime + BURST_DURATION / 1000)
      noiseSource2.start(startTime)
      noiseSource2.stop(startTime + BURST_DURATION / 1000)

    } else {
      // FULL SPECTRUM: Single path with no filtering
      const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
      const noiseSource = audioContext.createBufferSource()
      noiseSource.buffer = noiseBuffer
      noiseSource.loop = true

      const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
      slopedNoiseGens.push(slopedNoiseGen)

      // Connect: source -> slopedNoise -> merger
      noiseSource.connect(slopedNoiseGen.getInputNode())
      slopedNoiseGen.getOutputNode().connect(merger)

      // Start source
      noiseSource.start(startTime)
      noiseSource.stop(startTime + BURST_DURATION / 1000)
    }

    // Note: envelope is already connected to panner -> destination above

    // Clean up after playback
    setTimeout(() => {
      slopedNoiseGens.forEach(gen => gen.dispose())
    }, (startTime + BURST_DURATION / 1000 + 1) * 1000)
  }

  // Get all selected dots as an array
  const getAllSelectedDots = () => {
    const allDots: {col: number, row: number}[] = []
    selectedDots.forEach((rows, col) => {
      rows.forEach(row => {
        allDots.push({col, row})
      })
    })
    return allDots.sort((a, b) => a.col === b.col ? a.row - b.row : a.col - b.col)
  }

  // Animation loop for playback
  const animate = () => {
    const now = performance.now()

    if (now - lastBeatTimeRef.current >= BEAT_DURATION) {
      lastBeatTimeRef.current = now

      const allDots = getAllSelectedDots()
      const totalDotsSelected = allDots.length

      if (totalDotsSelected === 0) return

      // Check if we're in multi-dot mode (multiple dots, potentially in same column)
      const hasMultipleDots = totalDotsSelected > 1
      const hasDotsInSameColumn = Array.from(selectedDots.values()).some(rows => rows.size > 1)
      const isMultiDotMode = hasMultipleDots || hasDotsInSameColumn


      if (isMultiDotMode) {
        // Multi-dot mode: play one dot at a time with pattern F-N-N-F-N-N-F-N (8 beats)
        const currentDot = allDots[currentDotIndexRef.current]
        const notchFreq = getFrequencyForRow(currentDot.row)

        // Pattern: F-N-N-F-N-N-F-N (positions 0,3,6 are full spectrum)
        const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)


        // Play only the current dot's column with appropriate filter
        playColumnBurst(currentDot.col, shouldBeNotched, shouldBeNotched ? notchFreq : null)

        // Update states for next beat
        beatPositionRef.current = beatPositionRef.current + 1
        if (beatPositionRef.current >= 8) {
          // Completed the 8-beat pattern, move to next dot
          beatPositionRef.current = 0
          currentDotIndexRef.current = (currentDotIndexRef.current + 1) % totalDotsSelected
          setBeatPosition(0)
          setCurrentDotIndex(currentDotIndexRef.current)
          setIsNotchedState(true) // Reset for visual feedback
        } else {
          setBeatPosition(beatPositionRef.current)
          // Update isNotchedState for visual feedback
          const nextShouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)
          setIsNotchedState(nextShouldBeNotched)
        }
      } else if (totalDotsSelected === 1) {
        // Single dot mode with F-N-N-F-N-N-F-N pattern
        const dot = allDots[0]
        const notchFreq = getFrequencyForRow(dot.row)
        const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

        playColumnBurst(dot.col, shouldBeNotched, shouldBeNotched ? notchFreq : null)

        // Update beat position
        beatPositionRef.current = (beatPositionRef.current + 1) % 8
        setBeatPosition(beatPositionRef.current)
        setIsNotchedState(!(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6))
      } else if (playbackMode === 'simultaneous') {
        // Simultaneous mode with F-N-N-F-N-N-F-N pattern
        const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

        selectedDots.forEach((rows, col) => {
          if (rows.size > 0) {
            const row = Array.from(rows)[0] // Take first if multiple
            const notchFreq = getFrequencyForRow(row)
            playColumnBurst(col, shouldBeNotched, shouldBeNotched ? notchFreq : null)
          }
        })

        // Update beat position
        beatPositionRef.current = (beatPositionRef.current + 1) % 8
        setBeatPosition(beatPositionRef.current)
        setIsNotchedState(!(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6))
      } else {
        // Sequential mode with F-N-N-F-N-N-F-N pattern
        const columnsWithDots = Array.from(selectedDots.keys()).sort((a, b) => a - b)
        if (columnsWithDots.length > 0) {
          const currentCol = columnsWithDots[activeColumn % columnsWithDots.length]

          // Apply F-N-N-F-N-N-F-N pattern (positions 0,3,6 are full spectrum)
          const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

          selectedDots.forEach((rows, col) => {
            if (rows.size > 0) {
              const row = Array.from(rows)[0]
              const notchFreq = getFrequencyForRow(row)
              const applyNotch = col !== currentCol ? false : shouldBeNotched
              playColumnBurst(col, applyNotch, applyNotch ? notchFreq : null)
            }
          })

          // Update beat position
          beatPositionRef.current = (beatPositionRef.current + 1) % 8
          setBeatPosition(beatPositionRef.current)

          // Move to next column after 8 beats
          if (beatPositionRef.current === 0) {
            setActiveColumn((activeColumn + 1) % columnsWithDots.length)
          }

          // Update visual state
          setIsNotchedState(!(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6))
        }
      }
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }

  // Start/stop playback
  useEffect(() => {
    if (isPlaying && selectedDots.size > 0) {
      lastBeatTimeRef.current = performance.now()
      // Reset refs when starting playback
      beatPositionRef.current = 0
      currentDotIndexRef.current = 0
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
  }, [isPlaying, selectedDots, activeColumn])

  // Draw grid
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

    const dotRadius = 8
    const hSpacing = rect.width / columnCount
    const vSpacing = rect.height / gridSize

    // Draw dots
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < columnCount; x++) {
        const centerX = (x + 0.5) * hSpacing
        const centerY = (y + 0.5) * vSpacing

        const columnRows = selectedDots.get(x)
        const isSelected = columnRows ? columnRows.has(y) : false

        // Determine if this dot is currently active
        let isActive = false
        if (isPlaying && isSelected) {
          const allDots = getAllSelectedDots()
          const totalDots = allDots.length

          if (totalDots > 1 || Array.from(selectedDots.values()).some(rows => rows.size > 1)) {
            // Multi-dot mode: only the current dot pulses
            const currentDot = allDots[currentDotIndex]
            isActive = currentDot && currentDot.col === x && currentDot.row === y && !isNotchedState
          } else if (totalDots === 1) {
            // Single dot mode
            isActive = activeColumn === 1
          } else if (playbackMode === 'simultaneous') {
            // Simultaneous mode
            isActive = activeColumn === 1
          } else {
            // Sequential mode
            isActive = x === activeColumn
          }
        }

        // Draw pulse for active dot
        if (isActive) {
          const pulseSize = 1.5 + Math.sin(Date.now() / 100) * 0.3
          ctx.beginPath()
          ctx.arc(centerX, centerY, dotRadius * pulseSize, 0, Math.PI * 2)
          ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)"
          ctx.fill()
        }

        // Draw dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2)

        if (isSelected && !disabled) {
          ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7"
        } else {
          ctx.fillStyle = disabled
            ? isDarkMode ? "#27272a" : "#e2e8f0"
            : isDarkMode ? "#52525b" : "#cbd5e1"
        }

        ctx.fill()
      }
    }

    // Request next frame if playing
    if (isPlaying && selectedDots.size > 0) {
      requestAnimationFrame(() => {
        // Force re-render for animation
        const forceUpdate = () => {
          const canvas = canvasRef.current
          if (canvas) {
            canvas.style.transform = `translateZ(0)`
          }
        }
        forceUpdate()
      })
    }
  }, [selectedDots, gridSize, columnCount, disabled, isDarkMode, isPlaying, activeColumn, playbackMode])

  // Handle canvas clicks
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const gridX = Math.floor(x * columnCount)
    const gridY = Math.floor(y * gridSize)

    if (gridX >= 0 && gridX < columnCount && gridY >= 0 && gridY < gridSize) {
      const newSelectedDots = new Map(selectedDots)

      // Get or create the set of rows for this column
      const columnRows = newSelectedDots.get(gridX) || new Set<number>()

      if (columnRows.has(gridY)) {
        // Deselect if clicking the same dot
        columnRows.delete(gridY)
        if (columnRows.size === 0) {
          newSelectedDots.delete(gridX)
        } else {
          newSelectedDots.set(gridX, columnRows)
        }
      } else {
        // Add this dot to the column
        columnRows.add(gridY)
        newSelectedDots.set(gridX, columnRows)
      }

      setSelectedDots(newSelectedDots)

      // Reset playback state for multi-dot mode
      setCurrentDotIndex(0)
      setBeatPosition(0)
      beatPositionRef.current = 0
      currentDotIndexRef.current = 0
      setIsNotchedState(true)

      // Auto-start if we have selections
      const totalDots = Array.from(newSelectedDots.values()).reduce((sum, rows) => sum + rows.size, 0)
      if (totalDots > 0 && !isPlaying) {
        setIsPlaying(true)
        setActiveColumn(0)
      } else if (totalDots === 0) {
        setIsPlaying(false)
      }
    }
  }

  // Clear all selections
  const clearSelection = () => {
    setSelectedDots(new Map())
    setIsPlaying(false)
    setCurrentDotIndex(0)
    setBeatPosition(0)
    beatPositionRef.current = 0
    currentDotIndexRef.current = 0
    setIsNotchedState(true)
  }

  // Select diagonal pattern for testing
  const selectDiagonal = () => {
    const newSelectedDots = new Map<number, Set<number>>()
    const minDimension = Math.min(gridSize, columnCount)

    for (let i = 0; i < minDimension; i++) {
      newSelectedDots.set(i, new Set([i]))
    }

    setSelectedDots(newSelectedDots)
    setCurrentDotIndex(0)
    setBeatPosition(0)
    beatPositionRef.current = 0
    currentDotIndexRef.current = 0
    setIsNotchedState(true)
    if (!isPlaying) {
      setActiveColumn(0) // Set to first column BEFORE starting
      setIsPlaying(true)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-background/50 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Notch Filter Noise Grid</h3>
        <canvas
          ref={canvasRef}
          className={`w-full aspect-square cursor-pointer ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
          onClick={handleCanvasClick}
        />

        <div className="mt-3 text-xs text-muted-foreground text-center">
          Click to select one dot per column. Creates frequency gaps in -4.5dB/oct sloped noise.
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          disabled={selectedDots.size === 0}
          className={`px-3 py-1 rounded text-sm border ${
            selectedDots.size === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'
          }`}
        >
          {isPlaying ? 'Stop' : 'Play'}
        </button>

        <button
          onClick={clearSelection}
          disabled={selectedDots.size === 0}
          className={`px-3 py-1 rounded text-sm border ${
            selectedDots.size === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'
          }`}
        >
          Clear
        </button>

        <button
          onClick={selectDiagonal}
          className="px-3 py-1 rounded text-sm border hover:bg-muted"
        >
          Diagonal Test
        </button>
      </div>

      {/* Playback mode toggle */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Mode:</span>
        <button
          onClick={() => setPlaybackMode(playbackMode === 'sequential' ? 'simultaneous' : 'sequential')}
          className="px-3 py-1 rounded text-sm border hover:bg-muted"
        >
          {playbackMode === 'sequential' ? 'Sequential' : 'Simultaneous'}
        </button>
      </div>

      {/* Grid size controls */}
      <div className="flex gap-4 items-center text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Rows:</span>
          <button
            onClick={() => {
              setGridSize(Math.max(3, gridSize - 1))
              clearSelection()
            }}
            className="px-2 py-0.5 rounded text-xs border hover:bg-muted"
            disabled={gridSize <= 3}
          >
            -
          </button>
          <span className="w-8 text-center">{gridSize}</span>
          <button
            onClick={() => {
              setGridSize(Math.min(9, gridSize + 1))
              clearSelection()
            }}
            className="px-2 py-0.5 rounded text-xs border hover:bg-muted"
            disabled={gridSize >= 9}
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Columns:</span>
          <button
            onClick={() => {
              setColumnCount(Math.max(3, columnCount - 1))
              clearSelection()
            }}
            className="px-2 py-0.5 rounded text-xs border hover:bg-muted"
            disabled={columnCount <= 3}
          >
            -
          </button>
          <span className="w-8 text-center">{columnCount}</span>
          <button
            onClick={() => {
              setColumnCount(Math.min(9, columnCount + 1))
              clearSelection()
            }}
            className="px-2 py-0.5 rounded text-xs border hover:bg-muted"
            disabled={columnCount >= 9}
          >
            +
          </button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <div>Grid: {gridSize}x{columnCount} | Selected: {Array.from(selectedDots.values()).reduce((sum, rows) => sum + rows.size, 0)} dots</div>
        {isPlaying && selectedDots.size > 0 && (() => {
          const allDots = getAllSelectedDots()
          const totalDots = allDots.length
          const hasMultipleDots = totalDots > 1 || Array.from(selectedDots.values()).some(rows => rows.size > 1)

          if (hasMultipleDots) {
            // Multi-dot mode display
            const currentDot = allDots[currentDotIndex]
            return (
              <>
                <div className="font-medium">
                  Dot {currentDotIndex + 1}/{totalDots} | Beat {beatPosition + 1}/8 | {isNotchedState ? 'GAP' : 'FULL'}
                </div>
                <div>
                  Current: Col {currentDot.col + 1}, {Math.round(getFrequencyForRow(currentDot.row))}Hz
                  {isNotchedState ? ' (gap)' : ' (full spectrum)'}
                </div>
              </>
            )
          } else if (totalDots === 1) {
            // Single dot mode
            const dot = allDots[0]
            return (
              <>
                <div className="font-medium">
                  Mode: {activeColumn === 0 ? 'FREQUENCY GAP' : 'FULL SPECTRUM'}
                </div>
                <div>
                  {activeColumn === 0
                    ? `Gap around: ${Math.round(getFrequencyForRow(dot.row))}Hz`
                    : 'Playing full frequency spectrum'}
                </div>
              </>
            )
          } else {
            return null
          }
        })()}
      </div>
    </div>
  )
}