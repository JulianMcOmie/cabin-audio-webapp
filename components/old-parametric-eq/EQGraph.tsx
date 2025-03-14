import React, { useRef, useEffect, useState, useCallback } from 'react';
import { EQBand, FrequencyResponse } from './types';
import { EQBandRenderer } from './EQBandRenderer';
import { EQCoordinateUtils } from './EQCoordinateUtils';
import { EQCurveRenderer } from './EQCurveRenderer';
import styles from './EQ.module.css';

interface EQGraphProps {
  bands: EQBand[];
  frequencyResponse: FrequencyResponse[];
  onBandAdd: (frequency: number, gain: number) => void;
  onBandUpdate: (id: string, updates: Partial<EQBand>) => void;
  onBandRemove: (id: string) => void;
  onBandHover: (id: string | null) => void;
}

interface ShiftOffset {
  x: number;
  y: number;
}

interface GhostNode {
  x: number;
  y: number;
  visible: boolean;
}

const EQGraph: React.FC<EQGraphProps> = ({
  bands,
  frequencyResponse,
  onBandAdd,
  onBandUpdate,
  onBandRemove,
  onBandHover,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draggingBand, setDraggingBand] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [newBandId, setNewBandId] = useState<string | null>(null);
  const [shiftOffset, setShiftOffset] = useState<ShiftOffset>({ x: 0, y: 0 });
  const [qOffset, setQOffset] = useState(0);
  const [ghostNode, setGhostNode] = useState<GhostNode>({ x: 0, y: 0, visible: false });
  
  // Fixed frequency range (no zoom)
  const freqRange = { min: 20, max: 20000 };
  
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
        x >= 0 && x <= canvas.width && 
        y >= 0 && y <= canvas.height;
      
      // Clamp x and y to canvas boundaries for calculation purposes
      // This ensures the band stays within the visible area
      x = Math.max(0, Math.min(canvas.width, x));
      y = Math.max(0, Math.min(canvas.height, y));
      
      // Calculate frequency from x position (clamped to valid range)
      const frequency = EQCoordinateUtils.xToFreq(x, canvas.width, freqRange);
      const clampedFrequency = Math.max(20, Math.min(20000, frequency));
      
      if (isShiftPressed) {
        // Shift + drag adjusts Q
        const band = bands.find(b => b.id === draggingBand);
        if (band) {
          // Track Q adjustment with qOffset
          setQOffset(prev => prev + e.movementY);
          
          // Only update shiftOffset if mouse is inside canvas
          // This ensures position continuity when returning to canvas
          if (isInsideCanvas) {
            setShiftOffset(prev => ({
              x: prev.x + e.movementX,
              y: prev.y + e.movementY
            }));
          }
          
          // Use qOffset to compute Q
          // Start with the current Q value or a default
          const currentQ = band.Q || 1.0;
          
          // Scale factor determines how quickly Q changes with movement
          const scaleFactor = 0.02;
          
          // Calculate new Q: moving up (negative offset) increases Q, moving down decreases Q
          const newQ = Math.max(0.1, Math.min(10, currentQ * Math.exp(-e.movementY * scaleFactor)));
          
          onBandUpdate(draggingBand, { Q: newQ });
        }
      } else {
        // Normal drag adjusts frequency and gain
        const gain = EQCoordinateUtils.yToGain(y, canvas.height);
        const clampedGain = Math.max(-24, Math.min(24, gain));

        // If we're outside of the canvas, but we move towards the canvas, we can reduce shiftOffset accordingly
        if (!isInsideCanvas) {
          console.log("outside of canvas, horizontal shiftOffset: ", shiftOffset.x, "vertical shiftOffset: ", shiftOffset.y);
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
      setNewBandId(null);
      // Don't reset shift offset or qOffset here, so they persist between drag operations
    };
    
    // Add global event listeners
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    // Clean up
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, draggingBand, bands, isShiftPressed, onBandUpdate, shiftOffset]);

  // Update canvas size on resize
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const container = canvas.parentElement;
      if (!container) return;
      
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      
      drawGraph();
    };
    
    window.addEventListener('resize', updateCanvasSize);
    updateCanvasSize();
    
    return () => {
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  // Redraw graph when relevant props change
  useEffect(() => {
    drawGraph();
  }, [bands, frequencyResponse, isShiftPressed, draggingBand, ghostNode]);

  // Draw the graph
  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    
    // Clear canvas and draw background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    
    // Draw horizontal grid lines (gain)
    for (let db = -24; db <= 24; db += 6) {
      const y = EQCoordinateUtils.gainToY(db, height);
      
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      
      // Label the dB values
      ctx.fillStyle = '#888';
      ctx.font = '10px Arial';
      ctx.fillText(`${db}dB`, 5, y - 2);
    }
    
    // Draw vertical grid lines (frequency)
    const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const freq of frequencies) {
      const x = EQCoordinateUtils.freqToX(freq, width, freqRange);
      
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      
      // Label the frequency
      ctx.fillStyle = '#888';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      
      let label = freq.toString();
      if (freq >= 1000) {
        label = `${freq / 1000}k`;
      }
      
      ctx.fillText(label, x, height - 5);
    }
    
    // Draw center line
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Draw individual band responses using the EQBandRenderer
    bands.forEach(band => {
      EQBandRenderer.drawBand(
        ctx,
        band,
        (freq) => EQCoordinateUtils.freqToX(freq, width, freqRange),
        (gain) => EQCoordinateUtils.gainToY(gain, height),
        (x) => EQCoordinateUtils.xToFreq(x, width, freqRange),
        EQCoordinateUtils.getBandColor,
        width,
        height,
        draggingBand === band.id,
        isShiftPressed,
        freqRange
      );
    });

    // Draw the combined frequency response curve
    if (frequencyResponse.length > 0) {
      EQCurveRenderer.drawFrequencyResponse(
        ctx,
        frequencyResponse,
        width,
        height,
        freqRange
      );
    }
    
    // Draw ghost node when near center line
    if (ghostNode.visible) {
      // Get the frequency from the ghost node's x position
      const frequency = EQCoordinateUtils.xToFreq(ghostNode.x, width, freqRange);
      
      // Use the EQBandRenderer to draw the ghost node handle
      EQBandRenderer.drawBandHandle(
        ctx,
        ghostNode.x,
        ghostNode.y,
        EQCoordinateUtils.getBandColor(frequency, 0.7),
        true
      );
    }
  }, [bands, frequencyResponse, isShiftPressed, draggingBand, ghostNode]);

  // This now only handles hover state and initial mouse down
  const handleMouseMove = (e: React.MouseEvent) => {
    // Only handle hover state here - dragging is handled by the global handler
    if (draggingBand) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if hovering over a band
    let hoveredBand: string | null = null;
    
    for (const band of bands) {
      if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
        const bandX = EQCoordinateUtils.freqToX(band.frequency, canvas.width, freqRange);
        const bandY = EQCoordinateUtils.gainToY(band.gain, canvas.height);
        
        const distance = Math.sqrt(Math.pow(x - bandX, 2) + Math.pow(y - bandY, 2));
        if (distance <= 10) {
          hoveredBand = band.id;
          break;
        }
      }
    }
    
    onBandHover(hoveredBand);
    
    // Check if mouse is near center line to show ghost node
    const centerY = canvas.height / 2;
    const distanceToCenter = Math.abs(y - centerY);
    
    if (distanceToCenter <= CENTER_LINE_THRESHOLD && !hoveredBand) {
      // Show ghost node on center line
      setGhostNode({
        x: x,
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
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Reset both offsets when starting a new drag
    setShiftOffset({ x: 0, y: 0 });
    setQOffset(0);
    
    // Check if clicking on a band
    let clickedBand: string | null = null;
    
    for (const band of bands) {
      if (band.frequency >= freqRange.min && band.frequency <= freqRange.max) {
        const bandX = EQCoordinateUtils.freqToX(band.frequency, canvas.width, freqRange);
        const bandY = EQCoordinateUtils.gainToY(band.gain, canvas.height);
        
        const distance = Math.sqrt(Math.pow(x - bandX, 2) + Math.pow(y - bandY, 2));
        if (distance <= 10) {
          clickedBand = band.id;
          break;
        }
      }
    }
    
    if (e.button === 0) { // Left click
      if (clickedBand) {
        // Start dragging existing band
        setDraggingBand(clickedBand);
        setIsDragging(true);
      } else {
        // Check if click is near center line
        const centerY = canvas.height / 2;
        const distanceToCenter = Math.abs(y - centerY);
        
        if (distanceToCenter <= CENTER_LINE_THRESHOLD) {
          // Add new band at center line
          const frequency = EQCoordinateUtils.xToFreq(x, canvas.width, freqRange);
          
          // Generate a unique ID for the new band
          const newId = `band-${Date.now()}`;
          setNewBandId(newId);
          
          // Add the band with this ID (at 0dB gain since it's on center line)
          onBandAdd(frequency, 0);
          
          // Start dragging the new band immediately
          setDraggingBand(newId);
          setIsDragging(true);
          
          // Hide ghost node
          setGhostNode(prev => ({
            ...prev,
            visible: false
          }));
        }
      }
    } else if (e.button === 2 && clickedBand) { // Right click
      // Remove band
      onBandRemove(clickedBand);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={styles.eqGraph}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};

export default EQGraph; 