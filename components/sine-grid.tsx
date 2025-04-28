"use client"

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input"; // Use Input for number controls
import { Button } from "@/components/ui/button";
import { getSineGridAudioPlayer, SineGridAudioPlayer } from '@/lib/audio/sineGridAudio';
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
const MAX_TONES_PER_LINE = 150;
const MIN_OFFSET = -1.0;
const MAX_OFFSET = 1.0;
const OFFSET_STEP = 0.05;
const DOT_RADIUS = 4; // Radius for visualization dots

export function SineGrid({ isPlaying, setIsPlaying, disabled = false, preEQAnalyser = null }: SineGridProps) {
    const audioPlayer = getSineGridAudioPlayer();
    const initialParams = audioPlayer.getParameters();

    const [numLines, setNumLines] = useState(initialParams.numLines);
    const [tonesPerLine, setTonesPerLine] = useState(initialParams.tonesPerLine);
    const [vOffset, setVOffset] = useState(initialParams.vOffset);
    
    const canvasRef = useRef<HTMLCanvasElement>(null); // Ref for the canvas
    const [isDarkMode, setIsDarkMode] = useState(false); // State for theme
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 }); // State for canvas dimensions

    // Get music player state
    const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore();

    // Memoize current parameters to pass to static calculation method
    const currentParams = useMemo(() => ({
        numLines, tonesPerLine, vOffset
    }), [numLines, tonesPerLine, vOffset]);

    // Update audio player when parameters change
    useEffect(() => {
        // Pass the memoized params
        audioPlayer.setParameters(currentParams);
    }, [audioPlayer, currentParams]); // Depend on memoized params

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

    // Theme detection
    useEffect(() => {
        const checkTheme = () => {
            setIsDarkMode(document.documentElement.classList.contains("dark"));
        };
        checkTheme();
        const observer = new MutationObserver(checkTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    // Canvas size update
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resizeObserver = new ResizeObserver(entries => {
            if (!entries || entries.length === 0) return;
            const { width, height } = entries[0].contentRect;
             // Only update if size actually changed to prevent infinite loops
            if (width !== canvasSize.width || height !== canvasSize.height) {
                setCanvasSize({ width, height });
            }
        });

        resizeObserver.observe(canvas);
        // Initial size set
         setCanvasSize({ width: canvas.offsetWidth, height: canvas.offsetHeight });

        return () => resizeObserver.disconnect();
    }, [canvasSize.width, canvasSize.height]); // Re-run observer setup if size state changes externally

    // Drawing logic - Updated for square soundstage visualization
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasSize.width * dpr;
        canvas.height = canvasSize.height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

        // Determine square dimensions and centering offsets
        const size = Math.min(canvasSize.width, canvasSize.height);
        const offsetX = (canvasSize.width - size) / 2;
        const offsetY = (canvasSize.height - size) / 2;

        // Optional: Draw a faint border for the square stage area
        // ctx.strokeStyle = isDarkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
        // ctx.strokeRect(offsetX, offsetY, size, size);

        // Colors based on theme
        const dotColor = isDarkMode ? "#cbd5e1" : "#52525b"; // slate-300 / zinc-600
        const activeDotColor = isDarkMode ? "#38bdf8" : "#0284c7"; // sky-400 / sky-600

        // Draw dots based on current parameters, mapped to the square
        for (let i = 0; i < numLines; i++) {
            for (let j = 0; j < tonesPerLine; j++) {
                const { x, y } = SineGridAudioPlayer.calculateToneProps(currentParams, i, j);

                // Map normalized coords [-1, 1] to the centered square coords [offsetX, offsetX + size] / [offsetY, offsetY + size]
                // Add small padding INSIDE the square
                const padding = Math.max(5, size * 0.02); // e.g., 2% padding, minimum 5px
                const drawAreaSize = size - 2 * padding;

                const canvasX = offsetX + padding + ((x + 1) / 2) * drawAreaSize;
                const canvasY = offsetY + padding + ((1 - y) / 2) * drawAreaSize; // Invert Y for canvas (0 is top)


                ctx.beginPath();
                // Scale dot radius slightly with size, but keep it reasonable
                const dynamicDotRadius = Math.max(2, Math.min(DOT_RADIUS, size * 0.015)); 
                ctx.arc(canvasX, canvasY, dynamicDotRadius, 0, Math.PI * 2);
                ctx.fillStyle = isPlaying ? activeDotColor : dotColor; 
                ctx.fill();
            }
        }

    }, [currentParams, canvasSize, isDarkMode, isPlaying]); // Redraw when params, size, theme or playing state change

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
        <div className="space-y-4 flex flex-col h-full"> 
            {/* Visualization Canvas */}
             <div className="flex-grow relative border rounded-lg bg-background/10 overflow-hidden min-h-[100px]"> 
                 <canvas 
                    ref={canvasRef} 
                    className="absolute top-0 left-0 w-full h-full"
                 />
             </div>

            {/* Controls */}
            <div className="space-y-3 border rounded-lg p-3 bg-background/30"> {/* Reduced padding */}
                {/* Number of Lines */}
                <div className="space-y-1"> {/* Reduced spacing */}
                    <Label htmlFor="num-lines" className="text-xs font-medium">Lines ({MIN_LINES}-{MAX_LINES})</Label>
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
                 <div className="space-y-1"> {/* Reduced spacing */}
                    <Label htmlFor="tones-per-line" className="text-xs font-medium">Tones/Line ({MIN_TONES_PER_LINE}-{MAX_TONES_PER_LINE})</Label>
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

                {/* Vertical Offset */}
                 <div className="space-y-1"> {/* Reduced spacing */}
                    <Label htmlFor="v-offset" className="text-xs font-medium">V Offset ({vOffset.toFixed(2)})</Label>
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
            {/* Play Button is in parent EQView */}
        </div>
    );
} 