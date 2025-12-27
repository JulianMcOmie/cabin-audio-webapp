"use client"

import type React from "react"
import { useRef, useEffect, useState, useMemo } from "react"
import { rotatingDotGridPlayer, SoundMode } from '@/lib/audio/rotatingDotGridAudio'
import { usePlayerStore } from "@/lib/stores"
import * as audioContext from '@/lib/audio/audioContext'

const DEFAULT_COLUMNS = 5;
const BASE_DOT_RADIUS = 10;

interface RotatingDotGridProps {
  externalSelectedDots?: Set<string>;
  externalSetSelectedDots?: (dots: Set<string>) => void;
  disabled?: boolean;
}

export function RotatingDotGrid({
  externalSelectedDots,
  externalSetSelectedDots,
  disabled = false
}: RotatingDotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Grid state
  const [gridSize, setGridSize] = useState(5); // rows (always odd)
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMNS); // columns (always odd)

  // Selection state (for rotation)
  const [internalSelectedDots, setInternalSelectedDots] = useState<Set<string>>(new Set());
  const selectedDots = externalSelectedDots !== undefined ? externalSelectedDots : internalSelectedDots;
  const setSelectedDots = externalSetSelectedDots !== undefined ? externalSetSelectedDots : setInternalSelectedDots;

  // Volume level state for all dots (0 = off, 1 = -36dB, 2 = -18dB, 3 = 0dB)
  const [dotVolumeLevels, setDotVolumeLevels] = useState<Map<string, number>>(new Map());

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);

  // Sound mode state
  const [soundMode, setSoundMode] = useState<SoundMode>(SoundMode.BandpassedNoise);
  const [volume, setVolume] = useState(-12); // dB

  // Rotation state
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [rotationSpeed, setRotationSpeed] = useState(10); // RPM
  const [rotationAxis, setRotationAxis] = useState<'XY' | 'XZ' | 'YZ'>('XY');
  const [pivotDotKey, setPivotDotKey] = useState<string | null>(null);
  const [rotationAngle, setRotationAngle] = useState(0); // radians

  // Virtual positions (rotated coordinates)
  const [virtualPositions, setVirtualPositions] = useState<Map<string, { x: number, y: number, z: number }>>(new Map());

  // Animation frame ref
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [clickStartPos, setClickStartPos] = useState<{x: number, y: number} | null>(null);

  // Dark mode detection
  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          setIsDarkMode(document.documentElement.classList.contains("dark"));
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Canvas size tracking
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  // Initialize all dots when grid size changes
  useEffect(() => {
    const allDots = new Set<string>();
    const newVolumeLevels = new Map<string, number>();

    // Create volume levels for all grid positions
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < columnCount; x++) {
        const dotKey = `${x},${y}`;
        allDots.add(dotKey);
        // Preserve existing volume level or initialize at full volume
        const existingLevel = dotVolumeLevels.get(dotKey);
        newVolumeLevels.set(dotKey, existingLevel ?? 3);
      }
    }

    // Only update if the volume levels have changed
    const hasChanged = newVolumeLevels.size !== dotVolumeLevels.size ||
      Array.from(newVolumeLevels.entries()).some(([key, val]) => dotVolumeLevels.get(key) !== val);

    if (hasChanged) {
      setDotVolumeLevels(newVolumeLevels);
    }

    // Update audio player with all dots
    rotatingDotGridPlayer.updateDots(allDots, gridSize, columnCount);

    // Update volume levels for all dots
    newVolumeLevels.forEach((level, dotKey) => {
      rotatingDotGridPlayer.updateDotVolumeLevel(dotKey, level);
    });
  }, [gridSize, columnCount, dotVolumeLevels]);

  // Update audio player when selected dots change (for rotation)
  useEffect(() => {
    // This is only used for rotation calculations
  }, [selectedDots, gridSize, columnCount]);

  // Auto-select first dot as pivot when selection changes
  useEffect(() => {
    if (selectedDots.size > 0 && (!pivotDotKey || !selectedDots.has(pivotDotKey))) {
      const firstDot = Array.from(selectedDots)[0];
      setPivotDotKey(firstDot);
    } else if (selectedDots.size === 0) {
      setPivotDotKey(null);
    }
  }, [selectedDots, pivotDotKey]);

  // Initialize virtual positions when selection changes
  useEffect(() => {
    const newVirtualPositions = new Map<string, { x: number, y: number, z: number }>();
    selectedDots.forEach(dotKey => {
      const [xStr, yStr] = dotKey.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      newVirtualPositions.set(dotKey, { x, y, z: 0 });
    });
    setVirtualPositions(newVirtualPositions);
  }, [selectedDots]);

  // Rotation mathematics
  const rotateDots = (angle: number, axis: 'XY' | 'XZ' | 'YZ'): Map<string, { x: number, y: number, z: number }> => {
    if (!pivotDotKey || !selectedDots.has(pivotDotKey)) {
      return virtualPositions;
    }

    const [pivotXStr, pivotYStr] = pivotDotKey.split(',');
    const pivotX = parseInt(pivotXStr, 10);
    const pivotY = parseInt(pivotYStr, 10);

    const rotated = new Map<string, { x: number, y: number, z: number }>();

    selectedDots.forEach(dotKey => {
      const [xStr, yStr] = dotKey.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);

      // Translate to origin (relative to pivot)
      const relX = x - pivotX;
      const relY = y - pivotY;
      const relZ = 0;

      let newX, newY, newZ;

      switch (axis) {
        case 'XY':
          // Rotation around Z-axis
          newX = relX * Math.cos(angle) - relY * Math.sin(angle);
          newY = relX * Math.sin(angle) + relY * Math.cos(angle);
          newZ = relZ;
          break;

        case 'XZ':
          // Rotation around Y-axis
          newX = relX * Math.cos(angle) - relZ * Math.sin(angle);
          newY = relY;
          newZ = relX * Math.sin(angle) + relZ * Math.cos(angle);
          break;

        case 'YZ':
          // Rotation around X-axis
          newX = relX;
          newY = relY * Math.cos(angle) - relZ * Math.sin(angle);
          newZ = relY * Math.sin(angle) + relZ * Math.cos(angle);
          break;
      }

      // Translate back
      const finalX = newX + pivotX;
      const finalY = newY + pivotY;
      const finalZ = newZ;

      rotated.set(dotKey, { x: finalX, y: finalY, z: finalZ });
    });

    return rotated;
  };

  // Rotation animation loop
  useEffect(() => {
    if (!rotationEnabled || !isPlaying || selectedDots.size < 2) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const updateRotation = (currentTime: number) => {
      const deltaTime = lastUpdateTimeRef.current > 0
        ? (currentTime - lastUpdateTimeRef.current) / 1000
        : 0;
      lastUpdateTimeRef.current = currentTime;

      if (deltaTime > 0) {
        // Calculate angle increment based on RPM
        const angleIncrement = (rotationSpeed / 60) * 2 * Math.PI * deltaTime;
        const newAngle = rotationAngle + angleIncrement;
        setRotationAngle(newAngle);

        // Calculate new positions
        const newPositions = rotateDots(newAngle, rotationAxis);
        setVirtualPositions(newPositions);

        // Update audio
        newPositions.forEach((pos, dotKey) => {
          rotatingDotGridPlayer.updateDotPosition(dotKey, pos.x, pos.y, pos.z);
        });
      }

      animationFrameRef.current = requestAnimationFrame(updateRotation);
    };

    lastUpdateTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(updateRotation);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [rotationEnabled, isPlaying, rotationSpeed, rotationAxis, rotationAngle, selectedDots.size, pivotDotKey]);

  // Update audio when settings change
  useEffect(() => {
    rotatingDotGridPlayer.setSoundMode(soundMode);
  }, [soundMode]);

  useEffect(() => {
    rotatingDotGridPlayer.setVolumeDb(volume);
  }, [volume]);

  useEffect(() => {
    rotatingDotGridPlayer.setPlaying(isPlaying);
  }, [isPlaying]);

  // Grid dimensions calculation
  const gridDimensions = useMemo(() => {
    const rows = gridSize;
    const cols = columnCount;

    let dotRadius = BASE_DOT_RADIUS;
    const aspectRatio = canvasSize.width / canvasSize.height;

    if (aspectRatio > 1.5 || aspectRatio < 0.75) {
      dotRadius = BASE_DOT_RADIUS * 0.9;
    }

    const hTotalDotSpace = dotRadius * 2 * cols;
    const vTotalDotSpace = dotRadius * 2 * rows;

    const hRemainingSpace = canvasSize.width - hTotalDotSpace;
    const vRemainingSpace = canvasSize.height - vTotalDotSpace;

    const hGap = hRemainingSpace / (cols + 1);
    const vGap = vRemainingSpace / (rows + 1);

    return { rows, cols, dotRadius, hGap, vGap };
  }, [gridSize, columnCount, canvasSize]);

  // Calculate dot screen position from grid coordinates
  const getDotScreenPosition = (x: number, y: number): { centerX: number, centerY: number } => {
    const { dotRadius, hGap, vGap } = gridDimensions;
    const centerX = hGap + (x * (dotRadius * 2 + hGap)) + dotRadius;
    const centerY = vGap + (y * (dotRadius * 2 + vGap)) + dotRadius;
    return { centerX, centerY };
  };

  // Render dots with Z-depth visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    if (canvasSize.width === 0 || canvasSize.height === 0) return;

    const { rows, cols } = gridDimensions;

    // Collect all dots with their positions and depths
    const dotsToRender: Array<{
      x: number;
      y: number;
      z: number;
      gridX: number;
      gridY: number;
      isSelected: boolean;
      isPivot: boolean;
      volumeLevel: number;
    }> = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dotKey = `${x},${y}`;
        const isSelected = selectedDots.has(dotKey);
        const isPivot = dotKey === pivotDotKey;
        const volumeLevel = dotVolumeLevels.get(dotKey) ?? 3;

        let virtualX = x;
        let virtualY = y;
        let virtualZ = 0;

        if (isSelected && virtualPositions.has(dotKey)) {
          const pos = virtualPositions.get(dotKey)!;
          virtualX = pos.x;
          virtualY = pos.y;
          virtualZ = pos.z;
        }

        dotsToRender.push({
          x: virtualX,
          y: virtualY,
          z: virtualZ,
          gridX: x,
          gridY: y,
          isSelected,
          isPivot,
          volumeLevel
        });
      }
    }

    // Sort by Z (back to front)
    dotsToRender.sort((a, b) => a.z - b.z);

    // Render dots
    dotsToRender.forEach(dot => {
      const { centerX, centerY } = getDotScreenPosition(dot.x, dot.y);

      // Calculate Z-depth visual properties
      const zNorm = (dot.z + 5) / 10; // Map [-5, 5] to [0, 1]
      const sizeFactor = 6 + (8 * zNorm); // 6px to 14px
      const depthOpacity = 0.3 + (0.7 * zNorm); // 0.3 to 1.0

      // Calculate volume-based opacity
      // Level 0: 0.2, Level 1: 0.4, Level 2: 0.7, Level 3: 1.0
      const volumeOpacity = dot.volumeLevel === 0 ? 0.2 : (0.2 + dot.volumeLevel * 0.27);
      const finalOpacity = depthOpacity * volumeOpacity;

      // Draw pulsing animation for playing dots at full volume
      if (isPlaying && dot.volumeLevel === 3) {
        const pulseSize = 2 + Math.sin(Date.now() / 200) * 0.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sizeFactor * pulseSize, 0, Math.PI * 2);
        ctx.fillStyle = isDarkMode
          ? `rgba(56, 189, 248, ${finalOpacity * 0.2})`
          : `rgba(2, 132, 199, ${finalOpacity * 0.2})`;
        ctx.fill();
      }

      // Draw dot with color based on volume level
      ctx.beginPath();
      ctx.arc(centerX, centerY, sizeFactor, 0, Math.PI * 2);

      if (dot.volumeLevel > 0 && !disabled) {
        // Active dot - color based on volume level
        ctx.fillStyle = isDarkMode
          ? `rgba(56, 189, 248, ${finalOpacity})`
          : `rgba(2, 132, 199, ${finalOpacity})`;
      } else {
        // Inactive dot (volume level 0)
        const baseOpacity = disabled ? 0.3 : finalOpacity;
        ctx.fillStyle = isDarkMode
          ? `rgba(82, 82, 91, ${baseOpacity})`
          : `rgba(203, 213, 225, ${baseOpacity})`;
      }

      ctx.fill();

      // Draw selection ring for dots selected for rotation
      if (dot.isSelected) {
        ctx.strokeStyle = isDarkMode ? "#10b981" : "#059669"; // green
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sizeFactor + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw pivot indicator
      if (dot.isPivot && dot.isSelected) {
        ctx.strokeStyle = isDarkMode ? "#fbbf24" : "#f59e0b"; // amber
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sizeFactor + 6, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(centerX - 10, centerY);
        ctx.lineTo(centerX + 10, centerY);
        ctx.moveTo(centerX, centerY - 10);
        ctx.lineTo(centerX, centerY + 10);
        ctx.stroke();
      }
    });

    // Request animation frame if playing
    if (isPlaying) {
      requestAnimationFrame(() => {
        setCanvasSize(prev => ({ ...prev }));
      });
    }
  }, [selectedDots, gridSize, columnCount, disabled, isDarkMode, canvasSize, isPlaying, gridDimensions, virtualPositions, pivotDotKey, dotVolumeLevels]);

  // Dot selection logic
  const findClosestDot = (clickX: number, clickY: number): {x: number, y: number} | null => {
    const { rows, cols, dotRadius } = gridDimensions;
    let closestDot: {x: number, y: number} | null = null;
    let minDistance = Infinity;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const { centerX, centerY } = getDotScreenPosition(x, y);
        const distance = Math.sqrt(
          Math.pow(clickX - centerX, 2) +
          Math.pow(clickY - centerY, 2)
        );

        if (distance < minDistance && distance < dotRadius * 2) {
          minDistance = distance;
          closestDot = { x, y };
        }
      }
    }

    return closestDot;
  };

  const handleDotSelection = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const dot = findClosestDot(clickX, clickY);
    if (!dot) return;

    const dotKey = `${dot.x},${dot.y}`;

    // Get music player state
    const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore.getState();

    // Shift-click to toggle rotation selection
    if (e.shiftKey) {
      const newSelectedDots = new Set(selectedDots);
      if (selectedDots.has(dotKey)) {
        newSelectedDots.delete(dotKey);
      } else {
        newSelectedDots.add(dotKey);
      }
      setSelectedDots(newSelectedDots);
    } else {
      // Regular click: Cycle volume level: 3 -> 2 -> 1 -> 0 -> 3 -> ...
      const currentLevel = dotVolumeLevels.get(dotKey) ?? 3;
      const nextLevel = currentLevel === 0 ? 3 : currentLevel - 1;

      // Update volume level
      const newVolumeLevels = new Map(dotVolumeLevels);
      newVolumeLevels.set(dotKey, nextLevel);
      setDotVolumeLevels(newVolumeLevels);

      // Update audio player
      rotatingDotGridPlayer.updateDotVolumeLevel(dotKey, nextLevel);
    }

    // Auto-start playback on first interaction
    if (!isPlaying) {
      // Resume audio context on user interaction
      await audioContext.resumeAudioContext();

      if (isMusicPlaying) {
        setMusicPlaying(false);
      }
      setIsPlaying(true);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;

    setClickStartPos({ x: e.clientX, y: e.clientY });
    setHasMoved(false);
    setIsDragging(true);
    handleDotSelection(e);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || disabled) return;

    if (clickStartPos) {
      const deltaX = Math.abs(e.clientX - clickStartPos.x);
      const deltaY = Math.abs(e.clientY - clickStartPos.y);

      if (deltaX > 3 || deltaY > 3) {
        setHasMoved(true);
      }
    }

    if (hasMoved) {
      handleDotSelection(e);
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    setClickStartPos(null);
    setHasMoved(false);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      rotatingDotGridPlayer.dispose();
    };
  }, []);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-pointer touch-none"
          style={{ aspectRatio: '4/3' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
      </div>

      {/* Controls */}
      <div className="space-y-4 p-4 border rounded-lg pb-24 overflow-y-auto">
        {/* Grid Size */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Rows:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGridSize(Math.max(3, gridSize - 2))}
              disabled={disabled || gridSize <= 3}
              className="px-2 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
            >
              -
            </button>
            <span className="text-sm w-8 text-center">{gridSize}</span>
            <button
              onClick={() => setGridSize(Math.min(21, gridSize + 2))}
              disabled={disabled || gridSize >= 21}
              className="px-2 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Columns:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setColumnCount(Math.max(3, columnCount - 2))}
              disabled={disabled || columnCount <= 3}
              className="px-2 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
            >
              -
            </button>
            <span className="text-sm w-8 text-center">{columnCount}</span>
            <button
              onClick={() => setColumnCount(Math.min(15, columnCount + 2))}
              disabled={disabled || columnCount >= 15}
              className="px-2 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
            >
              +
            </button>
          </div>
        </div>

        {/* Sound Mode */}
        <div className="space-y-2">
          <span className="text-sm font-medium">Sound Mode</span>
          <div className="space-y-1">
            {[
              { mode: SoundMode.SlopedNoise, label: 'Sloped Noise' },
              { mode: SoundMode.BandpassedNoise, label: 'Bandpassed Noise' },
              { mode: SoundMode.SineTone, label: 'Sine Tone' }
            ].map(({ mode, label }) => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={soundMode === mode}
                  onChange={() => setSoundMode(mode)}
                  disabled={disabled}
                  className="cursor-pointer"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Volume */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Volume</span>
            <span className="text-xs text-muted-foreground">{volume} dB</span>
          </div>
          <input
            type="range"
            min="-60"
            max="0"
            step="1"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            disabled={disabled}
            className="w-full"
          />
        </div>

        {/* Rotation Controls */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Rotation</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rotationEnabled}
                onChange={(e) => setRotationEnabled(e.target.checked)}
                disabled={disabled || selectedDots.size < 2}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          {selectedDots.size < 2 && (
            <p className="text-xs text-muted-foreground">Select 2+ dots to enable rotation</p>
          )}

          {rotationEnabled && (
            <>
              {/* Rotation Axis */}
              <div className="space-y-2">
                <span className="text-sm font-medium">Rotation Axis</span>
                <div className="space-y-1">
                  {[
                    { axis: 'XY' as const, label: 'XY (Panning + Frequency)' },
                    { axis: 'XZ' as const, label: 'XZ (Panning + Volume)' },
                    { axis: 'YZ' as const, label: 'YZ (Frequency + Volume)' }
                  ].map(({ axis, label }) => (
                    <label key={axis} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={rotationAxis === axis}
                        onChange={() => setRotationAxis(axis)}
                        disabled={disabled}
                        className="cursor-pointer"
                      />
                      <span className="text-xs">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Rotation Speed */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Speed</span>
                  <span className="text-xs text-muted-foreground">{rotationSpeed} RPM</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={rotationSpeed}
                  onChange={(e) => setRotationSpeed(Number(e.target.value))}
                  disabled={disabled}
                  className="w-full"
                />
              </div>

              {/* Pivot Point */}
              <div className="space-y-1">
                <span className="text-sm font-medium">Pivot Point</span>
                <select
                  value={pivotDotKey || ''}
                  onChange={(e) => setPivotDotKey(e.target.value || null)}
                  disabled={disabled}
                  className="w-full px-2 py-1 text-sm border rounded"
                >
                  {Array.from(selectedDots).map((dotKey, index) => (
                    <option key={dotKey} value={dotKey}>
                      Dot {index + 1} ({dotKey})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
