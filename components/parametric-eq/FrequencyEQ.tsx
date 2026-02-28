"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useDarkMode } from "@/lib/hooks/useDarkMode"
import { EQBandWithUI } from "./types"
import { EQBandRenderer } from "./EQBandRenderer"
import { EQCurveRenderer } from "./EQCurveRenderer"
import { EQCoordinateUtils } from "./EQCoordinateUtils"
import { useEQInteraction } from "./useEQInteraction"
import { useEQProcessor, calculateBandResponse } from "./useEQProcessor"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQBand } from "@/lib/models/EQBand"
import { getReferenceCalibrationAudio } from '@/lib/audio/referenceCalibrationAudio';

interface FrequencyEQProps {
  profileId?: string
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
}

// Define a type for the audio processor
interface AudioProcessor {
  setVolume: (volume: number) => void;
  setBandFrequency: (bandId: string, frequency: number) => void;
  setBandGain: (bandId: string, gain: number) => void;
  setBandQ: (bandId: string, q: number) => void;
  setBandType: (bandId: string, type: BiquadFilterType) => void;
}

// Extend HTMLCanvasElement with margin property
interface CanvasWithMargin extends HTMLCanvasElement {
  margin?: number;
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

  // Fixed frequency range outside component to be stable
const freqRange = { min: 20, max: 20000 }

export function FrequencyEQ({ profileId, disabled = false, className, onInstructionChange, onRequestEnable }: FrequencyEQProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<CanvasWithMargin>(null)
  const backgroundCanvasRef = useRef<CanvasWithMargin>(null)
  // Add refs for animation frame and canvas context
  const animationFrameRef = useRef<number | null>(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const backgroundContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const backgroundDrawnRef = useRef<boolean>(false)
  
  const isDarkMode = useDarkMode()
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null)
  
  // Volume control state
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const [isHoveringVolume, setIsHoveringVolume] = useState(false)
  
  // State to track if Control or Option key is pressed
  const [isModifierKeyPressed, setIsModifierKeyPressed] = useState(false)
  
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
      isHovered: false,
      type: 'peaking' as BiquadFilterType, // Default type for all bands
      frequencyResponse: calculateBandResponse({
        ...band,
        isHovered: false,
        type: 'peaking' as BiquadFilterType,
      })
    }))
    
    setRenderableBands(updatedBands)
  }, [profile])
  
  // Fixed frequency range
  // const freqRange = { min: 20, max: 20000 } // Moved outside component
  
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
    
    // Check if this is the first band - if so, enable the EQ automatically
    if (profile.bands.length === 0 && disabled) {
      // Call the onRequestEnable function to enable the EQ
      if (onRequestEnable) {
        onRequestEnable();
      }
    }
    
    // Add band to profile immediately
    updateProfile(profile.id, {
      bands: [...profile.bands, newProfileBand]
    })
    
    // Return the new band ID so it can be selected for dragging
    return newProfileBand.id
  }, [profile, updateProfile, onRequestEnable, disabled])
  
  // Add keyboard event listeners for Control and Option keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Control (ctrlKey) or Option/Alt (altKey) is pressed
      if (e.ctrlKey || e.altKey) {
        setIsModifierKeyPressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      // When no modifier keys are pressed anymore
      if (!e.ctrlKey && !e.altKey) {
        setIsModifierKeyPressed(false);
        
        // Stop the calibration sound when keys are released
        const audioPlayer = getReferenceCalibrationAudio();
        audioPlayer.setPlaying(false);
      }
    };
    
    // Add global event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    const handleBlur = () => {
      // Stop the calibration sound when window loses focus
      setIsModifierKeyPressed(false);
      const audioPlayer = getReferenceCalibrationAudio();
      audioPlayer.setPlaying(false);
    };
    
    window.addEventListener('blur', handleBlur);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);
  
  // Function to update calibration frequency based on mouse position
  const updateCalibrationFromMousePosition = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    if (!isModifierKeyPressed || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const margin = canvas.margin || 40;
    
    // Get mouse coordinates relative to canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if within the inner EQ area
    const isWithinInnerArea = 
      x >= margin && x <= rect.width - margin &&
      y >= margin && y <= rect.height - margin;
    
    if (isWithinInnerArea) {
      // Calculate inner coordinates
      const innerX = x - margin;
      const innerWidth = rect.width - margin * 2;
      
      // Convert X position to frequency
      const frequency = EQCoordinateUtils.xToFreq(innerX, innerWidth, freqRange);
      const clampedFrequency = Math.max(20, Math.min(20000, frequency));
      
      // Update calibration audio
      const audioPlayer = getReferenceCalibrationAudio();
      audioPlayer.setCalibrationFrequency(clampedFrequency);
      
      // Make sure it's playing
      if (!audioPlayer.isActive()) {
        audioPlayer.setPlaying(true);
      }
    }
  }, [isModifierKeyPressed]);
  
  // Add a document mousemove listener to update calibration when modifier key is pressed
  useEffect(() => {
    if (!isModifierKeyPressed) {
      // If no modifier key is pressed, don't need the listener
      return;
    }
    
    // Handler for document mouse move
    const handleDocumentMouseMove = (e: MouseEvent) => {
      updateCalibrationFromMousePosition(e);
    };
    
    // Add global event listener
    document.addEventListener('mousemove', handleDocumentMouseMove);
    
    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
    };
  }, [isModifierKeyPressed, updateCalibrationFromMousePosition]);
  
  const handleBandUpdate = useCallback((id: string, updates: Partial<EQBandWithUI>) => {
    if (!profile) return

    // Find the band in the profile
    const bandIndex = profile.bands.findIndex(b => b.id === id)
    if (bandIndex === -1) return

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
        // Create updated band with new properties, maintaining other properties
        const updatedBand = { ...newBands[index], ...updates }
        
        // Recalculate frequency response ONLY if parameters affecting response were changed
        if (updates.frequency !== undefined || updates.gain !== undefined || updates.q !== undefined || updates.type !== undefined) {
          updatedBand.frequencyResponse = calculateBandResponse(updatedBand)
        }
        
        // Update just this band in the array
        newBands[index] = updatedBand
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
    
    // First check if we should update calibration based on modifier keys
    if (isModifierKeyPressed) {
      updateCalibrationFromMousePosition(e);
      // Still allow regular hover behavior
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const margin = canvas.margin || 40;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Calculate inner dimensions
    const innerWidth = rect.width - margin * 2;
    const innerHeight = rect.height - margin * 2;
    
    // Check if we're hovering over the volume control using raw coordinates
    const isOverVolume = EQBandRenderer.isInVolumeControl(
      x, y, innerWidth, innerHeight, profile.volume || 0, margin, margin
    );
    
    setIsHoveringVolume(isOverVolume);
    
    // If we're not over the volume control, pass to band handler
    if (!isOverVolume) {
      handleBandMouseMove(e);
    } else {
      // Update cursor based on volume hover
      document.body.style.cursor = 'pointer';
    }
  }, [profile, isDraggingVolume, handleBandMouseMove, isModifierKeyPressed, updateCalibrationFromMousePosition]);
  
  // Handle mouse down for volume control
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!profile) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const margin = canvas.margin || 40;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // inner dimensions
    const innerWidth = rect.width - margin * 2;
    const innerHeight = rect.height - margin * 2;
    
    // volume control
    const isOverVolume = EQBandRenderer.isInVolumeControl(
      x, y, innerWidth, innerHeight, profile.volume || 0, margin, margin
    );
    
    if (isOverVolume) {
      setIsDraggingVolume(true);
      document.body.style.cursor = 'grabbing';
      
      // Handle document mouse move to support dragging outside canvas bounds
      const handleDocumentMouseMove = (e: MouseEvent) => {
        // If modifier key is pressed during volume dragging, update calibration as well
        if (isModifierKeyPressed) {
          updateCalibrationFromMousePosition(e);
        }
        
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        
        // Calculate position within the inner area
        const innerY = Math.max(margin, Math.min(rect.height - margin, y)) - margin;
        
        // Calculate new volume using EQCoordinateUtils
        const newVolume = EQCoordinateUtils.yToGain(innerY, innerHeight);
        
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
    } else {
      // Only check if within inner area, but DON'T check disabled state here
      // to allow band interaction even when EQ is disabled
      const isWithinInnerArea = 
        x >= margin && x <= rect.width - margin &&
        y >= margin && y <= rect.height - margin;
        
      if (isWithinInnerArea) {
        // Always pass to band handler, even when disabled
        handleBandMouseDown(e);
      }
    }
  }, [handleBandMouseDown, profile, updateProfile, isModifierKeyPressed, updateCalibrationFromMousePosition]);
  
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

  // Redraw background when theme changes
  useEffect(() => {
    backgroundDrawnRef.current = false;
  }, [isDarkMode])

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

    // Scale the inner padding with container size so internals stay proportional while resizing.
    const margin = Math.max(28, Math.min(44, Math.round(Math.min(rect.width, rect.height) * 0.1)));
    
    // Store margins in a ref to access in other functions
    if (!canvasRef.current) return;
    (canvasRef.current as CanvasWithMargin).margin = margin;

    // Clear canvas (fully transparent — glass panel backdrop-blur handles the frosted effect)
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw a subtle border around the content area
    ctx.strokeStyle = isDarkMode ? "rgba(70, 75, 85, 0.3)" : "rgba(200, 200, 200, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin, margin, rect.width - margin * 2, rect.height - margin * 2);

    // Draw background grid (faint on transparent bg)
    ctx.strokeStyle = isDarkMode ? "rgba(55, 60, 72, 0.22)" : "rgba(100, 100, 120, 0.2)";
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
    
    // Generate 10 linearly spaced points for each decade
    // Since we're using freqToX which already does logarithmic conversion,
    // we need linear spacing here to get logarithmic grid lines
    decades.forEach(([startFreq, endFreq]) => {
      const range = endFreq - startFreq;
      const step = range / 10;
      
      // Add points for this decade
      for (let i = 0; i < 10; i++) {
        const freq = startFreq + i * step;
        freqPoints.push(Math.round(freq));
      }
    });
    
    // Add the final point (20kHz)
    freqPoints.push(20000);
    
    // Vertical grid lines (logarithmic frequency bands)
    for (const freq of freqPoints) {
      const x = margin + EQCoordinateUtils.freqToX(freq, rect.width - margin * 2, freqRange);
      ctx.beginPath();
      ctx.moveTo(x, margin);
      ctx.lineTo(x, rect.height - margin);
      ctx.stroke();
    }

    // Define dB points for grid (matching actual EQ range, with more values, extending to +24dB)
    const dbPoints = [24, 20, 16, 12, 8, 4, 0, -4, -8, -12, -16, -20, -24];
    
    // Horizontal grid lines (dB levels)
    for (const db of dbPoints) {
      const y = margin + EQCoordinateUtils.gainToY(db, rect.height - margin * 2);
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(rect.width - margin, y);
      ctx.stroke();
    }

    // Draw frequency labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = isDarkMode ? "#9ca3af" : "#64748b";
    
    // Show more frequency labels for better reference
    const freqLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const labelY = rect.height - margin + 5; // Position labels below the bottom margin
    
    for (const freq of freqLabels) {
      const x = margin + EQCoordinateUtils.freqToX(freq, rect.width - margin * 2, freqRange);
      const label = freq >= 1000 ? `${freq/1000}k` : `${freq}`;

      // Draw label text with shadow for readability on transparent bg
      ctx.fillStyle = isDarkMode ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.6)";
      ctx.fillText(label, x + 0.5, labelY + 0.5);
      ctx.fillStyle = isDarkMode ? "#9ca3af" : "#64748b";
      ctx.fillText(label, x, labelY);
    }

    // Draw dB labels with background
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    
    for (const db of dbPoints) {
      // Only show every 4dB label
      if (db % 4 === 0) {
        const y = margin + EQCoordinateUtils.gainToY(db, rect.height - margin * 2);
        const label = `${db > 0 ? '+' : ''}${db}`;
        const labelX = rect.width - margin + 7;

        // Draw label text with shadow for readability on transparent bg
        ctx.fillStyle = isDarkMode ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.6)";
        ctx.fillText(label, labelX + 0.5, y + 0.5);
        ctx.fillStyle = isDarkMode ? "#9ca3af" : "#64748b";
        ctx.fillText(label, labelX, y);
      }
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

    // Get canvas dimensions and margin
    const rect = canvas.getBoundingClientRect();
    const margin = canvas.margin || 40; // Get margin from canvas or use default

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
    renderBackgroundCanvas
  ]);

  // Set up both canvases with DPI scaling and store their contexts
  const setupCanvases = useCallback(() => {
    const canvas = canvasRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    if (!canvas || !backgroundCanvas) return false;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    backgroundCanvas.width = rect.width * dpr;
    backgroundCanvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    const bgCtx = backgroundCanvas.getContext("2d");
    if (!ctx || !bgCtx) return false;

    ctx.scale(dpr, dpr);
    bgCtx.scale(dpr, dpr);

    canvasContextRef.current = ctx;
    backgroundContextRef.current = bgCtx;
    backgroundDrawnRef.current = false;
    return true;
  }, []);

  // Initialize canvases and start animation loop
  useEffect(() => {
    if (!setupCanvases()) return;

    animationFrameRef.current = requestAnimationFrame(renderCanvas);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderCanvas, setupCanvases]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => { setupCanvases(); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setupCanvases]);

  // Handle container resize (e.g., EQ overlay drag-resize) so internals track size continuously.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let rafId = 0;
    const scheduleSetup = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        setupCanvases();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleSetup();
    });
    observer.observe(container);
    scheduleSetup();

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [setupCanvases]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full frequency-graph rounded-lg border overflow-hidden ${className || ""} relative`}
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
