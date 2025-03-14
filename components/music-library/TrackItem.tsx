"use client"

import { Play, Pause } from "lucide-react"
import { Separator } from "@/components/ui/separator"

interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string
}

interface TrackItemProps {
  track: Track
  isPlaying: boolean
  isCurrentTrack: boolean
  onPlay: (track: Track) => void
  onTogglePlayPause: () => void
  isLastItem?: boolean
}

export function TrackItem({ 
  track, 
  isPlaying, 
  isCurrentTrack, 
  onPlay, 
  onTogglePlayPause,
  isLastItem = false
}: TrackItemProps) {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div>
      <div
        className={`flex items-center py-3 px-2 hover:bg-muted/50 rounded-md cursor-pointer ${
          isCurrentTrack ? "bg-muted/30" : ""
        }`}
        onClick={() => onPlay(track)}
      >
        <div className="flex-shrink-0 mr-4 relative group">
          <img
            src={track.coverUrl || "/placeholder.svg"}
            alt={`${track.album} cover`}
            className="h-12 w-12 rounded-md object-cover"
          />
          {isCurrentTrack ? (
            <div
              className="absolute inset-0 bg-black/40 rounded-md flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation()
                onTogglePlayPause()
              }}
            >
              <div className="group-hover:hidden">
                {isPlaying ? (
                  <div className="playing-animation">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : (
                  <div className="flatline-animation">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                )}
              </div>
              <div className="hidden group-hover:block">
                {isPlaying ? <Pause className="h-6 w-6 text-white" /> : <Play className="h-6 w-6 text-white" />}
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 bg-black/40 rounded-md opacity-0 hover:opacity-100 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation()
                onPlay(track)
              }}
            >
              <Play className="h-6 w-6 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{track.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {track.artist} • {track.album}
          </p>
        </div>
        <div className="flex-shrink-0 text-xs text-muted-foreground">{formatDuration(track.duration)}</div>
      </div>
      {!isLastItem && <Separator />}
    </div>
  )
} 