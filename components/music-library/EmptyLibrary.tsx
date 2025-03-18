"use client"

import { DragEventHandler } from "react"
import { Music, Upload, FileMusic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"
import { EQStatusAlert } from "./EQStatusAlert"

interface EmptyLibraryProps {
  eqEnabled: boolean
  dragActive: boolean
  isImporting: boolean
  importProgress: number
  currentFile?: string
  onImportClick: () => void
  onCancel: () => void
  onEQSettingsClick: () => void
  onDragEnter: DragEventHandler
  onDragLeave: DragEventHandler
  onDragOver: DragEventHandler
  onDrop: DragEventHandler
  onFileSelect: (files: FileList) => void
  className?: string
  onSignupClick: () => void
}

export function EmptyLibrary({
  eqEnabled,
  dragActive,
  isImporting,
  importProgress,
  currentFile,
  onImportClick,
  onCancel,
  onEQSettingsClick,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileSelect,
  className = "",
  onSignupClick
}: EmptyLibraryProps) {
  return (
    <div 
      className={`mx-auto space-y-8 pb-24 ${dragActive ? "drag-active" : ""} ${className}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <EQStatusAlert isEnabled={eqEnabled} onSettingsClick={onEQSettingsClick} />

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
            onClick={onImportClick}
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Music
          </Button>
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept="audio/*,.mp3,.wav,.flac"
            onChange={(e) => e.target.files && onFileSelect(e.target.files)}
            multiple
          />
        </div>
      </div>

      {false &&<div className="text-center py-4">
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

      {/* Import overlay */}
      <FileImportOverlay
        isVisible={isImporting}
        progress={importProgress}
        currentFile={currentFile}
        onCancel={onCancel}
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