"use client"

import { FileMusic } from "lucide-react"

interface DragOverlayProps {
  isVisible: boolean
}

export function DragOverlay({ isVisible }: DragOverlayProps) {
  if (!isVisible) return null
  
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 border-2 border-dashed border-primary rounded-lg">
      <div className="text-center p-8 rounded-lg">
        <FileMusic className="h-16 w-16 mx-auto mb-4 text-purple animate-pulse" />
        <h3 className="text-2xl font-bold mb-2">Drop your audio files here</h3>
        <p className="text-muted-foreground">We support MP3, WAV, and FLAC formats</p>
      </div>
    </div>
  )
} 