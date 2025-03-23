"use client"

import { useRef, useEffect, useState } from "react"
import * as referenceCalibrationAudio from '@/lib/audio/referenceCalibrationAudio'
import { Button } from "@/components/ui/button"
import { Play } from "lucide-react"

// Constants
const HANDLE_SIZE = 8; // Size of the frequency control handle in pixels
const HANDLE_TOUCH_SIZE = 24; // Size of touch area for handles
const LINE_HIT_TOLERANCE = 15; // pixels of vertical tolerance for line hit detection

interface ReferenceCalibrationProps {
  isPlaying: boolean;
  disabled?: boolean;
  className?: string;
}

export function ReferenceCalibration({ isPlaying, disabled = false, className = "" }: ReferenceCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  
  // State for tracking the calibration frequency
  const [calibrationFrequency, setCalibrationFrequency] = useState(3000);
  
  // State for dragging
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [initialFrequency, setInitialFrequency] = useState(0);
  
  // State for active positions
  const [activePosition, setActivePosition] = useState<number | null>(null);
  const [isReferenceActive, setIsReferenceActive] = useState(false);
  
  // State for hover effects
  const [mousePosition, setMousePosition] = useState<{x: number, y: number} | null>(null);
  
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
  
  // Initialize with frequency from audio module
  useEffect(() => {
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    const frequency = audioPlayer.getCalibrationFrequency();
    setCalibrationFrequency(frequency);
  }, []);
  
  // Connect to audio module for active position events
  useEffect(() => {
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    
    const handlePositionActivation = (position: number, isReference: boolean) => {
      setActivePosition(position);
      setIsReferenceActive(isReference);
      
      // Reset active position after animation time
      setTimeout(() => {
        setActivePosition(null);
      }, 200);
    };
    
    audioPlayer.addPositionListener(handlePositionActivation);
    
    return () => {
      audioPlayer.removePositionListener(handlePositionActivation);
    };
  }, []);
  
  // Connect to audio module for frequency changes
  useEffect(() => {
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    
    const handleFrequencyChange = (frequency: number) => {
      setCalibrationFrequency(frequency);
    };
    
    audioPlayer.addFrequencyListener(handleFrequencyChange);
    
    return () => {
      audioPlayer.removeFrequencyListener(handleFrequencyChange);
    };
  }, []);
  
  // Update audio module when frequency changes
  useEffect(() => {
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    audioPlayer.setCalibrationFrequency(calibrationFrequency);
  }, [calibrationFrequency]);
  
  // Update audio player when playing state changes
  useEffect(() => {
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    audioPlayer.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Check if mouse is near the line
  const isNearLine = (): boolean => {
    if (!mousePosition || !canvasSize.height) return false;
    
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    const normalizedPosition = audioPlayer.frequencyToPosition(calibrationFrequency);
    const lineY = canvasSize.height - (normalizedPosition * (canvasSize.height - 4) + 2);
    
    return Math.abs(mousePosition.y - lineY) < LINE_HIT_TOLERANCE;
  };
  
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
    
    // Calculate the normalized position (0-1) from the frequency
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    const normalizedPosition = audioPlayer.frequencyToPosition(calibrationFrequency);
    
    // Calculate the Y position for the frequency line
    // Invert the position since we want high frequencies at the top
    const lineY = canvasSize.height - (normalizedPosition * (canvasSize.height - 4) + 2);
    
    // Check if mouse is near the line for hover effect
    const isHovering = isNearLine();
    
    // Draw the calibration frequency line with enhanced style
    const lineWidth = isHovering || isDragging ? 3 : 2;
    ctx.strokeStyle = isDragging 
      ? (isDarkMode ? '#38bdf8' : '#0284c7') // sky-400 or sky-600 when dragging
      : isHovering 
        ? (isDarkMode ? '#60a5fa' : '#3b82f6') // blue-400 or blue-500 when hovering
        : (isDarkMode ? '#a1a1aa' : '#94a3b8'); // default color
    
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(2, lineY);
    ctx.lineTo(canvasSize.width - 2, lineY);
    ctx.stroke();
    
    // Add vertical handles on both sides of the line for better visual cue
    const leftHandleX = 8;
    const rightHandleX = canvasSize.width - 8;
    
    // Draw vertical drag handles
    ctx.fillStyle = ctx.strokeStyle; // Match the line color
    
    // Left handle
    ctx.beginPath();
    ctx.moveTo(leftHandleX, lineY - 6);
    ctx.lineTo(leftHandleX - 4, lineY);
    ctx.lineTo(leftHandleX, lineY + 6);
    ctx.lineTo(leftHandleX + 4, lineY);
    ctx.closePath();
    ctx.fill();
    
    // Right handle
    ctx.beginPath();
    ctx.moveTo(rightHandleX, lineY - 6);
    ctx.lineTo(rightHandleX - 4, lineY);
    ctx.lineTo(rightHandleX, lineY + 6);
    ctx.lineTo(rightHandleX + 4, lineY);
    ctx.closePath();
    ctx.fill();
    
    // Draw a reference frequency line (fixed at 800Hz)
    const referencePosition = audioPlayer.frequencyToPosition(800);
    const referenceY = canvasSize.height - (referencePosition * (canvasSize.height - 4) + 2);
    
    ctx.strokeStyle = isDarkMode ? '#4b5563' : '#cbd5e1'; // Lighter color for reference
    ctx.setLineDash([5, 5]); // Dashed line for reference
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(2, referenceY);
    ctx.lineTo(canvasSize.width - 2, referenceY);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash
    
    // Draw frequency label with improved visibility
    const bgColor = isDarkMode ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.7)';
    const textPadding = 4;
    
    // Text for calibration frequency
    ctx.font = '12px system-ui, sans-serif';
    const freqText = `${Math.round(calibrationFrequency)} Hz`;
    const freqTextWidth = ctx.measureText(freqText).width;
    
    // Draw background for better readability
    ctx.fillStyle = bgColor;
    ctx.fillRect(
      canvasSize.width - 10 - freqTextWidth - textPadding * 2, 
      lineY - 16 - textPadding, 
      freqTextWidth + textPadding * 2, 
      16 + textPadding * 2
    );
    
    // Draw text
    ctx.fillStyle = isDarkMode ? '#e4e4e7' : '#1f2937';
    ctx.textAlign = 'right';
    ctx.fillText(freqText, canvasSize.width - 10, lineY - 6);
    
    // Text for reference frequency
    const refText = `Reference: 800 Hz`;
    const refTextWidth = ctx.measureText(refText).width;
    
    // Draw background for reference text
    ctx.fillStyle = bgColor;
    ctx.fillRect(
      canvasSize.width - 10 - refTextWidth - textPadding * 2, 
      referenceY - 16 - textPadding, 
      refTextWidth + textPadding * 2, 
      16 + textPadding * 2
    );
    
    // Draw reference text
    ctx.fillStyle = isDarkMode ? '#9ca3af' : '#6b7280';
    ctx.fillText(refText, canvasSize.width - 10, referenceY - 6);
    
    // Draw active position indicators
    if (activePosition !== null) {
      // Calculate the X position based on the pan value (-1 to 1)
      // Map from -1,1 to 0,canvasWidth
      const x = ((activePosition + 1) / 2) * (canvasSize.width - 4) + 2;
      
      // Draw at either the reference line or calibration line
      const y = isReferenceActive ? referenceY : lineY;
      
      // Draw active position circle
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = isDarkMode ? '#38bdf8' : '#0284c7'; // sky-400 or sky-600
      ctx.fill();
    }
    
  }, [canvasSize, isDarkMode, calibrationFrequency, isDragging, activePosition, isReferenceActive, mousePosition]);
  
  // Handle mouse movement for hover effects
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Update mouse position for hover effects
    setMousePosition({ x: mouseX, y: mouseY });
    
    // Handle dragging logic
    if (isDragging && !disabled) {
      // Calculate raw vertical position for direct control
      const normalizedY = 1 - (mouseY / rect.height);
      
      // Convert directly to frequency
      const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
      const newFrequency = audioPlayer.positionToFrequency(normalizedY);
      
      // Update frequency
      setCalibrationFrequency(newFrequency);
    }
  };
  
  const handleMouseLeave = () => {
    setMousePosition(null);
    setIsDragging(false);
  };
  
  // Handle mouse/touch interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Update mouse position
    setMousePosition({ x: mouseX, y: mouseY });
    
    // Calculate line position
    const audioPlayer = referenceCalibrationAudio.getReferenceCalibrationAudio();
    const normalizedPosition = audioPlayer.frequencyToPosition(calibrationFrequency);
    const lineY = rect.height - (normalizedPosition * (rect.height - 4) + 2);
    
    // Check if clicking on or near the line (with vertical tolerance)
    if (Math.abs(mouseY - lineY) < LINE_HIT_TOLERANCE) {
      setIsDragging(true);
      // No need to track dragStartY and initialFrequency anymore since we're using absolute positioning
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  // Cursor styles
  const getCursorStyle = (): string => {
    if (disabled) return 'not-allowed';
    if (isDragging) return 'ns-resize';
    return isNearLine() ? 'ns-resize' : 'default';
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="relative bg-background/50 rounded-lg p-3">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-square rounded ${disabled ? "opacity-70" : ""}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: getCursorStyle() }}
        />
      </div>
      
      <div className="text-xs text-center text-muted-foreground mb-2">
        Drag the line up/down to change the calibration frequency
      </div>
    </div>
  );
} 