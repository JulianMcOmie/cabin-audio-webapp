"use client"

import { useState, useEffect } from "react"
import { Upload, PlusCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/common/ToastManager"
import { useFileImport } from "@/lib/hooks/useFileImport"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"
import { useTrackStore } from "@/lib/stores"
import { Track as TrackModel } from "@/lib/models/Track"

// Import the extracted components
import { EQStatusAlert } from "./EQStatusAlert"
import { TrackItem } from "./TrackItem"
import { EmptyLibrary } from "./EmptyLibrary"
import { LoadingSkeleton } from "./ui/LoadingSkeleton"
import { DragDropArea } from "./ui/DragDropArea"
import { DragOverlay } from "./ui/DragOverlay"
import { ImportArea } from "./ImportArea"

// Import animations
import "@/styles/animations.css"

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
    console.log("Import button clicked")
    const fileInput = document.getElementById("file-upload") as HTMLInputElement
    if (fileInput) fileInput.click()
  }

  const handleEQSettingsClick = () => {
    const eqTab = document.querySelector('[data-tab="eq"]')
    if (eqTab) {
      (eqTab as HTMLElement).click()
    }
  }

  const handleTogglePlayback = () => {
    setIsPlayingLocal(!isPlayingLocal)
    setIsPlaying(!isPlayingLocal)
  }

  // Show loading skeleton while loading
  if (isLoading) {
    return <LoadingSkeleton itemCount={5} className="pb-24" />
  }

  // Show empty state if no tracks
  if (tracks.length === 0) {
    return (
      <EmptyLibrary
        eqEnabled={eqEnabled}
        dragActive={dragActive}
        isImporting={isImporting}
        importProgress={importProgress}
        currentFile={currentFile || undefined}
        onImportClick={handleImportButtonClick}
        onCancel={cancelImport}
        onEQSettingsClick={handleEQSettingsClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />
    )
  }

  // Show track list
  return (
    <DragDropArea
      dragActive={dragActive}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="mx-auto space-y-8 relative pb-24"
    >
      <EQStatusAlert isEnabled={eqEnabled} onSettingsClick={handleEQSettingsClick} />
      
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
            <TrackItem
              key={track.id}
              track={track}
              isPlaying={isPlayingLocal && currentlyPlaying === track.id}
              isCurrentTrack={currentlyPlaying === track.id}
              onPlay={handleTrackSelect}
              onTogglePlayPause={handleTogglePlayback}
              isLastItem={index === tracks.length - 1}
            />
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

      <ImportArea onImportClick={handleImportButtonClick} />

      <div className="text-center py-4">
        <p className="text-sm text-muted-foreground">
          <Button variant="link" className="text-purple hover:text-purple/80 font-medium p-0 h-auto">
            Sign up
          </Button>{" "}
          to save your music (so that it won't disappear when you refresh), create playlists, and listen on any device.
        </p>
      </div>

      <FileImportOverlay
        isVisible={isImporting}
        progress={importProgress}
        currentFile={currentFile || undefined}
        onCancel={cancelImport}
      />
      
      <DragOverlay isVisible={dragActive} />
    </DragDropArea>
  )
} 