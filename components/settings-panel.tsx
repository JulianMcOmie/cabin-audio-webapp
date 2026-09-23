"use client"

import { Settings } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { BandwidthFilterMode, VolumeOscillationShape } from "@/lib/audio/dotGridAudio"

interface SettingsPanelProps {
  rowWiseEnabled: boolean
  onRowWiseChange: (enabled: boolean) => void
  columnWiseEnabled: boolean
  onColumnWiseChange: (enabled: boolean) => void
  depthAfterPass: boolean
  onDepthAfterPassChange: (enabled: boolean) => void
  rowRepeatEnabled: boolean
  onRowRepeatChange: (enabled: boolean) => void
  lowerEdgeSineEnabled: boolean
  onLowerEdgeSineChange: (enabled: boolean) => void
  lowerEdgeSineVolumeDb: number
  onLowerEdgeSineVolumeChange: (value: number) => void
  continuousReleaseMs: number
  onContinuousReleaseChange: (value: number) => void
  selectedDotCount: number
  pulseOverlapEnabled: boolean
  onPulseOverlapChange: (enabled: boolean) => void
  rectangleAlternationEnabled: boolean
  onRectangleAlternationChange: (enabled: boolean) => void
  rectangleAlternationSeconds: number
  onRectangleAlternationSecondsChange: (seconds: number) => void
  rectangleSelectionValid: boolean
  simultaneousHeightEnabled: boolean
  onSimultaneousHeightChange: (enabled: boolean) => void
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
  loudnessSwapEnabled: boolean
  balanceAlternateHits: number
  onBalanceAlternateHitsChange: (value: number) => void
  onLoudnessSwapEnabledChange: (value: boolean) => void
  depth: number
  onDepthChange: (value: number) => void
  depthPerDot: boolean
  bandwidthLevels: number
  onBandwidthLevelsChange: (value: number) => void
  onDepthPerDotChange: (value: boolean) => void
  depthGapDb: number
  onDepthGapDbChange: (value: number) => void
  bandwidthRangeOctaves: number
  onBandwidthRangeOctavesChange: (value: number) => void
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

function Control({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-black/60 dark:text-white/60">{label}</span>
        <span className="tabular-nums">{display}</span>
      </div>
      <Slider aria-label={label} value={[value]} min={min} max={max} step={step}
        onValueChange={([next]) => { if (next !== undefined) onChange(next) }} />
    </div>
  )
}

function SpeedControl({ seconds, onChange, minSeconds = 0.05, maxSeconds = 30 }: {
  seconds: number; onChange: (seconds: number) => void; minSeconds?: number; maxSeconds?: number
}) {
  const minRate = 1 / maxSeconds
  const maxRate = 1 / minSeconds
  const rate = 1 / Math.max(minSeconds, Math.min(maxSeconds, seconds))
  return <Control label="Speed" value={(rate - minRate) / (maxRate - minRate) * 100}
    display={`${rate.toFixed(2)}/s · ${seconds < 0.1 ? `${(seconds * 1000).toFixed(2)} ms` : `${seconds.toFixed(2)} s`}`}
    min={0} max={100} step={0.01}
    onChange={value => onChange(1 / (minRate + value / 100 * (maxRate - minRate)))} />
}

export function SettingsPanel({
  rowWiseEnabled, onRowWiseChange,
  columnWiseEnabled, onColumnWiseChange,
  depthAfterPass, onDepthAfterPassChange,
  selectedDotCount,
  rectangleAlternationSeconds, onRectangleAlternationSecondsChange,
  collapsed, onToggle, simultaneousHeightEnabled, onSimultaneousHeightChange,
  continuousNoiseEnabled, onContinuousNoiseEnabledChange,
  volumeDb, onVolumeChange, attackMs, onAttackMsChange,
  hitSpacingMs, onHitSpacingMsChange,
  depth, onDepthChange, depthGapDb, onDepthGapDbChange,
  hitMultiplier, onHitMultiplierChange,
}: SettingsPanelProps) {
  const grouped = rowWiseEnabled || columnWiseEnabled
  const playbackUnit = columnWiseEnabled ? "column" : rowWiseEnabled ? "row" : "dot"
  const simultaneous = simultaneousHeightEnabled && !grouped
  return (
    <div className={`flex w-full min-w-0 flex-col items-end gap-2 ${collapsed ? "lg:w-12" : "lg:w-72"}`}>
      <button type="button" onClick={onToggle} className="glass-panel flex items-center gap-2 rounded-lg p-2.5" aria-expanded={!collapsed} aria-controls="dot-grid-settings" aria-label={collapsed ? "Open settings" : "Close settings"}>
        <Settings className="h-5 w-5" />
        {!collapsed && <span className="text-xs">Settings</span>}
      </button>
      {!collapsed && (
        <div id="dot-grid-settings" className="glass-panel w-full max-h-[65dvh] overflow-y-auto overscroll-contain rounded-xl p-4 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="row-wise" className="text-xs font-medium">Row-wise</label>
              <Switch id="row-wise" checked={rowWiseEnabled} onCheckedChange={onRowWiseChange} />
            </div>
            <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Play selected dots in each row together, moving from top to bottom and skipping empty rows. Depth and speed apply to each row.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="column-wise" className="text-xs font-medium">Column-wise</label>
              <Switch id="column-wise" checked={columnWiseEnabled} onCheckedChange={onColumnWiseChange} />
            </div>
            <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Play selected dots in each column together, moving from left to right and skipping empty columns. Depth and speed apply to each column.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="continuous-noise" className="text-xs font-medium">Continuous noise</label>
              <Switch id="continuous-noise" checked={continuousNoiseEnabled} onCheckedChange={onContinuousNoiseEnabledChange} />
            </div>
            {continuousNoiseEnabled && depth <= 1 && <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Speed controls one playback step per interval, regardless of how many dots are selected.</p>}
            {continuousNoiseEnabled && depth > 1 && <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Each playback step lasts {rectangleAlternationSeconds.toFixed(2)} seconds. {depthAfterPass ? "Play all selected notes at the current depth before advancing depth; jump back to level 0 after the highest level." : "Climb from quiet to loud, then reset to level 0 at the next position."} More levels extend the sequence without changing the step pace.</p>}
            {continuousNoiseEnabled && !grouped && selectedDotCount > 2 && <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Selected dots play one at a time in playback order. Their positions stay fixed.</p>}
            {continuousNoiseEnabled && <SpeedControl seconds={rectangleAlternationSeconds} onChange={onRectangleAlternationSecondsChange} />}
          </div>
          {!continuousNoiseEnabled && !grouped && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="simultaneous-height" className="text-xs font-medium">Simultaneous dots</label>
              <Switch id="simultaneous-height" checked={simultaneousHeightEnabled} onCheckedChange={onSimultaneousHeightChange} />
            </div>
            <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">
              {simultaneous
                ? "All dots start together. Bottom dots play once per cycle; higher dots play up to four times, with shorter releases."
                : depthAfterPass ? "Play all selected notes at one depth, repeat the pass as requested, then advance depth."
                : "Each note finishes all repeats at every depth level before the next note starts."}
            </p>
          </div>
          )}
          <Control label="Volume" value={volumeDb} display={volumeDb + " dB"} min={-24} max={24} step={1} onChange={onVolumeChange} />
          {!continuousNoiseEnabled && <>
          <Control label="Attack" value={attackMs} display={Math.round(attackMs) + " ms"} min={1} max={200} step={1} onChange={onAttackMsChange} />
          <SpeedControl seconds={hitSpacingMs * (simultaneous ? 4 : 1) / 1000}
            minSeconds={simultaneous ? 0.05 : 0.02} maxSeconds={simultaneous ? 8 : 2}
            onChange={seconds => onHitSpacingMsChange(seconds * 1000 / (simultaneous ? 4 : 1))} />
          </>}
          <Control label="Depth levels" value={depth} display={depth <= 1 ? "Off" : depth + " levels"} min={1} max={8} step={1} onChange={onDepthChange} />
          <Control label="Depth range" value={depthGapDb} display={depthGapDb.toFixed(0) + " dB"} min={0} max={60} step={1} onChange={onDepthGapDbChange} />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="depth-after-pass" className="text-xs font-medium">Depth after full pass</label>
              <Switch id="depth-after-pass" checked={depthAfterPass} onCheckedChange={onDepthAfterPassChange} />
            </div>
            {depthAfterPass && <>
              <Control label="Passes per depth" value={hitMultiplier} display={hitMultiplier + "×"} min={1} max={32} step={1} onChange={onHitMultiplierChange} />
              <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Hold the same depth for {hitMultiplier} full {hitMultiplier === 1 ? "pass" : "passes"}, then move to the next depth level. Uses the same count as Repeats per depth; choose 1× to advance after every pass.</p>
            </>}
          </div>
          {continuousNoiseEnabled && <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">Choose 2–8 levels to climb from quiet to loud, then jump straight back to level 0. Set depth to Off for one step per {playbackUnit}.</p>}
          {!continuousNoiseEnabled && <>
          {!depthAfterPass && !simultaneous && <Control label="Repeats per depth" value={hitMultiplier} display={hitMultiplier + "×"} min={1} max={32} step={1} onChange={onHitMultiplierChange} />}
          <p className="text-[11px] leading-relaxed text-black/50 dark:text-white/50">
            {depthAfterPass
              ? "Complete the requested passes at each depth, climbing quiet → loud and resetting to level 0 at the same playback speed."
              : simultaneous
              ? "Depth climbs quiet → loud, then jumps back to level 0. Simultaneous dots keep their height-based rhythms at each depth level."
              : `Repeat each depth level on one ${playbackUnit}, climb to the highest level, then reset to level 0 on the next ${playbackUnit}.`}
          </p>
          </>}
        </div>
      )}
    </div>
  )
}
