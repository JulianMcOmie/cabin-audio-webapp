"use client"

import { useState, useEffect } from "react"
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { useToast } from "@/components/common/ToastManager"
import { usePlayerStore, useTrackStore } from "@/lib/stores"

// Dummy track interface
interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string
  currentTime?: number
}

export function PlayerBar() {
  const { showToast } = useToast()
  
  // Get state directly from playerStore
  const {
    currentTrackId,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    loadingState,
    loadingProgress,
    error,
    setCurrentTrack,
    setIsPlaying,
    setVolume,
    setIsMuted
  } = usePlayerStore()
  
  // Get track information from the track store
  const getTrackById = useTrackStore(state => state.getTrackById)
  const currentTrack = currentTrackId ? getTrackById(currentTrackId) : null
  
  const [isTrackLoading, setIsTrackLoading] = useState(false)

  // Update loading state when loadingState changes
  useEffect(() => {
    console.log(`[PlayerBar] loadingState: ${loadingState}`)
    setIsTrackLoading(loadingState === 'loading' || loadingState === 'decoding')
  }, [loadingState])

  // Display error toast if there's an error
  useEffect(() => {
    if (error) {
      showToast({
        message: `Playback error: ${error}`,
        variant: "error",
      })
    }
  }, [error, showToast])

  const handlePlay = () => {
    console.log(`[PlayerBar] playingState: ${isPlaying}`)
    setIsPlaying(true)
  }

  const handlePause = () => {
    console.log(`[PlayerBar] pausing`)
    setIsPlaying(false)
  }

  const handleSkipForward = () => {
    showToast({
      message: "Skip forward functionality would be implemented here",
      variant: "info",
    })
  }

  const handleSkipBack = () => {
    showToast({
      message: "Skip backward functionality would be implemented here",
      variant: "info",
    })
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleProgressChange = (value: number[]) => {
    if (currentTrackId) {
      // This will need to be updated to use the proper seek functionality
      // when we implement the audio engine integration
    }
  }

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0] / 100)
    if (value[0] === 0) {
      setIsMuted(true)
    } else if (isMuted) {
      setIsMuted(false)
    }
  }

  // Render loading state
  if (isTrackLoading) {
    return (
      <div className="player-bar p-2 w-full border-t bg-background">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 w-[30%] min-w-[180px]">
            <div className="h-12 w-12 rounded-md bg-muted animate-pulse"></div>
            <div className="flex flex-col min-w-0 space-y-2">
              <div className="h-4 bg-muted rounded w-24 animate-pulse"></div>
              <div className="h-3 bg-muted rounded w-16 animate-pulse"></div>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 w-full max-w-md">
              <div className="text-xs w-8 text-right">0:00</div>
              <div className="h-1 bg-muted rounded-full flex-1">
                <div 
                  className="h-1 bg-primary rounded-full" 
                  style={{ width: `${loadingProgress}%` }}
                ></div>
              </div>
              <div className="text-xs w-8">0:00</div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-[20%] min-w-[120px] justify-end">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <Volume2 className="h-4 w-4" />
            </Button>
            <div className="h-1 bg-muted rounded-full w-24"></div>
          </div>
        </div>
      </div>
    )
  }

  // Render empty state
  if (!currentTrack) {
    return (
      <div className="player-bar p-2 w-full border-t bg-background">
        <div className="flex items-center justify-center h-16">
          <p className="text-muted-foreground">Select a track to play</p>
        </div>
      </div>
    )
  }

  // Get display values for the track
  const artistName = currentTrack.artistId || "Unknown Artist"
  const albumName = currentTrack.albumId || "Unknown Album"
  const coverUrl = currentTrack.coverStorageKey || "/placeholder.svg?height=48&width=48"

  // Render normal state with track
  return (
    <div className="player-bar p-2 w-full border-t bg-background">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 w-[30%] min-w-[180px]">
          <img
            src={coverUrl}
            alt={`${albumName} cover`}
            className="h-12 w-12 rounded-md object-cover"
          />
          <div className="flex flex-col min-w-0">
            <div className="text-sm font-medium truncate">{currentTrack.title}</div>
            <div className="text-xs text-muted-foreground truncate">{artistName}</div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSkipBack}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={isPlaying ? handlePause : handlePlay}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSkipForward}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 w-full max-w-md">
            <div className="text-xs w-8 text-right">{formatTime(currentTime)}</div>
            <Slider
              value={[currentTime]}
              max={duration}
              step={1}
              onValueChange={handleProgressChange}
              className="flex-1"
            />
            <div className="text-xs w-8">{formatTime(duration)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-[20%] min-w-[120px] justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            max={100}
            step={1}
            onValueChange={handleVolumeChange}
            className="w-24"
          />
        </div>
      </div>
    </div>
  )
}

