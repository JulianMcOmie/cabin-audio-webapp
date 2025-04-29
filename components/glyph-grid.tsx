"use client"

import { useRef, useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import * as glyphGridAudio from '@/lib/audio/glyphGridAudio'
import { GlyphType } from '@/lib/audio/glyphGridAudio'
import { Label } from "@/components/ui/label"

// Glyph interface for representing a shape that defines a path
interface Glyph {
  id: string;
  type: GlyphType;
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
  const [numberOfTones, setNumberOfTones] = useState(glyphGridAudio.getGlyphGridAudioPlayer().getNumberOfTones());

  // Add hover state tracking for interactive elements
  const [hoverState, setHoverState] = useState<'none' | 'vertex1' | 'vertex2' | 'line'>('none')

  // Add speed slider state
  const [speed, setSpeed] = useState(glyphGridAudio.getGlyphGridAudioPlayer().getSpeed());

  // Add animation frame ref
  const animationFrameRef = useRef<number | null>(null);

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
    // audioPlayer.setModulating(true)
    
    // Set initial number of tones (if needed, though constructor handles default)
    // audioPlayer.setNumberOfTones(numberOfTones);
    
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
  
  // Consolidate playing state and animation loop management
  useEffect(() => {
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer();
    const shouldPlay = isPlaying && !disabled;

    audioPlayer.setPlaying(shouldPlay);

    const drawLoop = () => {
      if (canvasRef.current) {
        // Trigger a re-render by updating a state variable (e.g., glyph, or a dummy one)
        // This forces the drawing useEffect to run again with the latest pathPosition
        setGlyph(prev => ({ ...prev })); 
      }
      animationFrameRef.current = requestAnimationFrame(drawLoop);
    };

    if (shouldPlay) {
      // Start the UI animation loop
      if (animationFrameRef.current === null) {
          animationFrameRef.current = requestAnimationFrame(drawLoop);
      }
    } else {
      // Stop the UI animation loop
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        // Force one last draw call when stopping to clear moving dots if needed
         setGlyph(prev => ({ ...prev })); 
      }
    }

    // Cleanup function for stopping animation on unmount
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, disabled]); // Dependency array
  
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
    
    // Draw the selected glyph shape path
    ctx.strokeStyle = isDarkMode ? '#38bdf8' : '#0284c7'
    ctx.lineWidth = 3
    ctx.beginPath()

    // Define center and radii in canvas pixels
    const centerX = (glyph.position.x + 1) / 2 * rect.width
    const centerY = (1 - glyph.position.y) / 2 * rect.height // Y is inverted
    const radiusX = (glyph.size.width / 2) * rect.width
    const radiusY = (glyph.size.height / 2) * rect.height

    // Get start/end points for line (in canvas pixels)
    const getLinePoints = () => {
      const startX_norm = glyph.position.x - glyph.size.width / 2
      const startY_norm = glyph.position.y - glyph.size.height / 2
      const endX_norm = glyph.position.x + glyph.size.width / 2
      const endY_norm = glyph.position.y + glyph.size.height / 2
      const startX = (startX_norm + 1) / 2 * rect.width
      const startY = (1 - startY_norm) / 2 * rect.height // Y is inverted
      const endX = (endX_norm + 1) / 2 * rect.width
      const endY = (1 - endY_norm) / 2 * rect.height // Y is inverted
      return { startX, startY, endX, endY }
    }

    // Function to get point on path for a given shape and progress (0-1)
    const getPointOnPath = (type: GlyphType, progress: number): { x: number, y: number } => {
      switch (type) {
        case 'line': {
          const { startX, startY, endX, endY } = getLinePoints()
          const x = startX + (endX - startX) * progress
          const y = startY + (endY - startY) * progress
          return { x, y }
        }
        case 'circle': {
          const angle = progress * 2 * Math.PI - Math.PI / 2 // Start from top
          const x = centerX + radiusX * Math.cos(angle)
          const y = centerY + radiusY * Math.sin(angle)
          return { x, y }
        }
        case 'diamond': {
          const segment = Math.floor(progress * 4)
          const segmentProgress = (progress * 4) % 1
          const points = [
            { x: centerX, y: centerY - radiusY }, // Top
            { x: centerX + radiusX, y: centerY }, // Right
            { x: centerX, y: centerY + radiusY }, // Bottom
            { x: centerX - radiusX, y: centerY }, // Left
          ]
          const startPoint = points[segment % 4]
          const endPoint = points[(segment + 1) % 4]
          const x = startPoint.x + (endPoint.x - startPoint.x) * segmentProgress
          const y = startPoint.y + (endPoint.y - startPoint.y) * segmentProgress
          return { x, y }
        }
        case 'triangle': {
          const segment = Math.floor(progress * 3)
          const segmentProgress = (progress * 3) % 1
          const points = [
            { x: centerX, y: centerY - radiusY }, // Top
            { x: centerX + radiusX, y: centerY + radiusY }, // Bottom Right
            { x: centerX - radiusX, y: centerY + radiusY }, // Bottom Left
          ]
          const startPoint = points[segment % 3]
          const endPoint = points[(segment + 1) % 3]
          const x = startPoint.x + (endPoint.x - startPoint.x) * segmentProgress
          const y = startPoint.y + (endPoint.y - startPoint.y) * segmentProgress
          return { x, y }
        }
      }
    }

    // Draw the shape path
    switch (glyph.type) {
      case 'line': {
        const { startX, startY, endX, endY } = getLinePoints()
        // Draw the path line with hover effect if needed (only for line)
        if (hoverState === 'line' && !isDragging && !isResizing) {
          ctx.save() // Save context before changing style
          ctx.strokeStyle = isDarkMode ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.3)'
          ctx.lineWidth = 8
          ctx.beginPath()
          ctx.moveTo(startX, startY)
          ctx.lineTo(endX, endY)
          ctx.stroke()
          ctx.restore() // Restore context
        }
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        break
      }
      case 'circle': {
        // Use ellipse for potentially non-circular shapes based on size
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI)
        break
      }
      case 'diamond': {
        ctx.moveTo(centerX, centerY - radiusY) // Top
        ctx.lineTo(centerX + radiusX, centerY) // Right
        ctx.lineTo(centerX, centerY + radiusY) // Bottom
        ctx.lineTo(centerX - radiusX, centerY) // Left
        ctx.closePath()
        break
      }
      case 'triangle': {
        ctx.moveTo(centerX, centerY - radiusY) // Top
        ctx.lineTo(centerX + radiusX, centerY + radiusY) // Bottom Right
        ctx.lineTo(centerX - radiusX, centerY + radiusY), // Bottom Left
        ctx.closePath()
        break
      }
    }
    ctx.stroke() // Draw the defined path

    // If playing, draw MOVING dots along the path for each tone
    if (isPlaying && !disabled) {
      const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer()
      const currentNumberOfTones = audioPlayer.getNumberOfTones()
      const pathPosition = audioPlayer.getPathPosition(); // Get current position offset
      
      // Function to convert normalized (-1 to 1) coords to canvas coords
      const normToCanvas = (normX: number, normY: number): { x: number, y: number } => {
        return {
          x: (normX + 1) / 2 * rect.width,
          y: (1 - normY) / 2 * rect.height // Y is inverted on canvas
        };
      };

      for (let i = 0; i < currentNumberOfTones; i++) {
        const progress = (i / currentNumberOfTones + pathPosition) % 1.0; // Calculate progress with offset
        // Use the audio player's calculation method to get normalized position
        const normPos = audioPlayer.calculatePositionOnGlyph(glyph, progress);
        // Convert normalized position to canvas coordinates
        const canvasPos = normToCanvas(normPos.x, normPos.y);

        // Draw the dot
        ctx.fillStyle = isDarkMode ? 'rgba(56, 189, 248, 0.8)' : 'rgba(2, 132, 199, 0.8)' // Slightly transparent
        ctx.beginPath()
        ctx.arc(canvasPos.x, canvasPos.y, 6, 0, Math.PI * 2) // Slightly smaller dots
        ctx.fill()
      }
    }

    // Draw resize handles only for line glyph and if not disabled
    if (glyph.type === 'line' && !disabled) {
      const { startX, startY, endX, endY } = getLinePoints()
      const handleRadius = 6
      // Only show bottom-left and top-right corners
      const handles = [
        { x: startX, y: startY, state: 'vertex1' as const }, // Bottom-left
        { x: endX, y: endY, state: 'vertex2' as const },     // Top-right
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
  }, [glyph, isPlaying, disabled, isDarkMode, hoverState, isDragging, isResizing])
  
  // Function to check what's under the cursor
  const checkHoverTarget = (mouseX: number, mouseY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 'none'
    
    const rect = canvas.getBoundingClientRect()
    
    // Only check interactions if it's a line glyph
    if (glyph.type !== 'line') return 'none'

    // --- Line-specific hover checks ---
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
    
    // Skip move/resize if not a line glyph
    if (glyph.type !== 'line') {
      // Still update hover state if not dragging/resizing
      if (!isDragging && !isResizing) {
        const target = checkHoverTarget(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top)
        setHoverState(target)
      }
      return
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

  // Handler for number of tones slider
  const handleNumberOfTonesChange = (values: number[]) => {
    const newCount = values[0];
    setNumberOfTones(newCount);
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer();
    audioPlayer.setNumberOfTones(newCount);
    // Trigger a re-render to update dots if playing
    if (isPlaying) {
       setGlyph(prev => ({ ...prev }));
    }
  };

  // Add a handler for speed slider change
  const handleSpeedChange = (values: number[]) => {
    const newSpeed = values[0];
    setSpeed(newSpeed);
    const audioPlayer = glyphGridAudio.getGlyphGridAudioPlayer();
    audioPlayer.setSpeed(newSpeed);
  }

  // Add a function to format the speed display
  const formatSpeed = (value: number): string => {
    return `${value.toFixed(2)}x`;
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

  return (
    <div className="space-y-3">
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
      <div className="space-y-4">
        {/* Number of Tones Control */}
        <div className="space-y-2"> {/* Increased spacing */}
          <div className="flex items-center justify-between">
            <Label htmlFor="num-tones-slider" className="text-xs font-medium">Number of Tones</Label>
            <span className="text-xs font-medium text-muted-foreground w-8 text-right">{numberOfTones}</span>
          </div>
          <Slider
            id="num-tones-slider"
            value={[numberOfTones]}
            min={1}
            max={30} // Keep max reasonable for performance
            step={1}
            onValueChange={handleNumberOfTonesChange}
            disabled={disabled}
            className="py-0 h-auto"
          />
        </div>

        {/* Playback Speed control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
              <Label htmlFor="speed-slider" className="text-xs font-medium">Playback Speed</Label>
              <span className="text-xs font-medium text-muted-foreground w-12 text-right">{formatSpeed(speed)}</span>
          </div>
          <Slider
              id="speed-slider"
              value={[speed]}
              min={0.05}
              max={4.0} // Adjust max speed if needed
              step={0.05}
              onValueChange={handleSpeedChange}
              disabled={disabled}
              className="py-0 h-auto"
          />
        </div>

        {/* Shape Selection Buttons */}
        <div className="space-y-1">
          <h4 className="text-xs font-medium">Shape</h4>
          <div className="flex space-x-2">
            {(['line', 'circle', 'diamond', 'triangle'] as GlyphType[]).map((shapeType) => (
              <Button
                key={shapeType}
                variant={glyph.type === shapeType ? "default" : "outline"}
                size="sm"
                onClick={() => setGlyph(prev => ({ ...prev, type: shapeType }))}
                disabled={disabled}
                className="capitalize text-xs h-7 px-2.5"
              >
                {shapeType}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
} 