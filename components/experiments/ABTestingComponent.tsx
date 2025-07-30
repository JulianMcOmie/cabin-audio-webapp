"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, Square, RotateCcw } from "lucide-react"
import * as abTestingAudio from "@/lib/audio/abTestingAudio"
import { FFTVisualizer } from "@/components/audio/FFTVisualizer"
import { ABEQControlComponent } from "./ABEQControlComponent"

interface ABTestingComponentProps {
  disabled?: boolean
}

export function ABTestingComponent({ disabled = false }: ABTestingComponentProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentlyPlaying, setCurrentlyPlaying] = useState<'A' | 'B' | 'none'>('none')
  const [selectedAnswer, setSelectedAnswer] = useState<'A' | 'B' | null>(null)
  const [hasAnswered, setHasAnswered] = useState(false)
  const [analyzerNode, setAnalyzerNode] = useState<AnalyserNode | null>(null)
  const [soundAFreqs, setSoundAFreqs] = useState<number[]>([200, 800, 1600])
  const [soundBFreqs, setSoundBFreqs] = useState<number[]>([3200, 6400, 12800])
  const audioPlayerRef = useRef<ReturnType<typeof abTestingAudio.getABTestingAudioPlayer> | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Initialize audio player
  useEffect(() => {
    audioPlayerRef.current = abTestingAudio.getABTestingAudioPlayer()
    audioPlayerRef.current.initialize()
    
    // Set initial EQ frequencies
    audioPlayerRef.current.setEQFrequencies(soundAFreqs, soundBFreqs)
    
    // Get analyzer node for FFT visualization
    const analyzer = audioPlayerRef.current.getAnalyzerNode()
    setAnalyzerNode(analyzer)

    return () => {
      if (audioPlayerRef.current) {
        abTestingAudio.cleanupABTestingAudioPlayer()
      }
    }
  }, [soundAFreqs, soundBFreqs])

  // Update currently playing status
  useEffect(() => {
    if (!isPlaying) {
      setCurrentlyPlaying('none')
      return
    }

    const updatePlayingStatus = () => {
      if (audioPlayerRef.current) {
        const playing = audioPlayerRef.current.getCurrentlyPlaying()
        setCurrentlyPlaying(playing)
      }
      
      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(updatePlayingStatus)
      }
    }

    updatePlayingStatus()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying])

  const handlePlayPause = async () => {
    if (disabled) return
    
    const newPlayingState = !isPlaying
    setIsPlaying(newPlayingState)
    
    if (audioPlayerRef.current) {
      await audioPlayerRef.current.setPlaying(newPlayingState)
    }
  }

  const handleAnswer = (answer: 'A' | 'B') => {
    if (hasAnswered) return
    
    setSelectedAnswer(answer)
    setHasAnswered(true)
    
    // Stop playback when answered
    if (isPlaying) {
      setIsPlaying(false)
      if (audioPlayerRef.current) {
        audioPlayerRef.current.setPlaying(false)
      }
    }
  }

  const handleReset = () => {
    setSelectedAnswer(null)
    setHasAnswered(false)
    setIsPlaying(false)
    setCurrentlyPlaying('none')
    
    if (audioPlayerRef.current) {
      audioPlayerRef.current.setPlaying(false)
      // Reinitialize to reset audio state
      audioPlayerRef.current.initialize()
    }
  }

  const handleFrequenciesChange = (newSoundAFreqs: number[], newSoundBFreqs: number[]) => {
    setSoundAFreqs(newSoundAFreqs)
    setSoundBFreqs(newSoundBFreqs)
    
    // Update audio player with new frequencies if it exists
    if (audioPlayerRef.current) {
      audioPlayerRef.current.setEQFrequencies(newSoundAFreqs, newSoundBFreqs)
    }
  }

  const getSoundBoxClass = (soundId: 'A' | 'B') => {
    const baseClass = "h-32 flex items-center justify-center text-2xl font-bold border-2 rounded-lg transition-all duration-200 cursor-pointer"
    
    if (hasAnswered) {
      if (selectedAnswer === soundId) {
        return `${baseClass} bg-green-100 border-green-500 text-green-700`
      } else {
        return `${baseClass} bg-gray-50 border-gray-200 text-gray-400`
      }
    }
    
    if (currentlyPlaying === soundId) {
      return `${baseClass} bg-blue-100 border-blue-500 text-blue-700 animate-pulse`
    }
    
    return `${baseClass} bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400`
  }

  return (
    <div className="space-y-6 pb-32">
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            A/B Audio Comparison
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Listen to both sounds and select which one sounds higher in pitch.
          </p>
        </CardHeader>
        
        <CardContent className="space-y-6">
        {/* Control Panel */}
        <div className="flex items-center justify-center gap-4">
          <Button
            onClick={handlePlayPause}
            disabled={disabled || hasAnswered}
            variant={isPlaying ? "secondary" : "default"}
            size="lg"
            className="min-w-[120px]"
          >
            {isPlaying ? (
              <>
                <Square className="w-4 h-4 mr-2" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Start Test
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

        {/* Sound Boxes */}
        <div className="grid grid-cols-2 gap-6">
          <div 
            className={getSoundBoxClass('A')}
            onClick={() => !hasAnswered && handleAnswer('A')}
          >
            Sound A
            {currentlyPlaying === 'A' && (
              <div className="ml-2 w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            )}
          </div>
          
          <div 
            className={getSoundBoxClass('B')}
            onClick={() => !hasAnswered && handleAnswer('B')}
          >
            Sound B
            {currentlyPlaying === 'B' && (
              <div className="ml-2 w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="text-center space-y-2">
          {!isPlaying && !hasAnswered && (
            <p className="text-sm text-muted-foreground">
              Click &ldquo;Start Test&rdquo; to begin listening to the alternating sounds
            </p>
          )}
          
          {isPlaying && !hasAnswered && (
            <p className="text-sm text-blue-600 font-medium">
              Currently playing: Sound {currentlyPlaying}
              <br />
              <span className="text-muted-foreground">
                Click on the sound box that sounds higher when you&rsquo;re ready to answer
              </span>
            </p>
          )}
          
          {hasAnswered && (
            <div className="space-y-2">
              <p className="text-sm text-green-600 font-medium">
                You selected: Sound {selectedAnswer} sounds higher
              </p>
              <p className="text-xs text-muted-foreground">
                Click &ldquo;Reset&rdquo; to try again
              </p>
            </div>
          )}
        </div>

        {/* Status Information */}
        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>Each sound plays 4 times before switching to the other</p>
          <p>Both sounds are currently identical pink noise (EQ filtering coming soon)</p>
        </div>
        </CardContent>
      </Card>

      {/* FFT Visualization */}
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            Audio Spectrum Analysis
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Real-time frequency spectrum of the audio passing through the experiments.
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
        </CardContent>
      </Card>

      {/* EQ Control Component */}
      <ABEQControlComponent 
        disabled={disabled || isPlaying}
        onFrequenciesChange={handleFrequenciesChange}
      />
    </div>
  )
}