"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { SettingsPanel } from "@/components/settings-panel"
import * as dotGridAudio from "@/lib/audio/dotGridAudio"
import { resumeAudioContext } from "@/lib/audio/audioContext"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { usePlayerStore } from "@/lib/stores"
import type { QualityLevel } from "@/components/unified-particle-scene"
import type { HighlightTarget } from "@/components/top-overlay"

const UnifiedParticleScene = dynamic(
  () => import("@/components/unified-particle-scene").then((mod) => mod.UnifiedParticleScene),
  { ssr: false }
)

const MIN_ROWS = 3
const MAX_ROWS = 12
const MIN_COLS = 3
const MAX_COLS = 14

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

function saveSetting<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota errors etc */ }
}

export function MainView({ quality, highlightTarget, isPlaying }: { quality: QualityLevel; highlightTarget: HighlightTarget; isPlaying: boolean }) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  const [gridRows, setGridRows] = useState(() => loadSetting("cabin:gridRows", 3))
  const [gridCols, setGridCols] = useState(() => loadSetting("cabin:gridCols", 5))
  const [speed, setSpeed] = useState(() => loadSetting("cabin:speed", 2))
  const [volumePercent, setVolumePercent] = useState(() => loadSetting("cabin:volumePercent", 80))
  const [release, setRelease] = useState(() => loadSetting("cabin:release", 1.2))
  const [settingsCollapsed, setSettingsCollapsed] = useState(() => loadSetting("cabin:settingsCollapsed", false))
  const [hoveredDot, setHoveredDot] = useState<string | null>(null)
  const [sequencerVisual, setSequencerVisual] = useState<{ playingDotKey: string | null; beatIndex: number }>({
    playingDotKey: null,
    beatIndex: 0,
  })
  const { setEQEnabled } = useEQProfileStore()

  const hasSelectedDots = selectedDots.size > 0

  // Persist settings to localStorage
  useEffect(() => { saveSetting("cabin:gridRows", gridRows) }, [gridRows])
  useEffect(() => { saveSetting("cabin:gridCols", gridCols) }, [gridCols])
  useEffect(() => { saveSetting("cabin:speed", speed) }, [speed])
  useEffect(() => { saveSetting("cabin:volumePercent", volumePercent) }, [volumePercent])
  useEffect(() => { saveSetting("cabin:settingsCollapsed", settingsCollapsed) }, [settingsCollapsed])
  useEffect(() => { saveSetting("cabin:release", release) }, [release])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()

    player.setLoopSequencerEnabled(true)
    player.setLoopSequencerPlayTogether(false)
    player.setInterleavedHits(true)
    player.setVolumeSteps(1)
    player.setNumberOfHits(1)
    player.setHitDecay(0)
    player.setVolumeLevelRangeDb(0)
    player.setSubHitPlaybackEnabled(false)
    player.setHitModeAttack(0.01)

    player.setPerCycleVolumeEnabled(false)
    player.setPerDotVolumeWaveEnabled(false)
    player.setAutoVolumeCycleEnabled(false)

    const analyser = player.createPreEQAnalyser()
    player.connectToAnalyser(analyser)

    setEQEnabled(true)

    return () => {
      player.setPlaying(false)
    }
  }, [setEQEnabled])

  useEffect(() => {
    setSelectedDots((prev) => {
      const next = new Set<string>()
      prev.forEach((dotKey) => {
        const [x, y] = dotKey.split(",").map(Number)
        if (x < gridCols && y < gridRows) {
          next.add(dotKey)
        }
      })
      return next
    })
  }, [gridRows, gridCols])

  // Subscribe to song playback state — stop soundstage sequencer when a song is playing
  const isSongPlaying = usePlayerStore((s) => s.isPlaying)

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    if (!hasSelectedDots || isSongPlaying) {
      setSequencerVisual({ playingDotKey: null, beatIndex: 0 })
      return
    }

    let frameId = 0
    const tick = () => {
      const next = player.getLoopSequencerVisualState()
      setSequencerVisual((prev) => {
        if (prev.playingDotKey === next.playingDotKey && prev.beatIndex === next.beatIndex) {
          return prev
        }
        return next
      })
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [hasSelectedDots, isSongPlaying])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.updateDots(selectedDots, gridRows, gridCols)
    if (selectedDots.size > 0 && !isSongPlaying) {
      void resumeAudioContext().then(() => {
        player.setPlaying(true)
      })
    } else {
      player.setPlaying(false)
    }
  }, [selectedDots, gridRows, gridCols, isSongPlaying])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setHitModeRate(speed)
  }, [speed])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setHitModeRelease(release)
  }, [release])

  useEffect(() => {
    if (volumePercent === 0) {
      dotGridAudio.getDotGridAudioPlayer().setVolumeDb(-Infinity)
    } else {
      // Linear dB scale: 100% = 0 dB, 1% ≈ -60 dB
      const db = -60 + (volumePercent / 100) * 60
      dotGridAudio.getDotGridAudioPlayer().setVolumeDb(db)
    }
  }, [volumePercent])

  // Arrow-key movement of selected dots
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let dx = 0
      let dy = 0
      switch (e.key) {
        case "ArrowLeft":
          dx = -1
          break
        case "ArrowRight":
          dx = 1
          break
        case "ArrowDown":
          dy = -1
          break
        case "ArrowUp":
          dy = 1
          break
        default:
          return
      }

      e.preventDefault()

      setSelectedDots((prev) => {
        if (prev.size === 0) return prev

        // Check if any selected dot is already on the edge in this direction
        for (const key of prev) {
          const [col, row] = key.split(",").map(Number)
          if (dx === -1 && col <= 0) return prev
          if (dx === 1 && col >= gridCols - 1) return prev
          if (dy === -1 && row <= 0) return prev
          if (dy === 1 && row >= gridRows - 1) return prev
        }

        // Move all selected dots
        const next = new Set<string>()
        for (const key of prev) {
          const [col, row] = key.split(",").map(Number)
          next.add(`${col + dx},${row + dy}`)
        }
        return next
      })
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [gridRows, gridCols])

  const { playingDotKey, beatIndex } = sequencerVisual

  const handleDotSelect = useCallback((x: number, y: number) => {
    void resumeAudioContext()
    const key = `${x},${y}`
    setSelectedDots((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const handleDotDeselect = useCallback((x: number, y: number) => {
    const key = `${x},${y}`
    setSelectedDots((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const handleSetGridSize = useCallback((rows: number, cols: number) => {
    setGridRows(rows)
    setGridCols(cols)
  }, [])

  return (
    <div className={`relative w-full h-full min-h-0 transition-opacity duration-200 ${
      highlightTarget === "eq" ? "opacity-30" : ""
    }`}>
      {highlightTarget === "grid" && (
        <>
          {/* Subtle border + glow — the real glow comes from the dots/particles */}
          <div className="absolute inset-0 z-10 pointer-events-none rounded-lg" style={{
            boxShadow: "0 0 30px rgba(34,211,238,0.08)",
            border: "1px solid rgba(34,211,238,0.15)",
          }} />
          {isPlaying && (
            <div className="absolute inset-0 z-20 pointer-events-none bg-black/60 rounded-lg transition-opacity duration-300 flex items-center justify-center">
              <span className="text-white/60 text-sm font-medium">Pause music to use the grid tool</span>
            </div>
          )}
        </>
      )}
      <UnifiedParticleScene
        gridRows={gridRows}
        gridCols={gridCols}
        selectedDots={selectedDots}
        onDotSelect={handleDotSelect}
        onDotDeselect={handleDotDeselect}
        playingDotKey={playingDotKey}
        beatIndex={beatIndex}
        hoveredDot={hoveredDot}
        onHoverDot={setHoveredDot}
        quality={quality}
        highlightTarget={highlightTarget}
      />
      <SettingsPanel
        collapsed={settingsCollapsed}
        onToggle={() => setSettingsCollapsed((v) => !v)}
        gridRows={gridRows}
        gridCols={gridCols}
        minRows={MIN_ROWS}
        maxRows={MAX_ROWS}
        minCols={MIN_COLS}
        maxCols={MAX_COLS}
        onSetGridSize={handleSetGridSize}
        speed={speed}
        onSpeedChange={setSpeed}
        volumePercent={volumePercent}
        onVolumeChange={setVolumePercent}
        release={release}
        onReleaseChange={setRelease}
        isPlaying={isPlaying}
      />
    </div>
  )
}
