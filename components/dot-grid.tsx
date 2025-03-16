"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"
import * as dotGridAudio from '@/lib/audio/dotGridAudio'
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

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
  gridSize: number; // Range: 3-9, now controls only rows
  selectedDots: Set<string>; // Format: "x,y" string for each dot
  onDotToggle: (x: number, y: number) => void;
  disabled?: boolean;
  isPlaying?: boolean;
}

// Constants for the grid
const DEFAULT_COLUMNS = 5; // Default panning positions
const DEFAULT_ROWS = 3; // Default number of rows
const MIN_COLUMNS = 3; // Minimum columns
const MAX_COLUMNS = 9; // Maximum columns
const MIN_ROWS = 3; // Minimum rows
const MAX_ROWS = 9; // Maximum rows
const BASE_DOT_RADIUS = 6; // Base dot size, will be adjusted as needed

// New DotGrid component with multiple selection support
export function DotGrid({ 
  gridSize,
  selectedDots,
  onDotToggle,
  disabled = false,
  isPlaying = false,
  columnCount = DEFAULT_COLUMNS
}: MultiSelectionDotGridProps & { columnCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  
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

  // Calculate dot sizing and spacing based on grid dimensions
  const gridDimensions = useMemo(() => {
    const rows = gridSize;
    const cols = columnCount;
    
    // Determine proper spacing and dot size based on canvas dimensions
    const size = Math.min(canvasSize.width, canvasSize.height);
    
    // We need to account for potentially different horizontal and vertical spacing
    const aspectRatio = canvasSize.width / canvasSize.height;
    
    // Calculate dot radius that works for both dimensions
    // For square canvas, this will be the same as before
    // For non-square, we adjust accordingly
    let dotRadius = BASE_DOT_RADIUS;
    
    // Adjust dot radius if canvas is very wide or tall
    if (aspectRatio > 1.5) {
      // Wide canvas - make dots slightly smaller
      dotRadius = BASE_DOT_RADIUS * 0.9;
    } else if (aspectRatio < 0.75) {
      // Tall canvas - make dots slightly smaller
      dotRadius = BASE_DOT_RADIUS * 0.9;
    }
    
    // Calculate spacing
    const hTotalDotSpace = dotRadius * 2 * cols;
    const vTotalDotSpace = dotRadius * 2 * rows;
    
    const hRemainingSpace = canvasSize.width - hTotalDotSpace;
    const vRemainingSpace = canvasSize.height - vTotalDotSpace;
    
    const hGap = hRemainingSpace / (cols + 1);
    const vGap = vRemainingSpace / (rows + 1);
    
    return {
      rows,
      cols,
      dotRadius,
      hGap,
      vGap
    };
  }, [gridSize, columnCount, canvasSize]);

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
    
    const { rows, cols, dotRadius, hGap, vGap } = gridDimensions;
    
    // Draw dots
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const centerX = hGap + (x * (dotRadius * 2 + hGap)) + dotRadius
        const centerY = vGap + (y * (dotRadius * 2 + vGap)) + dotRadius
        
        // Check if this dot is selected
        const isSelected = selectedDots.has(`${x},${y}`)
        
        // Draw pulsing animation for playing dots
        if (isPlaying && isSelected) {
          // Draw pulse background
          const pulseSize = 2 + Math.sin(Date.now() / 200) * 0.5
          ctx.beginPath()
          ctx.arc(centerX, centerY, dotRadius * pulseSize, 0, Math.PI * 2)
          ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.2)" : "rgba(2, 132, 199, 0.2)"
          ctx.fill()
        }

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
    
    // Request animation frame if playing to handle pulsing animation
    if (isPlaying && selectedDots.size > 0) {
      requestAnimationFrame(() => {
        // Force a re-render for animation
        setCanvasSize(prev => ({ ...prev }));
      });
    }
  }, [selectedDots, gridSize, disabled, isDarkMode, canvasSize, isPlaying, gridDimensions])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    
    const { rows, cols, dotRadius, hGap, vGap } = gridDimensions;
    
    // Find the closest dot to the click point
    let closestDot = { x: 0, y: 0 };
    let closestDistance = Infinity;
    
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const centerX = hGap + (x * (dotRadius * 2 + hGap)) + dotRadius
        const centerY = vGap + (y * (dotRadius * 2 + vGap)) + dotRadius
        
        // Calculate distance to this dot
        const distance = Math.sqrt(
          Math.pow(clickX - centerX, 2) + 
          Math.pow(clickY - centerY, 2)
        )
        
        // Update closest dot if this one is closer
        if (distance < closestDistance) {
          closestDistance = distance;
          closestDot = { x, y };
        }
      }
    }
    
    // Toggle the closest dot
    onDotToggle(closestDot.x, closestDot.y);
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
  const [gridSize, setGridSize] = useState(DEFAULT_ROWS);
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMNS);
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set());
  const [playbackMode, setPlaybackMode] = useState<dotGridAudio.PlaybackMode>(
    dotGridAudio.PlaybackMode.POLYRHYTHM
  );
  
  // Initialize the audio player
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    
    return () => {
      // Clean up audio on unmount
      audioPlayer.setPlaying(false);
    };
  }, []);
  
  // Update audio player when selected dots change
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.updateDots(selectedDots, gridSize, columnCount);
  }, [selectedDots, gridSize, columnCount]);
  
  // Update audio player when playing state changes
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Update audio player when playback mode changes
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.setPlaybackMode(playbackMode);
  }, [playbackMode]);
  
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
  
  const togglePlaybackMode = () => {
    setPlaybackMode(prevMode => 
      prevMode === dotGridAudio.PlaybackMode.POLYRHYTHM
        ? dotGridAudio.PlaybackMode.SEQUENTIAL
        : dotGridAudio.PlaybackMode.POLYRHYTHM
    );
  };
  
  const increaseRows = () => {
    if (gridSize < MAX_ROWS) {
      setGridSize(gridSize + 1);
    }
  };
  
  const decreaseRows = () => {
    if (gridSize > MIN_ROWS) {
      // Clean up any dots outside new grid size
      const newSelectedDots = new Set<string>();
      
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (x < columnCount && y < gridSize - 1) {
          newSelectedDots.add(dot);
        }
      });
      
      setGridSize(gridSize - 1);
      setSelectedDots(newSelectedDots);
    }
  };

  const increaseColumns = () => {
    if (columnCount < MAX_COLUMNS) {
      setColumnCount(columnCount + 1);
    }
  };
  
  const decreaseColumns = () => {
    if (columnCount > MIN_COLUMNS) {
      // Clean up any dots that would be outside the new grid dimensions
      const newSelectedDots = new Set<string>();
      
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (x < columnCount - 1 && y < gridSize) {
          newSelectedDots.add(dot);
        }
      });
      
      setColumnCount(columnCount - 1);
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
          columnCount={columnCount}
          selectedDots={selectedDots}
          onDotToggle={handleDotToggle}
          disabled={disabled}
          isPlaying={isPlaying}
        />
      </div>
      
      <div className="flex flex-col space-y-2">
        {/* Playback mode toggle */}
        <div className="flex items-center justify-between space-x-2">
          <div className="flex flex-col space-y-0.5">
            <span className="text-xs font-medium">Playback Mode:</span>
            <span className="text-xs text-muted-foreground">
              {playbackMode === dotGridAudio.PlaybackMode.POLYRHYTHM 
                ? "Polyrhythm (each dot has its own rhythm)" 
                : "Sequential (one dot at a time, in order)"}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="mode-toggle" className="text-xs">
              {playbackMode === dotGridAudio.PlaybackMode.SEQUENTIAL ? "Sequential" : "Polyrhythm"}
            </Label>
            <Switch
              id="mode-toggle"
              checked={playbackMode === dotGridAudio.PlaybackMode.SEQUENTIAL}
              onCheckedChange={togglePlaybackMode}
              disabled={disabled}
            />
          </div>
        </div>
        
        {/* Grid dimensions display */}
        <span className="text-xs text-muted-foreground text-center">
          Grid Size: {gridSize}×{columnCount}
        </span>
        
        {/* Row controls */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Rows:</span>
          <div className="flex items-center space-x-2">
            <button
              className={`h-7 w-7 rounded flex items-center justify-center border ${
                gridSize <= MIN_ROWS || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={decreaseRows}
              disabled={gridSize <= MIN_ROWS || disabled}
            >
              <span className="text-sm">-</span>
            </button>
            <span className="w-5 text-center text-sm">{gridSize}</span>
            <button
              className={`h-7 w-7 rounded flex items-center justify-center border ${
                gridSize >= MAX_ROWS || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={increaseRows}
              disabled={gridSize >= MAX_ROWS || disabled}
            >
              <span className="text-sm">+</span>
            </button>
          </div>
        </div>
        
        {/* Column controls */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Columns:</span>
          <div className="flex items-center space-x-2">
            <button
              className={`h-7 w-7 rounded flex items-center justify-center border ${
                columnCount <= MIN_COLUMNS || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={decreaseColumns}
              disabled={columnCount <= MIN_COLUMNS || disabled}
            >
              <span className="text-sm">-</span>
            </button>
            <span className="w-5 text-center text-sm">{columnCount}</span>
            <button
              className={`h-7 w-7 rounded flex items-center justify-center border ${
                columnCount >= MAX_COLUMNS || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={increaseColumns}
              disabled={columnCount >= MAX_COLUMNS || disabled}
            >
              <span className="text-sm">+</span>
            </button>
          </div>
        </div>
        
        {/* Clear button */}
        <button
          className={`px-2 h-7 rounded flex items-center justify-center text-xs border ${
            selectedDots.size === 0 || disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-muted'
          }`}
          onClick={clearSelection}
          disabled={selectedDots.size === 0 || disabled}
        >
          Clear Selection
        </button>
      </div>
      
      <div className="text-xs text-center text-muted-foreground">
        Selected: {selectedDots.size} dot{selectedDots.size !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

