"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"

interface DotGridProps {
  selectedDot: [number, number] | null
  setSelectedDot: (dot: [number, number] | null) => void
  gridSize: number
  disabled?: boolean
}

// Legacy DotGrid component - renamed for backwards compatibility
export function LegacyDotGrid({ selectedDot, setSelectedDot, gridSize, disabled = false }: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

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

    // Calculate dot size and spacing
    const dotRadius = Math.min(rect.width, rect.height) / (gridSize * 3)
    const spacing = Math.min(rect.width, rect.height) / gridSize

    // Draw dots
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const centerX = (x + 0.5) * spacing
        const centerY = (y + 0.5) * spacing

        // Check if this dot is selected
        const isSelected = selectedDot && selectedDot[0] === x / (gridSize - 1) && selectedDot[1] === y / (gridSize - 1)

        // Draw dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2)

        if (isSelected && !disabled) {
          ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600
        } else {
          ctx.fillStyle = disabled
            ? isDarkMode
              ? "#27272a" // zinc-800 - darker for better contrast in dark mode
              : "#e2e8f0" // slate-200
            : isDarkMode
              ? "#52525b" // zinc-600 - brighter for better visibility in dark mode
              : "#cbd5e1" // slate-300
        }

        ctx.fill()
      }
    }
  }, [selectedDot, gridSize, disabled, isDarkMode]) // Using isDarkMode instead of theme

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // Convert to grid coordinates
    const gridX = Math.floor(x * gridSize)
    const gridY = Math.floor(y * gridSize)

    // Normalize to 0-1 range
    const normalizedX = gridX / (gridSize - 1)
    const normalizedY = gridY / (gridSize - 1)

    setSelectedDot([normalizedX, normalizedY])
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full aspect-square cursor-pointer ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      onClick={handleCanvasClick}
    />
  )
}

// New interface for multi-selection DotGrid
interface MultiSelectionDotGridProps {
  gridSize: number; // Range: 3-9
  selectedDots: Set<string>; // Format: "x,y" string for each dot
  onDotToggle: (x: number, y: number) => void;
  disabled?: boolean;
  isPlaying?: boolean;
}

// New DotGrid component with multiple selection support
export function DotGrid({ 
  gridSize,
  selectedDots,
  onDotToggle,
  disabled = false,
  isPlaying = false
}: MultiSelectionDotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  
  // Fixed dot size regardless of grid size
  const DOT_RADIUS = 6;
  
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
  
  // Update canvas size on resize
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      setCanvasSize({ width: rect.width, height: rect.height })
    }
    
    updateCanvasSize()
    
    window.addEventListener('resize', updateCanvasSize)
    return () => window.removeEventListener('resize', updateCanvasSize)
  }, [])

  // Draw dots when dependencies change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas dimensions with proper DPI scaling
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasSize.width * dpr
    canvas.height = canvasSize.height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)
    
    // Skip rendering if size is not set yet
    if (canvasSize.width === 0 || canvasSize.height === 0) return
    
    // Calculate spacing between dots
    const size = Math.min(canvasSize.width, canvasSize.height)
    const totalDotSpace = DOT_RADIUS * 2 * gridSize
    const remainingSpace = size - totalDotSpace
    const gap = remainingSpace / (gridSize + 1)
    
    // Draw dots
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const centerX = gap + (x * (DOT_RADIUS * 2 + gap)) + DOT_RADIUS
        const centerY = gap + (y * (DOT_RADIUS * 2 + gap)) + DOT_RADIUS
        
        // Check if this dot is selected
        const isSelected = selectedDots.has(`${x},${y}`)
        
        // Draw pulsing animation for playing dots
        if (isPlaying && isSelected) {
          // Draw pulse background
          const pulseSize = 2 + Math.sin(Date.now() / 200) * 0.5
          ctx.beginPath()
          ctx.arc(centerX, centerY, DOT_RADIUS * pulseSize, 0, Math.PI * 2)
          ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.2)" : "rgba(2, 132, 199, 0.2)"
          ctx.fill()
        }

        // Draw dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, DOT_RADIUS, 0, Math.PI * 2)

        if (isSelected && !disabled) {
          ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600
        } else {
          ctx.fillStyle = disabled
            ? isDarkMode
              ? "#27272a" // zinc-800 - darker for better contrast in dark mode
              : "#e2e8f0" // slate-200
            : isDarkMode
              ? "#52525b" // zinc-600 - brighter for better visibility in dark mode
              : "#cbd5e1" // slate-300
        }

        ctx.fill()
        
        // Draw label for dot
        if (isSelected && !disabled) {
          const label = `${x+1},${y+1}`;
          ctx.font = '9px sans-serif';
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, centerX, centerY);
        }
      }
    }
    
    // Request animation frame if playing to handle pulsing animation
    if (isPlaying && selectedDots.size > 0) {
      requestAnimationFrame(() => {
        // Force a re-render for animation
        setCanvasSize(prev => ({ ...prev }));
      });
    }
  }, [selectedDots, gridSize, disabled, isDarkMode, canvasSize, isPlaying])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    
    // Calculate which dot was clicked
    const size = Math.min(rect.width, rect.height)
    const totalDotSpace = DOT_RADIUS * 2 * gridSize
    const remainingSpace = size - totalDotSpace
    const gap = remainingSpace / (gridSize + 1)
    
    // Find clicked dot
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const centerX = gap + (x * (DOT_RADIUS * 2 + gap)) + DOT_RADIUS
        const centerY = gap + (y * (DOT_RADIUS * 2 + gap)) + DOT_RADIUS
        
        // Check if click is within dot
        const distance = Math.sqrt(
          Math.pow(clickX - centerX, 2) + 
          Math.pow(clickY - centerY, 2)
        )
        
        if (distance <= DOT_RADIUS * 1.5) {
          // Toggle this dot
          onDotToggle(x, y)
          return
        }
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full aspect-square cursor-pointer ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      onClick={handleCanvasClick}
    />
  )
}

// Create a DotCalibration component that wraps DotGrid with state and controls
interface DotCalibrationProps {
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  disabled?: boolean;
}

export function DotCalibration({ isPlaying, setIsPlaying, disabled = false }: DotCalibrationProps) {
  const [gridSize, setGridSize] = useState(5);
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set());
  
  const handleDotToggle = (x: number, y: number) => {
    const dotKey = `${x},${y}`;
    const newSelectedDots = new Set(selectedDots);
    
    if (newSelectedDots.has(dotKey)) {
      newSelectedDots.delete(dotKey);
    } else {
      newSelectedDots.add(dotKey);
    }
    
    setSelectedDots(newSelectedDots);
  };
  
  const increaseGridSize = () => {
    if (gridSize < 9) {
      setGridSize(gridSize + 1);
    }
  };
  
  const decreaseGridSize = () => {
    if (gridSize > 3) {
      // Clean up any dots outside new grid size
      const newSelectedDots = new Set<string>();
      
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (x < gridSize - 1 && y < gridSize - 1) {
          newSelectedDots.add(dot);
        }
      });
      
      setGridSize(gridSize - 1);
      setSelectedDots(newSelectedDots);
    }
  };
  
  const clearSelection = () => {
    setSelectedDots(new Set());
  };
  
  return (
    <div className="space-y-4">
      <div className="relative bg-background/50 rounded-lg p-3">
        <DotGrid
          gridSize={gridSize}
          selectedDots={selectedDots}
          onDotToggle={handleDotToggle}
          disabled={disabled}
          isPlaying={isPlaying}
        />
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">
          Grid Size: {gridSize}×{gridSize}
        </span>
        <div className="flex items-center space-x-2">
          <button
            className={`h-7 w-7 rounded flex items-center justify-center border ${
              gridSize <= 3 || disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-muted'
            }`}
            onClick={decreaseGridSize}
            disabled={gridSize <= 3 || disabled}
          >
            <span className="text-sm">-</span>
          </button>
          <button
            className={`h-7 w-7 rounded flex items-center justify-center border ${
              gridSize >= 9 || disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-muted'
            }`}
            onClick={increaseGridSize}
            disabled={gridSize >= 9 || disabled}
          >
            <span className="text-sm">+</span>
          </button>
          <button
            className={`ml-2 px-2 h-7 rounded flex items-center text-xs border ${
              selectedDots.size === 0 || disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-muted'
            }`}
            onClick={clearSelection}
            disabled={selectedDots.size === 0 || disabled}
          >
            Clear
          </button>
        </div>
      </div>
      
      <div className="text-xs text-center text-muted-foreground">
        Selected: {selectedDots.size} dot{selectedDots.size !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

