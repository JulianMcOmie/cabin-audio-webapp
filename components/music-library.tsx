"use client"

import { useState, useEffect } from "react"
import { Music, Upload, Play, Pause, FileMusic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/common/ToastManager"
import { useFileImport } from "@/lib/hooks/useFileImport"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"

// Dummy track interface
interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string
}

interface MusicLibraryProps {
  onTrackSelect?: (track: Track) => void
}

export function MusicLibrary({ onTrackSelect }: MusicLibraryProps) {
  const { showToast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

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
        variant: "success",
      })

      // Add imported tracks to the list
      const newTracks = files.map((file, index) => ({
        id: `imported-${Date.now()}-${index}`,
        title: file.name.replace(/\.[^/.]+$/, ""), // Remove file extension
        artist: "Imported Artist",
        album: "Imported Album",
        duration: Math.floor(Math.random() * 300) + 120, // Random duration
        coverUrl: "/placeholder.svg?height=48&width=48",
      }))

      setTracks((prev) => [...newTracks, ...prev])
    },
    onError: (error) => {
      showToast({
        message: error,
        variant: "error",
      })
    },
  })

  // Dummy data loading
  useEffect(() => {
    const loadTracks = async () => {
      setIsLoading(true)
      try {
        // Simulate API call with timeout
        await new Promise((resolve) => setTimeout(resolve, 1500))

        // Check if we should show empty state for testing
        const urlParams = new URLSearchParams(window.location.search)
        const showEmpty = urlParams.get("empty") === "true"

        if (!showEmpty) {
          setTracks([
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
          ])
        }
      } catch (error) {
        showToast({
          message: "Failed to load tracks",
          variant: "error",
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadTracks()
  }, [showToast])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleTrackSelect = (track: Track) => {
    if (currentlyPlaying === track.id) {
      // If the same track is clicked, toggle play/pause
      setIsPlaying(!isPlaying)
    } else {
      // If a different track is clicked, select it and start playing
      setCurrentlyPlaying(track.id)
      setIsPlaying(true)
      onTrackSelect?.(track)
    }
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="space-y-6 p-4">
        <div className="flex justify-between items-center mb-2 animate-pulse">
          <div className="h-8 w-48 bg-muted rounded"></div>
          <div className="h-8 w-24 bg-muted rounded"></div>
        </div>

        <div className="rounded-md border p-4 space-y-4">
          {Array(5)
            .fill(0)
            .map((_, index) => (
              <div key={index} className="flex items-center py-3 px-2 animate-pulse">
                <div className="h-12 w-12 bg-muted rounded-md mr-4"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
                <div className="h-4 w-10 bg-muted rounded"></div>
                {index < 4 && <Separator className="mt-4" />}
              </div>
            ))}
        </div>
      </div>
    )
  }

  // Render empty state
  if (tracks.length === 0) {
    return (
      <div
        className={`p-4 h-full ${dragActive ? "drag-active" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex justify-between items-center mb-2">
          <div>
            <h2 className="text-2xl font-semibold">Music Library</h2>
            <p className="text-sm text-muted-foreground">Your local files & royalty-free music.</p>
          </div>
        </div>

        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center h-[calc(100%-60px)] flex items-center justify-center">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Music className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No music found</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Import your music files to get started. We support MP3, WAV, and FLAC formats.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                const fileInput = document.getElementById("file-upload") as HTMLInputElement
                if (fileInput) fileInput.click()
              }}
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

        {/* Import overlay */}
        <FileImportOverlay
          isVisible={isImporting}
          progress={importProgress}
          currentFile={currentFile || undefined}
          onCancel={cancelImport}
        />

        {/* Drag overlay */}
        {dragActive && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 border-2 border-dashed border-primary rounded-lg">
            <div className="text-center p-8 rounded-lg">
              <FileMusic className="h-16 w-16 mx-auto mb-4 text-primary animate-pulse" />
              <h3 className="text-2xl font-bold mb-2">Drop your audio files here</h3>
              <p className="text-muted-foreground">We support MP3, WAV, and FLAC formats</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render normal state with tracks
  return (
    <div
      className={`p-4 relative ${dragActive ? "drag-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-semibold">Music Library</h2>
          <p className="text-sm text-muted-foreground">Your local files & royalty-free music.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const fileInput = document.getElementById("file-upload") as HTMLInputElement
            if (fileInput) fileInput.click()
          }}
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

      <div className="rounded-md border p-4 mb-6">
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
                <div className="absolute inset-0 bg-black/40 rounded-md opacity-0 group-hover:opacity-100 flex items-center justify-center">
                  {currentlyPlaying === track.id && isPlaying ? (
                    <Pause className="h-6 w-6 text-white" />
                  ) : (
                    <Play className="h-6 w-6 text-white" />
                  )}
                </div>
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

      {/* Add the drag and drop area here, so it's visible even when tracks are present */}
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
            className="mt-4"
            onClick={() => {
              const fileInput = document.getElementById("file-upload-area") as HTMLInputElement
              if (fileInput) fileInput.click()
            }}
          >
            Browse files
          </Button>
          <input
            type="file"
            id="file-upload-area"
            className="hidden"
            accept="audio/*,.mp3,.wav,.flac"
            onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
            multiple
          />
        </div>
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
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 border-2 border-dashed border-primary rounded-lg">
          <div className="text-center p-8 rounded-lg">
            <FileMusic className="h-16 w-16 mx-auto mb-4 text-primary animate-pulse" />
            <h3 className="text-2xl font-bold mb-2">Drop your audio files here</h3>
            <p className="text-muted-foreground">We support MP3, WAV, and FLAC formats</p>
          </div>
        </div>
      )}
    </div>
  )
}

