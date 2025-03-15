"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useTheme } from "@/components/theme-provider"
import { EQBandWithUI } from "./types"
import { EQBandRenderer } from "./EQBandRenderer"
import { EQCurveRenderer } from "./EQCurveRenderer"
import { EQCoordinateUtils } from "./EQCoordinateUtils"
import { useEQInteraction } from "./useEQInteraction"
import { useEQProcessor, calculateBandResponse } from "./useEQProcessor"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQBand } from "@/lib/models/EQBand"

interface FrequencyEQProps {
  profileId?: string
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
}

export function FrequencyEQ({ profileId, disabled = false, className, onInstructionChange, onRequestEnable }: FrequencyEQProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { theme } = useTheme()
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null)
  
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
    handleMouseMove, 
    handleMouseDown, 
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
  
  // Update instruction text based on interaction state
  useEffect(() => {
    if (!onInstructionChange) return;
    
    if (draggingBandId) {
      // Always show the shift+drag instruction for better discoverability, 
      // even when not currently pressing shift
      onInstructionChange("Shift + drag to change bandwidth (Q)");
    } else if (hoveredBandId) {
      onInstructionChange("Right click to delete band");
    } else {
      onInstructionChange("Click + drag on the center line to add a band");
    }
  }, [draggingBandId, hoveredBandId, isShiftPressed, onInstructionChange]);

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

  }, [renderableBands, frequencyResponse, disabled, isDarkMode, selectedBandId, isShiftPressed, ghostNode, draggingBandId, hoveredBandId])

  return (
    <div
      className={`w-full aspect-[2/1] frequency-graph bg-white dark:bg-card rounded-lg border dark:border-gray-700 overflow-hidden ${disabled ? "opacity-70" : ""} ${className || ""}`}
    >
      <canvas 
        ref={canvasRef} 
        className="w-full h-full" 
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
} 