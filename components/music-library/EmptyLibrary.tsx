"use client"

import { DragEventHandler } from "react"
import { Music, Upload, FileMusic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileImportOverlay } from "@/components/import/FileImportOverlay"

interface EmptyLibraryProps {
  eqEnabled: boolean
  dragActive: boolean
  isImporting: boolean
  importProgress: number
  currentFile?: string
  onImportClick: () => void
  onCancel: () => void
  onEQSettingsClick?: () => void
  onDragEnter: DragEventHandler
  onDragLeave: DragEventHandler
  onDragOver: DragEventHandler
  onDrop: DragEventHandler
  onFileSelect: (files: FileList) => void
  className?: string
}

export function EmptyLibrary({
  dragActive,
  isImporting,
  importProgress,
  currentFile,
  onImportClick,
  onCancel,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileSelect,
  className = ""
}: EmptyLibraryProps) {
  return (
    <div
      className={`mx-auto space-y-6 ${dragActive ? "drag-active" : ""} ${className}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="rounded-lg py-8 text-center">
        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Music className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            MP3, WAV, and FLAC supported
          </p>
          <Button
            className="mt-3 bg-purple hover:bg-purple/90 text-white"
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
