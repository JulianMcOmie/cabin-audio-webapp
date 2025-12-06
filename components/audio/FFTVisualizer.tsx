"use client"

import { useRef, useEffect } from "react"

interface FFTVisualizerProps {
  analyser: AnalyserNode | null;
  width?: number;
  height?: number;
  className?: string;
}

export function FFTVisualizer({ 
  analyser, 
  width = 500, 
  height = 200, 
  className = ""
}: FFTVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Set up frequency markers for the x-axis - matches FrequencyEQ scale
//   const frequencyMarkers = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  
  // Handle canvas sizing and DPI scaling
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Calculate pixel ratio for high-DPI displays
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    // Reset the scale when dimensions change
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(pixelRatio, pixelRatio);
    
  }, [width, height]);
  
  // Set up analyzer and animation
  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Create data array for frequency analysis
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Helper functions to convert between frequency and x position
    const xToLogFreq = (x: number, width: number): number => {
      const minFreq = 20;
      const maxFreq = 20000;
      const minLog = Math.log10(minFreq);
      const maxLog = Math.log10(maxFreq);
      const logPos = x / width;
      return Math.pow(10, minLog + logPos * (maxLog - minLog));
    };

    const drawSpectrum = (ctx: CanvasRenderingContext2D, dataArray: Uint8Array, width: number, height: number) => {
      // Use a more vibrant gradient for better visibility through the EQ overlay
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(10, 132, 255, 0.4)');  // Blue for low amplitude (more visible)
      gradient.addColorStop(0.5, 'rgba(48, 209, 88, 0.4)');  // Green for medium
      gradient.addColorStop(0.8, 'rgba(255, 214, 10, 0.4)'); // Yellow for high
      gradient.addColorStop(1, 'rgba(255, 69, 58, 0.5)');     // Red for peak
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      
      // Start at the bottom left
      ctx.moveTo(0, height);
      
      // Draw the spectrum
      const barCount = 300; // Number of bars to draw
      const binCount = dataArray.length;
      
      for (let i = 0; i < barCount; i++) {
        // Use logarithmic scale for frequency (x-axis)
        const x = i / barCount * width;
        
        // Convert x position back to a frequency to find the right bin
        const frequency = xToLogFreq(x, width);
        const binIndex = Math.floor(frequency / (22050 / binCount));
        
        // Ensure bin index is in range
        const normalizedBin = Math.min(binCount - 1, Math.max(0, binIndex));
        
        // Get amplitude from frequency data (0-255)
        const amplitude = dataArray[normalizedBin];
        
        // Convert to a height value (0-1)
        const y = height - (amplitude / 255) * height;
        
        // Draw point
        ctx.lineTo(x, y);
      }
      
      // Complete the path to the bottom right
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      
      // Add a line on top for clarity - more visible for better contrast
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      for (let i = 0; i < barCount; i++) {
        const x = i / barCount * width;
        const frequency = xToLogFreq(x, width);
        const binIndex = Math.floor(frequency / (22050 / binCount));
        const normalizedBin = Math.min(binCount - 1, Math.max(0, binIndex));
        const amplitude = dataArray[normalizedBin];
        const y = height - (amplitude / 255) * height;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      ctx.stroke();
    };
    
    const animationFrameRef = { current: 0 };

    const draw = () => {
      // Schedule next frame
      animationFrameRef.current = requestAnimationFrame(draw);
      
      // Get frequency data
      analyser.getByteFrequencyData(dataArray);
      
      // Clear canvas with transparent background
      ctx.clearRect(0, 0, width, height);
      
      // Skip grid drawing for overlay mode
      
      // Draw spectrum
      drawSpectrum(ctx, dataArray, width, height);
    };
    
    // Start animation
    draw();
    
    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [analyser, width, height]);
  
  return (
    <div className={`fft-visualizer relative ${className}`}>
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height} 
        className="rounded-md"
      />
    </div>
  );
} 