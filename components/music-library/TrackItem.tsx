"use client"

import { useState } from "react"
import { Play, Pause, MoreHorizontal } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

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
  onRemove: (trackId: string) => void
  isLastItem?: boolean
}

export function TrackItem({ 
  track, 
  isPlaying, 
  isCurrentTrack, 
  onPlay, 
  onTogglePlayPause,
  onRemove,
  isLastItem = false
}: TrackItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    
    // Round to nearest second to avoid floating point issues
    const totalSeconds = Math.round(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  // Handle play or pause based on current state
  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePlayPause();
  };

  return (
    <div>
      <div
        className={`flex items-center py-3 px-2 hover:bg-muted/50 rounded-md cursor-pointer ${
          isCurrentTrack ? "bg-muted/30" : ""
        }`}
        onClick={() => onPlay(track)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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
              onClick={handlePlayPause}
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
        <div className="flex-shrink-0 text-xs text-muted-foreground mr-2">
          {formatDuration(track.duration)}
        </div>
        
        {/* Ellipsis menu - now takes up space */}
        <div 
          className="flex-shrink-0 w-8"
          onClick={(e) => e.stopPropagation()} // Prevent row click when clicking on menu
        >
          <div className={`transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onPlay(track)}>
                  Play
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRemove(track.id)}>
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {!isLastItem && <Separator />}
    </div>
  )
} 