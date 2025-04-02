"use client"

import { useRef, useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"
import * as glyphGridAudio from '@/lib/audio/glyphGridAudio'
// import { PlaybackMode } from '@/lib/audio/glyphGridAudio'

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
  const [dragTarget, setDragTarget] = useState<'none' | 'vertex1' | 'vertex2' | 'line'>('none')
  const [glyph, setGlyph] = useState<Glyph>({
    id: 'diagonal-line',
    type: 'line',
    position: { x: 0, y: 0 }, // Center position (0,0) is center of canvas)
    size: { width: 1, height: 1 }, // Full size (1 = full extent of normalized space)
  })
  
  // Track the last mouse position for dragging and resizing
  const [lastMousePos, setLastMousePos] = useState<{ x: number, y: number } | null>(null)
  
  // State for dark mode detection
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Add to GlyphGrid component state
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [manualPosition, setManualPosition] = useState(0) // 0 to 1
  const isDraggingTimelineRef = useRef(false)
  const subsectionTimelineRef = useRef<HTMLDivElement>(null)

  // Add speed state
  const [speed, setSpeed] = useState(1.0)

  // Add hover state tracking for interactive elements
  const [hoverState, setHoverState] = useState<'none' | 'vertex1' | 'vertex2' | 'line'>('none')

  // Add a reference to store the animation frame ID
  const animationFrameRef = useRef<number | null>(null);

  // Add state for background noise volume and filter bandwidth (Q factor)
  const [backgroundNoiseVolume, setBackgroundNoiseVolume] = useState(0.1) // Default 0.1 (10%)
  const [filterQ, setFilterQ] = useState(5.0) // Default Q factor is 5.0

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
    
    // Enable envelope modulation by default
    audioPlayer.setModulating(true)
    
    // Ensure continuous frequencies (not discrete/quantized)
    audioPlayer.setDiscreteFrequency(false)
    
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
      
      // Calculate glyph corners in normalized space
      const startX_norm = glyph.position.x - glyph.size.width / 2
      const startY_norm = glyph.position.y - glyph.size.height / 2
      const endX_norm = glyph.position.x + glyph.size.width / 2
      const endY_norm = glyph.position.y + glyph.size.height / 2
      
      // Convert normalized coordinates to canvas pixels
      const startX = (startX_norm + 1) / 2 * rect.width
      const startY = (1 - startY_norm) / 2 * rect.height // Y is inverted
      const endX = (endX_norm + 1) / 2 * rect.width
      const endY = (1 - endY_norm) / 2 * rect.height // Y is inverted
      
      // Draw the path line with hover effect if needed
      if (hoverState === 'line' && !isDragging && !isResizing) {
        // Draw a highlight underneath for hover state
        ctx.strokeStyle = isDarkMode ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.3)'
        ctx.lineWidth = 8
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        ctx.stroke()
      }
      
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
        // Only show bottom-left and top-right corners
        const handles = [
          { x: startX, y: startY, state: 'vertex1' }, // Bottom-left
          { x: endX, y: endY, state: 'vertex2' },     // Top-right
        ]
        
        handles.forEach((handle) => {
          // Add hover effect
          if (hoverState === handle.state && !isDragging && !isResizing) {
            // Draw highlight circle first
            ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)'
            ctx.beginPath()
            ctx.arc(handle.x, handle.y, handleRadius + 4, 0, Math.PI * 2)
            ctx.fill()
          }
          
          // Draw handle
          ctx.fillStyle = isDarkMode ? 'white' : 'black'
          ctx.beginPath()
          ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2)
          ctx.fill()
        })
      }
    }
  }, [glyph, isPlaying, disabled, isDarkMode, hoverState, isDragging, isResizing])
  
  // Function to check what's under the cursor
  const checkHoverTarget = (mouseX: number, mouseY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 'none'
    
    const rect = canvas.getBoundingClientRect()
    
    // Calculate glyph corners in normalized space
    const startX_norm = glyph.position.x - glyph.size.width / 2
    const startY_norm = glyph.position.y - glyph.size.height / 2
    const endX_norm = glyph.position.x + glyph.size.width / 2
    const endY_norm = glyph.position.y + glyph.size.height / 2
    
    // Convert to canvas coordinates
    const startX = (startX_norm + 1) / 2 * rect.width
    const startY = (1 - startY_norm) / 2 * rect.height
    const endX = (endX_norm + 1) / 2 * rect.width
    const endY = (1 - endY_norm) / 2 * rect.height
    
    // Check vertices first (they have priority)
    const handleRadius = 12 // Slightly larger than visual radius for better UX
    
    // Check first vertex (bottom-left)
    const distToVertex1 = Math.sqrt(
      Math.pow(mouseX - startX, 2) + Math.pow(mouseY - startY, 2)
    )
    if (distToVertex1 <= handleRadius) {
      return 'vertex1'
    }
    
    // Check second vertex (top-right)
    const distToVertex2 = Math.sqrt(
      Math.pow(mouseX - endX, 2) + Math.pow(mouseY - endY, 2)
    )
    if (distToVertex2 <= handleRadius) {
      return 'vertex2'
    }
    
    // Check if near the line
    // Calculate distance from point to line segment
    const lineDistThreshold = 10 // px
    
    // Calculate line segment length squared
    const lineLengthSq = Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    
    if (lineLengthSq === 0) return 'none' // Line has no length
    
    // Calculate projection of point onto line
    const t = ((mouseX - startX) * (endX - startX) + (mouseY - startY) * (endY - startY)) / lineLengthSq
    
    // If projection is outside line segment, use distance to nearest endpoint
    if (t < 0 || t > 1) return 'none'
    
    // Calculate projected point on line
    const projX = startX + t * (endX - startX)
    const projY = startY + t * (endY - startY)
    
    // Calculate distance to projected point
    const distToLine = Math.sqrt(Math.pow(mouseX - projX, 2) + Math.pow(mouseY - projY, 2))
    
    if (distToLine <= lineDistThreshold) {
      return 'line'
    }
    
    return 'none'
  }

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
    // Only check bottom-left and top-right corners
    const handles = [
      { x: startX, y: startY, target: 'vertex1' as const }, // Bottom-left
      { x: endX, y: endY, target: 'vertex2' as const },     // Top-right
    ]
    
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]
      const distance = Math.sqrt(
        Math.pow(mouseX - handle.x, 2) + 
        Math.pow(mouseY - handle.y, 2)
      )
      
      if (distance <= handleRadius) {
        setIsResizing(true)
        setDragTarget(handle.target) // Set the specific vertex being dragged
        return
      }
    }
    
    // If we're not resizing a vertex, check if we're over the line
    const hoverTarget = checkHoverTarget(mouseX, mouseY)
    if (hoverTarget === 'line') {
      setIsDragging(true)
      setDragTarget('line')
    }
  }
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // Only update hover state when not actively dragging or resizing
    if (!isDragging && !isResizing) {
      const target = checkHoverTarget(mouseX, mouseY)
      setHoverState(target)
    }
    
    if ((isDragging || isResizing) && lastMousePos) {
      // Calculate delta from last position in canvas pixels
      const deltaX = mouseX - lastMousePos.x
      const deltaY = mouseY - lastMousePos.y
      
      if (isDragging) {
        // Move the entire glyph - using stored dragTarget instead of checking hover
        // Convert delta from canvas pixels to normalized coordinates
        const normalizedDeltaX = deltaX / rect.width * 2  // Scale to normalized space
        const normalizedDeltaY = -deltaY / rect.height * 2  // Y is inverted in normalized space
        
        setGlyph(prev => {
          // Calculate new position
          const newX = prev.position.x + normalizedDeltaX
          const newY = prev.position.y + normalizedDeltaY
          
          // Only constrain to keep center within canvas (-1 to 1)
          const finalPosX = Math.max(-1, Math.min(1, newX))
          const finalPosY = Math.max(-1, Math.min(1, newY))
          
          return {
            ...prev,
            position: { x: finalPosX, y: finalPosY }
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
          
          // Use the stored dragTarget instead of activeHandle for clarity
          // Ensuring consistent behavior throughout the drag
          if (dragTarget === 'vertex1') {
            startX += deltaX
            startY += deltaY
          } else if (dragTarget === 'vertex2') {
            endX += deltaX
            endY += deltaY
          }
          
          // Convert back to normalized coordinates
          const new_startX_norm = (startX / rect.width) * 2 - 1
          const new_startY_norm = 1 - (startY / rect.height) * 2 // Y is inverted
          const new_endX_norm = (endX / rect.width) * 2 - 1
          const new_endY_norm = 1 - (endY / rect.height) * 2 // Y is inverted
          
          // Calculate dimensions without enforcing that end > start
          // This allows vertices to cross each other and change line direction
          const newWidth = new_endX_norm - new_startX_norm
          const newHeight = new_endY_norm - new_startY_norm
          
          // Calculate the new center position (midpoint of the two corners)
          const newPosX = (new_startX_norm + new_endX_norm) / 2
          const newPosY = (new_startY_norm + new_endY_norm) / 2
          
          // Keep position within canvas bounds
          const finalPosX = Math.max(-1, Math.min(1, newPosX))
          const finalPosY = Math.max(-1, Math.min(1, newPosY))
          
          // Remove minimum size enforcement
          // Use the calculated dimensions directly
          return {
            ...prev,
            position: { x: finalPosX, y: finalPosY },
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
    setLastMousePos(null)
    setDragTarget('none') // Reset drag target when mouse is released
  }
  
  // Add this useEffect to update the audio player with the manual position
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    
    if (isScrubbing) {
      // Set to manual position and ensure audio is playing while scrubbing
      audioPlayer.setManualPosition(manualPosition)
      audioPlayer.setPlaying(true)
    } else {
      // When not scrubbing, return to automatic control based on isPlaying state
      audioPlayer.setManualControl(false)
      audioPlayer.setPlaying(isPlaying && !disabled)
    }
  }, [isScrubbing, manualPosition, isPlaying, disabled])

  // Replace the existing useEffect that forces UI updates with a more efficient animation frame approach
  useEffect(() => {
    const updateUI = () => {
      if (isScrubbing) {
        // Force a rerender by making a small state update
        setGlyph(prev => ({...prev}));
        
        // Continue the animation loop while scrubbing
        animationFrameRef.current = requestAnimationFrame(updateUI);
      }
    };
    
    if (isScrubbing) {
      // Start the animation loop when scrubbing begins
      animationFrameRef.current = requestAnimationFrame(updateUI);
    } else if (animationFrameRef.current) {
      // Cancel the animation loop when scrubbing ends
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    return () => {
      // Clean up the animation frame on unmount or when dependency changes
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isScrubbing]);

  // Add these event handlers for the timeline
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    
    const timeline = subsectionTimelineRef.current
    if (!timeline) return
    
    // Calculate position based on click position
    const rect = timeline.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const position = Math.max(0, Math.min(1, mouseX / rect.width))
    
    // Set position and start scrubbing
    setManualPosition(position)
    isDraggingTimelineRef.current = true
    setIsScrubbing(true)
  }

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingTimelineRef.current) return
    
    const timeline = subsectionTimelineRef.current
    if (!timeline) return
    
    // Calculate position based on mouse position
    const rect = timeline.getBoundingClientRect()
    const x = e.clientX - rect.left
    const position = Math.max(0, Math.min(1, x / rect.width))
    
    // Update the manual position which will be picked up by the audio player
    setManualPosition(position)
  }

  const handleTimelineMouseUp = () => {
    if (isDraggingTimelineRef.current) {
      isDraggingTimelineRef.current = false
      
      // On mouseup, return to the previous play state
      // If isPlaying was true, it will continue from the current position
      // If isPlaying was false, it will stop
      setIsScrubbing(false)
      
      // The audio state (playing or not playing) will be handled in the useEffect
    }
  }

  const handleTimelineMouseLeave = () => {
    if (isDraggingTimelineRef.current) {
      handleTimelineMouseUp()
    }
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

  // Update cursor style based on hover state
  const getCursorStyle = () => {
    if (disabled) return "not-allowed"
    if (isResizing || isDragging) return "grabbing"
    
    switch (hoverState) {
      case 'vertex1':
      case 'vertex2':
        return "grab"
      case 'line':
        return "move"
      default:
        return "default"
    }
  }

  // Add handlers for the new sliders
  const handleBackgroundNoiseVolumeChange = (values: number[]) => {
    setBackgroundNoiseVolume(values[0])
  }

  const handleFilterQChange = (values: number[]) => {
    setFilterQ(values[0])
  }

  // Add effects to update audio player with new slider values
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    audioPlayer.setBackgroundNoiseVolume(backgroundNoiseVolume)
  }, [backgroundNoiseVolume])

  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
    audioPlayer.setFilterQ(filterQ)
  }, [filterQ])

  return (
    <div className="space-y-4">
      {/* Canvas container */}
      <div className="relative bg-gray-100 dark:bg-background/50 rounded-lg p-2">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[4/3] ${disabled ? "opacity-70" : ""}`}
          style={{ cursor: getCursorStyle() }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
      
      {/* Controls - make more compact */}
      <div className="space-y-3">
        {/* Simplified playback control - scrubbing only */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium">Playback Position</h4>
            <div className="text-xs text-muted-foreground">
              {isScrubbing ? manualPosition.toFixed(2) : glyphGridAudio.getGlyphGridAudioPlayer().getPathPosition().toFixed(2)}
            </div>
          </div>
          
          <div 
            ref={subsectionTimelineRef}
            className="h-6 bg-muted rounded-md relative cursor-pointer"
            onMouseDown={handleTimelineMouseDown}
            onMouseMove={handleTimelineMouseMove}
            onMouseUp={handleTimelineMouseUp}
            onMouseLeave={handleTimelineMouseLeave}
          >
            {/* Timeline background with position markers */}
            <div className="absolute inset-0 flex justify-between px-1">
              {[0, 0.25, 0.5, 0.75, 1].map((pos) => (
                <div key={pos} className="h-full flex flex-col justify-center">
                  <div className="w-0.5 h-1.5 bg-muted-foreground/30"></div>
                </div>
              ))}
            </div>
            
            {/* Current position marker (scrub handle) */}
            <div 
              className="absolute top-0 bottom-0 w-1 bg-emerald-500 rounded-full transform -translate-x-1/2 z-20 cursor-col-resize"
              style={{ 
                left: `${isScrubbing ? manualPosition * 100 : glyphGridAudio.getGlyphGridAudioPlayer().getPathPosition() * 100}%`,
                transition: isScrubbing ? 'none' : 'left 0.1s linear'
              }}
            >
              {/* Add a handle knob at the top for better visibility */}
              <div className="absolute -top-1 left-1/2 w-3 h-3 bg-emerald-500 rounded-full transform -translate-x-1/2"></div>
            </div>
          </div>
        </div>
        
        {/* Playback Speed control */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Playback Speed</span>
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
            className="py-0"
          />
          
          <div className="flex text-xs text-muted-foreground justify-between">
            <span>Slow</span>
            <span>Fast</span>
          </div>
        </div>
        
        {/* Background Noise Volume control */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Background Noise Volume</span>
            <span className="text-xs text-muted-foreground">
              {(backgroundNoiseVolume * 100).toFixed(0)}%
            </span>
          </div>
          
          <Slider
            value={[backgroundNoiseVolume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={handleBackgroundNoiseVolumeChange}
            disabled={disabled}
            className="py-0"
          />
          
          <div className="flex text-xs text-muted-foreground justify-between">
            <span>Silent</span>
            <span>Loud</span>
          </div>
        </div>
        
        {/* Filter Bandwidth (Q) control */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Noise Bandwidth</span>
            <span className="text-xs text-muted-foreground">
              {filterQ.toFixed(1)}
            </span>
          </div>
          
          <Slider
            value={[filterQ]}
            min={0.1}
            max={20}
            step={0.1}
            onValueChange={handleFilterQChange}
            disabled={disabled}
            className="py-0"
          />
          
          <div className="flex text-xs text-muted-foreground justify-between">
            <span>Wide</span>
            <span>Narrow</span>
          </div>
        </div>
      </div>
    </div>
  )
} 