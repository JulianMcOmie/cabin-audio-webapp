"use client"

import { useRef, useEffect, useState } from "react"
import * as squareCalibrationAudio from '@/lib/audio/squareCalibrationAudio'
import { Corner } from '@/lib/audio/squareCalibrationAudio'
// import { Button } from "@/components/ui/button"
// import { Play } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"

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
  const [initialSquareState, setInitialSquareState] = useState<{
    position: [number, number];
    size: [number, number];
  } | null>(null);
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  
  // State for tracking the active corner
  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  
  // State for tracking active intermediate positions
  const [activePosition, setActivePosition] = useState<DiagonalPosition | null>(null);
  
  // State for dot density
  const [dotDensity, setDotDensity] = useState<number>(2);
  
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
    
    // Get initial dot density
    setDotDensity(audioPlayer.getDotDensity());
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
  
  // Connect to audio module for intermediate position activations
  useEffect(() => {
    const audioPlayer = squareCalibrationAudio.getSquareCalibrationAudio();
    
    const handlePositionActivation = (position: DiagonalPosition, isCorner: boolean) => {
      // Only highlight intermediate positions (corners are handled by the corner listener)
      if (!isCorner) {
        setActivePosition(position);
        
        // Reset active position after animation time
        setTimeout(() => {
          setActivePosition(null);
        }, 200);
      }
    };
    
    audioPlayer.addPositionListener(handlePositionActivation);
    
    return () => {
      audioPlayer.removePositionListener(handlePositionActivation);
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
    
    // Set diagonal pattern mode by default (removing the toggle)
    audioPlayer.setPatternMode('diagonal');
    
    // Set playing state
    audioPlayer.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Update dot density in audio player when it changes
  useEffect(() => {
    const audioPlayer = squareCalibrationAudio.getSquareCalibrationAudio();
    audioPlayer.setDotDensity(dotDensity);
  }, [dotDensity]);
  
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
    
    // Create vertical gradient that spans the entire canvas height
    // This way, the square acts as a "window" into a larger gradient
    const gradient = ctx.createLinearGradient(0, canvasSize.height, 0, 0);
    
    // Add color stops for the full-height gradient (matches EQ band colors)
    // Using more vibrant colors that match the band colors in the EQ
    gradient.addColorStop(0, isDarkMode ? 'rgba(239, 68, 68, 0.85)' : 'rgba(220, 38, 38, 0.7)');    // red (low freq)
    gradient.addColorStop(0.15, isDarkMode ? 'rgba(249, 115, 22, 0.85)' : 'rgba(234, 88, 12, 0.7)'); // orange
    gradient.addColorStop(0.3, isDarkMode ? 'rgba(245, 158, 11, 0.85)' : 'rgba(217, 119, 6, 0.7)');  // amber
    gradient.addColorStop(0.45, isDarkMode ? 'rgba(132, 204, 22, 0.85)' : 'rgba(101, 163, 13, 0.7)'); // lime
    gradient.addColorStop(0.6, isDarkMode ? 'rgba(34, 197, 94, 0.85)' : 'rgba(22, 163, 74, 0.7)');   // green
    gradient.addColorStop(0.75, isDarkMode ? 'rgba(6, 182, 212, 0.85)' : 'rgba(8, 145, 178, 0.7)');  // cyan
    gradient.addColorStop(1, isDarkMode ? 'rgba(99, 102, 241, 0.85)' : 'rgba(79, 70, 229, 0.7)');    // indigo (high freq)
    
    // Fill the inner square with the gradient
    ctx.fillStyle = gradient;
    ctx.fillRect(innerX, innerY, innerWidth, innerHeight);
    
    // Draw inner square border
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
        ctx.fill();
      }
    });
    
    // Draw center if dragging
    if (isDragging) {
      ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';
      ctx.beginPath();
      ctx.arc(innerX + innerWidth / 2, innerY + innerHeight / 2, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    
  }, [canvasSize, isDarkMode, squarePosition, squareSize, activeCorner, activePosition, isDragging, currentHandle, dotDensity]);
  
//   // Convert screen Y coordinates to our bottom-left origin system
//   const convertScreenYToNormalizedY = (screenY: number, height: number): number => {
//     if (!canvasRef.current) return 0;
//     const rect = canvasRef.current.getBoundingClientRect();
//     // Convert screen Y (where top is 0) to our normalized Y (where bottom is 0)
//     return 1 - ((screenY - rect.top) / rect.height) - height;
//   };

  // Convert normalized Y (bottom origin) to screen Y (top origin)
  const convertNormalizedYToScreenY = (normalizedY: number, height: number): number => {
    if (!canvasRef.current) return 0;
    const rect = canvasRef.current.getBoundingClientRect();
    // Convert normalized Y (where bottom is 0) to screen Y (where top is 0)
    return rect.top + (1 - normalizedY - height) * rect.height;
  };
  
  // Handle mouse/touch interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate inner square position in pixels
    const innerX = squarePosition[0] * rect.width;
    const innerY = (1 - squarePosition[1] - squareSize[1]) * rect.height; // Convert from bottom-left to top-left origin
    const innerWidth = squareSize[0] * rect.width;
    const innerHeight = squareSize[1] * rect.height;
    
    // Store the initial mouse position
    setDragStartPos({
      x: mouseX,
      y: mouseY
    });
    
    // Store the initial square state
    setInitialSquareState({
      position: [...squarePosition],
      size: [...squareSize]
    });
    
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
    if (!isDragging || disabled || !initialSquareState) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate delta from start position in pixels
    const deltaX = mouseX - dragStartPos.x;
    const deltaY = mouseY - dragStartPos.y;
    
    // Convert deltas to normalized coordinates
    const normalizedDeltaX = deltaX / rect.width;
    const normalizedDeltaY = deltaY / rect.height;
    
    // Get initial position and size
    const [initialX, initialY] = initialSquareState.position;
    const [initialWidth, initialHeight] = initialSquareState.size;
    
    let newX = initialX;
    let newY = initialY; 
    let newWidth = initialWidth;
    let newHeight = initialHeight;
    
    if (!currentHandle) {
      // Dragging the whole square
      newX = initialX + normalizedDeltaX;
      newY = initialY - normalizedDeltaY; // Invert Y delta because our Y origin is at bottom
      
      // Clamp to keep within bounds
      newX = Math.max(0, Math.min(1 - initialWidth, newX));
      newY = Math.max(0, Math.min(1 - initialHeight, newY));
    } else {
      // Resizing
      const aspectRatio = initialWidth / initialHeight;
      
      if (currentHandle.includes('n')) {
        // Top edge - move the top edge
        const newScreenTop = Math.min(
          convertNormalizedYToScreenY(initialY, initialHeight) + deltaY,
          convertNormalizedYToScreenY(initialY, 0) - HANDLE_SIZE // Don't let height become negative
        );
        
        // Calculate how much the height changed
        const newScreenHeight = convertNormalizedYToScreenY(initialY, 0) - newScreenTop;
        newHeight = newScreenHeight / rect.height;
        
        // Update Y position (bottom) to account for top edge moving
        newY = initialY + initialHeight - newHeight;
        
        // If corner handle, maintain aspect ratio
        if (currentHandle === 'nw' || currentHandle === 'ne') {
          const heightChange = newHeight - initialHeight;
          const widthChange = heightChange * aspectRatio;
          
          if (currentHandle === 'nw') {
            newWidth = initialWidth + widthChange;
            newX = initialX - widthChange;
          } else {
            newWidth = initialWidth + widthChange;
          }
        }
      }
      
      if (currentHandle.includes('s')) {
        // Bottom edge - just adjust height
        const pixelHeight = Math.max(HANDLE_SIZE, initialHeight * rect.height - deltaY);
        newHeight = pixelHeight / rect.height;
        
        // If corner handle, maintain aspect ratio
        if (currentHandle === 'sw' || currentHandle === 'se') {
          const heightChange = newHeight - initialHeight;
          const widthChange = heightChange * aspectRatio;
          
          if (currentHandle === 'sw') {
            newWidth = initialWidth + widthChange;
            newX = initialX - widthChange;
          } else {
            newWidth = initialWidth + widthChange;
          }
        }
      }
      
      if (currentHandle.includes('e')) {
        // Right edge - just adjust width
        const pixelWidth = Math.max(HANDLE_SIZE, initialWidth * rect.width + deltaX);
        newWidth = pixelWidth / rect.width;
        
        // If corner handle and not already handled by 'n' or 's', maintain aspect ratio
        if ((currentHandle === 'ne' || currentHandle === 'se') && 
            !currentHandle.includes('n') && !currentHandle.includes('s')) {
          const widthChange = newWidth - initialWidth;
          const heightChange = widthChange / aspectRatio;
          
          if (currentHandle === 'ne') {
            newHeight = initialHeight + heightChange;
            newY = initialY - heightChange;
          } else {
            newHeight = initialHeight + heightChange;
          }
        }
      }
      
      if (currentHandle.includes('w')) {
        // Left edge - adjust x position and width
        const newLeft = Math.min(
          initialX * rect.width + deltaX, 
          (initialX + initialWidth) * rect.width - HANDLE_SIZE // Don't let width become negative
        );
        
        const widthReduction = newLeft / rect.width - initialX;
        newX = initialX + widthReduction;
        newWidth = initialWidth - widthReduction;
        
        // If corner handle and not already handled by 'n' or 's', maintain aspect ratio
        if ((currentHandle === 'nw' || currentHandle === 'sw') && 
            !currentHandle.includes('n') && !currentHandle.includes('s')) {
          const widthChange = newWidth - initialWidth;
          const heightChange = widthChange / aspectRatio;
          
          if (currentHandle === 'nw') {
            newHeight = initialHeight + heightChange;
            newY = initialY - heightChange;
          } else {
            newHeight = initialHeight + heightChange;
          }
        }
      }
    }
    
    // Clamp values to keep square within bounds
    newX = Math.max(0, Math.min(1 - 0.05, newX));
    newY = Math.max(0, Math.min(1 - 0.05, newY));
    newWidth = Math.max(0.05, Math.min(1 - newX, newWidth));
    newHeight = Math.max(0.05, Math.min(1 - newY, newHeight));
    
    // Update state
    setSquarePosition([newX, newY]);
    setSquareSize([newWidth, newHeight]);
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
    setCurrentHandle(null);
    setInitialSquareState(null);
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

  // Handle changes to dot density
  const handleDotDensityChange = (value: string) => {
    const density = parseInt(value, 10);
    setDotDensity(density);
  };

  return (
    <div className={`space-y-2 ${className}`}>
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
      
      <div className="flex justify-between items-center">
        <div className="text-xs text-muted-foreground">
          Drag to move, resize from edges
        </div>
      </div>
      
      <div className="flex flex-col space-y-2">
        <div className="text-sm font-medium">Dot Density</div>
        <RadioGroup 
          value={dotDensity.toString()} 
          onValueChange={handleDotDensityChange}
          className="flex space-x-2"
          disabled={disabled || isPlaying}
        >
          <div className="flex items-center space-x-1">
            <RadioGroupItem value="2" id="density-2" />
            <Label htmlFor="density-2">2</Label>
          </div>
          <div className="flex items-center space-x-1">
            <RadioGroupItem value="3" id="density-3" />
            <Label htmlFor="density-3">3</Label>
          </div>
          <div className="flex items-center space-x-1">
            <RadioGroupItem value="4" id="density-4" />
            <Label htmlFor="density-4">4</Label>
          </div>
          <div className="flex items-center space-x-1">
            <RadioGroupItem value="5" id="density-5" />
            <Label htmlFor="density-5">5</Label>
          </div>
        </RadioGroup>
        <div className="text-xs text-muted-foreground">
          Higher density plays additional points along diagonals
        </div>
      </div>
    </div>
  );
} 