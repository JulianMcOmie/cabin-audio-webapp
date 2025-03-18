"use client"

import { useRef, useEffect, useState } from "react"
import { Play, Plus, Minus, Waves, Clock, MoveHorizontal, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import * as pinkNoiseCalibration from '@/lib/audio/pinkNoiseCalibration'

interface PinkNoiseCalibrationProps {
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  disabled?: boolean;
}

export function PinkNoiseCalibration({ isPlaying, setIsPlaying, disabled = false }: PinkNoiseCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [panValue, setPanValue] = useState(0) // Default to center (0)
  const [isPanning, setIsPanning] = useState(false) // Default auto-pan off
  const [panDuration, setPanDuration] = useState(6) // Default 6 seconds per pan cycle
  const [isSweeping, setIsSweeping] = useState(false) // Default sweep off
  const [sineGain, setSineGain] = useState(0.4) // Default sine gain 0.4
  const [peakQ, setPeakQ] = useState(1.0) // Default Q of 1.0
  const [sweepDuration, setSweepDuration] = useState(8) // Default 8 seconds per cycle
  const [minSweepFreq, setMinSweepFreq] = useState(20) // Default min 20Hz
  const [maxSweepFreq, setMaxSweepFreq] = useState(20000) // Default max 20kHz
  const [isDarkMode, setIsDarkMode] = useState(false)
  
  // Animation frame ID for cancellation
  const animationRef = useRef<number | null>(null);
  
  // Initialize the pink noise calibrator
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    
    return () => {
      // Clean up on unmount
      calibrator.setPlaying(false);
      
      // Cancel any animation frames
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);
  
  // Update when playing state changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Update when pan value changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPan(panValue);
  }, [panValue]);
  
  // Update when auto-panning state changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPanning(isPanning);
  }, [isPanning]);
  
  // Update when pan duration changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPanDuration(panDuration);
  }, [panDuration]);
  
  // Update when sweep state changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setSweeping(isSweeping);
  }, [isSweeping]);
  
  // Update when sine gain changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setSineGain(sineGain);
  }, [sineGain]);
  
  // Update when peak Q changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setPeakQ(peakQ);
  }, [peakQ]);
  
  // Update when sweep duration changes
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setSweepDuration(sweepDuration);
  }, [sweepDuration]);
  
  // Update when min/max sweep frequencies change
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setMinSweepFreq(minSweepFreq);
  }, [minSweepFreq]);
  
  useEffect(() => {
    const calibrator = pinkNoiseCalibration.getPinkNoiseCalibrator();
    calibrator.setMaxSweepFreq(maxSweepFreq);
  }, [maxSweepFreq]);

  // Set up observer to detect theme changes
  useEffect(() => {
    // Initial check
    setIsDarkMode(document.documentElement.classList.contains("dark"))

    // Set up mutation observer to watch for class changes on html element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const newIsDarkMode = document.documentElement.classList.contains("dark")
          setIsDarkMode(newIsDarkMode)
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => {
      observer.disconnect()
    }
  }, [])
  
  // Draw the pink noise visualization
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Function to draw the canvas
    const drawCanvas = (time: number) => {
      // Clear canvas
      ctx.clearRect(0, 0, rect.width, rect.height)

      // Add semi-transparent background
      ctx.fillStyle = isDarkMode ? "rgba(24, 24, 36, 0.4)" : "rgba(255, 255, 255, 0.4)"
      ctx.fillRect(0, 0, rect.width, rect.height)
      
      // Draw frequency response visualization
      ctx.strokeStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky-400 or sky-600
      ctx.lineWidth = 2
      ctx.beginPath()
      
      // Draw frequency markers
      const drawFrequencyMarkers = () => {
        ctx.strokeStyle = isDarkMode ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.1)"
        ctx.lineWidth = 1
        
        // Draw frequency markers
        const frequencyMarkers = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
        
        for (const freq of frequencyMarkers) {
          if (freq >= minSweepFreq && freq <= maxSweepFreq) {
            const logMinFreq = Math.log10(minSweepFreq)
            const logMaxFreq = Math.log10(maxSweepFreq)
            const logRange = logMaxFreq - logMinFreq
            
            const logFreq = Math.log10(freq)
            const x = rect.width * (logFreq - logMinFreq) / logRange
            
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, rect.height)
            ctx.stroke()
            
            // Draw frequency label
            ctx.fillStyle = isDarkMode ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)"
            ctx.font = "10px sans-serif"
            ctx.textAlign = "center"
            
            let label = freq.toString()
            if (freq >= 1000) {
              label = `${freq / 1000}k`
            }
            
            ctx.fillText(label, x, rect.height - 5)
          }
        }
      }
      
      // Draw the pink noise spectrum
      const drawNoiseSpectrum = () => {
        ctx.fillStyle = isDarkMode ? "rgba(56, 189, 248, 0.1)" : "rgba(2, 132, 199, 0.1)" // sky colors with low opacity
        ctx.beginPath()
        
        // Starting at bottom left
        ctx.moveTo(0, rect.height)
        
        for (let x = 0; x < rect.width; x++) {
          // Convert x position to frequency (logarithmic)
          const xRatio = x / rect.width
          const logFreq = Math.log10(minSweepFreq) + (xRatio * (Math.log10(maxSweepFreq) - Math.log10(minSweepFreq)))
          const freq = Math.pow(10, logFreq)
          
          // Pink noise has 1/f spectrum, so amplitude falls by 3dB per octave
          // We also add some random variation for visual interest
          const amplitude = 1 / Math.sqrt(freq)
          
          // Add some randomness for visual effect if playing
          const randomness = isPlaying ? (Math.random() * 0.2) : 0
          
          // Calculate y position - scale to canvas height
          const y = rect.height - (amplitude * rect.height * 0.5 + randomness * rect.height)
          
          ctx.lineTo(x, y)
        }
        
        // Complete the shape to the bottom right
        ctx.lineTo(rect.width, rect.height)
        ctx.closePath()
        ctx.fill()
      }
      
      // Calculate the current sine tone frequency based on sweep state
      const getCurrentSineFreq = () => {
        // Get current frequency - if sweeping, calculate it based on time
        let currentFreq = Math.sqrt(minSweepFreq * maxSweepFreq); // Default to center frequency
        
        if (isSweeping && isPlaying) {
          // Calculate frequency position based on time and sweep duration
          const cyclePosition = (time / (sweepDuration * 1000)) % 1
          const cyclePhase = Math.sin(cyclePosition * Math.PI * 2)
          
          // Map from -1,1 to logarithmic frequency scale
          const logMinFreq = Math.log10(minSweepFreq)
          const logMaxFreq = Math.log10(maxSweepFreq)
          const logRange = logMaxFreq - logMinFreq
          
          const logPosition = logMinFreq + (logRange * 0.5) + (cyclePhase * logRange * 0.5)
          currentFreq = Math.pow(10, logPosition)
        }
        
        return currentFreq;
      }
      
      // Draw the sine tone visualization
      const drawSineTone = () => {
        if (sineGain <= 0) return; // Don't draw if gain is 0
        
        // Get current frequency
        const currentFreq = getCurrentSineFreq();
        
        // Calculate x position
        const logMinFreq = Math.log10(minSweepFreq)
        const logMaxFreq = Math.log10(maxSweepFreq)
        const logRange = logMaxFreq - logMinFreq
        const logFreq = Math.log10(currentFreq)
        const freqX = rect.width * (logFreq - logMinFreq) / logRange
        
        // Draw vertical line at current frequency
        ctx.strokeStyle = isDarkMode ? "rgba(250, 204, 21, 0.8)" : "rgba(234, 179, 8, 0.8)" // yellow-400
        ctx.lineWidth = 2 
        ctx.beginPath()
        ctx.moveTo(freqX, rect.height * 0.2)
        ctx.lineTo(freqX, rect.height * 0.8)
        ctx.stroke()
        
        // Draw dot at frequency position
        const dotSize = 6 + (sineGain * 4); // Size based on gain
        ctx.fillStyle = isDarkMode ? "rgba(250, 204, 21, 0.9)" : "rgba(234, 179, 8, 0.9)" // yellow-400
        ctx.beginPath()
        ctx.arc(freqX, rect.height * 0.5, dotSize, 0, Math.PI * 2)
        ctx.fill()
        
        // Draw frequency label
        ctx.fillStyle = isDarkMode ? "#ffffff" : "#000000"
        ctx.font = "10px sans-serif"
        ctx.textAlign = "center"
        ctx.fillText(
          `${formatFrequency(currentFreq)}`, 
          freqX, 
          rect.height * 0.2 - 5
        )
      }
      
      // Draw visualization elements
      drawFrequencyMarkers()
      drawNoiseSpectrum()
      drawSineTone()
      
      // Draw panning indicator
      const drawPanningIndicator = () => {
        // Draw center line
        ctx.strokeStyle = isDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.2)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(rect.width / 2, 0)
        ctx.lineTo(rect.width / 2, rect.height)
        ctx.stroke()
        
        // Determine pan position - either use the manual value or calculate based on auto-pan
        let currentPan = panValue;
        
        if (isPanning && isPlaying) {
          // Calculate auto-pan position based on time
          const cyclePosition = (time / (panDuration * 1000)) % 1
          currentPan = Math.sin(cyclePosition * Math.PI * 2) // -1 to 1 sine wave
        }
        
        // Pan position indicator
        const panX = rect.width * (currentPan + 1) / 2 // Map -1,1 to 0,width
        
        // Draw pan position
        ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7" // sky colors
        ctx.beginPath()
        ctx.arc(panX, rect.height - 20, 8, 0, Math.PI * 2)
        ctx.fill()
        
        // Label
        ctx.fillStyle = isDarkMode ? "#f8fafc" : "#0f172a" // text color
        ctx.font = "12px sans-serif"
        ctx.textAlign = "center"
        ctx.fillText(currentPan === 0 ? "C" : currentPan < 0 ? "L" : "R", panX, rect.height - 20 + 4)
        
        // If auto-panning, add a motion indicator
        if (isPanning && isPlaying) {
          ctx.strokeStyle = isDarkMode ? "rgba(56, 189, 248, 0.5)" : "rgba(2, 132, 199, 0.4)"
          ctx.lineWidth = 2
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(rect.width * 0.1, rect.height - 20)
          ctx.lineTo(rect.width * 0.9, rect.height - 20)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
      
      drawPanningIndicator()
      
      // Continue animation if playing
      if (isPlaying) {
        animationRef.current = requestAnimationFrame(drawCanvas)
      }
    }
    
    // Start drawing
    drawCanvas(performance.now())
    
    // Clean up
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isDarkMode, isPlaying, isSweeping, isPanning, sineGain, peakQ, panValue, panDuration, sweepDuration, minSweepFreq, maxSweepFreq])
  
  const handlePanChange = (value: number[]) => {
    setPanValue(value[0])
  }
  
  const handlePanDurationChange = (value: number[]) => {
    setPanDuration(value[0])
  }
  
  const handleSineGainChange = (value: number[]) => {
    setSineGain(value[0])
  }
  
  const handlePeakQChange = (value: number[]) => {
    setPeakQ(value[0])
  }
  
  const handleSweepDurationChange = (value: number[]) => {
    setSweepDuration(value[0])
  }
  
  const handleMinFreqChange = (value: number[]) => {
    // Ensure min frequency is always less than max
    setMinSweepFreq(Math.min(value[0], maxSweepFreq * 0.9))
  }
  
  const handleMaxFreqChange = (value: number[]) => {
    // Ensure max frequency is always greater than min
    setMaxSweepFreq(Math.max(value[0], minSweepFreq * 1.1))
  }

  // Format sweep speed for display
  const formatSweepSpeed = (duration: number) => {
    if (duration <= 2) return "Very Fast";
    if (duration <= 5) return "Fast";
    if (duration <= 10) return "Medium";
    if (duration <= 20) return "Slow";
    return "Very Slow";
  }
  
  // Format pan speed for display
  const formatPanSpeed = (duration: number) => {
    if (duration <= 3) return "Very Fast";
    if (duration <= 6) return "Fast";
    if (duration <= 10) return "Medium";
    if (duration <= 15) return "Slow";
    return "Very Slow";
  }
  
  // Format frequency for display
  const formatFrequency = (freq: number) => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}kHz`;
    }
    return `${Math.round(freq)}Hz`;
  }
  
  // Format Q value for display
  const formatQ = (q: number) => {
    if (q < 0.5) return "Very Wide";
    if (q < 1.0) return "Wide";
    if (q < 3.0) return "Medium";
    if (q < 7.0) return "Narrow";
    return "Very Narrow";
  }
  
  return (
    <div className="space-y-4">
      <div className="relative bg-background/50 rounded-lg p-3">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[2/1] cursor-pointer rounded ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
        />
      </div>
      
      <div className="flex flex-col space-y-3">
        {/* Display info about pink noise calibration */}
        <div className="text-xs text-muted-foreground">
          <p>
            Pink noise calibration tool with sine tone generator to help identify room modes and resonances.
          </p>
          <p className="mt-1">
            Use the pan control to position the sound in the stereo field.
          </p>
        </div>
        
        {/* Pan slider control */}
        <div className="flex flex-col space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pan Position:</span>
            <div className="text-xs text-muted-foreground">
              {isPanning ? "Auto-panning" : panValue === 0 
                ? "Center" 
                : panValue < 0 
                  ? `${Math.abs(Math.round(panValue * 100))}% Left` 
                  : `${Math.round(panValue * 100)}% Right`}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-muted-foreground">L</span>
            <Slider
              disabled={disabled || isPanning}
              min={-1}
              max={1}
              step={0.01}
              value={[panValue]}
              onValueChange={handlePanChange}
              className={disabled || isPanning ? "opacity-70" : ""}
            />
            <span className="text-xs text-muted-foreground">R</span>
          </div>
        </div>
        
        {/* Auto-pan toggle control */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <MoveHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Auto-Panning</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically pan the sound left and right
            </p>
          </div>
          <Switch 
            checked={isPanning}
            onCheckedChange={setIsPanning}
            disabled={disabled}
          />
        </div>
        
        {/* Auto-pan speed control - only show when auto-pan is enabled */}
        {isPanning && (
          <div className="flex flex-col space-y-1 pl-6 -mt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Pan Speed:</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatPanSpeed(panDuration)} ({panDuration.toFixed(1)}s)
              </div>
            </div>
            <Slider
              disabled={disabled}
              min={2}
              max={20}
              step={0.5}
              value={[panDuration]}
              onValueChange={handlePanDurationChange}
              className={disabled ? "opacity-70" : ""}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Fast</span>
              <span>Slow</span>
            </div>
          </div>
        )}
        
        {/* Sweep toggle control */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Frequency Sweep</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically sweep the sine tone across the frequency spectrum
            </p>
          </div>
          <Switch 
            checked={isSweeping}
            onCheckedChange={setIsSweeping}
            disabled={disabled}
          />
        </div>
        
        {/* Sweep controls - only show when sweep is enabled */}
        {isSweeping && (
          <div className="flex flex-col space-y-3 pl-6 -mt-1">
            {/* Sweep speed control */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Sweep Speed:</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatSweepSpeed(sweepDuration)} ({sweepDuration.toFixed(1)}s)
                </div>
              </div>
              <Slider
                disabled={disabled}
                min={2}
                max={30}
                step={0.5}
                value={[sweepDuration]}
                onValueChange={handleSweepDurationChange}
                className={disabled ? "opacity-70" : ""}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Fast</span>
                <span>Slow</span>
              </div>
            </div>
            
            {/* Frequency range controls */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Minimum Frequency:</span>
                <div className="text-xs text-muted-foreground">
                  {formatFrequency(minSweepFreq)}
                </div>
              </div>
              <Slider
                disabled={disabled}
                min={20}
                max={20000}
                step={1}
                value={[minSweepFreq]}
                onValueChange={handleMinFreqChange}
                className={disabled ? "opacity-70" : ""}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>20Hz</span>
                <span>2kHz</span>
              </div>
            </div>
            
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Maximum Frequency:</span>
                <div className="text-xs text-muted-foreground">
                  {formatFrequency(maxSweepFreq)}
                </div>
              </div>
              <Slider
                disabled={disabled}
                min={20}
                max={20000}
                step={100}
                value={[maxSweepFreq]}
                onValueChange={handleMaxFreqChange}
                className={disabled ? "opacity-70" : ""}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>2kHz</span>
                <span>20kHz</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Sine tone level control */}
        <div className="flex flex-col space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Sine Tone Level:</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {Math.round(sineGain * 100)}%
            </div>
          </div>
          <Slider
            disabled={disabled}
            min={0}
            max={1}
            step={0.01}
            value={[sineGain]}
            onValueChange={handleSineGainChange}
            className={disabled ? "opacity-70" : ""}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Silent</span>
            <span>Loud</span>
          </div>
        </div>
        
        {/* Peak bandwidth (Q) control */}
        <div className="flex flex-col space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Tone Bandwidth:</span>
            <div className="text-xs text-muted-foreground">
              {formatQ(peakQ)} (Q: {peakQ.toFixed(1)})
            </div>
          </div>
          <Slider
            disabled={disabled}
            min={0.1}
            max={10}
            step={0.1}
            value={[peakQ]}
            onValueChange={handlePeakQChange}
            className={disabled ? "opacity-70" : ""}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Wide</span>
            <span>Narrow</span>
          </div>
        </div>
      </div>
    </div>
  );
} 