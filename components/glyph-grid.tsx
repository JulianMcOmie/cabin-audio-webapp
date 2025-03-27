"use client"

import { useRef, useEffect, useState, useMemo } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import * as glyphGridAudio from '@/lib/audio/glyphGridAudio'

// Glyph interface for representing a shape that defines a path
interface Glyph {
  id: string;
  type: 'line'; // For now, only diagonal line is supported
  position: { x: number, y: number }; // Center position
  size: { width: number, height: number }; // Size of the glyph
  angle?: number; // Optional rotation angle (not implemented in initial version)
}

interface GlyphGridProps {
  isPlaying: boolean;
  disabled?: boolean;
}

export function GlyphGrid({ isPlaying, disabled = false }: GlyphGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [glyph, setGlyph] = useState<Glyph>({
    id: 'diagonal-line',
    type: 'line',
    position: { x: 0, y: 0 }, // Center position (0,0) is center of canvas)
    size: { width: 1, height: 1 }, // Full size (1 = full extent of normalized space)
  })
  
  // Track the last mouse position for dragging and resizing
  const [lastMousePos, setLastMousePos] = useState<{ x: number, y: number } | null>(null)
  
  // Track the resize handle being used (0 = none, 1-4 for corner handles)
  const [activeHandle, setActiveHandle] = useState<number>(0)
  
  // State for dark mode detection
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Set up observer to detect theme changes
  useEffect(() => {
    // Initial check
    setIsDarkMode(document.documentElement.classList.contains("dark"))

    // Set up mutation observer to watch for class changes on html element
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
  
  // Initialize the audio player
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    
    // Set the initial glyph
    audioPlayer.setGlyph({
      id: glyph.id,
      type: glyph.type,
      position: glyph.position,
      size: glyph.size,
      angle: glyph.angle
    })
    
    return () => {
      // Clean up audio on unmount
      glyphGridAudio.cleanupGlyphGridAudioPlayer()
    }
  }, [])
  
  // This causes unnecessary stuttering by constantly stopping and restarting audio
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    
    audioPlayer.setGlyph({
      id: glyph.id,
      type: glyph.type,
      position: glyph.position,
      size: glyph.size,
      angle: glyph.angle
    })
  }, [glyph])
  
  // Update audio player when playing state changes
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    audioPlayer.setPlaying(isPlaying && !disabled)
  }, [isPlaying, disabled])
  
  // Update canvas size on resize
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      
      // Set canvas dimensions with proper DPI scaling
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(dpr, dpr)
      }
    }
    
    updateCanvasSize()
    window.addEventListener('resize', updateCanvasSize)
    
    return () => {
      window.removeEventListener('resize', updateCanvasSize)
    }
  }, [])
  
  // Draw the glyph on the canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Clear the canvas
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    
    // Draw grid lines
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
    ctx.lineWidth = 1
    
    // Vertical grid lines
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * rect.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * rect.height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
    }
    
    // Draw the diagonal line glyph
    if (glyph.type === 'line') {
      // In the audio system, (-1,-1) is bottom-left and (1,1) is top-right
      // In the canvas, (0,0) is top-left and (width,height) is bottom-right
      
      // Convert from glyph normalized coords to canvas coords
      // startX maps from -1 to 0, and 1 to width
      // startY maps from -1 to height, and 1 to 0 (Y is inverted)
      
      // Calculate glyph corners in normalized space
      const startX_norm = glyph.position.x - glyph.size.width / 2
      const startY_norm = glyph.position.y - glyph.size.height / 2
      const endX_norm = glyph.position.x + glyph.size.width / 2
      const endY_norm = glyph.position.y + glyph.size.height / 2
      
      // Convert normalized coordinates to canvas pixels
      // Map from normalized -1,1 to canvas 0,width or 0,height
      const startX = (startX_norm + 1) / 2 * rect.width
      const startY = (1 - startY_norm) / 2 * rect.height // Y is inverted
      const endX = (endX_norm + 1) / 2 * rect.width
      const endY = (1 - endY_norm) / 2 * rect.height // Y is inverted
      
      // Draw the path that the noise will follow
      ctx.strokeStyle = isDarkMode ? '#38bdf8' : '#0284c7'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(endX, endY)
      ctx.stroke()
      
      // If playing, draw a moving dot along the path
      if (isPlaying && !disabled) {
        const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
        const pathPosition = audioPlayer.getPathPosition()
        
        const dotX = startX + (endX - startX) * pathPosition
        const dotY = startY + (endY - startY) * pathPosition
        
        // Draw the dot
        ctx.fillStyle = isDarkMode ? 'rgb(56, 189, 248)' : 'rgb(2, 132, 199)'
        ctx.beginPath()
        ctx.arc(dotX, dotY, 8, 0, Math.PI * 2)
        ctx.fill()
        
        // Request animation frame to continue the animation
        requestAnimationFrame(() => {
          setGlyph(prev => ({ ...prev }))
        })
      }
      
      // Draw resize handles at corners if not disabled
      if (!disabled) {
        const handleRadius = 6
        const handles = [
          { x: startX, y: startY }, // Bottom-left
          { x: endX, y: endY },     // Top-right
          { x: startX, y: endY },   // Top-left
          { x: endX, y: startY }    // Bottom-right
        ]
        
        handles.forEach((handle, index) => {
          ctx.fillStyle = isDarkMode ? 'white' : 'black'
          ctx.beginPath()
          ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2)
          ctx.fill()
        })
      }
    }
  }, [glyph, isPlaying, disabled, isDarkMode])
  
  // Handle mouse interactions (drag, resize)
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    setLastMousePos({ x: mouseX, y: mouseY })
    
    // Convert canvas pixel coordinates to normalized coordinates
    // Map from 0,width to -1,1 and 0,height to 1,-1 (Y is inverted)
    const normX = (mouseX / rect.width) * 2 - 1
    const normY = 1 - (mouseY / rect.height) * 2 // Y is inverted
    
    // Calculate glyph corners in normalized space
    const startX_norm = glyph.position.x - glyph.size.width / 2
    const startY_norm = glyph.position.y - glyph.size.height / 2
    const endX_norm = glyph.position.x + glyph.size.width / 2
    const endY_norm = glyph.position.y + glyph.size.height / 2
    
    // Convert to canvas coordinates for checking handles
    const startX = (startX_norm + 1) / 2 * rect.width
    const startY = (1 - startY_norm) / 2 * rect.height
    const endX = (endX_norm + 1) / 2 * rect.width
    const endY = (1 - endY_norm) / 2 * rect.height
    
    // Check if we're near a resize handle
    const handleRadius = 10
    const handles = [
      { x: startX, y: startY }, // Bottom-left
      { x: endX, y: endY },     // Top-right
      { x: startX, y: endY },   // Top-left
      { x: endX, y: startY }    // Bottom-right
    ]
    
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]
      const distance = Math.sqrt(
        Math.pow(mouseX - handle.x, 2) + 
        Math.pow(mouseY - handle.y, 2)
      )
      
      if (distance <= handleRadius) {
        setIsResizing(true)
        setActiveHandle(i + 1)
        return
      }
    }
    
    setIsDragging(true)
  }
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if ((isDragging || isResizing) && lastMousePos) {
      const canvas = canvasRef.current
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      // Calculate delta from last position
      const deltaX = mouseX - lastMousePos.x
      const deltaY = mouseY - lastMousePos.y
      
      if (isDragging) {
        // Move the entire glyph
        // Convert delta from canvas coordinates to normalized coordinates
        const normalizedDeltaX = deltaX / (rect.width / 2)
        const normalizedDeltaY = -deltaY / (rect.height / 2) // Negative because Y is inverted
        
        setGlyph(prev => {
          // Calculate new position
          let newX = prev.position.x + normalizedDeltaX
          let newY = prev.position.y + normalizedDeltaY
          
          // Constrain to keep the glyph within bounds
          const maxX = 1 - prev.size.width
          const maxY = 1 - prev.size.height
          newX = Math.max(-maxX, Math.min(maxX, newX))
          newY = Math.max(-maxY, Math.min(maxY, newY))
          
          return {
            ...prev,
            position: { x: newX, y: newY }
          }
        })
      } else if (isResizing) {
        setGlyph(prev => {
          // Calculate center and current dimensions in canvas coordinates
          const centerX = (rect.width / 2) + (prev.position.x * rect.width / 2)
          const centerY = (rect.height / 2) - (prev.position.y * rect.height / 2)
          const halfWidth = (prev.size.width * rect.width / 2)
          const halfHeight = (prev.size.height * rect.height / 2)
          
          // Calculate corner positions
          const startX = centerX - halfWidth
          const startY = centerY + halfHeight
          const endX = centerX + halfWidth
          const endY = centerY - halfHeight
          
          // Update position based on which handle is active
          let newWidth = prev.size.width
          let newHeight = prev.size.height
          let newPosX = prev.position.x
          let newPosY = prev.position.y
          
          switch (activeHandle) {
            case 1: // Bottom-left
              // Update width and height
              newWidth = prev.size.width - (deltaX / (rect.width / 2)) * 2
              newHeight = prev.size.height + (deltaY / (rect.height / 2)) * 2
              
              // Adjust position to keep the opposite corner fixed
              newPosX = prev.position.x - (deltaX / (rect.width / 2))
              newPosY = prev.position.y + (deltaY / (rect.height / 2))
              break
              
            case 2: // Top-right
              // Update width and height
              newWidth = prev.size.width + (deltaX / (rect.width / 2)) * 2
              newHeight = prev.size.height - (deltaY / (rect.height / 2)) * 2
              
              // Adjust position to keep the opposite corner fixed
              newPosX = prev.position.x + (deltaX / (rect.width / 2))
              newPosY = prev.position.y - (deltaY / (rect.height / 2))
              break
              
            case 3: // Top-left
              // Update width and height
              newWidth = prev.size.width - (deltaX / (rect.width / 2)) * 2
              newHeight = prev.size.height - (deltaY / (rect.height / 2)) * 2
              
              // Adjust position to keep the opposite corner fixed
              newPosX = prev.position.x - (deltaX / (rect.width / 2))
              newPosY = prev.position.y - (deltaY / (rect.height / 2))
              break
              
            case 4: // Bottom-right
              // Update width and height
              newWidth = prev.size.width + (deltaX / (rect.width / 2)) * 2
              newHeight = prev.size.height + (deltaY / (rect.height / 2)) * 2
              
              // Adjust position to keep the opposite corner fixed
              newPosX = prev.position.x + (deltaX / (rect.width / 2))
              newPosY = prev.position.y + (deltaY / (rect.height / 2))
              break
          }
          
          // Constrain size and position
          newWidth = Math.max(0.1, Math.min(2.0, newWidth))
          newHeight = Math.max(0.1, Math.min(2.0, newHeight))
          
          // Ensure glyph stays within bounds
          const maxX = 1 - newWidth / 2
          const maxY = 1 - newHeight / 2
          newPosX = Math.max(-maxX, Math.min(maxX, newPosX))
          newPosY = Math.max(-maxY, Math.min(maxY, newPosY))
          
          return {
            ...prev,
            position: { x: newPosX, y: newPosY },
            size: { width: newWidth, height: newHeight }
          }
        })
      }
      
      // Update last mouse position
      setLastMousePos({ x: mouseX, y: mouseY })
    }
  }
  
  const handleMouseUp = () => {
    setIsDragging(false)
    setIsResizing(false)
    setActiveHandle(0)
    setLastMousePos(null)
  }
  
  return (
    <div className="space-y-4">
      <div className="relative bg-background/50 rounded-lg p-3">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-square cursor-move ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
      
      <div className="flex flex-col space-y-2">
        {/* Basic glyph information */}
        <div className="text-xs text-center text-muted-foreground mt-2">
          X: {glyph.position.x.toFixed(2)}, Y: {glyph.position.y.toFixed(2)} • 
          W: {glyph.size.width.toFixed(2)}, H: {glyph.size.height.toFixed(2)}
        </div>
      </div>
    </div>
  )
} 