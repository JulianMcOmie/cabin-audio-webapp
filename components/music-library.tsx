"use client"

import { useState } from "react"
import { Pause, Upload, Play, PlusCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  eqEnabled: boolean // Add this prop
}

export function MusicLibrary({ setCurrentTrack, setIsPlaying, eqEnabled }: MusicLibraryProps) {
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
    <div className="mx-auto space-y-8">
      {/* EQ Status Alert */}
      <div
        className={`rounded-lg p-4 mb-4 flex items-center justify-between ${
          eqEnabled
            ? "bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800"
            : "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
        }`}
      >
        <div className="flex items-center">
          {eqEnabled ? (
            <>
              <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center mr-3">
                <svg
                  className="h-4 w-4 text-green-600 dark:text-green-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">EQ is enabled</p>
                <p className="text-xs text-muted-foreground">
                  Your music is being enhanced with your custom EQ settings
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center mr-3">
                <svg
                  className="h-4 w-4 text-blue-600 dark:text-blue-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Enhance your listening experience
                </p>
                <p className="text-xs text-muted-foreground">
                  Personalized EQ can dramatically improve sound quality and spatial separation
                </p>
              </div>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={
            eqEnabled
              ? "text-green-600 hover:text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30"
              : "text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30"
          }
          onClick={() => {
            const eqTab = document.querySelector('[data-tab="eq"]')
            if (eqTab) {
              ;(eqTab as HTMLElement).click()
            }
          }}
        >
          {eqEnabled ? "Adjust EQ" : "Try EQ"}
        </Button>
      </div>

      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-2xl font-semibold">Music Library</h2>
          <p className="text-sm text-muted-foreground">Your local files & royalty-free music.</p>
        </div>
      </div>

      <div>
        <div className="rounded-md border p-4">
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
                        {isPlaying ? <Pause className="h-6 w-6 text-white" /> : <Play className="h-6 w-6 text-white" />}
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

          <div className="mt-4 pt-4 border-t">
            <Button
              variant="outline"
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-light/30 to-electric-blue-light/30 border-purple/20 hover:border-purple/40 hover:bg-gradient-to-r hover:from-purple-light/40 hover:to-electric-blue-light/40 transition-all"
              onClick={() => {
                console.log("Add track clicked")
                // Add your track adding logic here
              }}
            >
              <PlusCircle className="h-4 w-4 text-purple" />
              <span className="font-medium text-purple">Add Track</span>
            </Button>
          </div>
        </div>
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

