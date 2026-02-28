"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
const MAX_ROWS = 6
const MIN_COLS = 3
const MAX_COLS = 8

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

// Default values used for SSR — must match the fallbacks below
const DEFAULTS = {
  gridRows: 3,
  gridCols: 5,
  speed: 1.5,
  volumePercent: 90,
  release: 2,
  bandwidth: 6,
  settingsCollapsed: true,
} as const

export function MainView({ quality, highlightTarget, isPlaying, onDragStateChange }: { quality: QualityLevel; highlightTarget: HighlightTarget; isPlaying: boolean; onDragStateChange?: (isDragging: boolean) => void }) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  const [gridRows, setGridRows] = useState<number>(DEFAULTS.gridRows)
  const [gridCols, setGridCols] = useState<number>(DEFAULTS.gridCols)
  const [speed, setSpeed] = useState<number>(DEFAULTS.speed)
  const [volumePercent, setVolumePercent] = useState<number>(DEFAULTS.volumePercent)
  const [release, setRelease] = useState<number>(DEFAULTS.release)
  const [bandwidth, setBandwidth] = useState<number>(DEFAULTS.bandwidth)
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(DEFAULTS.settingsCollapsed)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    setGridRows(loadSetting("cabin:gridRows", DEFAULTS.gridRows))
    setGridCols(loadSetting("cabin:gridCols", DEFAULTS.gridCols))
    setSpeed(loadSetting("cabin:speed", DEFAULTS.speed))
    setVolumePercent(loadSetting("cabin:volumePercent", DEFAULTS.volumePercent))
    setRelease(loadSetting("cabin:release", DEFAULTS.release))
    setBandwidth(loadSetting("cabin:bandwidth", DEFAULTS.bandwidth))
    setSettingsCollapsed(loadSetting("cabin:settingsCollapsed", DEFAULTS.settingsCollapsed))
  }, [])
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
  useEffect(() => { saveSetting("cabin:bandwidth", bandwidth) }, [bandwidth])

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
    dotGridAudio.getDotGridAudioPlayer().setBandpassBandwidth(bandwidth)
  }, [bandwidth])

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

  // ---- Cursor dot (Command-key) state ----
  const [cursorDotPosition, setCursorDotPosition] = useState<{ normalizedX: number; normalizedY: number } | null>(null)
  const cursorPlayActiveRef = useRef(false)

  const handleCursorDotMove = useCallback((normalizedX: number, normalizedY: number) => {
    void resumeAudioContext()
    const player = dotGridAudio.getDotGridAudioPlayer()
    if (!cursorPlayActiveRef.current) {
      cursorPlayActiveRef.current = true
      player.startCursorPlay(normalizedX, normalizedY)
    } else {
      player.updateCursorPosition(normalizedX, normalizedY)
    }
    setCursorDotPosition({ normalizedX, normalizedY })
  }, [])

  const handleCursorDotEnd = useCallback(() => {
    if (!cursorPlayActiveRef.current) return
    cursorPlayActiveRef.current = false
    dotGridAudio.getDotGridAudioPlayer().stopCursorPlay()
    setCursorDotPosition(null)
  }, [])

  // Clean up cursor play on Meta key release or window blur
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        handleCursorDotEnd()
      }
    }
    const handleBlur = () => {
      handleCursorDotEnd()
    }
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [handleCursorDotEnd])

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
        onDragStateChange={onDragStateChange}
        cursorDotPosition={cursorDotPosition}
        onCursorDotMove={handleCursorDotMove}
        onCursorDotEnd={handleCursorDotEnd}
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
        bandwidth={bandwidth}
        onBandwidthChange={setBandwidth}
        isPlaying={isPlaying}
      />
    </div>
  )
}
