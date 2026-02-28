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
import Image from "next/image"

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

  const getDefaultCoverImage = () => {
    return `/default_img_dark.jpg?t=${Date.now()}`;
  };
  
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
        className={`flex items-center py-1.5 px-2 hover:bg-muted/50 rounded-md cursor-pointer ${
          isCurrentTrack ? "bg-muted/30" : ""
        }`}
        onClick={() => onPlay(track)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex-shrink-0 mr-3 relative group">
          <div className="h-9 w-9 rounded-md overflow-hidden relative">
            <Image
              src={track.coverUrl || getDefaultCoverImage()}
              alt={`${track.album} cover`}
              fill
              className="object-cover"
              unoptimized
              onError={(e) => {
                // If image fails to load, use default - with Next/Image we can't just set src directly on e.target easily
                // Ideally we'd use a fallback state, but for now this handles some cases
                // Or just let the next/image unoptimized handle it if it's a valid URL
                // Since we can't easily swap src in onError for Next/Image component,
                // we rely on proper URLs or fallback logic in parent.
                // But for direct DOM access fallback:
                const img = e.target as HTMLImageElement;
                img.src = getDefaultCoverImage();
                img.srcset = ""; // clear srcset to prevent it from trying to load again
              }}
            />
          </div>
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
                {isPlaying ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
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
              <Play className="h-4 w-4 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate leading-tight">{track.title}</p>
          <p className="text-[11px] text-muted-foreground truncate leading-tight">
            {track.artist}
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