"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Settings } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  MAX_INVERSE_DOT_BAND_BOOST_DB,
  MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
  MAX_GENTLE_EDGE_FALLOFF_DB_PER_OCT,
  MIN_INVERSE_DOT_BAND_BOOST_DB,
  MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
  MIN_GENTLE_EDGE_FALLOFF_DB_PER_OCT,
  type BandwidthFilterMode,
  type VolumeOscillationShape,
} from "@/lib/audio/dotGridAudio"

// When false, the panel shows only the core controls (volume, bandwidth,
// attack, release). Flip to true to bring back the full experimental
// settings surface.
const SHOW_ALL_SETTINGS: boolean = false

function formatDb(value: number): string {
  if (value > 0) return `+${value.toFixed(0)} dB`
  return `${value.toFixed(0)} dB`
}

function formatSpeed(value: number): string {
  return value < 1 ? value.toFixed(2) : value.toFixed(1)
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`
}

function formatHz(value: number): string {
  return `${value < 1 ? value.toFixed(2) : value.toFixed(1)} Hz`
}

function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ left: 0, top: 0, visibility: "hidden" })

  useEffect(() => {
    if (!show || !triggerRef.current || !tipRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tipRect = tipRef.current.getBoundingClientRect()
    const pad = 6
    let left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2
    let top = triggerRect.top - pad - tipRect.height

    if (left < pad) left = pad
    if (left + tipRect.width > window.innerWidth - pad) left = window.innerWidth - pad - tipRect.width
    if (top < pad) top = triggerRect.bottom + pad

    setStyle({ left, top, visibility: "visible" })
  }, [show])

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => {
        setShow(false)
        setStyle((prev) => ({ ...prev, visibility: "hidden" }))
      }}
    >
      {children}
      {show && createPortal(
        <span
          ref={tipRef}
          className="fixed px-2 py-1 rounded-md text-[10px] leading-tight whitespace-nowrap dark:bg-white/15 bg-black/80 dark:text-white/90 text-white backdrop-blur-sm pointer-events-none z-[9999]"
          style={style}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  )
}

interface SettingsPanelProps {
  collapsed: boolean
  onToggle: () => void
  gridRows: number
  gridCols: number
  minRows: number
  maxRows: number
  minCols: number
  maxCols: number
  onSetGridSize: (rows: number, cols: number) => void
  speed: number
  onSpeedChange: (value: number) => void
  volumeDb: number
  onVolumeChange: (value: number) => void
  attackMs: number
  onAttackMsChange: (value: number) => void
  releaseMs: number
  onReleaseMsChange: (value: number) => void
  hitSpacingMs: number
  onHitSpacingMsChange: (value: number) => void
  pingPongEnabled: boolean
  onPingPongEnabledChange: (value: boolean) => void
  depth: number
  onDepthChange: (value: number) => void
  depthGapDb: number
  onDepthGapDbChange: (value: number) => void
  dotBalanceDb: number
  onDotBalanceDbChange: (value: number) => void
  bandwidth: number
  onBandwidthChange: (value: number) => void
  bandwidthFilterMode: BandwidthFilterMode
  onBandwidthFilterModeChange: (value: BandwidthFilterMode) => void
  gentleEdgeFalloffDbPerOct: number
  onGentleEdgeFalloffChange: (value: number) => void
  loudQuietBlockSize: number
  onLoudQuietBlockSizeChange: (value: number) => void
  loudQuietPerDot: boolean
  onLoudQuietPerDotChange: (value: boolean) => void
  threeLevelVolumeEnabled: boolean
  onThreeLevelVolumeEnabledChange: (value: boolean) => void
  sidePolarityLoudQuietEnabled: boolean
  onSidePolarityLoudQuietEnabledChange: (value: boolean) => void
  loudQuietBandwidthModeEnabled: boolean
  onLoudQuietBandwidthModeEnabledChange: (value: boolean) => void
  halfBandPatternEnabled: boolean
  onHalfBandPatternEnabledChange: (value: boolean) => void
  rowAlternationModeEnabled: boolean
  onRowAlternationModeEnabledChange: (value: boolean) => void
  rhythmPatternEnabled: boolean
  onRhythmPatternEnabledChange: (value: boolean) => void
  inverseDotNoiseEnabled: boolean
  onInverseDotNoiseEnabledChange: (value: boolean) => void
  inverseDotOutsideGapOctaves: number
  onInverseDotOutsideGapChange: (value: number) => void
  inverseDotBandBoostDb: number
  onInverseDotBandBoostChange: (value: number) => void
  hitMultiplier: number
  onHitMultiplierChange: (value: number) => void
  hitStaggerPercent: number
  onHitStaggerPercentChange: (value: number) => void
  waveWaitSeconds: number
  onWaveWaitSecondsChange: (value: number) => void
  volumeOscillationEnabled: boolean
  onVolumeOscillationEnabledChange: (value: boolean) => void
  volumeOscillationRateHz: number
  onVolumeOscillationRateHzChange: (value: number) => void
  volumeOscillationShape: VolumeOscillationShape
  onVolumeOscillationShapeChange: (value: VolumeOscillationShape) => void
  volumeOscillationWaveEnabled: boolean
  onVolumeOscillationWaveEnabledChange: (value: boolean) => void
  volumeOscillationWavePhase: number
  onVolumeOscillationWavePhaseChange: (value: number) => void
  selectionVolumeStepDb: number
  onSelectionVolumeStepChange: (value: number) => void
  continuousNoiseEnabled: boolean
  onContinuousNoiseEnabledChange: (value: boolean) => void
  straightLoudQuietNoiseEnabled: boolean
  onStraightLoudQuietNoiseEnabledChange: (value: boolean) => void
  continuousLoudRatio: number
  onContinuousLoudRatioChange: (value: number) => void
  continuousTargetsOnlyEnabled: boolean
  onContinuousTargetsOnlyEnabledChange: (value: boolean) => void
  continuousTargetsSequentialHoldEnabled: boolean
  onContinuousTargetsSequentialHoldEnabledChange: (value: boolean) => void
  continuousTwoDotAlternateEnabled: boolean
  onContinuousTwoDotAlternateEnabledChange: (value: boolean) => void
  singleLocationTwoDotEnabled: boolean
  onSingleLocationTwoDotEnabledChange: (value: boolean) => void
  continuousLeftRightLoudQuietEnabled: boolean
  onContinuousLeftRightLoudQuietEnabledChange: (value: boolean) => void
  continuousSequentialEnabled: boolean
  onContinuousSequentialEnabledChange: (value: boolean) => void
  continuousSequentialRowsEnabled: boolean
  onContinuousSequentialRowsEnabledChange: (value: boolean) => void
  dragNoiseModeEnabled: boolean
  onDragNoiseModeEnabledChange: (value: boolean) => void
  dragNoiseFormationCount: number
  onDragNoiseFormationCountChange: (value: number) => void
  dragNoiseFormationSpread: number
  onDragNoiseFormationSpreadChange: (value: number) => void
  lineCalibrationEnabled: boolean
  onLineCalibrationEnabledChange: (value: boolean) => void
  lineSquareModeEnabled: boolean
  onLineSquareModeEnabledChange: (value: boolean) => void
  linePathMotionEnabled: boolean
  onLinePathMotionEnabledChange: (value: boolean) => void
  lineInverseDotPathEnabled: boolean
  onLineInverseDotPathEnabledChange: (value: boolean) => void
  lineStartGainDb: number
  onLineStartGainChange: (value: number) => void
  lineEndGainDb: number
  onLineEndGainChange: (value: number) => void
  rowCompareEnabled: boolean
  onRowCompareEnabledChange: (value: boolean) => void
  rowCompareRowA: number
  onRowCompareRowAChange: (value: number) => void
  rowCompareRowB: number
  onRowCompareRowBChange: (value: number) => void
  rowCompareRepeats: number
  onRowCompareRepeatsChange: (value: number) => void
  rowCompareVolumeADb: number
  onRowCompareVolumeAChange: (value: number) => void
  rowCompareVolumeBDb: number
  onRowCompareVolumeBChange: (value: number) => void
  positionVolumeEnabled: boolean
  onPositionVolumeEnabledChange: (value: boolean) => void
  positionVolumeLeftDb: number
  onPositionVolumeLeftDbChange: (value: number) => void
  positionVolumeRightDb: number
  onPositionVolumeRightDbChange: (value: number) => void
  quietLevelDb: number
  onQuietLevelChange: (value: number) => void
}

export function SettingsPanel({
  collapsed,
  onToggle,
  gridRows,
  gridCols,
  minRows,
  maxRows,
  minCols,
  maxCols,
  onSetGridSize,
  speed,
  onSpeedChange,
  volumeDb,
  onVolumeChange,
  attackMs,
  onAttackMsChange,
  releaseMs,
  onReleaseMsChange,
  hitSpacingMs,
  onHitSpacingMsChange,
  pingPongEnabled,
  onPingPongEnabledChange,
  depth,
  onDepthChange,
  depthGapDb,
  onDepthGapDbChange,
  dotBalanceDb,
  onDotBalanceDbChange,
  bandwidth,
  onBandwidthChange,
  bandwidthFilterMode,
  onBandwidthFilterModeChange,
  gentleEdgeFalloffDbPerOct,
  onGentleEdgeFalloffChange,
  loudQuietBlockSize,
  onLoudQuietBlockSizeChange,
  loudQuietPerDot,
  onLoudQuietPerDotChange,
  threeLevelVolumeEnabled,
  onThreeLevelVolumeEnabledChange,
  sidePolarityLoudQuietEnabled,
  onSidePolarityLoudQuietEnabledChange,
  loudQuietBandwidthModeEnabled,
  onLoudQuietBandwidthModeEnabledChange,
  halfBandPatternEnabled,
  onHalfBandPatternEnabledChange,
  rowAlternationModeEnabled,
  onRowAlternationModeEnabledChange,
  rhythmPatternEnabled,
  onRhythmPatternEnabledChange,
  inverseDotNoiseEnabled,
  onInverseDotNoiseEnabledChange,
  inverseDotOutsideGapOctaves,
  onInverseDotOutsideGapChange,
  inverseDotBandBoostDb,
  onInverseDotBandBoostChange,
  hitMultiplier,
  onHitMultiplierChange,
  hitStaggerPercent,
  onHitStaggerPercentChange,
  waveWaitSeconds,
  onWaveWaitSecondsChange,
  volumeOscillationEnabled,
  onVolumeOscillationEnabledChange,
  volumeOscillationRateHz,
  onVolumeOscillationRateHzChange,
  volumeOscillationShape,
  onVolumeOscillationShapeChange,
  volumeOscillationWaveEnabled,
  onVolumeOscillationWaveEnabledChange,
  volumeOscillationWavePhase,
  onVolumeOscillationWavePhaseChange,
  selectionVolumeStepDb,
  onSelectionVolumeStepChange,
  continuousNoiseEnabled,
  onContinuousNoiseEnabledChange,
  straightLoudQuietNoiseEnabled,
  onStraightLoudQuietNoiseEnabledChange,
  continuousLoudRatio,
  onContinuousLoudRatioChange,
  continuousTargetsOnlyEnabled,
  onContinuousTargetsOnlyEnabledChange,
  continuousTargetsSequentialHoldEnabled,
  onContinuousTargetsSequentialHoldEnabledChange,
  continuousTwoDotAlternateEnabled,
  onContinuousTwoDotAlternateEnabledChange,
  singleLocationTwoDotEnabled,
  onSingleLocationTwoDotEnabledChange,
  continuousLeftRightLoudQuietEnabled,
  onContinuousLeftRightLoudQuietEnabledChange,
  continuousSequentialEnabled,
  onContinuousSequentialEnabledChange,
  continuousSequentialRowsEnabled,
  onContinuousSequentialRowsEnabledChange,
  dragNoiseModeEnabled,
  onDragNoiseModeEnabledChange,
  dragNoiseFormationCount,
  onDragNoiseFormationCountChange,
  dragNoiseFormationSpread,
  onDragNoiseFormationSpreadChange,
  lineCalibrationEnabled,
  onLineCalibrationEnabledChange,
  lineSquareModeEnabled,
  onLineSquareModeEnabledChange,
  linePathMotionEnabled,
  onLinePathMotionEnabledChange,
  lineInverseDotPathEnabled,
  onLineInverseDotPathEnabledChange,
  lineStartGainDb,
  onLineStartGainChange,
  lineEndGainDb,
  onLineEndGainChange,
  rowCompareEnabled,
  onRowCompareEnabledChange,
  rowCompareRowA,
  onRowCompareRowAChange,
  rowCompareRowB,
  onRowCompareRowBChange,
  rowCompareRepeats,
  onRowCompareRepeatsChange,
  rowCompareVolumeADb,
  onRowCompareVolumeAChange,
  rowCompareVolumeBDb,
  onRowCompareVolumeBChange,
  positionVolumeEnabled,
  onPositionVolumeEnabledChange,
  positionVolumeLeftDb,
  onPositionVolumeLeftDbChange,
  positionVolumeRightDb,
  onPositionVolumeRightDbChange,
  quietLevelDb,
  onQuietLevelChange,
}: SettingsPanelProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const loudQuietLoudCount = Math.max(1, Math.min(loudQuietBlockSize, Math.round(loudQuietBlockSize * continuousLoudRatio)))
  const loudQuietQuietCount = Math.max(0, loudQuietBlockSize - loudQuietLoudCount)
  const loudQuietPreview = rowAlternationModeEnabled
    ? (["T", "A", "B", "A"] as const)
    : halfBandPatternEnabled
    ? (["B", "F", "T", "F"] as const)
    : threeLevelVolumeEnabled
    ? (["Q", "M", "L", "M"] as const)
    : [
        ...Array.from({ length: loudQuietLoudCount }, () => "L" as const),
        ...Array.from({ length: loudQuietQuietCount }, () => "Q" as const),
      ]
  const formatLoudQuietStep = (step: typeof loudQuietPreview[number]) => {
    if (!loudQuietBandwidthModeEnabled) return step
    if (step === "L") return "W"
    if (step === "Q") return "N"
    return step
  }
  const threeLevelHitsLabel = hitMultiplier > 1 ? `, ${hitMultiplier} hits/level` : ""
  const loudQuietPreviewLabel = rowAlternationModeEnabled
    ? "Top / All / Bottom / All"
    : halfBandPatternEnabled
    ? "Bottom / Full / Top / Full"
    : threeLevelVolumeEnabled
      ? loudQuietBandwidthModeEnabled ? "N/M/W/M" : "Q/M/L/M"
    : loudQuietBandwidthModeEnabled
      ? `${loudQuietLoudCount}x W / ${loudQuietQuietCount}x N`
      : `${loudQuietLoudCount}x L / ${loudQuietQuietCount}x Q`
  const loudQuietPreviewLabelWithHits = threeLevelVolumeEnabled && !halfBandPatternEnabled && !rowAlternationModeEnabled
    ? `${loudQuietPreviewLabel}${threeLevelHitsLabel}`
    : loudQuietPreviewLabel
  const continuousHoldTargetsActive = continuousNoiseEnabled && continuousTargetsSequentialHoldEnabled
  const showContinuousLoudRatioControl =
    continuousNoiseEnabled &&
    (!continuousLeftRightLoudQuietEnabled || continuousHoldTargetsActive)
  const showLoudRatioControl =
    !threeLevelVolumeEnabled &&
    (showContinuousLoudRatioControl || straightLoudQuietNoiseEnabled || inverseDotNoiseEnabled)
  const loudRatioTip = inverseDotNoiseEnabled
    ? "Share of each inverse-dot loud/quiet hit block spent loud"
    : continuousNoiseEnabled
      ? "Share of each continuous loud/quiet cycle spent loud"
      : "Share of each held-noise loud/quiet cycle spent loud"

  const content = (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 transition-opacity duration-500 pointer-events-none opacity-100">
      <div
        className={cn(
          "rounded-xl glass-panel overflow-hidden transition-all duration-200 ease-out origin-bottom-right",
          collapsed
            ? "opacity-0 scale-95 translate-y-2 pointer-events-none"
            : "opacity-100 scale-100 translate-y-0 pointer-events-auto"
        )}
      >
        <div className="max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain p-4 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] dark:text-white/40 text-black/40 uppercase tracking-wider font-medium">
                {loudQuietPreviewLabelWithHits}
              </span>
              <span
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `repeat(${loudQuietPreview.length}, 0.85rem)` }}
              >
                {loudQuietPreview.map((step, index) => (
                  <span
                    key={`${step}-${index}`}
                    className={cn(
                      "rounded px-0.5 py-1 text-center text-[8px] font-medium uppercase",
                      step === "L" || step === "F" || step === "A"
                        ? "bg-cyan-300/25 text-cyan-950 dark:text-cyan-50"
                        : step === "M"
                          ? "dark:bg-white/15 bg-black/15 dark:text-white/75 text-black/70"
                        : "dark:bg-white/10 bg-black/10 dark:text-white/55 text-black/55"
                    )}
                  >
                    {formatLoudQuietStep(step)}
                  </span>
                ))}
              </span>
            </div>
            <Slider
              value={[loudQuietBlockSize]}
              min={1}
              max={8}
              step={1}
              disabled={threeLevelVolumeEnabled}
              className={threeLevelVolumeEnabled ? "opacity-35" : undefined}
              onValueChange={(value) => onLoudQuietBlockSizeChange(value[0] ?? loudQuietBlockSize)}
            />
            <div className="flex items-center justify-between">
              <Tip text={threeLevelVolumeEnabled ? "3-level sequential mode plays Q/M/L/M on one dot before advancing" : "Play the full loud/quiet block on one dot before advancing"}>
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Per dot</span>
              </Tip>
              <Switch
                checked={threeLevelVolumeEnabled || loudQuietPerDot}
                disabled={threeLevelVolumeEnabled}
                onCheckedChange={onLoudQuietPerDotChange}
                className={cn(
                  "h-5 w-9 data-[state=checked]:bg-cyan-400/70",
                  threeLevelVolumeEnabled && "opacity-60"
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text={loudQuietBandwidthModeEnabled ? "Use the narrow / medium / wide / medium bandwidth cycle" : "Use the Q/M/L/M cycle"}>
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">3-level</span>
              </Tip>
              <Switch
                checked={threeLevelVolumeEnabled}
                onCheckedChange={onThreeLevelVolumeEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Change filter width on each step while keeping hit volume loud">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Width</span>
              </Tip>
              <Switch
                checked={loudQuietBandwidthModeEnabled}
                onCheckedChange={onLoudQuietBandwidthModeEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Use bandpassed-noise hits that cycle bottom half, full band, top half, then full band">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Half band</span>
              </Tip>
              <Switch
                checked={halfBandPatternEnabled}
                onCheckedChange={onHalfBandPatternEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Gate continuous dot rows as top row, all rows, bottom row, all rows">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Rows alt</span>
              </Tip>
              <Switch
                checked={rowAlternationModeEnabled}
                onCheckedChange={onRowAlternationModeEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Run the first three selected dots as half notes, quarter notes, and a clave pattern on one shared tempo">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Rhythm</span>
              </Tip>
              <Switch
                checked={rhythmPatternEnabled}
                onCheckedChange={onRhythmPatternEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Keep the outside spectrum constant and pulse only the selected dot band">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Inverse dot</span>
              </Tip>
              <Switch
                checked={inverseDotNoiseEnabled}
                onCheckedChange={onInverseDotNoiseEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {inverseDotNoiseEnabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Width of the parametric-EQ dip carved out for each dot (thinner = narrower notch)">
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Dot width</span>
                  </Tip>
                  <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                    {inverseDotOutsideGapOctaves.toFixed(2)} oct
                  </span>
                </div>
                <Slider
                  value={[inverseDotOutsideGapOctaves]}
                  min={MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES}
                  max={MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES}
                  step={0.05}
                  onValueChange={(value) => onInverseDotOutsideGapChange(value[0] ?? inverseDotOutsideGapOctaves)}
                />
                <div className="flex items-center justify-between">
                  <Tip text="Peak gain each dip rises to on a hit (how far the notch fills in / boosts)">
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Dot boost</span>
                  </Tip>
                  <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                    {formatDb(inverseDotBandBoostDb)}
                  </span>
                </div>
                <Slider
                  value={[inverseDotBandBoostDb]}
                  min={MIN_INVERSE_DOT_BAND_BOOST_DB}
                  max={MAX_INVERSE_DOT_BAND_BOOST_DB}
                  step={1}
                  onValueChange={(value) => onInverseDotBandBoostChange(value[0] ?? inverseDotBandBoostDb)}
                />
              </div>
            )}
            {!threeLevelVolumeEnabled && (
              <div className="flex items-center justify-between">
                <Tip text="Invert the loud/quiet hit cycle for right-side dots">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Side L/Q</span>
                </Tip>
                <Switch
                  checked={sidePolarityLoudQuietEnabled}
                  onCheckedChange={onSidePolarityLoudQuietEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Tip text="Sustain selected dots as continuous bandpassed noise">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Continuous</span>
              </Tip>
              <Switch
                checked={continuousNoiseEnabled}
                onCheckedChange={onContinuousNoiseEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {!continuousNoiseEnabled && (
              <div className="flex items-center justify-between">
                <Tip text="Non-continuous noise: hold bandpassed noise through each loud/quiet span instead of triggering hit envelopes">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Held noise</span>
                </Tip>
                <Switch
                  checked={straightLoudQuietNoiseEnabled}
                  disabled={threeLevelVolumeEnabled}
                  onCheckedChange={onStraightLoudQuietNoiseEnabledChange}
                  className={cn(
                    "h-5 w-9 data-[state=checked]:bg-cyan-400/70",
                    threeLevelVolumeEnabled && "opacity-35"
                  )}
                />
              </div>
            )}
            {continuousNoiseEnabled && !continuousHoldTargetsActive && (
              <div className="flex items-center justify-between">
                <Tip text="Static continuous mode: left-side dots loud, right-side dots quiet">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">L/R</span>
                </Tip>
                <Switch
                  checked={continuousLeftRightLoudQuietEnabled}
                  onCheckedChange={onContinuousLeftRightLoudQuietEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            {showLoudRatioControl && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text={loudRatioTip}>
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Loud %</span>
                  </Tip>
                  <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                    {Math.round(continuousLoudRatio * 100)}%
                  </span>
                </div>
                <Slider
                  value={[continuousLoudRatio]}
                  min={0.01}
                  max={0.99}
                  step={0.01}
                  onValueChange={(value) => onContinuousLoudRatioChange(value[0] ?? continuousLoudRatio)}
                />
              </div>
            )}
            {continuousNoiseEnabled && !continuousLeftRightLoudQuietEnabled && !continuousHoldTargetsActive && (
              <div className="flex items-center justify-between">
                <Tip text={loudQuietBandwidthModeEnabled ? "Only right-clicked dots change bandwidth; the rest keep the current bandwidth" : "Only right-clicked dots change volume; the rest stay at medium"}>
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Targets</span>
                </Tip>
                <Switch
                  checked={continuousTargetsOnlyEnabled}
                  onCheckedChange={onContinuousTargetsOnlyEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Tip text={continuousNoiseEnabled ? "Keep right-clicked dots sustained as continuous bandpassed noise while the other selected dots sequence" : "Right-clicked dots hold continuously while the other selected dots sequence"}>
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Hold targets</span>
              </Tip>
              <Switch
                checked={continuousTargetsSequentialHoldEnabled}
                onCheckedChange={onContinuousTargetsSequentialHoldEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {continuousNoiseEnabled && !continuousLeftRightLoudQuietEnabled && !continuousHoldTargetsActive && (
              <div className="flex items-center justify-between">
                <Tip text="With exactly two dots, cycle LL / LQ / QQ / QL">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">2-dot</span>
                </Tip>
                <Switch
                  checked={continuousTwoDotAlternateEnabled}
                  onCheckedChange={onContinuousTwoDotAlternateEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            {continuousNoiseEnabled && continuousTwoDotAlternateEnabled && !continuousLeftRightLoudQuietEnabled && !continuousHoldTargetsActive && (
              <div className="flex items-center justify-between">
                <Tip text="With one selected dot, add a hidden second voice at that same location">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">1-loc</span>
                </Tip>
                <Switch
                  checked={singleLocationTwoDotEnabled}
                  onCheckedChange={onSingleLocationTwoDotEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            {continuousNoiseEnabled && !continuousHoldTargetsActive && (
              <div className="flex items-center justify-between">
                <Tip text="Step through selected dots in constant mode with a tiny gain ramp">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Seq</span>
                </Tip>
                <Switch
                  checked={continuousSequentialEnabled}
                  onCheckedChange={onContinuousSequentialEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            {continuousNoiseEnabled && continuousSequentialEnabled && !continuousHoldTargetsActive && (
              <div className="flex items-center justify-between">
                <Tip text="In sequential constant mode, advance by row and play each row together">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Rows</span>
                </Tip>
                <Switch
                  checked={continuousSequentialRowsEnabled}
                  onCheckedChange={onContinuousSequentialRowsEnabledChange}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Tip text="Drag a continuous noise source around the soundstage">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Drag</span>
              </Tip>
              <Switch
                checked={dragNoiseModeEnabled}
                onCheckedChange={onDragNoiseModeEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {dragNoiseModeEnabled && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Tip text="Number of continuous noise points in the dragged formation">
                      <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Pts</span>
                    </Tip>
                    <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                      {dragNoiseFormationCount}
                    </span>
                  </div>
                  <Slider
                    value={[dragNoiseFormationCount]}
                    min={1}
                    max={8}
                    step={1}
                    onValueChange={(value) => onDragNoiseFormationCountChange(value[0] ?? dragNoiseFormationCount)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Tip text="Spacing of the dragged continuous-noise formation">
                      <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Spread</span>
                    </Tip>
                    <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                      {Math.round(dragNoiseFormationSpread)}%
                    </span>
                  </div>
                  <Slider
                    value={[dragNoiseFormationSpread]}
                    min={0}
                    max={35}
                    step={1}
                    onValueChange={(value) => onDragNoiseFormationSpreadChange(value[0] ?? dragNoiseFormationSpread)}
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <Tip text="Draw a line for continuous-noise endpoint calibration or path motion">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Line</span>
              </Tip>
              <Switch
                checked={lineCalibrationEnabled}
                onCheckedChange={onLineCalibrationEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {lineCalibrationEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <Tip text="Move one continuous noise point along the drawn line at a constant pass rate">
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Path</span>
                  </Tip>
                  <Switch
                    checked={linePathMotionEnabled}
                    onCheckedChange={onLinePathMotionEnabledChange}
                    className="h-5 w-9 data-[state=checked]:bg-amber-400/75"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Tip text="Use inverse-dot noise on the moving line point, with a rapid pulsed dot band and a following not-dot bed">
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Inv path</span>
                  </Tip>
                  <Switch
                    checked={lineInverseDotPathEnabled}
                    onCheckedChange={onLineInverseDotPathEnabledChange}
                    className="h-5 w-9 data-[state=checked]:bg-fuchsia-400/70"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Tip text="Volume offset for the line start endpoint">
                        <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">A gain</span>
                      </Tip>
                      <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                        {formatDb(lineStartGainDb)}
                      </span>
                    </div>
                    <Slider
                      value={[lineStartGainDb]}
                      min={-60}
                      max={24}
                      step={1}
                      onValueChange={(value) => onLineStartGainChange(value[0] ?? lineStartGainDb)}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Tip text="Volume offset for the line end endpoint">
                        <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">B gain</span>
                      </Tip>
                      <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                        {formatDb(lineEndGainDb)}
                      </span>
                    </div>
                    <Slider
                      value={[lineEndGainDb]}
                      min={-60}
                      max={24}
                      step={1}
                      onValueChange={(value) => onLineEndGainChange(value[0] ?? lineEndGainDb)}
                    />
                  </div>
                </div>
                {!linePathMotionEnabled && (
                  <div className="flex items-center justify-between">
                    <Tip text="Use a vertical line plus a delayed panned copy line">
                      <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Square</span>
                    </Tip>
                    <Switch
                      checked={lineSquareModeEnabled}
                      onCheckedChange={onLineSquareModeEnabledChange}
                      className="h-5 w-9 data-[state=checked]:bg-fuchsia-400/70"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-2 rounded-lg dark:bg-white/[0.03] bg-black/[0.03] p-2">
            <div className="flex items-center justify-between">
              <Tip text="Alternate two full rows after a repeated block of passes">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Row cmp</span>
              </Tip>
              <Switch
                checked={rowCompareEnabled}
                onCheckedChange={onRowCompareEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>

            {rowCompareEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Tip text="Vertical position for row A">
                        <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">A row</span>
                      </Tip>
                      <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{rowCompareRowA + 1}</span>
                    </div>
                    <Slider
                      value={[rowCompareRowA]}
                      min={0}
                      max={Math.max(0, gridRows - 1)}
                      step={1}
                      onValueChange={(value) => onRowCompareRowAChange(value[0] ?? rowCompareRowA)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Tip text="Vertical position for row B">
                        <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">B row</span>
                      </Tip>
                      <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{rowCompareRowB + 1}</span>
                    </div>
                    <Slider
                      value={[rowCompareRowB]}
                      min={0}
                      max={Math.max(0, gridRows - 1)}
                      step={1}
                      onValueChange={(value) => onRowCompareRowBChange(value[0] ?? rowCompareRowB)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Tip text="Row passes before switching to the other row">
                      <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Repeats</span>
                    </Tip>
                    <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{rowCompareRepeats}x</span>
                  </div>
                  <Slider
                    value={[rowCompareRepeats]}
                    min={1}
                    max={32}
                    step={1}
                    onValueChange={(value) => onRowCompareRepeatsChange(value[0] ?? rowCompareRepeats)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Tip text="Gain offset for row A">
                        <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">A vol</span>
                      </Tip>
                      <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatDb(rowCompareVolumeADb)}</span>
                    </div>
                    <Slider
                      value={[rowCompareVolumeADb]}
                      min={-36}
                      max={24}
                      step={1}
                      onValueChange={(value) => onRowCompareVolumeAChange(value[0] ?? rowCompareVolumeADb)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Tip text="Gain offset for row B">
                        <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">B vol</span>
                      </Tip>
                      <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatDb(rowCompareVolumeBDb)}</span>
                    </div>
                    <Slider
                      value={[rowCompareVolumeBDb]}
                      min={-36}
                      max={24}
                      step={1}
                      onValueChange={(value) => onRowCompareVolumeBChange(value[0] ?? rowCompareVolumeBDb)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Interpolate volume from left to right across the grid">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">L/R grad</span>
              </Tip>
              <Switch
                checked={positionVolumeEnabled}
                onCheckedChange={onPositionVolumeEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {positionVolumeEnabled && (
              <div className="grid gap-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Tip text="Volume offset at the left edge">
                      <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">L vol</span>
                    </Tip>
                    <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                      {formatDb(positionVolumeLeftDb)}
                    </span>
                  </div>
                  <Slider
                    value={[positionVolumeLeftDb]}
                    min={-60}
                    max={24}
                    step={1}
                    onValueChange={(value) => onPositionVolumeLeftDbChange(value[0] ?? positionVolumeLeftDb)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Tip text="Volume offset at the right edge">
                      <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">R vol</span>
                    </Tip>
                    <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                      {formatDb(positionVolumeRightDb)}
                    </span>
                  </div>
                  <Slider
                    value={[positionVolumeRightDb]}
                    min={-60}
                    max={24}
                    step={1}
                    onValueChange={(value) => onPositionVolumeRightDbChange(value[0] ?? positionVolumeRightDb)}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text={threeLevelVolumeEnabled ? "Repeat each Q/M/L/M level this many times before advancing" : "Repeat each dot this many times before advancing"}>
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Hits</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{hitMultiplier}x</span>
            </div>
            <Slider
              value={[hitMultiplier]}
              min={1}
              max={32}
              step={1}
              onValueChange={(value) => onHitMultiplierChange(value[0] ?? hitMultiplier)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Spacing between consecutive hits inside the wave; lower values overlap more">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Stagger</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{hitStaggerPercent}%</span>
            </div>
            <Slider
              value={[hitStaggerPercent]}
              min={5}
              max={100}
              step={5}
              onValueChange={(value) => onHitStaggerPercentChange(value[0] ?? hitStaggerPercent)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Extra pause after a wave finishes before the next wave starts">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Wait</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatSeconds(waveWaitSeconds)}</span>
            </div>
            <Slider
              value={[waveWaitSeconds]}
              min={0}
              max={5}
              step={0.05}
              onValueChange={(value) => onWaveWaitSecondsChange(value[0] ?? waveWaitSeconds)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Shared volume LFO for every selected dot">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Vol osc</span>
              </Tip>
              <Switch
                checked={volumeOscillationEnabled}
                onCheckedChange={onVolumeOscillationEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Speed shared by all selected dots">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">
                  Speed
                </span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                {formatHz(volumeOscillationRateHz)}
              </span>
            </div>
            <Slider
              value={[volumeOscillationRateHz]}
              min={0.05}
              max={8}
              step={0.05}
              onValueChange={(value) => onVolumeOscillationRateHzChange(value[0] ?? volumeOscillationRateHz)}
            />
            <div className="flex items-center justify-between gap-2">
              <Tip text="Sine moves constantly; Hold rests equally at quiet and loud with quick smooth transitions">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">
                  Shape
                </span>
              </Tip>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border dark:border-white/10 border-black/10">
                {(["sine", "hold"] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => onVolumeOscillationShapeChange(shape)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors",
                      volumeOscillationShape === shape
                        ? "bg-cyan-400/70 text-cyan-950 dark:text-cyan-50"
                        : "dark:bg-white/[0.03] bg-black/[0.03] dark:text-white/45 text-black/45 hover:dark:text-white/70 hover:text-black/70"
                    )}
                  >
                    {shape}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Tip text="Lag each selected grid dot by phase in English reading order">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Wave</span>
              </Tip>
              <Switch
                checked={volumeOscillationWaveEnabled}
                onCheckedChange={onVolumeOscillationWaveEnabledChange}
                className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
              />
            </div>
            {volumeOscillationWaveEnabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Phase lag between adjacent selected dots in top-left to bottom-right order">
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Phase</span>
                  </Tip>
                  <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                    {Math.round(volumeOscillationWavePhase * 360)}deg
                  </span>
                </div>
                <Slider
                  value={[volumeOscillationWavePhase]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(value) => onVolumeOscillationWavePhaseChange(value[0] ?? volumeOscillationWavePhase)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Extra depth for the second selected dot, using the same shared speed">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Dot osc</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                {Math.round(selectionVolumeStepDb)} dB
              </span>
            </div>
            <Slider
              value={[selectionVolumeStepDb]}
              min={0}
              max={48}
              step={1}
              onValueChange={(value) => onSelectionVolumeStepChange(value[0] ?? selectionVolumeStepDb)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Tip text="Vertical grid resolution">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Rows</span>
                </Tip>
                <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{gridRows}</span>
              </div>
              <Slider
                value={[gridRows]}
                min={minRows}
                max={maxRows}
                step={1}
                onValueChange={(value) => onSetGridSize(value[0] ?? gridRows, gridCols)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Tip text="Horizontal grid resolution">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Cols</span>
                </Tip>
                <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{gridCols}</span>
              </div>
              <Slider
                value={[gridCols]}
                min={minCols}
                max={maxCols}
                step={1}
                onValueChange={(value) => onSetGridSize(gridRows, value[0] ?? gridCols)}
              />
            </div>
          </div>

          <div className="flex gap-5 justify-center">
            <div className="flex flex-col items-center gap-2">
              <Tip text="Overall timing and hit release length">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Spd</span>
              </Tip>
              <div className="h-28">
                <Slider
                  orientation="vertical"
                  value={[speed]}
                  min={0.05}
                  max={64}
                  step={0.05}
                  onValueChange={(value) => onSpeedChange(value[0] ?? speed)}
                />
              </div>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatSpeed(speed)}</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <Tip text="Master gain offset; center is the default level">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Vol</span>
              </Tip>
              <div className="h-28">
                <Slider
                  orientation="vertical"
                  value={[volumeDb]}
                  min={-24}
                  max={24}
                  step={1}
                  onValueChange={(value) => onVolumeChange(value[0] ?? volumeDb)}
                />
              </div>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatDb(volumeDb)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text={loudQuietBandwidthModeEnabled ? "Wide level for BW mode; narrow is fixed below it" : "Width of each dot's bandpassed click"}>
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Bandwidth</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                {bandwidth < 1 ? bandwidth.toFixed(2) : bandwidth.toFixed(1)} oct
              </span>
            </div>
            <Slider
              value={[bandwidth]}
              min={0.25}
              max={8.5}
              step={0.05}
              onValueChange={(value) => onBandwidthChange(value[0] ?? bandwidth)}
            />
            <div className="flex items-center justify-between">
              <Tip text="Use a very wide band with soft spectral falloff instead of tight edges">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Gentle</span>
              </Tip>
              <div className="flex items-center gap-2">
                <span className="text-[10px] dark:text-white/55 text-black/55 tabular-nums">
                  {bandwidthFilterMode === "narrow-gentle"
                    ? `${gentleEdgeFalloffDbPerOct.toFixed(1)} dB/oct`
                    : "tight"}
                </span>
                <Switch
                  checked={bandwidthFilterMode === "narrow-gentle"}
                  onCheckedChange={(checked) => onBandwidthFilterModeChange(checked ? "narrow-gentle" : "wide-tight")}
                  className="h-5 w-9 data-[state=checked]:bg-cyan-400/70"
                />
              </div>
            </div>
            {bandwidthFilterMode === "narrow-gentle" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Slope of the soft falloff outside the selected bandwidth">
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Sharp</span>
                  </Tip>
                  <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                    {gentleEdgeFalloffDbPerOct.toFixed(1)} dB/oct
                  </span>
                </div>
                <Slider
                  value={[gentleEdgeFalloffDbPerOct]}
                  min={MIN_GENTLE_EDGE_FALLOFF_DB_PER_OCT}
                  max={MAX_GENTLE_EDGE_FALLOFF_DB_PER_OCT}
                  step={0.5}
                  onValueChange={(value) => onGentleEdgeFalloffChange(value[0] ?? gentleEdgeFalloffDbPerOct)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Quiet hit level relative to the loud hit">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Quiet</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatDb(quietLevelDb)}</span>
            </div>
            <Slider
              value={[quietLevelDb]}
              min={-60}
              max={0}
              step={1}
              onValueChange={(value) => onQuietLevelChange(value[0] ?? quietLevelDb)}
            />
          </div>
        </div>
      </div>

      <button
        onClick={onToggle}
        className={cn(
          "glass-panel rounded-lg p-2.5 transition-colors flex-shrink-0 pointer-events-auto",
          collapsed
            ? "dark:text-white/70 text-black/50 dark:hover:text-white hover:text-black"
            : "dark:text-white text-black dark:bg-white/10 bg-black/10"
        )}
        aria-label={collapsed ? "Open settings" : "Close settings"}
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  )

  const minimalContent = (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 transition-opacity duration-500 pointer-events-none opacity-100">
      <div
        className={cn(
          "rounded-xl glass-panel overflow-hidden transition-all duration-200 ease-out origin-bottom-right",
          collapsed
            ? "opacity-0 scale-95 translate-y-2 pointer-events-none"
            : "opacity-100 scale-100 translate-y-0 pointer-events-auto"
        )}
      >
        <div className="w-64 max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain p-4 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Master hit volume">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Volume</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{formatDb(volumeDb)}</span>
            </div>
            <Slider
              value={[volumeDb]}
              min={-24}
              max={24}
              step={1}
              onValueChange={(value) => onVolumeChange(value[0] ?? volumeDb)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Bandpass width of each noise hit, in octaves">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Bandwidth</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{bandwidth.toFixed(2)} oct</span>
            </div>
            <Slider
              value={[bandwidth]}
              min={0.25}
              max={8.5}
              step={0.05}
              onValueChange={(value) => onBandwidthChange(value[0] ?? bandwidth)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Fade-in time of each hit">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Attack</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{Math.round(attackMs)} ms</span>
            </div>
            <Slider
              value={[attackMs]}
              min={1}
              max={200}
              step={1}
              onValueChange={(value) => onAttackMsChange(value[0] ?? attackMs)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Fade-out time of each hit">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Release</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{Math.round(releaseMs)} ms</span>
            </div>
            <Slider
              value={[releaseMs]}
              min={20}
              max={2000}
              step={10}
              onValueChange={(value) => onReleaseMsChange(value[0] ?? releaseMs)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Time between consecutive hits — shorter than the release lets hits overlap">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Spacing</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{Math.round(hitSpacingMs)} ms</span>
            </div>
            <Slider
              value={[hitSpacingMs]}
              min={30}
              max={2000}
              step={10}
              onValueChange={(value) => onHitSpacingMsChange(value[0] ?? hitSpacingMs)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Repeat each dot at this many volume levels per cycle (quiet→loud→quiet)">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Depth</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{depth <= 1 ? "off" : `${depth} levels`}</span>
            </div>
            <Slider
              value={[depth]}
              min={1}
              max={8}
              step={1}
              onValueChange={(value) => onDepthChange(value[0] ?? depth)}
            />
          </div>

          <div className={cn("space-y-2", depth <= 1 && "opacity-35")}>
            <div className="flex items-center justify-between">
              <Tip text="Total dB spread from the quietest to the loudest depth level — more levels split it into smaller steps">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Depth range</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{depthGapDb.toFixed(0)} dB</span>
            </div>
            <Slider
              value={[depthGapDb]}
              min={0}
              max={60}
              step={1}
              disabled={depth <= 1}
              onValueChange={(value) => onDepthGapDbChange(value[0] ?? depthGapDb)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Tip text="Boost the first dot and quiet the last (playback order, left→right / top→bottom); dots in between interpolate">
                <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Balance</span>
              </Tip>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                {dotBalanceDb === 0 ? "even" : `${formatDb(dotBalanceDb)} / ${formatDb(-dotBalanceDb)}`}
              </span>
            </div>
            <Slider
              value={[dotBalanceDb]}
              min={-24}
              max={24}
              step={1}
              onValueChange={(value) => onDotBalanceDbChange(value[0] ?? dotBalanceDb)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Tip text="Sweep the dot order back and forth (A B C B A…) instead of looping one way">
              <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Back &amp; forth</span>
            </Tip>
            <Switch checked={pingPongEnabled} onCheckedChange={onPingPongEnabledChange} />
          </div>
        </div>
      </div>

      <button
        onClick={onToggle}
        className={cn(
          "glass-panel rounded-lg p-2.5 transition-colors flex-shrink-0 pointer-events-auto",
          collapsed
            ? "dark:text-white/70 text-black/50 dark:hover:text-white hover:text-black"
            : "dark:text-white text-black dark:bg-white/10 bg-black/10"
        )}
        aria-label={collapsed ? "Open settings" : "Close settings"}
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  )

  if (!mounted) return null
  return createPortal(SHOW_ALL_SETTINGS ? content : minimalContent, document.body)
}
