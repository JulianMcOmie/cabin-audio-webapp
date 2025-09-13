"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"

interface NotchFilterNoiseGridProps {
  gridSize?: number
  columnCount?: number
  disabled?: boolean
}

export function NotchFilterNoiseGrid({
  gridSize = 5,
  columnCount = 5,
  disabled = false
}: NotchFilterNoiseGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const noiseNodesRef = useRef<Map<number, OscillatorNode | AudioBufferSourceNode>>(new Map())
  const gainNodesRef = useRef<Map<number, GainNode>>(new Map())
  const filterNodesRef = useRef<Map<number, BiquadFilterNode>>(new Map())
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [selectedDots, setSelectedDots] = useState<Map<number, number>>(new Map()) // column -> row
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeColumn, setActiveColumn] = useState(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastBeatTimeRef = useRef(0)
  const BEAT_DURATION = 150 // ms per beat
  const BURST_DURATION = 100 // ms per burst
  const STAGGER_DELAY = 10 // ms stagger between columns

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
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Calculate frequency for a given row (exponential spacing)
  const getFrequencyForRow = (row: number) => {
    const minFreq = 100
    const maxFreq = 3200
    const normalizedPosition = row / (gridSize - 1)
    return minFreq * Math.pow(maxFreq / minFreq, normalizedPosition)
  }

  // Create pink noise buffer
  const createPinkNoiseBuffer = (audioContext: AudioContext, duration: number = 2) => {
    const sampleRate = audioContext.sampleRate
    const length = sampleRate * duration
    const buffer = audioContext.createBuffer(1, length, sampleRate)
    const data = buffer.getChannelData(0)

    // Pink noise generation using Paul Kellet's refined method
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1

      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.96900 * b2 + white * 0.1538520
      b3 = 0.86650 * b3 + white * 0.3104856
      b4 = 0.55000 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.0168980

      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
      b6 = white * 0.115926
    }

    // Apply -4.5dB/octave slope filter
    // This is approximated by cascading low-pass filters
    const tempBuffer = new Float32Array(length)
    const cutoff = 0.5 // Normalized frequency

    for (let pass = 0; pass < 2; pass++) {
      let prev = 0
      for (let i = 0; i < length; i++) {
        const input = pass === 0 ? data[i] : tempBuffer[i]
        const output = prev + cutoff * (input - prev)
        if (pass === 0) {
          tempBuffer[i] = output
        } else {
          data[i] = output
        }
        prev = output
      }
    }

    return buffer
  }

  // Play a burst for a column
  const playColumnBurst = (
    column: number,
    hasNotch: boolean,
    notchFrequency: number | null
  ) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    // Create noise source
    const noiseBuffer = createPinkNoiseBuffer(audioContext, 0.2)
    const noiseSource = audioContext.createBufferSource()
    noiseSource.buffer = noiseBuffer

    // Create gain node for envelope
    const gainNode = audioContext.createGain()
    gainNode.gain.setValueAtTime(0, audioContext.currentTime)

    // Attack and release envelope
    const attackTime = 0.002
    const releaseTime = 0.05
    const startTime = audioContext.currentTime + (column * STAGGER_DELAY) / 1000

    gainNode.gain.linearRampToValueAtTime(0.3, startTime + attackTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + BURST_DURATION / 1000)

    // Connect nodes
    noiseSource.connect(gainNode)

    // Add notch filter if needed
    if (hasNotch && notchFrequency !== null) {
      const notchFilter = audioContext.createBiquadFilter()
      notchFilter.type = 'notch'
      notchFilter.frequency.value = notchFrequency
      notchFilter.Q.value = 5 // Wide notch

      gainNode.connect(notchFilter)
      notchFilter.connect(audioContext.destination)
    } else {
      gainNode.connect(audioContext.destination)
    }

    // Start and stop
    noiseSource.start(startTime)
    noiseSource.stop(startTime + BURST_DURATION / 1000)
  }

  // Animation loop for playback
  const animate = () => {
    const now = performance.now()

    if (now - lastBeatTimeRef.current >= BEAT_DURATION) {
      lastBeatTimeRef.current = now

      // Play all columns
      for (let col = 0; col < columnCount; col++) {
        const selectedRow = selectedDots.get(col)

        if (selectedRow !== undefined) {
          // This column has a selected dot
          const isActiveColumn = col === activeColumn
          const notchFreq = isActiveColumn ? null : getFrequencyForRow(selectedRow)

          playColumnBurst(col, !isActiveColumn, notchFreq)
        }
      }

      // Advance to next active column
      const columnsWithDots = Array.from(selectedDots.keys()).sort((a, b) => a - b)
      if (columnsWithDots.length > 0) {
        const currentIndex = columnsWithDots.indexOf(activeColumn)
        const nextIndex = (currentIndex + 1) % columnsWithDots.length
        setActiveColumn(columnsWithDots[nextIndex])
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

        const isSelected = selectedDots.get(x) === y
        const isActive = isPlaying && isSelected && x === activeColumn

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
  }, [selectedDots, gridSize, columnCount, disabled, isDarkMode, isPlaying, activeColumn])

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

      // Each column can only have one selected dot
      if (newSelectedDots.get(gridX) === gridY) {
        // Deselect if clicking the same dot
        newSelectedDots.delete(gridX)
      } else {
        // Select this dot for the column
        newSelectedDots.set(gridX, gridY)
      }

      setSelectedDots(newSelectedDots)

      // Auto-start if we have selections
      if (newSelectedDots.size > 0 && !isPlaying) {
        setIsPlaying(true)
        // Set first column with a dot as active
        const firstColumn = Math.min(...Array.from(newSelectedDots.keys()))
        setActiveColumn(firstColumn)
      } else if (newSelectedDots.size === 0) {
        setIsPlaying(false)
      }
    }
  }

  // Clear all selections
  const clearSelection = () => {
    setSelectedDots(new Map())
    setIsPlaying(false)
  }

  // Select diagonal pattern for testing
  const selectDiagonal = () => {
    const newSelectedDots = new Map<number, number>()
    const minDimension = Math.min(gridSize, columnCount)

    for (let i = 0; i < minDimension; i++) {
      newSelectedDots.set(i, i)
    }

    setSelectedDots(newSelectedDots)
    if (!isPlaying) {
      setIsPlaying(true)
      setActiveColumn(0)
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
          Click to select one dot per column. Each column plays noise with notches at non-active frequencies.
        </div>
      </div>

      <div className="flex gap-2">
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

      <div className="text-xs text-muted-foreground">
        Grid: {gridSize}x{columnCount} | Selected: {selectedDots.size} dots |
        {isPlaying && selectedDots.size > 0 && ` Active Column: ${activeColumn + 1}`}
      </div>
    </div>
  )
}