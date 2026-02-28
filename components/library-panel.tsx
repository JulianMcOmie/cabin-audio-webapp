"use client"

import { X, Plus } from "lucide-react"
import { MusicLibrary } from "@/components/music-library/MusicLibrary"

interface LibraryPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function LibraryPanel({ isOpen, onClose }: LibraryPanelProps) {
  const handleHeaderImportClick = () => {
    const fileInput = document.getElementById("file-upload") as HTMLInputElement
    if (fileInput) {
      fileInput.click()
    }
  }

  return (
    <div
      className={`absolute bottom-[140px] left-4 right-16 z-[35] max-w-2xl transition-all duration-300 ease-out ${
        isOpen
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-6 pointer-events-none"
      }`}
    >
      <div className="glass-panel rounded-2xl max-h-[50vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0 border-b dark:border-white/[0.06] border-black/[0.06]">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider dark:text-white/50 text-black/50">Music Library</h4>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleHeaderImportClick}
              className="rounded-lg p-1 dark:text-white/40 text-black/40 dark:hover:text-white/80 hover:text-black/80 dark:hover:bg-white/[0.06] hover:bg-black/[0.06] transition-all"
              title="Import music"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1 dark:text-white/40 text-black/40 dark:hover:text-white/80 hover:text-black/80 dark:hover:bg-white/[0.06] hover:bg-black/[0.06] transition-all"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {/* Scrollable track list */}
        <div className="overflow-auto px-4 py-3 scrollbar-thin">
          <MusicLibrary />
        </div>
      </div>
    </div>
  )
}
