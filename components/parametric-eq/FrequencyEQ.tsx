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
  
  // Use EQ interaction
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
    const margin = (canvas as any).margin || 30;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if within the inner EQ area
    const isWithinInnerArea = 
      x >= margin && x <= rect.width - margin &&
      y >= margin && y <= rect.height - margin;
    
    // Calculate inner dimensions
    const innerWidth = rect.width - margin * 2;
    const innerHeight = rect.height - margin * 2;
    
    // Check if we're hovering over the volume control using raw coordinates
    const isOverVolume = EQBandRenderer.isInVolumeControl(
      x, y, innerWidth, innerHeight, profile.volume || 0, margin, margin
    );
    
    setIsHoveringVolume(isOverVolume);
    
    // Only pass mouse move to band interaction if not hovering over volume and within inner area
    if (!isOverVolume && isWithinInnerArea) {
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
    const margin = (canvas as any).margin || 30;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if within the inner EQ area
    const isWithinInnerArea = 
      x >= margin && x <= rect.width - margin &&
      y >= margin && y <= rect.height - margin;
    
    // Calculate inner dimensions
    const innerWidth = rect.width - margin * 2;
    const innerHeight = rect.height - margin * 2;
    
    // Check if we're clicking on the volume control
    const isOverVolume = EQBandRenderer.isInVolumeControl(
      x, y, innerWidth, innerHeight, profile.volume || 0, margin, margin
    );
    
    if (isOverVolume) {
      setIsDraggingVolume(true);
      
      // Initial volume adjustment based on click position
      const innerY = y - margin;
      const newVolume = EQCoordinateUtils.yToGain(innerY, innerHeight);
      updateProfile(profile.id, { volume: newVolume });
      
      // Add event listeners for mouse move and mouse up
      const handleDocumentMouseMove = (e: MouseEvent) => {
        if (!canvas || !profile) return;
        
        const rect = canvas.getBoundingClientRect();
        const margin = (canvas as any).margin || 30;
        const y = e.clientY - rect.top;
        
        // Calculate position within the inner area
        const innerY = Math.max(margin, Math.min(rect.height - margin, y)) - margin;
        const innerHeight = rect.height - margin * 2;
        
        const newVolume = EQCoordinateUtils.yToGain(innerY, innerHeight);
        
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
    
    // If not clicking on volume control and within inner area, delegate to the band mouse handler
    if (isWithinInnerArea) {
      handleBandMouseDown(e);
    }
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

    // Define equal margins for all sides
    const margin = 30; // Equal margin on all sides
    
    // Store margins in a ref to access in other functions
    if (!canvasRef.current) return;
    (canvasRef.current as any).margin = margin;

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Add semi-transparent background with even darker opacity
    ctx.fillStyle = isDarkMode ? "rgba(5, 5, 8, 0.95)" : "rgba(230, 230, 230, 0.7)";
    ctx.fillRect(0, 0, rect.width, rect.height);
    
    // Draw a subtle border around the content area
    ctx.strokeStyle = isDarkMode ? "rgba(80, 80, 100, 0.3)" : "rgba(200, 200, 200, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin, margin, rect.width - margin * 2, rect.height - margin * 2);

    // Draw background grid (more faint)
    ctx.strokeStyle = isDarkMode ? "rgba(63, 63, 92, 0.4)" : "rgba(226, 232, 240, 0.5)";
    ctx.lineWidth = 1;

    // Define frequency points for logarithmic grid (in Hz)
    // Calculate logarithmically spaced frequency points
    // We want 9 lines between each decade (10x factor)
    const freqPoints: number[] = [];
    const decades = [
      [20, 200], // First decade: 20Hz to 200Hz
      [200, 2000], // Second decade: 200Hz to 2kHz
      [2000, 20000], // Third decade: 2kHz to 20kHz
    ];
    
    // Generate 9 points between each decade boundary (plus the boundary itself)
    decades.forEach(([startFreq, endFreq]) => {
      const startLog = Math.log10(startFreq);
      const endLog = Math.log10(endFreq);
      const step = (endLog - startLog) / 10;
      
      // Add points for this decade
      for (let i = 0; i < 10; i++) {
        const logFreq = startLog + i * step;
        const freq = Math.pow(10, logFreq);
        freqPoints.push(Math.round(freq));
      }
    });
    
    // Add the final point (20kHz)
    freqPoints.push(20000);
    
    // Vertical grid lines (logarithmic frequency bands)
    for (let freq of freqPoints) {
      const x = margin + EQCoordinateUtils.freqToX(freq, rect.width - margin * 2, freqRange);
      ctx.beginPath();
      ctx.moveTo(x, margin);
      ctx.lineTo(x, rect.height - margin);
      ctx.stroke();
    }

    // Define dB points for grid (matching actual EQ range, with more values, extending to +24dB)
    const dbPoints = [24, 20, 16, 12, 8, 4, 0, -4, -8, -12, -16, -20, -24];
    
    // Horizontal grid lines (dB levels)
    for (let db of dbPoints) {
      const y = margin + EQCoordinateUtils.gainToY(db, rect.height - margin * 2);
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(rect.width - margin, y);
      ctx.stroke();
    }

    // Draw frequency labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "10px sans-serif";
    ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b";
    
    // Show only the decade boundaries for labels
    const freqLabels = [20, 200, 2000, 20000];
    const labelY = rect.height - margin + 5; // Position labels below the bottom margin
    
    for (let freq of freqLabels) {
      const x = margin + EQCoordinateUtils.freqToX(freq, rect.width - margin * 2, freqRange);
      let label = freq >= 1000 ? `${freq/1000}k` : `${freq}`;
      
      // Calculate text dimensions for background
      const textWidth = ctx.measureText(label).width;
      const textHeight = 12;
      
      // Draw label background
      ctx.fillStyle = isDarkMode ? "rgba(15, 15, 25, 0.9)" : "rgba(245, 245, 245, 0.9)";
      ctx.fillRect(
        x - textWidth/2 - 2, 
        labelY - 2, 
        textWidth + 4, 
        textHeight + 4
      );
      
      // Draw label text
      ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b";
      ctx.fillText(label, x, labelY);
    }

    // Draw dB labels with background
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    
    for (let db of dbPoints) {
      // Only show every 4dB label
      if (db % 4 === 0) {
        const y = margin + EQCoordinateUtils.gainToY(db, rect.height - margin * 2);
        const label = `${db > 0 ? '+' : ''}${db}`; // Removed the "dB" suffix
        
        // Calculate text dimensions
        const textWidth = ctx.measureText(label).width;
        const textHeight = 12;
        
        // Draw label background
        ctx.fillStyle = isDarkMode ? "rgba(15, 15, 25, 0.9)" : "rgba(245, 245, 245, 0.9)";
        ctx.fillRect(
          rect.width - margin + 5, 
          y - textHeight/2 - 2, 
          textWidth + 4, 
          textHeight + 4
        );
        
        // Draw label text
        ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b";
        ctx.fillText(label, rect.width - margin + 7, y);
      }
    }

    // Mark background as drawn
    backgroundDrawnRef.current = true;
  }, [isDarkMode, freqRange]);

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

    // Get canvas dimensions and margin
    const rect = canvas.getBoundingClientRect();
    const margin = (canvas as any).margin || 30; // Get margin from canvas or use default

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
      
      // Add margin to rendering
      EQBandRenderer.drawBand(
        ctx,
        band,
        rect.width - margin * 2, // Adjust width for margins
        rect.height - margin * 2, // Adjust height for margins
        freqRange,
        isDarkMode,
        isHovered,
        isDragging,
        isEnabled,
        margin, // Pass margin for coordinate adjustments
        margin  // Pass margin for coordinate adjustments
      );
      
      // Draw Q indicator if shift is pressed and band is selected, hovered, or being dragged
      if (isShiftPressed && (band.id === selectedBandId || band.isHovered || band.id === draggingBandId)) {
        EQBandRenderer.drawQIndicator(
          ctx,
          band,
          rect.width - margin * 2, // Adjust width for margins
          rect.height - margin * 2, // Adjust height for margins
          freqRange,
          isDarkMode,
          isEnabled,
          margin, // Pass margin for x coordinate adjustment
          margin  // Pass margin for y coordinate adjustment
        );
      }
    });

    // Draw the combined EQ curve (brighter with glow effect)
    if (frequencyResponse.length > 0) {
      // Create clipping path for the inner area to ensure curve doesn't exceed boundaries
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin, margin, rect.width - margin * 2, rect.height - margin * 2);
      ctx.clip();
      
    //   // First draw a wider, more transparent version for the glow effect
    //   EQCurveRenderer.drawFrequencyResponse(
    //     ctx,
    //     frequencyResponse,
    //     rect.width - margin * 2, // Adjust width for margins
    //     rect.height - margin * 2, // Adjust height for margins
    //     freqRange,
    //     isDarkMode,
    //     8, // Even wider lineWidth for stronger glow
    //     0.4, // lower alpha for glow
    //     isEnabled, // Pass isEnabled parameter
    //     margin, // Pass margin for x coordinate adjustment
    //     margin  // Pass margin for y coordinate adjustment
    //   );
      
    //   // Second glow layer (medium width)
    //   EQCurveRenderer.drawFrequencyResponse(
    //     ctx,
    //     frequencyResponse,
    //     rect.width - margin * 2,
    //     rect.height - margin * 2,
    //     freqRange,
    //     isDarkMode,
    //     5, // medium lineWidth
    //     0.6, // medium alpha
    //     isEnabled,
    //     margin,
    //     margin
    //   );
      
      // Then draw the main curve with higher brightness
      EQCurveRenderer.drawFrequencyResponse(
        ctx,
        frequencyResponse,
        rect.width - margin * 2, // Adjust width for margins
        rect.height - margin * 2, // Adjust height for margins
        freqRange,
        isDarkMode,
        2.5, // slightly thinner for sharper appearance
        1.0, // full alpha for maximum brightness
        isEnabled, // Pass isEnabled parameter
        margin, // Pass margin for x coordinate adjustment
        margin  // Pass margin for y coordinate adjustment
      );
      
      // Restore context to remove clipping
      ctx.restore();
    }
    
    // Draw ghost node if visible, not disabled, and not hovering over volume
    if (ghostNode.visible && !disabled && !isHoveringVolume && !isDraggingVolume) {
      // Calculate color based on location (frequency)
      const innerX = ghostNode.x - margin; // Adjust for margin
      const innerY = ghostNode.y - margin; // Adjust for margin
      const ghostFreq = EQCoordinateUtils.xToFreq(innerX, rect.width - margin * 2, freqRange);
      const ghostColor = EQCoordinateUtils.getBandColor(ghostFreq, 1.0, isDarkMode);
      
      // Draw ghost node handle inside margins
      EQBandRenderer.drawBandHandle(
        ctx,
        margin + innerX, // Adjust to render within margins
        margin + innerY, // Adjust to render within margins
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
        rect.width - margin * 2, // Adjust width for margins
        rect.height - margin * 2, // Adjust height for margins
        isDarkMode,
        isEnabled,
        isDraggingVolume,
        isHoveringVolume,
        margin, // Pass margin for x coordinate adjustment
        margin  // Pass margin for y coordinate adjustment
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