"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { v4 as uuidv4 } from 'uuid'
import { useTheme } from "@/components/theme-provider"
import { EQBandWithUI } from "./types"
import { EQBandRenderer } from "./EQBandRenderer"
import { EQCurveRenderer } from "./EQCurveRenderer"
import { EQCoordinateUtils } from "./EQCoordinateUtils"
import { useEQInteraction } from "./useEQInteraction"
import { useEQProcessor, calculateBandResponse } from "./useEQProcessor"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"

interface FrequencyEQProps {
  profileId?: string
  disabled?: boolean
  className?: string
}

export function FrequencyEQ({ profileId, disabled = false, className }: FrequencyEQProps) {
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
  
  // Convert profile bands to EQBandWithUI for rendering
  const [bands, setBands] = useState<EQBandWithUI[]>([])
  
  // Update bands when profile changes
  useEffect(() => {
    if (!profile) {
      setBands([])
      return
    }
    
    // Convert profile bands to EQBandWithUI
    const uiBands: EQBandWithUI[] = profile.bands.map(band => ({
      ...band,
      id: uuidv4(), // Generate IDs for UI bands
      isHovered: false,
      type: 'peaking' as BiquadFilterType, // Default type for all bands
      frequencyResponse: calculateBandResponse({
        ...band,
        id: '',
        isHovered: false,
        type: 'peaking' as BiquadFilterType,
      })
    }))
    
    setBands(uiBands)
  }, [profile])
  
  // Fixed frequency range
  const freqRange = { min: 20, max: 20000 }
  
  // Process EQ bands to get frequency response
  const { frequencyResponse } = useEQProcessor(bands)
  
  // Handle band operations
  const handleBandAdd = useCallback((band: Omit<EQBandWithUI, 'id' | 'isHovered' | 'frequencyResponse'>) => {
    if (!profile) return
    
    // Create a new band and add to profile
    const newProfileBand = {
      frequency: band.frequency,
      gain: band.gain,
      q: band.q,
    }
    
    // Add band to profile
    updateProfile(profile.id, {
      bands: [...profile.bands, newProfileBand]
    })
  }, [profile, updateProfile])
  
  const handleBandUpdate = useCallback((id: string, updates: Partial<EQBandWithUI>) => {
    if (!profile) return
    
    // Update local state first for responsive UI
    setBands(prev => {
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
    
    // Sync changes back to the profile
    const bandIndex = bands.findIndex(b => b.id === id)
    if (bandIndex !== -1 && (updates.frequency !== undefined || updates.gain !== undefined || updates.q !== undefined)) {
      const profileBands = [...profile.bands]
      profileBands[bandIndex] = { 
        ...profileBands[bandIndex],
        frequency: updates.frequency !== undefined ? updates.frequency : bands[bandIndex].frequency,
        gain: updates.gain !== undefined ? updates.gain : bands[bandIndex].gain,
        q: updates.q !== undefined ? updates.q : bands[bandIndex].q,
      }
      
      updateProfile(profile.id, { bands: profileBands })
    }
  }, [profile, bands, updateProfile])
  
  const handleBandRemove = useCallback((id: string) => {
    if (!profile) return
    
    // Find the index of the band to remove
    const bandIndex = bands.findIndex(b => b.id === id)
    if (bandIndex !== -1) {
      // Remove from profile
      const profileBands = [...profile.bands]
      profileBands.splice(bandIndex, 1)
      
      updateProfile(profile.id, { bands: profileBands })
    }
  }, [profile, bands, updateProfile])
  
  // Set up EQ interaction
  const { 
    handleMouseMove, 
    handleMouseDown, 
    isShiftPressed,
    ghostNode,
  } = useEQInteraction({
    canvasRef,
    bands,
    freqRange,
    onBandAdd: handleBandAdd,
    onBandUpdate: handleBandUpdate,
    onBandRemove: handleBandRemove,
    onBandSelect: setSelectedBandId,
  })

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

    // Draw all EQ bands
    if (!disabled) {
      // Draw individual band responses
      bands.forEach((band) => {
        EQBandRenderer.drawBand(
          ctx,
          band,
          rect.width,
          rect.height,
          freqRange,
          isDarkMode,
          band.id === selectedBandId
        )
        
        // Draw Q indicator if shift is pressed and band is selected or hovered
        if (isShiftPressed && (band.id === selectedBandId || band.isHovered)) {
          EQBandRenderer.drawQIndicator(
            ctx,
            band,
            rect.width,
            rect.height,
            freqRange,
            isDarkMode
          )
        }
      })
    }

    // Draw the combined EQ curve
    if (disabled) {
      ctx.strokeStyle = isDarkMode ? "#71717a" : "#94a3b8" // Brighter disabled curve for dark mode
    } else {
      // Create gradient for the EQ curve
      const gradient = ctx.createLinearGradient(0, 0, rect.width, 0)
      if (isDarkMode) {
        gradient.addColorStop(0, "#0ea5e9") // sky-500
        gradient.addColorStop(0.5, "#38bdf8") // sky-400
        gradient.addColorStop(1, "#7dd3fc") // sky-300
      } else {
        gradient.addColorStop(0, "#0284c7") // sky-600
        gradient.addColorStop(0.5, "#0ea5e9") // sky-500
        gradient.addColorStop(1, "#38bdf8") // sky-400
      }
      ctx.strokeStyle = gradient
    }

    // Draw the combined frequency response curve
    if (frequencyResponse.length > 0) {
      EQCurveRenderer.drawFrequencyResponse(
        ctx,
        frequencyResponse,
        rect.width,
        rect.height,
        freqRange,
        isDarkMode,
        3, // lineWidth
        0.8 // alpha
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
        true
      )
    }

  }, [bands, frequencyResponse, disabled, isDarkMode, selectedBandId, isShiftPressed, ghostNode])

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