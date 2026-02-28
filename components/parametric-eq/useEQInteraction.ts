import { useState, useEffect, useCallback, RefObject, useRef } from 'react';
import { throttle } from 'lodash';
import { EQBandWithUI } from './types';
import { EQCoordinateUtils } from './EQCoordinateUtils';
import { getReferenceCalibrationAudio } from '@/lib/audio/referenceCalibrationAudio';

interface UseEQInteractionProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  bands: EQBandWithUI[];
  freqRange: { min: number; max: number };
  onBandAdd: (band: Omit<EQBandWithUI, 'id' | 'isHovered' | 'frequencyResponse'>) => string | undefined;
  onBandUpdate: (id: string, updates: Partial<EQBandWithUI>) => void;
  onBandRemove: (id: string) => void;
  onBandSelect: (id: string | null) => void;
  onMultiBandUpdate?: (updates: Array<{ id: string; changes: Partial<EQBandWithUI> }>) => void;
  onMultiBandRemove?: (ids: string[]) => void;
}

interface ShiftOffset {
  x: number;
  y: number;
}

// Interface for canvas with margin property
interface CanvasWithMargin extends HTMLCanvasElement {
  margin?: number;
}

export function useEQInteraction({
  canvasRef,
  bands,
  freqRange,
  onBandAdd,
  onBandUpdate,
  onBandRemove,
  onBandSelect,
  onMultiBandUpdate,
  onMultiBandRemove,
}: UseEQInteractionProps) {
  // Flag to control whether EQ band changes affect the reference calibration
  const SHOULD_UPDATE_CALIBRATION = true;

  const [draggingBand, setDraggingBand] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [hoveredBandId, setHoveredBandId] = useState<string | null>(null);
  const [shiftOffset, setShiftOffset] = useState<ShiftOffset>({ x: 0, y: 0 });
  const [ghostNode, setGhostNode] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  // Multi-selection state
  const [selectedBandIds, setSelectedBandIds] = useState<Set<string>>(new Set());

  // Marquee state
  const [isMarqueeActive, setIsMarqueeActive] = useState(false);
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  // Track whether shift was held when marquee started
  const marqueeShiftRef = useRef(false);
  // Pre-marquee selection (bands selected before marquee started)
  const preMarqueeSelectionRef = useRef<Set<string>>(new Set());

  // Snapshot of band positions at drag start for delta-based multi-drag
  const dragStartBandSnapshotRef = useRef<Map<string, { frequency: number; gain: number; q: number }>>(new Map());

  // Add ref to track previous mouse position
  const prevMousePositionRef = useRef<{x: number, y: number} | null>(null);

  // Distance threshold for showing ghost node near center line
  const CENTER_LINE_THRESHOLD = 15;

  // Add this state to track the last used bandwidth/Q value
  const [lastUsedQ, setLastUsedQ] = useState(1.0); // Default Q value

  // Derived marquee rect (normalized so width/height are always positive)
  const marqueeRect = (isMarqueeActive && marqueeStart && marqueeEnd) ? {
    x: Math.min(marqueeStart.x, marqueeEnd.x),
    y: Math.min(marqueeStart.y, marqueeEnd.y),
    width: Math.abs(marqueeEnd.x - marqueeStart.x),
    height: Math.abs(marqueeEnd.y - marqueeStart.y),
  } : null;

  // Modify the throttledBandUpdate function to capture Q changes
  const throttledBandUpdate = useCallback(
    (id: string, updates: Partial<EQBandWithUI>) => {
      // Create a throttled function inside the callback
      const throttledUpdate = throttle((updateId: string, updateData: Partial<EQBandWithUI>) => {
        // If this update includes a Q value, store it for future bands
        if (updateData.q !== undefined) {
          setLastUsedQ(updateData.q);
        }
        onBandUpdate(updateId, updateData);
      }, 16);

      // Call the throttled function
      throttledUpdate(id, updates);

      // Return the throttled function for cancellation
      return throttledUpdate;
    },
    [onBandUpdate]
  );

  // Listen for shift key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Clear selection when bands array identity changes (profile switch)
  const bandsIdentityRef = useRef(bands);
  useEffect(() => {
    // Only clear if the bands array reference itself changed (profile switch),
    // not just individual band property updates
    if (bandsIdentityRef.current !== bands) {
      const prevIds = new Set(bandsIdentityRef.current.map(b => b.id));
      const currIds = new Set(bands.map(b => b.id));
      // Check if the set of band IDs changed (profile switch scenario)
      const idsChanged = prevIds.size !== currIds.size ||
        [...prevIds].some(id => !currIds.has(id));
      if (idsChanged) {
        setSelectedBandIds(new Set());
      }
      bandsIdentityRef.current = bands;
    }
  }, [bands]);

  // Helper: snapshot selected band positions for delta-based drag
  const snapshotSelectedBands = useCallback((selectedIds: Set<string>) => {
    const snapshot = new Map<string, { frequency: number; gain: number; q: number }>();
    for (const id of selectedIds) {
      const band = bands.find(b => b.id === id);
      if (band) {
        snapshot.set(id, { frequency: band.frequency, gain: band.gain, q: band.q });
      }
    }
    dragStartBandSnapshotRef.current = snapshot;
  }, [bands]);

  // Create throttled mouse move handler - defined once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleGlobalMouseMoveThrottled = useCallback(
    throttle((e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !isDragging || !draggingBand) return;

      const rect = canvas.getBoundingClientRect();

      // Get the margin from the canvas if available
      const margin = (canvas as CanvasWithMargin).margin || 0;

      // Get current mouse position
      const currentMousePosition = {
        x: e.clientX,
        y: e.clientY
      };

      // Calculate delta manually by comparing with previous position
      let deltaX = 0;
      let deltaY = 0;

      if (prevMousePositionRef.current) {
        deltaX = currentMousePosition.x - prevMousePositionRef.current.x;
        deltaY = currentMousePosition.y - prevMousePositionRef.current.y;
      }

      // Update previous position for next frame
      prevMousePositionRef.current = currentMousePosition;

      // Get inner canvas dimensions (accounting for margins)
      const innerWidth = rect.width - margin * 2;
      const innerHeight = rect.height - margin * 2;

      // Calculate position relative to inner canvas, applying shift offsets
      let x = e.clientX - rect.left - margin - shiftOffset.x;
      let y = e.clientY - rect.top - margin - shiftOffset.y;

      // Check if mouse is inside inner canvas area
      const isInsideCanvas =
        x >= 0 && x <= innerWidth &&
        y >= 0 && y <= innerHeight;

      // Clamp x and y to inner canvas boundaries for calculation purposes
      x = Math.max(0, Math.min(innerWidth, x));
      y = Math.max(0, Math.min(innerHeight, y));

      // Calculate frequency from x position (clamped to valid range)
      const frequency = EQCoordinateUtils.xToFreq(x, innerWidth, freqRange);
      const clampedFrequency = Math.max(20, Math.min(20000, frequency));

      // Get the audio player to update parameters
      const audioPlayer = getReferenceCalibrationAudio();

      const isMultiSelected = selectedBandIds.size > 1 && selectedBandIds.has(draggingBand);

      if (isShiftPressed) {
        // Shift + drag adjusts Q
        const band = bands.find(b => b.id === draggingBand);
        if (band) {
          // Only update shiftOffset if mouse is inside canvas
          if (isInsideCanvas) {
            setShiftOffset(prev => ({
              x: prev.x + deltaX,
              y: prev.y + deltaY
            }));
          }

          // Calculate Q multiplier from vertical delta
          const scaleFactor = 0.02;
          const qMultiplier = Math.exp(-deltaY * scaleFactor);

          if (isMultiSelected && onMultiBandUpdate) {
            // Apply same Q multiplier to all selected bands
            const updates: Array<{ id: string; changes: Partial<EQBandWithUI> }> = [];
            for (const id of selectedBandIds) {
              const b = bands.find(bb => bb.id === id);
              if (b) {
                const newQ = Math.max(0.1, Math.min(10, (b.q || 1.0) * qMultiplier));
                updates.push({ id, changes: { q: newQ } });
              }
            }
            onMultiBandUpdate(updates);
          } else {
            // Single band Q adjustment
            const currentQ = band.q || 1.0;
            const newQ = Math.max(0.1, Math.min(10, currentQ * qMultiplier));

            // Only update calibration if the flag is true
            if (SHOULD_UPDATE_CALIBRATION) {
              const newBandwidth = 1.0 / newQ;
              audioPlayer.updateCalibrationParameters(undefined, newBandwidth);
            }

            throttledBandUpdate(draggingBand, { q: newQ });
          }
        }
      } else {
        if (isMultiSelected && onMultiBandUpdate) {
          // Multi-band drag: compute delta in log-frequency space and linear gain space
          const draggedBandSnapshot = dragStartBandSnapshotRef.current.get(draggingBand);
          if (draggedBandSnapshot) {
            // Current position of dragged band from mouse
            const gain = EQCoordinateUtils.yToGain(y, innerHeight);

            // Delta in log-frequency space (preserves ratios)
            const logFreqDelta = Math.log(clampedFrequency) - Math.log(draggedBandSnapshot.frequency);
            // Delta in linear gain space
            const gainDelta = gain - draggedBandSnapshot.gain;

            const updates: Array<{ id: string; changes: Partial<EQBandWithUI> }> = [];
            for (const id of selectedBandIds) {
              const snapshot = dragStartBandSnapshotRef.current.get(id);
              if (snapshot) {
                const newFreq = Math.max(20, Math.min(20000, Math.exp(Math.log(snapshot.frequency) + logFreqDelta)));
                const newGain = Math.max(-24, Math.min(24, snapshot.gain + gainDelta));
                updates.push({ id, changes: { frequency: newFreq, gain: newGain } });
              }
            }
            onMultiBandUpdate(updates);

            // Update calibration for the primary dragged band only
            if (SHOULD_UPDATE_CALIBRATION) {
              audioPlayer.updateCalibrationParameters(clampedFrequency);
            }
          }
        } else {
          // Single band drag: normal drag adjusts frequency and gain
          const gain = EQCoordinateUtils.yToGain(y, innerHeight);
          const clampedGain = Math.max(-24, Math.min(24, gain));

          // Only update calibration if the flag is true
          if (SHOULD_UPDATE_CALIBRATION) {
            audioPlayer.updateCalibrationParameters(clampedFrequency);
          }

          // If we're outside of the canvas, but we move towards the canvas, we can reduce shiftOffset
          if (!isInsideCanvas) {
            if (shiftOffset.x > 0 && deltaX > 0) {
              setShiftOffset(prev => ({ ...prev, x: Math.max(0, prev.x - deltaX) }));
            }
            if (shiftOffset.x < 0 && deltaX < 0) {
              setShiftOffset(prev => ({ ...prev, x: Math.min(0, prev.x - deltaX) }));
            }
            if (shiftOffset.y > 0 && deltaY > 0) {
              setShiftOffset(prev => ({ ...prev, y: Math.max(0, prev.y - deltaY) }));
            }
            if (shiftOffset.y < 0 && deltaY < 0) {
              setShiftOffset(prev => ({ ...prev, y: Math.min(0, prev.y - deltaY) }));
            }
          }
          throttledBandUpdate(draggingBand, {
            frequency: clampedFrequency,
            gain: clampedGain
          });
        }
      }
    }, 16), // Throttle to roughly 60fps (16ms)
    [canvasRef, draggingBand, isDragging, bands, isShiftPressed, shiftOffset, freqRange, throttledBandUpdate, SHOULD_UPDATE_CALIBRATION, selectedBandIds, onMultiBandUpdate]
  );

  // Handle global mouse events for dragging outside the canvas
  useEffect(() => {
    if (!isDragging || !draggingBand) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleGlobalMouseMoveThrottled(e);
    };

    const handleGlobalMouseUp = () => {
      setDraggingBand(null);
      setIsDragging(false);
      prevMousePositionRef.current = null;
      dragStartBandSnapshotRef.current = new Map();

      handleGlobalMouseMoveThrottled.cancel();
      const update = throttledBandUpdate('', {});
      if (update && update.cancel) {
        update.cancel();
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);

      handleGlobalMouseMoveThrottled.cancel();
      const update = throttledBandUpdate('', {});
      if (update && update.cancel) {
        update.cancel();
      }
    };
  }, [isDragging, draggingBand, handleGlobalMouseMoveThrottled, throttledBandUpdate]);

  // Marquee mouse tracking
  useEffect(() => {
    if (!isMarqueeActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMarqueeMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const margin = (canvas as CanvasWithMargin).margin || 0;
      // Clamp to inner area
      const innerX = Math.max(0, Math.min(rect.width - margin * 2, e.clientX - rect.left - margin));
      const innerY = Math.max(0, Math.min(rect.height - margin * 2, e.clientY - rect.top - margin));
      setMarqueeEnd({ x: innerX, y: innerY });

      // Compute which band handles fall inside the marquee rect
      const innerWidth = rect.width - margin * 2;
      const innerHeight = rect.height - margin * 2;
      const start = marqueeStart!;
      const minX = Math.min(start.x, innerX);
      const maxX = Math.max(start.x, innerX);
      const minY = Math.min(start.y, innerY);
      const maxY = Math.max(start.y, innerY);

      const enclosedIds = new Set<string>();
      for (const band of bands) {
        if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
          const bandX = EQCoordinateUtils.freqToX(band.frequency, innerWidth, freqRange);
          const bandY = EQCoordinateUtils.gainToY(band.gain, innerHeight);
          if (bandX >= minX && bandX <= maxX && bandY >= minY && bandY <= maxY) {
            enclosedIds.add(band.id);
          }
        }
      }

      // Union with pre-marquee selection if shift was held
      if (marqueeShiftRef.current) {
        const merged = new Set(preMarqueeSelectionRef.current);
        for (const id of enclosedIds) merged.add(id);
        setSelectedBandIds(merged);
      } else {
        setSelectedBandIds(enclosedIds);
      }
    };

    const handleMarqueeUp = (e: MouseEvent) => {
      // If marquee was tiny (< 3px), treat as deselect click
      if (marqueeStart && marqueeEnd) {
        const dx = Math.abs(marqueeEnd.x - marqueeStart.x);
        const dy = Math.abs(marqueeEnd.y - marqueeStart.y);
        if (dx < 3 && dy < 3 && !marqueeShiftRef.current) {
          setSelectedBandIds(new Set());
        }
      } else if (marqueeStart) {
        // mouseup happened without any mousemove setting marqueeEnd
        const rect = canvas.getBoundingClientRect();
        const margin = (canvas as CanvasWithMargin).margin || 0;
        const innerX = Math.max(0, Math.min(rect.width - margin * 2, e.clientX - rect.left - margin));
        const innerY = Math.max(0, Math.min(rect.height - margin * 2, e.clientY - rect.top - margin));
        const dx = Math.abs(innerX - marqueeStart.x);
        const dy = Math.abs(innerY - marqueeStart.y);
        if (dx < 3 && dy < 3 && !marqueeShiftRef.current) {
          setSelectedBandIds(new Set());
        }
      }
      setIsMarqueeActive(false);
      setMarqueeStart(null);
      setMarqueeEnd(null);
    };

    window.addEventListener('mousemove', handleMarqueeMove);
    window.addEventListener('mouseup', handleMarqueeUp);

    return () => {
      window.removeEventListener('mousemove', handleMarqueeMove);
      window.removeEventListener('mouseup', handleMarqueeUp);
    };
  }, [isMarqueeActive, marqueeStart, marqueeEnd, bands, freqRange, canvasRef]);

  // Throttled mouse move handler for hover effects
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleMouseMoveThrottled = useCallback(
    throttle((e: React.MouseEvent) => {
      // Only handle hover state here - dragging is handled by the global handler
      if (draggingBand || isMarqueeActive) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();

      // Get the margin from the canvas if available
      const margin = (canvas as CanvasWithMargin).margin || 0;

      // Calculate mouse position relative to canvas
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Get inner canvas dimensions (accounting for margins)
      const innerWidth = rect.width - margin * 2;
      const innerHeight = rect.height - margin * 2;

      // Check if mouse is within inner area
      const isWithinInnerArea =
        x >= margin && x <= rect.width - margin &&
        y >= margin && y <= rect.height - margin;

      // Calculate inner coordinates
      const innerX = x - margin;
      const innerY = y - margin;

      // Check if hovering over a band (only if within inner area)
      let newHoveredBandId: string | null = null;

      if (isWithinInnerArea) {
        for (const band of bands) {
          if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
            const bandX = EQCoordinateUtils.freqToX(band.frequency, innerWidth, freqRange);
            const bandY = EQCoordinateUtils.gainToY(band.gain, innerHeight);

            const distance = Math.sqrt(Math.pow(innerX - bandX, 2) + Math.pow(innerY - bandY, 2));
            if (distance <= 10) { // 10px radius for hover detection
              newHoveredBandId = band.id;
              break;
            }
          }
        }
      }

      // Update hovered band
      if (newHoveredBandId !== hoveredBandId) {
        setHoveredBandId(newHoveredBandId);

        // Update isHovered state in bands
        bands.forEach(band => {
          if (band.isHovered !== (band.id === newHoveredBandId)) {
            onBandUpdate(band.id, { isHovered: band.id === newHoveredBandId });
          }
        });
      }

      // Check if mouse is near center line to show ghost node (only if within inner area)
      if (isWithinInnerArea) {
        const centerY = margin + innerHeight / 2;
        const distanceToCenter = Math.abs(y - centerY);

        if (distanceToCenter <= CENTER_LINE_THRESHOLD && !newHoveredBandId) {
          setGhostNode({
            x,
            y: centerY,
            visible: true
          });
        } else {
          setGhostNode(prev => ({
            ...prev,
            visible: false
          }));
        }
      } else {
        setGhostNode(prev => ({
          ...prev,
          visible: false
        }));
      }
    }, 16), // Throttle to roughly 60fps
    [bands, draggingBand, hoveredBandId, freqRange, onBandUpdate, canvasRef, isMarqueeActive]
  );

  // Wrapper for the throttled mouse move handler
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    handleMouseMoveThrottled(e);
  }, [handleMouseMoveThrottled]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    // Get the margin from the canvas if available
    const margin = (canvas as CanvasWithMargin).margin || 0;

    // Calculate mouse position relative to canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Get inner canvas dimensions (accounting for margins)
    const innerWidth = rect.width - margin * 2;
    const innerHeight = rect.height - margin * 2;

    // Check if mouse is within inner area
    const isWithinInnerArea =
      x >= margin && x <= rect.width - margin &&
      y >= margin && y <= rect.height - margin;

    // Only proceed if within inner area
    if (!isWithinInnerArea) {
      return;
    }

    // Calculate inner coordinates
    const innerX = x - margin;
    const innerY = y - margin;

    // Initialize position tracking for delta calculations
    prevMousePositionRef.current = {
      x: e.clientX,
      y: e.clientY
    };

    // Reset both offsets when starting a new drag
    setShiftOffset({ x: 0, y: 0 });

    // Check if clicking on a band
    let clickedBandId: string | null = null;

    for (const band of bands) {
      if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
        const bandX = EQCoordinateUtils.freqToX(band.frequency, innerWidth, freqRange);
        const bandY = EQCoordinateUtils.gainToY(band.gain, innerHeight);

        const distance = Math.sqrt(Math.pow(innerX - bandX, 2) + Math.pow(innerY - bandY, 2));
        if (distance <= 10) {
          clickedBandId = band.id;
          break;
        }
      }
    }

    if (e.button === 0) { // Left click
      if (clickedBandId) {
        if (isShiftPressed) {
          // Shift+click: toggle band in/out of selection, no drag
          setSelectedBandIds(prev => {
            const next = new Set(prev);
            if (next.has(clickedBandId!)) {
              next.delete(clickedBandId!);
            } else {
              next.add(clickedBandId!);
            }
            return next;
          });
          onBandSelect(clickedBandId);
        } else if (selectedBandIds.has(clickedBandId) && selectedBandIds.size > 1) {
          // Click on band already in multi-selection: drag all selected
          setDraggingBand(clickedBandId);
          setIsDragging(true);
          onBandSelect(clickedBandId);
          snapshotSelectedBands(selectedBandIds);
        } else {
          // Click on band not in selection (or single selection): clear selection, select this, start drag
          const newSelection = new Set([clickedBandId]);
          setSelectedBandIds(newSelection);
          setDraggingBand(clickedBandId);
          setIsDragging(true);
          onBandSelect(clickedBandId);
          snapshotSelectedBands(newSelection);
        }
      } else {
        // Check if click is near center line
        const centerY = margin + innerHeight / 2;
        const distanceToCenter = Math.abs(y - centerY);

        if (distanceToCenter <= CENTER_LINE_THRESHOLD) {
          // Clear multi-selection, add new band at center line
          setSelectedBandIds(new Set());

          const frequency = EQCoordinateUtils.xToFreq(innerX, innerWidth, freqRange);
          const clampedFrequency = Math.max(20, Math.min(20000, frequency));

          const newBand = {
            frequency: clampedFrequency,
            gain: 0,
            q: lastUsedQ,
            type: 'peaking' as BiquadFilterType
          };

          const newBandId = onBandAdd(newBand);

          setGhostNode(prev => ({ ...prev, visible: false }));

          if (newBandId) {
            setSelectedBandIds(new Set([newBandId]));
            setDraggingBand(newBandId);
            setIsDragging(true);
            onBandSelect(newBandId);

            const audioPlayer = getReferenceCalibrationAudio();
            if (SHOULD_UPDATE_CALIBRATION) {
              audioPlayer.updateCalibrationParameters(clampedFrequency, 1.0);
            }
          }
        } else {
          // Click on empty canvas: start marquee
          marqueeShiftRef.current = isShiftPressed;
          if (isShiftPressed) {
            preMarqueeSelectionRef.current = new Set(selectedBandIds);
          } else {
            preMarqueeSelectionRef.current = new Set();
            setSelectedBandIds(new Set());
          }
          setIsMarqueeActive(true);
          setMarqueeStart({ x: innerX, y: innerY });
          setMarqueeEnd({ x: innerX, y: innerY });
          // Suppress ghost node
          setGhostNode(prev => ({ ...prev, visible: false }));
        }
      }
    } else if (e.button === 2 && clickedBandId) { // Right click
      if (selectedBandIds.has(clickedBandId) && selectedBandIds.size > 1 && onMultiBandRemove) {
        // Delete all selected bands
        onMultiBandRemove([...selectedBandIds]);
        setSelectedBandIds(new Set());
      } else {
        // Delete just this one band
        onBandRemove(clickedBandId);
      }
      if (clickedBandId === hoveredBandId) {
        setHoveredBandId(null);
      }
      if (draggingBand === clickedBandId) {
        setDraggingBand(null);
        setIsDragging(false);
      }
      onBandSelect(null);

      handleMouseMoveThrottled.cancel();
      const update = throttledBandUpdate('', {});
      if (update && update.cancel) {
        update.cancel();
      }
    }
  }, [bands, freqRange, hoveredBandId, draggingBand, onBandAdd, onBandRemove, onBandSelect, canvasRef, handleMouseMoveThrottled, throttledBandUpdate, lastUsedQ, SHOULD_UPDATE_CALIBRATION, isShiftPressed, selectedBandIds, onMultiBandRemove, snapshotSelectedBands]);

  // Cancel throttled functions on unmount
  useEffect(() => {
    return () => {
      handleGlobalMouseMoveThrottled.cancel();
      handleMouseMoveThrottled.cancel();
      const update = throttledBandUpdate('', {});
      if (update && update.cancel) {
        update.cancel();
      }
    };
  }, [handleGlobalMouseMoveThrottled, handleMouseMoveThrottled, throttledBandUpdate]);

  // Clean up audio when component unmounts
  useEffect(() => {
    return () => {
      const audioPlayer = getReferenceCalibrationAudio();
      audioPlayer.setPlaying(false);
    };
  }, []);

  return {
    handleMouseMove,
    handleMouseDown,
    isShiftPressed,
    hoveredBandId,
    draggingBand,
    ghostNode,
    selectedBandIds,
    isMarqueeActive,
    marqueeRect,
  };
}
