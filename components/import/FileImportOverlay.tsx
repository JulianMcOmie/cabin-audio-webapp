"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

export interface FileImportOverlayProps {
  isVisible: boolean
  progress: number
  currentFile?: string
  onCancel: () => void
}

export function FileImportOverlay({ isVisible, progress, currentFile, onCancel }: FileImportOverlayProps) {
  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border rounded-lg shadow-lg max-w-md w-full p-6 animate-in fade-in-50">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Importing Music</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel</span>
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Processing files...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {currentFile && (
            <div className="text-sm text-muted-foreground">
              <p className="truncate">Current file: {currentFile}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

