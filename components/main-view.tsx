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
const SPEED_MAX = 16
const MIN_PER_HIT_MS = 30
const MAX_PER_HIT_MS = 500
const SPEED_INTERVAL_MULTIPLIER = 2
const HIT_ATTACK_S = 0.01
const AUTO_RELEASE_MARGIN_S = 0.005
const FREEFORM_GRID_SIZE = 1001

type FreeformDot = {
  id: string
  x: number
  y: number
}

function speedToPerHitSeconds(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)))
  const perHitMs = MAX_PER_HIT_MS - t * (MAX_PER_HIT_MS - MIN_PER_HIT_MS)
  return (perHitMs * SPEED_INTERVAL_MULTIPLIER) / 1000
}

function getAutoReleaseSeconds(perHitSeconds: number): number {
  return Math.max(0.001, perHitSeconds - HIT_ATTACK_S - AUTO_RELEASE_MARGIN_S)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function freeformDotKey(dot: FreeformDot): string {
  const max = FREEFORM_GRID_SIZE - 1
  const x = Math.round(clamp01(dot.x) * max)
  const y = Math.round(clamp01(dot.y) * max)
  return `${x},${y}`
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
  speed: 1.5,
  volumePercent: 90,
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
  clickTrainEnabled: false,
  clickTrainVolumePercent: 180,
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

function FreeformDotOverlay({
  dots,
  playingDotKey,
  disabled,
  onAddDot,
  onMoveDot,
  onRemoveDot,
  onDragStateChange,
}: {
  dots: FreeformDot[]
  playingDotKey: string | null
  disabled: boolean
  onAddDot: (x: number, y: number) => string
  onMoveDot: (id: string, x: number, y: number) => void
  onRemoveDot: (id: string) => void
  onDragStateChange?: (isDragging: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingIdRef = useRef<string | null>(null)

  const resolvePoint = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0.5, y: 0.5 }
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01(1 - (e.clientY - rect.top) / rect.height),
    }
  }, [])

  const beginDrag = useCallback((id: string, e: React.PointerEvent<HTMLDivElement>) => {
    draggingIdRef.current = id
    e.currentTarget.setPointerCapture(e.pointerId)
    onDragStateChange?.(true)
  }, [onDragStateChange])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    const point = resolvePoint(e)
    const id = onAddDot(point.x, point.y)
    beginDrag(id, e)
  }, [beginDrag, disabled, onAddDot, resolvePoint])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingIdRef.current || disabled) return
    const point = resolvePoint(e)
    onMoveDot(draggingIdRef.current, point.x, point.y)
  }, [disabled, onMoveDot, resolvePoint])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current) {
      draggingIdRef.current = null
      onDragStateChange?.(false)
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [onDragStateChange])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-30"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onContextMenu={(e) => e.preventDefault()}
    >
      {dots.map((dot) => {
        const dotKey = freeformDotKey(dot)
        const active = playingDotKey === dotKey
        return (
          <div
            key={dot.id}
            className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-transform ${
              active
                ? "scale-125 border-cyan-100 bg-cyan-200 shadow-[0_0_22px_rgba(34,211,238,0.9)]"
                : "border-cyan-200/80 bg-cyan-300/70 shadow-[0_0_14px_rgba(34,211,238,0.45)]"
            }`}
            style={{ left: `${dot.x * 100}%`, top: `${(1 - dot.y) * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (disabled) return
              if (e.button === 2 || e.altKey) {
                onRemoveDot(dot.id)
                return
              }
              beginDrag(dot.id, e)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemoveDot(dot.id)
            }}
          />
        )
      })}
    </div>
  )
}

export function MainView({ quality, highlightTarget, isPlaying, onDragStateChange, activeBand }: { quality: QualityLevel; highlightTarget: HighlightTarget; isPlaying: boolean; onDragStateChange?: (isDragging: boolean) => void; activeBand?: ActiveBand | null }) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  const [constantDots, setConstantDots] = useState<Set<string>>(new Set())
  const [referenceDotKey, setReferenceDotKey] = useState<string | null>(null)
  const [gridRows, setGridRows] = useState<number>(DEFAULTS.gridRows)
  const [gridCols, setGridCols] = useState<number>(DEFAULTS.gridCols)
  const [freeformModeEnabled, setFreeformModeEnabled] = useState<boolean>(DEFAULTS.freeformModeEnabled)
  const [freeformDots, setFreeformDots] = useState<FreeformDot[]>([])
  const [speed, setSpeed] = useState<number>(DEFAULTS.speed)
  const [volumePercent, setVolumePercent] = useState<number>(DEFAULTS.volumePercent)
  const [release, setRelease] = useState<number>(DEFAULTS.release)
  const [releaseAuto, setReleaseAuto] = useState<boolean>(DEFAULTS.releaseAuto)
  const [releaseAutoOffsetMs, setReleaseAutoOffsetMs] = useState<number>(DEFAULTS.releaseAutoOffsetMs)
  const [bandwidth, setBandwidth] = useState<number>(DEFAULTS.bandwidth)
  const [bandwidthOscillationEnabled, setBandwidthOscillationEnabled] = useState<boolean>(DEFAULTS.bandwidthOscillationEnabled)
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(DEFAULTS.settingsCollapsed)
  const [depth, setDepth] = useState<number>(DEFAULTS.depth)
  const [hiHatModeEnabled, setHiHatModeEnabled] = useState<boolean>(DEFAULTS.hiHatModeEnabled)
  const [patternModeEnabled, setPatternModeEnabled] = useState<boolean>(DEFAULTS.patternModeEnabled)
  const [patternVolumeDiffDb, setPatternVolumeDiffDb] = useState<number>(DEFAULTS.patternVolumeDiffDb)
  const [reverbModeEnabled, setReverbModeEnabled] = useState<boolean>(DEFAULTS.reverbModeEnabled)
  const [reverbVolumeSpreadDb, setReverbVolumeSpreadDb] = useState<number>(DEFAULTS.reverbVolumeSpreadDb)
  const [hiHatQuietDropDb, setHiHatQuietDropDb] = useState<number>(DEFAULTS.hiHatQuietDropDb)
  const [hiHatLoudReleaseBoostMs, setHiHatLoudReleaseBoostMs] = useState<number>(DEFAULTS.hiHatLoudReleaseBoostMs)
  const [repeatCount, setRepeatCount] = useState<number>(DEFAULTS.repeatCount)
  const [depthGapDb, setDepthGapDb] = useState<number>(DEFAULTS.depthGapDb)
  const [eqABEnabled, setEqABEnabled] = useState<boolean>(DEFAULTS.eqABEnabled)
  const [flatSlope, setFlatSlope] = useState<boolean>(DEFAULTS.flatSlope)
  const [additivePartialsEnabled, setAdditivePartialsEnabled] = useState<boolean>(DEFAULTS.additivePartialsEnabled)
  const [clickTrainEnabled, setClickTrainEnabled] = useState<boolean>(DEFAULTS.clickTrainEnabled)
  const [clickTrainVolumePercent, setClickTrainVolumePercent] = useState<number>(DEFAULTS.clickTrainVolumePercent)
  const [referenceVolumeBalance, setReferenceVolumeBalance] = useState<number>(DEFAULTS.referenceVolumeBalance)
  const [referenceVolumeOffsetDb, setReferenceVolumeOffsetDb] = useState<number>(DEFAULTS.referenceVolumeOffsetDb)
  const [referenceVolumeOscillationEnabled, setReferenceVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.referenceVolumeOscillationEnabled)
  const [allVolumeOscillationEnabled, setAllVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.allVolumeOscillationEnabled)
  const [referenceVolumeMultiplyCount, setReferenceVolumeMultiplyCount] = useState<number>(DEFAULTS.referenceVolumeMultiplyCount)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    setGridRows(loadSetting("cabin:gridRows", DEFAULTS.gridRows))
    setGridCols(loadSetting("cabin:gridCols", DEFAULTS.gridCols))
    setFreeformModeEnabled(loadSetting("cabin:freeformModeEnabled", DEFAULTS.freeformModeEnabled))
    setFreeformDots(loadSetting("cabin:freeformDots", [] as FreeformDot[]))
    setSpeed(loadSetting("cabin:speed", DEFAULTS.speed))
    setVolumePercent(loadSetting("cabin:volumePercent", DEFAULTS.volumePercent))
    setRelease(loadSetting("cabin:release", DEFAULTS.release))
    setReleaseAuto(loadSetting("cabin:releaseAuto", DEFAULTS.releaseAuto))
    setReleaseAutoOffsetMs(loadSetting("cabin:releaseAutoOffsetMs", DEFAULTS.releaseAutoOffsetMs))
    setBandwidth(loadSetting("cabin:bandwidth", DEFAULTS.bandwidth))
    setBandwidthOscillationEnabled(loadSetting("cabin:bandwidthOscillationEnabled", DEFAULTS.bandwidthOscillationEnabled))
    setSettingsCollapsed(loadSetting("cabin:settingsCollapsed", DEFAULTS.settingsCollapsed))
    setDepth(loadSetting("cabin:depth", DEFAULTS.depth))
    setHiHatModeEnabled(loadSetting("cabin:hiHatModeEnabled", DEFAULTS.hiHatModeEnabled))
    setPatternModeEnabled(loadSetting("cabin:patternModeEnabled", DEFAULTS.patternModeEnabled))
    setPatternVolumeDiffDb(loadSetting("cabin:patternVolumeDiffDb", DEFAULTS.patternVolumeDiffDb))
    setReverbModeEnabled(loadSetting("cabin:reverbModeEnabled", DEFAULTS.reverbModeEnabled))
    setReverbVolumeSpreadDb(loadSetting("cabin:reverbVolumeSpreadDb", DEFAULTS.reverbVolumeSpreadDb))
    setHiHatQuietDropDb(loadSetting("cabin:hiHatQuietDropDb", DEFAULTS.hiHatQuietDropDb))
    const releaseBoostDefaultMigrated = loadSetting("cabin:hiHatLoudReleaseBoostMsDefaultV2", false)
    const savedReleaseBoost = loadSetting<number | null>("cabin:hiHatLoudReleaseBoostMs", null)
    setHiHatLoudReleaseBoostMs(
      !releaseBoostDefaultMigrated && (savedReleaseBoost === null || savedReleaseBoost === 0)
        ? DEFAULTS.hiHatLoudReleaseBoostMs
        : savedReleaseBoost ?? DEFAULTS.hiHatLoudReleaseBoostMs
    )
    saveSetting("cabin:hiHatLoudReleaseBoostMsDefaultV2", true)
    setRepeatCount(loadSetting("cabin:repeatCount", DEFAULTS.repeatCount))
    setDepthGapDb(loadSetting("cabin:depthGapDb", DEFAULTS.depthGapDb))
    setEqABEnabled(loadSetting("cabin:eqABEnabled", DEFAULTS.eqABEnabled))
    setFlatSlope(loadSetting("cabin:flatSlope", DEFAULTS.flatSlope))
    setAdditivePartialsEnabled(loadSetting("cabin:additivePartialsEnabled", DEFAULTS.additivePartialsEnabled))
    setClickTrainEnabled(loadSetting("cabin:clickTrainEnabled", DEFAULTS.clickTrainEnabled))
    setClickTrainVolumePercent(loadSetting("cabin:clickTrainVolumePercent", DEFAULTS.clickTrainVolumePercent))
    setReferenceVolumeBalance(loadSetting("cabin:referenceVolumeBalance", DEFAULTS.referenceVolumeBalance))
    setReferenceVolumeOffsetDb(loadSetting("cabin:referenceVolumeOffsetDb", DEFAULTS.referenceVolumeOffsetDb))
    setReferenceVolumeOscillationEnabled(loadSetting("cabin:referenceVolumeOscillationEnabled", DEFAULTS.referenceVolumeOscillationEnabled))
    setAllVolumeOscillationEnabled(loadSetting("cabin:allVolumeOscillationEnabled", DEFAULTS.allVolumeOscillationEnabled))
    const savedReferenceMultiplyCount = loadSetting<number | null>("cabin:referenceVolumeMultiplyCount", null)
    const legacyReferenceMultiplyEnabled = loadSetting("cabin:referenceVolumeMultiplyEnabled", false)
    setReferenceVolumeMultiplyCount(savedReferenceMultiplyCount ?? (legacyReferenceMultiplyEnabled ? 2 : DEFAULTS.referenceVolumeMultiplyCount))
  }, [])
  const [hoveredDot, setHoveredDot] = useState<string | null>(null)
  const [sequencerVisual, setSequencerVisual] = useState<{ playingDotKey: string | null; beatIndex: number }>({
    playingDotKey: null,
    beatIndex: 0,
  })
  const { setEQEnabled } = useEQProfileStore()

  const hasSelectedDots = selectedDots.size > 0
  const freeformSelectedDots = useMemo(
    () => new Set(freeformDots.map(freeformDotKey)),
    [freeformDots]
  )
  const activeSelectedDots = freeformModeEnabled ? freeformSelectedDots : selectedDots
  const activeGridRows = freeformModeEnabled ? FREEFORM_GRID_SIZE : gridRows
  const activeGridCols = freeformModeEnabled ? FREEFORM_GRID_SIZE : gridCols
  const activeReferenceDotKey = freeformModeEnabled ? null : referenceDotKey
  const hasActiveDots = activeSelectedDots.size > 0

  // Pulsing invite dot — center of grid, shown until user taps a dot this session
  const hasEverSelected = useRef(false)
  if (hasActiveDots) hasEverSelected.current = true
  const inviteDotKey = !freeformModeEnabled && !hasEverSelected.current
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
  useEffect(() => { saveSetting("cabin:freeformModeEnabled", freeformModeEnabled) }, [freeformModeEnabled])
  useEffect(() => { saveSetting("cabin:freeformDots", freeformDots) }, [freeformDots])
  useEffect(() => { saveSetting("cabin:speed", speed) }, [speed])
  useEffect(() => { saveSetting("cabin:volumePercent", volumePercent) }, [volumePercent])
  useEffect(() => { saveSetting("cabin:settingsCollapsed", settingsCollapsed) }, [settingsCollapsed])
  useEffect(() => { saveSetting("cabin:release", release) }, [release])
  useEffect(() => { saveSetting("cabin:releaseAuto", releaseAuto) }, [releaseAuto])
  useEffect(() => { saveSetting("cabin:releaseAutoOffsetMs", releaseAutoOffsetMs) }, [releaseAutoOffsetMs])
  useEffect(() => { saveSetting("cabin:bandwidth", bandwidth) }, [bandwidth])
  useEffect(() => { saveSetting("cabin:bandwidthOscillationEnabled", bandwidthOscillationEnabled) }, [bandwidthOscillationEnabled])
  useEffect(() => { saveSetting("cabin:depth", depth) }, [depth])
  useEffect(() => { saveSetting("cabin:hiHatModeEnabled", hiHatModeEnabled) }, [hiHatModeEnabled])
  useEffect(() => { saveSetting("cabin:patternModeEnabled", patternModeEnabled) }, [patternModeEnabled])
  useEffect(() => { saveSetting("cabin:patternVolumeDiffDb", patternVolumeDiffDb) }, [patternVolumeDiffDb])
  useEffect(() => { saveSetting("cabin:reverbModeEnabled", reverbModeEnabled) }, [reverbModeEnabled])
  useEffect(() => { saveSetting("cabin:reverbVolumeSpreadDb", reverbVolumeSpreadDb) }, [reverbVolumeSpreadDb])
  useEffect(() => { saveSetting("cabin:hiHatQuietDropDb", hiHatQuietDropDb) }, [hiHatQuietDropDb])
  useEffect(() => { saveSetting("cabin:hiHatLoudReleaseBoostMs", hiHatLoudReleaseBoostMs) }, [hiHatLoudReleaseBoostMs])
  useEffect(() => { saveSetting("cabin:repeatCount", repeatCount) }, [repeatCount])
  useEffect(() => { saveSetting("cabin:depthGapDb", depthGapDb) }, [depthGapDb])
  useEffect(() => { saveSetting("cabin:eqABEnabled", eqABEnabled) }, [eqABEnabled])
  useEffect(() => { saveSetting("cabin:flatSlope", flatSlope) }, [flatSlope])
  useEffect(() => { saveSetting("cabin:additivePartialsEnabled", additivePartialsEnabled) }, [additivePartialsEnabled])
  useEffect(() => { saveSetting("cabin:clickTrainEnabled", clickTrainEnabled) }, [clickTrainEnabled])
  useEffect(() => { saveSetting("cabin:clickTrainVolumePercent", clickTrainVolumePercent) }, [clickTrainVolumePercent])
  useEffect(() => { saveSetting("cabin:referenceVolumeBalance", referenceVolumeBalance) }, [referenceVolumeBalance])
  useEffect(() => { saveSetting("cabin:referenceVolumeOffsetDb", referenceVolumeOffsetDb) }, [referenceVolumeOffsetDb])
  useEffect(() => { saveSetting("cabin:referenceVolumeOscillationEnabled", referenceVolumeOscillationEnabled) }, [referenceVolumeOscillationEnabled])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationEnabled", allVolumeOscillationEnabled) }, [allVolumeOscillationEnabled])
  useEffect(() => { saveSetting("cabin:referenceVolumeMultiplyCount", referenceVolumeMultiplyCount) }, [referenceVolumeMultiplyCount])

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
    setReferenceDotKey((prev) => {
      if (!prev) return prev
      const [x, y] = prev.split(",").map(Number)
      return x < gridCols && y < gridRows ? prev : null
    })
    setConstantDots((prev) => {
      const next = new Set<string>()
      prev.forEach((dotKey) => {
        const [x, y] = dotKey.split(",").map(Number)
        if (x < gridCols && y < gridRows) {
          next.add(dotKey)
        } else {
          dotGridAudio.getDotGridAudioPlayer().setConstantDotPlaying(dotKey, false, gridRows, gridCols)
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
    dotGridAudio.getDotGridAudioPlayer().setAllVolumeOscillationEnabled(allVolumeOscillationEnabled)
  }, [allVolumeOscillationEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeMultiplyCount(referenceVolumeMultiplyCount)
  }, [referenceVolumeMultiplyCount])

  // Speed controls per-hit interval. Higher speed = shorter gap between hits.
  // Map speed (0.5–16) to per-hit delay (500ms–30ms).
  // Each dot plays `depth` hits (volume steps) before moving to the next.
  const dotCount = activeSelectedDots.size
  const perHitS = useMemo(() => speedToPerHitSeconds(speed), [speed])
  const effectiveRelease = useMemo(
    () => releaseAuto ? Math.max(0.001, getAutoReleaseSeconds(perHitS) + releaseAutoOffsetMs / 1000) : release,
    [perHitS, release, releaseAuto, releaseAutoOffsetMs]
  )

  const handleHiHatModeChange = useCallback((enabled: boolean) => {
    setHiHatModeEnabled(enabled)
    if (enabled) {
      setPatternModeEnabled(false)
      setReverbModeEnabled(false)
    }
  }, [])

  const handlePatternModeChange = useCallback((enabled: boolean) => {
    setPatternModeEnabled(enabled)
    if (enabled) {
      setHiHatModeEnabled(false)
      setReverbModeEnabled(false)
    }
  }, [])

  const handleReverbModeChange = useCallback((enabled: boolean) => {
    setReverbModeEnabled(enabled)
    if (enabled) {
      setHiHatModeEnabled(false)
      setPatternModeEnabled(false)
    }
  }, [])

  const handleAdditivePartialsChange = useCallback((enabled: boolean) => {
    setAdditivePartialsEnabled(enabled)
    if (enabled) {
      setClickTrainEnabled(false)
    }
  }, [])

  const handleClickTrainChange = useCallback((enabled: boolean) => {
    setClickTrainEnabled(enabled)
    if (enabled) {
      setAdditivePartialsEnabled(false)
    }
  }, [])

  useEffect(() => {
    const count = Math.max(1, dotCount)
    const hitsPerDot = patternModeEnabled ? 8 : reverbModeEnabled ? 16 : hiHatModeEnabled ? 8 : Math.max(1, depth)
    const repeatsPerHit = Math.max(1, repeatCount)
    const totalHits = count * hitsPerDot * repeatsPerHit

    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setHitModeStagger(perHitS)
    // Wave rate = one full cycle covers all dots × all volume steps
    player.setHitModeRate(1 / (perHitS * totalHits))
  }, [perHitS, dotCount, depth, hiHatModeEnabled, patternModeEnabled, reverbModeEnabled, repeatCount])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setNumberOfHits(repeatCount)
  }, [repeatCount])

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
    dotGridAudio.getDotGridAudioPlayer().setSoundMode(
      clickTrainEnabled
        ? dotGridAudio.SoundMode.ClickTrain
        : additivePartialsEnabled
          ? dotGridAudio.SoundMode.AdditivePartials
          : dotGridAudio.SoundMode.BandpassedNoise
    )
  }, [additivePartialsEnabled, clickTrainEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setClickTrainGainPercent(clickTrainVolumePercent)
  }, [clickTrainVolumePercent])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    const effectiveDepth = hiHatModeEnabled || reverbModeEnabled ? 3 : depth
    player.setVolumeSteps(effectiveDepth)
    player.setHitDecay((effectiveDepth - 1) * depthGapDb)
    player.setHiHatModeEnabled(hiHatModeEnabled)
    player.setPatternModeEnabled(patternModeEnabled)
    player.setPatternVolumeDiffDb(patternVolumeDiffDb)
    player.setReverbModeEnabled(reverbModeEnabled)
    player.setReverbVolumeSpreadDb(reverbVolumeSpreadDb)
    player.setHiHatQuietDropDb(hiHatQuietDropDb)
    player.setHiHatLoudReleaseBoostMs(hiHatLoudReleaseBoostMs)
  }, [depth, depthGapDb, hiHatModeEnabled, patternModeEnabled, patternVolumeDiffDb, reverbModeEnabled, reverbVolumeSpreadDb, hiHatQuietDropDb, hiHatLoudReleaseBoostMs])

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
      if (freeformModeEnabled) return
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
  }, [freeformModeEnabled, gridRows, gridCols])

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
    setReferenceDotKey((prev) => (prev === key ? null : prev))
    setSelectedDots((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const handleDotReference = useCallback((x: number, y: number) => {
    void resumeAudioContext()
    const key = `${x},${y}`
    setReferenceDotKey(key)
    setSelectedDots((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const handleDotConstantToggle = useCallback((x: number, y: number) => {
    void resumeAudioContext()
    const key = `${x},${y}`
    setConstantDots((prev) => {
      const next = new Set(prev)
      const shouldPlay = !next.has(key)
      if (shouldPlay) {
        next.add(key)
      } else {
        next.delete(key)
      }
      dotGridAudio.getDotGridAudioPlayer().setConstantDotPlaying(key, shouldPlay, gridRows, gridCols)
      return next
    })
  }, [gridRows, gridCols])

  const handleSetGridSize = useCallback((rows: number, cols: number) => {
    setGridRows(rows)
    setGridCols(cols)
  }, [])

  const handleAddFreeformDot = useCallback((x: number, y: number) => {
    void resumeAudioContext()
    const id = globalThis.crypto?.randomUUID?.() ?? `freeform-${Date.now()}-${Math.random()}`
    setFreeformDots((prev) => [...prev, { id, x, y }])
    return id
  }, [])

  const handleMoveFreeformDot = useCallback((id: string, x: number, y: number) => {
    setFreeformDots((prev) => prev.map((dot) => (
      dot.id === id ? { ...dot, x: clamp01(x), y: clamp01(y) } : dot
    )))
  }, [])

  const handleRemoveFreeformDot = useCallback((id: string) => {
    setFreeformDots((prev) => prev.filter((dot) => dot.id !== id))
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
        selectedDots={freeformModeEnabled ? new Set() : selectedDots}
        constantDots={freeformModeEnabled ? new Set() : constantDots}
        referenceDotKey={freeformModeEnabled ? null : referenceDotKey}
        onDotSelect={handleDotSelect}
        onDotDeselect={handleDotDeselect}
        onDotReference={handleDotReference}
        onDotConstantToggle={handleDotConstantToggle}
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
        inputDisabled={freeformModeEnabled}
        inviteDotKey={inviteDotKey}
        eqHighlights={eqHighlights}
      />
      {freeformModeEnabled && (
        <FreeformDotOverlay
          dots={freeformDots}
          playingDotKey={playingDotKey}
          disabled={isPlaying}
          onAddDot={handleAddFreeformDot}
          onMoveDot={handleMoveFreeformDot}
          onRemoveDot={handleRemoveFreeformDot}
          onDragStateChange={onDragStateChange}
        />
      )}
      <SettingsPanel
        collapsed={settingsCollapsed}
        onToggle={() => setSettingsCollapsed((v) => !v)}
        gridRows={gridRows}
        gridCols={gridCols}
        freeformModeEnabled={freeformModeEnabled}
        onFreeformModeChange={setFreeformModeEnabled}
        onClearFreeformDots={() => setFreeformDots([])}
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
        effectiveRelease={effectiveRelease}
        releaseAuto={releaseAuto}
        releaseAutoOffsetMs={releaseAutoOffsetMs}
        onReleaseChange={setRelease}
        onReleaseAutoChange={setReleaseAuto}
        onReleaseAutoOffsetMsChange={setReleaseAutoOffsetMs}
        bandwidth={bandwidth}
        onBandwidthChange={setBandwidth}
        bandwidthOscillationEnabled={bandwidthOscillationEnabled}
        onBandwidthOscillationChange={setBandwidthOscillationEnabled}
        depth={depth}
        onDepthChange={setDepth}
        hiHatModeEnabled={hiHatModeEnabled}
        onHiHatModeChange={handleHiHatModeChange}
        patternModeEnabled={patternModeEnabled}
        onPatternModeChange={handlePatternModeChange}
        patternVolumeDiffDb={patternVolumeDiffDb}
        onPatternVolumeDiffDbChange={setPatternVolumeDiffDb}
        reverbModeEnabled={reverbModeEnabled}
        onReverbModeChange={handleReverbModeChange}
        reverbVolumeSpreadDb={reverbVolumeSpreadDb}
        onReverbVolumeSpreadDbChange={setReverbVolumeSpreadDb}
        hiHatQuietDropDb={hiHatQuietDropDb}
        onHiHatQuietDropDbChange={setHiHatQuietDropDb}
        hiHatLoudReleaseBoostMs={hiHatLoudReleaseBoostMs}
        onHiHatLoudReleaseBoostMsChange={setHiHatLoudReleaseBoostMs}
        repeatCount={repeatCount}
        onRepeatCountChange={setRepeatCount}
        depthGapDb={depthGapDb}
        onDepthGapDbChange={setDepthGapDb}
        eqABEnabled={eqABEnabled}
        onEqABChange={setEqABEnabled}
        flatSlope={flatSlope}
        onFlatSlopeChange={setFlatSlope}
        additivePartialsEnabled={additivePartialsEnabled}
        onAdditivePartialsChange={handleAdditivePartialsChange}
        clickTrainEnabled={clickTrainEnabled}
        onClickTrainChange={handleClickTrainChange}
        clickTrainVolumePercent={clickTrainVolumePercent}
        onClickTrainVolumeChange={setClickTrainVolumePercent}
        referenceVolumeBalance={referenceVolumeBalance}
        onReferenceVolumeBalanceChange={setReferenceVolumeBalance}
        referenceVolumeOffsetDb={referenceVolumeOffsetDb}
        onReferenceVolumeOffsetDbChange={setReferenceVolumeOffsetDb}
        referenceVolumeOscillationEnabled={referenceVolumeOscillationEnabled}
        onReferenceVolumeOscillationChange={setReferenceVolumeOscillationEnabled}
        allVolumeOscillationEnabled={allVolumeOscillationEnabled}
        onAllVolumeOscillationChange={setAllVolumeOscillationEnabled}
        referenceVolumeMultiplyCount={referenceVolumeMultiplyCount}
        onReferenceVolumeMultiplyCountChange={setReferenceVolumeMultiplyCount}
        isPlaying={isPlaying}
      />
    </div>
  )
}
