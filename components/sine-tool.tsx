"use client";

import React, { useState, useEffect, useRef } from 'react';
import { getSineToolAudioPlayer } from '@/lib/audio/sineToolAudio';

interface SineToolProps {
  isPlaying: boolean;
  disabled?: boolean;
}

const NUM_DOTS = 2; // Changed to 2 dots
const OSCILLATION_SPEED = 0.5; // Speed of up/down movement
const DOT_SIZE = 8; // px
const AMPLITUDE_Y = 0.4; // Max Y movement from center (0.5 +/- 0.4 => 0.1 to 0.9)
const FIXED_X_LEFT = 0.25; // X position for the left dot
const FIXED_X_RIGHT = 0.75; // X position for the right dot
const CENTER_Y = 0.5; // Vertical center for oscillation

export function SineTool({ isPlaying, disabled = false }: SineToolProps) {
  const [dotPositions, setDotPositions] = useState<Array<{ x: number; y: number }>>(() => [
    { x: FIXED_X_LEFT, y: CENTER_Y },  // Left dot, starting at center Y
    { x: FIXED_X_RIGHT, y: CENTER_Y } // Right dot, starting at center Y
  ]);
  const animationFrameId = useRef<number | null>(null);
  const phaseRef = useRef(0); // Renamed from angleRef, controls Y oscillation
  const audioPlayerRef = useRef(getSineToolAudioPlayer());

  useEffect(() => {
    const player = audioPlayerRef.current;

    if (isPlaying && !disabled) {
      player.setPlaying(true);
      // phaseRef.current = 0; // Optional: Reset phase each time play starts

      const animate = () => {
        phaseRef.current += 0.02 * OSCILLATION_SPEED;

        setDotPositions(() => { 
          const currentPhase = phaseRef.current;
          const yOffset1 = AMPLITUDE_Y * Math.sin(currentPhase);
          const yOffset2 = AMPLITUDE_Y * Math.sin(currentPhase + Math.PI); // 180 degrees out of phase

          const newDotPositions = [
            {
              x: FIXED_X_LEFT,
              y: CENTER_Y + yOffset1,
            },
            {
              x: FIXED_X_RIGHT,
              y: CENTER_Y + yOffset2,
            },
          ];

          newDotPositions.forEach((dot, index) => {
            player.updateAudioForDot(index, dot.y, dot.x);
          });
          
          return newDotPositions;
        });
        animationFrameId.current = requestAnimationFrame(animate);
      };

      animate(); 

      return () => {
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current);
          animationFrameId.current = null;
        }
        player.setPlaying(false); 
      };
    } else {
      player.setPlaying(false);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    }
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
            transition: 'top 0.02s linear', // Only Y position changes smoothly
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