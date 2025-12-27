"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"
import * as multiDot3DAudio from '@/lib/audio/multiDot3DAudio'
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface MultiDot3DExplorerProps {
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  disabled?: boolean
}

interface Dot {
  id: string
  x: number // 0 to 1
  y: number // 0 to 1
  z: number // 0 to 1 (depth: 0 = far, 1 = close)
}

export function MultiDot3DExplorer({ isPlaying, setIsPlaying, disabled = false }: MultiDot3DExplorerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [dots, setDots] = useState<Dot[]>([])
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null)
  const [nextDotId, setNextDotId] = useState(1)

  // Audio settings
  const [bandwidth, setBandwidth] = useState(6) // Default: 6 octaves
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
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    player.setBandwidth(bandwidth)
    player.setSoundMode(soundMode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle playing state
  useEffect(() => {
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    if (isPlaying && !disabled) {
      player.startPlaying()
    } else {
      player.stopPlaying()
      // Clear all dots when stopping
      setDots([])
      setSelectedDotId(null)
    }

    return () => {
      if (isPlaying) {
        player.stopPlaying()
      }
    }
  }, [isPlaying, disabled])

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

    // Draw background grid
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

    // Draw dots
    dots.forEach(dot => {
      const dotX = dot.x * rect.width
      const dotY = dot.y * rect.height

      // Size based on depth (z): closer = larger
      const minRadius = 6
      const maxRadius = 16
      const dotRadius = minRadius + (maxRadius - minRadius) * dot.z

      // Opacity based on depth: closer = more opaque
      const minOpacity = 0.3
      const maxOpacity = 1.0
      const opacity = minOpacity + (maxOpacity - minOpacity) * dot.z

      const isSelected = dot.id === selectedDotId

      // Draw outer selection ring if selected
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(dotX, dotY, dotRadius + 6, 0, Math.PI * 2)
        ctx.strokeStyle = isDarkMode ? "#fbbf24" : "#f59e0b"
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Draw outer glow
      ctx.beginPath()
      ctx.arc(dotX, dotY, dotRadius + 4, 0, Math.PI * 2)
      const gradient = ctx.createRadialGradient(dotX, dotY, dotRadius, dotX, dotY, dotRadius + 4)
      gradient.addColorStop(0, isDarkMode ? `rgba(56, 189, 248, ${opacity * 0.3})` : `rgba(2, 132, 199, ${opacity * 0.3})`)
      gradient.addColorStop(1, "rgba(56, 189, 248, 0)")
      ctx.fillStyle = gradient
      ctx.fill()

      // Draw main dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? `rgba(82, 82, 91, ${opacity})` : `rgba(203, 213, 225, ${opacity})`
        : isDarkMode ? `rgba(56, 189, 248, ${opacity})` : `rgba(2, 132, 199, ${opacity})` // sky-400 or sky-600
      ctx.fill()

      // Draw inner highlight
      ctx.beginPath()
      ctx.arc(dotX - dotRadius / 3, dotY - dotRadius / 3, dotRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.5})`
      ctx.fill()

      // Draw dot ID label
      ctx.fillStyle = isDarkMode ? "#ffffff" : "#000000"
      ctx.font = "10px sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(dot.id, dotX, dotY)
    })

  }, [dots, selectedDotId, isDarkMode, disabled])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    // Auto-start playing if not already playing
    if (!isPlaying) {
      setIsPlaying(true)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    // Check if clicking on an existing dot
    const clickX = x * rect.width
    const clickY = y * rect.height

    let clickedDot: Dot | null = null
    for (const dot of dots) {
      const dotX = dot.x * rect.width
      const dotY = dot.y * rect.height
      const minRadius = 6
      const maxRadius = 16
      const dotRadius = minRadius + (maxRadius - minRadius) * dot.z

      const dist = Math.sqrt((clickX - dotX) ** 2 + (clickY - dotY) ** 2)
      if (dist < dotRadius + 6) {
        clickedDot = dot
        break
      }
    }

    if (clickedDot) {
      // Select existing dot
      setSelectedDotId(clickedDot.id)
    } else {
      // Add new dot with default depth of 0.5
      const newDot: Dot = {
        id: `${nextDotId}`,
        x,
        y,
        z: 0.5 // Default depth (middle)
      }

      setDots(prev => [...prev, newDot])
      setNextDotId(prev => prev + 1)
      setSelectedDotId(newDot.id)

      // Add to audio
      const player = multiDot3DAudio.getMultiDot3DPlayer()
      player.addDot(newDot.id, newDot.x, newDot.y, newDot.z)
    }
  }

  const handleDepthChange = (value: number[]) => {
    if (!selectedDotId) return

    const newZ = value[0]

    setDots(prev => prev.map(dot =>
      dot.id === selectedDotId ? { ...dot, z: newZ } : dot
    ))

    // Update audio
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    const selectedDot = dots.find(d => d.id === selectedDotId)
    if (selectedDot) {
      player.updateDotPosition(selectedDotId, selectedDot.x, selectedDot.y, newZ)
    }
  }

  const handleDeleteDot = () => {
    if (!selectedDotId) return

    setDots(prev => prev.filter(dot => dot.id !== selectedDotId))

    // Remove from audio
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    player.removeDot(selectedDotId)

    setSelectedDotId(null)
  }

  const handleClearAllDots = () => {
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    dots.forEach(dot => player.removeDot(dot.id))
    setDots([])
    setSelectedDotId(null)
  }

  const handleBandwidthChange = (value: number[]) => {
    const newBandwidth = value[0]
    setBandwidth(newBandwidth)
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    player.setBandwidth(newBandwidth)
  }

  const handleSoundModeChange = (value: 'sloped' | 'bandpassed' | 'sine') => {
    setSoundMode(value)
    const player = multiDot3DAudio.getMultiDot3DPlayer()
    player.setSoundMode(value)
  }

  const selectedDot = dots.find(d => d.id === selectedDotId)

  return (
    <div className="space-y-4">
      {/* Soundstage Canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[4/3] bg-background border ${
            disabled || !isPlaying ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair'
          } ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}
          onClick={handleCanvasClick}
          style={{ touchAction: 'none' }}
        />
        <div className="absolute top-2 left-2 text-xs text-muted-foreground">
          {isPlaying ? 'Click to add or select dots' : 'Start playing to add dots'}
        </div>
        <div className="absolute top-2 right-2 text-xs text-muted-foreground">
          {dots.length} dot{dots.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Controls */}
      <Card className="p-4 space-y-4">
        {/* Selected Dot Controls */}
        {selectedDot && (
          <>
            <div className="pb-2 border-b">
              <h3 className="text-sm font-medium">Dot {selectedDot.id} Controls</h3>
            </div>

            {/* Depth Control */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="depth">Depth (Z-axis)</Label>
                <span className="text-sm text-muted-foreground">
                  {(selectedDot.z * 100).toFixed(0)}% {selectedDot.z > 0.7 ? '(close)' : selectedDot.z < 0.3 ? '(far)' : '(mid)'}
                </span>
              </div>
              <Slider
                id="depth"
                min={0}
                max={1}
                step={0.01}
                value={[selectedDot.z]}
                onValueChange={handleDepthChange}
                disabled={disabled}
              />
            </div>

            {/* Delete Button */}
            <Button
              onClick={handleDeleteDot}
              variant="destructive"
              size="sm"
              disabled={disabled}
              className="w-full"
            >
              Delete Dot {selectedDot.id}
            </Button>
          </>
        )}

        {/* Global Controls */}
        <div className="space-y-4 pt-2 border-t">
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

          {/* Clear All Button */}
          {dots.length > 0 && (
            <Button
              onClick={handleClearAllDots}
              variant="outline"
              size="sm"
              disabled={disabled}
              className="w-full"
            >
              Clear All Dots
            </Button>
          )}
        </div>
      </Card>

      {/* Instructions */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p><strong>Instructions:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Click anywhere on the canvas to add a new dot</li>
          <li>Click on an existing dot to select it</li>
          <li>Use the Depth slider to move selected dot closer (louder) or farther (quieter)</li>
          <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
          <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
          <li>Depth (Z) controls volume: closer dots are larger, brighter, and louder</li>
          <li>All dots play simultaneously</li>
        </ul>
      </div>
    </div>
  )
}

export default MultiDot3DExplorer
