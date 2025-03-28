"use client"

import { useRef, useEffect, useState, useMemo } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import * as glyphGridAudio from '@/lib/audio/glyphGridAudio'
import { Button } from "@/components/ui/button"

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

  // Add to GlyphGrid component state
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [manualPosition, setManualPosition] = useState(0) // 0 to 1
  const timelineRef = useRef<HTMLDivElement>(null)
  const isDraggingTimelineRef = useRef(false)
  const [subsectionStart, setSubsectionStart] = useState(0)
  const [subsectionEnd, setSubsectionEnd] = useState(1)
  const [isDraggingSubsectionStart, setIsDraggingSubsectionStart] = useState(false)
  const [isDraggingSubsectionEnd, setIsDraggingSubsectionEnd] = useState(false)
  const subsectionTimelineRef = useRef<HTMLDivElement>(null)

  // Add speed state
  const [speed, setSpeed] = useState(1.0)

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
    
    // Calculate glyph corners in canvas pixel coordinates
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
      
      // Calculate delta from last position in canvas pixels
      const deltaX = mouseX - lastMousePos.x
      const deltaY = mouseY - lastMousePos.y
      
      if (isDragging) {
        // Move the entire glyph
        // Convert delta from canvas pixels to normalized coordinates
        const normalizedDeltaX = deltaX / rect.width * 2  // Scale to normalized space
        const normalizedDeltaY = -deltaY / rect.height * 2  // Y is inverted in normalized space
        
        setGlyph(prev => {
          // Calculate new position
          let newX = prev.position.x + normalizedDeltaX
          let newY = prev.position.y + normalizedDeltaY
          
          // Constrain to keep the glyph within visible bounds (-1 to 1)
          const maxOffset = 1 - prev.size.width / 2
          newX = Math.max(-maxOffset, Math.min(maxOffset, newX))
          
          const maxOffsetY = 1 - prev.size.height / 2
          newY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newY))
          
          return {
            ...prev,
            position: { x: newX, y: newY }
          }
        })
      } else if (isResizing) {
        // For resizing, work in canvas pixel coordinates and convert back to normalized
        // This provides a direct 1:1 mapping between cursor movement and corner movement
        
        setGlyph(prev => {
          // Convert glyph corners to canvas coordinates
          const startX_norm = prev.position.x - prev.size.width / 2
          const startY_norm = prev.position.y - prev.size.height / 2
          const endX_norm = prev.position.x + prev.size.width / 2
          const endY_norm = prev.position.y + prev.size.height / 2
          
          // Convert to canvas coordinates
          let startX = (startX_norm + 1) / 2 * rect.width
          let startY = (1 - startY_norm) / 2 * rect.height
          let endX = (endX_norm + 1) / 2 * rect.width
          let endY = (1 - endY_norm) / 2 * rect.height
          
          // Update the appropriate corner based on which handle is active
          switch (activeHandle) {
            case 1: // Bottom-left
              startX += deltaX
              startY += deltaY
              break
            case 2: // Top-right
              endX += deltaX
              endY += deltaY
              break
            case 3: // Top-left
              startX += deltaX
              endY += deltaY
              break
            case 4: // Bottom-right
              endX += deltaX
              startY += deltaY
              break
          }
          
          // Convert back to normalized coordinates
          const new_startX_norm = (startX / rect.width) * 2 - 1
          const new_startY_norm = 1 - (startY / rect.height) * 2 // Y is inverted
          const new_endX_norm = (endX / rect.width) * 2 - 1
          const new_endY_norm = 1 - (endY / rect.height) * 2 // Y is inverted
          
          // Calculate new dimensions and position
          const newWidth = Math.abs(new_endX_norm - new_startX_norm)
          const newHeight = Math.abs(new_endY_norm - new_startY_norm)
          const newPosX = (new_startX_norm + new_endX_norm) / 2
          const newPosY = (new_startY_norm + new_endY_norm) / 2
          
          // Constrain to keep within bounds (-1 to 1)
          const constrainedWidth = Math.min(newWidth, 2)
          const constrainedHeight = Math.min(newHeight, 2)
          
          // Ensure minimum size
          const finalWidth = Math.max(0.1, constrainedWidth)
          const finalHeight = Math.max(0.1, constrainedHeight)
          
          // Recalculate position to ensure we stay within bounds
          let finalPosX = newPosX
          let finalPosY = newPosY
          
          const maxOffsetX = 1 - finalWidth / 2
          const maxOffsetY = 1 - finalHeight / 2
          
          finalPosX = Math.max(-maxOffsetX, Math.min(maxOffsetX, finalPosX))
          finalPosY = Math.max(-maxOffsetY, Math.min(maxOffsetY, finalPosY))
          
          return {
            ...prev,
            position: { x: finalPosX, y: finalPosY },
            size: { width: finalWidth, height: finalHeight }
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
  
  // Add this useEffect to update the audio player with the manual position
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    
    if (isScrubbing) {
      audioPlayer.setManualPosition(manualPosition)
    } else {
      audioPlayer.setManualControl(false)
    }
  }, [isScrubbing, manualPosition])

  // Add these event handlers for the timeline
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    
    const timeline = timelineRef.current
    if (!timeline) return
    
    isDraggingTimelineRef.current = true
    setIsScrubbing(true)
    
    // Calculate position based on click position
    const rect = timeline.getBoundingClientRect()
    const x = e.clientX - rect.left
    const position = Math.max(0, Math.min(1, x / rect.width))
    setManualPosition(position)
  }

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingTimelineRef.current) return
    
    const timeline = timelineRef.current
    if (!timeline) return
    
    // Calculate position based on mouse position
    const rect = timeline.getBoundingClientRect()
    const x = e.clientX - rect.left
    const position = Math.max(0, Math.min(1, x / rect.width))
    setManualPosition(position)
  }

  const handleTimelineMouseUp = () => {
    isDraggingTimelineRef.current = false
  }

  const handleTimelineMouseLeave = () => {
    if (isDraggingTimelineRef.current) {
      isDraggingTimelineRef.current = false
    }
  }

  const togglePlayback = () => {
    if (isScrubbing) {
      // Resume automatic movement from current position
      const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
      audioPlayer.resumeFromPosition(manualPosition)
      setIsScrubbing(false)
    } else {
      // Switch to manual control
      setIsScrubbing(true)
    }
  }

  // Add this useEffect to update the audio player when subsection changes
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    audioPlayer.setSubsection(subsectionStart, subsectionEnd, true)
  }, [subsectionStart, subsectionEnd])

  // Add these handlers for direct manipulation of subsection start/end
  const handleSubsectionMouseDown = (e: React.MouseEvent<HTMLDivElement>, isStartHandle: boolean) => {
    if (disabled) return
    
    const timeline = subsectionTimelineRef.current
    if (!timeline) return
    
    if (isStartHandle) {
      setIsDraggingSubsectionStart(true)
    } else {
      setIsDraggingSubsectionEnd(true)
    }
    
    // Calculate position based on click position
    updateSubsectionHandlePosition(e, isStartHandle)
  }

  const updateSubsectionHandlePosition = (e: React.MouseEvent<HTMLDivElement>, isStartHandle: boolean) => {
    const timeline = subsectionTimelineRef.current
    if (!timeline) return
    
    const rect = timeline.getBoundingClientRect()
    const x = e.clientX - rect.left
    const position = Math.max(0, Math.min(1, x / rect.width))
    
    if (isStartHandle) {
      // Ensure start doesn't exceed end
      setSubsectionStart(Math.min(position, subsectionEnd))
    } else {
      // Ensure end doesn't go below start
      setSubsectionEnd(Math.max(position, subsectionStart))
    }
  }

  const handleSubsectionMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingSubsectionStart) {
      updateSubsectionHandlePosition(e, true)
    } else if (isDraggingSubsectionEnd) {
      updateSubsectionHandlePosition(e, false)
    }
  }

  const handleSubsectionMouseUp = () => {
    setIsDraggingSubsectionStart(false)
    setIsDraggingSubsectionEnd(false)
  }

  const handleSubsectionMouseLeave = () => {
    setIsDraggingSubsectionStart(false)
    setIsDraggingSubsectionEnd(false)
  }

  // Add a useEffect to update the audio player when speed changes
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    audioPlayer.setSpeed(speed)
  }, [speed])

  // Add a handler for speed slider change
  const handleSpeedChange = (values: number[]) => {
    setSpeed(values[0])
  }

  // Add a function to format the speed display
  const formatSpeed = (value: number): string => {
    return `${value.toFixed(2)}x`
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
      
      {/* Timeline scrubber */}
      <div className="space-y-2">
        <div 
          ref={timelineRef}
          className="h-6 bg-muted rounded-md relative cursor-pointer"
          onMouseDown={handleTimelineMouseDown}
          onMouseMove={handleTimelineMouseMove}
          onMouseUp={handleTimelineMouseUp}
          onMouseLeave={handleTimelineMouseLeave}
        >
          {/* Timeline background with position markers */}
          <div className="absolute inset-0 flex justify-between px-2">
            {[0, 0.25, 0.5, 0.75, 1].map((pos) => (
              <div key={pos} className="h-full flex flex-col justify-center">
                <div className="w-0.5 h-2 bg-muted-foreground/30"></div>
              </div>
            ))}
          </div>
          
          {/* Current position marker */}
          <div 
            className="absolute top-0 bottom-0 w-1 bg-primary rounded-full transform -translate-x-1/2"
            style={{ 
              left: `${(isScrubbing ? manualPosition : glyphGridAudio.getGlyphGridAudioPlayer().getPathPosition()) * 100}%`,
              transition: isScrubbing ? 'none' : 'left 0.1s linear'
            }}
          ></div>
        </div>
        
        {/* Playback controls */}
        <div className="flex justify-between items-center">
          <Button 
            variant="outline" 
            size="sm"
            onClick={togglePlayback}
            disabled={disabled || !isPlaying}
          >
            {isScrubbing ? "Resume Auto" : "Scrub"}
          </Button>
          
          <div className="text-xs text-muted-foreground">
            Position: {(isScrubbing ? manualPosition : glyphGridAudio.getGlyphGridAudioPlayer().getPathPosition()).toFixed(2)}
          </div>
        </div>
      </div>
      
      {/* New separate subsection loop control */}
      <div className="pt-3 border-t border-muted space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Loop Subsection</span>
          <span className="text-xs text-muted-foreground">
            {subsectionStart.toFixed(2)} to {subsectionEnd.toFixed(2)}
          </span>
        </div>
        
        <div 
          ref={subsectionTimelineRef}
          className="h-6 bg-muted rounded-md relative cursor-pointer"
          onMouseMove={handleSubsectionMouseMove}
          onMouseUp={handleSubsectionMouseUp}
          onMouseLeave={handleSubsectionMouseLeave}
        >
          {/* Timeline background with position markers */}
          <div className="absolute inset-0 flex justify-between px-2">
            {[0, 0.25, 0.5, 0.75, 1].map((pos) => (
              <div key={pos} className="h-full flex flex-col justify-center">
                <div className="w-0.5 h-2 bg-muted-foreground/30"></div>
              </div>
            ))}
          </div>
          
          {/* Subsection range indicator */}
          <div 
            className="absolute top-0 bottom-0 bg-primary/20"
            style={{ 
              left: `${subsectionStart * 100}%`,
              width: `${(subsectionEnd - subsectionStart) * 100}%`
            }}
          ></div>
          
          {/* Current position marker (also shown in subsection timeline) */}
          <div 
            className="absolute top-0 bottom-0 w-1 bg-primary/40 rounded-full transform -translate-x-1/2"
            style={{ 
              left: `${(isScrubbing ? manualPosition : glyphGridAudio.getGlyphGridAudioPlayer().getPathPosition()) * 100}%`,
              transition: isScrubbing ? 'none' : 'left 0.1s linear'
            }}
          ></div>
          
          {/* Subsection start handle */}
          <div 
            className="absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group z-10"
            style={{ left: `${subsectionStart * 100}%`, transform: 'translateX(-50%)' }}
            onMouseDown={(e) => handleSubsectionMouseDown(e, true)}
          >
            <div className="w-1 h-full bg-primary/70 rounded-full group-hover:bg-primary group-active:bg-primary"></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary/20 opacity-0 group-hover:opacity-100 group-active:opacity-100"></div>
          </div>
          
          {/* Subsection end handle */}
          <div 
            className="absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group z-10"
            style={{ left: `${subsectionEnd * 100}%`, transform: 'translateX(-50%)' }}
            onMouseDown={(e) => handleSubsectionMouseDown(e, false)}
          >
            <div className="w-1 h-full bg-primary/70 rounded-full group-hover:bg-primary group-active:bg-primary"></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary/20 opacity-0 group-hover:opacity-100 group-active:opacity-100"></div>
          </div>
        </div>
        
        <div className="flex text-xs text-muted-foreground justify-between">
          <span>Start</span>
          <span>End</span>
        </div>
      </div>
      
      {/* Speed control */}
      <div className="pt-3 border-t border-muted space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Playback Speed</span>
          <span className="text-xs text-muted-foreground">
            {formatSpeed(speed)}
          </span>
        </div>
        
        <Slider
          value={[speed]}
          min={0.25}
          max={4.0}
          step={0.05}
          onValueChange={handleSpeedChange}
          disabled={disabled}
        />
        
        <div className="flex text-xs text-muted-foreground justify-between">
          <span>Slow</span>
          <span>Fast</span>
        </div>
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