"use client"

import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ImportAreaProps {
  onImportClick: () => void
}

export function ImportArea({ onImportClick }: ImportAreaProps) {
  return (
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
          onClick={onImportClick}
        >
          Browse files
        </Button>
      </div>
    </div>
  )
} 