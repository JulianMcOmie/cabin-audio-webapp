"use client"

import type React from "react"

import { useRef, useEffect } from "react"

interface DotGridProps {
  selectedDot: [number, number] | null
  setSelectedDot: (dot: [number, number] | null) => void
  gridSize: number
  disabled?: boolean
}

export function DotGrid({ selectedDot, setSelectedDot, gridSize, disabled = false }: DotGridProps) {
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

    // Calculate dot size and spacing
    const dotRadius = Math.min(rect.width, rect.height) / (gridSize * 3)
    const spacing = Math.min(rect.width, rect.height) / gridSize

    // Draw dots
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const centerX = (x + 0.5) * spacing
        const centerY = (y + 0.5) * spacing

        // Check if this dot is selected
        const isSelected = selectedDot && selectedDot[0] === x / (gridSize - 1) && selectedDot[1] === y / (gridSize - 1)

        // Draw dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2)

        if (isSelected && !disabled) {
          ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600
        } else {
          ctx.fillStyle = disabled
            ? isDarkMode
              ? "#1e293b"
              : "#e2e8f0" // slate-800 or slate-200
            : isDarkMode
              ? "#475569"
              : "#cbd5e1" // slate-600 or slate-300
        }

        ctx.fill()
      }
    }
  }, [selectedDot, gridSize, disabled])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // Convert to grid coordinates
    const gridX = Math.floor(x * gridSize)
    const gridY = Math.floor(y * gridSize)

    // Normalize to 0-1 range
    const normalizedX = gridX / (gridSize - 1)
    const normalizedY = gridY / (gridSize - 1)

    setSelectedDot([normalizedX, normalizedY])
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full aspect-square cursor-pointer ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      onClick={handleCanvasClick}
    />
  )
}

