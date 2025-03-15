"use client"

import { useRef, useEffect, useState } from "react"

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
  const [animationId, setAnimationId] = useState<number | null>(null);
  
  // Set up frequency markers for the x-axis
  const frequencyMarkers = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  
  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Create data array for frequency analysis
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Calculate pixel ratio for high-DPI displays
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(pixelRatio, pixelRatio);
    
    const draw = () => {
      // Schedule next frame
      const animId = requestAnimationFrame(draw);
      setAnimationId(animId);
      
      // Get frequency data
      analyser.getByteFrequencyData(dataArray);
      
      // Clear canvas
      ctx.fillStyle = '#111118';
      ctx.fillRect(0, 0, width, height);
      
      // Draw grid
      drawGrid(ctx, width, height);
      
      // Draw spectrum
      drawSpectrum(ctx, dataArray, width, height);
    };
    
    // Start animation
    draw();
    
    // Cleanup
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [analyser, width, height]);
  
  // Draw background grid
  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    
    // Draw horizontal grid lines (amplitude)
    for (let i = 0; i <= 10; i++) {
      const y = height - (i / 10) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Draw vertical grid lines (frequency - logarithmic)
    frequencyMarkers.forEach(freq => {
      const x = logFreqToX(freq, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });
  };
  
  // Draw frequency spectrum
  const drawSpectrum = (ctx: CanvasRenderingContext2D, dataArray: Uint8Array, width: number, height: number) => {
    // Use gradient for visualization
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#0a84ff');  // Blue for low amplitude
    gradient.addColorStop(0.6, '#30d158'); // Green for medium
    gradient.addColorStop(0.8, '#ffd60a'); // Yellow for high
    gradient.addColorStop(1, '#ff453a');   // Red for peak
    
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
    
    // Add a line on top for clarity
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
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
  
  // Helper functions to convert between frequency and x position
  const logFreqToX = (freq: number, width: number): number => {
    const minFreq = 20;
    const maxFreq = 20000;
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const logPos = (Math.log10(freq) - minLog) / (maxLog - minLog);
    return logPos * width;
  };
  
  const xToLogFreq = (x: number, width: number): number => {
    const minFreq = 20;
    const maxFreq = 20000;
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const logPos = x / width;
    return Math.pow(10, minLog + logPos * (maxLog - minLog));
  };
  
  return (
    <div className={`fft-visualizer relative ${className}`}>
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height} 
        className="rounded-md"
      />
      
      {/* Frequency markers */}
      <div className="frequency-markers flex justify-between px-2 text-xs text-muted-foreground mt-1">
        {frequencyMarkers.map(freq => {
          // Only show certain markers to avoid cluttering
          const label = freq >= 1000 ? `${freq/1000}k` : `${freq}`;
          const showLabel = [20, 100, 1000, 10000].includes(freq);
          
          if (!showLabel) return null;
          
          const position = (logFreqToX(freq, width) / width) * 100;
          
          return (
            <div 
              key={freq} 
              className="absolute" 
              style={{ left: `${position}%` }}
            >
              {label}
            </div>
          );
        })}
      </div>
      
      {/* dB markers on y-axis */}
      <div className="amplitude-markers absolute top-0 left-0 h-full flex flex-col justify-between text-xs text-muted-foreground py-1">
        <div>0 dB</div>
        <div>-80 dB</div>
      </div>
    </div>
  );
} 