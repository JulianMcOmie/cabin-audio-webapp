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
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null)
  
  // Volume control state
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  
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
  
  // Convert volume in dB to y-coordinate on canvas
  const volumeToY = useCallback((volume: number, height: number) => {
    // Map volume from -18dB to +12dB to canvas height (top to bottom)
    // Center (0dB) is at height * 0.5
    const maxDb = 24;
    const minDb = -24;
    const range = maxDb - minDb;
    
    // Invert y-axis because canvas y is top-down
    return height * (0.5 - (volume / range) * 0.75);
  }, []);
  
  // Convert y-coordinate on canvas to volume in dB
  const yToVolume = useCallback((y: number, height: number) => {
    // Map y-coordinate to volume (-18dB to +12dB)
    const maxDb = 12;
    const minDb = -18;
    const range = maxDb - minDb;
    
    // Calculate the position relative to the center (0dB)
    const normalizedY = 0.5 - y / height;
    const volume = normalizedY * range * (1/0.75);
    
    // Clamp to reasonable range and round to 1 decimal place
    return Math.round(Math.min(maxDb, Math.max(minDb, volume)) * 10) / 10;
  }, []);
  
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
  
  // Check if a point is inside the volume control dot
  const isInVolumeDot = useCallback((x: number, y: number, dotX: number, dotY: number) => {
    const dotRadius = 8; // Slightly larger hit area for better UX
    return Math.sqrt(Math.pow(x - dotX, 2) + Math.pow(y - dotY, 2)) <= dotRadius;
  }, []);
  
  // Custom mouse handlers to support volume control
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!profile) {
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if we're clicking on the volume dot
    const volumeDotX = rect.width - 20; // 20px from the right edge
    const volumeDotY = volumeToY(profile.volume || 0, rect.height);
    
    if (isInVolumeDot(x, y, volumeDotX, volumeDotY)) {
      setIsDraggingVolume(true);
      
      // Add event listeners for mouse move and mouse up
      const handleDocumentMouseMove = (e: MouseEvent) => {
        if (!canvas || !profile) return;
        
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const newVolume = yToVolume(y, rect.height);
        
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
    
    // If not clicking on volume dot, delegate to the band mouse handler
    handleBandMouseDown(e);
  }, [disabled, handleBandMouseDown, isInVolumeDot, profile, updateProfile, volumeToY, yToVolume]);
  
  // Update instruction text based on interaction state
  useEffect(() => {
    if (!onInstructionChange) return;
    
    if (isDraggingVolume) {
      onInstructionChange("Drag up/down to adjust volume");
    } else if (draggingBandId) {
      // Always show the shift+drag instruction for better discoverability, 
      // even when not currently pressing shift
      onInstructionChange("Shift + drag to change bandwidth (Q)");
    } else if (hoveredBandId) {
      onInstructionChange("Right click to delete band");
    } else {
      onInstructionChange("Click + drag on the center line to add a band");
    }
  }, [draggingBandId, hoveredBandId, isDraggingVolume, isShiftPressed, onInstructionChange]);

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

  // Redraw canvas when theme or other dependencies change
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

    // Add semi-transparent background with reduced opacity
    ctx.fillStyle = isDarkMode ? "rgba(24, 24, 36, 0.4)" : "rgba(255, 255, 255, 0.4)"
    ctx.fillRect(0, 0, rect.width, rect.height)

    // Draw background grid
    ctx.strokeStyle = isDarkMode ? "#3f3f5c" : "#e2e8f0" // Darker grid lines for dark mode
    ctx.lineWidth = 1

    // Vertical grid lines (frequency bands)
    const numBands = 10
    for (let i = 0; i <= numBands; i++) {
      const x = (i / numBands) * rect.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()
    }

    // Horizontal grid lines (dB levels)
    const levels = 6
    for (let i = 0; i <= levels; i++) {
      const y = (i / levels) * rect.height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
    }

    // Draw frequency labels
    ctx.fillStyle = isDarkMode ? "#a1a1aa" : "#64748b" // Brighter text for dark mode
    ctx.font = "10px sans-serif"
    ctx.textAlign = "center"

    const freqLabels = ["20Hz", "50Hz", "100Hz", "200Hz", "500Hz", "1kHz", "2kHz", "5kHz", "10kHz", "20kHz"]
    for (let i = 0; i < freqLabels.length; i++) {
      const x = ((i + 0.5) / numBands) * rect.width
      ctx.fillText(freqLabels[i], x, rect.height - 5)
    }

    // Draw dB labels
    ctx.textAlign = "right"
    const dbLabels = ["+12dB", "+6dB", "0dB", "-6dB", "-12dB", "-18dB"]
    for (let i = 0; i < dbLabels.length; i++) {
      const y = (i / (levels - 1)) * (rect.height - 30) + 15
      ctx.fillText(dbLabels[i], rect.width - 10, y)
    }

    // Set isEnabled based on disabled prop
    const isEnabled = !disabled;

    // Draw individual band responses
    renderableBands.forEach((band) => {
        // Consider a band "hovered" if it's the selected band or if it's being dragged
        const isHovered = band.id === selectedBandId || band.id === draggingBandId;
        
        EQBandRenderer.drawBand(
          ctx,
          band,
          rect.width,
          rect.height,
          freqRange,
          isDarkMode,
          isHovered,
          isEnabled
        )
        
        // Draw Q indicator if shift is pressed and band is selected or hovered
        if (isShiftPressed && (band.id === selectedBandId || band.isHovered)) {
          EQBandRenderer.drawQIndicator(
            ctx,
            band,
            rect.width,
            rect.height,
            freqRange,
            isDarkMode,
            isEnabled
          )
        }
    })

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
      )
    }
    
    // Draw ghost node if visible and not disabled
    if (ghostNode.visible && !disabled) {
      // Calculate color based on location (frequency)
      const ghostFreq = EQCoordinateUtils.xToFreq(ghostNode.x, rect.width, freqRange)
      const ghostColor = EQCoordinateUtils.getBandColor(ghostFreq, 0.7, isDarkMode)
      
      // Draw ghost node handle
      EQBandRenderer.drawBandHandle(
        ctx,
        ghostNode.x,
        ghostNode.y,
        ghostColor,
        true,
        isEnabled
      )
    }
    
    // Draw volume control if we have a profile
    if (profile) {
      const volumeDotX = rect.width - 20; // 20px from right edge
      const centerY = rect.height * 0.5; // Center line y-position (0dB)
      
      // Calculate volume dot position
      const volumeDotY = volumeToY(profile.volume || 0, rect.height);
      
      // Draw center line to volume indicator line
      ctx.beginPath();
      ctx.strokeStyle = isDarkMode ? "#a1a1aa" : "#64748b";
      ctx.lineWidth = 1;
      ctx.moveTo(volumeDotX - 20, centerY);
      ctx.lineTo(volumeDotX + 20, centerY);
      ctx.stroke();
      
      // Draw filled rectangle between center line and volume line
      ctx.beginPath();
      ctx.fillStyle = isDarkMode 
        ? `rgba(56, 189, 248, ${isEnabled ? 0.2 : 0.1})` // Blue with opacity
        : `rgba(2, 132, 199, ${isEnabled ? 0.2 : 0.1})`; // Darker blue with opacity
      
      ctx.rect(
        volumeDotX - 10, // 10px to the left of the dot
        Math.min(centerY, volumeDotY), // Top of rectangle (either center or volume line)
        20, // Width - 10px on each side
        Math.abs(centerY - volumeDotY) // Height - absolute difference between center and volume
      );
      ctx.fill();
      
      // Draw volume indicator line
      ctx.beginPath();
      ctx.strokeStyle = isDarkMode 
        ? (isEnabled ? "#38bdf8" : "#38bdf8aa") // sky-400
        : (isEnabled ? "#0284c7" : "#0284c7aa"); // sky-600
      ctx.lineWidth = 2;
      ctx.moveTo(volumeDotX - 15, volumeDotY);
      ctx.lineTo(volumeDotX + 15, volumeDotY);
      ctx.stroke();
      
      // Draw volume dot
      ctx.beginPath();
      ctx.fillStyle = isDarkMode 
        ? (isEnabled ? "#38bdf8" : "#38bdf8aa") // sky-400
        : (isEnabled ? "#0284c7" : "#0284c7aa"); // sky-600
      ctx.arc(volumeDotX, volumeDotY, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw volume value if being dragged
      if (isDraggingVolume || Math.abs(profile.volume || 0) > 0.1) {
        ctx.fillStyle = isDarkMode ? "#ffffff" : "#000000";
        ctx.textAlign = "left";
        ctx.font = "12px sans-serif";
        const volumeText = `${(profile.volume || 0).toFixed(1)} dB`;
        ctx.fillText(volumeText, volumeDotX + 15, volumeDotY + 5);
      }
    }
    
  }, [renderableBands, frequencyResponse, disabled, isDarkMode, selectedBandId, isShiftPressed, ghostNode, draggingBandId, hoveredBandId, profile, volumeToY, isDraggingVolume])

  return (
    <div
      className={`w-full aspect-[2/1] frequency-graph rounded-lg border dark:border-gray-700 overflow-hidden opacity-80 ${className || ""}`}
    >
      <canvas 
        ref={canvasRef} 
        className="w-full h-full" 
        onMouseMove={handleBandMouseMove}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
} 