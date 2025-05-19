"use client";

import React, { useState, useEffect, useRef } from 'react';
import { getSineToolAudioPlayer } from '@/lib/audio/sineToolAudio';

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
  const audioPlayerRef = useRef(getSineToolAudioPlayer()); // Get instance of audio player

  useEffect(() => {
    const player = audioPlayerRef.current;
    player.setPlaying(isPlaying); // Set audio playing state

    if (isPlaying && !disabled) {
      const animate = () => {
        phaseRef.current += 0.02 * FREQUENCY; // Increment phase for oscillation

        setDotPositions(prevDots => {
          const newDotPositions = prevDots.map((dot, index) => {
            const yOffset = AMPLITUDE * Math.sin(phaseRef.current + dot.x * Math.PI * 2);
            const newY = 0.5 + yOffset;
            // Update audio for this dot immediately after calculating its new position
            player.updateAudioForDot(index, newY, dot.x);
            return {
              x: dot.x,
              y: newY,
            };
          });
          return newDotPositions;
        });
        animationFrameId.current = requestAnimationFrame(animate);
      };
      // Initialize dot audio positions before starting animation loop if playing for the first time
      dotPositions.forEach((pos, index) => {
        player.updateAudioForDot(index, pos.y, pos.x, true);
      });
      animationFrameId.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      // When not playing, ensure all dots have their audio parameters set to a silent/default state if needed
      // player.setPlaying(false) handles overall silence.
      // If specific parameters needed resetting for each dot on stop, do it here.
      // For now, setPlaying(false) should suffice as it mutes envelope gains.
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      // It's important that setPlaying(false) is called when the component unmounts
      // or isPlaying becomes false. This is handled by player.setPlaying(isPlaying) at effect start.
      // If this SineTool component instance is permanently destroyed,
      // the cleanup of the SineToolAudioPlayer itself (player.dispose()) 
      // should happen at a higher level (e.g., when EQView determines this tool is no longer needed).
    };
  }, [isPlaying, disabled, dotPositions]); // Added dotPositions to deps for initial audio setup

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