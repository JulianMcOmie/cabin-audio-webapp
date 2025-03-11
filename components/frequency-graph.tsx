"use client"

import { useEffect, useRef } from "react"

interface FrequencyGraphProps {
  selectedDot: [number, number] | null
  disabled?: boolean
  className?: string
}

export function FrequencyGraph({ selectedDot, disabled = false, className }: FrequencyGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

    // Check if we're in dark mode
    const isDarkMode = document.documentElement.classList.contains("dark")

    // Draw background grid
    ctx.strokeStyle = isDarkMode ? "#2a2a3c" : "#e2e8f0"
    ctx.lineWidth = 1

    // Vertical grid lines (frequency bands)
    const bands = 10
    for (let i = 0; i <= bands; i++) {
      const x = (i / bands) * rect.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()
    }

    // Horizontal grid lines (dB levels)
    const levels = 6
    for (let i = 0; i <= levels; i++) {
      const y = (i / levels) * rect.height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
    }

    // Draw frequency labels
    ctx.fillStyle = isDarkMode ? "#94a3b8" : "#64748b"
    ctx.font = "10px sans-serif"
    ctx.textAlign = "center"

    const freqLabels = ["20Hz", "50Hz", "100Hz", "200Hz", "500Hz", "1kHz", "2kHz", "5kHz", "10kHz", "20kHz"]
    for (let i = 0; i < freqLabels.length; i++) {
      const x = ((i + 0.5) / bands) * rect.width
      ctx.fillText(freqLabels[i], x, rect.height - 5)
    }

    // Draw dB labels
    ctx.textAlign = "right"
    const dbLabels = ["+12dB", "+6dB", "0dB", "-6dB", "-12dB", "-18dB"]
    for (let i = 0; i < dbLabels.length; i++) {
      const y = (i / (levels - 1)) * (rect.height - 30) + 15
      ctx.fillText(dbLabels[i], rect.width - 10, y)
    }

    // Draw EQ curve
    if (disabled) {
      ctx.strokeStyle = isDarkMode ? "#64748b" : "#94a3b8" // slate-400/500 if disabled
    } else {
      // Create gradient for the EQ curve - using electric blue colors
      const gradient = ctx.createLinearGradient(0, 0, rect.width, 0)
      if (isDarkMode) {
        gradient.addColorStop(0, "#0ea5e9") // sky-500
        gradient.addColorStop(0.5, "#38bdf8") // sky-400
        gradient.addColorStop(1, "#7dd3fc") // sky-300
      } else {
        gradient.addColorStop(0, "#0284c7") // sky-600
        gradient.addColorStop(0.5, "#0ea5e9") // sky-500
        gradient.addColorStop(1, "#38bdf8") // sky-400
      }
      ctx.strokeStyle = gradient
    }

    ctx.lineWidth = 3
    ctx.beginPath()

    // Default curve (flat)
    const curve = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]

    // If a dot is selected, modify the curve
    if (selectedDot && !disabled) {
      const [x, y] = selectedDot
      const centerPoint = Math.floor(x * 10)
      const intensity = 1 - y

      // Create a bell curve around the selected frequency
      for (let i = 0; i < curve.length; i++) {
        const distance = Math.abs(i - centerPoint)
        const influence = Math.max(0, 1 - distance / 3)
        curve[i] = 0.5 + (intensity - 0.5) * influence
      }
    }

    // Draw the curve
    for (let i = 0; i < curve.length; i++) {
      const x = ((i + 0.5) / bands) * rect.width
      const y = (1 - curve[i]) * (rect.height - 30) + 15

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }, [selectedDot, disabled])

  return (
    <div
      className={`w-full aspect-[2/1] frequency-graph bg-white dark:bg-card rounded-lg border overflow-hidden ${disabled ? "opacity-70" : ""} ${className || ""}`}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  )
}

