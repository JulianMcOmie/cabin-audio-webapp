"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { getTimbreToolAudioPlayer } from '@/lib/audio/timbreToolAudio';
import { Label } from './ui/label';

interface TimbreToolProps {
  isPlaying: boolean;
  disabled?: boolean;
  // Add any other props needed, e.g., for analyzer data if visualizing
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DEFAULT_Q = 5; // Default Q value for bandpass filters

export function TimbreTool({ isPlaying, disabled }: TimbreToolProps) {
  const [pan, setPan] = useState(0); // -1 (left) to 1 (right)
  // Frequencies for the two alternating bandpassed noises
  const [freq1, setFreq1] = useState(500);  // Default frequency for line 1
  const [freq2, setFreq2] = useState(2000); // Default frequency for line 2
  const [draggingLine, setDraggingLine] = useState<'freq1' | 'freq2' | null>(null);

  const audioPlayerRef = useRef<ReturnType<typeof getTimbreToolAudioPlayer> | null>(null);
  const visualizerRef = useRef<HTMLDivElement>(null);
  const freq1Ref = useRef<HTMLDivElement>(null); // Ref for freq1 line
  const freq2Ref = useRef<HTMLDivElement>(null); // Ref for freq2 line

  // Initialize and manage audio player
  useEffect(() => {
    audioPlayerRef.current = getTimbreToolAudioPlayer();
    // Set initial frequencies and pan
    audioPlayerRef.current.setFrequencies(freq1, DEFAULT_Q, freq2, DEFAULT_Q);
    audioPlayerRef.current.setPan(pan);

    return () => {
      // No cleanup here, as player is a singleton, managed by EQView's unmount
    };
  }, []); // Initialize only once

  // Control playback
  useEffect(() => {
    if (audioPlayerRef.current) {
      if (isPlaying) {
        audioPlayerRef.current.play();
      } else {
        audioPlayerRef.current.stop();
      }
    }
  }, [isPlaying]);

  // Update pan in audio player when slider changes
  useEffect(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.setPan(pan);
    }
  }, [pan]);

  // Update frequencies in audio player when they change
  // For now, frequencies are static, but this hook is ready for interactive frequency control
  useEffect(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.setFrequencies(freq1, DEFAULT_Q, freq2, DEFAULT_Q);
    }
  }, [freq1, freq2]);

  const handlePanChange = (value: number[]) => {
    setPan(value[0]);
  };

  // Helper to convert Y position (0-1 range, 0 is top) to frequency
  const yToFreq = useCallback((yNormalized: number): number => {
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);
    // yNormalized is 0 at top, 1 at bottom
    const logFreq = (1 - yNormalized) * (logMax - logMin) + logMin;
    return Math.max(MIN_FREQ, Math.min(MAX_FREQ, Math.pow(10, logFreq)));
  }, []);

  // Helper to convert frequency to Y position (0-1 range, 1 is top in style, 0 is top for calculation)
  const freqToY = useCallback((freq: number, height: number): number => {
    if (height === 0) return 0;
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);
    const logFreq = Math.log10(Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq)));
    // Returns value for style.top (percentage or px)
    return height * (1 - (logFreq - logMin) / (logMax - logMin));
  }, []);

  const handleMouseDown = (line: 'freq1' | 'freq2') => {
    setDraggingLine(line);
  };

  const handleMouseMove = useCallback((event: MouseEvent | TouchEvent) => {
    if (!draggingLine || !visualizerRef.current) return;

    const visualizerRect = visualizerRef.current.getBoundingClientRect();
    let clientY;
    if (event instanceof MouseEvent) {
        clientY = event.clientY;
    } else if (event.touches && event.touches[0]) {
        clientY = event.touches[0].clientY;
    } else {
        return;
    }

    const yInVisualizer = clientY - visualizerRect.top;
    const yNormalized = Math.max(0, Math.min(1, yInVisualizer / visualizerRect.height));
    const newFreq = yToFreq(yNormalized);

    if (draggingLine === 'freq1') {
      setFreq1(newFreq);
    } else if (draggingLine === 'freq2') {
      setFreq2(newFreq);
    }
  }, [draggingLine, yToFreq]);

  const handleMouseUp = useCallback(() => {
    setDraggingLine(null);
  }, []);

  useEffect(() => {
    if (draggingLine) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove as EventListener);
      window.addEventListener('touchend', handleMouseUp as EventListener);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove as EventListener);
      window.removeEventListener('touchend', handleMouseUp as EventListener);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove as EventListener);
      window.removeEventListener('touchend', handleMouseUp as EventListener);
    };
  }, [draggingLine, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex flex-col items-center space-y-4 w-full">
      <div 
        ref={visualizerRef} 
        className="w-full aspect-square bg-muted rounded-md relative border border-input overflow-hidden touch-none"
        // Style height to match width for a square, if not automatically handled by aspect-square
        // style={{ height: visualizerRef.current?.offsetWidth + 'px' }}
      >
        {/* Visual representation of the two frequencies */}
        <div 
          ref={freq1Ref}
          className="absolute w-full h-1.5 bg-blue-500 opacity-75 cursor-ns-resize transform -translate-y-1/2"
          style={{ top: `${freqToY(freq1, visualizerRef.current?.offsetHeight || 0)}px`, zIndex: draggingLine === 'freq1' ? 10 : 1 }}
          onMouseDown={() => handleMouseDown('freq1')}
          onTouchStart={() => handleMouseDown('freq1')}
        ></div>
        <div 
          ref={freq2Ref}
          className="absolute w-full h-1.5 bg-green-500 opacity-75 cursor-ns-resize transform -translate-y-1/2"
          style={{ top: `${freqToY(freq2, visualizerRef.current?.offsetHeight || 0)}px`, zIndex: draggingLine === 'freq2' ? 10 : 1 }}
          onMouseDown={() => handleMouseDown('freq2')}
          onTouchStart={() => handleMouseDown('freq2')}
        ></div>
         {/* Add a small indicator for current pan setting if desired */}
         <div 
          className="absolute top-1/2 left-1/2 w-1 h-1 bg-red-500 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{ transform: `translateX(${(pan * 45)}%) translateY(-50%)` }} // Simple pan visualization
        ></div>
      </div>

      <div className="w-full px-2 space-y-2">
        <div>
            <Label htmlFor="timbre-pan" className="text-xs text-muted-foreground">
                Pan ({pan.toFixed(2)})
            </Label>
            <Slider
            id="timbre-pan"
            min={-1}
            max={1}
            step={0.01}
            value={[pan]}
            onValueChange={handlePanChange}
            disabled={disabled}
            className="w-full"
            />
        </div>
        {/* Placeholder for frequency controls - will be replaced by interactive lines */}
        <div className="text-xs text-muted-foreground text-center">
            Freq 1: {freq1.toFixed(0)} Hz, Freq 2: {freq2.toFixed(0)} Hz
        </div>
      </div>
    </div>
  );
} 