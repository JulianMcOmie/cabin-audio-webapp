"use client"

import type React from "react"
import { useRef, useEffect, useState, useCallback } from "react"
import * as stopbandExplorerAudio from '@/lib/audio/stopbandExplorerAudio'
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"

interface StopbandExplorerProps {
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  disabled?: boolean
}

export function StopbandExplorer({ isPlaying, setIsPlaying, disabled = false }: StopbandExplorerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Frequency selector
  const [frequencyY, setFrequencyY] = useState(0.5)
  const [isDragging, setIsDragging] = useState(false)

  // Settings
  const [numPositions, setNumPositions] = useState(5)
  const [fillinDuration, setFillinDuration] = useState(1000)
  const [bandwidth, setBandwidth] = useState(1.0)
  const [volume, setVolume] = useState(1.0)

  // For visualization
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isInFillinPhase, setIsInFillinPhase] = useState(false)

  // Detect dark mode
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

    return () => {
      observer.disconnect()
    }
  }, [])

  // Initialize audio with default settings
  useEffect(() => {
    const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
    player.setNumGenerators(numPositions)
    player.setFillinDuration(fillinDuration)
    player.setBandwidth(bandwidth)
    player.setFrequencyY(frequencyY)
    player.setVolume(volume)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle playing state
  useEffect(() => {
    const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
    if (isPlaying && !disabled) {
      player.startPlaying()
    } else {
      player.stopPlaying()
    }

    return () => {
      if (isPlaying) {
        player.stopPlaying()
      }
    }
  }, [isPlaying, disabled])

  // Update frequency when dragged
  useEffect(() => {
    if (!disabled) {
      const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
      player.setFrequencyY(frequencyY)
    }
  }, [frequencyY, disabled])

  // Update num positions
  useEffect(() => {
    const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
    player.setNumGenerators(numPositions)
  }, [numPositions])

  // Update fill-in duration
  useEffect(() => {
    const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
    player.setFillinDuration(fillinDuration)
  }, [fillinDuration])

  // Update bandwidth
  useEffect(() => {
    const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
    player.setBandwidth(bandwidth)
  }, [bandwidth])

  // Update volume
  useEffect(() => {
    const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
    player.setVolume(volume)
  }, [volume])

  // Poll active index and phase for visualization
  useEffect(() => {
    if (!isPlaying) {
      setActiveIndex(-1)
      setIsInFillinPhase(false)
      return
    }

    const interval = setInterval(() => {
      const player = stopbandExplorerAudio.getStopbandExplorerPlayer()
      setActiveIndex(player.getCurrentActiveIndex())
      setIsInFillinPhase(player.getIsInFillinPhase())
    }, 50)

    return () => clearInterval(interval)
  }, [isPlaying])

  // Draw canvas
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

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Draw background grid lines
    ctx.strokeStyle = isDarkMode ? "#27272a" : "#e2e8f0"
    ctx.lineWidth = 1

    // Horizontal lines (frequency markers)
    for (let i = 1; i < 4; i++) {
      const y = (rect.height * i) / 4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
    }

    // Draw position markers (vertical lines)
    for (let i = 0; i < numPositions; i++) {
      const x = numPositions === 1
        ? rect.width / 2
        : (i / (numPositions - 1)) * rect.width

      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)

      if (i === activeIndex && isPlaying) {
        // Active position - highlight (amber for stopband, green for fill-in)
        ctx.strokeStyle = isInFillinPhase
          ? (isDarkMode ? "#22c55e" : "#16a34a")
          : (isDarkMode ? "#fbbf24" : "#f59e0b")
        ctx.lineWidth = 3
      } else {
        ctx.strokeStyle = isDarkMode ? "#3f3f46" : "#cbd5e1"
        ctx.lineWidth = 1
      }
      ctx.stroke()
    }

    // Draw horizontal frequency selector line
    const lineY = frequencyY * rect.height
    const lineThickness = 4
    const handleRadius = 12

    // Draw line glow if playing
    if (isPlaying && !disabled) {
      ctx.beginPath()
      ctx.moveTo(0, lineY)
      ctx.lineTo(rect.width, lineY)
      const gradient = ctx.createLinearGradient(0, lineY - 15, 0, lineY + 15)
      gradient.addColorStop(0, "rgba(56, 189, 248, 0)")
      gradient.addColorStop(0.5, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
      gradient.addColorStop(1, "rgba(56, 189, 248, 0)")
      ctx.strokeStyle = gradient
      ctx.lineWidth = 20
      ctx.stroke()
    }

    // Draw main line
    ctx.beginPath()
    ctx.moveTo(0, lineY)
    ctx.lineTo(rect.width, lineY)
    ctx.strokeStyle = disabled
      ? isDarkMode ? "#52525b" : "#cbd5e1"
      : isDarkMode ? "#38bdf8" : "#0284c7"
    ctx.lineWidth = lineThickness
    ctx.lineCap = 'round'
    ctx.stroke()

    // Draw drag handle
    ctx.beginPath()
    ctx.arc(rect.width / 2, lineY, handleRadius, 0, Math.PI * 2)
    ctx.fillStyle = disabled
      ? isDarkMode ? "#52525b" : "#cbd5e1"
      : isDarkMode ? "#38bdf8" : "#0284c7"
    ctx.fill()

    // Draw inner highlight
    ctx.beginPath()
    ctx.arc(rect.width / 2 - handleRadius / 3, lineY - handleRadius / 3, handleRadius / 3, 0, Math.PI * 2)
    ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
    ctx.fill()

    // Draw active position indicator
    if (activeIndex >= 0 && isPlaying) {
      const activeX = numPositions === 1
        ? rect.width / 2
        : (activeIndex / (numPositions - 1)) * rect.width

      ctx.beginPath()
      ctx.arc(activeX, lineY, 8, 0, Math.PI * 2)
      // Amber for stopband phase, green for fill-in phase
      ctx.fillStyle = isInFillinPhase
        ? (isDarkMode ? "#22c55e" : "#16a34a")
        : (isDarkMode ? "#fbbf24" : "#f59e0b")
      ctx.fill()
    }

    // Draw labels
    ctx.font = "12px system-ui, sans-serif"
    ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"
    ctx.textAlign = "right"
    ctx.fillText("High", rect.width - 8, 16)
    ctx.fillText("Low", rect.width - 8, rect.height - 8)
    ctx.textAlign = "left"
    ctx.fillText("L", 8, rect.height - 8)
    ctx.textAlign = "right"
    ctx.fillText("R", rect.width - 8, rect.height - 24)

  }, [frequencyY, numPositions, activeIndex, isInFillinPhase, isDarkMode, isPlaying, disabled])

  // Mouse handlers
  const updateFrequency = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || disabled) return

    const rect = canvas.getBoundingClientRect()
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    setFrequencyY(y)
  }, [disabled])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return
    setIsDragging(true)
    updateFrequency(e)

    if (!isPlaying) {
      setIsPlaying(true)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      updateFrequency(e)
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Global mouse handlers
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false)
    }

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (disabled) return
      if (isDragging) {
        updateFrequency(e)
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    window.addEventListener('mousemove', handleGlobalMouseMove)

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      window.removeEventListener('mousemove', handleGlobalMouseMove)
    }
  }, [isDragging, disabled, updateFrequency])

  return (
    <div className="space-y-4">
      {/* Frequency selector canvas */}
      <div className="relative">
        <div className="text-xs text-muted-foreground mb-2">
          Frequency Row (notch position)
        </div>
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[3/1] bg-background border ${
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ns-resize'
          } ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ touchAction: 'none' }}
        />
        <div className="absolute bottom-2 left-2 text-xs text-muted-foreground">
          Drag up/down to select frequency
        </div>
      </div>

      {/* Volume control */}
      <div className="relative">
        <div className="text-xs text-muted-foreground mb-2">Volume</div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[volume]}
          onValueChange={(value) => setVolume(value[0])}
          disabled={disabled}
        />
      </div>

      {/* Controls */}
      <Card className="p-4 space-y-4">
        {/* Number of Positions */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="num-positions">Number of Positions</Label>
            <span className="text-sm text-muted-foreground">{numPositions}</span>
          </div>
          <Slider
            id="num-positions"
            min={3}
            max={15}
            step={1}
            value={[numPositions]}
            onValueChange={(value) => setNumPositions(value[0])}
            disabled={disabled}
          />
        </div>

        {/* Fill-in Duration */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="fillin-duration">Fill-in Duration</Label>
            <span className="text-sm text-muted-foreground">{fillinDuration} ms</span>
          </div>
          <Slider
            id="fillin-duration"
            min={100}
            max={3000}
            step={50}
            value={[fillinDuration]}
            onValueChange={(value) => setFillinDuration(value[0])}
            disabled={disabled}
          />
        </div>

        {/* Bandwidth */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="bandwidth">Notch Bandwidth</Label>
            <span className="text-sm text-muted-foreground">{bandwidth.toFixed(1)} octaves</span>
          </div>
          <Slider
            id="bandwidth"
            min={0.5}
            max={3}
            step={0.1}
            value={[bandwidth]}
            onValueChange={(value) => setBandwidth(value[0])}
            disabled={disabled}
          />
        </div>
      </Card>

      {/* Instructions */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p><strong>Instructions:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Drag the horizontal line to select the notch frequency</li>
          <li>One noise source cycles through pan positions L→R</li>
          <li>At each position: 250ms notch (amber), then fill-in (green)</li>
          <li>Adjust fill-in duration to control how long the band plays</li>
          <li>Narrower bandwidth = more precise notch/fill-in</li>
        </ul>
      </div>
    </div>
  )
}

export default StopbandExplorer
