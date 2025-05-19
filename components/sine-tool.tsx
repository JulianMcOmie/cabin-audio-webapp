"use client";

import React, { useState, useEffect, useRef } from 'react';

interface SineToolProps {
  isPlaying: boolean;
  disabled?: boolean;
}

const NUM_DOTS = 10;
const AMPLITUDE = 0.4; // Max 0.5 to stay within bounds if center is 0.5
const FREQUENCY = 0.5; // Controls speed of oscillation
const DOT_SIZE = 8; // px

export function SineTool({ isPlaying, disabled = false }: SineToolProps) {
  const [dotPositions, setDotPositions] = useState<Array<{ x: number; y: number }>>(
    Array(NUM_DOTS).fill(null).map((_, i) => ({
      x: (i + 0.5) / NUM_DOTS, // Spread dots evenly across width
      y: 0.5, // Start in the middle
    }))
  );
  const animationFrameId = useRef<number | null>(null);
  const phaseRef = useRef(0); // To control the sine wave's oscillation over time

  useEffect(() => {
    if (isPlaying && !disabled) {
      const animate = () => {
        phaseRef.current += 0.02 * FREQUENCY; // Increment phase for oscillation

        setDotPositions(prevDots =>
          prevDots.map((dot, index) => {
            // Calculate sine wave y-position for each dot
            // The x-position of the dot influences its phase in the sine wave.
            // dot.x is normalized (0 to 1). Multiply by 2*PI for one full cycle across the width.
            const yOffset = AMPLITUDE * Math.sin(phaseRef.current + dot.x * Math.PI * 2);
            return {
              ...dot,
              y: 0.5 + yOffset, // Center around 0.5
            };
          })
        );
        animationFrameId.current = requestAnimationFrame(animate);
      };
      animationFrameId.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      // Optionally reset to a default state when not playing
      // phaseRef.current = 0;
      // setDotPositions(Array(NUM_DOTS).fill(null).map((_, i) => ({ x: (i + 0.5) / NUM_DOTS, y: 0.5 })));
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isPlaying, disabled]);

  return (
    <div className="w-full h-48 bg-gray-200 dark:bg-gray-700 rounded-md relative overflow-hidden">
      {dotPositions.map((pos, index) => (
        <div
          key={index}
          className="absolute rounded-full bg-teal-500"
          style={{
            width: `${DOT_SIZE}px`,
            height: `${DOT_SIZE}px`,
            left: `calc(${pos.x * 100}% - ${DOT_SIZE / 2}px)`,
            top: `calc(${pos.y * 100}% - ${DOT_SIZE / 2}px)`,
            transition: 'top 0.05s linear', // Smooth out y-movement slightly
          }}
        />
      ))}
      {disabled && (
        <div className="absolute inset-0 bg-gray-400 bg-opacity-50 flex items-center justify-center">
          <p className="text-white font-semibold">Disabled</p>
        </div>
      )}
    </div>
  );
} 