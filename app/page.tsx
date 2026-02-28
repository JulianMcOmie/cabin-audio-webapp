"use client"

import { useState, useEffect, useCallback } from "react"
import { MainView } from "@/components/main-view"
import { TopOverlay } from "@/components/top-overlay"
import { ControlPanel } from "@/components/control-panel"
import { EQOverlay } from "@/components/eq-overlay"
import { LibraryPanel } from "@/components/library-panel"
import { usePlayerStore, useTrackStore } from "@/lib/stores"
import type { QualityLevel } from "@/components/unified-particle-scene"
import type { HighlightTarget } from "@/components/top-overlay"

const LAST_PLAYED_TRACK_STORAGE_KEY = "cabin:lastPlayedTrackId"

function getSavedLastPlayedTrackId(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(LAST_PLAYED_TRACK_STORAGE_KEY)
  } catch {
    return null
  }
}

function loadSetting<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export default function Home() {
  const [showEQOverlay, setShowEQOverlay] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [quality, setQuality] = useState<QualityLevel>("low")
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget>(null)
  const [isDraggingGrid, setIsDraggingGrid] = useState(false)
  const [metaHeld, setMetaHeld] = useState(false)

  const isPlaying = usePlayerStore(s => s.isPlaying)

  // Hydrate quality from localStorage after mount
  useEffect(() => {
    setQuality(loadSetting("cabin:quality", "low" as QualityLevel))
  }, [])

  // Persist quality setting
  useEffect(() => {
    try { localStorage.setItem("cabin:quality", JSON.stringify(quality)) } catch { /* ignore */ }
  }, [quality])

  // Auto-select startup track once tracks finish loading:
  // 1) last played track saved in localStorage (if still present)
  // 2) first track in library (trackStore default)
  const currentTrackId = usePlayerStore(s => s.currentTrackId)
  const setCurrentTrack = usePlayerStore(s => s.setCurrentTrack)

  useEffect(() => {
    // If player already has a track, skip
    if (currentTrackId) return

    const unsub = useTrackStore.subscribe((state) => {
      if (!state.isLoading && !usePlayerStore.getState().currentTrackId) {
        const savedTrackId = getSavedLastPlayedTrackId()
        const startupTrackId =
          savedTrackId && state.tracks[savedTrackId]
            ? savedTrackId
            : state.currentTrackId

        if (startupTrackId) {
          setCurrentTrack(startupTrackId, false)
          unsub()
        }
      }
    })

    // Also check immediately in case store already loaded
    const state = useTrackStore.getState()
    if (!state.isLoading && state.currentTrackId) {
      const savedTrackId = getSavedLastPlayedTrackId()
      const startupTrackId =
        savedTrackId && state.tracks[savedTrackId]
          ? savedTrackId
          : state.currentTrackId

      if (startupTrackId) {
        setCurrentTrack(startupTrackId, false)
      }
      unsub()
    }

    return unsub
  }, [currentTrackId, setCurrentTrack])

  const toggleEQOverlay = useCallback(() => {
    setShowEQOverlay((v) => !v)
  }, [])

  const toggleLibrary = useCallback(() => {
    setShowLibrary((v) => !v)
  }, [])

  // Track Command (Meta) key for cursor sphere mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") setMetaHeld(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") setMetaHeld(false)
    }
    const handleBlur = () => setMetaHeld(false)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [])

  // Escape key dismisses overlays
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showEQOverlay) setShowEQOverlay(false)
        else if (showLibrary) setShowLibrary(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [showEQOverlay, showLibrary])

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Main view fills entire viewport */}
      <div className="absolute inset-0 z-0">
        <MainView quality={quality} highlightTarget={highlightTarget} isPlaying={isPlaying} onDragStateChange={setIsDraggingGrid} />
      </div>

      {/* Top overlay: logo + how to use + quality */}
      <TopOverlay quality={quality} onQualityChange={setQuality} onHighlightTarget={setHighlightTarget} />

      {/* EQ Overlay */}
      <EQOverlay isOpen={showEQOverlay} onClose={() => setShowEQOverlay(false)} />

      {/* Library Panel — sits directly above control bar */}
      <LibraryPanel isOpen={showLibrary} onClose={() => setShowLibrary(false)} />

      {/* Control Panel: fades out while dragging on the grid */}
      <div className={`transition-opacity duration-300 ${isDraggingGrid || metaHeld ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
        <ControlPanel
          showEQOverlay={showEQOverlay}
          onToggleEQOverlay={toggleEQOverlay}
          onToggleLibrary={toggleLibrary}
          highlightTarget={highlightTarget}
          quality={quality}
        />
      </div>
    </div>
  )
}
