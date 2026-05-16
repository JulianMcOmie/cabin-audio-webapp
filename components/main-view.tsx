"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { Pause, Play } from "lucide-react"
import { SettingsPanel } from "@/components/settings-panel"
import * as dotGridAudio from "@/lib/audio/dotGridAudio"
import { resumeAudioContext } from "@/lib/audio/audioContext"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { usePlayerStore } from "@/lib/stores"
import { cn } from "@/lib/utils"
import type { QualityLevel } from "@/components/unified-particle-scene"
import type { HighlightTarget } from "@/components/top-overlay"

const MIN_ROWS = 3
const MAX_ROWS = 16
const MIN_COLS = 3
const MAX_COLS = 24
const SPEED_MIN = 0.1
const SPEED_MAX = 32
const HIT_ATTACK_S = 0.01
const DEFAULT_RELEASE_OVERLAP_MS = 15
const RELEASE_OVERLAP_MIN_MS = 0
const RELEASE_OVERLAP_MAX_MS = 500
const FIXED_ACCENT_RELEASE_MS = 200
const DEPTH_MIN = 1
const DEPTH_MAX = 16
const DEPTH_AMOUNT_MIN_DB = 0
const DEPTH_AMOUNT_MAX_DB = 40
const DEFAULT_DEPTH_AMOUNT_DB = 10
const DEFAULT_SPEED_HZ = 0.1

function clampSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed))
}

function speedToPerHitSeconds(speed: number): number {
  return 1 / clampSpeed(speed)
}

function getAutoReleaseSeconds(perHitSeconds: number, overlapMs: number): number {
  return Math.max(0.001, perHitSeconds - HIT_ATTACK_S + overlapMs / 1000)
}

function clampDepth(depth: number): number {
  return Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, Math.round(depth)))
}

function clampDepthAmountDb(depthAmountDb: number): number {
  return Math.max(DEPTH_AMOUNT_MIN_DB, Math.min(DEPTH_AMOUNT_MAX_DB, depthAmountDb))
}

function clampReleaseOverlapMs(overlapMs: number): number {
  return Math.max(RELEASE_OVERLAP_MIN_MS, Math.min(RELEASE_OVERLAP_MAX_MS, overlapMs))
}

function clampPatternSize(size: PatternSize, width: number, height: number, centerX: number, centerY: number): PatternSize {
  const maxWidthFromCenter = Math.max(
    MIN_PATTERN_SIZE_PX,
    Math.min(width, centerX * 2, (width - centerX) * 2)
  )
  const maxHeightFromCenter = Math.max(
    MIN_PATTERN_SIZE_PX,
    Math.min(height, centerY * 2, (height - centerY) * 2)
  )
  return {
    width: Math.max(MIN_PATTERN_SIZE_PX, Math.min(size.width, maxWidthFromCenter)),
    height: Math.max(MIN_PATTERN_SIZE_PX, Math.min(size.height, maxHeightFromCenter)),
  }
}

function clampPatternCenter(centerX: number, centerY: number, size: PatternSize, width: number, height: number) {
  const halfWidth = size.width / 2
  const halfHeight = size.height / 2
  return {
    x: Math.max(halfWidth, Math.min(width - halfWidth, centerX)),
    y: Math.max(halfHeight, Math.min(height - halfHeight, centerY)),
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
  freeformPosition: { normalizedX: 0.5, normalizedY: 0.5 },
  speed: DEFAULT_SPEED_HZ,
  volumePercent: 100,
  release: 2,
  releaseAuto: true,
  releaseAutoOffsetMs: 0,
  releaseOverlapMs: DEFAULT_RELEASE_OVERLAP_MS,
  bandwidth: 6.0,
  bandwidthOscillationEnabled: false,
  settingsCollapsed: true,
  depth: 1,
  hiHatModeEnabled: false,
  patternModeEnabled: true,
  patternInterleavedEnabled: false,
  patternSwitchEnabled: false,
  patternVolumeDiffDb: 0,
  patternTwoDotVolumeDiffDb: 0,
  reverbModeEnabled: false,
  reverbVolumeSpreadDb: 12,
  hiHatQuietDropDb: 20,
  hiHatLoudReleaseBoostMs: 200,
  repeatCount: 1,
  depthGapDb: DEFAULT_DEPTH_AMOUNT_DB,
  eqABEnabled: false,
  flatSlope: false,
  additivePartialsEnabled: false,
  clickTrainEnabled: true,
  clickTrainVolumePercent: 2000,
  referenceVolumeBalance: 100,
  referenceVolumeOffsetDb: 0,
  referenceVolumeOscillationEnabled: false,
  referenceDotKey: null as string | null,
  allVolumeOscillationEnabled: false,
  referenceVolumeMultiplyCount: 1,
  masterVolumeOscillationEnabled: false,
  masterVolumeOscillationPeriodSeconds: 4,
  masterVolumeOscillationDepthDb: 40,
  volumeGradientEnabled: false,
  volumeGradientAxis: "x",
  volumeGradientTiltDb: 0,
  autoUpDownEnabled: false,
  autoUpDownRateHz: 2,
  patternPlaybackEnabled: false,
} as const

export interface ActiveBand {
  frequency: number
  gain: number
  q: number
}

type NormalizedPosition = { normalizedX: number; normalizedY: number }
type CursorPlayMode = "cursor" | "freeform"
type VolumeGradientAxis = "x" | "y"
type PatternDragMode = "move" | "resize"
type PatternDragState = {
  pointerId: number
  mode: PatternDragMode
  startClientX: number
  startClientY: number
  startCenterX: number
  startCenterY: number
  startSize: PatternSize
}
type PatternSize = { width: number; height: number }
type PatternDot = {
  key: string
  col: number
  row: number
  xPx: number
  yPx: number
  normalizedX: number
  normalizedY: number
}

const PATTERN_GRID_SIZE = 3
const PATTERN_DOT_KEYS = Array.from({ length: PATTERN_GRID_SIZE * PATTERN_GRID_SIZE }, (_, index) => {
  const col = index % PATTERN_GRID_SIZE
  const visualRow = Math.floor(index / PATTERN_GRID_SIZE)
  return `${col},${PATTERN_GRID_SIZE - 1 - visualRow}`
})
const DEFAULT_PATTERN_SIZE: PatternSize = { width: 420, height: 420 }
const MIN_PATTERN_SIZE_PX = 72
const PATTERN_DOT_SIZE_PX = 18

export function MainView({ highlightTarget, isPlaying, onDragStateChange }: { quality: QualityLevel; highlightTarget: HighlightTarget; isPlaying: boolean; onDragStateChange?: (isDragging: boolean) => void; activeBand?: ActiveBand | null }) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  const patternAreaRef = useRef<HTMLDivElement | null>(null)
  const patternDragRef = useRef<PatternDragState | null>(null)
  const [patternAreaSize, setPatternAreaSize] = useState({ width: 0, height: 0 })
  const [patternCenter, setPatternCenter] = useState({ x: 0.5, y: 0.5 })
  const [patternSize, setPatternSize] = useState<PatternSize>(DEFAULT_PATTERN_SIZE)
  const [isPatternDragging, setIsPatternDragging] = useState(false)
  const [patternPlaybackEnabled, setPatternPlaybackEnabled] = useState<boolean>(DEFAULTS.patternPlaybackEnabled)
  const [gridRows, setGridRows] = useState<number>(DEFAULTS.gridRows)
  const [gridCols, setGridCols] = useState<number>(DEFAULTS.gridCols)
  const [freeformModeEnabled, setFreeformModeEnabled] = useState<boolean>(DEFAULTS.freeformModeEnabled)
  const [freeformPosition, setFreeformPosition] = useState<NormalizedPosition>(DEFAULTS.freeformPosition)
  const [speed, setSpeed] = useState<number>(DEFAULTS.speed)
  const [volumePercent, setVolumePercent] = useState<number>(DEFAULTS.volumePercent)
  const [releaseOverlapMs, setReleaseOverlapMs] = useState<number>(DEFAULTS.releaseOverlapMs)
  const [bandwidth, setBandwidth] = useState<number>(DEFAULTS.bandwidth)
  const [bandwidthOscillationEnabled, setBandwidthOscillationEnabled] = useState<boolean>(DEFAULTS.bandwidthOscillationEnabled)
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(DEFAULTS.settingsCollapsed)
  const [depth, setDepth] = useState<number>(DEFAULTS.depth)
  const [depthGapDb, setDepthGapDb] = useState<number>(DEFAULTS.depthGapDb)
  const [patternModeEnabled, setPatternModeEnabled] = useState<boolean>(DEFAULTS.patternModeEnabled)
  const [patternInterleavedEnabled, setPatternInterleavedEnabled] = useState<boolean>(DEFAULTS.patternInterleavedEnabled)
  const [patternSwitchEnabled, setPatternSwitchEnabled] = useState<boolean>(DEFAULTS.patternSwitchEnabled)
  const [patternVolumeDiffDb, setPatternVolumeDiffDb] = useState<number>(DEFAULTS.patternVolumeDiffDb)
  const [patternTwoDotVolumeDiffDb, setPatternTwoDotVolumeDiffDb] = useState<number>(DEFAULTS.patternTwoDotVolumeDiffDb)
  const [hiHatQuietDropDb, setHiHatQuietDropDb] = useState<number>(DEFAULTS.hiHatQuietDropDb)
  const [eqABEnabled, setEqABEnabled] = useState<boolean>(DEFAULTS.eqABEnabled)
  const [flatSlope, setFlatSlope] = useState<boolean>(DEFAULTS.flatSlope)
  const [clickTrainVolumePercent, setClickTrainVolumePercent] = useState<number>(DEFAULTS.clickTrainVolumePercent)
  const [referenceVolumeBalance, setReferenceVolumeBalance] = useState<number>(DEFAULTS.referenceVolumeBalance)
  const [referenceVolumeOffsetDb, setReferenceVolumeOffsetDb] = useState<number>(DEFAULTS.referenceVolumeOffsetDb)
  const [referenceVolumeOscillationEnabled, setReferenceVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.referenceVolumeOscillationEnabled)
  const [referenceDotKey, setReferenceDotKey] = useState<string | null>(DEFAULTS.referenceDotKey)
  const [referenceVolumeMultiplyCount, setReferenceVolumeMultiplyCount] = useState<number>(DEFAULTS.referenceVolumeMultiplyCount)
  const [masterVolumeOscillationEnabled, setMasterVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.masterVolumeOscillationEnabled)
  const [masterVolumeOscillationPeriodSeconds, setMasterVolumeOscillationPeriodSeconds] = useState<number>(DEFAULTS.masterVolumeOscillationPeriodSeconds)
  const [masterVolumeOscillationDepthDb, setMasterVolumeOscillationDepthDb] = useState<number>(DEFAULTS.masterVolumeOscillationDepthDb)
  const [volumeGradientEnabled, setVolumeGradientEnabled] = useState<boolean>(DEFAULTS.volumeGradientEnabled)
  const [volumeGradientAxis, setVolumeGradientAxis] = useState<VolumeGradientAxis>(DEFAULTS.volumeGradientAxis)
  const [volumeGradientTiltDb, setVolumeGradientTiltDb] = useState<number>(DEFAULTS.volumeGradientTiltDb)
  const [autoUpDownEnabled, setAutoUpDownEnabled] = useState<boolean>(DEFAULTS.autoUpDownEnabled)
  const [autoUpDownRateHz, setAutoUpDownRateHz] = useState<number>(DEFAULTS.autoUpDownRateHz)
  const autoUpDownDirectionRef = useRef<-1 | 1>(-1)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const focusedDefaultsMigrated = loadSetting("cabin:focusedClickDefaultsV1", false)
    setGridRows(Math.max(MIN_ROWS, Math.min(MAX_ROWS, focusedDefaultsMigrated ? loadSetting("cabin:gridRows", DEFAULTS.gridRows) : DEFAULTS.gridRows)))
    setGridCols(Math.max(MIN_COLS, Math.min(MAX_COLS, focusedDefaultsMigrated ? loadSetting("cabin:gridCols", DEFAULTS.gridCols) : DEFAULTS.gridCols)))
    setFreeformModeEnabled(DEFAULTS.freeformModeEnabled)
    setFreeformPosition(DEFAULTS.freeformPosition)
    setSpeed(clampSpeed(focusedDefaultsMigrated ? loadSetting("cabin:speed", DEFAULTS.speed) : DEFAULTS.speed))
    setVolumePercent(focusedDefaultsMigrated ? loadSetting("cabin:volumePercent", DEFAULTS.volumePercent) : DEFAULTS.volumePercent)
    saveSetting("cabin:release", DEFAULTS.release)
    setReleaseOverlapMs(DEFAULTS.releaseOverlapMs)
    setBandwidth(DEFAULTS.bandwidth)
    saveSetting("cabin:bandwidthDefaultV2", true)
    setBandwidthOscillationEnabled(DEFAULTS.bandwidthOscillationEnabled)
    setSettingsCollapsed(loadSetting("cabin:settingsCollapsed", DEFAULTS.settingsCollapsed))
    setDepth(clampDepth(loadSetting("cabin:depth", DEFAULTS.depth)))
    setDepthGapDb(DEFAULTS.depthGapDb)
    const patternDefaultMigrated = loadSetting("cabin:patternDefaultV3", false)
    setPatternModeEnabled(patternDefaultMigrated ? loadSetting("cabin:patternModeEnabled", DEFAULTS.patternModeEnabled) : DEFAULTS.patternModeEnabled)
    saveSetting("cabin:patternDefaultV3", true)
    setPatternInterleavedEnabled(DEFAULTS.patternInterleavedEnabled)
    setPatternSwitchEnabled(DEFAULTS.patternSwitchEnabled)
    setPatternVolumeDiffDb(DEFAULTS.patternVolumeDiffDb)
    setPatternTwoDotVolumeDiffDb(DEFAULTS.patternTwoDotVolumeDiffDb)
    setHiHatQuietDropDb(DEFAULTS.hiHatQuietDropDb)
    setEqABEnabled(DEFAULTS.eqABEnabled)
    setFlatSlope(false)
    setClickTrainVolumePercent(DEFAULTS.clickTrainVolumePercent)
    saveSetting("cabin:clickTrainVolumeDefaultV4", true)
    const speedMaxMigrated = loadSetting("cabin:speedMaxDefaultV2", false)
    const savedSpeed = loadSetting("cabin:speed", DEFAULTS.speed)
    if (!speedMaxMigrated && savedSpeed >= 32) {
      setSpeed(DEFAULTS.speed)
    }
    saveSetting("cabin:speedMaxDefaultV2", true)
    const lowerSpeedMigrated = loadSetting("cabin:lowerDefaultSpeedV1", false)
    if (!lowerSpeedMigrated && savedSpeed >= SPEED_MAX) {
      setSpeed(DEFAULTS.speed)
    }
    saveSetting("cabin:lowerDefaultSpeedV1", true)
    setReferenceVolumeBalance(DEFAULTS.referenceVolumeBalance)
    setReferenceVolumeOffsetDb(DEFAULTS.referenceVolumeOffsetDb)
    setReferenceVolumeOscillationEnabled(false)
    setReferenceDotKey(loadSetting("cabin:referenceDotKey", DEFAULTS.referenceDotKey))
    setReferenceVolumeMultiplyCount(DEFAULTS.referenceVolumeMultiplyCount)
    setMasterVolumeOscillationEnabled(DEFAULTS.masterVolumeOscillationEnabled)
    setMasterVolumeOscillationPeriodSeconds(DEFAULTS.masterVolumeOscillationPeriodSeconds)
    setMasterVolumeOscillationDepthDb(DEFAULTS.masterVolumeOscillationDepthDb)
    setVolumeGradientEnabled(DEFAULTS.volumeGradientEnabled)
    setVolumeGradientAxis(DEFAULTS.volumeGradientAxis)
    setVolumeGradientTiltDb(DEFAULTS.volumeGradientTiltDb)
    setAutoUpDownEnabled(DEFAULTS.autoUpDownEnabled)
    setAutoUpDownRateHz(DEFAULTS.autoUpDownRateHz)
    const playbackPausedMigrated = loadSetting("cabin:patternPlaybackPausedDefaultV1", false)
    setPatternPlaybackEnabled(playbackPausedMigrated ? loadSetting("cabin:patternPlaybackEnabled", DEFAULTS.patternPlaybackEnabled) : DEFAULTS.patternPlaybackEnabled)
    saveSetting("cabin:patternPlaybackPausedDefaultV1", true)
    saveSetting("cabin:focusedClickDefaultsV1", true)
  }, [])
  const [sequencerVisual, setSequencerVisual] = useState<{ playingDotKey: string | null; beatIndex: number }>({
    playingDotKey: null,
    beatIndex: 0,
  })
  const { setEQEnabled } = useEQProfileStore()

  useEffect(() => {
    const el = patternAreaRef.current
    if (!el) return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      setPatternAreaSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const { width, height } = patternAreaSize
    if (width <= 0 || height <= 0) return
    setPatternSize((prevSize) => {
      const centerX = patternCenter.x * width
      const centerY = patternCenter.y * height
      return clampPatternSize(prevSize, width, height, centerX, centerY)
    })
  }, [patternAreaSize, patternCenter.x, patternCenter.y])

  const patternDots = useMemo<PatternDot[]>(() => {
    const { width, height } = patternAreaSize
    if (width <= 0 || height <= 0) return []
    const centerX = patternCenter.x * width
    const centerY = patternCenter.y * height
    const stepX = patternSize.width / 2
    const stepY = patternSize.height / 2

    return PATTERN_DOT_KEYS.map((key, index) => {
      const col = index % PATTERN_GRID_SIZE
      const row = Math.floor(index / PATTERN_GRID_SIZE)
      const xPx = centerX + (col - 1) * stepX
      const yPx = centerY + (row - 1) * stepY
      return {
        key,
        col,
        row,
        xPx,
        yPx,
        normalizedX: Math.max(0, Math.min(1, xPx / width)),
        normalizedY: Math.max(0, Math.min(1, 1 - yPx / height)),
      }
    })
  }, [patternAreaSize, patternCenter.x, patternCenter.y, patternSize.width, patternSize.height])
  const patternPlayButtonPosition = useMemo(() => {
    const { width, height } = patternAreaSize
    if (width <= 0 || height <= 0) return null

    const buttonHalfWidth = 76
    const buttonHeight = 44
    const margin = 16
    const centerX = patternCenter.x * width
    const centerY = patternCenter.y * height

    return {
      x: Math.max(buttonHalfWidth + margin, Math.min(width - buttonHalfWidth - margin, centerX)),
      y: Math.max(margin, Math.min(height - buttonHeight - margin, centerY + patternSize.height / 2 + 16)),
    }
  }, [patternAreaSize, patternCenter.x, patternCenter.y, patternSize.height])

  const activeSelectedDots = useMemo(
    () => new Set(PATTERN_DOT_KEYS),
    []
  )
  const hasSelectedDots = activeSelectedDots.size > 0
  const activeReferenceDotKey = !freeformModeEnabled && referenceDotKey && activeSelectedDots.has(referenceDotKey)
    ? referenceDotKey
    : null
  const hasActiveDots = activeSelectedDots.size > 0 || freeformModeEnabled

  // Pulsing invite dot — center of grid, shown until user taps a dot this session
  const hasEverSelected = useRef(false)
  if (hasActiveDots) hasEverSelected.current = true

  // Persist settings to localStorage
  useEffect(() => { saveSetting("cabin:gridRows", gridRows) }, [gridRows])
  useEffect(() => { saveSetting("cabin:gridCols", gridCols) }, [gridCols])
  useEffect(() => { saveSetting("cabin:freeformModeEnabled", freeformModeEnabled) }, [freeformModeEnabled])
  useEffect(() => { saveSetting("cabin:freeformPosition", freeformPosition) }, [freeformPosition])
  useEffect(() => { saveSetting("cabin:freeformDots", []) }, [])
  useEffect(() => { saveSetting("cabin:speed", speed) }, [speed])
  useEffect(() => { saveSetting("cabin:volumePercent", volumePercent) }, [volumePercent])
  useEffect(() => { saveSetting("cabin:settingsCollapsed", settingsCollapsed) }, [settingsCollapsed])
  useEffect(() => { saveSetting("cabin:release", DEFAULTS.release) }, [])
  useEffect(() => { saveSetting("cabin:releaseAuto", true) }, [])
  useEffect(() => { saveSetting("cabin:releaseAutoOffsetMs", 0) }, [])
  useEffect(() => { saveSetting("cabin:releaseOverlapMs", releaseOverlapMs) }, [releaseOverlapMs])
  useEffect(() => { saveSetting("cabin:bandwidth", bandwidth) }, [bandwidth])
  useEffect(() => { saveSetting("cabin:bandwidthOscillationEnabled", bandwidthOscillationEnabled) }, [bandwidthOscillationEnabled])
  useEffect(() => { saveSetting("cabin:depth", depth) }, [depth])
  useEffect(() => { saveSetting("cabin:hiHatModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:patternModeEnabled", patternModeEnabled) }, [patternModeEnabled])
  useEffect(() => { saveSetting("cabin:patternInterleavedEnabled", patternInterleavedEnabled) }, [patternInterleavedEnabled])
  useEffect(() => { saveSetting("cabin:patternSwitchEnabled", patternSwitchEnabled) }, [patternSwitchEnabled])
  useEffect(() => { saveSetting("cabin:patternVolumeDiffDb", patternVolumeDiffDb) }, [patternVolumeDiffDb])
  useEffect(() => { saveSetting("cabin:patternTwoDotVolumeDiffDb", patternTwoDotVolumeDiffDb) }, [patternTwoDotVolumeDiffDb])
  useEffect(() => { saveSetting("cabin:reverbModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:reverbVolumeSpreadDb", DEFAULTS.reverbVolumeSpreadDb) }, [])
  useEffect(() => { saveSetting("cabin:hiHatQuietDropDb", hiHatQuietDropDb) }, [hiHatQuietDropDb])
  useEffect(() => { saveSetting("cabin:hiHatLoudReleaseBoostMs", FIXED_ACCENT_RELEASE_MS) }, [])
  useEffect(() => { saveSetting("cabin:repeatCount", 1) }, [])
  useEffect(() => { saveSetting("cabin:depthGapDb", depthGapDb) }, [depthGapDb])
  useEffect(() => { saveSetting("cabin:eqABEnabled", eqABEnabled) }, [eqABEnabled])
  useEffect(() => { saveSetting("cabin:flatSlope", false) }, [])
  useEffect(() => { saveSetting("cabin:additivePartialsEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:clickTrainEnabled", true) }, [])
  useEffect(() => { saveSetting("cabin:clickTrainVolumePercent", clickTrainVolumePercent) }, [clickTrainVolumePercent])
  useEffect(() => { saveSetting("cabin:referenceVolumeBalance", DEFAULTS.referenceVolumeBalance) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeOffsetDb", DEFAULTS.referenceVolumeOffsetDb) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:referenceDotKey", referenceDotKey) }, [referenceDotKey])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeMultiplyCount", DEFAULTS.referenceVolumeMultiplyCount) }, [])
  useEffect(() => { saveSetting("cabin:masterVolumeOscillationEnabled", masterVolumeOscillationEnabled) }, [masterVolumeOscillationEnabled])
  useEffect(() => { saveSetting("cabin:masterVolumeOscillationPeriodSeconds", masterVolumeOscillationPeriodSeconds) }, [masterVolumeOscillationPeriodSeconds])
  useEffect(() => { saveSetting("cabin:masterVolumeOscillationDepthDb", masterVolumeOscillationDepthDb) }, [masterVolumeOscillationDepthDb])
  useEffect(() => { saveSetting("cabin:volumeGradientEnabled", volumeGradientEnabled) }, [volumeGradientEnabled])
  useEffect(() => { saveSetting("cabin:volumeGradientAxis", volumeGradientAxis) }, [volumeGradientAxis])
  useEffect(() => { saveSetting("cabin:volumeGradientTiltDb", volumeGradientTiltDb) }, [volumeGradientTiltDb])
  useEffect(() => { saveSetting("cabin:autoUpDownEnabled", autoUpDownEnabled) }, [autoUpDownEnabled])
  useEffect(() => { saveSetting("cabin:autoUpDownRateHz", autoUpDownRateHz) }, [autoUpDownRateHz])
  useEffect(() => { saveSetting("cabin:patternPlaybackEnabled", patternPlaybackEnabled) }, [patternPlaybackEnabled])

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

  useEffect(() => {
    if (!referenceDotKey) return
    const [x, y] = referenceDotKey.split(",").map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= gridCols || y < 0 || y >= gridRows) {
      setReferenceDotKey(null)
    }
  }, [referenceDotKey, gridRows, gridCols])

  // Subscribe to song playback state — stop soundstage sequencer when a song is playing
  const isSongPlaying = usePlayerStore((s) => s.isPlaying)

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    if (!hasSelectedDots || isSongPlaying || !patternPlaybackEnabled) {
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
  }, [hasSelectedDots, isSongPlaying, patternPlaybackEnabled])

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
    const shouldPlayPattern = patternDots.length > 0 && !isSongPlaying && patternPlaybackEnabled
    let cancelled = false

    if (!shouldPlayPattern) {
      player.setPlaying(false)
      player.updateNormalizedDots([])
      return () => {
        cancelled = true
      }
    }

    player.updateNormalizedDots(patternDots.map((dot) => ({
      key: dot.key,
      normalizedX: dot.normalizedX,
      normalizedY: dot.normalizedY,
    })))

    void resumeAudioContext().then(() => {
      if (!cancelled) {
        player.setPlaying(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [patternDots, isSongPlaying, patternPlaybackEnabled])

  useEffect(() => {
    return () => {
      const player = dotGridAudio.getDotGridAudioPlayer()
      player.setPlaying(false)
      player.updateNormalizedDots([])
    }
  }, [])

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
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setMasterVolumeOscillationPeriodSeconds(masterVolumeOscillationPeriodSeconds)
    player.setMasterVolumeOscillationDepthDb(masterVolumeOscillationDepthDb)
    player.setMasterVolumeOscillationEnabled(masterVolumeOscillationEnabled)
  }, [masterVolumeOscillationEnabled, masterVolumeOscillationPeriodSeconds, masterVolumeOscillationDepthDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeMultiplyCount(referenceVolumeMultiplyCount)
  }, [referenceVolumeMultiplyCount])

  // Speed is the actual hit rate in hits/second.
  // Each dot plays `depth` hits (volume steps) before moving to the next.
  const dotCount = activeSelectedDots.size
  const perHitS = useMemo(() => speedToPerHitSeconds(speed), [speed])
  const effectiveRelease = useMemo(
    () => Math.max(0.001, getAutoReleaseSeconds(perHitS, releaseOverlapMs)),
    [perHitS, releaseOverlapMs]
  )

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
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setHitModeRelease(effectiveRelease)
    player.setHitReleaseOverlapSeconds(clampReleaseOverlapMs(releaseOverlapMs) / 1000)
  }, [effectiveRelease, releaseOverlapMs])

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
    const tiltDb = Math.max(-48, Math.min(48, volumeGradientTiltDb))
    player.setPositionVolumeAxis(volumeGradientAxis === "x" ? "horizontal" : "vertical")
    player.setPositionVolumeReversed(tiltDb < 0)
    player.setPositionVolumeMinDb(-Math.abs(tiltDb))
    player.setPositionVolumeEnabled(volumeGradientEnabled && Math.abs(tiltDb) > 0)
  }, [volumeGradientEnabled, volumeGradientAxis, volumeGradientTiltDb])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    const depthSteps = clampDepth(depth)
    const depthAmountDb = clampDepthAmountDb(depthGapDb)
    player.setVolumeSteps(depthSteps)
    player.setHitDecay((depthSteps - 1) * depthAmountDb)
    player.setHiHatModeEnabled(false)
    player.setPatternModeEnabled(patternModeEnabled)
    player.setPatternInterleavedEnabled(patternInterleavedEnabled)
    player.setPatternSwitchEnabled(patternSwitchEnabled)
    player.setPatternVolumeDiffDb(patternVolumeDiffDb)
    player.setPatternTwoDotVolumeDiffDb(patternTwoDotVolumeDiffDb)
    player.setReverbModeEnabled(false)
    player.setReverbVolumeSpreadDb(DEFAULTS.reverbVolumeSpreadDb)
    player.setHiHatQuietDropDb(hiHatQuietDropDb)
    player.setHiHatLoudReleaseBoostMs(FIXED_ACCENT_RELEASE_MS)
  }, [depth, depthGapDb, patternModeEnabled, patternInterleavedEnabled, patternSwitchEnabled, patternVolumeDiffDb, patternTwoDotVolumeDiffDb, hiHatQuietDropDb])

  useEffect(() => {
    if (volumePercent === 0) {
      dotGridAudio.getDotGridAudioPlayer().setVolumeDb(-Infinity)
    } else {
      // Linear dB scale: 100% = 0 dB, 1% ≈ -60 dB
      const db = -60 + (volumePercent / 100) * 60
      dotGridAudio.getDotGridAudioPlayer().setVolumeDb(db)
    }
  }, [volumePercent])

  const moveSelectedDots = useCallback((dx: number, dy: number): boolean => {
    if (freeformModeEnabled || selectedDots.size === 0) return false

    for (const key of selectedDots) {
      const [col, row] = key.split(",").map(Number)
      if (dx === -1 && col <= 0) return false
      if (dx === 1 && col >= gridCols - 1) return false
      if (dy === -1 && row <= 0) return false
      if (dy === 1 && row >= gridRows - 1) return false
    }

    const next = new Set<string>()
    let nextReferenceDotKey: string | null | undefined

    for (const key of selectedDots) {
      const [col, row] = key.split(",").map(Number)
      const nextKey = `${col + dx},${row + dy}`
      next.add(nextKey)
      if (referenceDotKey === key) nextReferenceDotKey = nextKey
    }

    setSelectedDots(next)
    if (nextReferenceDotKey !== undefined) setReferenceDotKey(nextReferenceDotKey)
    return true
  }, [freeformModeEnabled, gridCols, gridRows, referenceDotKey, selectedDots])

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
      moveSelectedDots(dx, dy)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [freeformModeEnabled, moveSelectedDots])

  useEffect(() => {
    if (!autoUpDownEnabled || freeformModeEnabled || isSongPlaying || selectedDots.size === 0) return
    const rateHz = Math.max(0.1, Math.min(20, autoUpDownRateHz))
    const intervalMs = 1000 / rateHz

    const tick = () => {
      const didMove = moveSelectedDots(0, autoUpDownDirectionRef.current)
      if (didMove) return
      autoUpDownDirectionRef.current = autoUpDownDirectionRef.current === -1 ? 1 : -1
      moveSelectedDots(0, autoUpDownDirectionRef.current)
    }

    const intervalId = window.setInterval(tick, intervalMs)
    return () => window.clearInterval(intervalId)
  }, [autoUpDownEnabled, autoUpDownRateHz, freeformModeEnabled, isSongPlaying, moveSelectedDots, selectedDots.size])

  // ---- Cursor dot (Command-key) state ----
  const cursorPlayActiveRef = useRef(false)
  const cursorPlayModeRef = useRef<CursorPlayMode | null>(null)
  const freeformDraggingRef = useRef(false)

  const startOrUpdateCursorPlay = useCallback((position: NormalizedPosition, mode: CursorPlayMode) => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    const usePattern = mode === "freeform"

    if (!cursorPlayActiveRef.current) {
      void resumeAudioContext()
      cursorPlayActiveRef.current = true
      cursorPlayModeRef.current = mode
      player.startCursorPlay(position.normalizedX, position.normalizedY, usePattern)
    } else if (cursorPlayModeRef.current !== mode) {
      void resumeAudioContext()
      player.stopCursorPlay()
      cursorPlayModeRef.current = mode
      player.startCursorPlay(position.normalizedX, position.normalizedY, usePattern)
    } else {
      player.updateCursorPosition(position.normalizedX, position.normalizedY)
    }
  }, [])

  const stopCursorPlay = useCallback((mode?: CursorPlayMode) => {
    if (!cursorPlayActiveRef.current) return
    if (mode && cursorPlayModeRef.current !== mode) return
    cursorPlayActiveRef.current = false
    cursorPlayModeRef.current = null
    dotGridAudio.getDotGridAudioPlayer().stopCursorPlay()
  }, [])

  const handleCursorDotEnd = useCallback(() => {
    stopCursorPlay("cursor")
  }, [stopCursorPlay])

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

  useEffect(() => {
    return () => {
      cursorPlayActiveRef.current = false
      cursorPlayModeRef.current = null
      dotGridAudio.getDotGridAudioPlayer().stopCursorPlay()
    }
  }, [])

  useEffect(() => {
    if (!freeformModeEnabled || isSongPlaying) {
      if (freeformDraggingRef.current) {
        freeformDraggingRef.current = false
        onDragStateChange?.(false)
      }
      stopCursorPlay("freeform")
      return
    }

    startOrUpdateCursorPlay(freeformPosition, "freeform")
  }, [freeformModeEnabled, freeformPosition, isSongPlaying, onDragStateChange, startOrUpdateCursorPlay, stopCursorPlay])

  const { playingDotKey } = sequencerVisual

  const getPatternPointer = useCallback((clientX: number, clientY: number) => {
    const rect = patternAreaRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, clientY - rect.top)),
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const beginPatternDrag = useCallback((event: PointerEvent<HTMLElement>, mode: PatternDragMode) => {
    if (isSongPlaying) return
    const point = getPatternPointer(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    patternDragRef.current = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCenterX: patternCenter.x * point.width,
      startCenterY: patternCenter.y * point.height,
      startSize: patternSize,
    }
    setIsPatternDragging(true)
    onDragStateChange?.(true)
  }, [getPatternPointer, isSongPlaying, onDragStateChange, patternCenter.x, patternCenter.y, patternSize])

  useEffect(() => {
    if (!isPatternDragging) return

    const onPointerMove = (event: globalThis.PointerEvent) => {
      const drag = patternDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const point = getPatternPointer(event.clientX, event.clientY)
      if (!point) return

      if (drag.mode === "move") {
        const nextCenterX = drag.startCenterX + event.clientX - drag.startClientX
        const nextCenterY = drag.startCenterY + event.clientY - drag.startClientY
        const size = clampPatternSize(drag.startSize, point.width, point.height, nextCenterX, nextCenterY)
        const center = clampPatternCenter(nextCenterX, nextCenterY, size, point.width, point.height)
        setPatternSize(size)
        setPatternCenter({ x: center.x / point.width, y: center.y / point.height })
        return
      }

      const dx = Math.abs(point.x - drag.startCenterX)
      const dy = Math.abs(point.y - drag.startCenterY)
      const requestedSize = {
        width: Math.max(MIN_PATTERN_SIZE_PX, dx * 2),
        height: Math.max(MIN_PATTERN_SIZE_PX, dy * 2),
      }
      const size = clampPatternSize(requestedSize, point.width, point.height, drag.startCenterX, drag.startCenterY)
      setPatternSize(size)
    }

    const endDrag = (event: globalThis.PointerEvent) => {
      const drag = patternDragRef.current
      if (drag && event.pointerId !== drag.pointerId) return
      patternDragRef.current = null
      setIsPatternDragging(false)
      onDragStateChange?.(false)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", endDrag)
    window.addEventListener("pointercancel", endDrag)
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", endDrag)
      window.removeEventListener("pointercancel", endDrag)
    }
  }, [getPatternPointer, isPatternDragging, onDragStateChange])

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
      <div
        ref={patternAreaRef}
        className="absolute inset-4 z-20 overflow-hidden rounded-2xl border border-white/10 bg-black/[0.08] dark:bg-white/[0.025] touch-none"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.08),transparent_58%)]" />
        {patternDots.length > 0 && (
          <>
            <button
              type="button"
              className="absolute cursor-move border border-cyan-300/25 bg-cyan-300/[0.03] p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-200/60"
              onPointerDown={(event) => beginPatternDrag(event, "move")}
              aria-label="Move pattern"
              style={{
                left: `${patternCenter.x * 100}%`,
                top: `${patternCenter.y * 100}%`,
                width: `${patternSize.width}px`,
                height: `${patternSize.height}px`,
                transform: "translate(-50%, -50%)",
              }}
            />
            {patternDots.map((dot) => {
              const isCenter = dot.col === 1 && dot.row === 1
              const isCorner = dot.col !== 1 && dot.row !== 1
              const isPlayingDot = playingDotKey === dot.key
              const handleMode: PatternDragMode | null = isCenter ? "move" : isCorner ? "resize" : null

              return (
                <button
                  key={dot.key}
                  type="button"
                  aria-label={isCenter ? "Move pattern" : isCorner ? "Resize pattern" : "Pattern dot"}
                  disabled={!handleMode || isSongPlaying}
                  onPointerDown={handleMode ? (event) => beginPatternDrag(event, handleMode) : undefined}
                  className={cn(
                    "absolute z-10 rounded-full border transition-[box-shadow,background-color,border-color,transform] duration-150",
                    handleMode && !isSongPlaying ? "pointer-events-auto" : "pointer-events-none",
                    isCenter ? "cursor-move" : isCorner ? "cursor-nwse-resize" : "cursor-default",
                    isPlayingDot
                      ? "border-cyan-200 bg-cyan-200 shadow-[0_0_22px_rgba(103,232,249,0.8)]"
                      : "border-cyan-200/55 bg-cyan-300/45 shadow-[0_0_14px_rgba(34,211,238,0.32)]",
                    isPatternDragging && handleMode && "scale-110"
                  )}
                  style={{
                    left: `${dot.xPx}px`,
                    top: `${dot.yPx}px`,
                    width: `${PATTERN_DOT_SIZE_PX}px`,
                    height: `${PATTERN_DOT_SIZE_PX}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              )
            })}
            {patternPlayButtonPosition && (
              <button
                type="button"
                disabled={isSongPlaying}
                aria-pressed={patternPlaybackEnabled && !isSongPlaying}
                onClick={() => setPatternPlaybackEnabled((playing) => !playing)}
                className={cn(
                  "absolute z-30 flex h-11 min-w-[152px] items-center justify-center gap-2 rounded-full border px-5 text-xs font-semibold uppercase tracking-wider shadow-[0_12px_35px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors",
                  patternPlaybackEnabled && !isSongPlaying
                    ? "border-cyan-200/45 bg-cyan-300/18 text-cyan-50 hover:bg-cyan-300/24"
                    : "border-white/14 bg-black/35 text-white/78 hover:bg-white/12 hover:text-white",
                  isSongPlaying && "cursor-not-allowed opacity-45"
                )}
                style={{
                  left: `${patternPlayButtonPosition.x}px`,
                  top: `${patternPlayButtonPosition.y}px`,
                  transform: "translateX(-50%)",
                }}
              >
                {patternPlaybackEnabled && !isSongPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {patternPlaybackEnabled && !isSongPlaying ? "Pause" : "Play"}
              </button>
            )}
          </>
        )}
        {isSongPlaying && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 text-sm font-medium text-white/70">
            Pause music to edit the pattern
          </div>
        )}
      </div>
      <SettingsPanel
        speed={speed}
        onSpeedChange={setSpeed}
        volumePercent={volumePercent}
        onVolumeChange={setVolumePercent}
      />
    </div>
  )
}
