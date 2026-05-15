"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MainView } from "@/components/main-view"
import { ControlPanel } from "@/components/control-panel"
import { EQOverlay } from "@/components/eq-overlay"
import { LibraryPanel } from "@/components/library-panel"
import { usePlayerStore, useTrackStore } from "@/lib/stores"
import type { QualityLevel } from "@/components/unified-particle-scene"
import type { HighlightTarget } from "@/components/top-overlay"
import type { ActiveBand } from "@/components/main-view"

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
  const highlightTarget: HighlightTarget = null
  const [, setIsDraggingGrid] = useState(false)
  const [activeBand, setActiveBand] = useState<ActiveBand | null>(null)

  const isPlaying = usePlayerStore(s => s.isPlaying)

  // Stable callback for active band changes from EQ — avoid re-rendering EQ overlay
  const activeBandRef = useRef<ActiveBand | null>(null)
  const handleActiveBandChange = useCallback((band: ActiveBand | null) => {
    // Only update state if the band actually changed
    const prev = activeBandRef.current
    if (band === null && prev === null) return
    if (band && prev && band.frequency === prev.frequency && band.gain === prev.gain && band.q === prev.q) return
    activeBandRef.current = band
    setActiveBand(band)
  }, [])

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
      <div
        className={`absolute left-0 right-32 top-0 z-0 transition-[bottom] duration-200 ${
          showEQOverlay ? "bottom-[calc(33vh+12rem)]" : "bottom-44"
        }`}
      >
        <MainView quality={quality} highlightTarget={highlightTarget} isPlaying={isPlaying} onDragStateChange={setIsDraggingGrid} activeBand={activeBand} />
      </div>

      {/* EQ Overlay */}
      <EQOverlay isOpen={showEQOverlay} onClose={() => setShowEQOverlay(false)} onActiveBandChange={handleActiveBandChange} />

      {/* Library Panel — sits directly above control bar */}
      <LibraryPanel isOpen={showLibrary} onClose={() => setShowLibrary(false)} />

      <ControlPanel
        showEQOverlay={showEQOverlay}
        onToggleEQOverlay={toggleEQOverlay}
        onToggleLibrary={toggleLibrary}
        highlightTarget={highlightTarget}
        quality={quality}
      />
    </div>
  )
}
