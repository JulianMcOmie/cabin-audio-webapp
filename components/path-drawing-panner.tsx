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

interface PathDrawingPannerProps {
  disabled?: boolean
}

interface PathPoint {
  x: number
  y: number
  freq: number
  pan: number
  timestamp?: number
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

export function PathDrawingPanner({ disabled = false }: PathDrawingPannerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const pathRef = useRef<PathPoint[]>([])
  const currentPositionRef = useRef(0) // Position along path (0 to 1)
  const lastBeatTimeRef = useRef(0)
  const startTimeRef = useRef(0)
  const totalPathLengthRef = useRef(0)

  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [path, setPath] = useState<PathPoint[]>([])
  const [currentPosition, setCurrentPosition] = useState(0) // 0 to 1 along path

  // Audio parameters
  const [pathDuration, setPathDuration] = useState(5) // seconds to traverse entire path
  const [tempo, setTempo] = useState(350) // BPM for rhythm pattern
  const [attackTime, setAttackTime] = useState(0.1)
  const [releaseTime, setReleaseTime] = useState(0.05)
  const [burstDuration, setBurstDuration] = useState(150) // ms
  const [notchQ, setNotchQ] = useState(0.5)
  const [loopMode, setLoopMode] = useState(true)
  const [useCrossfeed, setUseCrossfeed] = useState(false)
  const [showFrequencyNotch, setShowFrequencyNotch] = useState(true)
  const [rhythmPattern] = useState([1, 0, 0, 1, 0, 0, 1, 0]) // F-N-N-F-N-N-F-N

  const beatDuration = 60000 / tempo // ms per beat

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

  // Calculate total path length
  const calculatePathLength = (points: PathPoint[]): number => {
    let length = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dy = points[i].y - points[i - 1].y
      length += Math.sqrt(dx * dx + dy * dy)
    }
    return length
  }

  // Get interpolated position along path
  const getInterpolatedPosition = (points: PathPoint[], position: number): PathPoint | null => {
    if (points.length === 0) return null
    if (points.length === 1) return points[0]

    // Position is 0 to 1 along the entire path
    const totalLength = calculatePathLength(points)
    if (totalLength === 0) return points[0]

    const targetDistance = position * totalLength
    let currentDistance = 0

    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dy = points[i].y - points[i - 1].y
      const segmentLength = Math.sqrt(dx * dx + dy * dy)

      if (currentDistance + segmentLength >= targetDistance) {
        // Interpolate within this segment
        const segmentProgress = (targetDistance - currentDistance) / segmentLength
        const x = points[i - 1].x + dx * segmentProgress
        const y = points[i - 1].y + dy * segmentProgress

        // Interpolate freq and pan as well
        const freq = points[i - 1].freq + (points[i].freq - points[i - 1].freq) * segmentProgress
        const pan = points[i - 1].pan + (points[i].pan - points[i - 1].pan) * segmentProgress

        return { x, y, freq, pan }
      }

      currentDistance += segmentLength
    }

    return points[points.length - 1]
  }

  // Convert canvas coordinates to audio parameters
  const coordsToAudioParams = (x: number, y: number, width: number, height: number): { pan: number, freq: number } => {
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

  // Play a burst at specific position
  const playBurst = (freq: number, pan: number) => {
    const audioContext = audioContextRef.current
    if (!audioContext) return

    const envelopeGain = audioContext.createGain()
    envelopeGain.gain.setValueAtTime(0, audioContext.currentTime)

    const startTime = audioContext.currentTime
    const peakGain = 0.8

    envelopeGain.gain.setValueAtTime(0.001, startTime)
    envelopeGain.gain.exponentialRampToValueAtTime(peakGain, startTime + attackTime)
    envelopeGain.gain.exponentialRampToValueAtTime(0.001, startTime + attackTime + releaseTime)

    // Create merger node
    const merger = audioContext.createGain()
    merger.connect(envelopeGain)

    // Add panning
    let pannerCleanup: (() => void) | null = null

    if (useCrossfeed) {
      const crossfeedPanner = new CrossfeedPanner(audioContext, pan)
      envelopeGain.connect(crossfeedPanner.getInputNode())
      crossfeedPanner.connect(audioContext.destination)
      pannerCleanup = () => crossfeedPanner.dispose()
    } else {
      const panner = audioContext.createStereoPanner()
      panner.pan.value = pan
      envelopeGain.connect(panner)
      panner.connect(audioContext.destination)
    }

    const slopedNoiseGens: SlopedPinkNoiseGenerator[] = []
    const noiseBuffer = createPinkNoiseBuffer(audioContext, 1.0)
    const noiseSource = audioContext.createBufferSource()
    noiseSource.buffer = noiseBuffer
    noiseSource.loop = true

    const slopedNoiseGen = new SlopedPinkNoiseGenerator(audioContext)
    slopedNoiseGens.push(slopedNoiseGen)

    if (showFrequencyNotch) {
      // Create a notch filter
      const notchFilter = audioContext.createBiquadFilter()
      notchFilter.type = 'notch'
      notchFilter.frequency.value = freq
      notchFilter.Q.value = notchQ

      noiseSource.connect(slopedNoiseGen.getInputNode())
      slopedNoiseGen.getOutputNode().connect(notchFilter)
      notchFilter.connect(merger)
    } else {
      // Full spectrum
      noiseSource.connect(slopedNoiseGen.getInputNode())
      slopedNoiseGen.getOutputNode().connect(merger)
    }

    noiseSource.start(startTime)
    noiseSource.stop(startTime + burstDuration / 1000)

    setTimeout(() => {
      slopedNoiseGens.forEach(gen => gen.dispose())
      if (pannerCleanup) pannerCleanup()
    }, burstDuration + 100)
  }

  // Animation loop to play along the path
  const animate = () => {
    if (!isPlaying || pathRef.current.length === 0) {
      animationFrameRef.current = null
      return
    }

    const now = performance.now()
    const elapsed = now - startTimeRef.current

    // Update position along path based on elapsed time
    const progress = (elapsed / 1000) / pathDuration // Convert ms to seconds and normalize
    currentPositionRef.current = progress % 1 // Keep between 0 and 1

    if (progress >= 1 && !loopMode) {
      setIsPlaying(false)
      currentPositionRef.current = 0
      setCurrentPosition(0)
      return
    }

    setCurrentPosition(currentPositionRef.current)

    // Get current position on path
    const currentPoint = getInterpolatedPosition(pathRef.current, currentPositionRef.current)

    // Check if we should play a beat
    if (currentPoint && now - lastBeatTimeRef.current >= beatDuration) {
      lastBeatTimeRef.current = now

      // Determine if this beat should play (based on rhythm pattern)
      const beatIndex = Math.floor((elapsed / beatDuration)) % rhythmPattern.length
      const shouldPlay = rhythmPattern[beatIndex] === 1

      if (shouldPlay) {
        // Play with current notch frequency (full spectrum beats)
        playBurst(0, currentPoint.pan)
      } else {
        // Play with notch at current frequency
        playBurst(currentPoint.freq, currentPoint.pan)
      }
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }

  // Start/stop playback
  useEffect(() => {
    if (isPlaying && path.length > 0) {
      startTimeRef.current = performance.now()
      lastBeatTimeRef.current = performance.now()
      currentPositionRef.current = 0
      setCurrentPosition(0)
      pathRef.current = path
      totalPathLengthRef.current = calculatePathLength(path)
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
  }, [isPlaying, path.length])

  // Handle drawing
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || isPlaying) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const { pan, freq } = coordsToAudioParams(x, y, rect.width, rect.height)

    setIsDrawing(true)
    setPath([{ x, y, freq, pan }])
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled || isPlaying) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const { pan, freq } = coordsToAudioParams(x, y, rect.width, rect.height)

    setPath(prev => [...prev, { x, y, freq, pan }])
  }

  const handlePointerUp = () => {
    setIsDrawing(false)
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

    const freqLabels = [100, 500, 1000, 2000, 5000, 10000]
    freqLabels.forEach(freq => {
      const normalizedFreq = (Math.log2(freq) - Math.log2(MIN_AUDIBLE_FREQ)) /
                            (Math.log2(MAX_AUDIBLE_FREQ) - Math.log2(MIN_AUDIBLE_FREQ))
      const y = (1 - normalizedFreq) * rect.height

      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()

      const label = freq >= 1000 ? `${freq/1000}k` : `${freq}`
      ctx.fillText(label + "Hz", 5, y - 3)
    })

    // Draw panning gridlines
    ctx.textAlign = "center"
    ctx.textBaseline = "top"

    const panLabels = [-1, -0.5, 0, 0.5, 1]
    panLabels.forEach(pan => {
      const x = ((pan + 1) / 2) * rect.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()

      const label = pan === 0 ? "C" : pan < 0 ? "L" : "R"
      ctx.fillText(label, x, rect.height - 15)
    })

    // Draw the path
    if (path.length > 0) {
      ctx.strokeStyle = isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(path[0].x, path[0].y)

      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y)
      }
      ctx.stroke()

      // Draw small dots at path points for visual reference
      path.forEach((point) => {
        ctx.beginPath()
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2)
        ctx.fillStyle = isDarkMode ? "#52525b" : "#cbd5e1"
        ctx.fill()
      })

      // Draw current position if playing
      if (isPlaying) {
        const currentPoint = getInterpolatedPosition(path, currentPosition)
        if (currentPoint) {
          // Draw larger dot at current position
          ctx.beginPath()
          ctx.arc(currentPoint.x, currentPoint.y, 6, 0, Math.PI * 2)
          ctx.fillStyle = isDarkMode ? "#22c55e" : "#16a34a"
          ctx.fill()

          // Draw pulse effect
          const pulseSize = 1 + Math.sin(Date.now() / 100) * 0.3
          ctx.beginPath()
          ctx.arc(currentPoint.x, currentPoint.y, 10 * pulseSize, 0, Math.PI * 2)
          ctx.strokeStyle = isDarkMode ? "#22c55e" : "#16a34a"
          ctx.lineWidth = 2
          ctx.stroke()

          // Draw frequency and pan info
          ctx.fillStyle = isDarkMode ? "#aaa" : "#666"
          ctx.font = "11px monospace"
          ctx.textAlign = "left"
          const freqText = currentPoint.freq >= 1000 ? `${(currentPoint.freq/1000).toFixed(1)}kHz` : `${Math.round(currentPoint.freq)}Hz`
          ctx.fillText(freqText, currentPoint.x + 15, currentPoint.y - 5)
        }
      }
    }

    // Draw instructions if no path
    if (path.length === 0) {
      ctx.fillStyle = isDarkMode ? "#888" : "#666"
      ctx.font = "14px sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("Draw a path to create your sound journey", rect.width / 2, rect.height / 2)
    }

  }, [path, isDarkMode, isPlaying, currentPosition])

  return (
    <div className="space-y-4">
      <div className="bg-background/50 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Path Drawing Panner</h3>

        <canvas
          ref={canvasRef}
          className={`w-full h-80 ${!isPlaying && !disabled ? "cursor-crosshair" : ""} rounded ${disabled ? "opacity-70" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        <div className="mt-4 space-y-3">
          {/* Path Duration control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Path Duration</span>
              <span className="font-mono">{pathDuration.toFixed(1)}s</span>
            </div>
            <Slider
              value={[pathDuration]}
              onValueChange={(value) => setPathDuration(value[0])}
              min={1}
              max={20}
              step={0.5}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Tempo control for rhythm */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Rhythm Tempo</span>
              <span className="font-mono">{tempo} BPM</span>
            </div>
            <Slider
              value={[tempo]}
              onValueChange={(value) => setTempo(value[0])}
              min={60}
              max={600}
              step={10}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Attack time control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Attack</span>
              <span className="font-mono">{(attackTime * 1000).toFixed(0)}ms</span>
            </div>
            <Slider
              value={[attackTime * 1000]}
              onValueChange={(value) => setAttackTime(value[0] / 1000)}
              min={10}
              max={500}
              step={10}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Release time control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Release</span>
              <span className="font-mono">{(releaseTime * 1000).toFixed(0)}ms</span>
            </div>
            <Slider
              value={[releaseTime * 1000]}
              onValueChange={(value) => setReleaseTime(value[0] / 1000)}
              min={10}
              max={500}
              step={10}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Burst duration control */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Burst Duration</span>
              <span className="font-mono">{burstDuration}ms</span>
            </div>
            <Slider
              value={[burstDuration]}
              onValueChange={(value) => setBurstDuration(value[0])}
              min={50}
              max={500}
              step={10}
              disabled={disabled || isPlaying}
              className="w-full"
            />
          </div>

          {/* Notch Q control */}
          {showFrequencyNotch && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Notch Q (Width)</span>
                <span className="font-mono">Q:{notchQ.toFixed(2)}</span>
              </div>
              <Slider
                value={[notchQ]}
                onValueChange={(value) => setNotchQ(value[0])}
                min={0.1}
                max={20}
                step={0.1}
                disabled={disabled || isPlaying}
                className="w-full"
              />
            </div>
          )}

          {/* Toggle switches */}
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="loop-mode"
                checked={loopMode}
                onCheckedChange={setLoopMode}
                disabled={disabled}
              />
              <Label htmlFor="loop-mode" className="text-sm">
                Loop Path
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="frequency-notch"
                checked={showFrequencyNotch}
                onCheckedChange={setShowFrequencyNotch}
                disabled={disabled || isPlaying}
              />
              <Label htmlFor="frequency-notch" className="text-sm">
                Frequency Notch
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="use-crossfeed"
                checked={useCrossfeed}
                onCheckedChange={setUseCrossfeed}
                disabled={disabled || isPlaying}
              />
              <Label htmlFor="use-crossfeed" className="text-sm">
                Crossfeed Panning
              </Label>
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <Button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={disabled || path.length === 0}
              size="sm"
              variant="outline"
            >
              {isPlaying ? 'Stop' : 'Play'}
            </Button>

            <Button
              onClick={() => {
                setPath([])
                setCurrentPosition(0)
                currentPositionRef.current = 0
              }}
              disabled={disabled || isPlaying}
              size="sm"
              variant="outline"
            >
              Clear Path
            </Button>

            <Button
              onClick={() => {
                if (path.length > 0) {
                  setPath(path.slice(0, -10))
                }
              }}
              disabled={disabled || isPlaying || path.length === 0}
              size="sm"
              variant="outline"
            >
              Undo
            </Button>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>Draw a path on the canvas - vertical position controls frequency, horizontal controls panning</div>
            <div>Audio moves along the path continuously while playing the F-N-N-F-N-N-F-N rhythm</div>
            <div>{path.length} points in path | Progress: {(currentPosition * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </div>
  )
}