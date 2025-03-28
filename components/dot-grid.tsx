"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"
import * as dotGridAudio from '@/lib/audio/dotGridAudio'
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Waves } from "lucide-react"
import { Slider } from "@/components/ui/slider"

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
const DEFAULT_COLUMNS = 5; // Default number of columns
const DEFAULT_ROWS = 5; // Changed from 3 to 5 as requested
const MIN_COLUMNS = 2; // Minimum columns
const MAX_COLUMNS = 10; // Maximum columns
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
    // const size = Math.min(canvasSize.width, canvasSize.height);
    
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
  // setIsPlaying: (isPlaying: boolean) => void;
  disabled?: boolean;
}

export function DotCalibration({ isPlaying, disabled = false }: DotCalibrationProps) {
  const [gridSize, setGridSize] = useState(DEFAULT_ROWS);
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMNS);
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set());
  const [playbackMode, setPlaybackMode] = useState<dotGridAudio.PlaybackMode>(
    dotGridAudio.PlaybackMode.POLYRHYTHM
  );
  const [selectMode, setSelectMode] = useState<'row' | 'individual'>('row'); // Selection mode
  
  // Change from fixed Hz offset to scalar multiplier
  const [freqMultiplier, setFreqMultiplier] = useState(1.0); // Default 1.0 (no change)
  const [isSweeping, setIsSweeping] = useState(false); // Default sweep off
  const [sweepDuration] = useState(8); // Default 8 seconds per cycle
  
  // Initialize with all dots selected
  useEffect(() => {
    // Select all dots by default when component mounts
    const allDots = new Set<string>();
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < columnCount; x++) {
        allDots.add(`${x},${y}`);
      }
    }
    setSelectedDots(allDots);
  }, [columnCount, gridSize]);
  
  // Update audio player when grid dimensions change - reselect all dots
  useEffect(() => {
    // Update all dots when dimensions change
    const newSelectedDots = new Set<string>();
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < columnCount; x++) {
        if (selectedDots.has(`${x},${y}`) || selectedDots.size === 0) {
          newSelectedDots.add(`${x},${y}`);
        }
      }
    }
    setSelectedDots(newSelectedDots);
  }, [gridSize]);
  
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
  
  // Update audio player when frequency multiplier changes
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.setFrequencyMultiplier(freqMultiplier);
  }, [freqMultiplier]);
  
  // Update audio player when frequency sweep state changes
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.setSweeping(isSweeping);
  }, [isSweeping]);
  
  // Update audio player when sweep duration changes
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.setSweepDuration(sweepDuration);
  }, [sweepDuration]);
  
  const handleDotToggle = (x: number, y: number) => {
    const newSelectedDots = new Set(selectedDots);
    
    // Different behavior based on selection mode
    if (selectMode === 'row') {
      // Get all dots in the row
      const rowDots = [];
      let rowSelected = true;
      
      // Check if all dots in this row are already selected
      for (let col = 0; col < columnCount; col++) {
        const dotKey = `${col},${y}`;
        rowDots.push(dotKey);
        if (!newSelectedDots.has(dotKey)) {
          rowSelected = false;
        }
      }
      
      // Toggle all dots in the row
      for (const dotKey of rowDots) {
        if (rowSelected) {
          newSelectedDots.delete(dotKey);
        } else {
          newSelectedDots.add(dotKey);
        }
      }
    } else {
      // Individual dot selection mode
      const dotKey = `${x},${y}`;
      if (newSelectedDots.has(dotKey)) {
        newSelectedDots.delete(dotKey);
      } else {
        newSelectedDots.add(dotKey);
      }
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
  
  const toggleSelectionMode = () => {
    setSelectMode(prev => prev === 'row' ? 'individual' : 'row');
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
      // Increment by 1 (no need to maintain odd numbers anymore)
      setColumnCount(columnCount + 1);
    }
  };
  
  const decreaseColumns = () => {
    if (columnCount > MIN_COLUMNS) {
      // Decrement by 1 (no need to maintain odd numbers anymore)
      const newColumnCount = columnCount - 1;
      
      // Clean up any dots that would be outside the new grid dimensions
      const newSelectedDots = new Set<string>();
      
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (x < newColumnCount && y < gridSize) {
          newSelectedDots.add(dot);
        }
      });
      
      setColumnCount(newColumnCount);
      setSelectedDots(newSelectedDots);
    }
  };
  
  const clearSelection = () => {
    setSelectedDots(new Set());
  };
  
  // Update handler function for frequency multiplier slider
  const handleFreqMultiplierChange = (value: number[]) => {
    setFreqMultiplier(value[0]);
  };
  
  // Format multiplier for display
  const formatMultiplier = (multiplier: number) => {
    if (multiplier === 1.0) {
      return "1.0× (no change)";
    } else if (multiplier < 1.0) {
      return `${multiplier.toFixed(2)}× (lower)`;
    } else {
      return `${multiplier.toFixed(2)}× (higher)`;
    }
  };
  
  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Left side: Canvas */}
      <div className="md:w-1/2">
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
        
        {/* Grid info */}
        <div className="text-xs text-center text-muted-foreground mt-2">
          Grid: {gridSize}×{columnCount} • Selected: {selectedDots.size} dot{selectedDots.size !== 1 ? 's' : ''}
        </div>
      </div>
      
      {/* Right side: Controls */}
      <div className="md:w-1/2 space-y-4">
        {/* Frequency Multiplier */}
        <div className="flex flex-col space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Frequency Multiplier</span>
            <span className="text-xs text-muted-foreground">
              {formatMultiplier(freqMultiplier)}
            </span>
          </div>
          <Slider
            disabled={disabled || isSweeping}
            min={0.5}
            max={2.0}
            step={0.01}
            value={[freqMultiplier]}
            onValueChange={handleFreqMultiplierChange}
            className={disabled || isSweeping ? "opacity-70" : ""}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0.5× (lower)</span>
            <span>1.0×</span>
            <span>2.0× (higher)</span>
          </div>
        </div>
        
        {/* Frequency Sweep Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch 
              checked={isSweeping}
              onCheckedChange={setIsSweeping}
              disabled={disabled}
            />
            <Label>Frequency Sweep</Label>
          </div>
          <div className="text-xs text-muted-foreground">
            {isSweeping ? "Auto sweep on" : "Fixed frequency"}
          </div>
        </div>
        
        {/* Playback mode toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch
              checked={playbackMode === dotGridAudio.PlaybackMode.SEQUENTIAL}
              onCheckedChange={togglePlaybackMode}
              disabled={disabled}
            />
            <Label>Sequential Mode</Label>
          </div>
          <div className="text-xs text-muted-foreground">
            {playbackMode === dotGridAudio.PlaybackMode.POLYRHYTHM ? "All dots play" : "One at a time"}
          </div>
        </div>
        
        {/* Selection mode toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch
              checked={selectMode === 'individual'}
              onCheckedChange={toggleSelectionMode}
              disabled={disabled}
            />
            <Label>Individual Selection</Label>
          </div>
          <div className="text-xs text-muted-foreground">
            {selectMode === 'row' ? "Select by row" : "Select individual dots"}
          </div>
        </div>
        
        {/* Row and Column Controls */}
        <div className="flex justify-between gap-4">
          {/* Row controls */}
          <div className="flex-1 space-y-1">
            <span className="text-xs font-medium">Rows</span>
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
          <div className="flex-1 space-y-1">
            <span className="text-xs font-medium">Columns</span>
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
        </div>
        
        {/* Clear button */}
        <button
          className={`px-2 py-1 rounded flex items-center justify-center text-xs border ${
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
    </div>
  );
}

