"use client"

import { useState, useEffect, useCallback } from "react"
import { Upload } from "lucide-react"
import { useToast } from "@/components/common/ToastManager"
import { useFileImport } from "@/lib/hooks/useFileImport"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"
import { useTrackStore, usePlayerStore, useEQProfileStore, useArtistStore, useAlbumStore } from "@/lib/stores"
import { Track as TrackModel } from "@/lib/models/Track"
import * as fileStorage from "@/lib/storage/fileStorage"

// Import the extracted components
import { TrackItem } from "./TrackItem"
import { EmptyLibrary } from "./EmptyLibrary"
import { LoadingSkeleton } from "./ui/LoadingSkeleton"
import { DragDropArea } from "./ui/DragDropArea"
import { DragOverlay } from "./ui/DragOverlay"

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

export function MusicLibrary() {
  const { showToast } = useToast()
  // Connect to trackStore
  const { getTracks, addTrack, deleteTrack, isLoading: isTrackStoreLoading } = useTrackStore()
  // Connect to playerStore
  const { currentTrackId, isPlaying, setCurrentTrack, setIsPlaying } = usePlayerStore()
  // Connect to eqProfileStore for the actual EQ enabled state
  const { isEQEnabled } = useEQProfileStore()
  // Connect to artistStore
  const getArtistById = useArtistStore(state => state.getArtistById)
  // Connect to albumStore
  const getAlbumById = useAlbumStore(state => state.getAlbumById)
  
  const [tracks, setTracks] = useState<Track[]>([])
  // Store cover image URLs to avoid recreating them on every render
  const [coverImageUrls, setCoverImageUrls] = useState<Record<string, string>>({})

  // Convert store tracks to UI tracks
  const convertStoreTracksToUI = useCallback(() => {
    const storeTracks = getTracks();
    
    // First collect all needed cover art keys
    const coverKeys = storeTracks
      .filter(track => track.coverStorageKey)
      .map(track => track.coverStorageKey!)
      .filter(key => !coverImageUrls[key]);
    
    // Load cover URLs if not already loaded
    if (coverKeys.length > 0) {
      Promise.all(
        coverKeys.map(async (key) => {
          try {
            const url = await fileStorage.getImageFileUrl(key);
            return { key, url };
          } catch {
            return { key, url: "/placeholder.svg?height=48&width=48" };
          }
        })
      ).then(results => {
        const newUrls: Record<string, string> = { ...coverImageUrls };
        results.forEach(({ key, url }) => {
          newUrls[key] = url;
        });
        setCoverImageUrls(newUrls);
      });
    }
    
    const uiTracks = storeTracks.map((storeTrack): Track => {
      // Get artist name
      let artistName = "Unknown Artist";
      if (storeTrack.artistId) {
        const artist = getArtistById(storeTrack.artistId);
        if (artist) {
          artistName = artist.name;
        }
      }
      
      // Get album name
      let albumName = "Unknown Album";
      if (storeTrack.albumId) {
        const album = getAlbumById(storeTrack.albumId);
        if (album) {
          albumName = album.title;
        }
      }
      
      // Get cover URL from cache or use placeholder
      const coverUrl = storeTrack.coverStorageKey && coverImageUrls[storeTrack.coverStorageKey]
        ? coverImageUrls[storeTrack.coverStorageKey]
        : "/placeholder.svg?height=48&width=48";
      
      return {
        id: storeTrack.id,
        title: storeTrack.title,
        artist: artistName,
        album: albumName,
        duration: storeTrack.duration,
        coverUrl
      };
    });
    
    return uiTracks;
  }, [getTracks, coverImageUrls, getArtistById, getAlbumById])

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
      
      // Explicitly update tracks state after import completes
      // This ensures we don't rely solely on the subscription
      const updatedTracks = convertStoreTracksToUI();
      setTracks(updatedTracks);
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
      try {
        // If store is empty and not loading, populate with sample data if URL param is present
        const storeTracksCount = getTracks().length;
        const isStoreEmpty = storeTracksCount === 0 && !isTrackStoreLoading;
        
        if (isStoreEmpty) {
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
                dateCreated: Date.now(), // First track
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
                dateCreated: Date.now() + 1000, // 1 second later
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
                dateCreated: Date.now() + 2000, // 2 seconds later
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
                dateCreated: Date.now() + 3000, // 3 seconds later
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
                dateCreated: Date.now() + 4000, // 4 seconds later
                syncStatus: 'pending'
              },
            ];
            
            // Add each track to the store
            sampleTracks.forEach(track => {
              addTrack(track);
            });
          }
        }
        
        // Convert store tracks to UI format and update state if not loading
        if (!isTrackStoreLoading) {
          const uiTracks = convertStoreTracksToUI();
          setTracks(uiTracks);
        }
      } catch {
        showToast({
          message: "Failed to load tracks",
          variant: 'error'
        })
      }
    }

    loadTracks()

    // Subscribe to track store changes to update UI when tracks are added
    const unsubscribe = useTrackStore.subscribe((state) => {
      // Only update tracks if we're not in the loading state
      if (!state.isLoading) {
        const uiTracks = convertStoreTracksToUI();
        setTracks(uiTracks);
      }
    });
    
    // Clean up subscription on component unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [showToast, addTrack, getTracks, isTrackStoreLoading, getArtistById, getAlbumById, coverImageUrls, convertStoreTracksToUI])

  // Add a new effect to listen for EQ status changes
  useEffect(() => {
    // Subscribe to EQ profile store to detect when EQ is enabled/disabled
    const unsubscribeEQ = useEQProfileStore.subscribe(() => {
      // The component will re-render automatically when isEQEnabled changes
    });

    return () => {
      if (unsubscribeEQ) {
        unsubscribeEQ();
      }
    };
  }, []);

  const handleTrackSelect = (track: Track) => {
    if (currentTrackId === track.id) {
      // If the same track is clicked, explicitly set play/pause state
      if (isPlaying) {
        setIsPlaying(false); // Pause if currently playing
      } else {
        setIsPlaying(true); // Play if currently paused
      }
    } else {
      // If a different track is clicked, select it
      // The PlayerStore will automatically start playback once the track is loaded
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
    const fileInput = document.getElementById("file-upload") as HTMLInputElement
    if (fileInput) {
      fileInput.click()
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
    return (
      <DragDropArea
        dragActive={dragActive}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="mx-auto space-y-4 relative"
      >
        <div className="rounded-md dark:border-white/10 border-black/10 border p-4">
          <LoadingSkeleton itemCount={5} />
        </div>

        <DragOverlay isVisible={dragActive} />
      </DragDropArea>
    )
  }

  // Show empty state if no tracks (only after loading completes)
  if (tracks.length === 0) {
    return (
      <EmptyLibrary
        eqEnabled={isEQEnabled}
        dragActive={dragActive}
        isImporting={isImporting}
        importProgress={importProgress}
        currentFile={currentFile || undefined}
        onImportClick={handleImportButtonClick}
        onCancel={cancelImport}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onFileSelect={handleFileSelect}
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
      className="mx-auto space-y-4 relative"
    >
      <input
        type="file"
        id="file-upload"
        className="hidden"
        accept="audio/*,.mp3,.wav,.flac"
        onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
        multiple
      />

      <div>
        <div className="rounded-md dark:border-white/10 border-black/10 border">
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

      <button
        onClick={handleImportButtonClick}
        className="w-full py-2 text-xs dark:text-white/30 text-black/30 dark:hover:text-white/60 hover:text-black/60 transition-colors flex items-center justify-center gap-1.5"
      >
        <Upload className="h-3 w-3" />
        Import music
      </button>

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
