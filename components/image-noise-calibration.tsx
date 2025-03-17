"use client"

import { useRef, useEffect, useState } from "react"
import { Play, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import * as imageNoiseCalibration from '@/lib/audio/imageNoiseCalibration'

interface ImageNoiseCalibrationProps {
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  disabled?: boolean;
}

export function ImageNoiseCalibration({ isPlaying, setIsPlaying, disabled = false }: ImageNoiseCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedPattern, setSelectedPattern] = useState<string>('H')
  const [availablePatterns, setAvailablePatterns] = useState<string[]>(['H', 'Z', 'SQUARE'])
  const [gridState, setGridState] = useState<boolean[][]>([])
  const [isDarkMode, setIsDarkMode] = useState(false)
  
  // Grid dimensions
  const GRID_ROWS = 7;
  const GRID_COLS = 9;
  
  // Initialize the image noise calibrator
  useEffect(() => {
    const calibrator = imageNoiseCalibration.getImageNoiseCalibrator();
    
    // Update available patterns
    setAvailablePatterns(calibrator.getAvailableImagePatterns());
    
    // Get initial grid state
    setGridState(calibrator.getGridState());
    
    // Set selected pattern
    setSelectedPattern(calibrator.getCurrentImageKey());
    
    // Detect dark mode
    setIsDarkMode(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    return () => {
      // Clean up on unmount
      calibrator.setPlaying(false);
    };
  }, []);
  
  // Update when playing state changes
  useEffect(() => {
    const calibrator = imageNoiseCalibration.getImageNoiseCalibrator();
    calibrator.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Update when pattern selection changes
  useEffect(() => {
    const calibrator = imageNoiseCalibration.getImageNoiseCalibrator();
    calibrator.setImagePattern(selectedPattern);
    setGridState(calibrator.getGridState());
  }, [selectedPattern]);
  
  // Draw the grid on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get canvas dimensions
    const width = canvas.width;
    const height = canvas.height;
    
    // Calculate cell size
    const cellWidth = width / GRID_COLS;
    const cellHeight = height / GRID_ROWS;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background
    ctx.fillStyle = isDarkMode ? '#1a1a1a' : '#f5f5f5';
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    ctx.strokeStyle = isDarkMode ? '#333333' : '#dddddd';
    ctx.lineWidth = 1;
    
    // Draw vertical grid lines
    for (let i = 0; i <= GRID_COLS; i++) {
      const x = i * cellWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // Draw horizontal grid lines
    for (let i = 0; i <= GRID_ROWS; i++) {
      const y = i * cellHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Draw active points
    if (gridState.length > 0) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (gridState[row] && gridState[row][col]) {
            // Calculate position
            const x = col * cellWidth;
            const y = row * cellHeight;
            
            // Draw filled cell
            ctx.fillStyle = isPlaying ? '#4f7eff' : '#60a5fa';
            ctx.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
            
            // Add highlight dot in center
            ctx.fillStyle = isPlaying ? '#ffffff' : '#f0f9ff';
            ctx.beginPath();
            ctx.arc(
              x + cellWidth / 2, 
              y + cellHeight / 2, 
              Math.min(cellWidth, cellHeight) * 0.1,
              0, 
              Math.PI * 2
            );
            ctx.fill();
          }
        }
      }
    }
  }, [gridState, isPlaying, isDarkMode]);
  
  // Handle canvas click to toggle points
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Get click position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Calculate cell size
    const cellWidth = canvas.width / GRID_COLS;
    const cellHeight = canvas.height / GRID_ROWS;
    
    // Calculate grid coordinates
    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);
    
    // Toggle point
    const calibrator = imageNoiseCalibration.getImageNoiseCalibrator();
    calibrator.toggleGridPoint(row, col);
    
    // Update grid state
    setGridState(calibrator.getGridState());
    setSelectedPattern(calibrator.getCurrentImageKey());
  };
  
  // Handle pattern selection
  const handlePatternSelect = (pattern: string) => {
    setSelectedPattern(pattern);
  };
  
  // Toggle playback
  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
  };
  
  return (
    <div className={`p-4 rounded-lg border ${disabled ? 'opacity-50' : ''}`}>
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <Label htmlFor="image-pattern" className="text-sm font-medium">Image Pattern</Label>
          <div className="flex items-center">
            <Button
              size="sm"
              variant={isPlaying ? "default" : "outline"}
              onClick={togglePlayback}
              disabled={disabled}
              className={isPlaying ? "bg-electric-blue hover:bg-electric-blue/90 text-white" : ""}
            >
              <Play className="h-4 w-4 mr-2" />
              {isPlaying ? "Stop" : "Play"}
            </Button>
          </div>
        </div>
        
        <Select 
          value={selectedPattern} 
          onValueChange={handlePatternSelect}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an image pattern" />
          </SelectTrigger>
          <SelectContent>
            {availablePatterns.map(pattern => (
              <SelectItem key={pattern} value={pattern}>
                {pattern === 'CUSTOM' ? 'Custom Pattern' : pattern}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div className="border rounded-lg overflow-hidden mb-4">
        <canvas 
          ref={canvasRef} 
          width={360} 
          height={280} 
          onClick={handleCanvasClick}
          className={`w-full h-auto ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        />
      </div>
      
      <div className="text-sm text-muted-foreground">
        <p className="mb-2">Click on the grid to toggle points and create custom patterns.</p>
        <p>Each active point represents a frequency band played with a specific pan position:</p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li><strong>Horizontal position</strong>: Determines panning (left to right)</li>
          <li><strong>Vertical position</strong>: Controls frequency (low to high)</li>
        </ul>
      </div>
    </div>
  );
} 