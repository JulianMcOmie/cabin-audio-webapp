"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"

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
  const [, setActiveDotInColumn] = useState(0) // Track which dot in the current column
  const [gridSize, setGridSize] = useState(initialGridSize)
  const [columnCount, setColumnCount] = useState(initialColumnCount)
  const [playbackMode, setPlaybackMode] = useState<'sequential' | 'simultaneous'>('sequential')
  const [currentDotIndex, setCurrentDotIndex] = useState(0) // Which dot in the sequence
  const [beatPosition, setBeatPosition] = useState(0) // Current position in 8-beat pattern (0-7)
  const beatPositionRef = useRef(0) // Use ref to avoid closure issues
  const currentDotIndexRef = useRef(0) // Use ref to avoid closure issues
  const activeDotInColumnRef = useRef(0) // Use ref for tracking which dot in column
  const [isNotchedState, setIsNotchedState] = useState(true) // true = notched, false = full spectrum
  const [notchBandwidth, setNotchBandwidth] = useState(4) // Bandwidth multiplier for notch filter (1-8)
  const [staggerDelay, setStaggerDelay] = useState(20) // ms stagger between columns in simultaneous mode
  const animationFrameRef = useRef<number | null>(null)
  const lastBeatTimeRef = useRef(0)
  const BEAT_DURATION = 200 // ms per beat - 150ms burst + 50ms gap
  const BURST_DURATION = 150 // ms per burst - 100ms attack + 50ms release

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

  // Helper function to find contiguous ranges of dots in a column
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getContiguousRanges = (rows: Set<number>): Array<{start: number, end: number}> => {
    const sortedRows = Array.from(rows).sort((a, b) => a - b)
    const ranges: Array<{start: number, end: number}> = []

    if (sortedRows.length === 0) return ranges

    let start = sortedRows[0]
    let end = sortedRows[0]

    for (let i = 1; i < sortedRows.length; i++) {
      if (sortedRows[i] === end + 1) {
        // Contiguous
        end = sortedRows[i]
      } else {
        // Gap found, save current range and start new one
        ranges.push({start, end})
        start = sortedRows[i]
        end = sortedRows[i]
      }
    }
    ranges.push({start, end})

    return ranges
  }

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
    notchFrequencies: number[] | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _bandwidth: number = 4,
    staggerMs: number = 20
  ) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    // Create gain node for envelope (shared by both paths)
    const envelopeGain = audioContext.createGain()
    envelopeGain.gain.setValueAtTime(0, audioContext.currentTime)

    // Short, punchy envelope
    const attackTime = 0.1  // 100ms attack - faster
    const releaseTime = 0.05 // 50ms release - very short
    const startTime = audioContext.currentTime + (column * staggerMs) / 1000
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

    if (hasNotch) {
      // INVERTED: When notch is active, play FULL SPECTRUM
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

    } else {
      // INVERTED: When not notched, apply EQ BUMP at the frequencies
      const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
      const noiseSource = audioContext.createBufferSource()
      noiseSource.buffer = noiseBuffer
      noiseSource.loop = true

      const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
      slopedNoiseGens.push(slopedNoiseGen)

      // Add peaking filters for EQ bumps when we have frequencies
      if (notchFrequencies !== null && notchFrequencies.length > 0) {
        // Create a chain of peaking filters for each frequency
        const peakingFilters: BiquadFilterNode[] = []

        for (const freq of notchFrequencies) {
          const peakingFilter = audioContext.createBiquadFilter()
          peakingFilter.type = 'peaking'
          peakingFilter.frequency.value = freq
          peakingFilter.Q.value = 2.0 // Moderate Q for noticeable bump
          peakingFilter.gain.value = 12 // 12dB boost for more pronounced effect
          peakingFilters.push(peakingFilter)
        }

        // Connect the chain: source -> slopedNoise -> peak1 -> peak2 -> ... -> merger
        noiseSource.connect(slopedNoiseGen.getInputNode())

        if (peakingFilters.length === 1) {
          slopedNoiseGen.getOutputNode().connect(peakingFilters[0])
          peakingFilters[0].connect(merger)
        } else {
          // Chain multiple filters
          slopedNoiseGen.getOutputNode().connect(peakingFilters[0])
          for (let i = 0; i < peakingFilters.length - 1; i++) {
            peakingFilters[i].connect(peakingFilters[i + 1])
          }
          peakingFilters[peakingFilters.length - 1].connect(merger)
        }
      } else {
        // No frequency specified, just play sloped noise
        noiseSource.connect(slopedNoiseGen.getInputNode())
        slopedNoiseGen.getOutputNode().connect(merger)
      }

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

      // Check if we're in multi-dot mode (multiple dots across different columns)
      // Don't use multi-dot mode for sequential mode, let sequential handle its own logic
      const hasMultipleDots = totalDotsSelected > 1
      const hasDotsInSameColumn = Array.from(selectedDots.values()).some(rows => rows.size > 1)
      const isMultiDotMode = (hasMultipleDots || hasDotsInSameColumn) && playbackMode !== 'simultaneous' && playbackMode !== 'sequential'


      if (playbackMode === 'simultaneous' && totalDotsSelected > 0) {
        // Simultaneous mode: play all columns at once with F-N-N-F-N-N-F-N pattern
        // Each column has a 20ms stagger delay for a cascading effect
        // INVERTED: positions 0,3,6 play EQ bump (hasNotch=false), others play full spectrum (hasNotch=true)
        const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

        selectedDots.forEach((rows, col) => {
          if (rows.size > 0) {
            // Get all frequencies for the dots in this column
            const frequencies = Array.from(rows).map(row => getFrequencyForRow(row))

            // Play column with all frequencies for EQ bumps
            playColumnBurst(col, shouldBeNotched, shouldBeNotched ? null : frequencies, notchBandwidth, staggerDelay)
          }
        })

        // Update beat position
        beatPositionRef.current = (beatPositionRef.current + 1) % 8
        setBeatPosition(beatPositionRef.current)
        setIsNotchedState(!(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6))
      } else if (isMultiDotMode) {
        // Multi-dot mode: play one dot at a time with pattern F-N-N-F-N-N-F-N (8 beats)
        const currentDot = allDots[currentDotIndexRef.current]
        const notchFreq = getFrequencyForRow(currentDot.row)

        // Pattern: F-N-N-F-N-N-F-N (positions 0,3,6 are full spectrum)
        // INVERTED: positions 0,3,6 play EQ bump (hasNotch=false), others play full spectrum (hasNotch=true)
        const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

        // Play only the current dot's column with inverted logic
        playColumnBurst(currentDot.col, shouldBeNotched, shouldBeNotched ? null : [notchFreq], notchBandwidth, 0)

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
        // INVERTED: positions 0,3,6 play EQ bump (hasNotch=false), others play full spectrum (hasNotch=true)
        const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

        playColumnBurst(dot.col, shouldBeNotched, shouldBeNotched ? null : [notchFreq], notchBandwidth, 0)

        // Update beat position
        beatPositionRef.current = (beatPositionRef.current + 1) % 8
        setBeatPosition(beatPositionRef.current)
        setIsNotchedState(!(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6))
      } else if (playbackMode === 'sequential') {
        // Sequential mode - play all columns with staggered bursts, cycling EQ bump through dots in reading order
        // Build a list of all dots in reading order
        const allDotsInOrder: {col: number, row: number}[] = []

        // Get all dots sorted by row first, then by column (reading order)
        selectedDots.forEach((rows, col) => {
          rows.forEach(row => {
            allDotsInOrder.push({col, row})
          })
        })

        // Sort by row first (top to bottom), then by column (left to right)
        allDotsInOrder.sort((a, b) => {
          if (a.row !== b.row) return a.row - b.row
          return a.col - b.col
        })

        // Remove any duplicates (shouldn't happen but let's be safe)
        const uniqueDots = allDotsInOrder.filter((dot, index, self) =>
          index === self.findIndex(d => d.col === dot.col && d.row === dot.row)
        )

        if (uniqueDots.length > 0) {
          if (uniqueDots.length === 1) {
            // Single dot: use F-N-N-F-N-N-F-N pattern
            const dot = uniqueDots[0]
            const notchFreq = getFrequencyForRow(dot.row)
            const shouldBeNotched = !(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6)

            playColumnBurst(dot.col, shouldBeNotched, shouldBeNotched ? null : [notchFreq], notchBandwidth, 0)

            // Update beat position
            beatPositionRef.current = (beatPositionRef.current + 1) % 8
            setBeatPosition(beatPositionRef.current)
            setIsNotchedState(!(beatPositionRef.current === 0 || beatPositionRef.current === 3 || beatPositionRef.current === 6))
          } else {
            // Multiple dots: play all columns with staggered bursts
            // Cycle through dots for EQ bump, alternating with full spectrum
            const totalSteps = uniqueDots.length * 2
            const currentStep = activeDotInColumnRef.current
            const isFullSpectrum = currentStep % 2 === 1

            // Determine which dot gets the EQ bump
            const currentBumpDotIndex = Math.floor(currentStep / 2)
            const currentBumpDot = uniqueDots[currentBumpDotIndex]

            // Debug logging
            console.log(`Step ${currentStep}/${totalSteps}: ${isFullSpectrum ? 'FULL' : `BUMP dot ${currentBumpDotIndex} (${currentBumpDot.col},${currentBumpDot.row})`}`)
            console.log('All dots in order:', uniqueDots.map(d => `(${d.col},${d.row})`).join(', '))

            // Get all columns in sorted order for consistent staggering
            const sortedColumns = Array.from(selectedDots.keys()).sort((a, b) => a - b)

            // Play all columns with appropriate sound
            sortedColumns.forEach((col, colIndex) => {
              const rows = selectedDots.get(col)
              if (rows && rows.size > 0) {
                // Check if this column contains the current bump dot
                const hasCurrentBumpDot = !isFullSpectrum && col === currentBumpDot.col && rows.has(currentBumpDot.row)

                if (hasCurrentBumpDot) {
                  // This column has the current bump dot - play with EQ bump at that frequency
                  const notchFreq = getFrequencyForRow(currentBumpDot.row)
                  playColumnBurst(col, false, [notchFreq], notchBandwidth, colIndex * staggerDelay)
                } else {
                  // Play full spectrum for all other columns
                  playColumnBurst(col, true, null, notchBandwidth, colIndex * staggerDelay)
                }
              }
            })

            // Visual feedback
            setIsNotchedState(isFullSpectrum)
            if (!isFullSpectrum) {
              setActiveColumn(currentBumpDot.col)
            }

            // Move to next step AFTER playing
            const nextStep = (currentStep + 1) % totalSteps
            activeDotInColumnRef.current = nextStep
            setActiveDotInColumn(nextStep)
          }
        }
      } else {
        // Fallback for any other mode
        const dot = allDots[0]
        if (dot) {
          const notchFreq = getFrequencyForRow(dot.row)
          playColumnBurst(dot.col, false, [notchFreq], notchBandwidth, 0)
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
      activeDotInColumnRef.current = 0
      setActiveDotInColumn(0)
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
  }, [isPlaying, selectedDots])

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
      activeDotInColumnRef.current = 0
      setIsNotchedState(true)
      setActiveDotInColumn(0)

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
    setActiveDotInColumn(0)
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
    activeDotInColumnRef.current = 0
    setIsNotchedState(true)
    setActiveDotInColumn(0)
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
          Click to select dots. Alternates between full spectrum and EQ bumps at selected frequencies.
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

      {/* Notch bandwidth control */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Notch Width:</span>
        <div className="flex items-center gap-2">
          <span className="text-xs">Narrow</span>
          <Slider
            value={[notchBandwidth]}
            onValueChange={(value) => setNotchBandwidth(value[0])}
            min={1}
            max={8}
            step={0.5}
            className="w-32"
          />
          <span className="text-xs">Wide</span>
          <span className="text-xs text-muted-foreground ml-2">({notchBandwidth.toFixed(1)}x)</span>
        </div>
      </div>

      {/* Stagger delay control (only for simultaneous mode) */}
      {playbackMode === 'simultaneous' && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Stagger:</span>
          <div className="flex items-center gap-2">
            <span className="text-xs">0ms</span>
            <Slider
              value={[staggerDelay]}
              onValueChange={(value) => setStaggerDelay(value[0])}
              min={0}
              max={50}
              step={5}
              className="w-32"
            />
            <span className="text-xs">50ms</span>
            <span className="text-xs text-muted-foreground ml-2">({staggerDelay}ms)</span>
          </div>
        </div>
      )}

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
              setGridSize(Math.min(100, gridSize + 1))
              clearSelection()
            }}
            className="px-2 py-0.5 rounded text-xs border hover:bg-muted"
            disabled={gridSize >= 100}
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
              setColumnCount(Math.min(100, columnCount + 1))
              clearSelection()
            }}
            className="px-2 py-0.5 rounded text-xs border hover:bg-muted"
            disabled={columnCount >= 100}
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
                  Dot {currentDotIndex + 1}/{totalDots} | Beat {beatPosition + 1}/8 | {isNotchedState ? 'FULL' : 'BUMP'}
                </div>
                <div>
                  Current: Col {currentDot.col + 1}, {Math.round(getFrequencyForRow(currentDot.row))}Hz
                  {isNotchedState ? ' (full spectrum)' : ' (EQ bump)'}
                </div>
              </>
            )
          } else if (totalDots === 1) {
            // Single dot mode
            const dot = allDots[0]
            return (
              <>
                <div className="font-medium">
                  Mode: {activeColumn === 0 ? 'EQ BUMP' : 'FULL SPECTRUM'}
                </div>
                <div>
                  {activeColumn === 0
                    ? `Bump at: ${Math.round(getFrequencyForRow(dot.row))}Hz`
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