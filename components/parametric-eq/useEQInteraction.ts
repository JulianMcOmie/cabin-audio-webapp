import { useState, useEffect, useCallback, RefObject } from 'react';
// import { v4 as uuidv4 } from 'uuid';
import { EQBandWithUI } from './types';
import { EQCoordinateUtils } from './EQCoordinateUtils';

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

  // Distance threshold for showing ghost node near center line
  const CENTER_LINE_THRESHOLD = 15;

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

  // Handle global mouse events for dragging outside the canvas
  useEffect(() => {
    if (!isDragging || !draggingBand) return;
    
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      
      // Calculate position relative to canvas, applying shift offsets
      let x = e.clientX - rect.left - shiftOffset.x;
      let y = e.clientY - rect.top - shiftOffset.y;
      
      // Check if mouse is inside canvas
      const isInsideCanvas = 
        x >= 0 && x <= rect.width && 
        y >= 0 && y <= rect.height;
      
      // Clamp x and y to canvas boundaries for calculation purposes
      x = Math.max(0, Math.min(rect.width, x));
      y = Math.max(0, Math.min(rect.height, y));
      
      // Calculate frequency from x position (clamped to valid range)
      const frequency = EQCoordinateUtils.xToFreq(x, rect.width, freqRange);
      const clampedFrequency = Math.max(20, Math.min(20000, frequency));
      
      if (isShiftPressed) {
        // Shift + drag adjusts Q
        const band = bands.find(b => b.id === draggingBand);
        if (band) {
          // Track Q adjustment with qOffset
        //   setQOffset(prev => prev + e.movementY);
          
          // Only update shiftOffset if mouse is inside canvas
          if (isInsideCanvas) {
            setShiftOffset(prev => ({
              x: prev.x + e.movementX,
              y: prev.y + e.movementY
            }));
          }
          
          // Calculate new Q: moving up (negative offset) increases Q, moving down decreases Q
          const currentQ = band.q || 1.0;
          const scaleFactor = 0.02;
          const newQ = Math.max(0.1, Math.min(10, currentQ * Math.exp(-e.movementY * scaleFactor)));
          
          onBandUpdate(draggingBand, { q: newQ });
        }
      } else {
        // Normal drag adjusts frequency and gain
        const gain = EQCoordinateUtils.yToGain(y, rect.height);
        const clampedGain = Math.max(-24, Math.min(24, gain));

        // If we're outside of the canvas, but we move towards the canvas, we can reduce shiftOffset
        if (!isInsideCanvas) {
          // Handle X offset reduction
          if (shiftOffset.x > 0 && e.movementX > 0) {
            setShiftOffset(prev => ({
              ...prev,
              x: Math.max(0, prev.x - e.movementX)
            }));
          }
          if (shiftOffset.x < 0 && e.movementX < 0) {
            setShiftOffset(prev => ({
              ...prev,
              x: Math.min(0, prev.x - e.movementX)
            }));
          }
          
          // Handle Y offset reduction
          if (shiftOffset.y > 0 && e.movementY > 0) {
            setShiftOffset(prev => ({
              ...prev,
              y: Math.max(0, prev.y - e.movementY)
            }));
          }
          if (shiftOffset.y < 0 && e.movementY < 0) {
            setShiftOffset(prev => ({
              ...prev,
              y: Math.min(0, prev.y - e.movementY)
            }));
          }
        }
        onBandUpdate(draggingBand, {
          frequency: clampedFrequency,
          gain: clampedGain
        });
      }
    };
    
    const handleGlobalMouseUp = () => {
      setDraggingBand(null);
      setIsDragging(false);
    };
    
    // Add global event listeners
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    // Clean up
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, draggingBand, bands, isShiftPressed, onBandUpdate, shiftOffset, freqRange, canvasRef]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Only handle hover state here - dragging is handled by the global handler
    if (draggingBand) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Calculate mouse position relative to canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if hovering over a band
    let newHoveredBandId: string | null = null;
    
    for (const band of bands) {
      if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
        const bandX = EQCoordinateUtils.freqToX(band.frequency, rect.width, freqRange);
        const bandY = EQCoordinateUtils.gainToY(band.gain, rect.height);
        
        const distance = Math.sqrt(Math.pow(x - bandX, 2) + Math.pow(y - bandY, 2));
        if (distance <= 10) { // 10px radius for hover detection
          newHoveredBandId = band.id;
          break;
        }
      }
    }

    console.log("newHoveredBandId", newHoveredBandId);
    
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
    
    // Check if mouse is near center line to show ghost node
    const centerY = rect.height / 2;
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
  }, [bands, draggingBand, hoveredBandId, freqRange, onBandUpdate, canvasRef]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Calculate mouse position relative to canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Reset both offsets when starting a new drag
    setShiftOffset({ x: 0, y: 0 });
    // setQOffset(0);
    
    // Check if clicking on a band
    let clickedBandId: string | null = null;
    
    for (const band of bands) {
      if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
        const bandX = EQCoordinateUtils.freqToX(band.frequency, rect.width, freqRange);
        const bandY = EQCoordinateUtils.gainToY(band.gain, rect.height);
        
        const distance = Math.sqrt(Math.pow(x - bandX, 2) + Math.pow(y - bandY, 2));
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
        
        // Add console log for debugging
        console.log("Started dragging band:", clickedBandId);
      } else {
        // Check if click is near center line
        const centerY = rect.height / 2;
        const distanceToCenter = Math.abs(y - centerY);
        
        if (distanceToCenter <= CENTER_LINE_THRESHOLD) {
          // Add new band at center line
          const frequency = EQCoordinateUtils.xToFreq(x, rect.width, freqRange);
          
          // Create a new band (gain is 0 since it's on center line)
          const newBand = {
            frequency: Math.max(20, Math.min(20000, frequency)),
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
            console.log("Created and started dragging new band:", newBandId);
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
      }
      onBandSelect(null);
    }
  }, [bands, freqRange, hoveredBandId, draggingBand, onBandAdd, onBandRemove, onBandSelect, canvasRef]);

  return {
    handleMouseMove,
    handleMouseDown,
    isShiftPressed,
    hoveredBandId,
    draggingBand,
    ghostNode
  };
} 