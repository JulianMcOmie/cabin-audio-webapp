"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { EQPoint, GhostPoint } from './types'
import { CoordinateUtils } from './CoordinateUtils'
import { CurveRenderer } from './CurveRenderer'

interface SineEQProps {
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
}

export function SineEQ({ 
  disabled = false, 
  className, 
  onInstructionChange,
  onRequestEnable 
}: SineEQProps) {
  // Canvas and context refs
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const backgroundContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  
  // Fixed frequency and amplitude ranges
  const freqRange = { min: 20, max: 20000 }
  const ampRange = { min: -24, max: 24 }
  
  // Canvas margin
  const margin = 40
  
  // Theme tracking
  const [isDarkMode, setIsDarkMode] = useState(false)
  const backgroundDrawnRef = useRef<boolean>(false)
  
  // EQ control points
  const [points, setPoints] = useState<EQPoint[]>([])
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null)
  const isDraggingRef = useRef<boolean>(false)
  
  // Ghost point for hover indication
  const [ghostPoint, setGhostPoint] = useState<GhostPoint>({
    visible: false,
    x: 0,
    y: 0,
    frequency: 1000,
    amplitude: 0
  })
  
  // Detect theme changes
  useEffect(() => {
    // Initial check
    setIsDarkMode(document.documentElement.classList.contains("dark"))

    // Set up mutation observer to watch for class changes on html element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const newIsDarkMode = document.documentElement.classList.contains("dark")
          setIsDarkMode(newIsDarkMode)
          // When theme changes, we need to redraw the background
          backgroundDrawnRef.current = false
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => {
      observer.disconnect()
    }
  }, [])
  
  // Draw background grid and labels
  const renderBackgroundCanvas = useCallback(() => {
    const canvas = backgroundCanvasRef.current
    if (!canvas) return

    // Get or create context
    let ctx = backgroundContextRef.current
    if (!ctx) {
      ctx = canvas.getContext("2d")
      if (!ctx) return
      backgroundContextRef.current = ctx
    }

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect()
    
    // Store margins in a ref to access in other functions
    if (!canvasRef.current) return
    (canvasRef.current as any).margin = margin

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Add semi-transparent background
    ctx.fillStyle = isDarkMode ? "rgba(5, 5, 8, 0.95)" : "rgba(230, 230, 230, 0.7)"
    ctx.fillRect(0, 0, rect.width, rect.height)
    
    // Draw a subtle border around the content area
    ctx.strokeStyle = isDarkMode ? "rgba(80, 80, 100, 0.3)" : "rgba(200, 200, 200, 0.5)"
    ctx.lineWidth = 1
    ctx.strokeRect(margin, margin, rect.width - margin * 2, rect.height - margin * 2)

    // Draw background grid
    ctx.strokeStyle = isDarkMode ? "rgba(63, 63, 92, 0.4)" : "rgba(226, 232, 240, 0.5)"
    ctx.lineWidth = 1

    // Define frequency points for logarithmic grid
    const freqPoints: number[] = []
    const decades = [
      [20, 200],    // First decade: 20Hz to 200Hz
      [200, 2000],  // Second decade: 200Hz to 2kHz
      [2000, 20000] // Third decade: 2kHz to 20kHz
    ]
    
    // Generate 10 linearly spaced points for each decade
    decades.forEach(([startFreq, endFreq]) => {
      const range = endFreq - startFreq
      const step = range / 10
      
      for (let i = 0; i < 10; i++) {
        const freq = startFreq + i * step
        freqPoints.push(Math.round(freq))
      }
    })
    
    // Add the final point (20kHz)
    freqPoints.push(20000)
    
    // Vertical grid lines (logarithmic frequency bands)
    for (let freq of freqPoints) {
      const x = margin + CoordinateUtils.freqToX(freq, rect.width - margin * 2, freqRange)
      ctx.beginPath()
      ctx.moveTo(x, margin)
      ctx.lineTo(x, rect.height - margin)
      ctx.stroke()
    }

    // Define dB points for grid
    const dbPoints = [24, 20, 16, 12, 8, 4, 0, -4, -8, -12, -16, -20, -24]
    
    // Horizontal grid lines (dB levels)
    for (let db of dbPoints) {
      const y = margin + CoordinateUtils.amplitudeToY(db, rect.height - margin * 2, ampRange)
      ctx.beginPath()
      ctx.moveTo(margin, y)
      ctx.lineTo(rect.width - margin, y)
      ctx.stroke()
    }

    // Mark background as drawn
    backgroundDrawnRef.current = true
  }, [isDarkMode, freqRange, ampRange])
  
  // Main canvas rendering function (frequency response curve and points)
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Get or create context
    let ctx = canvasContextRef.current
    if (!ctx) {
      ctx = canvas.getContext("2d")
      if (!ctx) return
      canvasContextRef.current = ctx
    }

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect()

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Check if background needs to be drawn
    if (!backgroundDrawnRef.current) {
      renderBackgroundCanvas()
    }

    // Inner dimensions (within margins)
    const innerWidth = rect.width - margin * 2
    const innerHeight = rect.height - margin * 2
    
    // Draw the curve
    CurveRenderer.drawCurve(
      ctx,
      points,
      innerWidth,
      innerHeight,
      freqRange,
      ampRange,
      isDarkMode,
      3,
      0.8,
      margin,
      margin
    )
    
    // Draw the control points
    CurveRenderer.drawPoints(
      ctx,
      points,
      innerWidth,
      innerHeight,
      freqRange,
      ampRange,
      isDarkMode,
      selectedPointIndex,
      margin,
      margin
    )
    
    // Draw ghost point if visible
    if (ghostPoint.visible) {
      CurveRenderer.drawGhostPoint(
        ctx,
        ghostPoint.x,
        ghostPoint.y,
        ghostPoint.frequency,
        isDarkMode,
        0, // No offset needed since x,y are absolute
        0
      )
    }

    // Continue the animation loop
    animationFrameRef.current = requestAnimationFrame(renderCanvas)
  }, [
    points, 
    selectedPointIndex, 
    ghostPoint, 
    isDarkMode, 
    freqRange, 
    ampRange, 
    renderBackgroundCanvas
  ])
  
  // Find nearest point to cursor coordinates
  const findNearestPoint = (x: number, y: number, maxDistance: number = 20): number | null => {
    if (points.length === 0) return null
    
    let closestIndex = null
    let closestDistance = maxDistance
    
    // Get inner dimensions
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const innerWidth = rect.width - margin * 2
    const innerHeight = rect.height - margin * 2
    
    // Find the closest point
    points.forEach((point, index) => {
      const pointX = margin + CoordinateUtils.freqToX(point.frequency, innerWidth, freqRange)
      const pointY = margin + CoordinateUtils.amplitudeToY(point.amplitude, innerHeight, ampRange)
      
      const distance = Math.sqrt(Math.pow(x - pointX, 2) + Math.pow(y - pointY, 2))
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    })
    
    return closestIndex
  }
  
  // Calculate the amplitude at a given frequency based on the current points
  const calculateAmplitudeAtFrequency = (frequency: number): number => {
    if (points.length === 0) return 0
    if (points.length === 1) return points[0].amplitude
    
    // Sort points by frequency
    const sortedPoints = [...points].sort((a, b) => a.frequency - b.frequency)
    
    // Find the two points that bracket this frequency
    let leftPoint: EQPoint | null = null
    let rightPoint: EQPoint | null = null
    
    for (const point of sortedPoints) {
      if (point.frequency <= frequency) {
        if (!leftPoint || point.frequency > leftPoint.frequency) {
          leftPoint = point
        }
      }
      
      if (point.frequency >= frequency) {
        if (!rightPoint || point.frequency < rightPoint.frequency) {
          rightPoint = point
        }
      }
    }
    
    // Interpolate between points
    if (leftPoint && rightPoint) {
      if (leftPoint === rightPoint) {
        return leftPoint.amplitude
      } else {
        return CoordinateUtils.linearInterpolate(
          frequency,
          leftPoint.frequency,
          leftPoint.amplitude,
          rightPoint.frequency,
          rightPoint.amplitude
        )
      }
    } else if (leftPoint) {
      // We're to the right of all points
      return leftPoint.amplitude
    } else if (rightPoint) {
      // We're to the left of all points
      return rightPoint.amplitude
    } else {
      // This shouldn't happen, but just in case
      return 0
    }
  }
  
  // Handler for mouse movement
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    
    // Get mouse coordinates
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    // Check if we're in the inner canvas area
    const isInnerArea = x >= margin && x <= rect.width - margin && 
                      y >= margin && y <= rect.height - margin
    
    // If we're dragging a point, update its position
    if (isDraggingRef.current && selectedPointIndex !== null && isInnerArea) {
      // Calculate the new frequency and amplitude
      const innerX = x - margin
      const innerY = y - margin
      const innerWidth = rect.width - margin * 2
      const innerHeight = rect.height - margin * 2
      
      const newFrequency = CoordinateUtils.xToFreq(innerX, innerWidth, freqRange)
      const newAmplitude = CoordinateUtils.yToAmplitude(innerY, innerHeight, ampRange)
      
      // Update the point
      const newPoints = [...points]
      newPoints[selectedPointIndex] = {
        frequency: newFrequency,
        amplitude: newAmplitude
      }
      setPoints(newPoints)
      
      // Update cursor
      document.body.style.cursor = 'grabbing'
      
      return
    }
    
    // If we're not dragging, check if we're hovering over a point
    if (isInnerArea) {
      const nearestPointIndex = findNearestPoint(x, y)
      
      if (nearestPointIndex !== null) {
        // We're hovering over a point
        setSelectedPointIndex(nearestPointIndex)
        setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 })
        document.body.style.cursor = 'grab'
        
        if (onInstructionChange) {
          onInstructionChange('Click and drag to move the point')
        }
      } else {
        // We're not hovering over a point, show ghost point
        const innerX = x - margin
        const innerY = y - margin
        const innerWidth = rect.width - margin * 2
        const innerHeight = rect.height - margin * 2
        
        const frequency = CoordinateUtils.xToFreq(innerX, innerWidth, freqRange)
        
        // For the ghost point's amplitude, we'll get the current curve value at this frequency
        const amplitude = calculateAmplitudeAtFrequency(frequency)
        
        // Now calculate the y position for this amplitude
        const curveY = margin + CoordinateUtils.amplitudeToY(amplitude, innerHeight, ampRange)
        
        // Only show ghost if close to the curve
        const distanceToCurve = Math.abs(y - curveY)
        
        if (distanceToCurve < 20) {
          setGhostPoint({
            visible: true,
            x: x,
            y: curveY,
            frequency,
            amplitude
          })
          document.body.style.cursor = 'crosshair'
          
          if (onInstructionChange) {
            onInstructionChange('Click to add a new control point')
          }
        } else {
          setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 })
          document.body.style.cursor = 'default'
          
          if (onInstructionChange) {
            onInstructionChange('Move cursor near the curve to add points')
          }
        }
        
        setSelectedPointIndex(null)
      }
    } else {
      // Outside inner area
      setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 })
      setSelectedPointIndex(null)
      document.body.style.cursor = 'default'
    }
  }, [disabled, selectedPointIndex, points, freqRange, ampRange, onInstructionChange])
  
  // Handler for mouse down
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) {
      // If disabled, ask to enable
      if (onRequestEnable) {
        onRequestEnable()
      }
      return
    }
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    
    // Get mouse coordinates
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    // Check if right click (for deleting points)
    if (e.button === 2) {
      e.preventDefault()
      
      // Check if we're clicking on a point
      const nearestPointIndex = findNearestPoint(x, y)
      
      if (nearestPointIndex !== null) {
        // Delete the point
        const newPoints = [...points]
        newPoints.splice(nearestPointIndex, 1)
        setPoints(newPoints)
        setSelectedPointIndex(null)
      }
      
      return
    }
    
    // Left click - handle point creation or dragging
    if (selectedPointIndex !== null) {
      // Start dragging the selected point
      isDraggingRef.current = true
      document.body.style.cursor = 'grabbing'
    } else if (ghostPoint.visible) {
      // Create a new point
      const newPoint: EQPoint = {
        frequency: ghostPoint.frequency,
        amplitude: ghostPoint.amplitude
      }
      
      const newPoints = [...points, newPoint]
      setPoints(newPoints)
      
      // Select and start dragging the new point
      setSelectedPointIndex(newPoints.length - 1)
      isDraggingRef.current = true
      document.body.style.cursor = 'grabbing'
    }
    
    // Add document event listeners for dragging outside canvas
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      // Check if we're in the inner canvas area
      const isInnerArea = x >= margin && x <= rect.width - margin && 
                        y >= margin && y <= rect.height - margin
      
      if (isDraggingRef.current && selectedPointIndex !== null) {
        // Calculate new position, but clamp to inner area
        const innerX = Math.max(0, Math.min(rect.width - margin * 2, x - margin))
        const innerY = Math.max(0, Math.min(rect.height - margin * 2, y - margin))
        const innerWidth = rect.width - margin * 2
        const innerHeight = rect.height - margin * 2
        
        const newFrequency = CoordinateUtils.xToFreq(innerX, innerWidth, freqRange)
        const newAmplitude = CoordinateUtils.yToAmplitude(innerY, innerHeight, ampRange)
        
        // Update the point
        const newPoints = [...points]
        newPoints[selectedPointIndex] = {
          frequency: newFrequency,
          amplitude: newAmplitude
        }
        setPoints(newPoints)
      }
    }
    
    const handleDocumentMouseUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      
      document.removeEventListener('mousemove', handleDocumentMouseMove)
      document.removeEventListener('mouseup', handleDocumentMouseUp)
    }
    
    document.addEventListener('mousemove', handleDocumentMouseMove)
    document.addEventListener('mouseup', handleDocumentMouseUp)
  }, [disabled, selectedPointIndex, ghostPoint, points, freqRange, ampRange, onRequestEnable])
  
  // Prevent context menu on right click
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
  }, [])
  
  // Initialize canvases and start animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    const backgroundCanvas = backgroundCanvasRef.current
    if (!canvas || !backgroundCanvas) return

    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    
    backgroundCanvas.width = rect.width * dpr
    backgroundCanvas.height = rect.height * dpr
    
    const ctx = canvas.getContext("2d")
    const bgCtx = backgroundCanvas.getContext("2d")
    
    if (!ctx || !bgCtx) return
    
    ctx.scale(dpr, dpr)
    bgCtx.scale(dpr, dpr)
    
    canvasContextRef.current = ctx
    backgroundContextRef.current = bgCtx
    
    // Mark background as needing to be redrawn
    backgroundDrawnRef.current = false
    
    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(renderCanvas)
    
    // Clean up animation frame on unmount
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [renderCanvas])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      const backgroundCanvas = backgroundCanvasRef.current
      if (!canvas || !backgroundCanvas) return
      
      // Update canvas dimensions
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      
      backgroundCanvas.width = rect.width * dpr
      backgroundCanvas.height = rect.height * dpr
      
      // Reset context scale
      const ctx = canvas.getContext("2d")
      const bgCtx = backgroundCanvas.getContext("2d")
      
      if (ctx && bgCtx) {
        ctx.scale(dpr, dpr)
        bgCtx.scale(dpr, dpr)
        
        canvasContextRef.current = ctx
        backgroundContextRef.current = bgCtx
        
        // Mark background as needing to be redrawn
        backgroundDrawnRef.current = false
      }
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div
      className={`w-full aspect-[2/1] frequency-graph rounded-lg border dark:border-gray-700 overflow-hidden opacity-80 ${className || ""} relative`}
    >
      <canvas 
        ref={backgroundCanvasRef}
        className="w-full h-full absolute top-0 left-0 z-0"
      />
      <canvas 
        ref={canvasRef} 
        className="w-full h-full absolute top-0 left-0 z-10"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      />
    </div>
  )
} 