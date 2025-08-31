"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, Square, RotateCcw } from "lucide-react"
import * as pinkNoiseBurstAudio from "@/lib/audio/pinkNoiseBurstAudio"
import { FFTVisualizer } from "@/components/audio/FFTVisualizer"
import { PinkNoiseBurst2DControl } from "./PinkNoiseBurst2DControl"

interface PinkNoiseBurstComponentProps {
  disabled?: boolean
}

export function PinkNoiseBurstComponent({ disabled = false }: PinkNoiseBurstComponentProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [analyzerNode, setAnalyzerNode] = useState<AnalyserNode | null>(null)
  const [filter1Freq, setFilter1Freq] = useState(2000)
  const [filter2Freq, setFilter2Freq] = useState(8000)
  const audioPlayerRef = useRef<ReturnType<typeof pinkNoiseBurstAudio.getPinkNoiseBurstAudioPlayer> | null>(null)

  // Initialize audio player
  useEffect(() => {
    audioPlayerRef.current = pinkNoiseBurstAudio.getPinkNoiseBurstAudioPlayer()
    audioPlayerRef.current.initialize()
    
    // Set initial filter frequencies
    audioPlayerRef.current.setFilterFrequencies(filter1Freq, filter2Freq)
    
    // Get analyzer node for FFT visualization
    const analyzer = audioPlayerRef.current.getAnalyzerNode()
    setAnalyzerNode(analyzer)

    return () => {
      if (audioPlayerRef.current) {
        pinkNoiseBurstAudio.cleanupPinkNoiseBurstAudioPlayer()
      }
    }
  }, [filter1Freq, filter2Freq])

  const handlePlayPause = async () => {
    if (disabled) return
    
    const newPlayingState = !isPlaying
    setIsPlaying(newPlayingState)
    
    if (audioPlayerRef.current) {
      await audioPlayerRef.current.setPlaying(newPlayingState)
    }
  }

  const handleReset = () => {
    setIsPlaying(false)
    
    // Reset to default frequencies
    const defaultFilter1 = 2000
    const defaultFilter2 = 8000
    setFilter1Freq(defaultFilter1)
    setFilter2Freq(defaultFilter2)
    
    if (audioPlayerRef.current) {
      audioPlayerRef.current.setPlaying(false)
      audioPlayerRef.current.setFilterFrequencies(defaultFilter1, defaultFilter2)
      // Reinitialize to reset audio state
      audioPlayerRef.current.initialize()
    }
  }

  const handleFrequenciesChange = (newFilter1Freq: number, newFilter2Freq: number) => {
    setFilter1Freq(newFilter1Freq)
    setFilter2Freq(newFilter2Freq)
    
    // Update audio player with new frequencies if it exists
    if (audioPlayerRef.current) {
      audioPlayerRef.current.setFilterFrequencies(newFilter1Freq, newFilter2Freq)
    }
  }

  const formatFrequency = (freq: number): string => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}kHz`
    }
    return `${freq}Hz`
  }

  return (
    <div className="space-y-6 pb-32">
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
            Pink Noise Burst Generator
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generates repeating pink noise bursts with dual peak filters. 
            Use the 2D control below to adjust filter center frequencies in real-time.
          </p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Control Panel */}
          <div className="flex items-center justify-center gap-4">
            <Button
              onClick={handlePlayPause}
              disabled={disabled}
              variant={isPlaying ? "secondary" : "default"}
              size="lg"
              className="min-w-[120px]"
            >
              {isPlaying ? (
                <>
                  <Square className="w-4 h-4 mr-2" />
                  Stop Bursts
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start Bursts
                </>
              )}
            </Button>
            
            <Button
              onClick={handleReset}
              variant="outline"
              size="lg"
              disabled={disabled}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          </div>

          {/* Status Information */}
          <div className="text-center space-y-2">
            {isPlaying ? (
              <p className="text-sm text-orange-600 font-medium">
                🔊 Playing pink noise bursts
                <br />
                <span className="text-muted-foreground">
                  0.5s bursts every 1.5s with dual peak filtering
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Click &quot;Start Bursts&quot; to begin the pink noise burst pattern
              </p>
            )}
          </div>

          {/* Current Filter Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-orange-50 rounded-lg">
              <div className="text-sm text-orange-600 font-medium mb-1">Filter 1</div>
              <div className="text-lg font-mono text-orange-800">
                {formatFrequency(filter1Freq)}
              </div>
            </div>
            
            <div className="p-3 bg-orange-50 rounded-lg">
              <div className="text-sm text-orange-600 font-medium mb-1">Filter 2</div>
              <div className="text-lg font-mono text-orange-800">
                {formatFrequency(filter2Freq)}
              </div>
            </div>
          </div>

          {/* Technical Details */}
          <div className="text-xs text-muted-foreground text-center space-y-1">
            <p><strong>Burst Pattern:</strong> 0.5s pink noise, 1.0s silence (1.5s total cycle)</p>
            <p><strong>Peak Filters:</strong> -18dB magnitude, Q = 3.0</p>
            <p><strong>Frequency Range:</strong> 1kHz - 20kHz (logarithmic control)</p>
          </div>
        </CardContent>
      </Card>

      {/* 2D Control Component */}
      <PinkNoiseBurst2DControl 
        disabled={disabled}
        onFrequenciesChange={handleFrequenciesChange}
        initialFilter1Freq={filter1Freq}
        initialFilter2Freq={filter2Freq}
      />

      {/* FFT Visualization */}
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            Audio Spectrum Analysis
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Real-time frequency spectrum of the pink noise bursts with peak filtering applied.
            You should see notches at the filter center frequencies.
          </p>
        </CardHeader>
        
        <CardContent>
          <div className="bg-gray-50 rounded-lg p-4">
            <FFTVisualizer 
              analyser={analyzerNode} 
              width={600} 
              height={200}
              className="w-full"
            />
          </div>
          
          {/* Filter frequency indicators */}
          <div className="mt-4 flex justify-between text-xs text-muted-foreground">
            <span>Filter 1: {formatFrequency(filter1Freq)} (-18dB)</span>
            <span>Filter 2: {formatFrequency(filter2Freq)} (-18dB)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}