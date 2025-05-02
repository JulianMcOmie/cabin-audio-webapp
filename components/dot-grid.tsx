"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"
import * as dotGridAudio from '@/lib/audio/dotGridAudio'
import { usePlayerStore } from "@/lib/stores"
import { DotState } from '@/lib/audio/dotGridAudio'

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
  dotStates: Map<string, 'on' | 'quiet'>; // Use Map for state: "x,y" -> state
  onDotCycleState: (x: number, y: number) => void; // Changed from onDotToggle
  disabled?: boolean;
  isPlaying?: boolean;
  columnCount?: number;
}

// Constants for the grid
const DEFAULT_COLUMNS = 5; // Default number of columns (odd) - CHANGING DEFAULT
const MIN_COLUMNS = 2; // Minimum columns (odd) - CHANGED to 2
const MAX_COLUMNS = 16; // Maximum columns (odd) - CHANGED to 16
const MIN_ROWS = 2; // Minimum rows (odd) - CHANGED to 2
const MAX_ROWS = 16; // Maximum rows (odd) - CHANGED to 16
const BASE_DOT_RADIUS = 6; // Base dot size, will be adjusted as needed

// New DotGrid component with multiple selection support
export function DotGrid({ 
  gridSize,
  dotStates, // Changed from selectedDots
  onDotCycleState, // Changed from onDotToggle
  disabled = false,
  isPlaying = false,
  columnCount = DEFAULT_COLUMNS,
}: MultiSelectionDotGridProps & { columnCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [lastClickedDot, setLastClickedDot] = useState<{x: number, y: number} | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hasMoved, setHasMoved] = useState(false)
  const [clickStartPos, setClickStartPos] = useState<{x: number, y: number} | null>(null)
  
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
        
        // Check the state of this dot
        const dotKey = `${x},${y}`;
        const state = dotStates.get(dotKey); // Get state ('on', 'quiet', or undefined for 'off')
        
        // Draw pulsing animation for playing dots ('on' or 'quiet')
        if (isPlaying && state) { // Pulse if state is 'on' or 'quiet'
          // Draw pulse background
          const pulseSize = 2 + Math.sin(Date.now() / 200) * 0.5
          ctx.beginPath()
          ctx.arc(centerX, centerY, dotRadius * pulseSize, 0, Math.PI * 2)
          // Pulse color depends on state
          if (state === 'on') {
            ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.2)" : "rgba(2, 132, 199, 0.2)" // Blue pulse
          } else { // state === 'quiet'
            ctx.fillStyle = isDarkMode ? "rgba(248, 113, 113, 0.2)" : "rgba(220, 38, 38, 0.2)" // Red pulse
          }
          ctx.fill()
        }

        // Draw dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2)

        if (state && !disabled) {
          if (state === 'on') {
            ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600 (Blue)
          } else { // state === 'quiet'
            ctx.fillStyle = isDarkMode ? "#f87171" : "#dc2626" // red-400 or red-600 (Red)
          }
        } else {
          // Default style for 'off' or disabled dots
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
    
    // Request animation frame if playing to handle pulsing animation for any active dot
    if (isPlaying && dotStates.size > 0) {
      requestAnimationFrame(() => {
        // Force a re-render for animation
        setCanvasSize(prev => ({ ...prev }));
      });
    }
  }, [dotStates, gridSize, disabled, isDarkMode, canvasSize, isPlaying, gridDimensions]) // Updated dependency

  // Track drag events for continuous selection
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return
    
    // Record the start position for later comparison
    setClickStartPos({
      x: e.clientX,
      y: e.clientY
    });
    
    setHasMoved(false); // Reset move tracking
    setIsDragging(true);
    
    // Call handleDotSelection immediately for better responsiveness
    handleDotSelection(e);
  }
  
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || disabled) return
    
    // Check if we've moved enough to consider this a drag
    if (clickStartPos) {
      const deltaX = Math.abs(e.clientX - clickStartPos.x);
      const deltaY = Math.abs(e.clientY - clickStartPos.y);
      
      // If moved more than a few pixels, consider it a drag
      if (deltaX > 3 || deltaY > 3) {
        setHasMoved(true);
      }
    }
    
    // Only process selection during drag if actually moving
    if (hasMoved) { // Removed selectionMode check
      handleDotSelection(e);
    }
  }
  
  const handleCanvasMouseUp = () => {
    setIsDragging(false)
  }
  
  const handleCanvasMouseLeave = () => {
    setIsDragging(false)
  }
  
  // Function to handle dot selection (used by both click and drag)
  const handleDotSelection = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    
    // Save the last clicked dot
    const isSameAsPrevious = lastClickedDot && 
      lastClickedDot.x === closestDot.x && 
      lastClickedDot.y === closestDot.y;
    
    // Only update if:
    // 1. We're doing the initial click and not dragging, OR
    // 2. We're dragging and this is a new dot (different from the last clicked)
    if ((!isDragging || !isSameAsPrevious)) {
      setLastClickedDot(closestDot);
      onDotCycleState(closestDot.x, closestDot.y); // Use onDotCycleState
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full aspect-[4/3] cursor-pointer ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseLeave}
    />
  )
}

// Create a DotCalibration component that wraps DotGrid with state and controls
interface DotCalibrationProps {
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  disabled?: boolean;
  preEQAnalyser?: AnalyserNode | null;
  dotStates?: Map<string, 'on' | 'quiet'>; // Use Map for state
  setDotStates?: React.Dispatch<React.SetStateAction<Map<string, 'on' | 'quiet'>>>; // Use Map for state
}

export function DotCalibration({ 
  isPlaying, 
  setIsPlaying, 
  disabled = false, 
  preEQAnalyser = null,
  dotStates: externalDotStates, // Changed from selectedDots
  setDotStates: externalSetDotStates // Changed from setSelectedDots
}: DotCalibrationProps) {
  // Always use odd numbers for grid dimensions - REMOVING THIS CONSTRAINT
  const [gridSize, setGridSize] = useState(4); // Start with 4 rows (even number)
  const [columnCount, setColumnCount] = useState(4); // Start with 4 columns (even number)
  
  // Use either external or internal state for dot states
  const [internalDotStates, setInternalDotStates] = useState<Map<string, 'on' | 'quiet'>>(new Map()); // Use Map
  
  // Use either external or internal state
  const dotStates = externalDotStates !== undefined ? externalDotStates : internalDotStates;
  const setDotStates = externalSetDotStates !== undefined ? externalSetDotStates : setInternalDotStates;
  
  // Update audio player when dot states change
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.updateDots(dotStates, gridSize, columnCount); // Pass dotStates map
  }, [dotStates, gridSize, columnCount]);
  
  // Direct control of audio player playback state - no fancy logic
  useEffect(() => {
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Connect the pre-EQ analyzer if provided
  useEffect(() => {
    if (preEQAnalyser && isPlaying) {
      const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
      audioPlayer.connectToAnalyser(preEQAnalyser);
      
      return () => {
        audioPlayer.disconnectFromAnalyser();
      };
    }
  }, [preEQAnalyser, isPlaying]);
  
  // Handle arrow key navigation
  useEffect(() => {
    if (disabled || dotStates.size === 0) return; // Check dotStates.size
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if disabled or no dots selected
      if (disabled || dotStates.size === 0) return; // Check dotStates.size
      
      // Only handle arrow keys
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      
      // Parse all active dots (on or quiet)
      const activeDots = Array.from(dotStates.entries()).map(([key, state]) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y, state }; // Keep state info
      });
      
      // Calculate new positions based on arrow key
      let dx = 0, dy = 0;
      switch (e.key) {
        case 'ArrowUp': dy = -1; break;
        case 'ArrowDown': dy = 1; break;
        case 'ArrowLeft': dx = -1; break;
        case 'ArrowRight': dx = 1; break;
      }
      
      // Check if all active dots can move in the desired direction
      const canAllMove = activeDots.every(dot => {
        const newX = dot.x + dx;
        const newY = dot.y + dy;
        return newX >= 0 && newX < columnCount && newY >= 0 && newY < gridSize;
      });
      
      // If all dots can move, update the selection map, preserving state
      if (canAllMove) {
        const newDotStates = new Map<string, 'on' | 'quiet'>();
        activeDots.forEach(dot => {
          const newX = dot.x + dx;
          const newY = dot.y + dy;
          newDotStates.set(`${newX},${newY}`, dot.state); // Preserve state
        });
        
        setDotStates(newDotStates);
        
        // Prevent default behavior (scrolling)
        e.preventDefault();
      }
    };
    
    // Add event listener
    window.addEventListener('keydown', handleKeyDown);
    
    // Clean up
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [disabled, dotStates, setDotStates, columnCount, gridSize]); // Updated dependencies
  
  // Cycle through dot states: off -> on -> quiet -> off
  const handleDotCycleState = (x: number, y: number) => {
    const dotKey = `${x},${y}`;
    const currentState = dotStates.get(dotKey);
    const newDotStates = new Map<string, 'on' | 'quiet'>(dotStates);
    
    // Get music player state
    const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore.getState();
    
    // Determine the next state
    let nextState: DotState;
    if (currentState === 'on') {
      nextState = 'quiet';
    } else if (currentState === 'quiet') {
      nextState = 'off';
    } else { // Current state is 'off' (undefined)
      nextState = 'on';
    }
    
    // Update the map based on the next state
    if (nextState === 'off') {
      newDotStates.delete(dotKey);
    } else {
      newDotStates.set(dotKey, nextState);
    }
    
    setDotStates(newDotStates);
    
    // Auto-start when selecting the first dot (to 'on' state)
    if (newDotStates.size > 0 && !isPlaying) {
      // If music is playing, pause it first
      if (isMusicPlaying) {
        setMusicPlaying(false);
      }
      setIsPlaying(true);
    }
    
    // Auto-stop when deselecting the last dot (to 'off' state)
    if (newDotStates.size === 0 && isPlaying) {
      setIsPlaying(false);
    }
  };
  
  // Modify row adjustment to preserve relative dot positions and states
  const increaseRows = () => {
    if (gridSize < MAX_ROWS) {
      const oldGridSize = gridSize;
      const newGridSize = gridSize + 1; // Add 1 
      
      // Remap dots to preserve relative positions and states
      const newDotStates = new Map<string, 'on' | 'quiet'>();
      dotStates.forEach((state, dotKey) => {
        const [x, y] = dotKey.split(',').map(Number);
        if (x < columnCount) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = y / (oldGridSize - 1);
          // Map to the same relative position in the new grid
          const newY = Math.round(relativePos * (newGridSize - 1));
          newDotStates.set(`${x},${newY}`, state); // Preserve state
        }
      });
      
      setGridSize(newGridSize);
      setDotStates(newDotStates);
    }
  };
  
  const decreaseRows = () => {
    if (gridSize > MIN_ROWS) {
      const oldGridSize = gridSize;
      const newGridSize = gridSize - 1; // Subtract 1
      
      // Remap dots to preserve relative positions and states
      const newDotStates = new Map<string, 'on' | 'quiet'>();
      dotStates.forEach((state, dotKey) => {
        const [x, y] = dotKey.split(',').map(Number);
        if (x < columnCount) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = y / (oldGridSize - 1);
          // Map to the same relative position in the new grid
          const newY = Math.round(relativePos * (newGridSize - 1));
          newDotStates.set(`${x},${newY}`, state); // Preserve state
        }
      });
      
      setGridSize(newGridSize);
      setDotStates(newDotStates);
    }
  };

  // Modify column adjustment to preserve relative dot positions and states
  const increaseColumns = () => {
    if (columnCount < MAX_COLUMNS) {
      const oldColumnCount = columnCount;
      const newColumnCount = columnCount + 1; // Add 1
      
      // Remap dots to preserve relative positions and states
      const newDotStates = new Map<string, 'on' | 'quiet'>();
      dotStates.forEach((state, dotKey) => {
        const [x, y] = dotKey.split(',').map(Number);
        if (y < gridSize) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = x / (oldColumnCount - 1);
          // Map to the same relative position in the new grid
          const newX = Math.round(relativePos * (newColumnCount - 1));
          newDotStates.set(`${newX},${y}`, state); // Preserve state
        }
      });
      
      setColumnCount(newColumnCount);
      setDotStates(newDotStates);
    }
  };
  
  const decreaseColumns = () => {
    if (columnCount > MIN_COLUMNS) {
      const oldColumnCount = columnCount;
      const newColumnCount = columnCount - 1; // Subtract 1
      
      // Remap dots to preserve relative positions and states
      const newDotStates = new Map<string, 'on' | 'quiet'>();
      dotStates.forEach((state, dotKey) => {
        const [x, y] = dotKey.split(',').map(Number);
        if (y < gridSize) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = x / (oldColumnCount - 1);
          // Map to the same relative position in the new grid
          const newX = Math.round(relativePos * (newColumnCount - 1));
          newDotStates.set(`${newX},${y}`, state); // Preserve state
        }
      });
      
      setColumnCount(newColumnCount);
      setDotStates(newDotStates);
    }
  };
  
  // Simple clear selection
  const clearSelection = () => {
    setDotStates(new Map()); // Clear the map
    if (isPlaying) {
      setIsPlaying(false);
    }
  };
  
  return (
    <div className="space-y-3">
      {/* Canvas */}
      <div className="relative bg-background/50 rounded-lg p-2">
        <DotGrid
          gridSize={gridSize}
          columnCount={columnCount}
          dotStates={dotStates} // Pass dotStates
          onDotCycleState={handleDotCycleState} // Pass cycle handler
          disabled={disabled}
          isPlaying={isPlaying}
        />
        
        {/* Instruction text */}
        <div className="mt-2 text-xs text-center text-muted-foreground">
          {dotStates.size === 0 
            ? "Click dots: On (blue) -> Quiet (red) -> Off"
            : "Use arrow keys to move active dots"}
        </div>
      </div>
      
      {/* Controls */}
      <div className="space-y-3">
        {/* Row and Column Controls */}
        <div className="flex justify-between gap-3">
          {/* Row controls */}
          <div className="flex-1 space-y-1">
            <span className="text-xs font-medium">Rows</span>
            <div className="flex items-center space-x-1">
              <button
                className={`h-6 w-6 rounded flex items-center justify-center border ${
                  gridSize <= MIN_ROWS || disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-muted'
                }`}
                onClick={decreaseRows}
                disabled={gridSize <= MIN_ROWS || disabled}
              >
                <span className="text-xs">-</span>
              </button>
              <span className="w-4 text-center text-xs">{gridSize}</span>
              <button
                className={`h-6 w-6 rounded flex items-center justify-center border ${
                  gridSize >= MAX_ROWS || disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-muted'
                }`}
                onClick={increaseRows}
                disabled={gridSize >= MAX_ROWS || disabled}
              >
                <span className="text-xs">+</span>
              </button>
            </div>
          </div>
          
          {/* Column controls */}
          <div className="flex-1 space-y-1">
            <span className="text-xs font-medium">Columns</span>
            <div className="flex items-center space-x-1">
              <button
                className={`h-6 w-6 rounded flex items-center justify-center border ${
                  columnCount <= MIN_COLUMNS || disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-muted'
                }`}
                onClick={decreaseColumns}
                disabled={columnCount <= MIN_COLUMNS || disabled}
              >
                <span className="text-xs">-</span>
              </button>
              <span className="w-4 text-center text-xs">{columnCount}</span>
              <button
                className={`h-6 w-6 rounded flex items-center justify-center border ${
                  columnCount >= MAX_COLUMNS || disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-muted'
                }`}
                onClick={increaseColumns}
                disabled={columnCount >= MAX_COLUMNS || disabled}
              >
                <span className="text-xs">+</span>
              </button>
            </div>
          </div>
        </div>
        
        {/* Clear button */}
        <button
          className={`px-2 py-1 rounded flex items-center justify-center text-xs border ${
            dotStates.size === 0 || disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-muted'
          }`}
          onClick={clearSelection}
          disabled={dotStates.size === 0 || disabled}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

