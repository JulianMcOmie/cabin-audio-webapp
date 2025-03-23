"use client"

import { useRef, useEffect, useState, useCallback } from "react"
// import { useTheme } from "@/components/theme-provider"
import { EQBandWithUI } from "./types"
import { EQBandRenderer } from "./EQBandRenderer"
import { EQCurveRenderer } from "./EQCurveRenderer"
import { EQCoordinateUtils } from "./EQCoordinateUtils"
import { useEQInteraction } from "./useEQInteraction"
import { useEQProcessor, calculateBandResponse } from "./useEQProcessor"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQBand } from "@/lib/models/EQBand"
import { throttle } from 'lodash';

interface FrequencyEQProps {
  profileId?: string
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
}

// Cache for pending updates to avoid redundant processing
interface PendingUpdates {
  bands: Record<string, {
    frequency?: number;
    gain?: number;
    q?: number;
    type?: BiquadFilterType;
  }>;
  volume?: number;
  lastBatchTime: number;
}

let pendingUpdates: PendingUpdates = {
  bands: {},
  lastBatchTime: 0
};

// Define a type for the audio processor
interface AudioProcessor {
  setVolume: (volume: number) => void;
  setBandFrequency: (bandId: string, frequency: number) => void;
  setBandGain: (bandId: string, gain: number) => void;
  setBandQ: (bandId: string, q: number) => void;
  setBandType: (bandId: string, type: BiquadFilterType) => void;
}

// Direct audio update function without throttling
export function updateAudio(
  audioProcessor: AudioProcessor,
  paramType: 'frequency' | 'gain' | 'q' | 'type' | 'volume',
  bandId: string | null, 
  value: number | BiquadFilterType
) {
  if (paramType === 'volume') {
    audioProcessor.setVolume(value as number);
  } else if (bandId) {
    // Update the appropriate parameter directly
    if (paramType === 'frequency') {
      audioProcessor.setBandFrequency(bandId, value as number);
    } else if (paramType === 'gain') {
      audioProcessor.setBandGain(bandId, value as number);
    } else if (paramType === 'q') {
      audioProcessor.setBandQ(bandId, value as number);
    } else if (paramType === 'type') {
      audioProcessor.setBandType(bandId, value as BiquadFilterType);
    }
  }
}

export function FrequencyEQ({ profileId, disabled = false, className, onInstructionChange, onRequestEnable }: FrequencyEQProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  // Add refs for animation frame and canvas context
  const animationFrameRef = useRef<number | null>(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const backgroundContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const backgroundDrawnRef = useRef<boolean>(false)
  
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null)
  
  // Volume control state
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const [isHoveringVolume, setIsHoveringVolume] = useState(false)
  
  // Connect to EQ profile store
  const { 
    getProfileById, 
    getActiveProfile, 
    updateProfile,
  } = useEQProfileStore()
  
  // Get current profile
  const profile = profileId 
    ? getProfileById(profileId) 
    : getActiveProfile()
  
  // Prepare bands for rendering by adding UI properties
  const [renderableBands, setRenderableBands] = useState<EQBandWithUI[]>([])
  
  // Update renderable bands when profile changes
  useEffect(() => {
    if (!profile) {
      setRenderableBands([])
      return
    }
    
    // Ensure profile bands have IDs and add UI properties
    // Calculate exact frequency response using the Web Audio API's getFrequencyResponse method
    const updatedBands: EQBandWithUI[] = profile.bands.map(band => ({
      ...band,
      isHovered: band.id === hoveredBandId,
      type: 'peaking' as BiquadFilterType, // Default type for all bands
      frequencyResponse: calculateBandResponse({
        ...band,
        isHovered: band.id === hoveredBandId,
        type: 'peaking' as BiquadFilterType,
      })
    }))
    
    setRenderableBands(updatedBands)
  }, [profile])
  
  // Fixed frequency range
  const freqRange = { min: 20, max: 20000 }
  
  // Process EQ bands to get frequency response
  const { frequencyResponse } = useEQProcessor(renderableBands)
  
  // Handle band operations
  const handleBandAdd = useCallback((band: Omit<EQBandWithUI, 'id' | 'isHovered' | 'frequencyResponse'>) => {
    if (!profile) return
    
    // Create a new band and add to profile
    const newProfileBand: EQBand = {
      id: `band-${Date.now()}`, // Generate a unique ID
      frequency: band.frequency,
      gain: band.gain,
      q: band.q,
      type: band.type || 'peaking' // Include type in the profile band
    }
    
    // Check if this is the first band - if so, request to enable the EQ
    if (profile.bands.length === 0 && onRequestEnable && disabled) {
      onRequestEnable();
    }
    
    // Add band to profile immediately
    updateProfile(profile.id, {
      bands: [...profile.bands, newProfileBand]
    })
    
    // Return the new band ID so it can be selected for dragging
    return newProfileBand.id
  }, [profile, updateProfile, onRequestEnable, disabled])
  
  const handleBandUpdate = useCallback((id: string, updates: Partial<EQBandWithUI>) => {
    if (!profile) return

    // Find the band in the profile
    const bandIndex = profile.bands.findIndex(b => b.id === id)
    if (bandIndex === -1) return

    console.log("updates", updates)

    // Create updated profile bands
    const updatedBands = [...profile.bands]
    updatedBands[bandIndex] = { 
      ...updatedBands[bandIndex],
      ...(updates.frequency !== undefined ? { frequency: updates.frequency } : {}),
      ...(updates.gain !== undefined ? { gain: updates.gain } : {}),
      ...(updates.q !== undefined ? { q: updates.q } : {}),
      ...(updates.type !== undefined ? { type: updates.type } : {})
    }
    
    // Update profile with the new bands
    updateProfile(profile.id, { bands: updatedBands })
    
    // Also update renderable bands for responsive UI
    setRenderableBands(prev => {
      const newBands = [...prev]
      const index = newBands.findIndex(b => b.id === id)
      if (index !== -1) {
        newBands[index] = { ...newBands[index], ...updates }
        
        // Recalculate frequency response if needed
        if (updates.frequency !== undefined || updates.gain !== undefined || updates.q !== undefined || updates.type !== undefined) {
          newBands[index].frequencyResponse = calculateBandResponse(newBands[index])
        }
      }
      return newBands
    })
  }, [profile, updateProfile])
  
  const handleBandRemove = useCallback((id: string) => {
    if (!profile) return
    
    // Find and remove the band from profile
    const updatedBands = profile.bands.filter(band => band.id !== id)
    updateProfile(profile.id, { bands: updatedBands })
  }, [profile, updateProfile])
  
  // Set up EQ interaction
  const { 
    handleMouseMove: handleBandMouseMove, 
    handleMouseDown: handleBandMouseDown, 
    isShiftPressed,
    ghostNode,
    draggingBand: draggingBandId,
    hoveredBandId
  } = useEQInteraction({
    canvasRef,
    bands: renderableBands,
    freqRange,
    onBandAdd: handleBandAdd,
    onBandUpdate: handleBandUpdate,
    onBandRemove: handleBandRemove,
    onBandSelect: setSelectedBandId,
  })
  
  // Custom mouse handlers to support volume control
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!profile || isDraggingVolume) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if we're hovering over the volume control
    const isOverVolume = EQBandRenderer.isInVolumeControl(
      x, y, rect.width, rect.height, profile.volume || 0
    );
    
    setIsHoveringVolume(isOverVolume);
    
    // Only pass mouse move to band interaction if not hovering over volume
    if (!isOverVolume) {
      handleBandMouseMove(e);
    }
  }, [profile, handleBandMouseMove, isDraggingVolume]);
  
  // Handle mouse down for volume control
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!profile) {
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if we're clicking on the volume control
    const isOverVolume = EQBandRenderer.isInVolumeControl(
      x, y, rect.width, rect.height, profile.volume || 0
    );
    
    if (isOverVolume) {
      setIsDraggingVolume(true);
      
      // Initial volume adjustment based on click position
      const newVolume = EQCoordinateUtils.yToGain(y, rect.height);
      updateProfile(profile.id, { volume: newVolume });
      
      // Add event listeners for mouse move and mouse up
      const handleDocumentMouseMove = (e: MouseEvent) => {
        if (!canvas || !profile) return;
        
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const newVolume = EQCoordinateUtils.yToGain(y, rect.height);
        
        // Update profile volume
        updateProfile(profile.id, { volume: newVolume });
      };
      
      const handleDocumentMouseUp = () => {
        setIsDraggingVolume(false);
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
      };
      
      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);
      
      return;
    }
    
    // If not clicking on volume control, delegate to the band mouse handler
    handleBandMouseDown(e);
  }, [disabled, handleBandMouseDown, profile, updateProfile]);
  
  // Update instruction text based on interaction state
  useEffect(() => {
    if (!onInstructionChange) return;
    
    if (isDraggingVolume) {
      onInstructionChange("Drag up/down to adjust volume");
    } else if (isHoveringVolume) {
      onInstructionChange("Click and drag to adjust volume");
    } else if (draggingBandId) {
      // Always show the shift+drag instruction for better discoverability, 
      // even when not currently pressing shift
      onInstructionChange("Shift + drag to change bandwidth (Q)");
    } else if (hoveredBandId) {
      onInstructionChange("Right click to delete band");
    } else {
      onInstructionChange("Click + drag on the center line to add a band");
    }
  }, [draggingBandId, hoveredBandId, isDraggingVolume, isHoveringVolume, isShiftPressed, onInstructionChange]);

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
          // When theme changes, we need to redraw the background
          backgroundDrawnRef.current = false;
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => {
      observer.disconnect()
    }
  }, [])

  // Draw static background elements
  const renderBackgroundCanvas = useCallback(() => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) return;

    // Get or create context
    let ctx = backgroundContextRef.current;
    if (!ctx) {
      ctx = canvas.getContext("2d");
      if (!ctx) return;
      backgroundContextRef.current = ctx;
    }

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect();

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Add semi-transparent background with reduced opacity
    ctx.fillStyle = isDarkMode ? "rgba(24, 24, 36, 0.4)" : "rgba(255, 255, 255, 0.4)";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw background grid
    ctx.strokeStyle = isDarkMode ? "#3f3f5c" : "#e2e8f0"; // Darker grid lines for dark mode
    ctx.lineWidth = 1;

    // Vertical grid lines (frequency bands)
    const numBands = 10;
    for (let i = 0; i <= numBands; i++) {
      const x = (i / numBands) * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }

    // Horizontal grid lines (dB levels)
    const levels = 6;
    for (let i = 0; i <= levels; i++) {
      const y = (i / levels) * rect.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }

    // Draw frequency labels
    ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b"; // Brighter text for dark mode
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";

    const freqLabels = ["20Hz", "50Hz", "100Hz", "200Hz", "500Hz", "1kHz", "2kHz", "5kHz", "10kHz", "20kHz"];
    for (let i = 0; i < freqLabels.length; i++) {
      const x = ((i + 0.5) / numBands) * rect.width;
      ctx.fillText(freqLabels[i], x, rect.height - 5);
    }

    // Draw dB labels
    ctx.textAlign = "right";
    const dbLabels = ["+12dB", "+6dB", "0dB", "-6dB", "-12dB", "-18dB"];
    for (let i = 0; i < dbLabels.length; i++) {
      const y = (i / (levels - 1)) * (rect.height - 30) + 15;
      ctx.fillText(dbLabels[i], rect.width - 10, y);
    }

    // Mark background as drawn
    backgroundDrawnRef.current = true;
  }, [isDarkMode]);

  // Main canvas rendering function to be called by requestAnimationFrame
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get or create context
    let ctx = canvasContextRef.current;
    if (!ctx) {
      ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvasContextRef.current = ctx;
    }

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect();

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Check if background needs to be drawn
    if (!backgroundDrawnRef.current) {
      renderBackgroundCanvas();
    }

    // Set isEnabled based on disabled prop
    const isEnabled = !disabled;

    // Draw individual band responses
    renderableBands.forEach((band) => {
      // Consider a band "hovered" if it's the selected band, if it's being dragged,
      // or if it's already marked as hovered
      const isHovered = band.id === hoveredBandId || band.id === draggingBandId;
      const isDragging = band.id === draggingBandId;
      
      EQBandRenderer.drawBand(
        ctx,
        band,
        rect.width,
        rect.height,
        freqRange,
        isDarkMode,
        isHovered,
        isDragging,
        isEnabled
      );
      
      // Draw Q indicator if shift is pressed and band is selected, hovered, or being dragged
      if (isShiftPressed && (band.id === selectedBandId || band.isHovered || band.id === draggingBandId)) {
        EQBandRenderer.drawQIndicator(
          ctx,
          band,
          rect.width,
          rect.height,
          freqRange,
          isDarkMode,
          isEnabled
        );
      }
    });

    // Draw the combined EQ curve
    if (frequencyResponse.length > 0) {
      EQCurveRenderer.drawFrequencyResponse(
        ctx,
        frequencyResponse,
        rect.width,
        rect.height,
        freqRange,
        isDarkMode,
        3, // lineWidth
        0.8, // alpha
        isEnabled // Pass isEnabled parameter
      );
    }
    
    // Draw ghost node if visible, not disabled, and not hovering over volume
    if (ghostNode.visible && !disabled && !isHoveringVolume && !isDraggingVolume) {
      // Calculate color based on location (frequency)
      const ghostFreq = EQCoordinateUtils.xToFreq(ghostNode.x, rect.width, freqRange);
      const ghostColor = EQCoordinateUtils.getBandColor(ghostFreq, 1.0, isDarkMode);
      
      // Draw ghost node handle
      EQBandRenderer.drawBandHandle(
        ctx,
        ghostNode.x,
        ghostNode.y,
        ghostColor,
        true,
        false,
        isEnabled
      );
    }
    
    // Draw volume control if we have a profile
    if (profile) {
      EQBandRenderer.drawVolumeControl(
        ctx,
        profile.volume || 0,
        rect.width,
        rect.height,
        isDarkMode,
        isEnabled,
        isDraggingVolume,
        isHoveringVolume
      );
    }

    // Continue the animation loop
    animationFrameRef.current = requestAnimationFrame(renderCanvas);
  }, [
    renderableBands, 
    frequencyResponse, 
    disabled, 
    isDarkMode, 
    selectedBandId, 
    isShiftPressed, 
    ghostNode, 
    draggingBandId, 
    hoveredBandId, 
    profile, 
    isDraggingVolume,
    isHoveringVolume,
    freqRange,
    renderBackgroundCanvas
  ]);

  // Initialize canvases and start animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    if (!canvas || !backgroundCanvas) return;

    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    backgroundCanvas.width = rect.width * dpr;
    backgroundCanvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext("2d");
    const bgCtx = backgroundCanvas.getContext("2d");
    
    if (!ctx || !bgCtx) return;
    
    ctx.scale(dpr, dpr);
    bgCtx.scale(dpr, dpr);
    
    canvasContextRef.current = ctx;
    backgroundContextRef.current = bgCtx;
    
    // Mark background as needing to be redrawn
    backgroundDrawnRef.current = false;
    
    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(renderCanvas);
    
    // Clean up animation frame on unmount
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderCanvas]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const backgroundCanvas = backgroundCanvasRef.current;
      if (!canvas || !backgroundCanvas) return;
      
      // Update canvas dimensions
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      backgroundCanvas.width = rect.width * dpr;
      backgroundCanvas.height = rect.height * dpr;
      
      // Reset context scale
      const ctx = canvas.getContext("2d");
      const bgCtx = backgroundCanvas.getContext("2d");
      
      if (ctx && bgCtx) {
        ctx.scale(dpr, dpr);
        bgCtx.scale(dpr, dpr);
        
        canvasContextRef.current = ctx;
        backgroundContextRef.current = bgCtx;
        
        // Mark background as needing to be redrawn
        backgroundDrawnRef.current = false;
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
} 