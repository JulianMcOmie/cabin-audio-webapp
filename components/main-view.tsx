"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
const MAX_COLS = 16
const SPEED_MIN = 0.5
const SPEED_MAX = 32
const MIN_PER_HIT_MS = 30
const MAX_PER_HIT_MS = 500
const SPEED_INTERVAL_MULTIPLIER = 2
const HIT_ATTACK_S = 0.01
const AUTO_RELEASE_MARGIN_S = 0.005
const FIXED_ACCENT_RELEASE_MS = 200

function speedToPerHitSeconds(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)))
  const perHitMs = MAX_PER_HIT_MS - t * (MAX_PER_HIT_MS - MIN_PER_HIT_MS)
  return (perHitMs * SPEED_INTERVAL_MULTIPLIER) / 1000
}

function getAutoReleaseSeconds(perHitSeconds: number): number {
  return Math.max(0.001, perHitSeconds - HIT_ATTACK_S - AUTO_RELEASE_MARGIN_S)
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

function saveSetting<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota errors etc */ }
}

// Default values used for SSR — must match the fallbacks below
const DEFAULTS = {
  gridRows: 3,
  gridCols: 5,
  freeformModeEnabled: false,
  speed: SPEED_MAX,
  volumePercent: 100,
  release: 2,
  releaseAuto: true,
  releaseAutoOffsetMs: 0,
  bandwidth: 6,
  bandwidthOscillationEnabled: false,
  settingsCollapsed: true,
  depth: 1,
  hiHatModeEnabled: false,
  patternModeEnabled: false,
  patternVolumeDiffDb: 0,
  reverbModeEnabled: false,
  reverbVolumeSpreadDb: 12,
  hiHatQuietDropDb: 20,
  hiHatLoudReleaseBoostMs: 200,
  repeatCount: 1,
  depthGapDb: 10,
  eqABEnabled: false,
  flatSlope: false,
  additivePartialsEnabled: false,
  clickTrainEnabled: true,
  clickTrainVolumePercent: 500,
  referenceVolumeBalance: 100,
  referenceVolumeOffsetDb: 0,
  referenceVolumeOscillationEnabled: false,
  allVolumeOscillationEnabled: false,
  referenceVolumeMultiplyCount: 1,
} as const

export interface ActiveBand {
  frequency: number
  gain: number
  q: number
}

export function MainView({ quality, highlightTarget, isPlaying, onDragStateChange, activeBand }: { quality: QualityLevel; highlightTarget: HighlightTarget; isPlaying: boolean; onDragStateChange?: (isDragging: boolean) => void; activeBand?: ActiveBand | null }) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  const [gridRows, setGridRows] = useState<number>(DEFAULTS.gridRows)
  const [gridCols, setGridCols] = useState<number>(DEFAULTS.gridCols)
  const [speed, setSpeed] = useState<number>(DEFAULTS.speed)
  const [volumePercent, setVolumePercent] = useState<number>(DEFAULTS.volumePercent)
  const [bandwidth, setBandwidth] = useState<number>(DEFAULTS.bandwidth)
  const [bandwidthOscillationEnabled, setBandwidthOscillationEnabled] = useState<boolean>(DEFAULTS.bandwidthOscillationEnabled)
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(DEFAULTS.settingsCollapsed)
  const [depth, setDepth] = useState<number>(DEFAULTS.depth)
  const [patternModeEnabled, setPatternModeEnabled] = useState<boolean>(DEFAULTS.patternModeEnabled)
  const [patternVolumeDiffDb, setPatternVolumeDiffDb] = useState<number>(DEFAULTS.patternVolumeDiffDb)
  const [hiHatQuietDropDb, setHiHatQuietDropDb] = useState<number>(DEFAULTS.hiHatQuietDropDb)
  const [eqABEnabled, setEqABEnabled] = useState<boolean>(DEFAULTS.eqABEnabled)
  const [flatSlope, setFlatSlope] = useState<boolean>(DEFAULTS.flatSlope)
  const [clickTrainVolumePercent, setClickTrainVolumePercent] = useState<number>(DEFAULTS.clickTrainVolumePercent)
  const [referenceVolumeBalance, setReferenceVolumeBalance] = useState<number>(DEFAULTS.referenceVolumeBalance)
  const [referenceVolumeOffsetDb, setReferenceVolumeOffsetDb] = useState<number>(DEFAULTS.referenceVolumeOffsetDb)
  const [referenceVolumeOscillationEnabled, setReferenceVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.referenceVolumeOscillationEnabled)
  const [referenceVolumeMultiplyCount, setReferenceVolumeMultiplyCount] = useState<number>(DEFAULTS.referenceVolumeMultiplyCount)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const focusedDefaultsMigrated = loadSetting("cabin:focusedClickDefaultsV1", false)
    setGridRows(focusedDefaultsMigrated ? loadSetting("cabin:gridRows", DEFAULTS.gridRows) : DEFAULTS.gridRows)
    setGridCols(focusedDefaultsMigrated ? loadSetting("cabin:gridCols", DEFAULTS.gridCols) : DEFAULTS.gridCols)
    setSpeed(focusedDefaultsMigrated ? loadSetting("cabin:speed", DEFAULTS.speed) : DEFAULTS.speed)
    setVolumePercent(focusedDefaultsMigrated ? loadSetting("cabin:volumePercent", DEFAULTS.volumePercent) : DEFAULTS.volumePercent)
    saveSetting("cabin:release", DEFAULTS.release)
    setBandwidth(loadSetting("cabin:bandwidth", DEFAULTS.bandwidth))
    setBandwidthOscillationEnabled(loadSetting("cabin:bandwidthOscillationEnabled", DEFAULTS.bandwidthOscillationEnabled))
    setSettingsCollapsed(loadSetting("cabin:settingsCollapsed", DEFAULTS.settingsCollapsed))
    setDepth(loadSetting("cabin:depth", DEFAULTS.depth))
    setPatternModeEnabled(loadSetting("cabin:patternModeEnabled", DEFAULTS.patternModeEnabled))
    setPatternVolumeDiffDb(loadSetting("cabin:patternVolumeDiffDb", DEFAULTS.patternVolumeDiffDb))
    setHiHatQuietDropDb(loadSetting("cabin:hiHatQuietDropDb", DEFAULTS.hiHatQuietDropDb))
    setEqABEnabled(loadSetting("cabin:eqABEnabled", DEFAULTS.eqABEnabled))
    setFlatSlope(false)
    const clickVolumeDefaultMigrated = loadSetting("cabin:clickTrainVolumeDefaultV2", false)
    const savedClickVolume = loadSetting<number | null>("cabin:clickTrainVolumePercent", null)
    setClickTrainVolumePercent(
      (!focusedDefaultsMigrated || !clickVolumeDefaultMigrated) && (savedClickVolume === null || savedClickVolume < DEFAULTS.clickTrainVolumePercent)
        ? DEFAULTS.clickTrainVolumePercent
        : savedClickVolume ?? DEFAULTS.clickTrainVolumePercent
    )
    saveSetting("cabin:clickTrainVolumeDefaultV2", true)
    setReferenceVolumeBalance(DEFAULTS.referenceVolumeBalance)
    setReferenceVolumeOffsetDb(DEFAULTS.referenceVolumeOffsetDb)
    setReferenceVolumeOscillationEnabled(false)
    setReferenceVolumeMultiplyCount(DEFAULTS.referenceVolumeMultiplyCount)
    saveSetting("cabin:focusedClickDefaultsV1", true)
  }, [])
  const [hoveredDot, setHoveredDot] = useState<string | null>(null)
  const [sequencerVisual, setSequencerVisual] = useState<{ playingDotKey: string | null; beatIndex: number }>({
    playingDotKey: null,
    beatIndex: 0,
  })
  const { setEQEnabled } = useEQProfileStore()

  const hasSelectedDots = selectedDots.size > 0
  const activeSelectedDots = selectedDots
  const activeGridRows = gridRows
  const activeGridCols = gridCols
  const activeReferenceDotKey = null
  const hasActiveDots = activeSelectedDots.size > 0

  // Pulsing invite dot — center of grid, shown until user taps a dot this session
  const hasEverSelected = useRef(false)
  if (hasActiveDots) hasEverSelected.current = true
  const inviteDotKey = !hasEverSelected.current
    ? `${Math.floor(gridCols / 2)},${Math.floor(gridRows / 2)}`
    : null

  // Compute EQ highlight intensities per dot row
  const eqHighlights = useMemo(() => {
    if (!activeBand || activeBand.gain === 0) return null
    const highlights = new Map<string, number>()
    const band = activeBand
    for (let row = 0; row < gridRows; row++) {
      const normalizedY = gridRows <= 1 ? 0.5 : row / (gridRows - 1)
      // Match dotGridAudio frequency mapping (default: no extension, bandwidth from state)
      const MIN_AUDIBLE = 20
      const MAX_AUDIBLE = 20000
      const topUpperEdge = MAX_AUDIBLE
      const topLowerEdge = topUpperEdge / Math.pow(2, bandwidth)
      const bottomLowerEdge = MIN_AUDIBLE
      const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, normalizedY)
      const upperEdge = lowerEdge * Math.pow(2, bandwidth)
      const centerFreq = Math.sqrt(lowerEdge * upperEdge)

      // Gaussian-like falloff in log-frequency space
      const octaveDistance = Math.abs(Math.log2(centerFreq / band.frequency))
      const halfBandwidth = 1 / band.q
      const intensity = Math.exp(-Math.pow(octaveDistance / halfBandwidth, 2)) * Math.min(1, Math.abs(band.gain) / 12)

      if (intensity > 0.01) {
        for (let col = 0; col < gridCols; col++) {
          highlights.set(`${col},${row}`, intensity)
        }
      }
    }
    return highlights.size > 0 ? highlights : null
  }, [activeBand, gridRows, gridCols, bandwidth])

  // Persist settings to localStorage
  useEffect(() => { saveSetting("cabin:gridRows", gridRows) }, [gridRows])
  useEffect(() => { saveSetting("cabin:gridCols", gridCols) }, [gridCols])
  useEffect(() => { saveSetting("cabin:freeformModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:freeformDots", []) }, [])
  useEffect(() => { saveSetting("cabin:speed", speed) }, [speed])
  useEffect(() => { saveSetting("cabin:volumePercent", volumePercent) }, [volumePercent])
  useEffect(() => { saveSetting("cabin:settingsCollapsed", settingsCollapsed) }, [settingsCollapsed])
  useEffect(() => { saveSetting("cabin:release", DEFAULTS.release) }, [])
  useEffect(() => { saveSetting("cabin:releaseAuto", true) }, [])
  useEffect(() => { saveSetting("cabin:releaseAutoOffsetMs", 0) }, [])
  useEffect(() => { saveSetting("cabin:bandwidth", bandwidth) }, [bandwidth])
  useEffect(() => { saveSetting("cabin:bandwidthOscillationEnabled", bandwidthOscillationEnabled) }, [bandwidthOscillationEnabled])
  useEffect(() => { saveSetting("cabin:depth", depth) }, [depth])
  useEffect(() => { saveSetting("cabin:hiHatModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:patternModeEnabled", patternModeEnabled) }, [patternModeEnabled])
  useEffect(() => { saveSetting("cabin:patternVolumeDiffDb", patternVolumeDiffDb) }, [patternVolumeDiffDb])
  useEffect(() => { saveSetting("cabin:reverbModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:reverbVolumeSpreadDb", DEFAULTS.reverbVolumeSpreadDb) }, [])
  useEffect(() => { saveSetting("cabin:hiHatQuietDropDb", hiHatQuietDropDb) }, [hiHatQuietDropDb])
  useEffect(() => { saveSetting("cabin:hiHatLoudReleaseBoostMs", FIXED_ACCENT_RELEASE_MS) }, [])
  useEffect(() => { saveSetting("cabin:repeatCount", 1) }, [])
  useEffect(() => { saveSetting("cabin:depthGapDb", DEFAULTS.depthGapDb) }, [])
  useEffect(() => { saveSetting("cabin:eqABEnabled", eqABEnabled) }, [eqABEnabled])
  useEffect(() => { saveSetting("cabin:flatSlope", false) }, [])
  useEffect(() => { saveSetting("cabin:additivePartialsEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:clickTrainEnabled", true) }, [])
  useEffect(() => { saveSetting("cabin:clickTrainVolumePercent", clickTrainVolumePercent) }, [clickTrainVolumePercent])
  useEffect(() => { saveSetting("cabin:referenceVolumeBalance", DEFAULTS.referenceVolumeBalance) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeOffsetDb", DEFAULTS.referenceVolumeOffsetDb) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeMultiplyCount", DEFAULTS.referenceVolumeMultiplyCount) }, [])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()

    player.setLoopSequencerEnabled(true)
    player.setLoopSequencerPlayTogether(false)
    player.setInterleavedHits(false)
    player.setVolumeLevelRangeDb(0)
    player.setSubHitPlaybackEnabled(false)
    player.setHitModeAttack(HIT_ATTACK_S)

    player.setPerCycleVolumeEnabled(false)
    player.setPerDotVolumeWaveEnabled(false)
    player.setAutoVolumeCycleEnabled(false)

    const analyser = player.createPreEQAnalyser()
    player.connectToAnalyser(analyser)

    setEQEnabled(true)

    return () => {
      player.setPlaying(false)
      player.clearConstantDots()
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

  // EQ A/B: toggle EQ on/off every `depth` hits (depth=1 → switch each hit)
  const eqABGroupRef = useRef(-1)
  useEffect(() => {
    if (!eqABEnabled) {
      // When disabled, restore EQ to on and reset tracking
      setEQEnabled(true)
      eqABGroupRef.current = -1
      return
    }

    const groupSize = Math.max(1, depth)
    const group = Math.floor(sequencerVisual.beatIndex / groupSize)
    if (group === eqABGroupRef.current) return
    eqABGroupRef.current = group

    // Even groups = EQ on, odd groups = EQ off
    setEQEnabled(group % 2 === 0)
  }, [eqABEnabled, sequencerVisual.beatIndex, depth, setEQEnabled])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.updateDots(activeSelectedDots, activeGridRows, activeGridCols)
    if (activeSelectedDots.size > 0 && !isSongPlaying) {
      void resumeAudioContext().then(() => {
        player.setPlaying(true)
      })
    } else {
      player.setPlaying(false)
    }
  }, [activeSelectedDots, activeGridRows, activeGridCols, isSongPlaying])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceDotKey(activeReferenceDotKey)
  }, [activeReferenceDotKey])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeBalance(referenceVolumeBalance / 100)
  }, [referenceVolumeBalance])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeOffsetDb(referenceVolumeOffsetDb)
  }, [referenceVolumeOffsetDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeOscillationEnabled(referenceVolumeOscillationEnabled)
  }, [referenceVolumeOscillationEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setAllVolumeOscillationEnabled(false)
  }, [])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeMultiplyCount(referenceVolumeMultiplyCount)
  }, [referenceVolumeMultiplyCount])

  // Speed controls per-hit interval. Higher speed = shorter gap between hits.
  // Map speed (0.5–16) to per-hit delay (500ms–30ms).
  // Each dot plays `depth` hits (volume steps) before moving to the next.
  const dotCount = activeSelectedDots.size
  const perHitS = useMemo(() => speedToPerHitSeconds(speed), [speed])
  const effectiveRelease = useMemo(
    () => Math.max(0.001, getAutoReleaseSeconds(perHitS)),
    [perHitS]
  )

  const handlePatternModeChange = useCallback((enabled: boolean) => {
    setPatternModeEnabled(enabled)
  }, [])

  useEffect(() => {
    const count = Math.max(1, dotCount)
    const totalHits = count * Math.max(1, depth)

    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setHitModeStagger(perHitS)
    // Wave rate = one full cycle covers all dots × all volume steps
    player.setHitModeRate(1 / (perHitS * totalHits))
  }, [perHitS, dotCount, depth])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setNumberOfHits(1)
  }, [])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setHitModeRelease(effectiveRelease)
  }, [effectiveRelease])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setBandwidthOscillationEnabled(bandwidthOscillationEnabled)
    if (!bandwidthOscillationEnabled) {
      player.setBandpassBandwidth(bandwidth)
    }
  }, [bandwidth, bandwidthOscillationEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setBandpassSlope(flatSlope ? -3.0 : -4.5)
  }, [flatSlope])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setSoundMode(dotGridAudio.SoundMode.ClickTrain)
  }, [])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setClickTrainGainPercent(clickTrainVolumePercent)
  }, [clickTrainVolumePercent])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setVolumeSteps(depth)
    player.setHitDecay(0)
    player.setHiHatModeEnabled(false)
    player.setPatternModeEnabled(patternModeEnabled)
    player.setPatternVolumeDiffDb(patternVolumeDiffDb)
    player.setReverbModeEnabled(false)
    player.setReverbVolumeSpreadDb(DEFAULTS.reverbVolumeSpreadDb)
    player.setHiHatQuietDropDb(hiHatQuietDropDb)
    player.setHiHatLoudReleaseBoostMs(FIXED_ACCENT_RELEASE_MS)
  }, [depth, patternModeEnabled, patternVolumeDiffDb, hiHatQuietDropDb])

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
        constantDots={new Set()}
        referenceDotKey={null}
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
        inputDisabled={false}
        inviteDotKey={inviteDotKey}
        eqHighlights={eqHighlights}
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
        effectiveRelease={effectiveRelease}
        bandwidth={bandwidth}
        onBandwidthChange={setBandwidth}
        bandwidthOscillationEnabled={bandwidthOscillationEnabled}
        onBandwidthOscillationChange={setBandwidthOscillationEnabled}
        patternModeEnabled={patternModeEnabled}
        onPatternModeChange={handlePatternModeChange}
        patternVolumeDiffDb={patternVolumeDiffDb}
        onPatternVolumeDiffDbChange={setPatternVolumeDiffDb}
        eqABEnabled={eqABEnabled}
        onEqABChange={setEqABEnabled}
        clickTrainVolumePercent={clickTrainVolumePercent}
        onClickTrainVolumeChange={setClickTrainVolumePercent}
        isPlaying={isPlaying}
      />
    </div>
  )
}
