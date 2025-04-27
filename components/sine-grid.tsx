"use client"

import React, { useState, useEffect } from 'react';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input"; // Use Input for number controls
import { Button } from "@/components/ui/button";
import { Play, StopCircle } from "lucide-react";
import { getSineGridAudioPlayer } from '@/lib/audio/sineGridAudio';
import { usePlayerStore } from '@/lib/stores'; // To pause music

interface SineGridProps {
    isPlaying: boolean;
    setIsPlaying: (isPlaying: boolean) => void;
    disabled?: boolean;
    // Add preEQAnalyser prop if needed for visualization within this component
    preEQAnalyser?: AnalyserNode | null; 
}

// Min/Max values for controls
const MIN_LINES = 1;
const MAX_LINES = 9; // Odd numbers usually look better? Keep it simple for now.
const MIN_TONES_PER_LINE = 1;
const MAX_TONES_PER_LINE = 15;
const MIN_OFFSET = -1.0;
const MAX_OFFSET = 1.0;
const OFFSET_STEP = 0.05;

export function SineGrid({ isPlaying, setIsPlaying, disabled = false, preEQAnalyser = null }: SineGridProps) {
    const audioPlayer = getSineGridAudioPlayer();
    const initialParams = audioPlayer.getParameters();

    const [numLines, setNumLines] = useState(initialParams.numLines);
    const [tonesPerLine, setTonesPerLine] = useState(initialParams.tonesPerLine);
    const [hOffset, setHOffset] = useState(initialParams.hOffset);
    const [vOffset, setVOffset] = useState(initialParams.vOffset);

    // Get music player state
    const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore();

    // Update audio player when parameters change
    useEffect(() => {
        audioPlayer.setParameters({ numLines, tonesPerLine, hOffset, vOffset });
    }, [audioPlayer, numLines, tonesPerLine, hOffset, vOffset]);

    // Control audio player playback state
    useEffect(() => {
        audioPlayer.setPlaying(isPlaying);
    }, [audioPlayer, isPlaying]);

    // Connect analyser if provided and playing
     useEffect(() => {
        if (preEQAnalyser && isPlaying) {
            audioPlayer.connectToAnalyser(preEQAnalyser);
            return () => {
                // Disconnect when isPlaying becomes false or analyser changes
                audioPlayer.disconnectFromAnalyser();
            };
        }
        // Ensure disconnected if analyser removed or not playing
        else if (!isPlaying || !preEQAnalyser) {
             audioPlayer.disconnectFromAnalyser();
        }
    }, [audioPlayer, preEQAnalyser, isPlaying]);

    const handlePlayToggle = () => {
        if (isPlaying) {
            setIsPlaying(false);
        } else {
            // If music is playing, pause it
            if (isMusicPlaying) {
                setMusicPlaying(false);
            }
            setIsPlaying(true);
        }
    };

    // Helper to handle number input changes safely
    const handleNumberInputChange = (
        e: React.ChangeEvent<HTMLInputElement>, 
        setter: React.Dispatch<React.SetStateAction<number>>,
        min: number,
        max: number
    ) => {
        const value = e.target.value === '' ? min : parseInt(e.target.value, 10);
        if (!isNaN(value)) {
            setter(Math.max(min, Math.min(max, value)));
        }
    };

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="space-y-3 border rounded-lg p-4 bg-background/30">
                {/* Number of Lines */}
                <div className="space-y-1.5">
                    <Label htmlFor="num-lines" className="text-xs font-medium">Lines per Slope ({MIN_LINES}-{MAX_LINES})</Label>
                    <div className="flex items-center gap-2">
                       <Button 
                            variant="outline" size="icon" className="h-6 w-6" 
                            onClick={() => setNumLines(p => Math.max(MIN_LINES, p - 1))} 
                            disabled={numLines <= MIN_LINES || disabled}>-</Button>
                        <Input
                            id="num-lines"
                            type="number"
                            value={numLines}
                            onChange={(e) => handleNumberInputChange(e, setNumLines, MIN_LINES, MAX_LINES)}
                            min={MIN_LINES}
                            max={MAX_LINES}
                            className="h-8 text-center w-16"
                            disabled={disabled}
                        />
                        <Button 
                            variant="outline" size="icon" className="h-6 w-6" 
                            onClick={() => setNumLines(p => Math.min(MAX_LINES, p + 1))} 
                            disabled={numLines >= MAX_LINES || disabled}>+</Button>
                    </div>
                </div>

                {/* Tones per Line */}
                 <div className="space-y-1.5">
                    <Label htmlFor="tones-per-line" className="text-xs font-medium">Tones per Line ({MIN_TONES_PER_LINE}-{MAX_TONES_PER_LINE})</Label>
                     <div className="flex items-center gap-2">
                         <Button 
                            variant="outline" size="icon" className="h-6 w-6" 
                            onClick={() => setTonesPerLine(p => Math.max(MIN_TONES_PER_LINE, p - 1))} 
                            disabled={tonesPerLine <= MIN_TONES_PER_LINE || disabled}>-</Button>
                        <Input
                            id="tones-per-line"
                            type="number"
                            value={tonesPerLine}
                            onChange={(e) => handleNumberInputChange(e, setTonesPerLine, MIN_TONES_PER_LINE, MAX_TONES_PER_LINE)}
                            min={MIN_TONES_PER_LINE}
                            max={MAX_TONES_PER_LINE}
                            className="h-8 text-center w-16"
                            disabled={disabled}
                        />
                         <Button 
                            variant="outline" size="icon" className="h-6 w-6" 
                            onClick={() => setTonesPerLine(p => Math.min(MAX_TONES_PER_LINE, p + 1))} 
                            disabled={tonesPerLine >= MAX_TONES_PER_LINE || disabled}>+</Button>
                    </div>
                </div>

                {/* Horizontal Offset */}
                <div className="space-y-1.5">
                    <Label htmlFor="h-offset" className="text-xs font-medium">Horizontal Offset ({hOffset.toFixed(2)})</Label>
                    <Slider
                        id="h-offset"
                        min={MIN_OFFSET}
                        max={MAX_OFFSET}
                        step={OFFSET_STEP}
                        value={[hOffset]}
                        onValueChange={(value) => setHOffset(value[0])}
                        disabled={disabled}
                        className="[&>span:first-child]:h-1"
                    />
                </div>

                {/* Vertical Offset */}
                 <div className="space-y-1.5">
                    <Label htmlFor="v-offset" className="text-xs font-medium">Vertical Offset ({vOffset.toFixed(2)})</Label>
                    <Slider
                        id="v-offset"
                        min={MIN_OFFSET}
                        max={MAX_OFFSET}
                        step={OFFSET_STEP}
                        value={[vOffset]}
                        onValueChange={(value) => setVOffset(value[0])}
                        disabled={disabled}
                         className="[&>span:first-child]:h-1"
                    />
                </div>
            </div>

            {/* Play Button - uses state from parent (eq-view) */}
            {/* We don't add a play button here, as it's controlled globally in eq-view */}
             {/* Add visualization canvas here if desired */}
        </div>
    );
} 