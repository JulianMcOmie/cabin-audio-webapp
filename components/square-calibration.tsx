"use client"

import { useRef, useEffect, useState } from "react"
import * as squareCalibrationAudio from '@/lib/audio/squareCalibrationAudio'
import { Corner } from '@/lib/audio/squareCalibrationAudio'
import { Button } from "@/components/ui/button"
import { Play } from "lucide-react"

// Handle size
const HANDLE_SIZE = 8; // Size of resize handles in pixels
const HANDLE_TOUCH_SIZE = 24; // Size of touch area for handles

interface SquareCalibrationProps {
  isPlaying: boolean;
  disabled?: boolean;
  className?: string;
}

export function SquareCalibration({ isPlaying, disabled = false, className = "" }: SquareCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  
  // State for dragging and resizing
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  
  // State for tracking the active corner
  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  
  // Initialize square position and size with default values from audio module
  const [squarePosition, setSquarePosition] = useState<[number, number]>([0.2, 0.2]);
  const [squareSize, setSquareSize] = useState<[number, number]>([0.6, 0.6]);
  
  // Set up observer to detect theme changes
  useEffect(() => {
    // Initial check
    setIsDarkMode(document.documentElement.classList.contains("dark"));
    
    // Set up mutation observer to watch for class changes on html element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const newIsDarkMode = document.documentElement.classList.contains("dark");
          setIsDarkMode(newIsDarkMode);
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    
    return () => {
      observer.disconnect();
    };
  }, []);
  
  // Update canvas size on resize
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
  
  // Initialize with square position and size from audio module
  useEffect(() => {
    const audioPlayer = squareCalibrationAudio.getSquareCalibrationAudio();
    const { position, size } = audioPlayer.getSquare();
    
    setSquarePosition(position);
    setSquareSize(size);
  }, []);
  
  // Connect to audio module for corner activation events
  useEffect(() => {
    const audioPlayer = squareCalibrationAudio.getSquareCalibrationAudio();
    
    const handleCornerActivation = (corner: Corner) => {
      setActiveCorner(corner);
      
      // Reset active corner after animation time
      setTimeout(() => {
        setActiveCorner(null);
      }, 200);
    };
    
    audioPlayer.addCornerListener(handleCornerActivation);
    
    return () => {
      audioPlayer.removeCornerListener(handleCornerActivation);
    };
  }, []);
  
  // Update audio module when square position/size changes
  useEffect(() => {
    const audioPlayer = squareCalibrationAudio.getSquareCalibrationAudio();
    audioPlayer.setSquare(squarePosition, squareSize);
  }, [squarePosition, squareSize]);
  
  // Update audio player when playing state changes
  useEffect(() => {
    const audioPlayer = squareCalibrationAudio.getSquareCalibrationAudio();
    audioPlayer.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Draw the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas dimensions with proper DPI scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    
    // Skip rendering if size is not set yet
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    
    // Draw main square border
    ctx.strokeStyle = isDarkMode ? '#52525b' : '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, canvasSize.width - 4, canvasSize.height - 4);
    
    // Calculate inner square position in pixels
    const innerX = squarePosition[0] * canvasSize.width;
    const innerY = (1 - squarePosition[1] - squareSize[1]) * canvasSize.height; // Convert from bottom-left to top-left origin
    const innerWidth = squareSize[0] * canvasSize.width;
    const innerHeight = squareSize[1] * canvasSize.height;
    
    // Draw inner square
    ctx.strokeStyle = isDarkMode ? '#a1a1aa' : '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(innerX, innerY, innerWidth, innerHeight);
    
    // Draw corner dots
    const cornerDotRadius = 4;
    const cornerPositions = [
      { x: innerX, y: innerY + innerHeight, corner: Corner.BOTTOM_LEFT }, // Bottom-left
      { x: innerX + innerWidth, y: innerY, corner: Corner.TOP_RIGHT },   // Top-right
      { x: innerX + innerWidth, y: innerY + innerHeight, corner: Corner.BOTTOM_RIGHT }, // Bottom-right
      { x: innerX, y: innerY, corner: Corner.TOP_LEFT }                  // Top-left
    ];
    
    cornerPositions.forEach(pos => {
      ctx.beginPath();
      
      // Draw larger pulsing dot if this corner is active
      if (activeCorner !== null && pos.corner === activeCorner) {
        ctx.fillStyle = isDarkMode ? '#38bdf8' : '#0284c7'; // sky-400 or sky-600
        ctx.arc(pos.x, pos.y, cornerDotRadius * 1.8, 0, Math.PI * 2);
      } else {
        ctx.fillStyle = isDarkMode ? '#94a3b8' : '#64748b'; // slate-400 or slate-500
        ctx.arc(pos.x, pos.y, cornerDotRadius, 0, Math.PI * 2);
      }
      
      ctx.fill();
    });
    
    // Draw corner handles
    const handlePositions = [
      { x: innerX, y: innerY, type: 'nw' },                       // Top-left
      { x: innerX + innerWidth / 2, y: innerY, type: 'n' },       // Top-center
      { x: innerX + innerWidth, y: innerY, type: 'ne' },          // Top-right
      { x: innerX + innerWidth, y: innerY + innerHeight / 2, type: 'e' }, // Middle-right
      { x: innerX + innerWidth, y: innerY + innerHeight, type: 'se' },    // Bottom-right
      { x: innerX + innerWidth / 2, y: innerY + innerHeight, type: 's' }, // Bottom-center
      { x: innerX, y: innerY + innerHeight, type: 'sw' },                 // Bottom-left
      { x: innerX, y: innerY + innerHeight / 2, type: 'w' }               // Middle-left
    ];
    
    // Draw handles
    handlePositions.forEach(pos => {
      ctx.fillStyle = isDarkMode ? '#a1a1aa' : '#94a3b8';
      ctx.fillRect(pos.x - HANDLE_SIZE / 2, pos.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    });
    
    // Draw center if dragging
    if (isDragging && !currentHandle) {
      ctx.fillStyle = isDarkMode ? 'rgba(56, 189, 248, 0.5)' : 'rgba(2, 132, 199, 0.5)';
      ctx.beginPath();
      ctx.arc(innerX + innerWidth / 2, innerY + innerHeight / 2, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    
  }, [canvasSize, isDarkMode, squarePosition, squareSize, activeCorner, isDragging, currentHandle]);
  
  // Handle mouse/touch interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Convert to normalized coordinates for position
    setDragStartPos({
      x: mouseX / rect.width,
      y: mouseY / rect.height
    });
    
    // Calculate inner square position in pixels
    const innerX = squarePosition[0] * rect.width;
    const innerY = (1 - squarePosition[1] - squareSize[1]) * rect.height; // Convert from bottom-left to top-left origin
    const innerWidth = squareSize[0] * rect.width;
    const innerHeight = squareSize[1] * rect.height;
    
    // Check if clicking on a handle (with larger touch area)
    const handlePositions = [
      { x: innerX, y: innerY, type: 'nw' },                       // Top-left
      { x: innerX + innerWidth / 2, y: innerY, type: 'n' },       // Top-center
      { x: innerX + innerWidth, y: innerY, type: 'ne' },          // Top-right
      { x: innerX + innerWidth, y: innerY + innerHeight / 2, type: 'e' }, // Middle-right
      { x: innerX + innerWidth, y: innerY + innerHeight, type: 'se' },    // Bottom-right
      { x: innerX + innerWidth / 2, y: innerY + innerHeight, type: 's' }, // Bottom-center
      { x: innerX, y: innerY + innerHeight, type: 'sw' },                 // Bottom-left
      { x: innerX, y: innerY + innerHeight / 2, type: 'w' }               // Middle-left
    ];
    
    for (const handle of handlePositions) {
      const distance = Math.sqrt(
        Math.pow(mouseX - handle.x, 2) + Math.pow(mouseY - handle.y, 2)
      );
      
      if (distance < HANDLE_TOUCH_SIZE / 2) {
        // Found a handle
        setCurrentHandle(handle.type);
        setIsDragging(true);
        return;
      }
    }
    
    // Check if clicking inside the square
    if (
      mouseX >= innerX && mouseX <= innerX + innerWidth &&
      mouseY >= innerY && mouseY <= innerY + innerHeight
    ) {
      setIsDragging(true);
      setCurrentHandle(null); // Dragging the whole square
    }
  };
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Convert to normalized coordinates
    const normalizedX = mouseX / rect.width;
    const normalizedY = mouseY / rect.height;
    
    // Calculate delta from start position
    const deltaX = normalizedX - dragStartPos.x;
    const deltaY = normalizedY - dragStartPos.y;
    
    // Get current values
    let [posX, posY] = squarePosition;
    let [width, height] = squareSize;
    
    if (currentHandle) {
      // Handling resize
      if (currentHandle.includes('n')) {
        // Top edge - need to adjust y position and height
        const newHeight = height + deltaY;
        if (newHeight > 0.1) {
          // Convert from top-left to bottom-left origin for Y
          posY = posY - deltaY; 
          height = newHeight;
        }
      }
      
      if (currentHandle.includes('e')) {
        // Right edge
        const newWidth = width + deltaX;
        if (newWidth > 0.1) {
          width = newWidth;
        }
      }
      
      if (currentHandle.includes('s')) {
        // Bottom edge
        const newHeight = height - deltaY;
        if (newHeight > 0.1) {
          height = newHeight;
        }
      }
      
      if (currentHandle.includes('w')) {
        // Left edge - need to adjust x position and width
        const newWidth = width - deltaX;
        if (newWidth > 0.1) {
          posX = posX + deltaX;
          width = newWidth;
        }
      }
    } else {
      // Dragging the whole square
      posX = Math.max(0, Math.min(1 - width, posX + deltaX));
      
      // For Y, remember we're converting between top-left (for display) and bottom-left (for data)
      const newPosY = posY - deltaY;
      posY = Math.max(0, Math.min(1 - height, newPosY));
    }
    
    // Clamp values to keep square within bounds
    posX = Math.max(0, Math.min(1 - width, posX));
    posY = Math.max(0, Math.min(1 - height, posY));
    width = Math.max(0.1, Math.min(1 - posX, width));
    height = Math.max(0.1, Math.min(1 - posY, height));
    
    // Update state
    setSquarePosition([posX, posY]);
    setSquareSize([width, height]);
    setDragStartPos({ x: normalizedX, y: normalizedY });
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
    setCurrentHandle(null);
  };
  
  // Apply cursor styles based on current handle
  const getCursorStyle = (): string => {
    if (disabled) return 'not-allowed';
    if (!isDragging && !currentHandle) return 'grab';
    if (isDragging && !currentHandle) return 'grabbing';
    
    switch (currentHandle) {
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'n': case 's': return 'ns-resize';
      case 'e': case 'w': return 'ew-resize';
      default: return 'grab';
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="relative bg-background/50 rounded-lg p-3">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-square rounded cursor-${getCursorStyle()} ${disabled ? "opacity-70" : ""}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: getCursorStyle() }}
        />
      </div>
      
      <div className="text-xs text-center text-muted-foreground">
        Drag the square to move, drag corners or edges to resize
      </div>
    </div>
  );
} 