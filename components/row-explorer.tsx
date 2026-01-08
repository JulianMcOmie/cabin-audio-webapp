"use client"

import type React from "react"
import { useRef, useEffect, useState, useCallback } from "react"
import * as rowExplorerAudio from '@/lib/audio/rowExplorerAudio'
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"

interface RowExplorerProps {
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  disabled?: boolean
}

export function RowExplorer({ isPlaying, setIsPlaying, disabled = false }: RowExplorerProps) {
  const soundstageCanvasRef = useRef<HTMLCanvasElement>(null)
  const xyPadCanvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Mode: 'row' = horizontal line for frequency, 'column' = vertical line for pan, 'diagonal' = angled line, 'split' = two independent rows
  const [mode, setMode] = useState<'row' | 'column' | 'diagonal' | 'split'>('row')

  // Tilt angle for diagonal mode (-90 to 90 degrees, 0 = 45° diagonal)
  const [tiltAngle, setTiltAngle] = useState(0)

  // Primary selector position (frequency Y in row mode, pan X in column mode, combined in diagonal)
  const [selectorPosition, setSelectorPosition] = useState(0.5)
  const [isDraggingSelector, setIsDraggingSelector] = useState(false)

  // Split mode: left and right frequency positions
  const [leftFrequencyY, setLeftFrequencyY] = useState(0.3)
  const [rightFrequencyY, setRightFrequencyY] = useState(0.7)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [leftMuted, setLeftMuted] = useState(false)
  const [rightMuted, setRightMuted] = useState(false)

  // Volume (always Y axis on XY pad)
  const [volume, setVolume] = useState(1.0) // 0 to 1 (Y axis: top = 1, bottom = 0)

  // Secondary parameter (pan X in row mode, frequency Y in column mode, sweep position in diagonal)
  const [secondaryParam, setSecondaryParam] = useState(0.5) // 0 to 1
  const [isDraggingXYPad, setIsDraggingXYPad] = useState(false)

  // Audio settings
  const [bandwidth, setBandwidth] = useState(6) // Default: 6 octaves
  const [sweepEnabled, setSweepEnabled] = useState(false)
  const [sweepSpeed, setSweepSpeed] = useState(1.0) // Oscillations per second
  const [flickerEnabled, setFlickerEnabled] = useState(false)
  const [flickerSpeed, setFlickerSpeed] = useState(8.0) // Flickers per second

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
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setBandwidth(bandwidth)
    player.setMode(mode)
    // Set initial values based on mode
    if (mode === 'row') {
      player.setFrequencyY(selectorPosition)
      player.setPan(secondaryParam * 2 - 1) // Convert 0-1 to -1 to 1
    } else {
      player.setPan(selectorPosition * 2 - 1) // Convert 0-1 to -1 to 1
      player.setFrequencyY(secondaryParam)
    }
    player.setVolume(volume)
    player.setSweepEnabled(sweepEnabled)
    player.setSweepSpeed(sweepSpeed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle playing state
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
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

  // Update mode when it changes
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setMode(mode)
  }, [mode])

  // Update tilt angle when it changes
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setTiltAngle(tiltAngle)
  }, [tiltAngle])

  // Update selector position (primary axis)
  useEffect(() => {
    if (!disabled) {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      if (mode === 'row') {
        player.setFrequencyY(selectorPosition)
      } else if (mode === 'column') {
        player.setPan(selectorPosition * 2 - 1)
      } else if (mode === 'diagonal') {
        // Diagonal mode: position affects both freq and pan based on tilt
        const tiltRad = (tiltAngle * Math.PI) / 180
        const freqWeight = Math.cos(tiltRad - Math.PI / 4)
        const panWeight = Math.sin(tiltRad - Math.PI / 4)

        const freqY = 0.5 + (selectorPosition - 0.5) * Math.abs(freqWeight)
        const panX = 0.5 + (selectorPosition - 0.5) * Math.abs(panWeight)

        player.setFrequencyY(freqY)
        player.setPan(panX * 2 - 1)
      }
      // Split mode uses separate left/right frequency effects
    }
  }, [selectorPosition, mode, tiltAngle, disabled])

  // Update split mode left frequency
  useEffect(() => {
    if (!disabled && mode === 'split') {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      player.setLeftFrequencyY(leftFrequencyY)
    }
  }, [leftFrequencyY, mode, disabled])

  // Update split mode right frequency
  useEffect(() => {
    if (!disabled && mode === 'split') {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      player.setRightFrequencyY(rightFrequencyY)
    }
  }, [rightFrequencyY, mode, disabled])

  // Update split mode left mute
  useEffect(() => {
    if (mode === 'split') {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      player.setLeftMuted(leftMuted)
    }
  }, [leftMuted, mode])

  // Update split mode right mute
  useEffect(() => {
    if (mode === 'split') {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      player.setRightMuted(rightMuted)
    }
  }, [rightMuted, mode])

  // Update volume when it changes
  useEffect(() => {
    if (!disabled) {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      player.setVolume(volume)
    }
  }, [volume, disabled])

  // Update secondary parameter (only if sweep is not enabled)
  useEffect(() => {
    if (!disabled && !sweepEnabled) {
      const player = rowExplorerAudio.getRowExplorerPlayer()
      if (mode === 'row') {
        player.setPan(secondaryParam * 2 - 1)
      } else {
        player.setFrequencyY(secondaryParam)
      }
    }
  }, [secondaryParam, mode, disabled, sweepEnabled])

  // Update sweep enabled
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setSweepEnabled(sweepEnabled)
  }, [sweepEnabled])

  // Update sweep speed
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setSweepSpeed(sweepSpeed)
  }, [sweepSpeed])

  // Update flicker enabled
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setFlickerEnabled(flickerEnabled)
  }, [flickerEnabled])

  // Update flicker speed
  useEffect(() => {
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setFlickerSpeed(flickerSpeed)
  }, [flickerSpeed])

  // Draw selector canvas (row = horizontal line, column = vertical line, diagonal = angled line)
  useEffect(() => {
    const canvas = soundstageCanvasRef.current
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

    // Draw grid based on mode
    if (mode === 'row') {
      // Horizontal lines (frequency markers)
      for (let i = 1; i < 4; i++) {
        const y = (rect.height * i) / 4
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(rect.width, y)
        ctx.stroke()
      }
      // Vertical center line
      ctx.beginPath()
      ctx.moveTo(rect.width / 2, 0)
      ctx.lineTo(rect.width / 2, rect.height)
      ctx.stroke()
    } else if (mode === 'column') {
      // Vertical lines (pan markers)
      for (let i = 1; i < 4; i++) {
        const x = (rect.width * i) / 4
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, rect.height)
        ctx.stroke()
      }
      // Horizontal center line
      ctx.beginPath()
      ctx.moveTo(0, rect.height / 2)
      ctx.lineTo(rect.width, rect.height / 2)
      ctx.stroke()
    } else if (mode === 'diagonal') {
      // Diagonal mode: draw both horizontal and vertical grid
      for (let i = 1; i < 4; i++) {
        const y = (rect.height * i) / 4
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(rect.width, y)
        ctx.stroke()
      }
      for (let i = 1; i < 4; i++) {
        const x = (rect.width * i) / 4
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, rect.height)
        ctx.stroke()
      }
    }

    const lineThickness = 4
    const handleRadius = 12

    if (mode === 'row') {
      // Draw horizontal frequency selector line
      const lineY = selectorPosition * rect.height

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

      // Draw labels
      ctx.font = "12px system-ui, sans-serif"
      ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"
      ctx.textAlign = "right"
      ctx.fillText("High", rect.width - 8, 16)
      ctx.fillText("Low", rect.width - 8, rect.height - 8)

    } else if (mode === 'column') {
      // Draw vertical pan selector line
      const lineX = selectorPosition * rect.width

      // Draw line glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.moveTo(lineX, 0)
        ctx.lineTo(lineX, rect.height)
        const gradient = ctx.createLinearGradient(lineX - 15, 0, lineX + 15, 0)
        gradient.addColorStop(0, "rgba(56, 189, 248, 0)")
        gradient.addColorStop(0.5, isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)")
        gradient.addColorStop(1, "rgba(56, 189, 248, 0)")
        ctx.strokeStyle = gradient
        ctx.lineWidth = 20
        ctx.stroke()
      }

      // Draw main line
      ctx.beginPath()
      ctx.moveTo(lineX, 0)
      ctx.lineTo(lineX, rect.height)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = lineThickness
      ctx.lineCap = 'round'
      ctx.stroke()

      // Draw drag handle
      ctx.beginPath()
      ctx.arc(lineX, rect.height / 2, handleRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()

      // Draw inner highlight
      ctx.beginPath()
      ctx.arc(lineX - handleRadius / 3, rect.height / 2 - handleRadius / 3, handleRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()

      // Draw labels
      ctx.font = "12px system-ui, sans-serif"
      ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"
      ctx.textAlign = "left"
      ctx.fillText("L", 8, rect.height / 2 + 4)
      ctx.textAlign = "right"
      ctx.fillText("R", rect.width - 8, rect.height / 2 + 4)

    } else if (mode === 'diagonal') {
      // Draw diagonal selector line
      // Convert tilt angle: -90 to +90 degrees, where 0 = 45° diagonal
      // Actual angle: 45° + tiltAngle (so tiltAngle=0 gives 45°, tiltAngle=-45 gives 0°/horizontal, tiltAngle=+45 gives 90°/vertical)
      const actualAngleRad = ((45 + tiltAngle) * Math.PI) / 180

      // Calculate line endpoints extending beyond canvas
      const centerX = rect.width / 2
      const centerY = rect.height / 2

      // Offset the center based on selector position
      const maxOffset = Math.max(rect.width, rect.height)
      const perpAngle = actualAngleRad + Math.PI / 2
      const offsetX = (selectorPosition - 0.5) * maxOffset * Math.cos(perpAngle)
      const offsetY = (selectorPosition - 0.5) * maxOffset * Math.sin(perpAngle)

      const lineCenterX = centerX + offsetX
      const lineCenterY = centerY + offsetY

      // Line direction
      const dx = Math.cos(actualAngleRad)
      const dy = Math.sin(actualAngleRad)

      // Extend line to edges
      const lineLength = maxOffset * 2
      const x1 = lineCenterX - dx * lineLength
      const y1 = lineCenterY - dy * lineLength
      const x2 = lineCenterX + dx * lineLength
      const y2 = lineCenterY + dy * lineLength

      // Draw line glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)"
        ctx.lineWidth = 20
        ctx.stroke()
      }

      // Draw main line
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = lineThickness
      ctx.lineCap = 'round'
      ctx.stroke()

      // Draw drag handle at the center of the visible line
      const handleX = Math.max(0, Math.min(rect.width, lineCenterX))
      const handleY = Math.max(0, Math.min(rect.height, lineCenterY))

      ctx.beginPath()
      ctx.arc(handleX, handleY, handleRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()

      // Draw inner highlight
      ctx.beginPath()
      ctx.arc(handleX - handleRadius / 3, handleY - handleRadius / 3, handleRadius / 3, 0, Math.PI * 2)
      ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()

      // Draw corner labels
      ctx.font = "12px system-ui, sans-serif"
      ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"
      ctx.textAlign = "left"
      ctx.fillText("High", 8, 16)
      ctx.textAlign = "right"
      ctx.fillText("Low", rect.width - 8, rect.height - 8)
      ctx.textAlign = "left"
      ctx.fillText("L", 8, rect.height - 8)
      ctx.textAlign = "right"
      ctx.fillText("R", rect.width - 8, 16)

    } else if (mode === 'split') {
      // Draw split mode: two horizontal line segments (left half and right half)
      const midX = rect.width / 2
      const leftLineY = leftFrequencyY * rect.height
      const rightLineY = rightFrequencyY * rect.height

      // Draw vertical divider
      ctx.beginPath()
      ctx.moveTo(midX, 0)
      ctx.lineTo(midX, rect.height)
      ctx.strokeStyle = isDarkMode ? "#52525b" : "#94a3b8"
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // Draw horizontal grid lines
      ctx.strokeStyle = isDarkMode ? "#27272a" : "#e2e8f0"
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) {
        const y = (rect.height * i) / 4
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(rect.width, y)
        ctx.stroke()
      }

      const lineThickness = 4
      const handleRadius = 10

      // Draw left segment glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.moveTo(0, leftLineY)
        ctx.lineTo(midX - 2, leftLineY)
        ctx.strokeStyle = isDarkMode ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)"
        ctx.lineWidth = 16
        ctx.stroke()
      }

      // Draw left segment line
      ctx.beginPath()
      ctx.moveTo(0, leftLineY)
      ctx.lineTo(midX - 2, leftLineY)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = lineThickness
      ctx.lineCap = 'round'
      ctx.stroke()

      // Draw left handle
      ctx.beginPath()
      ctx.arc(midX / 2, leftLineY, handleRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#38bdf8" : "#0284c7"
      ctx.fill()

      // Draw right segment glow if playing
      if (isPlaying && !disabled) {
        ctx.beginPath()
        ctx.moveTo(midX + 2, rightLineY)
        ctx.lineTo(rect.width, rightLineY)
        ctx.strokeStyle = isDarkMode ? "rgba(251, 191, 36, 0.3)" : "rgba(245, 158, 11, 0.3)"
        ctx.lineWidth = 16
        ctx.stroke()
      }

      // Draw right segment line (different color)
      ctx.beginPath()
      ctx.moveTo(midX + 2, rightLineY)
      ctx.lineTo(rect.width, rightLineY)
      ctx.strokeStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#fbbf24" : "#f59e0b"
      ctx.lineWidth = lineThickness
      ctx.lineCap = 'round'
      ctx.stroke()

      // Draw right handle
      ctx.beginPath()
      ctx.arc(midX + midX / 2, rightLineY, handleRadius, 0, Math.PI * 2)
      ctx.fillStyle = disabled
        ? isDarkMode ? "#52525b" : "#cbd5e1"
        : isDarkMode ? "#fbbf24" : "#f59e0b"
      ctx.fill()

      // Draw labels
      ctx.font = "12px system-ui, sans-serif"
      ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"
      ctx.textAlign = "center"
      ctx.fillText("L", midX / 2, rect.height - 8)
      ctx.fillText("R", midX + midX / 2, rect.height - 8)
      ctx.textAlign = "right"
      ctx.fillText("High", rect.width - 8, 16)
      ctx.fillText("Low", rect.width - 8, rect.height - 24)
    }

  }, [selectorPosition, mode, tiltAngle, leftFrequencyY, rightFrequencyY, isDarkMode, isPlaying, disabled])

  // Draw XY pad canvas (volume + secondary param)
  useEffect(() => {
    const canvas = xyPadCanvasRef.current
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

    // Calculate dot position
    // X axis: secondaryParam (0 to 1)
    // Y axis: volume (1 at top, 0 at bottom)
    const dotX = secondaryParam * rect.width
    const dotY = (1 - volume) * rect.height
    const dotRadius = 14

    // Draw dot glow if playing
    if (isPlaying && !disabled) {
      ctx.beginPath()
      ctx.arc(dotX, dotY, dotRadius + 8, 0, Math.PI * 2)
      const gradient = ctx.createRadialGradient(dotX, dotY, dotRadius, dotX, dotY, dotRadius + 8)
      gradient.addColorStop(0, isDarkMode ? "rgba(251, 191, 36, 0.3)" : "rgba(245, 158, 11, 0.3)")
      gradient.addColorStop(1, "rgba(251, 191, 36, 0)")
      ctx.fillStyle = gradient
      ctx.fill()
    }

    // Draw main dot
    ctx.beginPath()
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = disabled
      ? isDarkMode ? "#52525b" : "#cbd5e1"
      : isDarkMode ? "#fbbf24" : "#f59e0b"
    ctx.fill()

    // Draw inner highlight
    ctx.beginPath()
    ctx.arc(dotX - dotRadius / 3, dotY - dotRadius / 3, dotRadius / 3, 0, Math.PI * 2)
    ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.5)"
    ctx.fill()

    // Draw labels
    ctx.font = "11px system-ui, sans-serif"
    ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"

    // Volume labels (left side)
    ctx.textAlign = "left"
    ctx.fillText("Loud", 4, 14)
    ctx.fillText("Quiet", 4, rect.height - 6)

    // X-axis labels depend on mode
    ctx.textAlign = "center"
    if (mode === 'row') {
      // Row mode: X axis is pan
      ctx.fillText("L", 12, rect.height / 2 + 4)
      ctx.fillText("R", rect.width - 12, rect.height / 2 + 4)
    } else {
      // Column mode: X axis is frequency
      ctx.fillText("High", 24, rect.height / 2 + 4)
      ctx.textAlign = "right"
      ctx.fillText("Low", rect.width - 8, rect.height / 2 + 4)
    }

  }, [volume, secondaryParam, mode, isDarkMode, isPlaying, disabled])

  // Selector canvas mouse handlers
  const updateSelectorPosition = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = soundstageCanvasRef.current
    if (!canvas || disabled) return

    const rect = canvas.getBoundingClientRect()
    if (mode === 'row') {
      // Row mode: drag vertically to select frequency
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      setSelectorPosition(y)
    } else if (mode === 'column') {
      // Column mode: drag horizontally to select pan
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      setSelectorPosition(x)
    } else if (mode === 'diagonal') {
      // Diagonal mode: drag perpendicular to the line
      const actualAngleRad = ((45 + tiltAngle) * Math.PI) / 180
      const perpAngle = actualAngleRad + Math.PI / 2

      // Get mouse position relative to canvas center
      const mouseX = (e.clientX - rect.left) / rect.width - 0.5
      const mouseY = (e.clientY - rect.top) / rect.height - 0.5

      // Project onto perpendicular axis
      const projection = mouseX * Math.cos(perpAngle) + mouseY * Math.sin(perpAngle)
      const normalizedPos = Math.max(0, Math.min(1, projection + 0.5))
      setSelectorPosition(normalizedPos)
    }
    // Split mode is handled separately
  }, [disabled, mode, tiltAngle])

  // Split mode mouse handlers
  const updateSplitPosition = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent, side: 'left' | 'right') => {
    const canvas = soundstageCanvasRef.current
    if (!canvas || disabled) return

    const rect = canvas.getBoundingClientRect()
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    if (side === 'left') {
      setLeftFrequencyY(y)
    } else {
      setRightFrequencyY(y)
    }
  }, [disabled])

  const handleSelectorMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = soundstageCanvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()

    if (mode === 'split') {
      // Determine which side was clicked
      const x = e.clientX - rect.left
      const midX = rect.width / 2

      if (x < midX) {
        setIsDraggingLeft(true)
        updateSplitPosition(e, 'left')
      } else {
        setIsDraggingRight(true)
        updateSplitPosition(e, 'right')
      }
    } else {
      setIsDraggingSelector(true)
      updateSelectorPosition(e)
    }

    if (!isPlaying) {
      setIsPlaying(true)
    }
  }

  const handleSelectorMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'split') {
      if (isDraggingLeft) {
        updateSplitPosition(e, 'left')
      } else if (isDraggingRight) {
        updateSplitPosition(e, 'right')
      }
    } else if (isDraggingSelector) {
      updateSelectorPosition(e)
    }
  }

  const handleSelectorMouseUp = () => {
    setIsDraggingSelector(false)
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
  }

  // XY Pad mouse handlers
  const updateXYPadPosition = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = xyPadCanvasRef.current
    if (!canvas || disabled) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    // X -> secondary param (0 to 1)
    // Y -> volume: 0 to 1 -> 1 to 0 (inverted)
    const newVolume = 1 - y

    setSecondaryParam(x)
    setVolume(newVolume)
  }, [disabled])

  const handleXYPadMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    setIsDraggingXYPad(true)
    updateXYPadPosition(e)

    if (!isPlaying) {
      setIsPlaying(true)
    }
  }

  const handleXYPadMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingXYPad) {
      updateXYPadPosition(e)
    }
  }

  const handleXYPadMouseUp = () => {
    setIsDraggingXYPad(false)
  }

  // Global mouse handlers
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDraggingSelector(false)
      setIsDraggingXYPad(false)
      setIsDraggingLeft(false)
      setIsDraggingRight(false)
    }

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (disabled) return

      if (isDraggingSelector) {
        updateSelectorPosition(e)
      }
      if (isDraggingLeft) {
        updateSplitPosition(e, 'left')
      }
      if (isDraggingRight) {
        updateSplitPosition(e, 'right')
      }
      if (isDraggingXYPad) {
        updateXYPadPosition(e)
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    window.addEventListener('mousemove', handleGlobalMouseMove)

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
      window.removeEventListener('mousemove', handleGlobalMouseMove)
    }
  }, [isDraggingSelector, isDraggingLeft, isDraggingRight, isDraggingXYPad, disabled, updateSelectorPosition, updateSplitPosition, updateXYPadPosition])

  const handleBandwidthChange = (value: number[]) => {
    const newBandwidth = value[0]
    setBandwidth(newBandwidth)
    const player = rowExplorerAudio.getRowExplorerPlayer()
    player.setBandwidth(newBandwidth)
  }

  const handleSweepSpeedChange = (value: number[]) => {
    const newSpeed = value[0]
    setSweepSpeed(newSpeed)
  }

  const handleFlickerSpeedChange = (value: number[]) => {
    const newSpeed = value[0]
    setFlickerSpeed(newSpeed)
  }

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex border rounded-md overflow-hidden w-fit">
        <button
          className={`px-4 py-2 text-sm font-medium ${
            mode === "row"
              ? "bg-purple-500 text-white"
              : "bg-background hover:bg-muted"
          }`}
          onClick={() => setMode("row")}
          disabled={disabled}
        >
          Row
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${
            mode === "column"
              ? "bg-purple-500 text-white"
              : "bg-background hover:bg-muted"
          }`}
          onClick={() => setMode("column")}
          disabled={disabled}
        >
          Column
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${
            mode === "diagonal"
              ? "bg-purple-500 text-white"
              : "bg-background hover:bg-muted"
          }`}
          onClick={() => setMode("diagonal")}
          disabled={disabled}
        >
          Diagonal
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${
            mode === "split"
              ? "bg-purple-500 text-white"
              : "bg-background hover:bg-muted"
          }`}
          onClick={() => setMode("split")}
          disabled={disabled}
        >
          Split
        </button>
      </div>

      {/* Tilt Angle Slider (only show in diagonal mode) */}
      {mode === 'diagonal' && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="tilt-angle">Tilt Angle</Label>
            <span className="text-sm text-muted-foreground">{tiltAngle}°</span>
          </div>
          <Slider
            id="tilt-angle"
            min={-45}
            max={45}
            step={5}
            value={[tiltAngle]}
            onValueChange={(value) => setTiltAngle(value[0])}
            disabled={disabled}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>More horizontal</span>
            <span>More vertical</span>
          </div>
        </div>
      )}

      {/* Stacked layout */}
      <div className="space-y-4">
        {/* Top: Primary selector */}
        <div className="relative">
          <div className="text-xs text-muted-foreground mb-2">
            {mode === 'row' ? 'Frequency Row' : mode === 'column' ? 'Pan Column' : mode === 'diagonal' ? 'Diagonal Slice' : 'Split Rows (L/R)'}
          </div>
          <canvas
            ref={soundstageCanvasRef}
            className={`w-full aspect-[3/1] bg-background border ${
              disabled ? 'cursor-not-allowed opacity-50' : mode === 'row' || mode === 'split' ? 'cursor-ns-resize' : mode === 'column' ? 'cursor-ew-resize' : 'cursor-move'
            } ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}
            onMouseDown={handleSelectorMouseDown}
            onMouseMove={handleSelectorMouseMove}
            onMouseUp={handleSelectorMouseUp}
            style={{ touchAction: 'none' }}
          />
          <div className="absolute bottom-2 left-2 text-xs text-muted-foreground">
            {mode === 'row' ? 'Drag up/down' : mode === 'column' ? 'Drag left/right' : mode === 'diagonal' ? 'Drag to move' : 'Drag each half up/down'}
          </div>
        </div>

        {/* Bottom: XY pad */}
        <div className="relative">
          <div className="text-xs text-muted-foreground mb-2">
            {mode === 'row' ? 'Volume & Pan' : mode === 'column' ? 'Volume & Frequency' : mode === 'diagonal' ? 'Volume & Sweep' : 'Volume'}
          </div>
          <canvas
            ref={xyPadCanvasRef}
            className={`w-full aspect-[2/1] bg-background border ${
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair'
            } ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}
            onMouseDown={handleXYPadMouseDown}
            onMouseMove={handleXYPadMouseMove}
            onMouseUp={handleXYPadMouseUp}
            style={{ touchAction: 'none' }}
          />
          <div className="absolute bottom-2 left-2 text-xs text-muted-foreground">
            {sweepEnabled ? (mode === 'row' ? 'Pan sweeping' : mode === 'column' ? 'Freq sweeping' : mode === 'diagonal' ? 'Diagonal sweeping' : 'L/R sweeping') : 'Drag to adjust'}
          </div>
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

        {/* Sweep Toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="sweep-enabled">
            {mode === 'row' ? 'Pan Sweep' : mode === 'column' ? 'Frequency Sweep' : mode === 'diagonal' ? 'Diagonal Sweep' : 'Split Sweep'}
          </Label>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              id="sweep-enabled"
              checked={sweepEnabled}
              onChange={(e) => setSweepEnabled(e.target.checked)}
              disabled={disabled}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>

        {/* Sweep Speed (only show when enabled) */}
        {sweepEnabled && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="sweep-speed">Sweep Speed</Label>
              <span className="text-sm text-muted-foreground">{sweepSpeed.toFixed(1)} osc/sec</span>
            </div>
            <Slider
              id="sweep-speed"
              min={0.1}
              max={5}
              step={0.1}
              value={[sweepSpeed]}
              onValueChange={handleSweepSpeedChange}
              disabled={disabled}
            />
          </div>
        )}

        {/* Mute Controls (only show in split mode) */}
        {mode === 'split' && (
          <div className="flex gap-4">
            <button
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border ${
                leftMuted
                  ? "bg-sky-500 text-white border-sky-500"
                  : "bg-background border-input hover:bg-muted"
              }`}
              onClick={() => setLeftMuted(!leftMuted)}
              disabled={disabled}
            >
              {leftMuted ? "Left Muted" : "Mute Left"}
            </button>
            <button
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border ${
                rightMuted
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-background border-input hover:bg-muted"
              }`}
              onClick={() => setRightMuted(!rightMuted)}
              disabled={disabled}
            >
              {rightMuted ? "Right Muted" : "Mute Right"}
            </button>
          </div>
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
              <span className="text-sm text-muted-foreground">{flickerSpeed.toFixed(0)} Hz</span>
            </div>
            <Slider
              id="flicker-speed"
              min={1}
              max={30}
              step={1}
              value={[flickerSpeed]}
              onValueChange={handleFlickerSpeedChange}
              disabled={disabled}
            />
          </div>
        )}
      </Card>

      {/* Instructions */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p><strong>Instructions:</strong></p>
        {mode === 'row' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>Drag the horizontal line up/down to select frequency (high to low)</li>
            <li>Use the XY pad to control volume (up/down) and panning (left/right)</li>
            <li>Enable Pan Sweep to automatically sweep panning left to right</li>
          </ul>
        ) : mode === 'column' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>Drag the vertical line left/right to select pan position</li>
            <li>Use the XY pad to control volume (up/down) and frequency (left/right)</li>
            <li>Enable Frequency Sweep to automatically sweep frequency high to low</li>
          </ul>
        ) : mode === 'diagonal' ? (
          <ul className="list-disc list-inside space-y-1">
            <li>Adjust the tilt angle to set the diagonal orientation</li>
            <li>Drag the diagonal line to change both frequency and pan together</li>
            <li>Use the XY pad to control volume (up/down)</li>
            <li>Enable Diagonal Sweep to sweep along the diagonal</li>
          </ul>
        ) : (
          <ul className="list-disc list-inside space-y-1">
            <li>Drag the left segment up/down to set left channel frequency</li>
            <li>Drag the right segment up/down to set right channel frequency</li>
            <li>Use the XY pad to control volume (up/down only)</li>
            <li>Enable Split Sweep to sweep both halves from left to right in sync</li>
          </ul>
        )}
        <ul className="list-disc list-inside space-y-1">
          <li>Bandwidth controls how wide the frequency band is</li>
          <li>Sound plays continuously while active</li>
        </ul>
      </div>
    </div>
  )
}

export default RowExplorer
