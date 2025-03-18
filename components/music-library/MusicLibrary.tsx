"use client"

import { useState, useEffect } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/common/ToastManager"
import { useFileImport } from "@/lib/hooks/useFileImport"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"
import { useTrackStore, usePlayerStore, useEQProfileStore } from "@/lib/stores"
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
  eqEnabled: boolean
  setActiveTab: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => void
  onSignupClick: () => void
}

export function MusicLibrary({ eqEnabled: eqEnabledProp, setActiveTab, onSignupClick }: MusicLibraryProps) {
  const { showToast } = useToast()
  // Connect to trackStore
  const { getTracks, addTrack, deleteTrack, isLoading: isTrackStoreLoading } = useTrackStore()
  // Connect to playerStore
  const { currentTrackId, isPlaying, setCurrentTrack, setIsPlaying } = usePlayerStore()
  // Connect to eqProfileStore for the actual EQ enabled state
  const { isEQEnabled } = useEQProfileStore()
  
  // Use the state from the store, falling back to the prop for backward compatibility
  const eqEnabled = isEQEnabled !== undefined ? isEQEnabled : eqEnabledProp
  
  const [tracks, setTracks] = useState<Track[]>([])

  // Convert store tracks to UI tracks
  const convertStoreTracksToUI = () => {
    console.log(`[convertStoreTracksToUI] Getting tracks from store`);
    const storeTracks = getTracks();
    console.log(`[convertStoreTracksToUI] Retrieved ${storeTracks.length} tracks from store`);
    
    const uiTracks = storeTracks.map((storeTrack): Track => ({
      id: storeTrack.id,
      title: storeTrack.title,
      artist: storeTrack.artistId || "Unknown Artist",
      album: storeTrack.albumId || "Unknown Album",
      duration: storeTrack.duration,
      coverUrl: storeTrack.coverStorageKey || "/placeholder.svg?height=48&width=48",
    }));
    
    console.log(`[convertStoreTracksToUI] Converted ${uiTracks.length} tracks to UI format`);
    return uiTracks;
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
      console.log(`[MusicLibrary] Import complete callback with ${files.length} files`);
      showToast({
        message: `Successfully imported ${files.length} files`,
        variant: 'success'
      })
      
      // Explicitly update tracks state after import completes
      // This ensures we don't rely solely on the subscription
      const updatedTracks = convertStoreTracksToUI();
      console.log(`[MusicLibrary] Explicitly updating tracks after import: ${updatedTracks.length} tracks`);
      setTracks(updatedTracks);
      
      console.log(`[MusicLibrary] Updated tracks state after import: ${updatedTracks.length} tracks`);
    },
    onError: (error) => {
      console.error(`[MusicLibrary] Import error:`, error);
      showToast({
        message: error,
        variant: 'error'
      })
    },
  })

  // Load tracks from store or add sample data
  useEffect(() => {
    console.log(`[MusicLibrary] useEffect for track loading triggered`);
    
    const loadTracks = async () => {
      console.log(`[MusicLibrary] Starting to load tracks`);
      
      try {
        // If store is empty and not loading, populate with sample data if URL param is present
        const storeTracksCount = getTracks().length;
        const isStoreEmpty = storeTracksCount === 0 && !isTrackStoreLoading;
        console.log(`[MusicLibrary] Current track count in store: ${storeTracksCount}, isStoreEmpty: ${isStoreEmpty}, isTrackStoreLoading: ${isTrackStoreLoading}`);
        
        if (isStoreEmpty) {
          const urlParams = new URLSearchParams(window.location.search)
          const showData = urlParams.get("data") === "true"

          if (showData) {
            console.log(`[MusicLibrary] Adding sample data to empty store`);
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
            sampleTracks.forEach(track => {
              console.log(`[MusicLibrary] Adding sample track to store: ${track.title}`);
              addTrack(track);
            });
          }
        }
        
        // Convert store tracks to UI format and update state if not loading
        if (!isTrackStoreLoading) {
          const uiTracks = convertStoreTracksToUI();
          setTracks(uiTracks);
        }
      } catch (error) {
        console.error(`[MusicLibrary] Error loading tracks:`, error);
        showToast({
          message: "Failed to load tracks",
          variant: 'error'
        })
      }
    }

    loadTracks()
    
    // Subscribe to track store changes to update UI when tracks are added
    console.log(`[MusicLibrary] Setting up subscription to track store changes`);
    const unsubscribe = useTrackStore.subscribe((state) => {
      console.log(`[MusicLibrary] Track store changed, subscription triggered, isLoading: ${state.isLoading}`);
      // Only update tracks if we're not in the loading state
      if (!state.isLoading) {
        console.log(`[MusicLibrary] Not in loading state, updating tracks from store`);
        const uiTracks = convertStoreTracksToUI();
        console.log(`[MusicLibrary] Setting tracks state with ${uiTracks.length} tracks from subscription`);
        setTracks(uiTracks);
      } else {
        console.log(`[MusicLibrary] Still loading, skipping track update from subscription`);
      }
    });
    
    // Clean up subscription on component unmount
    return () => {
      console.log(`[MusicLibrary] Cleaning up track store subscription`);
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [showToast, addTrack, getTracks, isTrackStoreLoading])

  // Add a new effect to listen for EQ status changes
  useEffect(() => {
    console.log(`[MusicLibrary] Setting up subscription to EQ status changes`);
    
    // Subscribe to EQ profile store to detect when EQ is enabled/disabled
    const unsubscribeEQ = useEQProfileStore.subscribe((state) => {
      console.log(`[MusicLibrary] EQ enabled state: ${state.isEQEnabled}`);
      // The component will re-render automatically when isEQEnabled changes
    });
    
    return () => {
      console.log(`[MusicLibrary] Cleaning up EQ store subscription`);
      if (unsubscribeEQ) {
        unsubscribeEQ();
      }
    };
  }, []);

  const handleTrackSelect = (track: Track) => {
    console.log(`[MusicLibrary] Track selected: ${track.id}, currentTrackId: ${currentTrackId}, isPlaying: ${isPlaying}`);
    
    if (currentTrackId === track.id) {
      // If the same track is clicked, explicitly set play/pause state
      if (isPlaying) {
        console.log(`[MusicLibrary] Pausing current track: ${track.id}`);
        setIsPlaying(false); // Pause if currently playing
      } else {
        console.log(`[MusicLibrary] Resuming current track: ${track.id}`);
        setIsPlaying(true); // Play if currently paused
      }
    } else {
      // If a different track is clicked, select it
      // The PlayerStore will automatically start playback once the track is loaded
      console.log(`[MusicLibrary] Setting new track: ${track.id} (will auto-play when ready)`);
      setCurrentTrack(track.id);
      
      // No need to call setIsPlaying here as that will happen automatically
      // in the PlayerStore once the track is loaded and ready
    }
  }

  const handleTrackRemove = (trackId: string) => {
    deleteTrack(trackId);
    showToast({
      message: "Track removed",
      variant: 'success'
    });
    setTracks(convertStoreTracksToUI());
  }

  const handleImportButtonClick = () => {
    console.log(`[MusicLibrary] Import button clicked`);
    const fileInput = document.getElementById("file-upload") as HTMLInputElement
    if (fileInput) {
      console.log(`[MusicLibrary] Triggering file input click`);
      fileInput.click()
    } else {
      console.error(`[MusicLibrary] File input element not found`);
    }
  }

  const handleEQSettingsClick = () => {
    // Navigate directly to EQ tab using the setActiveTab prop
    setActiveTab("eq")
    
    // If EQ is currently disabled, we could optionally enable it when user clicks to adjust settings
    // This makes for a smoother user experience
    if (!isEQEnabled) {
      useEQProfileStore.getState().setEQEnabled(true);
    }
  }

  const handleTogglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false); // Pause if currently playing
    } else {
      setIsPlaying(true); // Play if currently paused
    }
  }

  // Show loading skeleton only when IndexedDB is loading track data
  if (isTrackStoreLoading) {
    console.log(`[MusicLibrary] Rendering loading skeleton because isTrackStoreLoading: ${isTrackStoreLoading}`);
    return <LoadingSkeleton itemCount={5} className="pb-24" />
  }

  // Show empty state if no tracks (only after loading completes)
  if (tracks.length === 0) {
    console.log(`[MusicLibrary] Rendering empty library state (no tracks)`);
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
        onFileSelect={handleFileSelect}
        className="pb-24"
        onSignupClick={onSignupClick}
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
              isPlaying={isPlaying && currentTrackId === track.id}
              isCurrentTrack={currentTrackId === track.id}
              onPlay={handleTrackSelect}
              onTogglePlayPause={handleTogglePlayback}
              onRemove={handleTrackRemove}
              isLastItem={index === tracks.length - 1}
            />
          ))}
        </div>
      </div>

      <ImportArea onImportClick={handleImportButtonClick} />

      {false && <div className="text-center py-4">
        <p className="text-sm text-muted-foreground">
          <Button 
            variant="link" 
            className="text-purple hover:text-purple/80 font-medium p-0 h-auto"
            onClick={onSignupClick}
          >
            Sign up
          </Button>{" "}
          to save your music (so that it won&apos;t disappear when you refresh), create playlists, and listen on any device.
        </p>
      </div>}

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