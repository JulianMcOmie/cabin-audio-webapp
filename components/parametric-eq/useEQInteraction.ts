import { useState, useEffect, useCallback, RefObject, useRef } from 'react';
import { throttle } from 'lodash';
// import { v4 as uuidv4 } from 'uuid';
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
}

interface ShiftOffset {
  x: number;
  y: number;
}

export function useEQInteraction({
  canvasRef,
  bands,
  freqRange,
  onBandAdd,
  onBandUpdate,
  onBandRemove,
  onBandSelect,
}: UseEQInteractionProps) {
  const [draggingBand, setDraggingBand] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [hoveredBandId, setHoveredBandId] = useState<string | null>(null);
  const [shiftOffset, setShiftOffset] = useState<ShiftOffset>({ x: 0, y: 0 });
//   const [qOffset, setQOffset] = useState(0);
  const [ghostNode, setGhostNode] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  // Add ref to track previous mouse position
  const prevMousePositionRef = useRef<{x: number, y: number} | null>(null);

  // Distance threshold for showing ghost node near center line
  const CENTER_LINE_THRESHOLD = 15;

  // Function to play calibration audio based on current band
  const playCalibrationAudio = useCallback((bandId: string | null, play: boolean) => {
    const audioPlayer = getReferenceCalibrationAudio();

    // console.log(`🔊 playCalibrationAudio: bandId=${bandId}, play=${play}`);
    
    if (play && bandId) {
      // Find the band being dragged
      const band = bands.find(b => b.id === bandId);
      
      if (band) {
        // Calculate bandwidth from Q
        const bandwidth = band.q ? 1.0 / band.q : 1.0;
        
        // Set initial parameters with combined method to avoid pattern restarts
        audioPlayer.updateCalibrationParameters(band.frequency, bandwidth);
        
        // Only start playing if not already playing
        if (!audioPlayer.isActive()) {
          audioPlayer.setPlaying(true);
        }
      }
    } else {
      // Stop playing when released
      audioPlayer.setPlaying(false);
    }
  }, [bands]);

  // Create throttled band update function to improve performance
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledBandUpdate = useCallback(
    throttle((id: string, updates: Partial<EQBandWithUI>) => {
      onBandUpdate(id, updates);
    }, 16), // Throttle to roughly 60fps
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

  // Create throttled mouse move handler - defined once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleGlobalMouseMoveThrottled = useCallback(
    throttle((e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !isDragging || !draggingBand) return;
      
      const rect = canvas.getBoundingClientRect();
      
      // Get the margin from the canvas if available
      const margin = (canvas as any).margin || 0;
      
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
          
          // Calculate new Q: moving up (negative offset) increases Q, moving down decreases Q
          const currentQ = band.q || 1.0;
          const scaleFactor = 0.02;
          const newQ = Math.max(0.1, Math.min(10, currentQ * Math.exp(-deltaY * scaleFactor)));
          
          // Update the calibration audio bandwidth (inverse of Q)
          const newBandwidth = 1.0 / newQ;
          
          // Use the combined update method to avoid pattern restart
          audioPlayer.updateCalibrationParameters(undefined, newBandwidth);
          
          throttledBandUpdate(draggingBand, { q: newQ });
        }
      } else {
        // Normal drag adjusts frequency and gain
        const gain = EQCoordinateUtils.yToGain(y, innerHeight);
        const clampedGain = Math.max(-24, Math.min(24, gain));
        
        // Use the combined update method to avoid pattern restart
        audioPlayer.updateCalibrationParameters(clampedFrequency);

        // If we're outside of the canvas, but we move towards the canvas, we can reduce shiftOffset
        if (!isInsideCanvas) {
          // Handle X offset reduction
          if (shiftOffset.x > 0 && deltaX > 0) {
            setShiftOffset(prev => ({
              ...prev,
              x: Math.max(0, prev.x - deltaX)
            }));
          }
          if (shiftOffset.x < 0 && deltaX < 0) {
            setShiftOffset(prev => ({
              ...prev,
              x: Math.min(0, prev.x - deltaX)
            }));
          }
          
          // Handle Y offset reduction
          if (shiftOffset.y > 0 && deltaY > 0) {
            setShiftOffset(prev => ({
              ...prev,
              y: Math.max(0, prev.y - deltaY)
            }));
          }
          if (shiftOffset.y < 0 && deltaY < 0) {
            setShiftOffset(prev => ({
              ...prev,
              y: Math.min(0, prev.y - deltaY)
            }));
          }
        }
        throttledBandUpdate(draggingBand, {
          frequency: clampedFrequency,
          gain: clampedGain
        });
      }
    }, 16), // Throttle to roughly 60fps (16ms)
    [canvasRef, draggingBand, isDragging, bands, isShiftPressed, shiftOffset, freqRange, throttledBandUpdate]
  );

  // Handle global mouse events for dragging outside the canvas
  useEffect(() => {
    if (!isDragging || !draggingBand) return;
    
    // Start playing calibration audio when dragging begins
    playCalibrationAudio(draggingBand, true);
    
    const handleGlobalMouseMove = (e: MouseEvent) => {
      // Use the throttled handler
      handleGlobalMouseMoveThrottled(e);
    };
    
    const handleGlobalMouseUp = () => {
      // Stop playing calibration audio when dragging ends
      playCalibrationAudio(null, false);
      
      setDraggingBand(null);
      setIsDragging(false);
      prevMousePositionRef.current = null; // Reset position tracking
      
      // Cancel any pending throttled updates
      handleGlobalMouseMoveThrottled.cancel();
      throttledBandUpdate.cancel();
    };
    
    // Add global event listeners
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    // Clean up
    return () => {
      // Remove event listeners
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      
      // Cancel any pending throttled updates
      handleGlobalMouseMoveThrottled.cancel();
      throttledBandUpdate.cancel();
    };
  }, [isDragging, draggingBand, handleGlobalMouseMoveThrottled, throttledBandUpdate, playCalibrationAudio]);

  // Throttled mouse move handler for hover effects
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleMouseMoveThrottled = useCallback(
    throttle((e: React.MouseEvent) => {
      // Only handle hover state here - dragging is handled by the global handler
      if (draggingBand) return;
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      
      // Get the margin from the canvas if available
      const margin = (canvas as any).margin || 0;
      
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
          // Show ghost node on center line
          setGhostNode({
            x,
            y: centerY,
            visible: true
          });
        } else {
          // Hide ghost node
          setGhostNode(prev => ({
            ...prev,
            visible: false
          }));
        }
      } else {
        // Hide ghost node when outside inner area
        setGhostNode(prev => ({
          ...prev,
          visible: false
        }));
      }
    }, 16), // Throttle to roughly 60fps
    [bands, draggingBand, hoveredBandId, freqRange, onBandUpdate, canvasRef]
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
    const margin = (canvas as any).margin || 0;
    
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
        // Start dragging existing band
        setDraggingBand(clickedBandId);
        setIsDragging(true);
        onBandSelect(clickedBandId);
        
        // We don't start playing audio here - the useEffect will handle it
        // when draggingBand and isDragging are updated
      } else {
        // Check if click is near center line
        const centerY = margin + innerHeight / 2;
        const distanceToCenter = Math.abs(y - centerY);
        
        if (distanceToCenter <= CENTER_LINE_THRESHOLD) {
          // Add new band at center line
          const frequency = EQCoordinateUtils.xToFreq(innerX, innerWidth, freqRange);
          const clampedFrequency = Math.max(20, Math.min(20000, frequency));
          
          // Create a new band (gain is 0 since it's on center line)
          const newBand = {
            frequency: clampedFrequency,
            gain: 0,
            q: 1.0,
            type: 'peaking' as BiquadFilterType
          };
          
          // Add the band and get the new ID back
          const newBandId = onBandAdd(newBand);
          
          // Hide ghost node
          setGhostNode(prev => ({
            ...prev,
            visible: false
          }));
          
          // Immediately start dragging the new band if we got an ID back
          if (newBandId) {
            setDraggingBand(newBandId);
            setIsDragging(true);
            onBandSelect(newBandId);
            
            // Setup calibration audio for the new band
            const audioPlayer = getReferenceCalibrationAudio();
            
            // Set parameters before starting playback to ensure continuous rhythm
            audioPlayer.updateCalibrationParameters(clampedFrequency, 1.0);
            
            // Audio will start playing via the useEffect when draggingBand is updated
          }
        }
      }
    } else if (e.button === 2 && clickedBandId) { // Right click
      // Remove band
      onBandRemove(clickedBandId);
      if (clickedBandId === hoveredBandId) {
        setHoveredBandId(null);
      }
      if (draggingBand === clickedBandId) {
        setDraggingBand(null);
        setIsDragging(false);
        
        // Stop any playing audio
        playCalibrationAudio(null, false);
      }
      onBandSelect(null);
      
      // Cancel any pending throttled updates
      handleMouseMoveThrottled.cancel();
      throttledBandUpdate.cancel();
    }
  }, [bands, freqRange, hoveredBandId, draggingBand, onBandAdd, onBandRemove, onBandSelect, canvasRef, handleMouseMoveThrottled, throttledBandUpdate, playCalibrationAudio]);

  // Cancel throttled functions on unmount
  useEffect(() => {
    return () => {
      handleGlobalMouseMoveThrottled.cancel();
      handleMouseMoveThrottled.cancel();
      throttledBandUpdate.cancel();
    };
  }, [handleGlobalMouseMoveThrottled, handleMouseMoveThrottled, throttledBandUpdate]);

  // Clean up audio when component unmounts
  useEffect(() => {
    return () => {
      // Make sure audio is stopped when component unmounts
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
    ghostNode
  };
} 