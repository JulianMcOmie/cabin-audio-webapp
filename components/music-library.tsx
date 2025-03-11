"use client"

import { useState } from "react"
import { Pause, Upload, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string
}

interface MusicLibraryProps {
  setCurrentTrack: (track: any) => void
  setIsPlaying: (isPlaying: boolean) => void
}

export function MusicLibrary({ setCurrentTrack, setIsPlaying }: MusicLibraryProps) {
  // Sample tracks data
  const [tracks] = useState<Track[]>([
    {
      id: "1",
      title: "Ambient Forest",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 240,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
    {
      id: "2",
      title: "Ocean Waves",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 320,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
    {
      id: "3",
      title: "Rainy Day",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 180,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
    {
      id: "4",
      title: "Mountain Stream",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 290,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
    {
      id: "5",
      title: "Thunderstorm",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 350,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
    {
      id: "6",
      title: "Birdsong Morning",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 270,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
    {
      id: "7",
      title: "Gentle Breeze",
      artist: "Nature Sounds",
      album: "Relaxation Series",
      duration: 210,
      coverUrl: "/placeholder.svg?height=48&width=48",
    },
  ])

  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null)
  const [isPlaying, setIsPlayingLocal] = useState(false)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleTrackSelect = (track: Track) => {
    if (currentlyPlaying === track.id) {
      // If the same track is clicked, toggle play/pause
      setIsPlayingLocal(!isPlaying)
      setIsPlaying(!isPlaying)
    } else {
      // If a different track is clicked, select it and start playing
      setCurrentTrack({
        ...track,
        currentTime: 0,
      })
      setCurrentlyPlaying(track.id)
      setIsPlayingLocal(true)
      setIsPlaying(true)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-2xl font-semibold">Music Library</h2>
          <p className="text-sm text-muted-foreground">Your local files & royalty-free music.</p>
        </div>
      </div>

      <div>
        <ScrollArea className="h-[400px] rounded-md border">
          <div className="p-4">
            {tracks.map((track, index) => (
              <div key={track.id}>
                <div
                  className={`flex items-center py-3 px-2 hover:bg-muted/50 rounded-md cursor-pointer ${
                    currentlyPlaying === track.id ? "bg-muted/30" : ""
                  }`}
                  onClick={() => handleTrackSelect(track)}
                >
                  <div className="flex-shrink-0 mr-4 relative group">
                    <img
                      src={track.coverUrl || "/placeholder.svg"}
                      alt={`${track.album} cover`}
                      className="h-12 w-12 rounded-md object-cover"
                    />
                    {currentlyPlaying === track.id ? (
                      <div
                        className="absolute inset-0 bg-black/40 rounded-md flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsPlayingLocal(!isPlaying)
                          setIsPlaying(!isPlaying)
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
                          {isPlaying ? (
                            <Pause className="h-6 w-6 text-white" />
                          ) : (
                            <Play className="h-6 w-6 text-white" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="absolute inset-0 bg-black/40 rounded-md opacity-0 hover:opacity-100 flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleTrackSelect(track)
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
                {index < tracks.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center">
        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Upload className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Drag and drop your audio files</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your music files to use with our EQ. We support MP3, WAV, and FLAC formats.
          </p>
          <Button className="mt-4 bg-purple hover:bg-purple/90 text-white">Browse files</Button>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-muted-foreground">
          <Button variant="link" className="text-purple hover:text-purple/80 font-medium p-0 h-auto">
            Sign up
          </Button>{" "}
          to save your music (so that it won't disappear when you refresh), create playlists, and listen on any device.
        </p>
      </div>

      <style jsx global>{`
        .playing-animation {
          display: flex;
          align-items: flex-end;
          height: 16px;
          gap: 2px;
        }
        
        .playing-animation span {
          display: inline-block;
          width: 3px;
          height: 5px;
          background-color: white;
          border-radius: 1px;
          animation: playing-animation 0.8s infinite ease-in-out;
        }
        
        .playing-animation span:nth-child(2) {
          animation-delay: 0.2s;
        }
        
        .playing-animation span:nth-child(3) {
          animation-delay: 0.4s;
        }
        
        .flatline-animation {
          display: flex;
          align-items: center;
          height: 16px;
          gap: 2px;
        }
        
        .flatline-animation span {
          display: inline-block;
          width: 3px;
          height: 2px;
          background-color: white;
          border-radius: 1px;
        }
        
        @keyframes playing-animation {
          0%, 100% {
            height: 5px;
          }
          50% {
            height: 12px;
          }
        }
      `}</style>
    </div>
  )
}

