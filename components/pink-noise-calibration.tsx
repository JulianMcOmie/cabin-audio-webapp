"use client"

import { useRef, useEffect, useState } from "react"
import { Play, Plus, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import * as pinkNoiseCalibration from '@/lib/audio/pinkNoiseCalibration'

interface PinkNoiseCalibrationProps {
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  disabled?: boolean;
}

export function PinkNoiseCalibration({ isPlaying, setIsPlaying, disabled = false }: PinkNoiseCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rowCount, setRowCount] = useState(3) // Default to 3 rows
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [panValue, setPanValue] = useState(0) // Default to center (0)
  const [isDarkMode, setIsDarkMode] = useState(false)
  
  // Constants
  const MIN_ROWS = 1;
  const MAX_ROWS = 7;
  
  // Initialize the pink noise calibrator
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    
    return () => {
      // Clean up on unmount
      calibrator.setPlaying(false);
    };
  }, []);
  
  // Update when playing state changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Update when row count changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setRowCount(rowCount);
    // Reset selected rows when row count changes
    setSelectedRows(new Set());
  }, [rowCount]);
  
  // Update when selected rows change
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    
    // Clear all rows in calibrator
    for (let i = 0; i < rowCount; i++) {
      if (calibrator.getSelectedRows().has(i) !== selectedRows.has(i)) {
        calibrator.toggleRow(i);
      }
    }
  }, [selectedRows, rowCount]);

  // Update when pan value changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPan(panValue);
  }, [panValue]);

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
  
  // Draw the pink noise calibration grid
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

    // Add semi-transparent background
    ctx.fillStyle = isDarkMode ? "rgba(24, 24, 36, 0.4)" : "rgba(255, 255, 255, 0.4)"
    ctx.fillRect(0, 0, rect.width, rect.height)

    // Define row height
    const rowHeight = rect.height / rowCount
    
    // Draw frequency bands background
    for (let i = 0; i < rowCount; i++) {
      const y = i * rowHeight
      
      // Determine if this row is selected
      const isSelected = selectedRows.has(i)
      
      // Draw row background
      ctx.fillStyle = isSelected
        ? isDarkMode
          ? "rgba(56, 189, 248, 0.3)" // sky-400 with opacity for dark mode
          : "rgba(2, 132, 199, 0.3)" // sky-600 with opacity for light mode
        : isDarkMode
          ? "rgba(51, 65, 85, 0.4)" // slate-700 with opacity for dark mode
          : "rgba(226, 232, 240, 0.5)" // slate-200 with opacity for light mode
        
      ctx.fillRect(0, y, rect.width, rowHeight)
      
      // Draw row border
      ctx.strokeStyle = isDarkMode ? "#64748b" : "#94a3b8" // slate-500 or slate-400
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
      
      // If it's the last row, draw bottom border too
      if (i === rowCount - 1) {
        ctx.beginPath()
        ctx.moveTo(0, y + rowHeight)
        ctx.lineTo(rect.width, y + rowHeight)
        ctx.stroke()
      }
      
      // Draw frequency range text
      ctx.fillStyle = isDarkMode ? "#f8fafc" : "#0f172a" // slate-50 or slate-900
      ctx.font = "14px sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      
      // Get frequency range for this row from constants
      // These should match the ranges in pinkNoiseCalibration.ts
      let freqRange = "";
      if (rowCount === 1) {
        freqRange = "Full Spectrum (20Hz - 20kHz)";
      } else if (rowCount === 2) {
        freqRange = i === 0 ? "Low (20Hz - 500Hz)" : "High (500Hz - 20kHz)";
      } else if (rowCount === 3) {
        freqRange = i === 0 ? "Low (20Hz - 250Hz)" : i === 1 ? "Mid (250Hz - 2.5kHz)" : "High (2.5kHz - 20kHz)";
      } else if (rowCount === 4) {
        freqRange = i === 0 ? "Sub (20Hz - 200Hz)" : i === 1 ? "Low (200Hz - 1kHz)" : i === 2 ? "Mid (1kHz - 5kHz)" : "High (5kHz - 20kHz)";
      } else if (rowCount >= 5) {
        // For 5+ rows, just show more generalized labels
        const labels = ["Sub", "Low", "Low-Mid", "Mid", "High-Mid", "High", "Ultra-High"];
        freqRange = labels[i] || "";
      }
      
      ctx.fillText(freqRange, rect.width / 2, y + rowHeight / 2)
      
      // If the row is selected, draw a highlight
      if (isSelected && !disabled) {
        // Draw subtle pulsing effect if playing
        if (isPlaying) {
          const time = Date.now() / 1000;
          const alpha = 0.3 + 0.1 * Math.sin(time * 3);
          
          ctx.fillStyle = isDarkMode
            ? `rgba(56, 189, 248, ${alpha})` // sky-400 with pulsing opacity
            : `rgba(2, 132, 199, ${alpha})`; // sky-600 with pulsing opacity
            
          ctx.fillRect(0, y, rect.width, rowHeight);
        }
        
        // Draw a subtle indicator
        ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600
        ctx.beginPath()
        ctx.arc(rect.width - 15, y + rowHeight / 2, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    
    // Add animation frame if playing
    if (isPlaying) {
      requestAnimationFrame(() => {
        // Force redraw to update animation
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            // Just a tiny modification to force a redraw
            ctx.fillStyle = "rgba(0,0,0,0)";
            ctx.fillRect(0, 0, 1, 1);
          }
        }
      });
    }
  }, [rowCount, selectedRows, isDarkMode, disabled, isPlaying])
  
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    
    // Calculate which row was clicked
    const rowHeight = rect.height / rowCount;
    const rowIndex = Math.floor(y / rowHeight);
    
    // Toggle the selected state of the row
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  };
  
  const increaseRows = () => {
    if (rowCount < MAX_ROWS) {
      setRowCount(rowCount + 1);
    }
  };
  
  const decreaseRows = () => {
    if (rowCount > MIN_ROWS) {
      setRowCount(rowCount - 1);
    }
  };
  
  const clearSelection = () => {
    setSelectedRows(new Set());
  };

  const handlePanChange = (value: number[]) => {
    setPanValue(value[0]);
  };
  
  return (
    <div className="space-y-4">
      <div className="relative bg-background/50 rounded-lg p-3">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[2/1] cursor-pointer rounded ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
          onClick={handleCanvasClick}
        />
      </div>
      
      <div className="flex flex-col space-y-2">
        {/* Display info about what pink noise is */}
        <div className="text-xs text-muted-foreground">
          <p>
            Pink noise calibration uses bandpassed pink noise panned across the stereo field.
            {rowCount === 1 
              ? " With 1 row, full spectrum pink noise is used."
              : ` With ${rowCount} rows, each represents a different frequency range.`}
          </p>
          <p className="mt-1">
            Select rows to hear specific frequency bands, or leave all unselected to hear full spectrum.
          </p>
        </div>
        
        {/* Pan slider control */}
        <div className="flex flex-col space-y-1 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pan Position:</span>
            <div className="text-xs text-muted-foreground">
              {panValue === 0 
                ? "Center" 
                : panValue < 0 
                  ? `${Math.abs(Math.round(panValue * 100))}% Left` 
                  : `${Math.round(panValue * 100)}% Right`}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-muted-foreground">L</span>
            <Slider
              disabled={disabled}
              min={-1}
              max={1}
              step={0.01}
              value={[panValue]}
              onValueChange={handlePanChange}
              className={disabled ? "opacity-70" : ""}
            />
            <span className="text-xs text-muted-foreground">R</span>
          </div>
        </div>
        
        {/* Row count controls */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Frequency Bands:</span>
          <div className="flex items-center space-x-2">
            <button
              className={`h-7 w-7 rounded flex items-center justify-center border ${
                rowCount <= MIN_ROWS || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={decreaseRows}
              disabled={rowCount <= MIN_ROWS || disabled}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-5 text-center text-sm">{rowCount}</span>
            <button
              className={`h-7 w-7 rounded flex items-center justify-center border ${
                rowCount >= MAX_ROWS || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted'
              }`}
              onClick={increaseRows}
              disabled={rowCount >= MAX_ROWS || disabled}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        
        {/* Clear selection button */}
        <button
          className={`px-2 h-7 rounded flex items-center justify-center text-xs border ${
            selectedRows.size === 0 || disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-muted'
          }`}
          onClick={clearSelection}
          disabled={selectedRows.size === 0 || disabled}
        >
          Clear Selection
        </button>
      </div>
      
      <div className="text-xs text-center text-muted-foreground">
        {selectedRows.size === 0 
          ? "All frequency bands will play (full spectrum)" 
          : `${selectedRows.size} band${selectedRows.size !== 1 ? 's' : ''} selected`}
      </div>
    </div>
  );
} 