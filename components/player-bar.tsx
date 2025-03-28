"use client"

import { useState, useEffect, useRef } from "react"
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { useToast } from "@/components/common/ToastManager"
import { usePlayerStore, useTrackStore, useArtistStore, useAlbumStore } from "@/lib/stores"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { cn } from "@/lib/utils"
import * as fileStorage from "@/lib/storage/fileStorage"

// // Dummy track interface
// interface Track {
//   id: string
//   title: string
//   artist: string
//   album: string
//   duration: number
//   coverUrl: string
//   currentTime?: number
// }

// Custom EQ icon component
const EQIcon = ({ className }: { className?: string }) => (
  <svg 
    width="15" 
    height="15" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

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
    // setCurrentTrack,
    setIsPlaying,
    setVolume,
    setIsMuted,
    seekTo
  } = usePlayerStore()
  
  // Get track information from the track store
  const getTrackById = useTrackStore(state => state.getTrackById)
  const currentTrack = currentTrackId ? getTrackById(currentTrackId) : null
  
  // Get artist and album info
  const getArtistById = useArtistStore(state => state.getArtistById)
  const getAlbumById = useAlbumStore(state => state.getAlbumById)
  
  // Get EQ state from the EQ profile store
  const { isEQEnabled, setEQEnabled } = useEQProfileStore()
  
  const [isTrackLoading, setIsTrackLoading] = useState(false)
  // State to track seeking and temporary position during seek
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekPosition, setSeekPosition] = useState(0)
  const wasPlayingRef = useRef(false)
  const [coverImageUrl, setCoverImageUrl] = useState<string>("/placeholder.svg?height=48&width=48")
  const [artistNameText, setArtistNameText] = useState<string>("Unknown Artist")
  const [albumNameText, setAlbumNameText] = useState<string>("Unknown Album")

  // Update loading state when loadingState changes
  useEffect(() => {
    console.log(`[PlayerBar] loadingState: ${loadingState}`)
    setIsTrackLoading(loadingState === 'loading' || loadingState === 'decoding')
  }, [loadingState])

  // Keep seekPosition in sync with currentTime when not seeking
  useEffect(() => {
    if (!isSeeking) {
      setSeekPosition(currentTime);
    }
  }, [currentTime, isSeeking]);

  // Display error toast if there's an error
  useEffect(() => {
    if (error) {
      showToast({
        message: `Playback error: ${error}`,
        variant: "error",
      })
    }
  }, [error, showToast])

  // Update artist and album info when track changes
  useEffect(() => {
    if (currentTrack) {
      // Get artist name
      if (currentTrack.artistId) {
        const artist = getArtistById(currentTrack.artistId)
        if (artist) {
          setArtistNameText(artist.name)
        } else {
          setArtistNameText("Unknown Artist")
        }
      } else {
        setArtistNameText("Unknown Artist")
      }
      
      // Get album name
      if (currentTrack.albumId) {
        const album = getAlbumById(currentTrack.albumId)
        if (album) {
          setAlbumNameText(album.title)
        } else {
          setAlbumNameText("Unknown Album")
        }
      } else {
        setAlbumNameText("Unknown Album")
      }
      
      // Get cover art URL
      if (currentTrack.coverStorageKey) {
        fileStorage.getImageFileUrl(currentTrack.coverStorageKey)
          .then(url => {
            setCoverImageUrl(url)
          })
          .catch(error => {
            console.error("Error loading cover art:", error)
            setCoverImageUrl("/placeholder.svg?height=48&width=48")
          })
      } else {
        setCoverImageUrl("/placeholder.svg?height=48&width=48")
      }
    }
  }, [currentTrack, getArtistById, getAlbumById])

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

  const toggleEQ = () => {
    setEQEnabled(!isEQEnabled);
    showToast({
      message: `EQ ${!isEQEnabled ? 'enabled' : 'disabled'}`,
      variant: "info",
    });
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  // Called while the user is dragging the slider
  const handleProgressDrag = (value: number[]) => {
    if (!isSeeking) {
      // When user starts seeking, store current playing state
      setIsSeeking(true);
      wasPlayingRef.current = isPlaying;
      
      // If currently playing, pause during seeking to avoid duplicate nodes
      if (isPlaying) {
        setIsPlaying(false);
      }
    }
    
    // Update the seekPosition state (visual only, no actual seeking yet)
    setSeekPosition(value[0]);
  }

  // Called when the user releases the slider
  const handleProgressCommit = (value: number[]) => {
    if (currentTrackId && duration > 0) {
      console.log(`[PlayerBar] Seeking to ${value[0]} seconds`);
      
      // Reset seeking state first to prevent state conflicts
      setIsSeeking(false);
      
      // Perform the actual seek operation
      seekTo(value[0]);
      
      // Resume playback if it was playing before seeking, with increased delay
      if (wasPlayingRef.current) {
        // Use a longer delay to ensure the seek operation completes fully
        setTimeout(() => {
          console.log(`[PlayerBar] Resuming playback after seek`);
          setIsPlaying(true);
        }, 100); // Increased delay to 100ms for better reliability
      }
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
              <EQIcon className="h-4 w-4 opacity-50" />
            </Button>
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

  // Render normal state with track
  return (
    <div className="player-bar p-2 w-full border-t bg-background">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 w-[30%] min-w-[180px]">
          <img
            src={coverImageUrl}
            alt={`${albumNameText} cover`}
            className="h-12 w-12 rounded-md object-cover"
          />
          <div className="flex flex-col min-w-0">
            <div className="text-sm font-medium truncate">{currentTrack.title}</div>
            <div className="text-xs text-muted-foreground truncate">{artistNameText}</div>
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
            <div className="text-xs w-8 text-right">{formatTime(isSeeking ? seekPosition : currentTime)}</div>
            <Slider
              value={[isSeeking ? seekPosition : currentTime]}
              max={duration}
              step={0.1}
              onValueChange={handleProgressDrag}
              onValueCommit={handleProgressCommit}
              className="flex-1"
              aria-label="Playback progress"
              disabled={!currentTrackId || duration === 0}
            />
            <div className="text-xs w-8">{formatTime(duration)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-[20%] min-w-[120px] justify-end">
          <Button 
            variant="ghost" 
            size="icon" 
            className={cn(
              "h-8 w-8 transition-colors", 
              isEQEnabled && "text-electric-blue"
            )}
            onClick={toggleEQ} 
            title={isEQEnabled ? "Disable EQ" : "Enable EQ"}
          >
            <EQIcon className="h-4 w-4" />
          </Button>
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

