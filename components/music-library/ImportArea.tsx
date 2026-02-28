"use client"

import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ImportAreaProps {
  onImportClick: () => void
}

export function ImportArea({ onImportClick }: ImportAreaProps) {
  return (
    <div className="rounded-lg py-4 text-center">
      <Button
        variant="ghost"
        className="text-sm dark:text-white/50 text-black/50 dark:hover:text-white/80 hover:text-black/80"
        onClick={onImportClick}
      >
        <Upload className="mr-2 h-4 w-4" />
        Import Music
      </Button>
    </div>
  )
} 