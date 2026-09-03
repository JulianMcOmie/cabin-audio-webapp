"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import dynamic from "next/dynamic"
import { SettingsPanel } from "@/components/settings-panel"
import { Slider } from "@/components/ui/slider"
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
const MAX_ROWS = 20
const MIN_COLS = 3
const MAX_COLS = 128
const SPEED_MIN = 0.05
const SPEED_MAX = 64
const DEFAULT_SPEED = 32
const MIN_PER_HIT_MS = 30
const MAX_PER_HIT_MS = 2500
const SPEED_INTERVAL_MULTIPLIER = 2
const HIT_ATTACK_S = 0.01
const FIXED_ACCENT_RELEASE_MS = 200
const HIT_STAGGER_PERCENT_MIN = 5
const HIT_STAGGER_PERCENT_MAX = 100
const DEFAULT_HIT_STAGGER_PERCENT = 100
const WAVE_WAIT_SECONDS_MIN = 0
const WAVE_WAIT_SECONDS_MAX = 5
const DEFAULT_WAVE_WAIT_SECONDS = 0
const VOLUME_OSCILLATION_RATE_MIN_HZ = 0.05
const VOLUME_OSCILLATION_RATE_MAX_HZ = 8
const DEFAULT_VOLUME_OSCILLATION_RATE_HZ = 0.5
const VOLUME_OSCILLATION_WAVE_PHASE_MIN = 0
const VOLUME_OSCILLATION_WAVE_PHASE_MAX = 1
const DEFAULT_VOLUME_OSCILLATION_WAVE_PHASE = 0.125
const SELECTION_VOLUME_STEP_MIN_DB = 0
const SELECTION_VOLUME_STEP_MAX_DB = 48
const DEFAULT_SELECTION_VOLUME_STEP_DB = 0
const CONTINUOUS_LOUD_RATIO_MIN = 0.01
const CONTINUOUS_LOUD_RATIO_MAX = 0.99
// Earlier auto-defaults for the loud/quiet balance; installs still sitting on one
// of these get migrated up to the current default the first time the migration runs.
const PRIOR_DEFAULT_CONTINUOUS_LOUD_RATIOS = [0.5, 0.25]
const DEFAULT_CONTINUOUS_LOUD_RATIO = 0.5 // 2:2 loud/quiet balance (2 loud : 2 quiet per block of 4)
const DRAG_NOISE_FORMATION_COUNT_MIN = 1
const DRAG_NOISE_FORMATION_COUNT_MAX = 8
const DEFAULT_DRAG_NOISE_FORMATION_COUNT = 1
const DRAG_NOISE_FORMATION_SPREAD_MIN = 0
const DRAG_NOISE_FORMATION_SPREAD_MAX = 35
const DEFAULT_DRAG_NOISE_FORMATION_SPREAD = 8
const ROW_COMPARE_REPEATS_MIN = 1
const ROW_COMPARE_REPEATS_MAX = 32
const ROW_COMPARE_VOLUME_MIN_DB = -36
const ROW_COMPARE_VOLUME_MAX_DB = 24
const LINE_ENDPOINT_GAIN_MIN_DB = -60
const LINE_ENDPOINT_GAIN_MAX_DB = 24
const DEFAULT_LINE_ENDPOINT_GAIN_DB = 0
const POSITION_VOLUME_MIN_DB = -60
const POSITION_VOLUME_MAX_DB = 24
const DOT_VOLUME_MIN_DB = -60
const DOT_VOLUME_MAX_DB = 24
const DEFAULT_CLICK_TRAIN_VOLUME_PERCENT = 500
const DEFAULT_WIDE_BANDWIDTH = 6
const DEFAULT_GENTLE_BANDWIDTH = DEFAULT_WIDE_BANDWIDTH / 2
type PatternAccentEvery = 2 | 4 | 8
type NormalizedPoint = { normalizedX: number; normalizedY: number }
type LineDragMode = "move" | "start" | "end"
type LineDragState = {
  pointerId: number
  mode: LineDragMode
  startPointer: NormalizedPoint
  startCenter: NormalizedPoint
  startLength: number
  startAngle: number
}
const DEFAULT_LINE_CENTER: NormalizedPoint = { normalizedX: 0.5, normalizedY: 0.5 }
const DEFAULT_LINE_LENGTH = 0.5
const DEFAULT_LINE_ANGLE_RAD = 0
const LINE_SQUARE_ANGLE_RAD = Math.PI / 2
const LINE_LENGTH_MIN = 0.02
const LINE_LENGTH_MAX = Math.SQRT2
const LINE_FIRST_VOLUME_OSCILLATION_RATE_HZ = 5
const DEFAULT_LINE_PATH_SECONDS = 4
const MIN_LINE_PATH_PASS_SECONDS = 0.05
type LineEndpoints = [NormalizedPoint, NormalizedPoint]

function speedToPerHitSeconds(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)))
  const perHitMs = MAX_PER_HIT_MS * Math.pow(MIN_PER_HIT_MS / MAX_PER_HIT_MS, t)
  return (perHitMs * SPEED_INTERVAL_MULTIPLIER) / 1000
}

const DEFAULT_LINE_PATH_PER_HIT_SECONDS = speedToPerHitSeconds(DEFAULT_SPEED)

function getLinePathPassSeconds(lineLength: number, perHitSeconds: number): number {
  const defaultLineSpeed = DEFAULT_LINE_LENGTH / DEFAULT_LINE_PATH_SECONDS
  const speedMultiplier = DEFAULT_LINE_PATH_PER_HIT_SECONDS / Math.max(0.001, perHitSeconds)
  const normalizedUnitsPerSecond = Math.max(0.001, defaultLineSpeed * speedMultiplier)
  return Math.max(MIN_LINE_PATH_PASS_SECONDS, Math.max(LINE_LENGTH_MIN, lineLength) / normalizedUnitsPerSecond)
}

function dbToLinearGain(db: number): number {
  return Math.pow(10, db / 20)
}


function clampLoudQuietBlockSize(size: number): number {
  return Math.max(1, Math.min(8, Math.round(size)))
}

function clampHitMultiplier(multiplier: number): number {
  return Math.max(1, Math.min(32, Math.round(multiplier)))
}

function clampHitStaggerPercent(percent: number): number {
  return Math.max(HIT_STAGGER_PERCENT_MIN, Math.min(HIT_STAGGER_PERCENT_MAX, Math.round(percent)))
}

function clampWaveWaitSeconds(seconds: number): number {
  return Math.max(WAVE_WAIT_SECONDS_MIN, Math.min(WAVE_WAIT_SECONDS_MAX, seconds))
}

function clampVolumeOscillationRate(rateHz: number): number {
  return Math.max(VOLUME_OSCILLATION_RATE_MIN_HZ, Math.min(VOLUME_OSCILLATION_RATE_MAX_HZ, rateHz))
}

function clampVolumeOscillationShape(shape: unknown): dotGridAudio.VolumeOscillationShape {
  return shape === "hold" ? "hold" : dotGridAudio.DEFAULT_VOLUME_OSCILLATION_SHAPE
}

function clampVolumeOscillationWavePhase(phase: number): number {
  return Math.max(VOLUME_OSCILLATION_WAVE_PHASE_MIN, Math.min(VOLUME_OSCILLATION_WAVE_PHASE_MAX, phase))
}

function clampSelectionVolumeStepDb(db: number): number {
  return Math.max(SELECTION_VOLUME_STEP_MIN_DB, Math.min(SELECTION_VOLUME_STEP_MAX_DB, db))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampRange(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}

function clampGentleEdgeFalloffDbPerOct(dbPerOct: number): number {
  return Math.max(
    dotGridAudio.MIN_GENTLE_EDGE_FALLOFF_DB_PER_OCT,
    Math.min(dotGridAudio.MAX_GENTLE_EDGE_FALLOFF_DB_PER_OCT, dbPerOct)
  )
}

function clampContinuousLoudRatio(ratio: number): number {
  return Math.max(CONTINUOUS_LOUD_RATIO_MIN, Math.min(CONTINUOUS_LOUD_RATIO_MAX, ratio))
}

function clampDragNoiseFormationCount(count: number): number {
  return Math.max(DRAG_NOISE_FORMATION_COUNT_MIN, Math.min(DRAG_NOISE_FORMATION_COUNT_MAX, Math.round(count)))
}

function clampDragNoiseFormationSpread(spread: number): number {
  return Math.max(DRAG_NOISE_FORMATION_SPREAD_MIN, Math.min(DRAG_NOISE_FORMATION_SPREAD_MAX, spread))
}

function clampLineLengthForCenter(center: NormalizedPoint, length: number, angle: number): number {
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)
  const maxHalfX = Math.abs(dirX) < 0.0001
    ? Number.POSITIVE_INFINITY
    : Math.min(center.normalizedX, 1 - center.normalizedX) / Math.abs(dirX)
  const maxHalfY = Math.abs(dirY) < 0.0001
    ? Number.POSITIVE_INFINITY
    : Math.min(center.normalizedY, 1 - center.normalizedY) / Math.abs(dirY)
  const maxLength = Math.max(0, Math.min(LINE_LENGTH_MAX / 2, maxHalfX, maxHalfY) * 2)
  return Math.min(Math.max(LINE_LENGTH_MIN, length), maxLength)
}

function clampLineCenter(center: NormalizedPoint, length: number, angle: number): NormalizedPoint {
  const halfX = Math.abs(Math.cos(angle)) * length * 0.5
  const halfY = Math.abs(Math.sin(angle)) * length * 0.5
  return {
    normalizedX: clampRange(center.normalizedX, halfX, 1 - halfX),
    normalizedY: clampRange(center.normalizedY, halfY, 1 - halfY),
  }
}

function getLineEndpoints(
  center: NormalizedPoint,
  length: number,
  angle: number
): LineEndpoints {
  const safeLength = clampLineLengthForCenter(center, length, angle)
  const safeCenter = clampLineCenter(center, safeLength, angle)
  const halfX = Math.cos(angle) * safeLength * 0.5
  const halfY = Math.sin(angle) * safeLength * 0.5
  return [
    { normalizedX: clamp01(safeCenter.normalizedX - halfX), normalizedY: clamp01(safeCenter.normalizedY - halfY) },
    { normalizedX: clamp01(safeCenter.normalizedX + halfX), normalizedY: clamp01(safeCenter.normalizedY + halfY) },
  ]
}

function clampSquareLineLengthForCenter(center: NormalizedPoint, length: number): number {
  const maxLength = Math.max(
    0,
    Math.min(
      LINE_LENGTH_MAX,
      center.normalizedX * 2,
      (1 - center.normalizedX) * 2,
      center.normalizedY * 2,
      (1 - center.normalizedY) * 2
    )
  )
  return Math.min(Math.max(LINE_LENGTH_MIN, length), maxLength)
}

function clampSquareLineCenter(center: NormalizedPoint, length: number): NormalizedPoint {
  const half = length * 0.5
  return {
    normalizedX: clampRange(center.normalizedX, half, 1 - half),
    normalizedY: clampRange(center.normalizedY, half, 1 - half),
  }
}

function getSquareLineEndpoints(
  center: NormalizedPoint,
  length: number
): { primary: LineEndpoints; copy: LineEndpoints; center: NormalizedPoint; sideLength: number } {
  const safeLength = clampSquareLineLengthForCenter(center, length)
  const safeCenter = clampSquareLineCenter(center, safeLength)
  const half = safeLength * 0.5
  const bottomY = clamp01(safeCenter.normalizedY - half)
  const topY = clamp01(safeCenter.normalizedY + half)
  const leftX = clamp01(safeCenter.normalizedX - half)
  const rightX = clamp01(safeCenter.normalizedX + half)

  return {
    primary: [
      { normalizedX: leftX, normalizedY: bottomY },
      { normalizedX: leftX, normalizedY: topY },
    ],
    copy: [
      { normalizedX: rightX, normalizedY: bottomY },
      { normalizedX: rightX, normalizedY: topY },
    ],
    center: safeCenter,
    sideLength: safeLength,
  }
}

function getLineSegmentVisual([start, end]: LineEndpoints) {
  const startLeft = start.normalizedX * 100
  const startTop = (1 - start.normalizedY) * 100
  const endLeft = end.normalizedX * 100
  const endTop = (1 - end.normalizedY) * 100
  const deltaX = endLeft - startLeft
  const deltaY = endTop - startTop

  return {
    start,
    end,
    startLeft,
    startTop,
    endLeft,
    endTop,
    width: Math.hypot(deltaX, deltaY),
    screenAngle: Math.atan2(deltaY, deltaX),
  }
}

function getPointerNormalizedPoint(event: PointerEvent<HTMLElement>, element: HTMLElement | null): NormalizedPoint | null {
  const rect = element?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null

  return {
    normalizedX: clamp01((event.clientX - rect.left) / rect.width),
    normalizedY: clamp01(1 - (event.clientY - rect.top) / rect.height),
  }
}

function getDragNoiseFormationPoints(
  normalizedX: number,
  normalizedY: number,
  count: number,
  spreadPercent: number
): Array<{ normalizedX: number; normalizedY: number }> {
  const safeCount = clampDragNoiseFormationCount(count)
  const spread = clampDragNoiseFormationSpread(spreadPercent) / 100

  if (safeCount <= 1 || spread <= 0) {
    return [{ normalizedX, normalizedY }]
  }

  if (safeCount === 2) {
    return [-1, 1].map((direction) => ({
      normalizedX: Math.max(0, Math.min(1, normalizedX + direction * spread)),
      normalizedY,
    }))
  }

  return Array.from({ length: safeCount }, (_, index) => {
    const angle = -Math.PI / 2 + (index / safeCount) * Math.PI * 2
    return {
      normalizedX: Math.max(0, Math.min(1, normalizedX + Math.cos(angle) * spread)),
      normalizedY: Math.max(0, Math.min(1, normalizedY + Math.sin(angle) * spread)),
    }
  })
}

function clampRowIndex(row: number, rows: number): number {
  const safeRows = Math.max(1, Math.round(rows))
  return Math.max(0, Math.min(safeRows - 1, Math.round(row)))
}

function clampRowCompareRepeats(repeats: number): number {
  return Math.max(ROW_COMPARE_REPEATS_MIN, Math.min(ROW_COMPARE_REPEATS_MAX, Math.round(repeats)))
}

function clampRowCompareVolumeDb(db: number): number {
  return Math.max(ROW_COMPARE_VOLUME_MIN_DB, Math.min(ROW_COMPARE_VOLUME_MAX_DB, db))
}

function clampPositionVolumeDb(db: number): number {
  return Math.max(POSITION_VOLUME_MIN_DB, Math.min(POSITION_VOLUME_MAX_DB, db))
}

function clampLineEndpointGainDb(db: number): number {
  return Math.max(LINE_ENDPOINT_GAIN_MIN_DB, Math.min(LINE_ENDPOINT_GAIN_MAX_DB, db))
}

function clampDotVolumeDb(db: number): number {
  return Math.max(DOT_VOLUME_MIN_DB, Math.min(DOT_VOLUME_MAX_DB, db))
}

function getRowDotKeys(row: number, cols: number): string[] {
  const safeCols = Math.max(1, Math.round(cols))
  return Array.from({ length: safeCols }, (_, col) => `${col},${row}`)
}

function getDefaultCompareRowA(rows: number): number {
  return clampRowIndex(Math.max(0, rows - 1), rows)
}

function getDefaultCompareRowB(rows: number): number {
  return clampRowIndex(0, rows)
}

function formatSignedDb(value: number): string {
  if (value > 0) return `+${value.toFixed(0)} dB`
  return `${value.toFixed(0)} dB`
}

function isDotKeyInGrid(dotKey: string | null, rows: number, cols: number): boolean {
  if (!dotKey) return false
  const [col, row] = dotKey.split(",").map(Number)
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < cols && row < rows
}

function formatDotKeyLabel(dotKey: string): string {
  const [col, row] = dotKey.split(",").map(Number)
  if (!Number.isInteger(col) || !Number.isInteger(row)) return dotKey
  return `c${col + 1} r${row + 1}`
}

function getRandomDotKey(rows: number, cols: number, previousKey: string | null = null): string {
  const safeRows = Math.max(1, Math.floor(rows))
  const safeCols = Math.max(1, Math.floor(cols))
  const dotCount = safeRows * safeCols
  let dotIndex = Math.floor(Math.random() * dotCount)
  let dotKey = `${dotIndex % safeCols},${Math.floor(dotIndex / safeCols)}`

  if (dotCount > 1 && dotKey === previousKey) {
    dotIndex = (dotIndex + 1 + Math.floor(Math.random() * (dotCount - 1))) % dotCount
    dotKey = `${dotIndex % safeCols},${Math.floor(dotIndex / safeCols)}`
  }

  return dotKey
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
  speed: DEFAULT_SPEED,
  volumeDb: 0,
  attackMs: 2,
  releaseMs: 600,
  hitSpacingMs: 250,
  pingPongEnabled: false,
  release: 2,
  releaseAuto: true,
  releaseAutoOffsetMs: 0,
  bandwidth: DEFAULT_WIDE_BANDWIDTH,
  bandwidthFilterMode: dotGridAudio.DEFAULT_BANDWIDTH_FILTER_MODE,
  gentleEdgeFalloffDbPerOct: dotGridAudio.DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT,
  bandwidthOscillationEnabled: false,
  settingsCollapsed: true,
  depth: 1,
  hiHatModeEnabled: false,
  patternModeEnabled: false,
  patternAccentEvery: 8 as PatternAccentEvery,
  blindRandomModeEnabled: false,
  patternVolumeDiffDb: 0,
  fourFourHitModeEnabled: false,
  loudQuietBlockSize: 4,
  loudQuietPerDot: false,
  threeLevelVolumeEnabled: false,
  sidePolarityLoudQuietEnabled: false,
  loudQuietBandwidthModeEnabled: false,
  halfBandPatternEnabled: false,
  rowAlternationModeEnabled: false,
  rhythmPatternEnabled: false,
  inverseDotNoiseEnabled: false,
  inverseDotOutsideGapOctaves: dotGridAudio.DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
  inverseDotBandBoostDb: dotGridAudio.DEFAULT_INVERSE_DOT_BAND_BOOST_DB,
  hitMultiplier: 1,
  hitStaggerPercent: DEFAULT_HIT_STAGGER_PERCENT,
  waveWaitSeconds: DEFAULT_WAVE_WAIT_SECONDS,
  experimentalModeEnabled: false,
  snareScoopEnabled: false,
  snareScoopDepthDb: 16,
  snareScoopMode: "single",
  snareScoopBandwidthOctaves: dotGridAudio.DEFAULT_SNARE_SCOOP_BANDWIDTH_OCTAVES_BY_MODE.single,
  tiltOscillationEnabled: false,
  tiltOscillationAmount: 1.5,
  reverbModeEnabled: false,
  reverbVolumeSpreadDb: 12,
  hiHatQuietDropDb: 20,
  hiHatLoudReleaseBoostMs: 200,
  repeatCount: 1,
  depthGapDb: 20,
  dotBalanceDb: 0,
  eqABEnabled: false,
  flatSlope: false,
  additivePartialsEnabled: false,
  clickTrainEnabled: true,
  noiseGeneratorEnabled: false,
  noiseOscillationRateHz: dotGridAudio.DEFAULT_NOISE_OSCILLATION_RATE_HZ,
  noiseOscillationMinDb: dotGridAudio.DEFAULT_NOISE_OSCILLATION_MIN_DB,
  noiseOscillationMaxDb: dotGridAudio.DEFAULT_NOISE_OSCILLATION_MAX_DB,
  clickTrainBoostDb: 0,
  referenceVolumeBalance: 100,
  referenceVolumeOffsetDb: 0,
  referenceVolumeOscillationEnabled: false,
  allVolumeOscillationEnabled: false,
  allVolumeOscillationRateHz: DEFAULT_VOLUME_OSCILLATION_RATE_HZ,
  allVolumeOscillationShape: dotGridAudio.DEFAULT_VOLUME_OSCILLATION_SHAPE,
  allVolumeOscillationWaveEnabled: false,
  allVolumeOscillationWavePhase: DEFAULT_VOLUME_OSCILLATION_WAVE_PHASE,
  selectionVolumeStepDb: DEFAULT_SELECTION_VOLUME_STEP_DB,
  continuousNoiseEnabled: false,
  straightLoudQuietNoiseEnabled: false,
  continuousLoudRatio: DEFAULT_CONTINUOUS_LOUD_RATIO,
  continuousTargetsOnlyEnabled: false,
  continuousTargetsSequentialHoldEnabled: false,
  continuousTwoDotAlternateEnabled: false,
  singleLocationTwoDotEnabled: false,
  continuousLeftRightLoudQuietEnabled: false,
  continuousSequentialEnabled: false,
  continuousSequentialRowsEnabled: false,
  dragNoiseModeEnabled: false,
  dragNoiseFormationCount: DEFAULT_DRAG_NOISE_FORMATION_COUNT,
  dragNoiseFormationSpread: DEFAULT_DRAG_NOISE_FORMATION_SPREAD,
  lineCalibrationEnabled: false,
  lineCenterX: DEFAULT_LINE_CENTER.normalizedX,
  lineCenterY: DEFAULT_LINE_CENTER.normalizedY,
  lineLength: DEFAULT_LINE_LENGTH,
  lineAngle: DEFAULT_LINE_ANGLE_RAD,
  lineSquareModeEnabled: false,
  linePathMotionEnabled: false,
  lineInverseDotPathEnabled: false,
  lineStartGainDb: DEFAULT_LINE_ENDPOINT_GAIN_DB,
  lineEndGainDb: DEFAULT_LINE_ENDPOINT_GAIN_DB,
  rowCompareEnabled: false,
  rowCompareRowA: 2,
  rowCompareRowB: 0,
  rowCompareRepeats: 8,
  rowCompareVolumeADb: 0,
  rowCompareVolumeBDb: 0,
  referenceVolumeMultiplyCount: 1,
  positionVolumeEnabled: false,
  positionVolumeLeftDb: 0,
  positionVolumeRightDb: 0,
} as const

export interface ActiveBand {
  frequency: number
  gain: number
  q: number
}

export function MainView({ quality, highlightTarget, isPlaying, onDragStateChange, activeBand }: { quality: QualityLevel; highlightTarget: HighlightTarget; isPlaying: boolean; onDragStateChange?: (isDragging: boolean) => void; activeBand?: ActiveBand | null }) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  // Inverse-dot dots right-clicked to play flat constant noise (not act as a dot).
  const [inverseConstantNoiseDots, setInverseConstantNoiseDots] = useState<Set<string>>(new Set())
  const [gridRows, setGridRows] = useState<number>(DEFAULTS.gridRows)
  const [gridCols, setGridCols] = useState<number>(DEFAULTS.gridCols)
  const [speed, setSpeed] = useState<number>(DEFAULTS.speed)
  const [volumeDb, setVolumeDb] = useState<number>(DEFAULTS.volumeDb)
  const [attackMs, setAttackMs] = useState<number>(DEFAULTS.attackMs)
  const [releaseMs, setReleaseMs] = useState<number>(DEFAULTS.releaseMs)
  const [hitSpacingMs, setHitSpacingMs] = useState<number>(DEFAULTS.hitSpacingMs)
  const [pingPongEnabled, setPingPongEnabled] = useState<boolean>(DEFAULTS.pingPongEnabled)
  const [depthGapDb, setDepthGapDb] = useState<number>(DEFAULTS.depthGapDb)
  const [dotBalanceDb, setDotBalanceDb] = useState<number>(DEFAULTS.dotBalanceDb)
  const [bandwidth, setBandwidth] = useState<number>(DEFAULTS.bandwidth)
  const [bandwidthFilterMode, setBandwidthFilterMode] = useState<dotGridAudio.BandwidthFilterMode>(DEFAULTS.bandwidthFilterMode)
  const [gentleEdgeFalloffDbPerOct, setGentleEdgeFalloffDbPerOct] = useState<number>(DEFAULTS.gentleEdgeFalloffDbPerOct)
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(DEFAULTS.settingsCollapsed)
  const [depth, setDepth] = useState<number>(DEFAULTS.depth)
  const [blindRandomModeEnabled, setBlindRandomModeEnabled] = useState<boolean>(DEFAULTS.blindRandomModeEnabled)
  const [blindRandomDotKey, setBlindRandomDotKey] = useState<string | null>(null)
  const [loudQuietBlockSize, setLoudQuietBlockSize] = useState<number>(DEFAULTS.loudQuietBlockSize)
  const [loudQuietPerDot, setLoudQuietPerDot] = useState<boolean>(DEFAULTS.loudQuietPerDot)
  const [threeLevelVolumeEnabled, setThreeLevelVolumeEnabled] = useState<boolean>(DEFAULTS.threeLevelVolumeEnabled)
  const [sidePolarityLoudQuietEnabled, setSidePolarityLoudQuietEnabled] = useState<boolean>(DEFAULTS.sidePolarityLoudQuietEnabled)
  const [loudQuietBandwidthModeEnabled, setLoudQuietBandwidthModeEnabled] = useState<boolean>(DEFAULTS.loudQuietBandwidthModeEnabled)
  const [halfBandPatternEnabled, setHalfBandPatternEnabled] = useState<boolean>(DEFAULTS.halfBandPatternEnabled)
  const [rowAlternationModeEnabled, setRowAlternationModeEnabled] = useState<boolean>(DEFAULTS.rowAlternationModeEnabled)
  const [rhythmPatternEnabled, setRhythmPatternEnabled] = useState<boolean>(DEFAULTS.rhythmPatternEnabled)
  const [inverseDotNoiseEnabled, setInverseDotNoiseEnabled] = useState<boolean>(DEFAULTS.inverseDotNoiseEnabled)
  const [inverseDotOutsideGapOctaves, setInverseDotOutsideGapOctaves] = useState<number>(DEFAULTS.inverseDotOutsideGapOctaves)
  const [inverseDotBandBoostDb, setInverseDotBandBoostDb] = useState<number>(DEFAULTS.inverseDotBandBoostDb)
  const [hitMultiplier, setHitMultiplier] = useState<number>(DEFAULTS.hitMultiplier)
  const [hitStaggerPercent, setHitStaggerPercent] = useState<number>(DEFAULTS.hitStaggerPercent)
  const [waveWaitSeconds, setWaveWaitSeconds] = useState<number>(DEFAULTS.waveWaitSeconds)
  const [hiHatQuietDropDb, setHiHatQuietDropDb] = useState<number>(DEFAULTS.hiHatQuietDropDb)
  const [eqABEnabled, setEqABEnabled] = useState<boolean>(DEFAULTS.eqABEnabled)
  const [flatSlope, setFlatSlope] = useState<boolean>(DEFAULTS.flatSlope)
  const [noiseOscillationRateHz, setNoiseOscillationRateHz] = useState<number>(DEFAULTS.noiseOscillationRateHz)
  const [noiseOscillationMinDb, setNoiseOscillationMinDb] = useState<number>(DEFAULTS.noiseOscillationMinDb)
  const [noiseOscillationMaxDb, setNoiseOscillationMaxDb] = useState<number>(DEFAULTS.noiseOscillationMaxDb)
  const [clickTrainBoostDb, setClickTrainBoostDb] = useState<number>(DEFAULTS.clickTrainBoostDb)
  const [referenceVolumeBalance, setReferenceVolumeBalance] = useState<number>(DEFAULTS.referenceVolumeBalance)
  const [referenceVolumeOffsetDb, setReferenceVolumeOffsetDb] = useState<number>(DEFAULTS.referenceVolumeOffsetDb)
  const [referenceVolumeOscillationEnabled, setReferenceVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.referenceVolumeOscillationEnabled)
  const [allVolumeOscillationEnabled, setAllVolumeOscillationEnabled] = useState<boolean>(DEFAULTS.allVolumeOscillationEnabled)
  const [allVolumeOscillationRateHz, setAllVolumeOscillationRateHz] = useState<number>(DEFAULTS.allVolumeOscillationRateHz)
  const [allVolumeOscillationShape, setAllVolumeOscillationShape] = useState<dotGridAudio.VolumeOscillationShape>(DEFAULTS.allVolumeOscillationShape)
  const [allVolumeOscillationWaveEnabled, setAllVolumeOscillationWaveEnabled] = useState<boolean>(DEFAULTS.allVolumeOscillationWaveEnabled)
  const [allVolumeOscillationWavePhase, setAllVolumeOscillationWavePhase] = useState<number>(DEFAULTS.allVolumeOscillationWavePhase)
  const [selectionVolumeStepDb, setSelectionVolumeStepDb] = useState<number>(DEFAULTS.selectionVolumeStepDb)
  const [continuousNoiseEnabled, setContinuousNoiseEnabled] = useState<boolean>(DEFAULTS.continuousNoiseEnabled)
  const [straightLoudQuietNoiseEnabled, setStraightLoudQuietNoiseEnabled] = useState<boolean>(DEFAULTS.straightLoudQuietNoiseEnabled)
  const [continuousLoudRatio, setContinuousLoudRatio] = useState<number>(DEFAULTS.continuousLoudRatio)
  const [continuousTargetsOnlyEnabled, setContinuousTargetsOnlyEnabled] = useState<boolean>(DEFAULTS.continuousTargetsOnlyEnabled)
  const [continuousTargetsSequentialHoldEnabled, setContinuousTargetsSequentialHoldEnabled] = useState<boolean>(DEFAULTS.continuousTargetsSequentialHoldEnabled)
  const [continuousTwoDotAlternateEnabled, setContinuousTwoDotAlternateEnabled] = useState<boolean>(DEFAULTS.continuousTwoDotAlternateEnabled)
  const [singleLocationTwoDotEnabled, setSingleLocationTwoDotEnabled] = useState<boolean>(DEFAULTS.singleLocationTwoDotEnabled)
  const [continuousLeftRightLoudQuietEnabled, setContinuousLeftRightLoudQuietEnabled] = useState<boolean>(DEFAULTS.continuousLeftRightLoudQuietEnabled)
  const [continuousSequentialEnabled, setContinuousSequentialEnabled] = useState<boolean>(DEFAULTS.continuousSequentialEnabled)
  const [continuousSequentialRowsEnabled, setContinuousSequentialRowsEnabled] = useState<boolean>(DEFAULTS.continuousSequentialRowsEnabled)
  const [continuousVolumeTargetDots, setContinuousVolumeTargetDots] = useState<Set<string>>(new Set())
  const [dotVolumeOffsetsDb, setDotVolumeOffsetsDb] = useState<Map<string, number>>(new Map())
  const [dragNoiseModeEnabled, setDragNoiseModeEnabled] = useState<boolean>(DEFAULTS.dragNoiseModeEnabled)
  const [dragNoiseFormationCount, setDragNoiseFormationCount] = useState<number>(DEFAULTS.dragNoiseFormationCount)
  const [dragNoiseFormationSpread, setDragNoiseFormationSpread] = useState<number>(DEFAULTS.dragNoiseFormationSpread)
  const [dragNoisePoints, setDragNoisePoints] = useState<Array<{ normalizedX: number; normalizedY: number }>>([])
  const dragNoiseSurfaceRef = useRef<HTMLDivElement>(null)
  const dragNoisePointerIdRef = useRef<number | null>(null)
  const dragNoiseCenterRef = useRef<{ normalizedX: number; normalizedY: number } | null>(null)
  const [lineCalibrationEnabled, setLineCalibrationEnabled] = useState<boolean>(DEFAULTS.lineCalibrationEnabled)
  const [lineCenter, setLineCenter] = useState<NormalizedPoint>({
    normalizedX: DEFAULTS.lineCenterX,
    normalizedY: DEFAULTS.lineCenterY,
  })
  const [lineLength, setLineLength] = useState<number>(DEFAULTS.lineLength)
  const [lineAngle, setLineAngle] = useState<number>(DEFAULTS.lineAngle)
  const [lineSquareModeEnabled, setLineSquareModeEnabled] = useState<boolean>(DEFAULTS.lineSquareModeEnabled)
  const [linePathMotionEnabled, setLinePathMotionEnabled] = useState<boolean>(DEFAULTS.linePathMotionEnabled)
  const [lineInverseDotPathEnabled, setLineInverseDotPathEnabled] = useState<boolean>(DEFAULTS.lineInverseDotPathEnabled)
  const [lineStartGainDb, setLineStartGainDb] = useState<number>(DEFAULTS.lineStartGainDb)
  const [lineEndGainDb, setLineEndGainDb] = useState<number>(DEFAULTS.lineEndGainDb)
  const lineCalibrationSurfaceRef = useRef<HTMLDivElement>(null)
  const lineCalibrationDragRef = useRef<LineDragState | null>(null)
  const linePathAnimationFrameRef = useRef<number | null>(null)
  const linePathMarkerRef = useRef<HTMLSpanElement>(null)
  const [rowCompareEnabled, setRowCompareEnabled] = useState<boolean>(DEFAULTS.rowCompareEnabled)
  const [rowCompareRowA, setRowCompareRowA] = useState<number>(DEFAULTS.rowCompareRowA)
  const [rowCompareRowB, setRowCompareRowB] = useState<number>(DEFAULTS.rowCompareRowB)
  const [rowCompareRepeats, setRowCompareRepeats] = useState<number>(DEFAULTS.rowCompareRepeats)
  const [rowCompareVolumeADb, setRowCompareVolumeADb] = useState<number>(DEFAULTS.rowCompareVolumeADb)
  const [rowCompareVolumeBDb, setRowCompareVolumeBDb] = useState<number>(DEFAULTS.rowCompareVolumeBDb)
  const [draggingRowCompareId, setDraggingRowCompareId] = useState<"A" | "B" | null>(null)
  const [referenceVolumeMultiplyCount, setReferenceVolumeMultiplyCount] = useState<number>(DEFAULTS.referenceVolumeMultiplyCount)
  const [positionVolumeEnabled, setPositionVolumeEnabled] = useState<boolean>(DEFAULTS.positionVolumeEnabled)
  const [positionVolumeLeftDb, setPositionVolumeLeftDb] = useState<number>(DEFAULTS.positionVolumeLeftDb)
  const [positionVolumeRightDb, setPositionVolumeRightDb] = useState<number>(DEFAULTS.positionVolumeRightDb)
  const rowCompareOverlayRef = useRef<HTMLDivElement>(null)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const focusedDefaultsMigrated = loadSetting("cabin:focusedClickDefaultsV1", false)
    const hydratedRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, focusedDefaultsMigrated ? loadSetting("cabin:gridRows", DEFAULTS.gridRows) : DEFAULTS.gridRows))
    const hydratedCols = Math.max(MIN_COLS, Math.min(MAX_COLS, focusedDefaultsMigrated ? loadSetting("cabin:gridCols", DEFAULTS.gridCols) : DEFAULTS.gridCols))
    setGridRows(hydratedRows)
    setGridCols(hydratedCols)
    setSpeed(DEFAULTS.speed)
    setAttackMs(loadSetting("cabin:attackMsV2", DEFAULTS.attackMs))
    setReleaseMs(loadSetting("cabin:releaseMsV2", DEFAULTS.releaseMs))
    setHitSpacingMs(loadSetting("cabin:hitSpacingMs", DEFAULTS.hitSpacingMs))
    setPingPongEnabled(loadSetting("cabin:pingPongEnabled", DEFAULTS.pingPongEnabled))
    const masterVolumeDbMigrated = loadSetting("cabin:masterVolumeDbV1", false)
    setVolumeDb(masterVolumeDbMigrated ? loadSetting("cabin:volumeDb", DEFAULTS.volumeDb) : DEFAULTS.volumeDb)
    saveSetting("cabin:masterVolumeDbV1", true)
    saveSetting("cabin:release", DEFAULTS.release)
    setBandwidth(loadSetting("cabin:bandwidth", DEFAULTS.bandwidth))
    setBandwidthFilterMode(DEFAULTS.bandwidthFilterMode)
    setGentleEdgeFalloffDbPerOct(DEFAULTS.gentleEdgeFalloffDbPerOct)
    setSettingsCollapsed(loadSetting("cabin:settingsCollapsed", DEFAULTS.settingsCollapsed))
    setDepth(Math.max(1, Math.min(8, Math.round(loadSetting("cabin:depth", DEFAULTS.depth)))))
    setDepthGapDb(Math.max(0, Math.min(60, loadSetting("cabin:depthGapDbV2", DEFAULTS.depthGapDb))))
    setDotBalanceDb(Math.max(-24, Math.min(24, loadSetting("cabin:dotBalanceDb", DEFAULTS.dotBalanceDb))))
    // Hidden-mode settings are pinned to defaults so the simplified panel
    // always yields plain alternating noise hits, regardless of any modes
    // saved by older builds.
    setLoudQuietBlockSize(DEFAULTS.loudQuietBlockSize)
    setLoudQuietPerDot(DEFAULTS.loudQuietPerDot)
    setThreeLevelVolumeEnabled(DEFAULTS.threeLevelVolumeEnabled)
    setSidePolarityLoudQuietEnabled(DEFAULTS.sidePolarityLoudQuietEnabled)
    setLoudQuietBandwidthModeEnabled(DEFAULTS.loudQuietBandwidthModeEnabled)
    setHalfBandPatternEnabled(DEFAULTS.halfBandPatternEnabled)
    setRowAlternationModeEnabled(DEFAULTS.rowAlternationModeEnabled)
    setRhythmPatternEnabled(DEFAULTS.rhythmPatternEnabled)
    setInverseDotNoiseEnabled(DEFAULTS.inverseDotNoiseEnabled)
    setInverseDotOutsideGapOctaves(Math.max(
      dotGridAudio.MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
      Math.min(
        dotGridAudio.MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
        loadSetting("cabin:inverseDotOutsideGapOctaves", DEFAULTS.inverseDotOutsideGapOctaves)
      )
    ))
    setInverseDotBandBoostDb(Math.max(
      dotGridAudio.MIN_INVERSE_DOT_BAND_BOOST_DB,
      Math.min(
        dotGridAudio.MAX_INVERSE_DOT_BAND_BOOST_DB,
        loadSetting("cabin:inverseDotBandBoostDb", DEFAULTS.inverseDotBandBoostDb)
      )
    ))
    setHitMultiplier(DEFAULTS.hitMultiplier)
    setHitStaggerPercent(DEFAULTS.hitStaggerPercent)
    setWaveWaitSeconds(DEFAULTS.waveWaitSeconds)
    setHiHatQuietDropDb(loadSetting("cabin:hiHatQuietDropDb", DEFAULTS.hiHatQuietDropDb))
    setEqABEnabled(false)
    setFlatSlope(false)
    setNoiseOscillationRateHz(DEFAULTS.noiseOscillationRateHz)
    setNoiseOscillationMinDb(DEFAULTS.noiseOscillationMinDb)
    setNoiseOscillationMaxDb(DEFAULTS.noiseOscillationMaxDb)
    setClickTrainBoostDb(DEFAULTS.clickTrainBoostDb)
    saveSetting("cabin:clickTrainBoostDbV1", true)
    setReferenceVolumeBalance(DEFAULTS.referenceVolumeBalance)
    setReferenceVolumeOffsetDb(DEFAULTS.referenceVolumeOffsetDb)
    setReferenceVolumeOscillationEnabled(false)
    setAllVolumeOscillationEnabled(DEFAULTS.allVolumeOscillationEnabled)
    setAllVolumeOscillationRateHz(DEFAULTS.allVolumeOscillationRateHz)
    setAllVolumeOscillationShape(DEFAULTS.allVolumeOscillationShape)
    setAllVolumeOscillationWaveEnabled(DEFAULTS.allVolumeOscillationWaveEnabled)
    setAllVolumeOscillationWavePhase(DEFAULTS.allVolumeOscillationWavePhase)
    setSelectionVolumeStepDb(clampSelectionVolumeStepDb(loadSetting("cabin:selectionVolumeStepDb", DEFAULTS.selectionVolumeStepDb)))
    setContinuousNoiseEnabled(DEFAULTS.continuousNoiseEnabled)
    setStraightLoudQuietNoiseEnabled(DEFAULTS.straightLoudQuietNoiseEnabled)
    const loudRatioDefaultMigrated = loadSetting("cabin:continuousLoudRatioDefaultV3", false)
    const savedContinuousLoudRatio = loadSetting("cabin:continuousLoudRatio", DEFAULTS.continuousLoudRatio)
    const continuousLoudRatioDefault =
      !loudRatioDefaultMigrated &&
      PRIOR_DEFAULT_CONTINUOUS_LOUD_RATIOS.some((ratio) => Math.abs(savedContinuousLoudRatio - ratio) < 0.001)
        ? DEFAULTS.continuousLoudRatio
        : savedContinuousLoudRatio
    setContinuousLoudRatio(clampContinuousLoudRatio(continuousLoudRatioDefault))
    saveSetting("cabin:continuousLoudRatioDefaultV3", true)
    setContinuousTargetsOnlyEnabled(DEFAULTS.continuousTargetsOnlyEnabled)
    setContinuousTargetsSequentialHoldEnabled(DEFAULTS.continuousTargetsSequentialHoldEnabled)
    setContinuousTwoDotAlternateEnabled(DEFAULTS.continuousTwoDotAlternateEnabled)
    setSingleLocationTwoDotEnabled(DEFAULTS.singleLocationTwoDotEnabled)
    setContinuousLeftRightLoudQuietEnabled(DEFAULTS.continuousLeftRightLoudQuietEnabled)
    setContinuousSequentialEnabled(DEFAULTS.continuousSequentialEnabled)
    setContinuousSequentialRowsEnabled(DEFAULTS.continuousSequentialRowsEnabled)
    setDragNoiseModeEnabled(DEFAULTS.dragNoiseModeEnabled)
    setDragNoiseFormationCount(clampDragNoiseFormationCount(loadSetting("cabin:dragNoiseFormationCount", DEFAULTS.dragNoiseFormationCount)))
    setDragNoiseFormationSpread(clampDragNoiseFormationSpread(loadSetting("cabin:dragNoiseFormationSpread", DEFAULTS.dragNoiseFormationSpread)))
    setLineCalibrationEnabled(DEFAULTS.lineCalibrationEnabled)
    const hydratedLineCenter = {
      normalizedX: clamp01(loadSetting("cabin:lineCenterX", DEFAULTS.lineCenterX)),
      normalizedY: clamp01(loadSetting("cabin:lineCenterY", DEFAULTS.lineCenterY)),
    }
    const hydratedLineAngle = loadSetting("cabin:lineAngle", DEFAULTS.lineAngle)
    const hydratedLineLength = clampLineLengthForCenter(
      hydratedLineCenter,
      loadSetting("cabin:lineLength", DEFAULTS.lineLength),
      hydratedLineAngle
    )
    setLineCenter(clampLineCenter(hydratedLineCenter, hydratedLineLength, hydratedLineAngle))
    setLineLength(hydratedLineLength)
    setLineAngle(hydratedLineAngle)
    setLineSquareModeEnabled(DEFAULTS.lineSquareModeEnabled)
    setLinePathMotionEnabled(DEFAULTS.linePathMotionEnabled)
    setLineInverseDotPathEnabled(DEFAULTS.lineInverseDotPathEnabled)
    setLineStartGainDb(clampLineEndpointGainDb(loadSetting("cabin:lineStartGainDb", DEFAULTS.lineStartGainDb)))
    setLineEndGainDb(clampLineEndpointGainDb(loadSetting("cabin:lineEndGainDb", DEFAULTS.lineEndGainDb)))
    setRowCompareEnabled(DEFAULTS.rowCompareEnabled)
    setRowCompareRowA(clampRowIndex(loadSetting("cabin:rowCompareRowA", getDefaultCompareRowA(hydratedRows)), hydratedRows))
    setRowCompareRowB(clampRowIndex(loadSetting("cabin:rowCompareRowB", getDefaultCompareRowB(hydratedRows)), hydratedRows))
    setRowCompareRepeats(clampRowCompareRepeats(loadSetting("cabin:rowCompareRepeats", DEFAULTS.rowCompareRepeats)))
    setRowCompareVolumeADb(clampRowCompareVolumeDb(loadSetting("cabin:rowCompareVolumeADb", DEFAULTS.rowCompareVolumeADb)))
    setRowCompareVolumeBDb(clampRowCompareVolumeDb(loadSetting("cabin:rowCompareVolumeBDb", DEFAULTS.rowCompareVolumeBDb)))
    setReferenceVolumeMultiplyCount(DEFAULTS.referenceVolumeMultiplyCount)
    setPositionVolumeEnabled(DEFAULTS.positionVolumeEnabled)
    setPositionVolumeLeftDb(clampPositionVolumeDb(loadSetting("cabin:positionVolumeLeftDb", DEFAULTS.positionVolumeLeftDb)))
    setPositionVolumeRightDb(clampPositionVolumeDb(loadSetting("cabin:positionVolumeRightDb", DEFAULTS.positionVolumeRightDb)))
    const savedDotVolumeOffsets = loadSetting<unknown>("cabin:dotVolumeOffsetsDb", [])
    const hydratedDotVolumeOffsets = new Map<string, number>()
    if (Array.isArray(savedDotVolumeOffsets)) {
      savedDotVolumeOffsets.forEach((entry) => {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number") return
        if (!isDotKeyInGrid(entry[0], hydratedRows, hydratedCols)) return

        const volumeDb = clampDotVolumeDb(entry[1])
        if (Math.abs(volumeDb) >= 0.001) hydratedDotVolumeOffsets.set(entry[0], volumeDb)
      })
    }
    setDotVolumeOffsetsDb(hydratedDotVolumeOffsets)
    saveSetting("cabin:focusedClickDefaultsV1", true)
  }, [])
  const [hoveredDot, setHoveredDot] = useState<string | null>(null)
  const [sequencerVisual, setSequencerVisual] = useState<{ playingDotKey: string | null; beatIndex: number }>({
    playingDotKey: null,
    beatIndex: 0,
  })
  const { setEQEnabled } = useEQProfileStore()

  const emptyVisibleDots = useMemo(() => new Set<string>(), [])
  const blindRandomDots = useMemo(() => {
    const next = new Set<string>()
    if (blindRandomModeEnabled && blindRandomDotKey) next.add(blindRandomDotKey)
    return next
  }, [blindRandomDotKey, blindRandomModeEnabled])
  const rowCompareRowADotKeys = useMemo(() => getRowDotKeys(rowCompareRowA, gridCols), [rowCompareRowA, gridCols])
  const rowCompareRowBDotKeys = useMemo(() => getRowDotKeys(rowCompareRowB, gridCols), [rowCompareRowB, gridCols])
  const rowCompareDots = useMemo(() => {
    const next = new Set<string>()
    rowCompareRowADotKeys.forEach((dotKey) => next.add(dotKey))
    rowCompareRowBDotKeys.forEach((dotKey) => next.add(dotKey))
    return next
  }, [rowCompareRowADotKeys, rowCompareRowBDotKeys])
  const visibleSelectedDots = lineCalibrationEnabled ? emptyVisibleDots : rowCompareEnabled ? rowCompareDots : blindRandomModeEnabled ? emptyVisibleDots : selectedDots
  const activeSelectedDots = lineCalibrationEnabled || dragNoiseModeEnabled ? emptyVisibleDots : rowCompareEnabled ? rowCompareDots : blindRandomModeEnabled ? blindRandomDots : selectedDots
  const hasSelectedDots = activeSelectedDots.size > 0
  const activeGridRows = gridRows
  const activeGridCols = gridCols
  const activeReferenceDotKey = null
  const hasActiveDots = activeSelectedDots.size > 0
  const squareLineGeometry = useMemo(
    () => lineSquareModeEnabled ? getSquareLineEndpoints(lineCenter, lineLength) : null,
    [lineCenter, lineLength, lineSquareModeEnabled]
  )
  const lineCalibrationEndpoints = useMemo(
    () => squareLineGeometry?.primary ?? getLineEndpoints(lineCenter, lineLength, lineAngle),
    [lineAngle, lineCenter, lineLength, squareLineGeometry]
  )
  const lineCalibrationCopyEndpoints = squareLineGeometry?.copy ?? null
  const lineVisual = useMemo(() => {
    const primary = getLineSegmentVisual(lineCalibrationEndpoints)
    const copy = lineCalibrationCopyEndpoints === null
      ? null
      : getLineSegmentVisual(lineCalibrationCopyEndpoints)
    const center = squareLineGeometry?.center ?? {
      normalizedX: (primary.start.normalizedX + primary.end.normalizedX) / 2,
      normalizedY: (primary.start.normalizedY + primary.end.normalizedY) / 2,
    }

    return {
      ...primary,
      copy,
      centerLeft: center.normalizedX * 100,
      centerTop: (1 - center.normalizedY) * 100,
    }
  }, [lineCalibrationCopyEndpoints, lineCalibrationEndpoints, squareLineGeometry])
  const linePathEndpointsRef = useRef<LineEndpoints>(lineCalibrationEndpoints)
  const linePathPassSeconds = useMemo(
    () => getLinePathPassSeconds(lineLength, speedToPerHitSeconds(speed)),
    [lineLength, speed]
  )
  const linePathPassSecondsRef = useRef<number>(linePathPassSeconds)
  const lineEndpointGainDbRef = useRef<[number, number]>([lineStartGainDb, lineEndGainDb])
  linePathEndpointsRef.current = lineCalibrationEndpoints
  linePathPassSecondsRef.current = linePathPassSeconds
  lineEndpointGainDbRef.current = [lineStartGainDb, lineEndGainDb]
  const lineEndpointGainMultipliers = useMemo<[number, number]>(() => [
    dbToLinearGain(lineStartGainDb),
    dbToLinearGain(lineEndGainDb),
  ], [lineEndGainDb, lineStartGainDb])

  // Pulsing invite dot — center of grid, shown until user taps a dot this session
  const hasEverSelected = useRef(false)
  if (hasActiveDots) hasEverSelected.current = true
  const inviteDotKey = !lineCalibrationEnabled && !dragNoiseModeEnabled && !blindRandomModeEnabled && !hasEverSelected.current
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
      const BOTTOM_LOWER_EDGE_HZ = 30
      const MAX_AUDIBLE = 20000
      const effectiveBandwidth = dotGridAudio.getEffectiveBandpassBandwidth(bandwidth, bandwidthFilterMode)
      const topUpperEdge = MAX_AUDIBLE
      const topLowerEdge = topUpperEdge / Math.pow(2, effectiveBandwidth)
      const bottomLowerEdge = BOTTOM_LOWER_EDGE_HZ
      const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, normalizedY)
      const upperEdge = lowerEdge * Math.pow(2, effectiveBandwidth)
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
  }, [activeBand, gridRows, gridCols, bandwidth, bandwidthFilterMode])

  // Persist settings to localStorage
  useEffect(() => { saveSetting("cabin:gridRows", gridRows) }, [gridRows])
  useEffect(() => { saveSetting("cabin:gridCols", gridCols) }, [gridCols])
  useEffect(() => { saveSetting("cabin:freeformModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:freeformDots", []) }, [])
  useEffect(() => { saveSetting("cabin:speed", speed) }, [speed])
  useEffect(() => { saveSetting("cabin:volumeDb", volumeDb) }, [volumeDb])
  useEffect(() => { saveSetting("cabin:settingsCollapsed", settingsCollapsed) }, [settingsCollapsed])
  useEffect(() => { saveSetting("cabin:release", DEFAULTS.release) }, [])
  useEffect(() => { saveSetting("cabin:releaseAuto", true) }, [])
  useEffect(() => { saveSetting("cabin:releaseAutoOffsetMs", 0) }, [])
  useEffect(() => { saveSetting("cabin:bandwidth", bandwidth) }, [bandwidth])
  useEffect(() => { saveSetting("cabin:bandwidthFilterMode", bandwidthFilterMode) }, [bandwidthFilterMode])
  useEffect(() => { saveSetting("cabin:gentleEdgeFalloffDbPerOct", gentleEdgeFalloffDbPerOct) }, [gentleEdgeFalloffDbPerOct])
  useEffect(() => { saveSetting("cabin:bandwidthOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:depth", depth) }, [depth])
  useEffect(() => { saveSetting("cabin:hiHatModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:patternModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:patternAccentEvery", DEFAULTS.patternAccentEvery) }, [])
  useEffect(() => { saveSetting("cabin:patternVolumeDiffDb", DEFAULTS.patternVolumeDiffDb) }, [])
  useEffect(() => { saveSetting("cabin:fourFourHitModeEnabled", DEFAULTS.fourFourHitModeEnabled) }, [])
  useEffect(() => { saveSetting("cabin:loudQuietBlockSize", loudQuietBlockSize) }, [loudQuietBlockSize])
  useEffect(() => { saveSetting("cabin:loudQuietPerDot", loudQuietPerDot) }, [loudQuietPerDot])
  useEffect(() => { saveSetting("cabin:threeLevelVolumeEnabled", threeLevelVolumeEnabled) }, [threeLevelVolumeEnabled])
  useEffect(() => { saveSetting("cabin:sidePolarityLoudQuietEnabled", sidePolarityLoudQuietEnabled) }, [sidePolarityLoudQuietEnabled])
  useEffect(() => { saveSetting("cabin:loudQuietBandwidthModeEnabled", loudQuietBandwidthModeEnabled) }, [loudQuietBandwidthModeEnabled])
  useEffect(() => { saveSetting("cabin:halfBandPatternEnabled", halfBandPatternEnabled) }, [halfBandPatternEnabled])
  useEffect(() => { saveSetting("cabin:rowAlternationModeEnabled", rowAlternationModeEnabled) }, [rowAlternationModeEnabled])
  useEffect(() => { saveSetting("cabin:rhythmPatternEnabled", rhythmPatternEnabled) }, [rhythmPatternEnabled])
  useEffect(() => { saveSetting("cabin:inverseDotNoiseEnabled", inverseDotNoiseEnabled) }, [inverseDotNoiseEnabled])
  useEffect(() => { saveSetting("cabin:inverseDotOutsideGapOctaves", inverseDotOutsideGapOctaves) }, [inverseDotOutsideGapOctaves])
  useEffect(() => { saveSetting("cabin:inverseDotBandBoostDb", inverseDotBandBoostDb) }, [inverseDotBandBoostDb])
  useEffect(() => { saveSetting("cabin:hitMultiplier", hitMultiplier) }, [hitMultiplier])
  useEffect(() => { saveSetting("cabin:hitStaggerPercent", hitStaggerPercent) }, [hitStaggerPercent])
  useEffect(() => { saveSetting("cabin:waveWaitSeconds", waveWaitSeconds) }, [waveWaitSeconds])
  useEffect(() => { saveSetting("cabin:experimentalModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:snareScoopEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:snareScoopDepthDb", DEFAULTS.snareScoopDepthDb) }, [])
  useEffect(() => { saveSetting("cabin:snareScoopMode", DEFAULTS.snareScoopMode) }, [])
  useEffect(() => { saveSetting("cabin:snareScoopBandwidthOctaves", DEFAULTS.snareScoopBandwidthOctaves) }, [])
  useEffect(() => { saveSetting("cabin:tiltOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:tiltOscillationDbPerOct", DEFAULTS.tiltOscillationAmount) }, [])
  useEffect(() => { saveSetting("cabin:reverbModeEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:reverbVolumeSpreadDb", DEFAULTS.reverbVolumeSpreadDb) }, [])
  useEffect(() => { saveSetting("cabin:hiHatQuietDropDb", hiHatQuietDropDb) }, [hiHatQuietDropDb])
  useEffect(() => { saveSetting("cabin:hiHatLoudReleaseBoostMs", FIXED_ACCENT_RELEASE_MS) }, [])
  useEffect(() => { saveSetting("cabin:repeatCount", 1) }, [])
  useEffect(() => { saveSetting("cabin:depthGapDbV2", depthGapDb) }, [depthGapDb])
  useEffect(() => { saveSetting("cabin:dotBalanceDb", dotBalanceDb) }, [dotBalanceDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setDotBalanceDb(dotBalanceDb)
  }, [dotBalanceDb])
  useEffect(() => { saveSetting("cabin:eqABEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:flatSlope", false) }, [])
  useEffect(() => { saveSetting("cabin:additivePartialsEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:clickTrainEnabled", true) }, [])
  useEffect(() => { saveSetting("cabin:sineBurstEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:noiseGeneratorEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:noiseOscillationRateHz", DEFAULTS.noiseOscillationRateHz) }, [])
  useEffect(() => { saveSetting("cabin:noiseOscillationMinDb", DEFAULTS.noiseOscillationMinDb) }, [])
  useEffect(() => { saveSetting("cabin:noiseOscillationMaxDb", DEFAULTS.noiseOscillationMaxDb) }, [])
  useEffect(() => { saveSetting("cabin:clickTrainBoostDb", DEFAULTS.clickTrainBoostDb) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeBalance", DEFAULTS.referenceVolumeBalance) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeOffsetDb", DEFAULTS.referenceVolumeOffsetDb) }, [])
  useEffect(() => { saveSetting("cabin:referenceVolumeOscillationEnabled", false) }, [])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationEnabled", allVolumeOscillationEnabled) }, [allVolumeOscillationEnabled])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationRateHz", allVolumeOscillationRateHz) }, [allVolumeOscillationRateHz])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationShape", allVolumeOscillationShape) }, [allVolumeOscillationShape])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationWaveEnabled", allVolumeOscillationWaveEnabled) }, [allVolumeOscillationWaveEnabled])
  useEffect(() => { saveSetting("cabin:allVolumeOscillationWavePhase", allVolumeOscillationWavePhase) }, [allVolumeOscillationWavePhase])
  useEffect(() => { saveSetting("cabin:selectionVolumeStepDb", selectionVolumeStepDb) }, [selectionVolumeStepDb])
  useEffect(() => { saveSetting("cabin:continuousNoiseEnabled", continuousNoiseEnabled) }, [continuousNoiseEnabled])
  useEffect(() => { saveSetting("cabin:straightLoudQuietNoiseEnabled", straightLoudQuietNoiseEnabled) }, [straightLoudQuietNoiseEnabled])
  useEffect(() => { saveSetting("cabin:continuousLoudRatio", continuousLoudRatio) }, [continuousLoudRatio])
  useEffect(() => { saveSetting("cabin:continuousTargetsOnlyEnabled", continuousTargetsOnlyEnabled) }, [continuousTargetsOnlyEnabled])
  useEffect(() => { saveSetting("cabin:continuousTargetsSequentialHoldEnabled", continuousTargetsSequentialHoldEnabled) }, [continuousTargetsSequentialHoldEnabled])
  useEffect(() => { saveSetting("cabin:continuousTwoDotAlternateEnabled", continuousTwoDotAlternateEnabled) }, [continuousTwoDotAlternateEnabled])
  useEffect(() => { saveSetting("cabin:singleLocationTwoDotEnabled", singleLocationTwoDotEnabled) }, [singleLocationTwoDotEnabled])
  useEffect(() => { saveSetting("cabin:continuousLeftRightLoudQuietEnabled", continuousLeftRightLoudQuietEnabled) }, [continuousLeftRightLoudQuietEnabled])
  useEffect(() => { saveSetting("cabin:continuousSequentialEnabled", continuousSequentialEnabled) }, [continuousSequentialEnabled])
  useEffect(() => { saveSetting("cabin:continuousSequentialRowsEnabled", continuousSequentialRowsEnabled) }, [continuousSequentialRowsEnabled])
  useEffect(() => { saveSetting("cabin:dragNoiseModeEnabled", dragNoiseModeEnabled) }, [dragNoiseModeEnabled])
  useEffect(() => { saveSetting("cabin:dragNoiseFormationCount", dragNoiseFormationCount) }, [dragNoiseFormationCount])
  useEffect(() => { saveSetting("cabin:dragNoiseFormationSpread", dragNoiseFormationSpread) }, [dragNoiseFormationSpread])
  useEffect(() => { saveSetting("cabin:lineCalibrationEnabled", lineCalibrationEnabled) }, [lineCalibrationEnabled])
  useEffect(() => { saveSetting("cabin:lineCenterX", lineCenter.normalizedX) }, [lineCenter.normalizedX])
  useEffect(() => { saveSetting("cabin:lineCenterY", lineCenter.normalizedY) }, [lineCenter.normalizedY])
  useEffect(() => { saveSetting("cabin:lineLength", lineLength) }, [lineLength])
  useEffect(() => { saveSetting("cabin:lineAngle", lineAngle) }, [lineAngle])
  useEffect(() => { saveSetting("cabin:lineSquareModeEnabled", lineSquareModeEnabled) }, [lineSquareModeEnabled])
  useEffect(() => { saveSetting("cabin:linePathMotionEnabled", linePathMotionEnabled) }, [linePathMotionEnabled])
  useEffect(() => { saveSetting("cabin:lineInverseDotPathEnabled", lineInverseDotPathEnabled) }, [lineInverseDotPathEnabled])
  useEffect(() => { saveSetting("cabin:lineStartGainDb", lineStartGainDb) }, [lineStartGainDb])
  useEffect(() => { saveSetting("cabin:lineEndGainDb", lineEndGainDb) }, [lineEndGainDb])
  useEffect(() => { saveSetting("cabin:rowCompareEnabled", rowCompareEnabled) }, [rowCompareEnabled])
  useEffect(() => { saveSetting("cabin:rowCompareRowA", rowCompareRowA) }, [rowCompareRowA])
  useEffect(() => { saveSetting("cabin:rowCompareRowB", rowCompareRowB) }, [rowCompareRowB])
  useEffect(() => { saveSetting("cabin:rowCompareRepeats", rowCompareRepeats) }, [rowCompareRepeats])
  useEffect(() => { saveSetting("cabin:rowCompareVolumeADb", rowCompareVolumeADb) }, [rowCompareVolumeADb])
  useEffect(() => { saveSetting("cabin:rowCompareVolumeBDb", rowCompareVolumeBDb) }, [rowCompareVolumeBDb])
  useEffect(() => { saveSetting("cabin:referenceVolumeMultiplyCount", DEFAULTS.referenceVolumeMultiplyCount) }, [])
  useEffect(() => { saveSetting("cabin:positionVolumeEnabled", positionVolumeEnabled) }, [positionVolumeEnabled])
  useEffect(() => { saveSetting("cabin:positionVolumeLeftDb", positionVolumeLeftDb) }, [positionVolumeLeftDb])
  useEffect(() => { saveSetting("cabin:positionVolumeRightDb", positionVolumeRightDb) }, [positionVolumeRightDb])
  useEffect(() => { saveSetting("cabin:dotVolumeOffsetsDb", Array.from(dotVolumeOffsetsDb.entries())) }, [dotVolumeOffsetsDb])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()

    player.clearDotNormalizedPositions()
    player.clearDotBandpassBandwidths()
    player.setLoopSequencerEnabled(true)
    player.setLoopSequencerPlayTogether(false)
    player.setInterleavedHits(false)
    player.setVolumeLevelRangeDb(0)
    player.setSubHitPlaybackEnabled(false)
    player.setHitModeAttack(HIT_ATTACK_S)

    player.setPerCycleVolumeEnabled(false)
    player.setPerDotVolumeWaveEnabled(false)
    player.setAutoVolumeCycleEnabled(false)
    player.setClickTrainDurationGateEnabled(false)

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
    setContinuousVolumeTargetDots((prev) => {
      const next = new Set<string>()
      prev.forEach((dotKey) => {
        if (isDotKeyInGrid(dotKey, gridRows, gridCols)) next.add(dotKey)
      })
      return next
    })
  }, [gridRows, gridCols])

  useEffect(() => {
    setDotVolumeOffsetsDb((prev) => {
      let changed = false
      const next = new Map<string, number>()

      prev.forEach((volumeDb, dotKey) => {
        if (isDotKeyInGrid(dotKey, gridRows, gridCols)) {
          next.set(dotKey, volumeDb)
        } else {
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [gridRows, gridCols])

  useEffect(() => {
    if (!blindRandomModeEnabled) return
    setBlindRandomDotKey((prev) => (
      isDotKeyInGrid(prev, gridRows, gridCols) ? prev : getRandomDotKey(gridRows, gridCols, prev)
    ))
  }, [blindRandomModeEnabled, gridRows, gridCols])

  useEffect(() => {
    setRowCompareRowA((prev) => clampRowIndex(prev, gridRows))
    setRowCompareRowB((prev) => clampRowIndex(prev, gridRows))
  }, [gridRows])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setRowCompareEnabled(rowCompareEnabled)
    player.setRowCompareRows(rowCompareRowADotKeys, rowCompareRowBDotKeys)
    player.setRowCompareRepeats(rowCompareRepeats)
    player.setRowCompareVolumesDb(rowCompareVolumeADb, rowCompareVolumeBDb)
  }, [rowCompareEnabled, rowCompareRowADotKeys, rowCompareRowBDotKeys, rowCompareRepeats, rowCompareVolumeADb, rowCompareVolumeBDb])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    const continuousHoldLoopNoiseEnabled =
      continuousNoiseEnabled &&
      continuousTargetsSequentialHoldEnabled &&
      !dragNoiseModeEnabled &&
      !lineCalibrationEnabled
    const continuousModeEnabled =
      (continuousNoiseEnabled && !continuousHoldLoopNoiseEnabled) ||
      dragNoiseModeEnabled ||
      lineCalibrationEnabled
    const lineInverseDotPathActive =
      lineCalibrationEnabled && linePathMotionEnabled && lineInverseDotPathEnabled
    const halfBandLoopNoiseEnabled = halfBandPatternEnabled && !continuousModeEnabled
    const rowAlternationLoopNoiseEnabled = rowAlternationModeEnabled && !continuousModeEnabled
    const heldLoopNoiseEnabled =
      straightLoudQuietNoiseEnabled &&
      !continuousModeEnabled &&
      !threeLevelVolumeEnabled &&
      !halfBandPatternEnabled &&
      !rowAlternationModeEnabled &&
      !inverseDotNoiseEnabled
    const inverseDotLoopNoiseEnabled =
      inverseDotNoiseEnabled &&
      !continuousModeEnabled &&
      !halfBandLoopNoiseEnabled &&
      !rowAlternationLoopNoiseEnabled &&
      !heldLoopNoiseEnabled
    player.setContinuousNoiseModeEnabled(
      continuousModeEnabled,
      heldLoopNoiseEnabled || halfBandLoopNoiseEnabled || rowAlternationLoopNoiseEnabled || inverseDotLoopNoiseEnabled || continuousHoldLoopNoiseEnabled,
      inverseDotLoopNoiseEnabled ? dotGridAudio.SoundMode.InverseDotNoise : dotGridAudio.SoundMode.BandpassedNoise,
      lineInverseDotPathActive ? dotGridAudio.SoundMode.InverseDotNoise : dotGridAudio.SoundMode.BandpassedNoise
    )
    player.setFourFourStraightNoiseEnabled(heldLoopNoiseEnabled)
  }, [continuousNoiseEnabled, continuousTargetsSequentialHoldEnabled, dragNoiseModeEnabled, halfBandPatternEnabled, inverseDotNoiseEnabled, lineCalibrationEnabled, lineInverseDotPathEnabled, linePathMotionEnabled, rowAlternationModeEnabled, straightLoudQuietNoiseEnabled, threeLevelVolumeEnabled])

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
    dotGridAudio.getDotGridAudioPlayer().setInverseConstantNoiseDots(
      inverseDotNoiseEnabled ? inverseConstantNoiseDots : new Set()
    )
  }, [inverseConstantNoiseDots, inverseDotNoiseEnabled])

  useEffect(() => {
    if (!lineCalibrationEnabled) return

    setContinuousNoiseEnabled(true)
    setContinuousTargetsOnlyEnabled(false)
    setContinuousTwoDotAlternateEnabled(false)
    setSingleLocationTwoDotEnabled(false)
    setContinuousLeftRightLoudQuietEnabled(false)
    setContinuousSequentialEnabled(false)
    setContinuousSequentialRowsEnabled(false)
    setAllVolumeOscillationEnabled(true)
    setAllVolumeOscillationRateHz(LINE_FIRST_VOLUME_OSCILLATION_RATE_HZ)
    setSelectionVolumeStepDb(0)
  }, [lineCalibrationEnabled])

  useEffect(() => {
    if (!lineSquareModeEnabled) return
    setLineAngle(LINE_SQUARE_ANGLE_RAD)
  }, [lineSquareModeEnabled])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    if (!lineCalibrationEnabled || linePathMotionEnabled || isSongPlaying || isPlaying) {
      player.stopLineCalibration()
      return
    }

    void resumeAudioContext()

    return () => {
      player.stopLineCalibration()
    }
  }, [lineCalibrationEnabled, linePathMotionEnabled, isSongPlaying, isPlaying])

  useEffect(() => {
    if (!lineCalibrationEnabled || linePathMotionEnabled || isSongPlaying || isPlaying) return
    dotGridAudio.getDotGridAudioPlayer().updateLineCalibration(
      lineCalibrationEndpoints,
      lineCalibrationCopyEndpoints,
      lineEndpointGainMultipliers
    )
  }, [lineCalibrationEnabled, linePathMotionEnabled, isSongPlaying, isPlaying, lineCalibrationCopyEndpoints, lineCalibrationEndpoints, lineEndpointGainMultipliers])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    if (linePathAnimationFrameRef.current !== null) {
      cancelAnimationFrame(linePathAnimationFrameRef.current)
      linePathAnimationFrameRef.current = null
    }

    if (!lineCalibrationEnabled || !linePathMotionEnabled || isSongPlaying || isPlaying) {
      player.stopLinePathPoint()
      return
    }

    player.stopLineCalibration()
    player.setContinuousNoiseModeEnabled(
      true,
      false,
      dotGridAudio.SoundMode.BandpassedNoise,
      lineInverseDotPathEnabled ? dotGridAudio.SoundMode.InverseDotNoise : dotGridAudio.SoundMode.BandpassedNoise
    )
    void resumeAudioContext()

    const startedAt = performance.now()
    const tick = (now: number) => {
      const passSeconds = linePathPassSecondsRef.current
      const phase = ((now - startedAt) / 1000 / passSeconds) % 2
      const t = phase <= 1 ? phase : 2 - phase
      const [start, end] = linePathEndpointsRef.current
      const point = {
        normalizedX: start.normalizedX + (end.normalizedX - start.normalizedX) * t,
        normalizedY: start.normalizedY + (end.normalizedY - start.normalizedY) * t,
      }
      const [startGainDb, endGainDb] = lineEndpointGainDbRef.current
      const pathGain = 0.8 * dbToLinearGain(startGainDb + (endGainDb - startGainDb) * t)

      const marker = linePathMarkerRef.current
      if (marker) {
        marker.style.left = `${point.normalizedX * 100}%`
        marker.style.top = `${(1 - point.normalizedY) * 100}%`
      }

      player.updateLinePathPoint(point, pathGain, lineInverseDotPathEnabled)
      linePathAnimationFrameRef.current = requestAnimationFrame(tick)
    }

    tick(startedAt)

    return () => {
      if (linePathAnimationFrameRef.current !== null) {
        cancelAnimationFrame(linePathAnimationFrameRef.current)
        linePathAnimationFrameRef.current = null
      }
      player.stopLinePathPoint()
    }
  }, [lineCalibrationEnabled, lineInverseDotPathEnabled, linePathMotionEnabled, isSongPlaying, isPlaying])

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
    dotGridAudio.getDotGridAudioPlayer().setAllVolumeOscillationRateHz(allVolumeOscillationRateHz)
  }, [allVolumeOscillationRateHz])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setAllVolumeOscillationShape(allVolumeOscillationShape)
  }, [allVolumeOscillationShape])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setAllVolumeOscillationWaveEnabled(allVolumeOscillationWaveEnabled)
  }, [allVolumeOscillationWaveEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setAllVolumeOscillationWavePhaseShift(allVolumeOscillationWavePhase)
  }, [allVolumeOscillationWavePhase])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setSelectionVolumeStepDb(selectionVolumeStepDb)
  }, [selectionVolumeStepDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setReferenceVolumeMultiplyCount(referenceVolumeMultiplyCount)
  }, [referenceVolumeMultiplyCount])

  // Speed controls envelope length and the old no-overlap hit slot.
  // Stagger independently packs consecutive hits inside that timing.
  const dotCount = activeSelectedDots.size
  // Hit spacing directly sets the grid interval between consecutive hits;
  // envelopes longer than the spacing simply overlap (polyphonic voices).
  const perHitS = useMemo(() => Math.max(0.02, hitSpacingMs / 1000), [hitSpacingMs])
  const hitStaggerS = useMemo(() => perHitS * (hitStaggerPercent / 100), [perHitS, hitStaggerPercent])
  const effectiveRelease = useMemo(
    () => Math.max(0.001, releaseMs / 1000),
    [releaseMs]
  )

  const handleRowCompareEnabledChange = useCallback((enabled: boolean) => {
    setRowCompareEnabled(enabled)
    if (enabled) {
      setDragNoiseModeEnabled(false)
      setLineCalibrationEnabled(false)
      setBlindRandomModeEnabled(false)
      setBlindRandomDotKey(null)
      void resumeAudioContext()
    }
  }, [])

  const handleDragNoiseModeChange = useCallback((enabled: boolean) => {
    setDragNoiseModeEnabled(enabled)
    if (enabled) {
      setRowCompareEnabled(false)
      setLineCalibrationEnabled(false)
      setBlindRandomModeEnabled(false)
      setInverseDotNoiseEnabled(false)
      setBlindRandomDotKey(null)
      void resumeAudioContext()
    }
  }, [])

  const handleLineCalibrationEnabledChange = useCallback((enabled: boolean) => {
    setLineCalibrationEnabled(enabled)
    if (enabled) {
      setDragNoiseModeEnabled(false)
      setRowCompareEnabled(false)
      setBlindRandomModeEnabled(false)
      setInverseDotNoiseEnabled(false)
      setBlindRandomDotKey(null)
      setContinuousNoiseEnabled(true)
      setContinuousTargetsOnlyEnabled(false)
      setContinuousTwoDotAlternateEnabled(false)
      setSingleLocationTwoDotEnabled(false)
      setContinuousLeftRightLoudQuietEnabled(false)
      setContinuousSequentialEnabled(false)
      setContinuousSequentialRowsEnabled(false)
      setAllVolumeOscillationEnabled(true)
      setAllVolumeOscillationRateHz(LINE_FIRST_VOLUME_OSCILLATION_RATE_HZ)
      setSelectionVolumeStepDb(0)
      void resumeAudioContext()
    }
  }, [])

  const handleLinePathMotionEnabledChange = useCallback((enabled: boolean) => {
    setLinePathMotionEnabled(enabled)
    if (!enabled) {
      setLineInverseDotPathEnabled(false)
      return
    }

    setContinuousNoiseEnabled(true)
    setContinuousTargetsOnlyEnabled(false)
    setContinuousTwoDotAlternateEnabled(false)
    setSingleLocationTwoDotEnabled(false)
    setContinuousLeftRightLoudQuietEnabled(false)
    setContinuousSequentialEnabled(false)
    setContinuousSequentialRowsEnabled(false)
    void resumeAudioContext()
  }, [])

  const handleLineInverseDotPathEnabledChange = useCallback((enabled: boolean) => {
    setLineInverseDotPathEnabled(enabled)
    if (!enabled) return

    setLinePathMotionEnabled(true)
    setContinuousNoiseEnabled(true)
    setContinuousTargetsOnlyEnabled(false)
    setContinuousTwoDotAlternateEnabled(false)
    setSingleLocationTwoDotEnabled(false)
    setContinuousLeftRightLoudQuietEnabled(false)
    setContinuousSequentialEnabled(false)
    setContinuousSequentialRowsEnabled(false)
    setInverseDotNoiseEnabled(false)
    void resumeAudioContext()
  }, [])

  const handleLineSquareModeEnabledChange = useCallback((enabled: boolean) => {
    setLineSquareModeEnabled(enabled)
    if (!enabled) return

    setLineAngle(LINE_SQUARE_ANGLE_RAD)
    setLineLength((prevLength) => {
      const nextLength = clampSquareLineLengthForCenter(lineCenter, prevLength)
      setLineCenter((prevCenter) => clampSquareLineCenter(prevCenter, nextLength))
      return nextLength
    })
  }, [lineCenter])

  const updateRowCompareFromPointer = useCallback((event: PointerEvent<HTMLElement>, rowId: "A" | "B") => {
    const rect = rowCompareOverlayRef.current?.getBoundingClientRect()
    if (!rect || rect.height <= 0) return
    const normalizedY = 1 - (event.clientY - rect.top) / rect.height
    const nextRow = clampRowIndex(normalizedY * Math.max(0, gridRows - 1), gridRows)
    if (rowId === "A") {
      setRowCompareRowA(nextRow)
    } else {
      setRowCompareRowB(nextRow)
    }
  }, [gridRows])

  const handleRowComparePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>, rowId: "A" | "B") => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingRowCompareId(rowId)
    onDragStateChange?.(true)
    updateRowCompareFromPointer(event, rowId)
  }, [onDragStateChange, updateRowCompareFromPointer])

  const handleRowComparePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>, rowId: "A" | "B") => {
    if (draggingRowCompareId !== rowId) return
    event.preventDefault()
    event.stopPropagation()
    updateRowCompareFromPointer(event, rowId)
  }, [draggingRowCompareId, updateRowCompareFromPointer])

  const handleRowComparePointerEnd = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDraggingRowCompareId(null)
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const handleBandwidthFilterModeChange = useCallback((mode: dotGridAudio.BandwidthFilterMode) => {
    setBandwidthFilterMode(mode)
    if (mode === "narrow-gentle") {
      setBandwidth((prev) => (
        Math.abs(prev - DEFAULT_WIDE_BANDWIDTH) < 0.001 ? DEFAULT_GENTLE_BANDWIDTH : prev
      ))
    }
  }, [])

  const handleHalfBandPatternEnabledChange = useCallback((enabled: boolean) => {
    setHalfBandPatternEnabled(enabled)
    if (!enabled) return

    setContinuousNoiseEnabled(false)
    setStraightLoudQuietNoiseEnabled(false)
    setRowAlternationModeEnabled(false)
    setRhythmPatternEnabled(false)
    setInverseDotNoiseEnabled(false)
    setThreeLevelVolumeEnabled(false)
    setLoudQuietBandwidthModeEnabled(false)
  }, [])

  const handleRowAlternationModeEnabledChange = useCallback((enabled: boolean) => {
    setRowAlternationModeEnabled(enabled)
    if (!enabled) return

    setContinuousNoiseEnabled(false)
    setStraightLoudQuietNoiseEnabled(false)
    setHalfBandPatternEnabled(false)
    setRhythmPatternEnabled(false)
    setInverseDotNoiseEnabled(false)
    setThreeLevelVolumeEnabled(false)
    setLoudQuietBandwidthModeEnabled(false)
  }, [])

  const handleRhythmPatternEnabledChange = useCallback((enabled: boolean) => {
    setRhythmPatternEnabled(enabled)
    if (!enabled) return

    setContinuousNoiseEnabled(false)
    setStraightLoudQuietNoiseEnabled(false)
    setHalfBandPatternEnabled(false)
    setRowAlternationModeEnabled(false)
    setThreeLevelVolumeEnabled(false)
    setLoudQuietBandwidthModeEnabled(false)
  }, [])

  const handleInverseDotNoiseEnabledChange = useCallback((enabled: boolean) => {
    setInverseDotNoiseEnabled(enabled)
    if (!enabled) return

    setContinuousNoiseEnabled(false)
    setStraightLoudQuietNoiseEnabled(false)
    setHalfBandPatternEnabled(false)
    setRowAlternationModeEnabled(false)
  }, [])

  const handleThreeLevelVolumeEnabledChange = useCallback((enabled: boolean) => {
    setThreeLevelVolumeEnabled(enabled)
    if (enabled) {
      setHalfBandPatternEnabled(false)
      setRowAlternationModeEnabled(false)
      setRhythmPatternEnabled(false)
    }
  }, [])

  const handleLoudQuietBandwidthModeEnabledChange = useCallback((enabled: boolean) => {
    setLoudQuietBandwidthModeEnabled(enabled)
    if (enabled) {
      setHalfBandPatternEnabled(false)
      setRowAlternationModeEnabled(false)
      setRhythmPatternEnabled(false)
    }
  }, [])

  const handleContinuousNoiseEnabledChange = useCallback((enabled: boolean) => {
    setContinuousNoiseEnabled(enabled)
    if (enabled) {
      setHalfBandPatternEnabled(false)
      setRowAlternationModeEnabled(false)
      setRhythmPatternEnabled(false)
      setInverseDotNoiseEnabled(false)
    }
  }, [])

  const handleStraightLoudQuietNoiseEnabledChange = useCallback((enabled: boolean) => {
    setStraightLoudQuietNoiseEnabled(enabled)
    if (enabled) {
      setHalfBandPatternEnabled(false)
      setRowAlternationModeEnabled(false)
      setRhythmPatternEnabled(false)
      setInverseDotNoiseEnabled(false)
    }
  }, [])

  const handleContinuousTargetsSequentialHoldEnabledChange = useCallback((enabled: boolean) => {
    setContinuousTargetsSequentialHoldEnabled(enabled)
  }, [])

  useEffect(() => {
    const count = Math.max(1, dotCount)
    const totalHits = count * Math.max(1, depth)

    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setHitModeStagger(hitStaggerS)
    // Wave rate = one full cycle covers all dots × all volume steps
    player.setHitModeRate(1 / (perHitS * totalHits))
  }, [perHitS, hitStaggerS, dotCount, depth])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setContinuousLoudQuietStepSeconds(perHitS)
  }, [perHitS])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setContinuousLoudQuietRatio(continuousLoudRatio)
  }, [continuousLoudRatio])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setContinuousLoudQuietTargetsOnly(continuousTargetsOnlyEnabled)
    player.setContinuousTargetsSequentialHoldEnabled(continuousTargetsSequentialHoldEnabled)
    player.setContinuousLoudQuietTargetDotKeys(continuousVolumeTargetDots)
  }, [continuousTargetsOnlyEnabled, continuousTargetsSequentialHoldEnabled, continuousVolumeTargetDots])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setContinuousTwoDotAlternateEnabled(continuousTwoDotAlternateEnabled)
  }, [continuousTwoDotAlternateEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setSingleLocationTwoDotEnabled(singleLocationTwoDotEnabled)
  }, [singleLocationTwoDotEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setContinuousLeftRightLoudQuietEnabled(continuousLeftRightLoudQuietEnabled)
  }, [continuousLeftRightLoudQuietEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setContinuousSequentialEnabled(continuousSequentialEnabled)
  }, [continuousSequentialEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setContinuousSequentialRowsEnabled(continuousSequentialRowsEnabled)
  }, [continuousSequentialRowsEnabled])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setPositionVolumeAxis("horizontal")
    player.setPositionVolumeReversed(false)
    player.setPositionVolumeEnabled(positionVolumeEnabled)
    player.setPositionVolumeLeftDb(positionVolumeLeftDb)
    player.setPositionVolumeRightDb(positionVolumeRightDb)
  }, [positionVolumeEnabled, positionVolumeLeftDb, positionVolumeRightDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setDotVolumeDbOffsets(dotVolumeOffsetsDb)
  }, [dotVolumeOffsetsDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setNumberOfHits(hitMultiplier)
  }, [hitMultiplier])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setLoopWaveWaitSeconds(waveWaitSeconds)
  }, [waveWaitSeconds])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setHitModeRelease(effectiveRelease)
  }, [effectiveRelease])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setHitModeAttack(Math.max(0.001, attackMs / 1000))
  }, [attackMs])

  useEffect(() => { saveSetting("cabin:attackMsV2", attackMs) }, [attackMs])
  useEffect(() => { saveSetting("cabin:releaseMsV2", releaseMs) }, [releaseMs])
  useEffect(() => { saveSetting("cabin:hitSpacingMs", hitSpacingMs) }, [hitSpacingMs])
  useEffect(() => { saveSetting("cabin:pingPongEnabled", pingPongEnabled) }, [pingPongEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setSequencerPingPongEnabled(pingPongEnabled)
  }, [pingPongEnabled])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setBandwidthOscillationEnabled(false)
    player.setBandwidthFilterMode(bandwidthFilterMode)
    player.setBandpassBandwidth(bandwidth)
  }, [bandwidth, bandwidthFilterMode, loudQuietBandwidthModeEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setGentleEdgeFalloffDbPerOct(gentleEdgeFalloffDbPerOct)
  }, [gentleEdgeFalloffDbPerOct])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setInverseDotOutsideGapOctaves(inverseDotOutsideGapOctaves)
  }, [inverseDotOutsideGapOctaves])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setInverseDotBandBoostDb(inverseDotBandBoostDb)
  }, [inverseDotBandBoostDb])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setBandpassSlope(flatSlope ? -3.0 : -4.5)
  }, [flatSlope])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setNoiseOscillationRateHz(noiseOscillationRateHz)
  }, [noiseOscillationRateHz])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setNoiseOscillationBoundsDb(noiseOscillationMinDb, noiseOscillationMaxDb)
  }, [noiseOscillationMinDb, noiseOscillationMaxDb])

  useEffect(() => {
    const clickTrainVolumePercent = DEFAULT_CLICK_TRAIN_VOLUME_PERCENT * Math.pow(10, clickTrainBoostDb / 20)
    dotGridAudio.getDotGridAudioPlayer().setClickTrainGainPercent(clickTrainVolumePercent)
  }, [clickTrainBoostDb])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    // Depth: each dot repeats at this many volume levels per cycle
    // (ping-ponged quiet→loud→quiet), spread across depthGapDb total —
    // the per-step difference shrinks as depth grows.
    player.setVolumeSteps(Math.max(1, Math.min(8, depth)))
    player.setHitDecay(depth > 1 ? depthGapDb : 0)
    player.setHiHatModeEnabled(false)
    player.setPatternModeEnabled(false)
    player.setPatternAccentEvery(DEFAULTS.patternAccentEvery)
    player.setPatternVolumeDiffDb(DEFAULTS.patternVolumeDiffDb)
    player.setFourFourHitModeEnabled(DEFAULTS.fourFourHitModeEnabled)
    player.setFourFourVolumeBlockSize(loudQuietBlockSize)
    player.setFourFourVolumePerDot(loudQuietPerDot)
    player.setFourFourThreeLevelVolumeEnabled(threeLevelVolumeEnabled)
    player.setFourFourSidePolarityEnabled(sidePolarityLoudQuietEnabled)
    player.setLoudQuietBandwidthModeEnabled(loudQuietBandwidthModeEnabled)
    player.setFourFourHalfBandPatternEnabled(halfBandPatternEnabled)
    player.setFourFourRowAlternationEnabled(rowAlternationModeEnabled)
    player.setRhythmPatternEnabled(rhythmPatternEnabled)
    player.setExperimentalModeEnabled(false)
    player.setSnareScoopEnabled(false)
    player.setSnareScoopDepthDb(DEFAULTS.snareScoopDepthDb)
    player.setSnareScoopBandwidthOctaves(DEFAULTS.snareScoopBandwidthOctaves)
    player.setSnareScoopMode(DEFAULTS.snareScoopMode)
    player.setTiltOscillationEnabled(false)
    player.setTiltOscillationAmount(DEFAULTS.tiltOscillationAmount)
    player.setReverbModeEnabled(false)
    player.setReverbVolumeSpreadDb(DEFAULTS.reverbVolumeSpreadDb)
    player.setHiHatQuietDropDb(hiHatQuietDropDb)
    player.setHiHatLoudReleaseBoostMs(FIXED_ACCENT_RELEASE_MS)
  }, [depth, depthGapDb, halfBandPatternEnabled, hiHatQuietDropDb, loudQuietBandwidthModeEnabled, loudQuietBlockSize, loudQuietPerDot, rhythmPatternEnabled, rowAlternationModeEnabled, sidePolarityLoudQuietEnabled, threeLevelVolumeEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setVolumeDb(volumeDb)
  }, [volumeDb])

  // Arrow-key movement of selected dots
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (rowCompareEnabled) return
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
  }, [gridRows, gridCols, rowCompareEnabled])

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

  const updateDragNoiseFromPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const rect = dragNoiseSurfaceRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return

    const normalizedX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const normalizedY = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height))
    const points = getDragNoiseFormationPoints(
      normalizedX,
      normalizedY,
      dragNoiseFormationCount,
      dragNoiseFormationSpread
    )

    dragNoiseCenterRef.current = { normalizedX, normalizedY }
    setDragNoisePoints(points)
    dotGridAudio.getDotGridAudioPlayer().updateDragNoiseFormation(points)
  }, [dragNoiseFormationCount, dragNoiseFormationSpread])

  const stopDragNoise = useCallback(() => {
    dragNoisePointerIdRef.current = null
    dragNoiseCenterRef.current = null
    setDragNoisePoints([])
    dotGridAudio.getDotGridAudioPlayer().stopDragNoiseFormation()
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const finishDragNoiseGesture = useCallback(() => {
    dragNoisePointerIdRef.current = null
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const handleDragNoisePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragNoiseModeEnabled) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragNoisePointerIdRef.current = event.pointerId
    onDragStateChange?.(true)
    void resumeAudioContext()
    dotGridAudio.getDotGridAudioPlayer().setContinuousNoiseModeEnabled(true)
    updateDragNoiseFromPointer(event)
  }, [dragNoiseModeEnabled, onDragStateChange, updateDragNoiseFromPointer])

  const handleDragNoisePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragNoisePointerIdRef.current !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    updateDragNoiseFromPointer(event)
  }, [updateDragNoiseFromPointer])

  const handleDragNoisePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragNoisePointerIdRef.current !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already be released by the browser.
    }
    finishDragNoiseGesture()
  }, [finishDragNoiseGesture])

  useEffect(() => {
    if (!dragNoiseModeEnabled) {
      stopDragNoise()
      return
    }

    const center = dragNoiseCenterRef.current
    if (!center) return

    const points = getDragNoiseFormationPoints(
      center.normalizedX,
      center.normalizedY,
      dragNoiseFormationCount,
      dragNoiseFormationSpread
    )
    setDragNoisePoints(points)
    dotGridAudio.getDotGridAudioPlayer().updateDragNoiseFormation(points)
  }, [dragNoiseFormationCount, dragNoiseFormationSpread, dragNoiseModeEnabled, stopDragNoise])

  const updateLineCalibrationFromPointer = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = lineCalibrationDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const point = getPointerNormalizedPoint(event, lineCalibrationSurfaceRef.current)
    if (!point) return

    if (drag.mode === "move") {
      const rawCenter = {
        normalizedX: drag.startCenter.normalizedX + point.normalizedX - drag.startPointer.normalizedX,
        normalizedY: drag.startCenter.normalizedY + point.normalizedY - drag.startPointer.normalizedY,
      }
      const nextCenter = lineSquareModeEnabled
        ? clampSquareLineCenter(rawCenter, drag.startLength)
        : clampLineCenter(rawCenter, drag.startLength, drag.startAngle)
      setLineCenter(nextCenter)
      return
    }

    if (lineSquareModeEnabled) {
      const rawLength = Math.abs(point.normalizedY - drag.startCenter.normalizedY) * 2
      const nextLength = clampSquareLineLengthForCenter(drag.startCenter, rawLength)

      setLineAngle(LINE_SQUARE_ANGLE_RAD)
      setLineLength(nextLength)
      setLineCenter(clampSquareLineCenter(drag.startCenter, nextLength))
      return
    }

    const halfVector = drag.mode === "end"
      ? {
          normalizedX: point.normalizedX - drag.startCenter.normalizedX,
          normalizedY: point.normalizedY - drag.startCenter.normalizedY,
        }
      : {
          normalizedX: drag.startCenter.normalizedX - point.normalizedX,
          normalizedY: drag.startCenter.normalizedY - point.normalizedY,
        }
    const nextAngle = Math.atan2(halfVector.normalizedY, halfVector.normalizedX)
    const rawLength = Math.hypot(halfVector.normalizedX, halfVector.normalizedY) * 2
    const nextLength = clampLineLengthForCenter(drag.startCenter, rawLength, nextAngle)

    setLineAngle(nextAngle)
    setLineLength(nextLength)
    setLineCenter(clampLineCenter(drag.startCenter, nextLength, nextAngle))
  }, [lineSquareModeEnabled])

  const handleLineCalibrationPointerDown = useCallback((event: PointerEvent<HTMLElement>, mode: LineDragMode) => {
    if (!lineCalibrationEnabled) return

    const point = getPointerNormalizedPoint(event, lineCalibrationSurfaceRef.current)
    if (!point) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    lineCalibrationDragRef.current = {
      pointerId: event.pointerId,
      mode,
      startPointer: point,
      startCenter: lineCenter,
      startLength: lineLength,
      startAngle: lineAngle,
    }
    onDragStateChange?.(true)
    void resumeAudioContext()
    updateLineCalibrationFromPointer(event)
  }, [lineAngle, lineCalibrationEnabled, lineCenter, lineLength, onDragStateChange, updateLineCalibrationFromPointer])

  const handleLineCalibrationPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (lineCalibrationDragRef.current?.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    updateLineCalibrationFromPointer(event)
  }, [updateLineCalibrationFromPointer])

  const finishLineCalibrationGesture = useCallback(() => {
    lineCalibrationDragRef.current = null
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const handleLineCalibrationPointerEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    if (lineCalibrationDragRef.current?.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already be released by the browser.
    }
    finishLineCalibrationGesture()
  }, [finishLineCalibrationGesture])

  useEffect(() => {
    if (isPlaying) stopDragNoise()
  }, [isPlaying, stopDragNoise])

  // Clean up cursor play on Meta key release or window blur
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        handleCursorDotEnd()
      }
    }
    const handleBlur = () => {
      handleCursorDotEnd()
      finishDragNoiseGesture()
      finishLineCalibrationGesture()
    }
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [finishDragNoiseGesture, finishLineCalibrationGesture, handleCursorDotEnd])

  const { playingDotKey, beatIndex } = sequencerVisual
  const visiblePlayingDotKey = blindRandomModeEnabled ? null : playingDotKey
  const rowCompareSameRow = rowCompareRowA === rowCompareRowB
  const editableDotVolumeKeys = useMemo(() => {
    if (blindRandomModeEnabled || rowCompareEnabled || dragNoiseModeEnabled || lineCalibrationEnabled) return []

    return Array.from(selectedDots)
      .filter((dotKey) => isDotKeyInGrid(dotKey, gridRows, gridCols))
      .sort((a, b) => {
        const [colA, rowA] = a.split(",").map(Number)
        const [colB, rowB] = b.split(",").map(Number)
        return rowA - rowB || colA - colB
      })
  }, [blindRandomModeEnabled, dragNoiseModeEnabled, gridCols, gridRows, lineCalibrationEnabled, rowCompareEnabled, selectedDots])
  const selectedDotVolumeValues = useMemo(
    () => editableDotVolumeKeys.map((dotKey) => dotVolumeOffsetsDb.get(dotKey) ?? 0),
    [dotVolumeOffsetsDb, editableDotVolumeKeys]
  )
  const selectedDotVolumeValue = selectedDotVolumeValues[0] ?? 0
  const selectedDotVolumesMixed = selectedDotVolumeValues.some((value) => Math.abs(value - selectedDotVolumeValue) > 0.001)
  const dotVolumeSliderValue = selectedDotVolumesMixed ? 0 : selectedDotVolumeValue
  const selectedDotVolumeLabel = editableDotVolumeKeys.length === 1
    ? formatDotKeyLabel(editableDotVolumeKeys[0])
    : `${editableDotVolumeKeys.length} dots`

  const handleSelectedDotVolumeChange = useCallback((volumeDb: number) => {
    const nextVolumeDb = clampDotVolumeDb(volumeDb)
    setDotVolumeOffsetsDb((prev) => {
      const next = new Map(prev)

      editableDotVolumeKeys.forEach((dotKey) => {
        if (Math.abs(nextVolumeDb) < 0.001) {
          next.delete(dotKey)
        } else {
          next.set(dotKey, nextVolumeDb)
        }
      })

      return next
    })
  }, [editableDotVolumeKeys])

  const renderRowCompareGuide = (rowId: "A" | "B", row: number, volumeDbForRow: number) => {
    const percent = gridRows <= 1 ? 50 : (row / (gridRows - 1)) * 100
    const isA = rowId === "A"
    const isDragging = draggingRowCompareId === rowId
    const tint = isA ? "34,211,238" : "244,114,182"
    const sideClass = rowCompareSameRow
      ? isA ? "left-[8%] right-[52%]" : "left-[52%] right-[8%]"
      : "left-[8%] right-[8%]"
    const labelClass = isA ? "left-2" : "right-2"

    return (
      <button
        key={rowId}
        type="button"
        aria-label={`Drag row ${rowId}`}
        className={`absolute h-12 -translate-y-1/2 pointer-events-auto cursor-row-resize touch-none focus:outline-none ${sideClass}`}
        style={{ bottom: `${percent}%`, zIndex: isDragging ? 34 : isA ? 32 : 33 }}
        onPointerDown={(event) => handleRowComparePointerDown(event, rowId)}
        onPointerMove={(event) => handleRowComparePointerMove(event, rowId)}
        onPointerUp={handleRowComparePointerEnd}
        onPointerCancel={handleRowComparePointerEnd}
      >
        <span
          className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full"
          style={{
            background: `rgba(${tint}, ${isDragging ? 0.95 : 0.72})`,
            boxShadow: `0 0 ${isDragging ? 22 : 14}px rgba(${tint}, 0.45)`,
          }}
        />
        <span
          className={`absolute ${labelClass} top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[10px] font-semibold tabular-nums text-black dark:text-white`}
          style={{
            background: `rgba(${tint}, ${isDragging ? 0.36 : 0.24})`,
            border: `1px solid rgba(${tint}, 0.55)`,
          }}
        >
          {rowId} r{row + 1} {formatSignedDb(volumeDbForRow)}
        </span>
      </button>
    )
  }

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
    setContinuousVolumeTargetDots((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setInverseConstantNoiseDots((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const handleDotReference = useCallback((x: number, y: number) => {
    void resumeAudioContext()
    const key = `${x},${y}`

    // During inverse dot, right-click toggles a "constant noise" dot: it plays
    // flat full-spectrum noise instead of acting as a (pulsing, notched) dot.
    if (inverseDotNoiseEnabled) {
      setSelectedDots((prev) => {
        if (prev.has(key)) return prev
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setInverseConstantNoiseDots((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
      return
    }

    setSelectedDots((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setContinuousVolumeTargetDots((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [inverseDotNoiseEnabled])

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
        selectedDots={visibleSelectedDots}
        constantDots={inverseDotNoiseEnabled ? inverseConstantNoiseDots : new Set()}
        referenceDotKey={null}
        referenceDotKeys={continuousVolumeTargetDots}
        onDotSelect={handleDotSelect}
        onDotDeselect={handleDotDeselect}
        onDotReference={handleDotReference}
        playingDotKey={visiblePlayingDotKey}
        beatIndex={beatIndex}
        hoveredDot={hoveredDot}
        onHoverDot={setHoveredDot}
        quality={quality}
        highlightTarget={highlightTarget}
        onDragStateChange={onDragStateChange}
        cursorDotPosition={cursorDotPosition}
        onCursorDotMove={handleCursorDotMove}
        onCursorDotEnd={handleCursorDotEnd}
        inputDisabled={blindRandomModeEnabled || rowCompareEnabled || dragNoiseModeEnabled || lineCalibrationEnabled}
        inviteDotKey={inviteDotKey}
        eqHighlights={eqHighlights}
      />
      {editableDotVolumeKeys.length > 0 && (
        <div className="absolute bottom-4 left-4 z-40 w-[min(18rem,calc(100%-2rem))] rounded-lg border border-white/10 bg-black/60 p-3 text-white shadow-2xl backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Dot vol</span>
            <span className="font-mono text-[10px] tabular-nums text-white/75">
              {selectedDotVolumesMixed ? "mixed" : formatSignedDb(selectedDotVolumeValue)}
            </span>
          </div>
          <Slider
            value={[dotVolumeSliderValue]}
            min={DOT_VOLUME_MIN_DB}
            max={DOT_VOLUME_MAX_DB}
            step={1}
            onValueChange={([value]) => handleSelectedDotVolumeChange(value ?? dotVolumeSliderValue)}
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-white/45">
            <span className="min-w-0 truncate">{selectedDotVolumeLabel}</span>
            <button
              type="button"
              className="shrink-0 rounded-md border border-white/10 px-2 py-1 font-mono text-white/65 transition hover:bg-white/10 hover:text-white"
              onClick={() => handleSelectedDotVolumeChange(0)}
            >
              0 dB
            </button>
          </div>
        </div>
      )}
      {dragNoiseModeEnabled && !isPlaying && (
        <div
          ref={dragNoiseSurfaceRef}
          className="absolute inset-0 z-40 cursor-crosshair touch-none"
          onPointerDown={handleDragNoisePointerDown}
          onPointerMove={handleDragNoisePointerMove}
          onPointerUp={handleDragNoisePointerEnd}
          onPointerCancel={handleDragNoisePointerEnd}
          onContextMenu={(event) => event.preventDefault()}
        >
          {dragNoisePoints.map((point, index) => (
            <span
              key={index}
              className="pointer-events-none absolute block h-5 w-5 rounded-full border border-cyan-100/70 bg-cyan-300/75 shadow-[0_0_22px_rgba(34,211,238,0.65)]"
              style={{
                left: `${point.normalizedX * 100}%`,
                top: `${(1 - point.normalizedY) * 100}%`,
                transform: `translate(-50%, -50%) scale(${index === 0 ? 1.12 : 0.86})`,
                opacity: index === 0 ? 0.98 : 0.74,
              }}
            />
          ))}
        </div>
      )}
      {lineCalibrationEnabled && !isPlaying && (
        <div
          ref={lineCalibrationSurfaceRef}
          className="absolute inset-0 z-40 touch-none pointer-events-none"
          onContextMenu={(event) => event.preventDefault()}
        >
          {lineVisual.copy && !linePathMotionEnabled && (
            <>
              <div
                className="absolute h-12 touch-none pointer-events-none"
                style={{
                  left: `${lineVisual.copy.startLeft}%`,
                  top: `${lineVisual.copy.startTop}%`,
                  width: `${Math.max(0.1, lineVisual.copy.width)}%`,
                  transform: `translateY(-50%) rotate(${lineVisual.copy.screenAngle}rad)`,
                  transformOrigin: "0 50%",
                }}
              >
                <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-fuchsia-200/55 shadow-[0_0_18px_rgba(217,70,239,0.45)]" />
                <span className="absolute left-0 right-0 top-1/2 h-7 -translate-y-1/2 rounded-full bg-fuchsia-300/10" />
              </div>
              {[
                { id: "copy-start", left: lineVisual.copy.startLeft, top: lineVisual.copy.startTop },
                { id: "copy-end", left: lineVisual.copy.endLeft, top: lineVisual.copy.endTop },
              ].map((endpoint) => (
                <span
                  key={endpoint.id}
                  className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-100/50 bg-fuchsia-300/45 shadow-[0_0_20px_rgba(217,70,239,0.42)] pointer-events-none"
                  style={{
                    left: `${endpoint.left}%`,
                    top: `${endpoint.top}%`,
                  }}
                />
              ))}
            </>
          )}
          <button
            type="button"
            aria-label="Move calibration line"
            className="absolute h-12 cursor-grab touch-none pointer-events-auto focus:outline-none active:cursor-grabbing"
            style={{
              left: `${lineVisual.startLeft}%`,
              top: `${lineVisual.startTop}%`,
              width: `${Math.max(0.1, lineVisual.width)}%`,
              transform: `translateY(-50%) rotate(${lineVisual.screenAngle}rad)`,
              transformOrigin: "0 50%",
            }}
            onPointerDown={(event) => handleLineCalibrationPointerDown(event, "move")}
            onPointerMove={handleLineCalibrationPointerMove}
            onPointerUp={handleLineCalibrationPointerEnd}
            onPointerCancel={handleLineCalibrationPointerEnd}
          >
            <span className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-cyan-200/75 shadow-[0_0_22px_rgba(34,211,238,0.75)]" />
            <span className="absolute left-0 right-0 top-1/2 h-7 -translate-y-1/2 rounded-full bg-cyan-300/10" />
          </button>
          {linePathMotionEnabled && (
            <span
              ref={linePathMarkerRef}
              className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100/85 bg-amber-300/85 shadow-[0_0_28px_rgba(251,191,36,0.82)]"
              style={{
                left: `${lineVisual.startLeft}%`,
                top: `${lineVisual.startTop}%`,
              }}
            >
              <span className="absolute inset-[7px] rounded-full bg-white/90" />
            </span>
          )}
          <button
            type="button"
            aria-label="Move calibration line center"
            className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-black/50 shadow-[0_0_20px_rgba(255,255,255,0.35)] backdrop-blur-sm pointer-events-auto cursor-grab touch-none focus:outline-none active:cursor-grabbing"
            style={{
              left: `${lineVisual.centerLeft}%`,
              top: `${lineVisual.centerTop}%`,
            }}
            onPointerDown={(event) => handleLineCalibrationPointerDown(event, "move")}
            onPointerMove={handleLineCalibrationPointerMove}
            onPointerUp={handleLineCalibrationPointerEnd}
            onPointerCancel={handleLineCalibrationPointerEnd}
          />
          {[
            { id: "start" as const, left: lineVisual.startLeft, top: lineVisual.startTop },
            { id: "end" as const, left: lineVisual.endLeft, top: lineVisual.endTop },
          ].map((endpoint) => (
            <button
              key={endpoint.id}
              type="button"
              aria-label={`${endpoint.id === "start" ? "Start" : "End"} calibration point`}
              className={`absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/80 bg-cyan-300/80 shadow-[0_0_26px_rgba(34,211,238,0.78)] pointer-events-auto touch-none focus:outline-none ${lineSquareModeEnabled ? "cursor-ns-resize" : "cursor-ew-resize"}`}
              style={{
                left: `${endpoint.left}%`,
                top: `${endpoint.top}%`,
              }}
              onPointerDown={(event) => handleLineCalibrationPointerDown(event, endpoint.id)}
              onPointerMove={handleLineCalibrationPointerMove}
              onPointerUp={handleLineCalibrationPointerEnd}
              onPointerCancel={handleLineCalibrationPointerEnd}
            >
              <span className="absolute inset-[9px] rounded-full bg-white/85" />
            </button>
          ))}
        </div>
      )}
      {rowCompareEnabled && (
        <div ref={rowCompareOverlayRef} className="absolute inset-0 z-30 pointer-events-none">
          <div className="absolute inset-x-[8%] top-4 flex justify-center pointer-events-none">
            <span className="rounded-md border border-white/10 bg-black/45 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white/65 backdrop-blur-sm">
              Row compare
            </span>
          </div>
          {renderRowCompareGuide("A", rowCompareRowA, rowCompareVolumeADb)}
          {renderRowCompareGuide("B", rowCompareRowB, rowCompareVolumeBDb)}
        </div>
      )}
      <SettingsPanel
        collapsed={settingsCollapsed}
        onToggle={() => setSettingsCollapsed((v) => !v)}
        gridRows={gridRows}
        gridCols={gridCols}
        minRows={MIN_ROWS}
        maxRows={MAX_ROWS}
        minCols={MIN_COLS}
        maxCols={MAX_COLS}
        onSetGridSize={(rows, cols) => {
          setGridRows(Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(rows))))
          setGridCols(Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(cols))))
        }}
        speed={speed}
        onSpeedChange={(value) => setSpeed(Math.max(SPEED_MIN, Math.min(SPEED_MAX, value)))}
        volumeDb={volumeDb}
        onVolumeChange={setVolumeDb}
        attackMs={attackMs}
        onAttackMsChange={setAttackMs}
        releaseMs={releaseMs}
        onReleaseMsChange={setReleaseMs}
        hitSpacingMs={hitSpacingMs}
        onHitSpacingMsChange={setHitSpacingMs}
        pingPongEnabled={pingPongEnabled}
        onPingPongEnabledChange={setPingPongEnabled}
        depth={depth}
        onDepthChange={(value) => setDepth(Math.max(1, Math.min(8, Math.round(value))))}
        depthGapDb={depthGapDb}
        onDepthGapDbChange={(value) => setDepthGapDb(Math.max(0, Math.min(60, value)))}
        dotBalanceDb={dotBalanceDb}
        onDotBalanceDbChange={(value) => setDotBalanceDb(Math.max(-24, Math.min(24, value)))}
        bandwidth={bandwidth}
        onBandwidthChange={setBandwidth}
        bandwidthFilterMode={bandwidthFilterMode}
        onBandwidthFilterModeChange={handleBandwidthFilterModeChange}
        gentleEdgeFalloffDbPerOct={gentleEdgeFalloffDbPerOct}
        onGentleEdgeFalloffChange={(value) => setGentleEdgeFalloffDbPerOct(clampGentleEdgeFalloffDbPerOct(value))}
        loudQuietBlockSize={loudQuietBlockSize}
        onLoudQuietBlockSizeChange={(value) => setLoudQuietBlockSize(clampLoudQuietBlockSize(value))}
        loudQuietPerDot={loudQuietPerDot}
        onLoudQuietPerDotChange={setLoudQuietPerDot}
        threeLevelVolumeEnabled={threeLevelVolumeEnabled}
        onThreeLevelVolumeEnabledChange={handleThreeLevelVolumeEnabledChange}
        sidePolarityLoudQuietEnabled={sidePolarityLoudQuietEnabled}
        onSidePolarityLoudQuietEnabledChange={setSidePolarityLoudQuietEnabled}
        loudQuietBandwidthModeEnabled={loudQuietBandwidthModeEnabled}
        onLoudQuietBandwidthModeEnabledChange={handleLoudQuietBandwidthModeEnabledChange}
        halfBandPatternEnabled={halfBandPatternEnabled}
        onHalfBandPatternEnabledChange={handleHalfBandPatternEnabledChange}
        rowAlternationModeEnabled={rowAlternationModeEnabled}
        onRowAlternationModeEnabledChange={handleRowAlternationModeEnabledChange}
        rhythmPatternEnabled={rhythmPatternEnabled}
        onRhythmPatternEnabledChange={handleRhythmPatternEnabledChange}
        inverseDotNoiseEnabled={inverseDotNoiseEnabled}
        onInverseDotNoiseEnabledChange={handleInverseDotNoiseEnabledChange}
        inverseDotOutsideGapOctaves={inverseDotOutsideGapOctaves}
        onInverseDotOutsideGapChange={(value) => setInverseDotOutsideGapOctaves(Math.max(
          dotGridAudio.MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
          Math.min(dotGridAudio.MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES, value)
        ))}
        inverseDotBandBoostDb={inverseDotBandBoostDb}
        onInverseDotBandBoostChange={(value) => setInverseDotBandBoostDb(Math.max(
          dotGridAudio.MIN_INVERSE_DOT_BAND_BOOST_DB,
          Math.min(dotGridAudio.MAX_INVERSE_DOT_BAND_BOOST_DB, value)
        ))}
        hitMultiplier={hitMultiplier}
        onHitMultiplierChange={(value) => setHitMultiplier(clampHitMultiplier(value))}
        hitStaggerPercent={hitStaggerPercent}
        onHitStaggerPercentChange={(value) => setHitStaggerPercent(clampHitStaggerPercent(value))}
        waveWaitSeconds={waveWaitSeconds}
        onWaveWaitSecondsChange={(value) => setWaveWaitSeconds(clampWaveWaitSeconds(value))}
        volumeOscillationEnabled={allVolumeOscillationEnabled}
        onVolumeOscillationEnabledChange={setAllVolumeOscillationEnabled}
        volumeOscillationRateHz={allVolumeOscillationRateHz}
        onVolumeOscillationRateHzChange={(value) => setAllVolumeOscillationRateHz(clampVolumeOscillationRate(value))}
        volumeOscillationShape={allVolumeOscillationShape}
        onVolumeOscillationShapeChange={(value) => setAllVolumeOscillationShape(clampVolumeOscillationShape(value))}
        volumeOscillationWaveEnabled={allVolumeOscillationWaveEnabled}
        onVolumeOscillationWaveEnabledChange={setAllVolumeOscillationWaveEnabled}
        volumeOscillationWavePhase={allVolumeOscillationWavePhase}
        onVolumeOscillationWavePhaseChange={(value) => setAllVolumeOscillationWavePhase(clampVolumeOscillationWavePhase(value))}
        selectionVolumeStepDb={selectionVolumeStepDb}
        onSelectionVolumeStepChange={(value) => setSelectionVolumeStepDb(clampSelectionVolumeStepDb(value))}
        continuousNoiseEnabled={continuousNoiseEnabled}
        onContinuousNoiseEnabledChange={handleContinuousNoiseEnabledChange}
        straightLoudQuietNoiseEnabled={straightLoudQuietNoiseEnabled}
        onStraightLoudQuietNoiseEnabledChange={handleStraightLoudQuietNoiseEnabledChange}
        continuousLoudRatio={continuousLoudRatio}
        onContinuousLoudRatioChange={(value) => setContinuousLoudRatio(clampContinuousLoudRatio(value))}
        continuousTargetsOnlyEnabled={continuousTargetsOnlyEnabled}
        onContinuousTargetsOnlyEnabledChange={setContinuousTargetsOnlyEnabled}
        continuousTargetsSequentialHoldEnabled={continuousTargetsSequentialHoldEnabled}
        onContinuousTargetsSequentialHoldEnabledChange={handleContinuousTargetsSequentialHoldEnabledChange}
        continuousTwoDotAlternateEnabled={continuousTwoDotAlternateEnabled}
        onContinuousTwoDotAlternateEnabledChange={setContinuousTwoDotAlternateEnabled}
        singleLocationTwoDotEnabled={singleLocationTwoDotEnabled}
        onSingleLocationTwoDotEnabledChange={setSingleLocationTwoDotEnabled}
        continuousLeftRightLoudQuietEnabled={continuousLeftRightLoudQuietEnabled}
        onContinuousLeftRightLoudQuietEnabledChange={setContinuousLeftRightLoudQuietEnabled}
        continuousSequentialEnabled={continuousSequentialEnabled}
        onContinuousSequentialEnabledChange={setContinuousSequentialEnabled}
        continuousSequentialRowsEnabled={continuousSequentialRowsEnabled}
        onContinuousSequentialRowsEnabledChange={setContinuousSequentialRowsEnabled}
        dragNoiseModeEnabled={dragNoiseModeEnabled}
        onDragNoiseModeEnabledChange={handleDragNoiseModeChange}
        dragNoiseFormationCount={dragNoiseFormationCount}
        onDragNoiseFormationCountChange={(value) => setDragNoiseFormationCount(clampDragNoiseFormationCount(value))}
        dragNoiseFormationSpread={dragNoiseFormationSpread}
        onDragNoiseFormationSpreadChange={(value) => setDragNoiseFormationSpread(clampDragNoiseFormationSpread(value))}
        lineCalibrationEnabled={lineCalibrationEnabled}
        onLineCalibrationEnabledChange={handleLineCalibrationEnabledChange}
        lineSquareModeEnabled={lineSquareModeEnabled}
        onLineSquareModeEnabledChange={handleLineSquareModeEnabledChange}
        linePathMotionEnabled={linePathMotionEnabled}
        onLinePathMotionEnabledChange={handleLinePathMotionEnabledChange}
        lineInverseDotPathEnabled={lineInverseDotPathEnabled}
        onLineInverseDotPathEnabledChange={handleLineInverseDotPathEnabledChange}
        lineStartGainDb={lineStartGainDb}
        onLineStartGainChange={(value) => setLineStartGainDb(clampLineEndpointGainDb(value))}
        lineEndGainDb={lineEndGainDb}
        onLineEndGainChange={(value) => setLineEndGainDb(clampLineEndpointGainDb(value))}
        rowCompareEnabled={rowCompareEnabled}
        onRowCompareEnabledChange={handleRowCompareEnabledChange}
        rowCompareRowA={rowCompareRowA}
        onRowCompareRowAChange={(value) => setRowCompareRowA(clampRowIndex(value, gridRows))}
        rowCompareRowB={rowCompareRowB}
        onRowCompareRowBChange={(value) => setRowCompareRowB(clampRowIndex(value, gridRows))}
        rowCompareRepeats={rowCompareRepeats}
        onRowCompareRepeatsChange={(value) => setRowCompareRepeats(clampRowCompareRepeats(value))}
        rowCompareVolumeADb={rowCompareVolumeADb}
        onRowCompareVolumeAChange={(value) => setRowCompareVolumeADb(clampRowCompareVolumeDb(value))}
        rowCompareVolumeBDb={rowCompareVolumeBDb}
        onRowCompareVolumeBChange={(value) => setRowCompareVolumeBDb(clampRowCompareVolumeDb(value))}
        positionVolumeEnabled={positionVolumeEnabled}
        onPositionVolumeEnabledChange={setPositionVolumeEnabled}
        positionVolumeLeftDb={positionVolumeLeftDb}
        onPositionVolumeLeftDbChange={(value) => setPositionVolumeLeftDb(clampPositionVolumeDb(value))}
        positionVolumeRightDb={positionVolumeRightDb}
        onPositionVolumeRightDbChange={(value) => setPositionVolumeRightDb(clampPositionVolumeDb(value))}
        quietLevelDb={-hiHatQuietDropDb}
        onQuietLevelChange={(value) => setHiHatQuietDropDb(Math.max(0, -value))}
      />
    </div>
  )
}
