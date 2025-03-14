"use client"

import { useState, useEffect } from "react"
import { Music, Upload, Play, Pause, PlusCircle, FileMusic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/common/ToastManager"
import { useFileImport } from "@/lib/hooks/useFileImport"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"
import { useTrackStore } from "@/lib/stores"
import { Track as TrackModel } from "@/lib/models/Track"

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
  eqEnabled: boolean
}

export function MusicLibrary({ setCurrentTrack, setIsPlaying, eqEnabled }: MusicLibraryProps) {
  const { showToast } = useToast()
  // Connect to trackStore
  const { getTracks, getTrackById, addTrack } = useTrackStore()
  const [isLoading, setIsLoading] = useState(true)
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null)
  const [isPlayingLocal, setIsPlayingLocal] = useState(false)

  // Convert store tracks to UI tracks
  const convertStoreTracksToUI = () => {
    const storeTracks = getTracks();
    return storeTracks.map((storeTrack): Track => ({
      id: storeTrack.id,
      title: storeTrack.title,
      artist: storeTrack.artistId || "Unknown Artist",
      album: storeTrack.albumId || "Unknown Album",
      duration: storeTrack.duration,
      coverUrl: storeTrack.coverStorageKey || "/placeholder.svg?height=48&width=48",
    }));
  }

  // File import state
  const {
    isImporting,
    importProgress,
    currentFile,
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    cancelImport,
  } = useFileImport({
    onComplete: (files) => {
      showToast({
        message: `Successfully imported ${files.length} files`,
        variant: 'success'
      })

      // Add imported tracks to the store and UI
      const newTracks = files.map((file, index) => {
        const id = `imported-${Date.now()}-${index}`;
        const title = file.name.replace(/\.[^/.]+$/, "");
        
        // Add to store first
        const storeTrack: TrackModel = {
          id,
          title,
          duration: Math.floor(Math.random() * 300) + 120,
          storageKey: `file-${id}`,
          lastModified: Date.now(),
          syncStatus: 'pending'
        };
        
        addTrack(storeTrack);
        
        // Return UI track
        return {
          id,
          title,
          artist: "Imported Artist",
          album: "Imported Album",
          duration: storeTrack.duration,
          coverUrl: "/placeholder.svg?height=48&width=48",
        };
      });

      setTracks((prev) => [...newTracks, ...prev])
    },
    onError: (error) => {
      showToast({
        message: error,
        variant: 'error'
      })
    },
  })

  // Load tracks from store or add sample data
  useEffect(() => {
    const loadTracks = async () => {
      setIsLoading(true)
      try {
        // Simulate API call with timeout - keeping original behavior
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const storeTracksCount = getTracks().length;
        
        // If store is empty, populate with sample data if URL param is present
        if (storeTracksCount === 0) {
          const urlParams = new URLSearchParams(window.location.search)
          const showData = urlParams.get("data") === "true"

          if (showData) {
            // Add sample data to the store
            const sampleTracks: TrackModel[] = [
              {
                id: "1",
                title: "Ambient Forest",
                artistId: "Nature Sounds", 
                albumId: "Relaxation Series",
                duration: 240,
                storageKey: "ambient-forest.mp3",
                lastModified: Date.now(),
                syncStatus: 'pending'
              },
              {
                id: "2",
                title: "Ocean Waves",
                artistId: "Nature Sounds",
                albumId: "Relaxation Series",
                duration: 320,
                storageKey: "ocean-waves.mp3",
                lastModified: Date.now(),
                syncStatus: 'pending'
              },
              {
                id: "3",
                title: "Rainy Day",
                artistId: "Nature Sounds",
                albumId: "Relaxation Series",
                duration: 180,
                storageKey: "rainy-day.mp3",
                lastModified: Date.now(),
                syncStatus: 'pending'
              },
              {
                id: "4",
                title: "Mountain Stream",
                artistId: "Nature Sounds",
                albumId: "Relaxation Series",
                duration: 290,
                storageKey: "mountain-stream.mp3",
                lastModified: Date.now(),
                syncStatus: 'pending'
              },
              {
                id: "5",
                title: "Thunderstorm",
                artistId: "Nature Sounds",
                albumId: "Relaxation Series",
                duration: 350,
                storageKey: "thunderstorm.mp3",
                lastModified: Date.now(),
                syncStatus: 'pending'
              },
            ];
            
            // Add each track to the store
            sampleTracks.forEach(track => addTrack(track));
          }
        }
        
        // Convert store tracks to UI format and update state
        const uiTracks = convertStoreTracksToUI();
        setTracks(uiTracks);
      } catch (error) {
        showToast({
          message: "Failed to load tracks",
          variant: 'error'
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadTracks()
    
    // Subscribe to track store changes
    const unsubscribe = useTrackStore.subscribe(
      () => {
        // Only update if component is mounted (not loading)
        if (!isLoading) {
          setTracks(convertStoreTracksToUI());
        }
      }
    );
    
    return () => unsubscribe();
  }, [showToast, addTrack, getTracks])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleTrackSelect = (track: Track) => {
    // Get full track from store
    const storeTrack = getTrackById(track.id);
    
    if (currentlyPlaying === track.id) {
      // If the same track is clicked, toggle play/pause
      setIsPlayingLocal(!isPlayingLocal)
      setIsPlaying(!isPlayingLocal)
    } else {
      // If a different track is clicked, select it and start playing
      setCurrentTrack({
        ...track,
        currentTime: 0,
        // Include store track data for backend operations
        storeTrack
      })
      setCurrentlyPlaying(track.id)
      setIsPlayingLocal(true)
      setIsPlaying(true)
    }
  }

  const handleImportButtonClick = () => {
    const fileInput = document.getElementById("file-upload") as HTMLInputElement
    if (fileInput) fileInput.click()
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="mx-auto space-y-8">
        {/* EQ Status Alert - Skeleton */}
        <div className="rounded-lg p-4 mb-4 animate-pulse bg-muted">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-muted-foreground/20 mr-3"></div>
            <div className="space-y-2">
              <div className="h-4 w-40 bg-muted-foreground/20 rounded"></div>
              <div className="h-3 w-64 bg-muted-foreground/20 rounded"></div>
            </div>
          </div>
        </div>

        {/* Header - Skeleton */}
        <div className="flex justify-between items-center mb-2">
          <div className="space-y-2">
            <div className="h-6 w-40 bg-muted-foreground/20 rounded"></div>
            <div className="h-4 w-56 bg-muted-foreground/20 rounded"></div>
          </div>
        </div>

        {/* Track List - Skeleton */}
        <div className="rounded-md border p-4">
          {Array(5)
            .fill(0)
            .map((_, index) => (
              <div key={index}>
                <div className="flex items-center py-3 px-2 animate-pulse">
                  <div className="h-12 w-12 bg-muted-foreground/20 rounded-md mr-4"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted-foreground/20 rounded w-3/4"></div>
                    <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
                  </div>
                  <div className="h-4 w-10 bg-muted-foreground/20 rounded"></div>
                </div>
                {index < 4 && <Separator />}
              </div>
            ))}
        </div>

        {/* Import Area - Skeleton */}
        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center animate-pulse">
          <div className="flex flex-col items-center justify-center">
            <div className="h-20 w-20 rounded-full bg-muted-foreground/20"></div>
            <div className="h-6 w-56 bg-muted-foreground/20 rounded mt-4"></div>
            <div className="h-4 w-72 bg-muted-foreground/20 rounded mt-2"></div>
            <div className="h-10 w-32 bg-muted-foreground/20 rounded mt-4"></div>
          </div>
        </div>
      </div>
    )
  }

  // Render empty state
  if (tracks.length === 0) {
    return (
      <div 
        className={`mx-auto space-y-8 ${dragActive ? "drag-active" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
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

        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Music className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No music found</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Import your music files to get started. We support MP3, WAV, and FLAC formats.
            </p>
            <Button 
              className="mt-4 bg-purple hover:bg-purple/90 text-white" 
              onClick={handleImportButtonClick}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import Music
            </Button>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept="audio/*,.mp3,.wav,.flac"
              onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
              multiple
            />
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

        {/* Import overlay */}
        <FileImportOverlay
          isVisible={isImporting}
          progress={importProgress}
          currentFile={currentFile || undefined}
          onCancel={cancelImport}
        />

        {/* Drag overlay */}
        {dragActive && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 border-2 border-dashed border-primary rounded-lg">
            <div className="text-center p-8 rounded-lg">
              <FileMusic className="h-16 w-16 mx-auto mb-4 text-purple animate-pulse" />
              <h3 className="text-2xl font-bold mb-2">Drop your audio files here</h3>
              <p className="text-muted-foreground">We support MP3, WAV, and FLAC formats</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render tracks
  return (
    <div 
      className={`mx-auto space-y-8 relative ${dragActive ? "drag-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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
        <Button 
          variant="outline"
          onClick={handleImportButtonClick}
        >
          <Upload className="mr-2 h-4 w-4" />
          Import Music
        </Button>
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept="audio/*,.mp3,.wav,.flac"
          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
          multiple
        />
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
                        setIsPlayingLocal(!isPlayingLocal)
                        setIsPlaying(!isPlayingLocal)
                      }}
                    >
                      <div className="group-hover:hidden">
                        {isPlayingLocal ? (
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
                        {isPlayingLocal ? <Pause className="h-6 w-6 text-white" /> : <Play className="h-6 w-6 text-white" />}
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

      <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center transition-all duration-300 hover:border-primary/50 hover:bg-muted/10">
        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Upload className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Drag and drop your audio files</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your music files to use with our EQ. We support MP3, WAV, and FLAC formats.
          </p>
          <Button 
            className="mt-4 bg-purple hover:bg-purple/90 text-white"
            onClick={handleImportButtonClick}
          >
            Browse files
          </Button>
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

      {/* Import overlay */}
      <FileImportOverlay
        isVisible={isImporting}
        progress={importProgress}
        currentFile={currentFile || undefined}
        onCancel={cancelImport}
      />

      {/* Drag overlay */}
      {dragActive && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 border-2 border-dashed border-primary rounded-lg">
          <div className="text-center p-8 rounded-lg">
            <FileMusic className="h-16 w-16 mx-auto mb-4 text-purple animate-pulse" />
            <h3 className="text-2xl font-bold mb-2">Drop your audio files here</h3>
            <p className="text-muted-foreground">We support MP3, WAV, and FLAC formats</p>
          </div>
        </div>
      )}

      <style jsx global>{`
        .drag-active {
          position: relative;
        }
        
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
        
        /* Add smooth transitions for drag overlay */
        .fixed {
          transition: opacity 150ms ease-in-out;
        }
      `}</style>
    </div>
  )
}

