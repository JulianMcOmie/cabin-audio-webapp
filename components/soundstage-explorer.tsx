"use client"

import type React from "react"
import { useRef, useEffect, useState, useCallback } from "react"
import * as soundstageExplorerAudio from '@/lib/audio/soundstageExplorerAudio'
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Play, Pause } from "lucide-react"

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

  // Mode settings
  const [mode, setMode] = useState<'dot' | 'line' | 'chevron' | 's-shape' | 'fade-line' | 'hit' | 'x-pattern'>('dot')
  const [lineEndpoint1, setLineEndpoint1] = useState<{ x: number; y: number }>({ x: 0.3, y: 0.5 })
  const [lineEndpoint2, setLineEndpoint2] = useState<{ x: number; y: number }>({ x: 0.7, y: 0.5 })
  const [draggingEndpoint, setDraggingEndpoint] = useState<'none' | 'endpoint1' | 'endpoint2'>('none')

  // Fade line mode settings (reuses lineEndpoint1 and lineEndpoint2)
  const [fadeLineEndpoint1, setFadeLineEndpoint1] = useState<{ x: number; y: number }>({ x: 0.3, y: 0.5 })
  const [fadeLineEndpoint2, setFadeLineEndpoint2] = useState<{ x: number; y: number }>({ x: 0.7, y: 0.5 })
  const [draggingFadeLineEndpoint, setDraggingFadeLineEndpoint] = useState<'none' | 'endpoint1' | 'endpoint2'>('none')

  // Chevron mode settings
  const [chevronCenter, setChevronCenter] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 })
  const [chevronScaleX, setChevronScaleX] = useState(0.3) // Scale in x direction (0 to 1)
  const [chevronScaleY, setChevronScaleY] = useState(0.3) // Scale in y direction (0 to 1)
  const [isDraggingChevron, setIsDraggingChevron] = useState(false)

  // S-shape mode settings
  const [sShapeCenter, setSShapeCenter] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 })
  const [sShapeWidth, setSShapeWidth] = useState(0.3) // Width of horizontal lines (0 to 1)
  const [sShapeHeight, setSShapeHeight] = useState(0.4) // Height of entire S shape (0 to 1)
  const [isDraggingSShape, setIsDraggingSShape] = useState(false)

  // X-pattern mode settings
  const [xPatternCenter, setXPatternCenter] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 })
  const [xPatternSize, setXPatternSize] = useState(0.4) // Size of the X (0 to 1)
  const [isDraggingXPattern, setIsDraggingXPattern] = useState(false)

  // Endpoint volume settings (in dB)
  const [endpoint1VolumeDb, setEndpoint1VolumeDb] = useState(0) // Default: 0 dB (full volume)
  const [endpoint2VolumeDb, setEndpoint2VolumeDb] = useState(0) // Default: 0 dB (full volume)

  // Audio settings
  const [bandwidth, setBandwidth] = useState(6) // Default: 6 octaves
  const [positionOscillationSpeed, setPositionOscillationSpeed] = useState(1.5) // Default: 1.5 osc/second for position
  const [volumeOscillationSpeed, setVolumeOscillationSpeed] = useState(0.5) // Default: 0.5 osc/second for volume
  const [soundMode, setSoundMode] = useState<'sloped' | 'bandpassed' | 'sine'>('bandpassed')
  const [volumeOscillationEnabled, setVolumeOscillationEnabled] = useState(true) // Default: volume oscillation enabled
  const [positionOscillationEnabled, setPositionOscillationEnabled] = useState(true) // Default: position oscillation enabled
  const [volumeOscillationMinDb, setVolumeOscillationMinDb] = useState(-60) // Default: -60 dB minimum (lower than previous -12 dB)

  // Hit mode settings
  const [hitRate, setHitRate] = useState(2) // Default: 2 hits per second
  const [hitAttackTime, setHitAttackTime] = useState(0.01) // Default: 10ms attack
  const [hitReleaseTime, setHitReleaseTime] = useState(0.1) // Default: 100ms release
  const [hitVolume, setHitVolume] = useState(0.8) // Default: 80% volume

  // Flicker settings
  const [flickerEnabled, setFlickerEnabled] = useState(true) // Default: flicker ON
  const [flickerSpeed, setFlickerSpeed] = useState(20) // Default: 20 Hz

  // Multi-dot mode
  const [additionalDots, setAdditionalDots] = useState<Array<{ x: number; y: number }>>([])
  const [selectedDotIndex, setSelectedDotIndex] = useState<number>(-1) // -1 = main dot, 0+ = additional dots

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
    player.setPositionOscillationSpeed(positionOscillationSpeed)
    player.setVolumeOscillationSpeed(volumeOscillationSpeed)
    player.setSoundMode(soundMode)
    player.setLineMode(mode === 'line')
    player.setLineEndpoints(lineEndpoint1, lineEndpoint2)
    player.setVolumeOscillationEnabled(volumeOscillationEnabled)
    player.setPositionOscillationEnabled(positionOscillationEnabled)
    player.setEndpointVolumes(endpoint1VolumeDb, endpoint2VolumeDb)
    player.setVolumeOscillationMinDb(volumeOscillationMinDb)
    player.setHitMode(mode === 'hit')
    player.setHitRate(hitRate)
    player.setHitAttackTime(hitAttackTime)
    player.setHitReleaseTime(hitReleaseTime)
    player.setHitVolume(hitVolume)
    player.setFlickerEnabled(flickerEnabled)
    player.setFlickerSpeed(flickerSpeed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update line mode and hit mode when mode changes
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setLineMode(mode === 'line')
    player.setHitMode(mode === 'hit')
  }, [mode])

  // Update line endpoints when they change
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setLineEndpoints(lineEndpoint1, lineEndpoint2)
  }, [lineEndpoint1, lineEndpoint2])

  // Update volume oscillation enabled when it changes
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setVolumeOscillationEnabled(volumeOscillationEnabled)
  }, [volumeOscillationEnabled])

  // Update position oscillation enabled when it changes
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setPositionOscillationEnabled(positionOscillationEnabled)
  }, [positionOscillationEnabled])

  // Update endpoint volumes when they change
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setEndpointVolumes(endpoint1VolumeDb, endpoint2VolumeDb)
  }, [endpoint1VolumeDb, endpoint2VolumeDb])

  // Update volume oscillation minimum dB when it changes
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setVolumeOscillationMinDb(volumeOscillationMinDb)
  }, [volumeOscillationMinDb])

  // Update hit mode settings when they change
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setHitRate(hitRate)
  }, [hitRate])

  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setHitAttackTime(hitAttackTime)
  }, [hitAttackTime])

  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setHitReleaseTime(hitReleaseTime)
  }, [hitReleaseTime])

  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setHitVolume(hitVolume)
  }, [hitVolume])

  // Update flicker enabled when it changes
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setFlickerEnabled(flickerEnabled)
  }, [flickerEnabled])

  // Update flicker speed when it changes
  useEffect(() => {
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setFlickerSpeed(flickerSpeed)
  }, [flickerSpeed])

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

      if (mode === 'dot' || (mode === 'line' && !positionOscillationEnabled) || mode === 'chevron' || mode === 's-shape' || mode === 'fade-line' || mode === 'hit' || mode === 'x-pattern') {
        // Update position in dot mode, chevron mode, s-shape mode, fade-line mode, hit mode, x-pattern mode, or in line mode when position oscillation is disabled
        player.updatePosition(dotPosition.x, dotPosition.y)
      }
    }
  }, [dotPosition.x, dotPosition.y, isPlaying, disabled, mode, positionOscillationEnabled])

  // Animate dot position in line mode (only when position oscillation is enabled)
  useEffect(() => {
    if (mode === 'line' && isPlaying && !disabled && positionOscillationEnabled) {
      let animationFrameId: number

      const startTime = Date.now()

      const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000
        const cycleProgress = (elapsed * positionOscillationSpeed) % 1
        // Triangle wave for linear movement
        const t = cycleProgress < 0.5
          ? cycleProgress * 2
          : 2 - cycleProgress * 2

        const currentX = lineEndpoint1.x + t * (lineEndpoint2.x - lineEndpoint1.x)
        const currentY = lineEndpoint1.y + t * (lineEndpoint2.y - lineEndpoint1.y)

        setDotPosition({ x: currentX, y: currentY })

        animationFrameId = requestAnimationFrame(animate)
      }

      animate()

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId)
        }
      }
    } else if (mode === 'line' && !positionOscillationEnabled) {
      // When position oscillation is disabled in line mode, set position to midpoint
      const midX = (lineEndpoint1.x + lineEndpoint2.x) / 2
      const midY = (lineEndpoint1.y + lineEndpoint2.y) / 2
      setDotPosition({ x: midX, y: midY })
    }
  }, [mode, isPlaying, disabled, positionOscillationEnabled, positionOscillationSpeed, lineEndpoint1, lineEndpoint2])

  // Animate dot position along chevron path in chevron mode
  useEffect(() => {
    if (mode === 'chevron' && isPlaying && !disabled) {
      let animationFrameId: number

      const startTime = Date.now()

      const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000
        const cycleProgress = (elapsed * positionOscillationSpeed) % 1

        // Chevron path: top -> tip -> bottom -> tip -> top
        // Define three points
        const topX = chevronCenter.x + chevronScaleX
        const topY = chevronCenter.y - chevronScaleY
        const tipX = chevronCenter.x - chevronScaleX
        const tipY = chevronCenter.y
        const bottomX = chevronCenter.x + chevronScaleX
        const bottomY = chevronCenter.y + chevronScaleY

        let currentX, currentY

        if (cycleProgress < 0.5) {
          // First half: move from top to tip to bottom
          const t = cycleProgress * 2 // 0 to 1
          if (t < 0.5) {
            // top to tip
            const segmentT = t * 2
            currentX = topX + segmentT * (tipX - topX)
            currentY = topY + segmentT * (tipY - topY)
          } else {
            // tip to bottom
            const segmentT = (t - 0.5) * 2
            currentX = tipX + segmentT * (bottomX - tipX)
            currentY = tipY + segmentT * (bottomY - tipY)
          }
        } else {
          // Second half: move from bottom back to top (reverse path)
          const t = (cycleProgress - 0.5) * 2 // 0 to 1
          if (t < 0.5) {
            // bottom to tip
            const segmentT = t * 2
            currentX = bottomX + segmentT * (tipX - bottomX)
            currentY = bottomY + segmentT * (tipY - bottomY)
          } else {
            // tip to top
            const segmentT = (t - 0.5) * 2
            currentX = tipX + segmentT * (topX - tipX)
            currentY = tipY + segmentT * (topY - tipY)
          }
        }

        setDotPosition({ x: currentX, y: currentY })

        animationFrameId = requestAnimationFrame(animate)
      }

      animate()

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId)
        }
      }
    }
  }, [mode, isPlaying, disabled, positionOscillationSpeed, chevronCenter, chevronScaleX, chevronScaleY])

  // Animate dot position along X-pattern path in x-pattern mode
  useEffect(() => {
    if (mode === 'x-pattern' && isPlaying && !disabled) {
      let animationFrameId: number

      const startTime = Date.now()

      const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000
        const cycleProgress = (elapsed * positionOscillationSpeed) % 1

        // X-pattern path has 4 segments forming an X:
        // 1. Top-left to bottom-right (first diagonal)
        // 2. Bottom-right to top-right (bottom edge)
        // 3. Top-right to bottom-left (second diagonal)
        // 4. Bottom-left to top-left (top edge)

        // Define the 4 corner points
        const topLeft = {
          x: xPatternCenter.x - xPatternSize / 2,
          y: xPatternCenter.y - xPatternSize / 2
        }
        const topRight = {
          x: xPatternCenter.x + xPatternSize / 2,
          y: xPatternCenter.y - xPatternSize / 2
        }
        const bottomLeft = {
          x: xPatternCenter.x - xPatternSize / 2,
          y: xPatternCenter.y + xPatternSize / 2
        }
        const bottomRight = {
          x: xPatternCenter.x + xPatternSize / 2,
          y: xPatternCenter.y + xPatternSize / 2
        }

        let currentX, currentY

        // Divide the cycle into 4 equal parts for the 4 segments
        if (cycleProgress < 0.25) {
          // Segment 1: top-left to bottom-right
          const t = cycleProgress * 4
          currentX = topLeft.x + t * (bottomRight.x - topLeft.x)
          currentY = topLeft.y + t * (bottomRight.y - topLeft.y)
        } else if (cycleProgress < 0.5) {
          // Segment 2: bottom-right to top-right
          const t = (cycleProgress - 0.25) * 4
          currentX = bottomRight.x + t * (topRight.x - bottomRight.x)
          currentY = bottomRight.y + t * (topRight.y - bottomRight.y)
        } else if (cycleProgress < 0.75) {
          // Segment 3: top-right to bottom-left
          const t = (cycleProgress - 0.5) * 4
          currentX = topRight.x + t * (bottomLeft.x - topRight.x)
          currentY = topRight.y + t * (bottomLeft.y - topRight.y)
        } else {
          // Segment 4: bottom-left to top-left
          const t = (cycleProgress - 0.75) * 4
          currentX = bottomLeft.x + t * (topLeft.x - bottomLeft.x)
          currentY = bottomLeft.y + t * (topLeft.y - bottomLeft.y)
        }

        setDotPosition({ x: currentX, y: currentY })

        animationFrameId = requestAnimationFrame(animate)
      }

      animate()

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId)
        }
      }
    }
  }, [mode, isPlaying, disabled, positionOscillationSpeed, xPatternCenter, xPatternSize])

  // Animate dot position along S-shape path in s-shape mode
  useEffect(() => {
    if (mode === 's-shape' && isPlaying && !disabled) {
      let animationFrameId: number

      const startTime = Date.now()

      const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000
        const cycleProgress = (elapsed * positionOscillationSpeed) % 1

        // S-shape path has 5 segments:
        // 1. Top horizontal (left to right)
        // 2. First vertical (top to middle)
        // 3. Middle horizontal (right to left)
        // 4. Second vertical (middle to bottom)
        // 5. Bottom horizontal (left to right)

        // Define the 6 corner points of the S
        const topLeft = {
          x: sShapeCenter.x - sShapeWidth / 2,
          y: sShapeCenter.y - sShapeHeight / 2
        }
        const topRight = {
          x: sShapeCenter.x + sShapeWidth / 2,
          y: sShapeCenter.y - sShapeHeight / 2
        }
        const midRight = {
          x: sShapeCenter.x + sShapeWidth / 2,
          y: sShapeCenter.y
        }
        const midLeft = {
          x: sShapeCenter.x - sShapeWidth / 2,
          y: sShapeCenter.y
        }
        const bottomLeft = {
          x: sShapeCenter.x - sShapeWidth / 2,
          y: sShapeCenter.y + sShapeHeight / 2
        }
        const bottomRight = {
          x: sShapeCenter.x + sShapeWidth / 2,
          y: sShapeCenter.y + sShapeHeight / 2
        }

        let currentX, currentY

        // Divide the cycle into forward (0 to 0.5) and backward (0.5 to 1)
        if (cycleProgress < 0.5) {
          // Forward path: topLeft -> topRight -> midRight -> midLeft -> bottomLeft -> bottomRight
          const t = cycleProgress * 2 // 0 to 1
          const segmentLength = 0.2 // Each of 5 segments takes 20% of the forward journey

          if (t < segmentLength) {
            // Segment 1: topLeft to topRight
            const segmentT = t / segmentLength
            currentX = topLeft.x + segmentT * (topRight.x - topLeft.x)
            currentY = topLeft.y + segmentT * (topRight.y - topLeft.y)
          } else if (t < segmentLength * 2) {
            // Segment 2: topRight to midRight
            const segmentT = (t - segmentLength) / segmentLength
            currentX = topRight.x + segmentT * (midRight.x - topRight.x)
            currentY = topRight.y + segmentT * (midRight.y - topRight.y)
          } else if (t < segmentLength * 3) {
            // Segment 3: midRight to midLeft
            const segmentT = (t - segmentLength * 2) / segmentLength
            currentX = midRight.x + segmentT * (midLeft.x - midRight.x)
            currentY = midRight.y + segmentT * (midLeft.y - midRight.y)
          } else if (t < segmentLength * 4) {
            // Segment 4: midLeft to bottomLeft
            const segmentT = (t - segmentLength * 3) / segmentLength
            currentX = midLeft.x + segmentT * (bottomLeft.x - midLeft.x)
            currentY = midLeft.y + segmentT * (bottomLeft.y - midLeft.y)
          } else {
            // Segment 5: bottomLeft to bottomRight
            const segmentT = (t - segmentLength * 4) / segmentLength
            currentX = bottomLeft.x + segmentT * (bottomRight.x - bottomLeft.x)
            currentY = bottomLeft.y + segmentT * (bottomRight.y - bottomLeft.y)
          }
        } else {
          // Backward path: bottomRight -> bottomLeft -> midLeft -> midRight -> topRight -> topLeft
          const t = (cycleProgress - 0.5) * 2 // 0 to 1
          const segmentLength = 0.2

          if (t < segmentLength) {
            // Segment 1: bottomRight to bottomLeft
            const segmentT = t / segmentLength
            currentX = bottomRight.x + segmentT * (bottomLeft.x - bottomRight.x)
            currentY = bottomRight.y + segmentT * (bottomLeft.y - bottomRight.y)
          } else if (t < segmentLength * 2) {
            // Segment 2: bottomLeft to midLeft
            const segmentT = (t - segmentLength) / segmentLength
            currentX = bottomLeft.x + segmentT * (midLeft.x - bottomLeft.x)
            currentY = bottomLeft.y + segmentT * (midLeft.y - bottomLeft.y)
          } else if (t < segmentLength * 3) {
            // Segment 3: midLeft to midRight
            const segmentT = (t - segmentLength * 2) / segmentLength
            currentX = midLeft.x + segmentT * (midRight.x - midLeft.x)
            currentY = midLeft.y + segmentT * (midRight.y - midLeft.y)
          } else if (t < segmentLength * 4) {
            // Segment 4: midRight to topRight
            const segmentT = (t - segmentLength * 3) / segmentLength
            currentX = midRight.x + segmentT * (topRight.x - midRight.x)
            currentY = midRight.y + segmentT * (topRight.y - midRight.y)
          } else {
            // Segment 5: topRight to topLeft
            const segmentT = (t - segmentLength * 4) / segmentLength
            currentX = topRight.x + segmentT * (topLeft.x - topRight.x)
            currentY = topRight.y + segmentT * (topLeft.y - topRight.y)
          }
        }

        setDotPosition({ x: currentX, y: currentY })

        animationFrameId = requestAnimationFrame(animate)
      }

      animate()

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId)
        }
      }
    }
  }, [mode, isPlaying, disabled, positionOscillationSpeed, sShapeCenter, sShapeWidth, sShapeHeight])

  // Animate dot position and volume along fade-line path in fade-line mode
  useEffect(() => {
    if (mode === 'fade-line' && isPlaying && !disabled) {
      let animationFrameId: number

      const startTime = Date.now()

      const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000
        const cycleProgress = (elapsed * positionOscillationSpeed) % 1

        let currentX, currentY, currentVolume

        // Each complete cycle has 2 sweeps:
        // Sweep 1 (0 to 0.5): endpoint1 to endpoint2, volume 0 → 1 → 0 (triangle wave)
        // Sweep 2 (0.5 to 1): endpoint2 to endpoint1, volume 0 → 1 → 0 (triangle wave)

        if (cycleProgress < 0.5) {
          // Forward sweep (endpoint1 → endpoint2)
          const sweepT = cycleProgress * 2 // 0 to 1
          currentX = fadeLineEndpoint1.x + sweepT * (fadeLineEndpoint2.x - fadeLineEndpoint1.x)
          currentY = fadeLineEndpoint1.y + sweepT * (fadeLineEndpoint2.y - fadeLineEndpoint1.y)
          // Triangle wave: quiet at start (0), loud at middle (1), quiet at end (0)
          currentVolume = sweepT < 0.5 ? sweepT * 2 : 2 - sweepT * 2
        } else {
          // Backward sweep (endpoint2 → endpoint1)
          const sweepT = (cycleProgress - 0.5) * 2 // 0 to 1
          currentX = fadeLineEndpoint2.x + sweepT * (fadeLineEndpoint1.x - fadeLineEndpoint2.x)
          currentY = fadeLineEndpoint2.y + sweepT * (fadeLineEndpoint1.y - fadeLineEndpoint2.y)
          // Triangle wave: quiet at start (0), loud at middle (1), quiet at end (0)
          currentVolume = sweepT < 0.5 ? sweepT * 2 : 2 - sweepT * 2
        }

        setDotPosition({ x: currentX, y: currentY })

        // Update volume in the audio player
        const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
        player.setManualVolume(currentVolume)

        animationFrameId = requestAnimationFrame(animate)
      }

      animate()

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId)
        }
        // Reset manual volume when leaving fade-line mode
        const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
        player.setManualVolume(null)
      }
    }
  }, [mode, isPlaying, disabled, positionOscillationSpeed, fadeLineEndpoint1, fadeLineEndpoint2])

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

    if (mode === 'dot' || mode === 'hit') {
      // Draw dot (same for both dot and hit mode)
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

      // Draw additional dots
      additionalDots.forEach((dot, index) => {
        const addDotX = dot.x * rect.width
        const addDotY = dot.y * rect.height
        const addDotRadius = 10

        // Draw outer glow if playing
        if (isPlaying && !disabled) {
          ctx.beginPath()
          ctx.arc(addDotX, addDotY, addDotRadius + 6, 0, Math.PI * 2)
          const gradient = ctx.createRadialGradient(addDotX, addDotY, addDotRadius, addDotX, addDotY, addDotRadius + 6)
          gradient.addColorStop(0, isDarkMode ? "rgba(251, 191, 36, 0.3)" : "rgba(245, 158, 11, 0.3)")
          gradient.addColorStop(1, "rgba(251, 191, 36, 0)")
          ctx.fillStyle = gradient
          ctx.fill()
        }

        // Draw additional dot (amber/orange color to distinguish from main dot)
        ctx.beginPath()
        ctx.arc(addDotX, addDotY, addDotRadius, 0, Math.PI * 2)
        ctx.fillStyle = disabled
          ? isDarkMode ? "#52525b" : "#cbd5e1"
          : isDarkMode ? "#fbbf24" : "#f59e0b" // amber-400 or amber-500
        ctx.fill()

        // Draw inner highlight
        ctx.beginPath()
        ctx.arc(addDotX - addDotRadius / 3, addDotY - addDotRadius / 3, addDotRadius / 3, 0, Math.PI * 2)
        ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
        ctx.fill()

        // Draw dot number label
        ctx.font = "10px system-ui, sans-serif"
        ctx.fillStyle = isDarkMode ? "#000" : "#fff"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(String(index + 1), addDotX, addDotY)
      })
    } else if (mode === 'line') {
      // Line mode - draw line between endpoints and moving dot
      const endpoint1X = lineEndpoint1.x * rect.width
      const endpoint1Y = lineEndpoint1.y * rect.height
      const endpoint2X = lineEndpoint2.x * rect.width
      const endpoint2Y = lineEndpoint2.y * rect.height
      const endpointRadius = 10
      const movingDotRadius = 12

      // Draw line between endpoints
      ctx.beginPath()
      ctx.moveTo(endpoint1X, endpoint1Y)
      ctx.lineTo(endpoint2X, endpoint2Y)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw endpoint 1
      ctx.beginPath()
      ctx.arc(endpoint1X, endpoint1Y, endpointRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw endpoint 2
      ctx.beginPath()
      ctx.arc(endpoint2X, endpoint2Y, endpointRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw moving dot (current position)
      const dotX = dotPosition.x * rect.width
      const dotY = dotPosition.y * rect.height

      // Draw outer glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.arc(dotX, dotY, movingDotRadius + 8, 0, Math.PI * 2)
        const gradient = ctx.createRadialGradient(dotX, dotY, movingDotRadius, dotX, dotY, movingDotRadius + 8)
        gradient.addColorStop(0, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
        gradient.addColorStop(1, "rgba(56, 189, 248, 0)")
        ctx.fillStyle = gradient
        ctx.fill()
      }

      // Draw main moving dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, movingDotRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#71717a" : "#94a3b8"
        : isDarkMode ? "#fbbf24" : "#f59e0b" // amber color to distinguish from endpoints
      ctx.fill()

      // Draw inner highlight on moving dot
      ctx.beginPath()
      ctx.arc(dotX - movingDotRadius / 3, dotY - movingDotRadius / 3, movingDotRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()
    } else if (mode === 'x-pattern') {
      // X-pattern mode - draw X shape and moving dot
      const centerX = xPatternCenter.x * rect.width
      const centerY = xPatternCenter.y * rect.height
      const size = xPatternSize * Math.min(rect.width, rect.height) / 2

      // Calculate X pattern corner points
      const topLeft = {
        x: centerX - size,
        y: centerY - size
      }
      const topRight = {
        x: centerX + size,
        y: centerY - size
      }
      const bottomLeft = {
        x: centerX - size,
        y: centerY + size
      }
      const bottomRight = {
        x: centerX + size,
        y: centerY + size
      }

      // Draw X lines (two diagonals)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      // First diagonal: top-left to bottom-right
      ctx.beginPath()
      ctx.moveTo(topLeft.x, topLeft.y)
      ctx.lineTo(bottomRight.x, bottomRight.y)
      ctx.stroke()

      // Second diagonal: top-right to bottom-left
      ctx.beginPath()
      ctx.moveTo(topRight.x, topRight.y)
      ctx.lineTo(bottomLeft.x, bottomLeft.y)
      ctx.stroke()

      // Draw the path that the dot follows (the edges connecting all 4 corners)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#3f3f46" : "#e2e8f0"
        : isDarkMode ? "#1e40af" : "#60a5fa"
      ctx.lineWidth = 1
      ctx.setLineDash([5, 5])

      ctx.beginPath()
      ctx.moveTo(topLeft.x, topLeft.y)
      ctx.lineTo(bottomRight.x, bottomRight.y)
      ctx.lineTo(topRight.x, topRight.y)
      ctx.lineTo(bottomLeft.x, bottomLeft.y)
      ctx.lineTo(topLeft.x, topLeft.y)
      ctx.stroke()
      ctx.setLineDash([])

      // Draw center point (for dragging)
      const centerRadius = 8
      ctx.beginPath()
      ctx.arc(centerX, centerY, centerRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw moving dot (current position along X-pattern)
      const dotX = dotPosition.x * rect.width
      const dotY = dotPosition.y * rect.height
      const movingDotRadius = 12

      // Draw outer glow
      ctx.beginPath()
      ctx.arc(dotX, dotY, movingDotRadius + 8, 0, Math.PI * 2)
      const gradient = ctx.createRadialGradient(dotX, dotY, movingDotRadius, dotX, dotY, movingDotRadius + 8)
      gradient.addColorStop(0, disabled
        ? isDarkMode ? "rgba(82, 82, 91, 0.3)" : "rgba(203, 213, 225, 0.3)"
        : isDarkMode ? "rgba(251, 191, 36, 0.3)" : "rgba(245, 158, 11, 0.3)")
      gradient.addColorStop(1, "rgba(251, 191, 36, 0)")
      ctx.fillStyle = gradient
      ctx.fill()

      // Draw main moving dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, movingDotRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#fbbf24" : "#f59e0b"
      ctx.fill()

      // Draw inner highlight on moving dot
      ctx.beginPath()
      ctx.arc(dotX - movingDotRadius / 3, dotY - movingDotRadius / 3, movingDotRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()
    } else if (mode === 'chevron') {
      // Chevron mode - draw < shape and moving dot
      const centerX = chevronCenter.x * rect.width
      const centerY = chevronCenter.y * rect.height
      const scaleX = chevronScaleX * rect.width
      const scaleY = chevronScaleY * rect.height

      // Calculate chevron points (< shape pointing left)
      const tipX = centerX - scaleX
      const tipY = centerY
      const topX = centerX + scaleX
      const topY = centerY - scaleY
      const bottomX = centerX + scaleX
      const bottomY = centerY + scaleY

      // Draw chevron lines
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      ctx.moveTo(topX, topY)
      ctx.lineTo(tipX, tipY)
      ctx.lineTo(bottomX, bottomY)
      ctx.stroke()

      // Draw center point (for dragging)
      const centerRadius = 8
      ctx.beginPath()
      ctx.arc(centerX, centerY, centerRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw moving dot (current position along chevron)
      const dotX = dotPosition.x * rect.width
      const dotY = dotPosition.y * rect.height
      const movingDotRadius = 12

      // Draw outer glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.arc(dotX, dotY, movingDotRadius + 8, 0, Math.PI * 2)
        const gradient = ctx.createRadialGradient(dotX, dotY, movingDotRadius, dotX, dotY, movingDotRadius + 8)
        gradient.addColorStop(0, isDarkMode ? "rgba(251, 191, 36, 0.3)" : "rgba(245, 158, 11, 0.3)")
        gradient.addColorStop(1, "rgba(251, 191, 36, 0)")
        ctx.fillStyle = gradient
        ctx.fill()
      }

      // Draw main moving dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, movingDotRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#71717a" : "#94a3b8"
        : isDarkMode ? "#fbbf24" : "#f59e0b" // amber color
      ctx.fill()

      // Draw inner highlight on moving dot
      ctx.beginPath()
      ctx.arc(dotX - movingDotRadius / 3, dotY - movingDotRadius / 3, movingDotRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()
    } else if (mode === 's-shape') {
      // S-shape mode - draw squared-off S and moving dot
      const centerX = sShapeCenter.x * rect.width
      const centerY = sShapeCenter.y * rect.height
      const width = sShapeWidth * rect.width
      const height = sShapeHeight * rect.height

      // Calculate the 6 corner points of the S
      const topLeft = {
        x: centerX - width / 2,
        y: centerY - height / 2
      }
      const topRight = {
        x: centerX + width / 2,
        y: centerY - height / 2
      }
      const midRight = {
        x: centerX + width / 2,
        y: centerY
      }
      const midLeft = {
        x: centerX - width / 2,
        y: centerY
      }
      const bottomLeft = {
        x: centerX - width / 2,
        y: centerY + height / 2
      }
      const bottomRight = {
        x: centerX + width / 2,
        y: centerY + height / 2
      }

      // Draw S-shape path
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      ctx.moveTo(topLeft.x, topLeft.y)
      ctx.lineTo(topRight.x, topRight.y)
      ctx.lineTo(midRight.x, midRight.y)
      ctx.lineTo(midLeft.x, midLeft.y)
      ctx.lineTo(bottomLeft.x, bottomLeft.y)
      ctx.lineTo(bottomRight.x, bottomRight.y)
      ctx.stroke()

      // Draw center point (for dragging)
      const centerRadius = 8
      ctx.beginPath()
      ctx.arc(centerX, centerY, centerRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw moving dot (current position along S-shape)
      const dotX = dotPosition.x * rect.width
      const dotY = dotPosition.y * rect.height
      const movingDotRadius = 12

      // Draw outer glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.arc(dotX, dotY, movingDotRadius + 8, 0, Math.PI * 2)
        const gradient = ctx.createRadialGradient(dotX, dotY, movingDotRadius, dotX, dotY, movingDotRadius + 8)
        gradient.addColorStop(0, isDarkMode ? "rgba(251, 191, 36, 0.3)" : "rgba(245, 158, 11, 0.3)")
        gradient.addColorStop(1, "rgba(251, 191, 36, 0)")
        ctx.fillStyle = gradient
        ctx.fill()
      }

      // Draw main moving dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, movingDotRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#71717a" : "#94a3b8"
        : isDarkMode ? "#fbbf24" : "#f59e0b" // amber color
      ctx.fill()

      // Draw inner highlight on moving dot
      ctx.beginPath()
      ctx.arc(dotX - movingDotRadius / 3, dotY - movingDotRadius / 3, movingDotRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()
    } else if (mode === 'fade-line') {
      // Fade-line mode - draw line between endpoints and moving dot (similar to line mode)
      const endpoint1X = fadeLineEndpoint1.x * rect.width
      const endpoint1Y = fadeLineEndpoint1.y * rect.height
      const endpoint2X = fadeLineEndpoint2.x * rect.width
      const endpoint2Y = fadeLineEndpoint2.y * rect.height
      const endpointRadius = 10
      const movingDotRadius = 12

      // Draw line between endpoints with gradient to indicate fade behavior
      const gradient = ctx.createLinearGradient(endpoint1X, endpoint1Y, endpoint2X, endpoint2Y)
      if (disabled) {
        gradient.addColorStop(0, isDarkMode ? "#52525b" : "#cbd5e1")
        gradient.addColorStop(0.5, isDarkMode ? "#71717a" : "#94a3b8")
        gradient.addColorStop(1, isDarkMode ? "#52525b" : "#cbd5e1")
      } else {
        gradient.addColorStop(0, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
        gradient.addColorStop(0.5, isDarkMode ? "#38bdf8" : "#0284c7")
        gradient.addColorStop(1, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
      }

      ctx.beginPath()
      ctx.moveTo(endpoint1X, endpoint1Y)
      ctx.lineTo(endpoint2X, endpoint2Y)
      ctx.strokeStyle = gradient
      ctx.lineWidth = 3
      ctx.stroke()

      // Draw endpoint 1
      ctx.beginPath()
      ctx.arc(endpoint1X, endpoint1Y, endpointRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw endpoint 2
      ctx.beginPath()
      ctx.arc(endpoint2X, endpoint2Y, endpointRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()
      ctx.strokeStyle = isDarkMode ? "#1f2937" : "#f8fafc"
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw moving dot (current position)
      const dotX = dotPosition.x * rect.width
      const dotY = dotPosition.y * rect.height

      // Draw outer glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.arc(dotX, dotY, movingDotRadius + 8, 0, Math.PI * 2)
        const dotGradient = ctx.createRadialGradient(dotX, dotY, movingDotRadius, dotX, dotY, movingDotRadius + 8)
        dotGradient.addColorStop(0, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
        dotGradient.addColorStop(1, "rgba(56, 189, 248, 0)")
        ctx.fillStyle = dotGradient
        ctx.fill()
      }

      // Draw main moving dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, movingDotRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#71717a" : "#94a3b8"
        : isDarkMode ? "#fbbf24" : "#f59e0b" // amber color to distinguish from endpoints
      ctx.fill()

      // Draw inner highlight on moving dot
      ctx.beginPath()
      ctx.arc(dotX - movingDotRadius / 3, dotY - movingDotRadius / 3, movingDotRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()
    }

  }, [dotPosition, lineEndpoint1, lineEndpoint2, chevronCenter, chevronScaleX, chevronScaleY, sShapeCenter, sShapeWidth, sShapeHeight, fadeLineEndpoint1, fadeLineEndpoint2, xPatternCenter, xPatternSize, mode, isDarkMode, isPlaying, disabled, additionalDots])

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

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    if (mode === 'dot' || mode === 'hit') {
      // Right-click to delete nearest additional dot
      if (e.button === 2) {
        e.preventDefault()
        if (additionalDots.length > 0) {
          // Find nearest additional dot
          let nearestIndex = -1
          let nearestDist = Infinity
          additionalDots.forEach((dot, index) => {
            const dist = Math.sqrt((dot.x - x) ** 2 + (dot.y - y) ** 2)
            if (dist < nearestDist) {
              nearestDist = dist
              nearestIndex = index
            }
          })
          // Delete if within reasonable distance (0.1 normalized units)
          if (nearestIndex >= 0 && nearestDist < 0.15) {
            setAdditionalDots(prev => prev.filter((_, i) => i !== nearestIndex))
          }
        }
        return
      }

      // Option/Alt + click to add a new dot
      if (e.altKey) {
        setAdditionalDots(prev => [...prev, { x, y }])
        // Auto-start playing when adding dot
        if (!isPlaying) {
          setIsPlaying(true)
        }
        return
      }

      // Check if clicking on an additional dot to drag it
      let clickedAdditionalDot = -1
      additionalDots.forEach((dot, index) => {
        const dist = Math.sqrt((dot.x - x) ** 2 + (dot.y - y) ** 2)
        if (dist < 0.05) { // Within 5% of canvas
          clickedAdditionalDot = index
        }
      })

      if (clickedAdditionalDot >= 0) {
        setSelectedDotIndex(clickedAdditionalDot)
        setIsDragging(true)
      } else {
        // Check if clicking on main dot
        const mainDotDist = Math.sqrt((dotPosition.x - x) ** 2 + (dotPosition.y - y) ** 2)
        if (mainDotDist < 0.05 || additionalDots.length === 0) {
          setSelectedDotIndex(-1) // Main dot
          setIsDragging(true)
          updateDotPosition(e)
        }
      }

      // Auto-start playing when dragging starts
      if (!isPlaying) {
        setIsPlaying(true)
      }
    } else if (mode === 'line') {
      // Line mode - check which endpoint was clicked
      const clickX = x * rect.width
      const clickY = y * rect.height
      const endpoint1X = lineEndpoint1.x * rect.width
      const endpoint1Y = lineEndpoint1.y * rect.height
      const endpoint2X = lineEndpoint2.x * rect.width
      const endpoint2Y = lineEndpoint2.y * rect.height

      const dist1 = Math.sqrt((clickX - endpoint1X) ** 2 + (clickY - endpoint1Y) ** 2)
      const dist2 = Math.sqrt((clickX - endpoint2X) ** 2 + (clickY - endpoint2Y) ** 2)

      const endpointRadius = 10

      if (dist1 < endpointRadius * 2) {
        setDraggingEndpoint('endpoint1')
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      } else if (dist2 < endpointRadius * 2) {
        setDraggingEndpoint('endpoint2')
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      }
    } else if (mode === 'x-pattern') {
      // X-pattern mode - check if center was clicked
      const clickX = x * rect.width
      const clickY = y * rect.height
      const centerX = xPatternCenter.x * rect.width
      const centerY = xPatternCenter.y * rect.height

      const distToCenter = Math.sqrt((clickX - centerX) ** 2 + (clickY - centerY) ** 2)
      const centerRadius = 10

      if (distToCenter < centerRadius * 2) {
        setIsDraggingXPattern(true)
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      }
    } else if (mode === 'chevron') {
      // Chevron mode - check if center was clicked
      const clickX = x * rect.width
      const clickY = y * rect.height
      const centerX = chevronCenter.x * rect.width
      const centerY = chevronCenter.y * rect.height

      const distToCenter = Math.sqrt((clickX - centerX) ** 2 + (clickY - centerY) ** 2)
      const centerRadius = 10

      if (distToCenter < centerRadius * 2) {
        setIsDraggingChevron(true)
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      }
    } else if (mode === 's-shape') {
      // S-shape mode - check if center was clicked
      const clickX = x * rect.width
      const clickY = y * rect.height
      const centerX = sShapeCenter.x * rect.width
      const centerY = sShapeCenter.y * rect.height

      const distToCenter = Math.sqrt((clickX - centerX) ** 2 + (clickY - centerY) ** 2)
      const centerRadius = 10

      if (distToCenter < centerRadius * 2) {
        setIsDraggingSShape(true)
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      }
    } else if (mode === 'fade-line') {
      // Fade-line mode - check which endpoint was clicked
      const clickX = x * rect.width
      const clickY = y * rect.height
      const endpoint1X = fadeLineEndpoint1.x * rect.width
      const endpoint1Y = fadeLineEndpoint1.y * rect.height
      const endpoint2X = fadeLineEndpoint2.x * rect.width
      const endpoint2Y = fadeLineEndpoint2.y * rect.height

      const dist1 = Math.sqrt((clickX - endpoint1X) ** 2 + (clickY - endpoint1Y) ** 2)
      const dist2 = Math.sqrt((clickX - endpoint2X) ** 2 + (clickY - endpoint2Y) ** 2)

      const endpointRadius = 10

      if (dist1 < endpointRadius * 2) {
        setDraggingFadeLineEndpoint('endpoint1')
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      } else if (dist2 < endpointRadius * 2) {
        setDraggingFadeLineEndpoint('endpoint2')
        // Auto-start playing when dragging starts
        if (!isPlaying) {
          setIsPlaying(true)
        }
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    if ((mode === 'dot' || mode === 'hit') && isDragging) {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

      if (selectedDotIndex === -1) {
        // Dragging main dot
        updateDotPosition(e)
      } else {
        // Dragging additional dot
        setAdditionalDots(prev => prev.map((dot, i) =>
          i === selectedDotIndex ? { x, y } : dot
        ))
      }
    } else if (mode === 'line' && draggingEndpoint !== 'none') {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

      if (draggingEndpoint === 'endpoint1') {
        setLineEndpoint1({ x, y })
      } else if (draggingEndpoint === 'endpoint2') {
        setLineEndpoint2({ x, y })
      }
    } else if (mode === 'x-pattern' && isDraggingXPattern) {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

      setXPatternCenter({ x, y })
    } else if (mode === 'chevron' && isDraggingChevron) {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

      setChevronCenter({ x, y })
    } else if (mode === 's-shape' && isDraggingSShape) {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

      setSShapeCenter({ x, y })
    } else if (mode === 'fade-line' && draggingFadeLineEndpoint !== 'none') {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

      if (draggingFadeLineEndpoint === 'endpoint1') {
        setFadeLineEndpoint1({ x, y })
      } else if (draggingFadeLineEndpoint === 'endpoint2') {
        setFadeLineEndpoint2({ x, y })
      }
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setDraggingEndpoint('none')
    setIsDraggingChevron(false)
    setIsDraggingSShape(false)
    setIsDraggingXPattern(false)
    setDraggingFadeLineEndpoint('none')
  }

  // Global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false)
      setDraggingEndpoint('none')
      setIsDraggingChevron(false)
      setIsDraggingSShape(false)
      setIsDraggingXPattern(false)
      setDraggingFadeLineEndpoint('none')
    }

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (disabled) return

      if ((mode === 'dot' || mode === 'hit') && isDragging) {
        updateDotPosition(e)
      } else if (mode === 'line' && draggingEndpoint !== 'none') {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

        if (draggingEndpoint === 'endpoint1') {
          setLineEndpoint1({ x, y })
        } else if (draggingEndpoint === 'endpoint2') {
          setLineEndpoint2({ x, y })
        }
      } else if (mode === 'chevron' && isDraggingChevron) {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

        setChevronCenter({ x, y })
      } else if (mode === 's-shape' && isDraggingSShape) {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

        setSShapeCenter({ x, y })
      } else if (mode === 'fade-line' && draggingFadeLineEndpoint !== 'none') {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

        if (draggingFadeLineEndpoint === 'endpoint1') {
          setFadeLineEndpoint1({ x, y })
        } else if (draggingFadeLineEndpoint === 'endpoint2') {
          setFadeLineEndpoint2({ x, y })
        }
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    window.addEventListener('mousemove', handleGlobalMouseMove)

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      window.removeEventListener('mousemove', handleGlobalMouseMove)
    }
  }, [mode, isDragging, draggingEndpoint, isDraggingChevron, isDraggingSShape, isDraggingXPattern, draggingFadeLineEndpoint, disabled, updateDotPosition])

  const handleBandwidthChange = (value: number[]) => {
    const newBandwidth = value[0]
    setBandwidth(newBandwidth)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setBandwidth(newBandwidth)
  }

  const handlePositionOscillationSpeedChange = (value: number[]) => {
    const newSpeed = value[0]
    setPositionOscillationSpeed(newSpeed)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setPositionOscillationSpeed(newSpeed)
  }

  const handleVolumeOscillationSpeedChange = (value: number[]) => {
    const newSpeed = value[0]
    setVolumeOscillationSpeed(newSpeed)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setVolumeOscillationSpeed(newSpeed)
  }

  const handleSoundModeChange = (value: 'sloped' | 'bandpassed' | 'sine') => {
    setSoundMode(value)
    const player = soundstageExplorerAudio.getSoundstageExplorerPlayer()
    player.setSoundMode(value)
  }

  return (
    <div className="space-y-4">
      {/* Play/Pause Button */}
      <div className="flex justify-center">
        <Button
          onClick={() => setIsPlaying(!isPlaying)}
          disabled={disabled}
          variant={isPlaying ? "destructive" : "default"}
          size="lg"
          className="w-32"
        >
          {isPlaying ? (
            <>
              <Pause className="mr-2 h-5 w-5" />
              Pause
            </>
          ) : (
            <>
              <Play className="mr-2 h-5 w-5" />
              Play
            </>
          )}
        </Button>
      </div>

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
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none' }}
        />
        <div className="absolute top-2 left-2 text-xs text-muted-foreground">
          {mode === 'dot' || mode === 'hit' ? 'Drag • Opt+click add • Right-click delete' : mode === 'line' ? 'Drag endpoints to set path' : mode === 's-shape' ? 'Drag center to move • Audio follows S path' : mode === 'fade-line' ? 'Drag endpoints to set path • Volume auto-fades' : mode === 'x-pattern' ? 'Drag center to move • Audio follows X path' : 'Drag center to move • Audio follows path'}
        </div>
      </div>

      {/* Controls */}
      <Card className="p-4 space-y-4">
        {/* Mode Toggle */}
        <div className="space-y-2">
          <Label htmlFor="mode">Mode</Label>
          <Select
            value={mode}
            onValueChange={(value: 'dot' | 'line' | 'chevron' | 's-shape' | 'fade-line' | 'hit' | 'x-pattern') => setMode(value)}
            disabled={disabled}
          >
            <SelectTrigger id="mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dot">Dot (Manual Control)</SelectItem>
              <SelectItem value="line">Line (Auto Oscillation)</SelectItem>
              <SelectItem value="chevron">Chevron (Scalable Shape)</SelectItem>
              <SelectItem value="s-shape">S-Shape (Squared Path)</SelectItem>
              <SelectItem value="fade-line">Fade Line (Auto Volume)</SelectItem>
              <SelectItem value="hit">Hit (Repeating Hits)</SelectItem>
              <SelectItem value="x-pattern">X-Pattern (Diagonal Cross)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Chevron X Scale - Only show in chevron mode */}
        {mode === 'chevron' && (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="chevron-scale-x">Horizontal Scale</Label>
                <span className="text-xs text-muted-foreground">{(chevronScaleX * 100).toFixed(0)}%</span>
              </div>
              <Slider
                id="chevron-scale-x"
                min={0.05}
                max={0.5}
                step={0.01}
                value={[chevronScaleX]}
                onValueChange={(value) => setChevronScaleX(value[0])}
                disabled={disabled}
              />
            </div>

            {/* Chevron Y Scale */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="chevron-scale-y">Vertical Scale</Label>
                <span className="text-xs text-muted-foreground">{(chevronScaleY * 100).toFixed(0)}%</span>
              </div>
              <Slider
                id="chevron-scale-y"
                min={0.05}
                max={0.5}
                step={0.01}
                value={[chevronScaleY]}
                onValueChange={(value) => setChevronScaleY(value[0])}
                disabled={disabled}
              />
            </div>
          </>
        )}

        {/* S-Shape Controls - Only show in s-shape mode */}
        {mode === 's-shape' && (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="s-shape-width">S-Shape Width</Label>
                <span className="text-xs text-muted-foreground">{(sShapeWidth * 100).toFixed(0)}%</span>
              </div>
              <Slider
                id="s-shape-width"
                min={0.1}
                max={0.5}
                step={0.01}
                value={[sShapeWidth]}
                onValueChange={(value) => setSShapeWidth(value[0])}
                disabled={disabled}
              />
            </div>

            {/* S-Shape Height */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="s-shape-height">S-Shape Height</Label>
                <span className="text-xs text-muted-foreground">{(sShapeHeight * 100).toFixed(0)}%</span>
              </div>
              <Slider
                id="s-shape-height"
                min={0.1}
                max={0.8}
                step={0.01}
                value={[sShapeHeight]}
                onValueChange={(value) => setSShapeHeight(value[0])}
                disabled={disabled}
              />
            </div>
          </>
        )}

        {/* X-Pattern Controls - Only show in x-pattern mode */}
        {mode === 'x-pattern' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="x-pattern-size">X-Pattern Size</Label>
              <span className="text-xs text-muted-foreground">{(xPatternSize * 100).toFixed(0)}%</span>
            </div>
            <Slider
              id="x-pattern-size"
              min={0.1}
              max={0.5}
              step={0.01}
              value={[xPatternSize]}
              onValueChange={(value) => setXPatternSize(value[0])}
              disabled={disabled}
            />
          </div>
        )}

        {/* Hit Mode Controls - Only show in hit mode */}
        {mode === 'hit' && (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="hit-rate">Hit Rate</Label>
                <span className="text-xs text-muted-foreground">{hitRate.toFixed(1)} hits/sec</span>
              </div>
              <Slider
                id="hit-rate"
                min={0.1}
                max={20}
                step={0.1}
                value={[hitRate]}
                onValueChange={(value) => setHitRate(value[0])}
                disabled={disabled}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="hit-attack">Attack Time</Label>
                <span className="text-xs text-muted-foreground">{(hitAttackTime * 1000).toFixed(0)} ms</span>
              </div>
              <Slider
                id="hit-attack"
                min={0.001}
                max={2}
                step={0.001}
                value={[hitAttackTime]}
                onValueChange={(value) => setHitAttackTime(value[0])}
                disabled={disabled}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="hit-release">Release Time</Label>
                <span className="text-xs text-muted-foreground">{(hitReleaseTime * 1000).toFixed(0)} ms</span>
              </div>
              <Slider
                id="hit-release"
                min={0.001}
                max={5}
                step={0.001}
                value={[hitReleaseTime]}
                onValueChange={(value) => setHitReleaseTime(value[0])}
                disabled={disabled}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="hit-volume">Volume</Label>
                <span className="text-xs text-muted-foreground">{(hitVolume * 100).toFixed(0)}%</span>
              </div>
              <Slider
                id="hit-volume"
                min={0}
                max={1}
                step={0.01}
                value={[hitVolume]}
                onValueChange={(value) => setHitVolume(value[0])}
                disabled={disabled}
              />
            </div>
          </>
        )}

        {/* Volume Oscillation Toggle - Not shown in fade-line or hit mode */}
        {mode !== 'fade-line' && mode !== 'hit' && (
          <div className="flex items-center justify-between">
            <Label htmlFor="volume-oscillation-enabled">Volume Oscillation</Label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                id="volume-oscillation-enabled"
                checked={volumeOscillationEnabled}
                onChange={(e) => setVolumeOscillationEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
        )}

        {/* Position Oscillation Toggle - Only show in line mode */}
        {mode === 'line' && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="position-oscillation-enabled">Position Oscillation</Label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  id="position-oscillation-enabled"
                  checked={positionOscillationEnabled}
                  onChange={(e) => setPositionOscillationEnabled(e.target.checked)}
                  disabled={disabled}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* Endpoint 1 Volume */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="endpoint1-volume">Endpoint 1 Volume</Label>
                <span className="text-xs text-muted-foreground">{endpoint1VolumeDb} dB</span>
              </div>
              <Slider
                id="endpoint1-volume"
                min={-60}
                max={0}
                step={1}
                value={[endpoint1VolumeDb]}
                onValueChange={(value) => setEndpoint1VolumeDb(value[0])}
                disabled={disabled}
              />
            </div>

            {/* Endpoint 2 Volume */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="endpoint2-volume">Endpoint 2 Volume</Label>
                <span className="text-xs text-muted-foreground">{endpoint2VolumeDb} dB</span>
              </div>
              <Slider
                id="endpoint2-volume"
                min={-60}
                max={0}
                step={1}
                value={[endpoint2VolumeDb]}
                onValueChange={(value) => setEndpoint2VolumeDb(value[0])}
                disabled={disabled}
              />
            </div>
          </>
        )}

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

        {/* Position Oscillation Speed Control - Only show when position oscillation is active */}
        {((mode === 'line' && positionOscillationEnabled) || mode === 'chevron' || mode === 's-shape' || mode === 'fade-line' || mode === 'x-pattern') && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="position-oscillation-speed">Position Oscillation Speed</Label>
              <span className="text-sm text-muted-foreground">{positionOscillationSpeed.toFixed(1)} osc/sec</span>
            </div>
            <Slider
              id="position-oscillation-speed"
              min={0.1}
              max={5}
              step={0.1}
              value={[positionOscillationSpeed]}
              onValueChange={handlePositionOscillationSpeedChange}
              disabled={disabled}
            />
          </div>
        )}

        {/* Volume Oscillation Controls - Only show when volume oscillation is enabled and not in fade-line or hit mode */}
        {volumeOscillationEnabled && mode !== 'fade-line' && mode !== 'hit' && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="volume-oscillation-speed">Volume Oscillation Speed</Label>
                <span className="text-sm text-muted-foreground">{volumeOscillationSpeed.toFixed(1)} osc/sec</span>
              </div>
              <Slider
                id="volume-oscillation-speed"
                min={0.1}
                max={5}
                step={0.1}
                value={[volumeOscillationSpeed]}
                onValueChange={handleVolumeOscillationSpeedChange}
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="volume-oscillation-min-db">Volume Oscillation Range</Label>
                <span className="text-sm text-muted-foreground">{volumeOscillationMinDb} dB to 0 dB</span>
              </div>
              <Slider
                id="volume-oscillation-min-db"
                min={-60}
                max={-6}
                step={6}
                value={[volumeOscillationMinDb]}
                onValueChange={(value) => setVolumeOscillationMinDb(value[0])}
                disabled={disabled}
              />
            </div>
          </>
        )}

        {/* Flicker Toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="flicker-enabled">Flicker</Label>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              id="flicker-enabled"
              checked={flickerEnabled}
              onChange={(e) => setFlickerEnabled(e.target.checked)}
              disabled={disabled}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>

        {/* Flicker Speed (only show when enabled) */}
        {flickerEnabled && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="flicker-speed">Flicker Speed</Label>
              <span className="text-sm text-muted-foreground">{flickerSpeed} Hz</span>
            </div>
            <Slider
              id="flicker-speed"
              min={1}
              max={30}
              step={1}
              value={[flickerSpeed]}
              onValueChange={(value) => setFlickerSpeed(value[0])}
              disabled={disabled}
            />
          </div>
        )}

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
        {mode === 'dot' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>Drag the dot anywhere in the soundstage to hear how it sounds</li>
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
            {volumeOscillationEnabled ? (
              <li>Volume oscillates at the set speed</li>
            ) : (
              <li>Volume stays constant</li>
            )}
            <li>Sound plays continuously while active</li>
          </ul>
        ) : mode === 'line' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>Drag the blue endpoint dots to set the path endpoints</li>
            {positionOscillationEnabled ? (
              <li>The amber dot oscillates between the two endpoints</li>
            ) : (
              <li>The amber dot stays at the midpoint</li>
            )}
            <li>Adjust endpoint volumes to create a volume gradient along the line</li>
            {volumeOscillationEnabled ? (
              <li>Volume oscillation is applied on top of the endpoint gradient</li>
            ) : (
              <li>Volume follows only the endpoint gradient</li>
            )}
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
            <li>Sound plays continuously while active</li>
          </ul>
        ) : mode === 'chevron' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>The amber dot moves along the chevron path (top → tip → bottom)</li>
            <li>Drag the blue center point to move the chevron</li>
            <li>Use Horizontal Scale slider to adjust the width of the chevron</li>
            <li>Use Vertical Scale slider to adjust the height of the chevron</li>
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
            {volumeOscillationEnabled ? (
              <li>Volume oscillates at the set speed</li>
            ) : (
              <li>Volume stays constant</li>
            )}
            <li>Sound plays continuously while active</li>
          </ul>
        ) : mode === 's-shape' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>The amber dot moves along the squared S-shape path</li>
            <li>Drag the blue center point to move the S-shape</li>
            <li>Use Width slider to adjust the width of the S-shape</li>
            <li>Use Height slider to adjust the height of the S-shape</li>
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
            {volumeOscillationEnabled ? (
              <li>Volume oscillates at the set speed</li>
            ) : (
              <li>Volume stays constant</li>
            )}
            <li>Sound plays continuously while active</li>
          </ul>
        ) : mode === 'hit' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>Drag the dot anywhere in the soundstage to set the position</li>
            <li>Sound plays as repeating hits with attack/release envelopes</li>
            <li>Hit rate controls how often hits occur (hits per second)</li>
            <li>Attack time controls how quickly each hit fades in</li>
            <li>Release time controls how quickly each hit fades out</li>
            <li>Volume slider controls the peak volume of each hit</li>
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
          </ul>
        ) : mode === 'x-pattern' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>The amber dot moves along the X-pattern path (diagonal cross)</li>
            <li>Drag the blue center point to move the X-pattern</li>
            <li>Use Size slider to adjust the size of the X</li>
            <li>Path follows: top-left → bottom-right → top-right → bottom-left → repeat</li>
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
            {volumeOscillationEnabled ? (
              <li>Volume oscillates at the set speed</li>
            ) : (
              <li>Volume stays constant</li>
            )}
            <li>Sound plays continuously while active</li>
          </ul>
        ) : (
          <ul className="list-disc list-inside space-y-1">
            <li>The amber dot oscillates between the two blue endpoints</li>
            <li>Drag the blue endpoint dots to set the path endpoints</li>
            <li>Volume automatically fades: 0→full→0 going one way, then 0→full→0 coming back</li>
            <li>Each direction creates a complete fade in and fade out cycle</li>
            <li>Horizontal position (X) controls stereo panning (left ↔ right)</li>
            <li>Vertical position (Y) controls frequency (high ↑ ↓ low)</li>
            <li>Position oscillation speed controls movement speed</li>
            <li>Sound plays continuously while active</li>
          </ul>
        )}
      </div>
    </div>
  )
}

export default SoundstageExplorer
