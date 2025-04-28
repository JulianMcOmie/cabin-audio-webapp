"use client"

import React, { useState, useEffect, useMemo } from 'react';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { getHorizontalLineAudioPlayer } from '@/lib/audio/horizontalLineAudio';
import { usePlayerStore } from '@/lib/stores';

// Constants from audio module (or define here)
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const LOG_MIN_FREQ = Math.log2(MIN_FREQ);
const LOG_MAX_FREQ = Math.log2(MAX_FREQ);
const LOG_FREQ_RANGE = LOG_MAX_FREQ - LOG_MIN_FREQ;

interface HorizontalLineToolProps {
    isPlaying: boolean;
    setIsPlaying: (isPlaying: boolean) => void; // Needed if controls here trigger play/stop
    disabled?: boolean;
    preEQAnalyser?: AnalyserNode | null;
}

export function HorizontalLineTool({ isPlaying, setIsPlaying, disabled = false, preEQAnalyser = null }: HorizontalLineToolProps) {
    const audioPlayer = getHorizontalLineAudioPlayer();
    const initialParams = audioPlayer.getParameters();

    // State for frequency - manage log scale internally
    const [frequency, setFrequency] = useState(initialParams.frequency);

     // Get music player state to potentially pause it (though play is handled globally)
    const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore();

    // Update audio player frequency when state changes
    useEffect(() => {
        audioPlayer.setParameters({ frequency });
    }, [audioPlayer, frequency]);

    // Control audio player playback state (connects/disconnects spawner)
    useEffect(() => {
        audioPlayer.setPlaying(isPlaying);
    }, [audioPlayer, isPlaying]);

    // Connect analyser if provided and playing
     useEffect(() => {
        if (preEQAnalyser && isPlaying) {
            audioPlayer.connectToAnalyser(preEQAnalyser);
            return () => {
                audioPlayer.disconnectFromAnalyser();
            };
        } else if (!isPlaying || !preEQAnalyser) {
             audioPlayer.disconnectFromAnalyser();
        }
    }, [audioPlayer, preEQAnalyser, isPlaying]);


    // --- Logarithmic Slider ---
    // Convert linear slider value (0-100) to logarithmic frequency
    const sliderToFrequency = (value: number): number => {
        const logValue = LOG_MIN_FREQ + (value / 100) * LOG_FREQ_RANGE;
        return Math.pow(2, logValue);
    };

    // Convert frequency to linear slider value (0-100)
    const frequencyToSlider = (freq: number): number => {
         // Handle edge case of freq being 0 or less
        if (freq <= 0) return 0; 
        const logFreq = Math.log2(freq);
        const value = ((logFreq - LOG_MIN_FREQ) / LOG_FREQ_RANGE) * 100;
        return Math.max(0, Math.min(100, value)); // Clamp between 0 and 100
    };

    const handleSliderChange = (value: number[]) => {
        setFrequency(sliderToFrequency(value[0]));
    };
    
    // Memoize slider value derived from frequency state
     const sliderValue = useMemo(() => [frequencyToSlider(frequency)], [frequency]);

    // Format frequency for display
    const formatFrequency = (freq: number): string => {
        if (freq < 1000) {
            return `${freq.toFixed(0)} Hz`;
        } else {
            return `${(freq / 1000).toFixed(1)} kHz`;
        }
    };

    return (
        <div className="space-y-4">
            {/* Frequency Control */}
            <div className="space-y-3 border rounded-lg p-4 bg-background/30">
                <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                         <Label htmlFor="frequency-slider" className="text-xs font-medium">Frequency</Label>
                         <span className="text-xs font-medium text-muted-foreground">{formatFrequency(frequency)}</span>
                    </div>
                    <Slider
                        id="frequency-slider"
                        min={0}
                        max={100}
                        step={0.1} // Fine steps for smoother log scale
                        value={sliderValue}
                        onValueChange={handleSliderChange}
                        disabled={disabled}
                        className="[&>span:first-child]:h-1"
                    />
                     <div className="flex justify-between text-xs text-muted-foreground">
                         <span>{formatFrequency(MIN_FREQ)}</span>
                         <span>{formatFrequency(MAX_FREQ)}</span>
                    </div>
                </div>
                 {/* Optional: Add Spawn Rate control here if needed */}
            </div>
             {/* Optional: Add Visualization Canvas Here */}
             {/* Play button is handled globally in EQView */}
        </div>
    );
} 