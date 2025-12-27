"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"
import * as dotGridAudio from '@/lib/audio/dotGridAudio'
import { usePlayerStore } from "@/lib/stores"

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
  selectedDots: Set<string>; // Format: "x,y" string for each dot (kept for backward compatibility)
  onDotToggle: (x: number, y: number) => void;
  disabled?: boolean;
  isPlaying?: boolean;
  selectionMode?: 'single' | 'multiple';
  dotVolumeLevels?: Map<string, number>; // Volume level for each dot (0-3)
}

// Constants for the grid
const DEFAULT_COLUMNS = 5; // Default number of columns (odd)
const MIN_COLUMNS = 3; // Minimum columns (odd)
const MAX_COLUMNS = 15; // Maximum columns (odd)
const MIN_ROWS = 3; // Minimum rows (odd)
const MAX_ROWS = 100; // Maximum rows (odd)
const BASE_DOT_RADIUS = 6; // Base dot size, will be adjusted as needed

// New DotGrid component with multiple selection support
export function DotGrid({
  gridSize,
  selectedDots,
  onDotToggle,
  disabled = false,
  isPlaying = false,
  columnCount = DEFAULT_COLUMNS,
  selectionMode = 'multiple',
  dotVolumeLevels = new Map()
}: MultiSelectionDotGridProps & { columnCount?: number, selectionMode?: 'single' | 'multiple' }) {
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

        const dotKey = `${x},${y}`;
        const volumeLevel = dotVolumeLevels.get(dotKey) ?? 0;

        // Calculate opacity based on volume level
        // Level 0: 0.2, Level 1: 0.4, Level 2: 0.7, Level 3: 1.0
        const volumeOpacity = volumeLevel === 0 ? 0.2 : (0.2 + volumeLevel * 0.27);

        // Draw pulsing animation for playing dots at full volume
        if (isPlaying && volumeLevel === 3) {
          // Draw pulse background
          const pulseSize = 2 + Math.sin(Date.now() / 200) * 0.5
          ctx.beginPath()
          ctx.arc(centerX, centerY, dotRadius * pulseSize, 0, Math.PI * 2)
          ctx.fillStyle = isDarkMode
            ? `rgba(56, 189, 248, ${volumeOpacity * 0.2})`
            : `rgba(2, 132, 199, ${volumeOpacity * 0.2})`
          ctx.fill()
        }

        // Draw dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2)

        if (volumeLevel > 0 && !disabled) {
          // Active dot - color based on volume level
          const baseColor = isDarkMode ? "56, 189, 248" : "2, 132, 199"; // sky-400 or sky-600
          ctx.fillStyle = `rgba(${baseColor}, ${volumeOpacity})`;
        } else {
          // Inactive dot (volume level 0)
          ctx.fillStyle = disabled
            ? isDarkMode
              ? `rgba(39, 39, 42, ${volumeOpacity})` // zinc-800
              : `rgba(226, 232, 240, ${volumeOpacity})` // slate-200
            : isDarkMode
              ? `rgba(82, 82, 91, ${volumeOpacity})` // zinc-600
              : `rgba(203, 213, 225, ${volumeOpacity})` // slate-300
        }

        ctx.fill()
      }
    }
    
    // Request animation frame if playing to handle pulsing animation
    if (isPlaying) {
      requestAnimationFrame(() => {
        // Force a re-render for animation
        setCanvasSize(prev => ({ ...prev }));
      });
    }
  }, [selectedDots, gridSize, disabled, isDarkMode, canvasSize, isPlaying, gridDimensions, dotVolumeLevels])

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
    
    // Only process selection during drag if actually moving AND in multiple selection mode
    if (hasMoved && selectionMode === 'multiple') {
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
      onDotToggle(closestDot.x, closestDot.y);
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
  selectedDots?: Set<string>;
  setSelectedDots?: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function DotCalibration({
  isPlaying,
  setIsPlaying,
  disabled = false,
  preEQAnalyser = null,
  selectedDots: externalSelectedDots,
  setSelectedDots: externalSetSelectedDots
}: DotCalibrationProps) {
  // Refs for auto-movement persistence
  const autoMoveDirectionRef = useRef(1); // Track direction for auto-movement (persists across re-renders)
  const selectedDotsRef = useRef<Set<string>>(new Set());

  // Always use odd numbers for grid dimensions
  const [gridSize, setGridSize] = useState(5); // Start with 5 rows (odd number)
  const [columnCount, setColumnCount] = useState(5); // Start with 5 columns (odd number)

  // Use either external or internal state for selected dots
  const [internalSelectedDots, setInternalSelectedDots] = useState<Set<string>>(new Set()); // Start with no dots selected

  // Volume level state for all dots (0 = off, 1 = -36dB, 2 = -18dB, 3 = 0dB)
  const [dotVolumeLevels, setDotVolumeLevels] = useState<Map<string, number>>(new Map());

  // Sound mode state
  const [soundMode, setSoundMode] = useState<'sloped' | 'bandpassed' | 'sine'>('bandpassed'); // Start with bandpassed noise mode

  // Repeat settings state
  const [repeatCount, setRepeatCount] = useState(4); // Default: 4 hits per dot
  const [dbIncreasePerRepeat, setDbIncreasePerRepeat] = useState(12); // Default: 12 dB increase per hit
  const [baseDb, setBaseDb] = useState(-48); // Default: start at -48 dB
  const [holdCount, setHoldCount] = useState(1); // Default: 1 (play each dot once before moving to next)

  // Hit duration settings
  const [attackDuration, setAttackDuration] = useState(0.05); // Default: 50ms attack - quick fade in for continuous sound
  const [sustainDuration, setSustainDuration] = useState(0.5); // Default: 500ms sustain - fills the dot duration
  const [releaseDuration, setReleaseDuration] = useState(0.05); // Default: 50ms release - quick fade out for continuous sound

  // Speed settings state
  const [speed, setSpeed] = useState(1.0); // Default: 1.0x speed (normal)

  // Bandwidth settings state
  const [bandwidth, setBandwidth] = useState(6.0); // Default: 6.0 octaves
  const [frequencyExtensionRange, setFrequencyExtensionRange] = useState(0); // Default: 0 octaves (no extension, both filters always active)

  // Reading direction state
  const [readingDirection, setReadingDirection] = useState<'horizontal' | 'vertical'>('horizontal'); // Default: horizontal (left-to-right)

  // Position-based volume state
  const [positionVolumeEnabled, setPositionVolumeEnabled] = useState(false); // Default: disabled
  const [positionVolumeAxis, setPositionVolumeAxis] = useState<'horizontal' | 'vertical'>('vertical'); // Default: vertical (up/down)
  const [positionVolumeReversed, setPositionVolumeReversed] = useState(false); // Default: not reversed
  const [positionVolumeMinDb, setPositionVolumeMinDb] = useState(-24); // Default: -24dB minimum

  // Independent rows state
  const [independentRowsEnabled, setIndependentRowsEnabled] = useState(false); // Default: disabled
  const [rowTempoVariance, setRowTempoVariance] = useState(10); // Default: ±10%
  const [rowStartOffset, setRowStartOffset] = useState(200); // Default: 200ms

  // Always playing state
  const [alwaysPlayingEnabled, setAlwaysPlayingEnabled] = useState(false); // Default: disabled (changed from true)
  const [alwaysPlayingSpeed, setAlwaysPlayingSpeed] = useState(1 / 1.5); // Default: 1 cycle per 1.5 seconds (0.667 Hz)
  const [alwaysPlayingStaggerIntensity, setAlwaysPlayingStaggerIntensity] = useState(0); // Default: 0 (no stagger)

  // Loop sequencer mode state
  const [loopSequencerEnabled, setLoopSequencerEnabled] = useState(true); // Default: enabled for cycling through dots
  const [loopDuration, setLoopDuration] = useState(4.0); // Default: 4 seconds (dynamically calculated based on dot count)
  const [loopSequencerPlayTogether, setLoopSequencerPlayTogether] = useState(false); // Default: cycle through dots individually

  // Auto volume cycle state
  const [autoVolumeCycleEnabled, setAutoVolumeCycleEnabled] = useState(false); // Default: disabled
  const [autoVolumeCycleSpeed, setAutoVolumeCycleSpeed] = useState(2.0); // Default: 2 seconds per cycle
  const [autoVolumeCycleMinDb, setAutoVolumeCycleMinDb] = useState(-36); // Default: -36dB (level 1)
  const [autoVolumeCycleMaxDb, setAutoVolumeCycleMaxDb] = useState(0); // Default: 0dB (level 3)
  const [autoVolumeCycleSteps, setAutoVolumeCycleSteps] = useState(3); // Default: 3 steps

  // Stopband mode state (inverse sequential - all dots play except one)
  const [stopbandModeEnabled, setStopbandModeEnabled] = useState(false); // Default: disabled (changed from true)
  const [stopbandIterationTime, setStopbandIterationTime] = useState(500); // Default: 500ms per flash (250ms silence + 250ms gap)
  const [stopbandOffDuration, setStopbandOffDuration] = useState(250); // Default: 250ms off duration
  const [stopbandFlashCount, setStopbandFlashCount] = useState(4); // Default: 4 flashes per dot
  const [stopbandDbReductionPerFlash, setStopbandDbReductionPerFlash] = useState(12); // Default: 12dB reduction per flash
  const [stopbandManualMode, setStopbandManualMode] = useState(false); // Default: auto-cycle mode
  const [stopbandManualIndex, setStopbandManualIndex] = useState(0); // Default: first dot

  // Auto vertical movement state
  const [autoMoveEnabled, setAutoMoveEnabled] = useState(false); // Default: disabled
  const [autoMoveInterval, setAutoMoveInterval] = useState(500); // Default: 500ms per move

  // Use either external or internal state
  const selectedDots = externalSelectedDots !== undefined ? externalSelectedDots : internalSelectedDots;
  const setSelectedDots = externalSetSelectedDots !== undefined ? externalSetSelectedDots : setInternalSelectedDots;

  // Keep selectedDotsRef in sync for auto-movement
  useEffect(() => {
    selectedDotsRef.current = selectedDots;
  }, [selectedDots]);

  // Always use multiple selection mode
  const selectionMode = 'multiple';

  // Initialize audio engine with grid dimensions but no active dots
  useEffect(() => {
    // Clear all volume levels when grid dimensions change
    setDotVolumeLevels(new Map());

    // Tell the audio engine about grid dimensions (but don't activate any dots)
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.updateDots(new Set(), gridSize, columnCount);
  }, [gridSize, columnCount]);

  // Keep the old effect for backward compatibility but do nothing for now
  useEffect(() => {
    // This effect is kept for potential future use
  }, [selectedDots, gridSize, columnCount]);
  
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
    if (disabled || selectedDots.size === 0) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if disabled or no dots selected
      if (disabled || selectedDots.size === 0) return;
      
      // Only handle arrow keys
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      
      // Parse all selected dots
      const parsedDots = Array.from(selectedDots).map(dot => {
        const [x, y] = dot.split(',').map(Number);
        return { x, y };
      });
      
      // Calculate new positions based on arrow key
      let dx = 0, dy = 0;
      switch (e.key) {
        case 'ArrowUp': dy = -1; break;
        case 'ArrowDown': dy = 1; break;
        case 'ArrowLeft': dx = -1; break;
        case 'ArrowRight': dx = 1; break;
      }
      
      // Check if all dots can move in the desired direction
      const canAllMove = parsedDots.every(dot => {
        const newX = dot.x + dx;
        const newY = dot.y + dy;
        return newX >= 0 && newX < columnCount && newY >= 0 && newY < gridSize;
      });
      
      // If all dots can move, update the selection and volume levels
      if (canAllMove) {
        const newSelectedDots = new Set<string>();
        const newVolumeLevels = new Map<string, number>();

        // Move dots and their volume levels
        parsedDots.forEach(dot => {
          const newX = dot.x + dx;
          const newY = dot.y + dy;
          const newKey = `${newX},${newY}`;
          const oldKey = `${dot.x},${dot.y}`;

          newSelectedDots.add(newKey);

          // Transfer volume level to new position
          const volumeLevel = dotVolumeLevels.get(oldKey) ?? 0;
          newVolumeLevels.set(newKey, volumeLevel);
        });

        setSelectedDots(newSelectedDots);
        setDotVolumeLevels(newVolumeLevels);

        // Update audio player with new positions
        const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
        audioPlayer.updateDots(newSelectedDots, gridSize, columnCount);

        // Update volume levels in audio engine
        newVolumeLevels.forEach((level, key) => {
          dotGridAudio.updateDotVolumeLevel(key, level);
        });

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
  }, [disabled, selectedDots, setSelectedDots, columnCount, gridSize, dotVolumeLevels, setDotVolumeLevels]);

  // Modified dot toggle handler to cycle volume levels
  const handleDotToggle = (x: number, y: number) => {
    const dotKey = `${x},${y}`;

    // Get music player state
    const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore.getState();

    // Cycle volume level: 3 -> 2 -> 1 -> 0 -> 3 -> ...
    const currentLevel = dotVolumeLevels.get(dotKey) ?? 0;
    const nextLevel = currentLevel === 0 ? 3 : currentLevel - 1;

    // Update volume level
    const newVolumeLevels = new Map(dotVolumeLevels);
    newVolumeLevels.set(dotKey, nextLevel);
    setDotVolumeLevels(newVolumeLevels);

    // Get all active dots (volume > 0)
    const activeDots = new Set<string>();
    newVolumeLevels.forEach((level, key) => {
      if (level > 0) {
        activeDots.add(key);
      }
    });

    // Update selectedDots to match active dots (for arrow key navigation)
    setSelectedDots(activeDots);

    // Update audio player with active dots
    const audioPlayer = dotGridAudio.getDotGridAudioPlayer();
    audioPlayer.updateDots(activeDots, gridSize, columnCount);

    // Update volume level for this dot
    dotGridAudio.updateDotVolumeLevel(dotKey, nextLevel);

    // Auto-start playback on first interaction
    if (!isPlaying) {
      // If music is playing, pause it first
      if (isMusicPlaying) {
        setMusicPlaying(false);
      }
      setIsPlaying(true);
    }
  };
  
  // Modify row adjustment to preserve relative dot positions
  const increaseRows = () => {
    if (gridSize < MAX_ROWS) {
      const oldGridSize = gridSize;
      const newGridSize = gridSize + 1; // Changed from +2 to +1
      
      // Remap dots to preserve relative positions
      const newSelectedDots = new Set<string>();
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (x < columnCount) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = y / (oldGridSize - 1);
          // Map to the same relative position in the new grid
          const newY = Math.round(relativePos * (newGridSize - 1));
          newSelectedDots.add(`${x},${newY}`);
        }
      });
      
      setGridSize(newGridSize);
      setSelectedDots(newSelectedDots);
    }
  };
  
  const decreaseRows = () => {
    if (gridSize > MIN_ROWS) {
      const oldGridSize = gridSize;
      const newGridSize = gridSize - 1; // Changed from -2 to -1
      
      // Remap dots to preserve relative positions
      const newSelectedDots = new Set<string>();
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (x < columnCount) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = y / (oldGridSize - 1);
          // Map to the same relative position in the new grid
          const newY = Math.round(relativePos * (newGridSize - 1));
          newSelectedDots.add(`${x},${newY}`);
        }
      });
      
      setGridSize(newGridSize);
      setSelectedDots(newSelectedDots);
    }
  };

  // Modify column adjustment to preserve relative dot positions
  const increaseColumns = () => {
    if (columnCount < MAX_COLUMNS) {
      const oldColumnCount = columnCount;
      const newColumnCount = columnCount + 1; // Changed from +2 to +1
      
      // Remap dots to preserve relative positions
      const newSelectedDots = new Set<string>();
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (y < gridSize) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = x / (oldColumnCount - 1);
          // Map to the same relative position in the new grid
          const newX = Math.round(relativePos * (newColumnCount - 1));
          newSelectedDots.add(`${newX},${y}`);
        }
      });
      
      setColumnCount(newColumnCount);
      setSelectedDots(newSelectedDots);
    }
  };
  
  const decreaseColumns = () => {
    if (columnCount > MIN_COLUMNS) {
      const oldColumnCount = columnCount;
      const newColumnCount = columnCount - 1; // Changed from -2 to -1
      
      // Remap dots to preserve relative positions
      const newSelectedDots = new Set<string>();
      selectedDots.forEach(dot => {
        const [x, y] = dot.split(',').map(Number);
        if (y < gridSize) {
          // Calculate the relative position in the old grid (0-1)
          const relativePos = x / (oldColumnCount - 1);
          // Map to the same relative position in the new grid
          const newX = Math.round(relativePos * (newColumnCount - 1));
          newSelectedDots.add(`${newX},${y}`);
        }
      });
      
      setColumnCount(newColumnCount);
      setSelectedDots(newSelectedDots);
    }
  };
  
  // Simple clear selection
  const clearSelection = () => {
    setSelectedDots(new Set());
    if (isPlaying) {
      setIsPlaying(false);
    }
  };
  
  // Handle sound mode cycling
  const cycleSoundMode = () => {
    const modes: Array<'sloped' | 'bandpassed' | 'sine'> = ['sloped', 'bandpassed', 'sine'];
    const currentIndex = modes.indexOf(soundMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setSoundMode(nextMode);
    
    // Map to audio engine calls using the new API
    const { SoundMode } = dotGridAudio;
    if (nextMode === 'sloped') {
      dotGridAudio.setSoundMode(SoundMode.SlopedNoise);
    } else if (nextMode === 'bandpassed') {
      dotGridAudio.setSoundMode(SoundMode.BandpassedNoise);
    } else if (nextMode === 'sine') {
      dotGridAudio.setSoundMode(SoundMode.SineTone);
    }
  };
  
  // Sync initial sound mode with audio player
  useEffect(() => {
    const { SoundMode } = dotGridAudio;
    const currentMode = dotGridAudio.getSoundMode();
    if (currentMode === SoundMode.SlopedNoise) {
      setSoundMode('sloped');
    } else if (currentMode === SoundMode.BandpassedNoise) {
      setSoundMode('bandpassed');
    } else if (currentMode === SoundMode.SineTone) {
      setSoundMode('sine');
    }
  }, []);

  // Update audio engine when repeat settings change
  useEffect(() => {
    dotGridAudio.setRepeatCount(repeatCount);
  }, [repeatCount]);

  useEffect(() => {
    dotGridAudio.setDbIncreasePerRepeat(dbIncreasePerRepeat);
  }, [dbIncreasePerRepeat]);

  useEffect(() => {
    dotGridAudio.setBaseDb(baseDb);
  }, [baseDb]);

  useEffect(() => {
    dotGridAudio.setHoldCount(holdCount);
  }, [holdCount]);

  // Update audio engine when hit duration settings change
  useEffect(() => {
    dotGridAudio.setAttackDuration(attackDuration);
  }, [attackDuration]);

  useEffect(() => {
    dotGridAudio.setSustainDuration(sustainDuration);
  }, [sustainDuration]);

  useEffect(() => {
    dotGridAudio.setReleaseDuration(releaseDuration);
  }, [releaseDuration]);

  // Update audio engine when speed changes
  useEffect(() => {
    dotGridAudio.setSpeed(speed);
  }, [speed]);

  // Update audio engine when bandwidth changes
  useEffect(() => {
    dotGridAudio.setBandpassBandwidth(bandwidth);
  }, [bandwidth]);

  // Update audio engine when frequency extension range changes
  useEffect(() => {
    dotGridAudio.setFrequencyExtensionRange(frequencyExtensionRange);
  }, [frequencyExtensionRange]);

  // Update audio engine when reading direction changes
  useEffect(() => {
    dotGridAudio.setReadingDirection(readingDirection);
  }, [readingDirection]);

  // Update audio engine when position volume settings change
  useEffect(() => {
    dotGridAudio.setPositionVolumeEnabled(positionVolumeEnabled);
  }, [positionVolumeEnabled]);

  useEffect(() => {
    dotGridAudio.setPositionVolumeAxis(positionVolumeAxis);
  }, [positionVolumeAxis]);

  useEffect(() => {
    dotGridAudio.setPositionVolumeReversed(positionVolumeReversed);
  }, [positionVolumeReversed]);

  useEffect(() => {
    dotGridAudio.setPositionVolumeMinDb(positionVolumeMinDb);
  }, [positionVolumeMinDb]);

  // Update audio engine when independent rows settings change
  useEffect(() => {
    dotGridAudio.setIndependentRowsEnabled(independentRowsEnabled);
  }, [independentRowsEnabled]);

  useEffect(() => {
    dotGridAudio.setRowTempoVariance(rowTempoVariance);
  }, [rowTempoVariance]);

  useEffect(() => {
    dotGridAudio.setRowStartOffset(rowStartOffset);
  }, [rowStartOffset]);

  // Update audio engine when always playing settings change
  useEffect(() => {
    dotGridAudio.setAlwaysPlayingEnabled(alwaysPlayingEnabled);
  }, [alwaysPlayingEnabled]);

  useEffect(() => {
    dotGridAudio.setAlwaysPlayingSpeed(alwaysPlayingSpeed);
  }, [alwaysPlayingSpeed]);

  useEffect(() => {
    dotGridAudio.setAlwaysPlayingStaggerIntensity(alwaysPlayingStaggerIntensity);
  }, [alwaysPlayingStaggerIntensity]);

  // Update audio engine when stopband mode settings change
  useEffect(() => {
    dotGridAudio.setStopbandModeEnabled(stopbandModeEnabled);
  }, [stopbandModeEnabled]);

  useEffect(() => {
    dotGridAudio.setStopbandIterationTime(stopbandIterationTime);
  }, [stopbandIterationTime]);

  useEffect(() => {
    dotGridAudio.setStopbandOffDuration(stopbandOffDuration);
  }, [stopbandOffDuration]);

  useEffect(() => {
    dotGridAudio.setStopbandFlashCount(stopbandFlashCount);
  }, [stopbandFlashCount]);

  useEffect(() => {
    dotGridAudio.setStopbandDbReductionPerFlash(stopbandDbReductionPerFlash);
  }, [stopbandDbReductionPerFlash]);

  useEffect(() => {
    dotGridAudio.setStopbandManualMode(stopbandManualMode);
  }, [stopbandManualMode]);

  useEffect(() => {
    dotGridAudio.setStopbandManualIndex(stopbandManualIndex);
  }, [stopbandManualIndex]);

  // Update audio engine when auto volume cycle settings change
  useEffect(() => {
    dotGridAudio.setAutoVolumeCycleEnabled(autoVolumeCycleEnabled);
  }, [autoVolumeCycleEnabled]);

  useEffect(() => {
    dotGridAudio.setAutoVolumeCycleSpeed(autoVolumeCycleSpeed);
  }, [autoVolumeCycleSpeed]);

  useEffect(() => {
    dotGridAudio.setAutoVolumeCycleMinDb(autoVolumeCycleMinDb);
  }, [autoVolumeCycleMinDb]);

  useEffect(() => {
    dotGridAudio.setAutoVolumeCycleMaxDb(autoVolumeCycleMaxDb);
  }, [autoVolumeCycleMaxDb]);

  useEffect(() => {
    dotGridAudio.setAutoVolumeCycleSteps(autoVolumeCycleSteps);
  }, [autoVolumeCycleSteps]);

  // Update audio engine when loop sequencer settings change
  useEffect(() => {
    dotGridAudio.setLoopSequencerEnabled(loopSequencerEnabled);
  }, [loopSequencerEnabled]);

  useEffect(() => {
    dotGridAudio.setLoopDuration(loopDuration);
  }, [loopDuration]);

  useEffect(() => {
    dotGridAudio.setLoopSequencerPlayTogether(loopSequencerPlayTogether);
  }, [loopSequencerPlayTogether]);

  // Automatically calculate loop duration based on number of active dots (1.5 seconds per dot: 500ms quiet + 500ms medium + 500ms loud)
  useEffect(() => {
    // Count active dots (volume level > 0)
    let activeDotCount = 0;
    dotVolumeLevels.forEach((level) => {
      if (level > 0) activeDotCount++;
    });

    // Calculate loop duration based on mode
    if (activeDotCount > 0) {
      if (loopSequencerPlayTogether) {
        // Play together mode: fixed 1.5 seconds for all dots to cycle through volumes
        setLoopDuration(1.5);
      } else {
        // Cycle through dots mode: 1.5 seconds per dot
        const calculatedDuration = activeDotCount * 1.5; // 1.5 seconds = 1500ms per dot
        setLoopDuration(calculatedDuration);
      }
    }
  }, [dotVolumeLevels, loopSequencerPlayTogether]); // Recalculate whenever dot volume levels or mode changes

  // Handlers for repeat settings
  const increaseRepeatCount = () => {
    if (repeatCount < 10) {
      setRepeatCount(repeatCount + 1);
    }
  };

  const decreaseRepeatCount = () => {
    if (repeatCount > 1) {
      setRepeatCount(repeatCount - 1);
    }
  };

  const handleDbIncreaseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDbIncreasePerRepeat(Number(e.target.value));
  };

  const handleBaseDbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBaseDb(Number(e.target.value));
  };

  const handleAttackDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttackDuration(Number(e.target.value));
  };

  const handleSustainDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSustainDuration(Number(e.target.value));
  };

  const handleReleaseDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReleaseDuration(Number(e.target.value));
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSpeed(Number(e.target.value));
  };

  const handleBandwidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBandwidth(Number(e.target.value));
  };

  const handleFrequencyExtensionRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFrequencyExtensionRange(Number(e.target.value));
  };

  const toggleReadingDirection = () => {
    setReadingDirection(prev => prev === 'horizontal' ? 'vertical' : 'horizontal');
  };

  // Handle automatic vertical movement
  useEffect(() => {
    // Only run when playing, enabled, and dots are selected
    if (!isPlaying || !autoMoveEnabled || selectedDotsRef.current.size === 0 || disabled) {
      return;
    }

    // Reset direction when starting
    autoMoveDirectionRef.current = 1;

    const intervalId = window.setInterval(() => {
      // Parse current selected dots
      const parsedDots = Array.from(selectedDotsRef.current).map(dot => {
        const [x, y] = dot.split(',').map(Number);
        return { x, y };
      });

      // Calculate new positions
      const dy = autoMoveDirectionRef.current;

      // Check if all dots can move in the current direction
      const canMove = parsedDots.every(dot => {
        const newY = dot.y + dy;
        return newY >= 0 && newY < gridSize;
      });

      if (canMove) {
        // Move the dots
        const newSelectedDots = new Set<string>();
        parsedDots.forEach(dot => {
          const newY = dot.y + dy;
          newSelectedDots.add(`${dot.x},${newY}`);
        });
        setSelectedDots(newSelectedDots);
      } else {
        // Hit a boundary - reverse direction immediately
        autoMoveDirectionRef.current = -autoMoveDirectionRef.current;
      }
    }, autoMoveInterval);

    // Cleanup interval on unmount or when dependencies change
    return () => {
      clearInterval(intervalId);
    };
  }, [isPlaying, autoMoveEnabled, gridSize, autoMoveInterval, disabled, setSelectedDots]);

  return (
    <div className="space-y-3">
      {/* Canvas */}
      <div className="relative bg-background/50 rounded-lg p-2">
        <DotGrid
          gridSize={gridSize}
          columnCount={columnCount}
          selectedDots={selectedDots}
          onDotToggle={handleDotToggle}
          disabled={disabled}
          isPlaying={isPlaying}
          selectionMode={selectionMode}
          dotVolumeLevels={dotVolumeLevels}
        />
        
        {/* Instruction text */}
        <div className="mt-2 text-xs text-center text-muted-foreground">
          Click dots to cycle volume levels (3 levels, 18dB apart)
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
        
        {/* Sound Mode Selector */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Sound Mode</span>
          <button
            className={`px-3 py-1 rounded text-xs border ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-muted'
            }`}
            onClick={cycleSoundMode}
            disabled={disabled}
          >
            {soundMode === 'sloped' ? 'Sloped' :
             soundMode === 'bandpassed' ? 'Bandpassed' : 'Sine Tone'}
          </button>
        </div>

        {/* Reading Direction Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Reading</span>
          <button
            className={`px-3 py-1 rounded text-xs border ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-muted'
            }`}
            onClick={toggleReadingDirection}
            disabled={disabled}
          >
            {readingDirection === 'horizontal' ? 'Horizontal →' : 'Vertical ↓'}
          </button>
        </div>

        {/* Auto Volume Cycle Toggle */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Auto Volume Cycle</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoVolumeCycleEnabled}
                onChange={(e) => setAutoVolumeCycleEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {autoVolumeCycleEnabled && (
            <>
              {/* Cycle Speed Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Cycle Time</span>
                  <span className="text-xs text-muted-foreground">{autoVolumeCycleSpeed.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.1"
                  value={autoVolumeCycleSpeed}
                  onChange={(e) => setAutoVolumeCycleSpeed(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Min Volume Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Min Volume</span>
                  <span className="text-xs text-muted-foreground">{autoVolumeCycleMinDb} dB</span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="0"
                  step="6"
                  value={autoVolumeCycleMinDb}
                  onChange={(e) => setAutoVolumeCycleMinDb(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Max Volume Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Max Volume</span>
                  <span className="text-xs text-muted-foreground">{autoVolumeCycleMaxDb} dB</span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="0"
                  step="6"
                  value={autoVolumeCycleMaxDb}
                  onChange={(e) => setAutoVolumeCycleMaxDb(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Number of Steps Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Steps</span>
                  <span className="text-xs text-muted-foreground">{autoVolumeCycleSteps}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="10"
                  step="1"
                  value={autoVolumeCycleSteps}
                  onChange={(e) => setAutoVolumeCycleSteps(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>
            </>
          )}
        </div>

        {/* Loop Sequencer Mode Toggle */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Loop Sequencer</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={loopSequencerEnabled}
                onChange={(e) => setLoopSequencerEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {loopSequencerEnabled && (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Loop Time</span>
                  <span className="text-xs text-muted-foreground">{loopDuration.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="60"
                  step="0.1"
                  value={loopDuration}
                  onChange={(e) => setLoopDuration(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Play Together Toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Play Together</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={loopSequencerPlayTogether}
                    onChange={(e) => setLoopSequencerPlayTogether(e.target.checked)}
                    disabled={disabled}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Hold Count Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Hold Count</span>
            <span className="text-xs text-muted-foreground">{holdCount}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={holdCount}
            onChange={(e) => setHoldCount(Number(e.target.value))}
            disabled={disabled}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Repeat Count Control - renamed to "Hits" */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Hits per Dot</span>
          <div className="flex items-center space-x-1">
            <button
              className={`h-6 w-6 rounded flex items-center justify-center border ${
                repeatCount <= 1 || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={decreaseRepeatCount}
              disabled={repeatCount <= 1 || disabled}
            >
              <span className="text-xs">-</span>
            </button>
            <span className="w-4 text-center text-xs">{repeatCount}</span>
            <button
              className={`h-6 w-6 rounded flex items-center justify-center border ${
                repeatCount >= 10 || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={increaseRepeatCount}
              disabled={repeatCount >= 10 || disabled}
            >
              <span className="text-xs">+</span>
            </button>
          </div>
        </div>

        {/* Starting Volume Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Start Volume</span>
            <span className="text-xs text-muted-foreground">{baseDb} dB</span>
          </div>
          <input
            type="range"
            min="-60"
            max="0"
            step="1"
            value={baseDb}
            onChange={handleBaseDbChange}
            disabled={disabled}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* dB Increase per Hit Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Volume Increase</span>
            <span className="text-xs text-muted-foreground">{dbIncreasePerRepeat} dB</span>
          </div>
          <input
            type="range"
            min="0"
            max="24"
            step="1"
            value={dbIncreasePerRepeat}
            onChange={handleDbIncreaseChange}
            disabled={disabled || repeatCount === 1}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled || repeatCount === 1
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Attack Duration Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Attack</span>
            <span className="text-xs text-muted-foreground">{(attackDuration * 1000).toFixed(0)}ms</span>
          </div>
          <input
            type="range"
            min="0.001"
            max="0.5"
            step="0.001"
            value={attackDuration}
            onChange={handleAttackDurationChange}
            disabled={disabled}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Sustain Duration Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Sustain</span>
            <span className="text-xs text-muted-foreground">{(sustainDuration * 1000).toFixed(0)}ms</span>
          </div>
          <input
            type="range"
            min="0.001"
            max="2.0"
            step="0.001"
            value={sustainDuration}
            onChange={handleSustainDurationChange}
            disabled={disabled}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Release Duration Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Release</span>
            <span className="text-xs text-muted-foreground">{(releaseDuration * 1000).toFixed(0)}ms</span>
          </div>
          <input
            type="range"
            min="0.001"
            max="0.5"
            step="0.001"
            value={releaseDuration}
            onChange={handleReleaseDurationChange}
            disabled={disabled}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Speed Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Speed</span>
            <span className="text-xs text-muted-foreground">{speed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.1"
            value={speed}
            onChange={handleSpeedChange}
            disabled={disabled}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Bandwidth Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Bandwidth</span>
            <span className="text-xs text-muted-foreground">{bandwidth.toFixed(1)} oct</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="10.0"
            step="0.1"
            value={bandwidth}
            onChange={handleBandwidthChange}
            disabled={disabled || soundMode !== 'bandpassed'}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled || soundMode !== 'bandpassed'
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Frequency Extension Range Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Freq Extension</span>
            <span className="text-xs text-muted-foreground">{frequencyExtensionRange.toFixed(1)} oct</span>
          </div>
          <input
            type="range"
            min="0"
            max="5"
            step="0.5"
            value={frequencyExtensionRange}
            onChange={handleFrequencyExtensionRangeChange}
            disabled={disabled || soundMode !== 'bandpassed'}
            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
              disabled || soundMode !== 'bandpassed'
                ? 'opacity-50 cursor-not-allowed'
                : ''
            } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
          />
        </div>

        {/* Position-Based Volume Controls */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Position Volume</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={positionVolumeEnabled}
                onChange={(e) => setPositionVolumeEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {positionVolumeEnabled && (
            <>
              {/* Axis Selector */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Direction</span>
                <button
                  className={`px-3 py-1 rounded text-xs border ${
                    disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => setPositionVolumeAxis(prev => prev === 'vertical' ? 'horizontal' : 'vertical')}
                  disabled={disabled}
                >
                  {positionVolumeAxis === 'vertical' ? 'Up ↑ / Down ↓' : 'Left ← / Right →'}
                </button>
              </div>

              {/* Reverse Toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Reverse</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={positionVolumeReversed}
                    onChange={(e) => setPositionVolumeReversed(e.target.checked)}
                    disabled={disabled}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>

              {/* Minimum Volume Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Min Volume</span>
                  <span className="text-xs text-muted-foreground">{positionVolumeMinDb} dB</span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="0"
                  step="1"
                  value={positionVolumeMinDb}
                  onChange={(e) => setPositionVolumeMinDb(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>
            </>
          )}
        </div>

        {/* Always Playing Mode Controls */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Always Playing</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={alwaysPlayingEnabled}
                onChange={(e) => setAlwaysPlayingEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {alwaysPlayingEnabled && (
            <>
              {/* Speed Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Oscillation Speed</span>
                  <span className="text-xs text-muted-foreground">{(1 / alwaysPlayingSpeed).toFixed(2)}s/cycle</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="2.0"
                  step="0.05"
                  value={alwaysPlayingSpeed}
                  onChange={(e) => setAlwaysPlayingSpeed(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Stagger Intensity Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Stagger</span>
                  <span className="text-xs text-muted-foreground">{(alwaysPlayingStaggerIntensity * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={alwaysPlayingStaggerIntensity}
                  onChange={(e) => setAlwaysPlayingStaggerIntensity(Number(e.target.value))}
                  disabled={disabled || stopbandModeEnabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled || stopbandModeEnabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Stopband Mode Toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Stopband Mode</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stopbandModeEnabled}
                    onChange={(e) => setStopbandModeEnabled(e.target.checked)}
                    disabled={disabled}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>

              {stopbandModeEnabled && (
                <>
                  {/* Stopband Flash Count Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Flashes per Dot</span>
                      <span className="text-xs text-muted-foreground">{stopbandFlashCount}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={stopbandFlashCount}
                      onChange={(e) => setStopbandFlashCount(Number(e.target.value))}
                      disabled={disabled}
                      className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                        disabled ? 'opacity-50 cursor-not-allowed' : ''
                      } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                    />
                  </div>

                  {/* Stopband Iteration Time Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Flash Interval</span>
                      <span className="text-xs text-muted-foreground">{stopbandIterationTime}ms</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={stopbandIterationTime}
                      onChange={(e) => setStopbandIterationTime(Number(e.target.value))}
                      disabled={disabled}
                      className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                        disabled ? 'opacity-50 cursor-not-allowed' : ''
                      } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                    />
                  </div>

                  {/* Stopband Off Duration Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Off Duration</span>
                      <span className="text-xs text-muted-foreground">{stopbandOffDuration}ms</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="1500"
                      step="50"
                      value={stopbandOffDuration}
                      onChange={(e) => setStopbandOffDuration(Number(e.target.value))}
                      disabled={disabled}
                      className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                        disabled ? 'opacity-50 cursor-not-allowed' : ''
                      } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                    />
                  </div>

                  {/* Stopband dB Reduction per Flash Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Volume Drop</span>
                      <span className="text-xs text-muted-foreground">{stopbandDbReductionPerFlash} dB</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="24"
                      step="1"
                      value={stopbandDbReductionPerFlash}
                      onChange={(e) => setStopbandDbReductionPerFlash(Number(e.target.value))}
                      disabled={disabled}
                      className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                        disabled ? 'opacity-50 cursor-not-allowed' : ''
                      } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                    />
                  </div>

                  {/* Stopband Manual Mode Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Manual Dot Select</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stopbandManualMode}
                        onChange={(e) => setStopbandManualMode(e.target.checked)}
                        disabled={disabled}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                    </label>
                  </div>

                  {stopbandManualMode && (
                    <>
                      {/* Stopband Manual Index Slider */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">Flash Dot</span>
                          <span className="text-xs text-muted-foreground">{stopbandManualIndex + 1} of {selectedDots.size}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(0, selectedDots.size - 1)}
                          step="1"
                          value={stopbandManualIndex}
                          onChange={(e) => setStopbandManualIndex(Number(e.target.value))}
                          disabled={disabled || selectedDots.size === 0}
                          className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                            disabled || selectedDots.size === 0 ? 'opacity-50 cursor-not-allowed' : ''
                          } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Auto-Vertical Movement Controls */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Auto Vertical Move</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoMoveEnabled}
                onChange={(e) => setAutoMoveEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {autoMoveEnabled && (
            <>
              {/* Move Interval Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Move Interval</span>
                  <span className="text-xs text-muted-foreground">{autoMoveInterval}ms</span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="2000"
                  step="50"
                  value={autoMoveInterval}
                  onChange={(e) => setAutoMoveInterval(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>
            </>
          )}
        </div>

        {/* Independent Rows Mode Controls */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Independent Rows</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={independentRowsEnabled}
                onChange={(e) => setIndependentRowsEnabled(e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {independentRowsEnabled && (
            <>
              {/* Tempo Variance Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Tempo Variance</span>
                  <span className="text-xs text-muted-foreground">±{rowTempoVariance}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="20"
                  step="1"
                  value={rowTempoVariance}
                  onChange={(e) => setRowTempoVariance(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Row Start Offset Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Row Offset</span>
                  <span className="text-xs text-muted-foreground">{rowStartOffset}ms</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="50"
                  value={rowStartOffset}
                  onChange={(e) => setRowStartOffset(Number(e.target.value))}
                  disabled={disabled}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary`}
                />
              </div>

              {/* Regenerate Tempos Button */}
              <button
                className={`w-full px-2 py-1 rounded flex items-center justify-center text-xs border ${
                  disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'
                }`}
                onClick={() => dotGridAudio.regenerateRowTempos()}
                disabled={disabled}
              >
                Regenerate Tempos
              </button>
            </>
          )}
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
          Clear
        </button>
      </div>
    </div>
  );
}

