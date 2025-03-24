"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { EQPoint, GhostPoint } from './types'
import { CoordinateUtils } from './CoordinateUtils'
import { CurveRenderer } from './CurveRenderer'
import { useSineProfileStore } from '@/lib/stores/sineProfileStore'
import { createFrequencyResponseFunction } from '@/lib/audio/sineFrequencyResponse'

interface SineEQProps {
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
  profileId?: string
}

export function SineEQ({ 
  disabled = false, 
  className, 
  onInstructionChange,
  onRequestEnable,
  profileId
}: SineEQProps) {
  // Canvas and context refs
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const backgroundContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  
  // Use the sine profile store
  const { 
    getActiveProfile, 
    getProfileById, 
    updateProfile, 
    setSineEQEnabled, 
    isSineEQEnabled 
  } = useSineProfileStore()
  
  // Fixed frequency and amplitude ranges
  const freqRange = { min: 20, max: 20000 }
  const ampRange = { min: -24, max: 24 }
  
  // Canvas margin - removed completely
  const margin = 0
  
  // Theme tracking
  const [isDarkMode, setIsDarkMode] = useState(false)
  const backgroundDrawnRef = useRef<boolean>(false)
  
  // Volume control state
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const [isHoveringVolume, setIsHoveringVolume] = useState(false)
  
  // Reference node (1kHz, 0dB) - can't be moved
  const referenceNode: EQPoint = { frequency: 1000, amplitude: 0 }
  
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
  
  // Sync with profile store
  useEffect(() => {
    // Get the appropriate profile
    const profile = profileId 
      ? getProfileById(profileId) 
      : getActiveProfile()
    
    // Load points from profile
    if (profile) {
      // Ensure we always have a valid array, even if profile.points is null/undefined
      const profilePoints = Array.isArray(profile.points) ? profile.points : [];
      setPoints(profilePoints);
      
      // Debug to verify points are loaded correctly
      console.log(`Loaded ${profilePoints.length} points from profile ${profile.id}`);
    } else {
      setPoints([]);
    }
  }, [profileId, getProfileById, getActiveProfile])
  
  // Save points to profile when they change
  useEffect(() => {
    // Skip during active drag operations to avoid excessive updates
    if (isDraggingRef.current) {
      return;
    }
    
    // Use a timeout to ensure we're not doing too many rapid updates
    const saveTimeout = setTimeout(() => {
      // Get the appropriate profile
      const profile = profileId 
        ? getProfileById(profileId) 
        : getActiveProfile()
      
      // Save points to profile
      if (profile) {
        // Check if points actually changed by comparing contents
        const pointsChanged = 
          !profile.points || 
          points.length !== profile.points.length ||
          JSON.stringify(points) !== JSON.stringify(profile.points);
          
        if (pointsChanged) {
          console.log(`Saving ${points.length} points to profile ${profile.id}`);
          updateProfile(profile.id, { points });
        }
      }
    }, 50); // Small delay to batch rapid changes
    
    return () => clearTimeout(saveTimeout);
  }, [points, profileId, getProfileById, getActiveProfile, updateProfile]);
  
  // Update the disabled state based on the profile store
  useEffect(() => {
    // Only sync if the disabled prop wasn't explicitly set
    if (disabled === undefined) {
      setSineEQEnabled(!isSineEQEnabled)
      onRequestEnable?.()
    }
  }, [isSineEQEnabled, disabled, onRequestEnable, setSineEQEnabled])
  
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
  
  // Draw background (just a solid black/near-black color)
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

    // Add near-black background - MUCH darker now
    ctx.fillStyle = isDarkMode ? "rgba(0, 0, 0, 1.0)" : "rgba(1, 1, 3, 0.98)"
    ctx.fillRect(0, 0, rect.width, rect.height)

    // Mark background as drawn
    backgroundDrawnRef.current = true
  }, [isDarkMode])
  
  // Get actual disabled state either from props or from store
  const actualDisabled = disabled !== undefined ? disabled : !isSineEQEnabled

  // Draw volume control
  const drawVolumeControl = useCallback((ctx: CanvasRenderingContext2D, volume: number, width: number, height: number, isDarkMode: boolean, isEnabled: boolean, isDragging: boolean, isHovered: boolean, marginX: number, marginY: number) => {
    const handleSize = 12;
    const handleY = marginY + CoordinateUtils.amplitudeToY(volume, height, ampRange);
    const handleX = width + marginX - handleSize;
    
    // Draw handle background
    ctx.fillStyle = isDarkMode 
      ? (isHovered ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.1)")
      : (isHovered ? "rgba(0, 0, 0, 0.1)" : "rgba(0, 0, 0, 0.05)");
    ctx.fillRect(handleX, handleY - handleSize/2, handleSize, handleSize);
    
    // Draw handle border
    ctx.strokeStyle = isDarkMode 
      ? (isHovered ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.3)")
      : (isHovered ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.2)");
    ctx.lineWidth = 1;
    ctx.strokeRect(handleX, handleY - handleSize/2, handleSize, handleSize);
    
    // Draw handle line
    ctx.beginPath();
    ctx.moveTo(handleX + handleSize/2, handleY - handleSize/2);
    ctx.lineTo(handleX + handleSize/2, handleY + handleSize/2);
    ctx.strokeStyle = isDarkMode 
      ? (isEnabled ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.3)")
      : (isEnabled ? "rgba(0, 0, 0, 0.8)" : "rgba(0, 0, 0, 0.3)");
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [ampRange]);

  // Helper function to check if a point is in the volume control
  const isInVolumeControl = useCallback((x: number, y: number, width: number, height: number, volume: number, marginX: number, marginY: number): boolean => {
    const handleSize = 12;
    const handleY = marginY + CoordinateUtils.amplitudeToY(volume, height, ampRange);
    const handleX = width + marginX - handleSize;
    
    return x >= handleX && x <= handleX + handleSize &&
           y >= handleY - handleSize/2 && y <= handleY + handleSize/2;
  }, [ampRange]);

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
    
    // Create all points array including the reference node
    const allPoints = [referenceNode, ...points]
    
    // Draw the curve
    CurveRenderer.drawCurve(
      ctx,
      allPoints,
      innerWidth,
      innerHeight,
      freqRange,
      ampRange,
      isDarkMode,
      4,  // Line width 
      1.0, // Alpha
      margin,
      margin,
      disabled // Pass disabled state
    )
    
    // Draw the user control points
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
      margin,
      isDraggingRef.current, // Pass dragging state
      disabled // Pass disabled state
    )
    
    // Draw the reference node (special rendering)
    CurveRenderer.drawReferencePoint(
      ctx,
      referenceNode,
      innerWidth,
      innerHeight,
      freqRange,
      ampRange,
      isDarkMode,
      margin,
      margin,
      disabled // Pass disabled state
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
        0,
        disabled // Pass disabled state
      )
    }

    // Draw volume control if we have a profile
    const profile = profileId ? getProfileById(profileId) : getActiveProfile()
    if (profile) {
      drawVolumeControl(
        ctx,
        profile.volume || 0,
        rect.width - margin * 2,
        rect.height - margin * 2,
        isDarkMode,
        !disabled,
        isDraggingRef.current,
        false,
        margin,
        margin
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
    renderBackgroundCanvas,
    referenceNode,
    disabled,
    drawVolumeControl,
    profileId,
    getProfileById,
    getActiveProfile
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
  
  // Handler for mouse movement
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Get mouse coordinates
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Get the current profile
    const profile = profileId ? getProfileById(profileId) : getActiveProfile();
    if (!profile) return;
    
    // Check if we're in the inner canvas area
    const isInnerArea = x >= margin && x <= rect.width - margin && 
                      y >= margin && y <= rect.height - margin;
    
    // Check if we're hovering over the volume control
    const isOverVolume = isInVolumeControl(
      x, y, rect.width - margin * 2, rect.height - margin * 2,
      profile.volume || 0, margin, margin
    );
    
    setIsHoveringVolume(isOverVolume);
    
    // If we're dragging volume, handle that
    if (isDraggingVolume) {
      // Calculate new volume based on y position
      const innerY = Math.max(0, Math.min(rect.height - margin * 2, y - margin));
      const newVolume = CoordinateUtils.yToAmplitude(innerY, rect.height - margin * 2, ampRange);
      
      // Update profile volume
      updateProfile(profile.id, { volume: newVolume });
      return;
    }
    
    // If we're not dragging volume, handle point interactions
    if (isDraggingRef.current && selectedPointIndex !== null && isInnerArea) {
      // Calculate the new frequency and amplitude
      const innerX = x - margin;
      const innerY = y - margin;
      const innerWidth = rect.width - margin * 2;
      const innerHeight = rect.height - margin * 2;
      
      const newFrequency = CoordinateUtils.xToFreq(innerX, innerWidth, freqRange);
      const newAmplitude = CoordinateUtils.yToAmplitude(innerY, innerHeight, ampRange);
      
      // Update the point
      const newPoints = [...points];
      newPoints[selectedPointIndex] = {
        frequency: newFrequency,
        amplitude: newAmplitude
      };
      setPoints(newPoints);
      
      // Update cursor
      document.body.style.cursor = 'grabbing';
      
      return;
    }
    
    // If we're not dragging, check if we're hovering over a point
    if (isInnerArea) {
      const nearestPointIndex = findNearestPoint(x, y);
      
      if (nearestPointIndex !== null) {
        // We're hovering over a point
        setSelectedPointIndex(nearestPointIndex);
        setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 });
        document.body.style.cursor = 'grab';
        
        if (onInstructionChange) {
          onInstructionChange('Click and drag to move the point');
        }
      } else {
        // We're not hovering over a point, show ghost point
        const innerX = x - margin;
        const innerY = y - margin;
        const innerWidth = rect.width - margin * 2;
        const innerHeight = rect.height - margin * 2;
        
        const frequency = CoordinateUtils.xToFreq(innerX, innerWidth, freqRange);
        
        // Create frequency response function using all points including reference
        const responseFunction = createFrequencyResponseFunction(points, referenceNode);
        
        // Get the amplitude at this frequency
        const amplitude = responseFunction(frequency);
        
        // Now calculate the y position for this amplitude
        const curveY = margin + CoordinateUtils.amplitudeToY(amplitude, innerHeight, ampRange);
        
        // Only show ghost if close to the curve
        const distanceToCurve = Math.abs(y - curveY);
        
        if (distanceToCurve < 20) {
          setGhostPoint({
            visible: true,
            x: x,
            y: curveY,
            frequency,
            amplitude
          });
          document.body.style.cursor = 'crosshair';
          
          if (onInstructionChange) {
            onInstructionChange('Click to add a new control point');
          }
        } else {
          setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 });
          document.body.style.cursor = 'default';
          
          if (onInstructionChange) {
            onInstructionChange('Move cursor near the curve to add points');
          }
        }
        
        setSelectedPointIndex(null);
      }
    } else {
      // Outside inner area
      setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 });
      setSelectedPointIndex(null);
      document.body.style.cursor = 'default';
    }
  }, [
    disabled, 
    selectedPointIndex, 
    points, 
    freqRange, 
    ampRange, 
    onInstructionChange,
    isDraggingVolume,
    profileId,
    getProfileById,
    getActiveProfile,
    updateProfile,
    isInVolumeControl,
    referenceNode
  ]);

  // Handler for mouse down
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) {
      // If disabled, ask to enable
      if (onRequestEnable) {
        setSineEQEnabled(true);
        onRequestEnable();
      }
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Get mouse coordinates
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Get the current profile
    const profile = profileId ? getProfileById(profileId) : getActiveProfile();
    if (!profile) return;
    
    // Check if we're clicking on the volume control
    const isOverVolume = isInVolumeControl(
      x, y, rect.width - margin * 2, rect.height - margin * 2,
      profile.volume || 0, margin, margin
    );
    
    if (isOverVolume) {
      setIsDraggingVolume(true);
      document.body.style.cursor = 'grabbing';
      
      // Handle document mouse move to support dragging outside canvas bounds
      const handleDocumentMouseMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        
        // Calculate position within the inner area
        const innerY = Math.max(margin, Math.min(rect.height - margin, y)) - margin;
        
        // Calculate new volume using CoordinateUtils
        const newVolume = CoordinateUtils.yToAmplitude(innerY, rect.height - margin * 2, ampRange);
        
        // Update profile volume
        updateProfile(profile.id, { volume: newVolume });
      };
      
      const handleDocumentMouseUp = () => {
        setIsDraggingVolume(false);
        document.body.style.cursor = '';
        
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
      };
      
      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);
      
      return;
    }
    
    // Check if right click (for deleting points)
    if (e.button === 2) {
      e.preventDefault();
      
      // Check if we're clicking on a point
      const nearestPointIndex = findNearestPoint(x, y);
      
      if (nearestPointIndex !== null) {
        // Delete the point
        const newPoints = [...points];
        newPoints.splice(nearestPointIndex, 1);
        setPoints(newPoints);
        setSelectedPointIndex(null);
      }
      
      return;
    }
    
    // Left click - handle point creation or dragging
    if (selectedPointIndex !== null) {
      // Start dragging the selected point
      isDraggingRef.current = true;
      document.body.style.cursor = 'grabbing';
    } else if (ghostPoint.visible) {
      // Create a new point
      const newPoint: EQPoint = {
        frequency: ghostPoint.frequency,
        amplitude: ghostPoint.amplitude
      };
      
      // Create updated points array with the new point
      const newPoints = [...points, newPoint];
      
      // Update state
      setPoints(newPoints);
      
      // Select and start dragging the new point
      setSelectedPointIndex(newPoints.length - 1);
      isDraggingRef.current = true;
      
      // Hide the ghost point immediately
      setGhostPoint({ visible: false, x: 0, y: 0, frequency: 0, amplitude: 0 });
      
      document.body.style.cursor = 'grabbing';
      
      // Immediately save the new point to the profile
      if (profile) {
        // Use newPoints here instead of points to ensure we save the latest state
        updateProfile(profile.id, { points: newPoints });
      }
    }
    
    // Add document event listeners for dragging outside canvas
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Check if we're in the inner canvas area
      const isInnerArea = x >= margin && x <= rect.width - margin && 
                        y >= margin && y <= rect.height - margin;
      
      if (isDraggingRef.current && selectedPointIndex !== null) {
        // Calculate new position, but clamp to inner area
        const innerX = Math.max(0, Math.min(rect.width - margin * 2, x - margin));
        const innerY = Math.max(0, Math.min(rect.height - margin * 2, y - margin));
        const innerWidth = rect.width - margin * 2;
        const innerHeight = rect.height - margin * 2;
        
        const newFrequency = CoordinateUtils.xToFreq(innerX, innerWidth, freqRange);
        const newAmplitude = CoordinateUtils.yToAmplitude(innerY, innerHeight, ampRange);
        
        // Update the point
        const newPoints = [...points];
        newPoints[selectedPointIndex] = {
          frequency: newFrequency,
          amplitude: newAmplitude
        };
        setPoints(newPoints);
      }
    };
    
    const handleDocumentMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      
      // When we release, save the points to the profile
      if (profile) {
        // Important: Need to access the current points state here
        // Use a function to get the latest points from the updater
        setPoints(currentPoints => {
          // Save the latest points
          if (profile) {
            updateProfile(profile.id, { points: currentPoints });
          }
          // Return unchanged
          return currentPoints;
        });
      }
      
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
    
    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);
  }, [
    disabled, 
    selectedPointIndex, 
    ghostPoint, 
    points, 
    freqRange, 
    ampRange, 
    onRequestEnable, 
    profileId, 
    getProfileById, 
    getActiveProfile, 
    updateProfile,
    setSineEQEnabled,
    isInVolumeControl
  ]);
  
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
      className={`w-full aspect-[2/1] frequency-graph rounded-lg border dark:border-gray-700 overflow-hidden ${actualDisabled ? 'opacity-70' : 'opacity-100'} ${className || ""} relative`}
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