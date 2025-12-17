"use client"

import type React from "react"
import { useRef, useEffect, useState, useCallback } from "react"
import * as soundstageExplorerAudio from '@/lib/audio/soundstageExplorerAudio'
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"

interface SoundstageExplorerProps {
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  disabled?: boolean
}

export function SoundstageExplorer({ isPlaying, setIsPlaying, disabled = false }: SoundstageExplorerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [dotPosition, setDotPosition] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 })
  const [isDragging, setIsDragging] = useState(false)

  // Audio settings
  const [bandwidth, setBandwidth] = useState(6) // Default: 6 octaves
  const [oscillationSpeed, setOscillationSpeed] = useState(1.5) // Default: 1.5 osc/second
  const [soundMode, setSoundMode] = useState<'sloped' | 'bandpassed' | 'sine'>('bandpassed')

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
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setBandwidth(bandwidth)
    player.setOscillationSpeed(oscillationSpeed)
    player.setSoundMode(soundMode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle playing state
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
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

  // Update position when dot moves
  useEffect(() => {
    if (isPlaying && !disabled) {
      const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
      player.updatePosition(dotPosition.x, dotPosition.y)
    }
  }, [dotPosition.x, dotPosition.y, isPlaying, disabled])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Draw background grid (optional, subtle)
    ctx.strokeStyle = isDarkMode ? "#27272a" : "#e2e8f0"
    ctx.lineWidth = 1

    // Vertical center line
    ctx.beginPath()
    ctx.moveTo(rect.width / 2, 0)
    ctx.lineTo(rect.width / 2, rect.height)
    ctx.stroke()

    // Horizontal center line
    ctx.beginPath()
    ctx.moveTo(0, rect.height / 2)
    ctx.lineTo(rect.width, rect.height / 2)
    ctx.stroke()

    // Draw dot
    const dotX = dotPosition.x * rect.width
    const dotY = dotPosition.y * rect.height
    const dotRadius = 12

    // Draw outer glow if playing
    if (isPlaying && !disabled) {
      ctx.beginPath()
      ctx.arc(dotX, dotY, dotRadius + 8, 0, Math.PI * 2)
      const gradient = ctx.createRadialGradient(dotX, dotY, dotRadius, dotX, dotY, dotRadius + 8)
      gradient.addColorStop(0, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
      gradient.addColorStop(1, "rgba(56, 189, 248, 0)")
      ctx.fillStyle = gradient
      ctx.fill()
    }

    // Draw main dot
    ctx.beginPath()
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = disabled
      ? isDarkMode ? "#52525b" : "#cbd5e1"
      : isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600
    ctx.fill()

    // Draw inner highlight
    ctx.beginPath()
    ctx.arc(dotX - dotRadius / 3, dotY - dotRadius / 3, dotRadius / 3, 0, Math.PI * 2)
    ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
    ctx.fill()

  }, [dotPosition, isDarkMode, isPlaying, disabled])

  const updateDotPosition = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || disabled) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    setDotPosition({ x, y })
  }, [disabled])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    setIsDragging(true)
    updateDotPosition(e)

    // Auto-start playing when dragging starts
    if (!isPlaying) {
      setIsPlaying(true)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || disabled) return
    updateDotPosition(e)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false)
    }

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging && !disabled) {
        updateDotPosition(e)
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    window.addEventListener('mousemove', handleGlobalMouseMove)

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      window.removeEventListener('mousemove', handleGlobalMouseMove)
    }
  }, [isDragging, disabled, updateDotPosition])

  const handleBandwidthChange = (value: number[]) => {
    const newBandwidth = value[0]
    setBandwidth(newBandwidth)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setBandwidth(newBandwidth)
  }

  const handleOscillationSpeedChange = (value: number[]) => {
    const newSpeed = value[0]
    setOscillationSpeed(newSpeed)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setOscillationSpeed(newSpeed)
  }

  const handleSoundModeChange = (value: 'sloped' | 'bandpassed' | 'sine') => {
    setSoundMode(value)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setSoundMode(value)
  }

  return (
    <div className="space-y-4">
      {/* Soundstage Canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[4/3] bg-background border ${
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair'
          } ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ touchAction: 'none' }}
        />
        <div className="absolute top-2 left-2 text-xs text-muted-foreground">
          Drag to explore
        </div>
      </div>

      {/* Controls */}
      <Card className="p-4 space-y-4">
        {/* Bandwidth Control */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="bandwidth">Bandwidth</Label>
            <span className="text-sm text-muted-foreground">{bandwidth.toFixed(1)} octaves</span>
          </div>
          <Slider
            id="bandwidth"
            min={0.5}
            max={10}
            step={0.5}
            value={[bandwidth]}
            onValueChange={handleBandwidthChange}
            disabled={disabled}
          />
        </div>

        {/* Oscillation Speed Control */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="oscillation-speed">Volume Oscillation Speed</Label>
            <span className="text-sm text-muted-foreground">{oscillationSpeed.toFixed(1)} osc/sec</span>
          </div>
          <Slider
            id="oscillation-speed"
            min={0.1}
            max={5}
            step={0.1}
            value={[oscillationSpeed]}
            onValueChange={handleOscillationSpeedChange}
            disabled={disabled}
          />
        </div>

        {/* Sound Mode Control */}
        <div className="space-y-2">
          <Label htmlFor="sound-mode">Sound Mode</Label>
          <Select
            value={soundMode}
            onValueChange={handleSoundModeChange}
            disabled={disabled}
          >
            <SelectTrigger id="sound-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bandpassed">Bandpassed Noise</SelectItem>
              <SelectItem value="sloped">Sloped Noise</SelectItem>
              <SelectItem value="sine">Sine Tone</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Instructions */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p><strong>Instructions:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Drag the dot anywhere in the soundstage to hear how it sounds</li>
          <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
          <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
          <li>Volume automatically oscillates at the set speed</li>
          <li>Sound plays continuously while active</li>
        </ul>
      </div>
    </div>
  )
}

export default SoundstageExplorer
