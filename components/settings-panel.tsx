"use client"

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Settings, ChevronLeft } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Instant tooltip — no hover delay, positioned above the trigger
// ---------------------------------------------------------------------------

function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ left: 0, top: 0, visibility: 'hidden' })

  useEffect(() => {
    if (!show || !triggerRef.current || !tipRef.current) return
    const tr = triggerRef.current.getBoundingClientRect()
    const tp = tipRef.current.getBoundingClientRect()
    const pad = 6

    // Default: centered above
    let x = tr.left + tr.width / 2 - tp.width / 2
    let y = tr.top - pad - tp.height

    // Clamp horizontal
    if (x < pad) x = pad
    if (x + tp.width > window.innerWidth - pad) x = window.innerWidth - pad - tp.width

    // If clipped above, flip below
    if (y < pad) y = tr.bottom + pad

    setStyle({ left: x, top: y, visibility: 'visible' })
  }, [show])

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => { setShow(false); setStyle(s => ({ ...s, visibility: 'hidden' })) }}
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
  freeformModeEnabled: boolean
  onFreeformModeChange: (enabled: boolean) => void
  onClearFreeformDots: () => void
  minRows: number
  maxRows: number
  minCols: number
  maxCols: number
  onSetGridSize: (rows: number, cols: number) => void
  speed: number
  onSpeedChange: (value: number) => void
  volumePercent: number
  onVolumeChange: (value: number) => void
  release: number
  effectiveRelease: number
  releaseAuto: boolean
  releaseAutoOffsetMs: number
  onReleaseChange: (value: number) => void
  onReleaseAutoChange: (enabled: boolean) => void
  onReleaseAutoOffsetMsChange: (value: number) => void
  bandwidth: number
  onBandwidthChange: (value: number) => void
  bandwidthOscillationEnabled: boolean
  onBandwidthOscillationChange: (enabled: boolean) => void
  depth: number
  onDepthChange: (value: number) => void
  hiHatModeEnabled: boolean
  onHiHatModeChange: (enabled: boolean) => void
  patternModeEnabled: boolean
  onPatternModeChange: (enabled: boolean) => void
  patternVolumeDiffDb: number
  onPatternVolumeDiffDbChange: (value: number) => void
  reverbModeEnabled: boolean
  onReverbModeChange: (enabled: boolean) => void
  reverbVolumeSpreadDb: number
  onReverbVolumeSpreadDbChange: (value: number) => void
  hiHatQuietDropDb: number
  onHiHatQuietDropDbChange: (value: number) => void
  hiHatLoudReleaseBoostMs: number
  onHiHatLoudReleaseBoostMsChange: (value: number) => void
  repeatCount: number
  onRepeatCountChange: (value: number) => void
  depthGapDb: number
  onDepthGapDbChange: (value: number) => void
  eqABEnabled: boolean
  onEqABChange: (enabled: boolean) => void
  flatSlope: boolean
  onFlatSlopeChange: (enabled: boolean) => void
  additivePartialsEnabled: boolean
  onAdditivePartialsChange: (enabled: boolean) => void
  clickTrainEnabled: boolean
  onClickTrainChange: (enabled: boolean) => void
  clickTrainVolumePercent: number
  onClickTrainVolumeChange: (value: number) => void
  referenceVolumeBalance: number
  onReferenceVolumeBalanceChange: (value: number) => void
  referenceVolumeOffsetDb: number
  onReferenceVolumeOffsetDbChange: (value: number) => void
  referenceVolumeOscillationEnabled: boolean
  onReferenceVolumeOscillationChange: (enabled: boolean) => void
  allVolumeOscillationEnabled: boolean
  onAllVolumeOscillationChange: (enabled: boolean) => void
  referenceVolumeMultiplyCount: number
  onReferenceVolumeMultiplyCountChange: (value: number) => void
  isPlaying?: boolean
}

// ---------------------------------------------------------------------------
// Mini grid picker — hover over cells to preview, click to set dimensions
// ---------------------------------------------------------------------------

function GridSizePicker({
  rows,
  cols,
  minRows,
  maxRows,
  minCols,
  maxCols,
  onSetSize,
}: {
  rows: number
  cols: number
  minRows: number
  maxRows: number
  minCols: number
  maxCols: number
  onSetSize: (rows: number, cols: number) => void
}) {
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  const [hoverCol, setHoverCol] = useState<number | null>(null)

  const previewRows = hoverRow ?? rows
  const previewCols = hoverCol ?? cols

  const handleCellClick = useCallback(() => {
    if (hoverRow !== null && hoverCol !== null) {
      onSetSize(hoverRow, hoverCol)
    }
  }, [hoverRow, hoverCol, onSetSize])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Tip text="Number of dots — rows set the pitch range, columns set the stereo spread"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Grid Size</span></Tip>
        <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
          {previewRows} × {previewCols}
        </span>
      </div>
      <div
        className="inline-grid gap-[3px] p-1.5 rounded-lg dark:bg-white/5 bg-black/5 dark:border-white/5 border-black/5 border"
        style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}
        onMouseLeave={() => { setHoverRow(null); setHoverCol(null) }}
      >
        {Array.from({ length: maxRows }, (_, r) => {
          const row = r + 1
          return Array.from({ length: maxCols }, (_, c) => {
            const col = c + 1
            const isWithinCurrent = row <= rows && col <= cols
            const isWithinHover = hoverRow !== null && hoverCol !== null && row <= hoverRow && col <= hoverCol

            return (
              <button
                key={`${r}-${c}`}
                type="button"
                className={cn(
                  "w-[14px] h-[14px] rounded-[2px] transition-colors duration-75",
                  isWithinHover
                    ? "bg-cyan-400/60 border border-cyan-400/80"
                    : isWithinCurrent
                      ? "dark:bg-white/20 bg-black/20 dark:border-white/15 border-black/15"
                      : "dark:bg-white/[0.04] bg-black/[0.04] dark:border-white/[0.06] border-black/[0.06]"
                )}
                onMouseEnter={() => {
                  setHoverRow(Math.max(row, minRows))
                  setHoverCol(Math.max(col, minCols))
                }}
                onClick={handleCellClick}
              />
            )
          })
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings Panel
// ---------------------------------------------------------------------------

export function SettingsPanel({
  collapsed,
  onToggle,
  gridRows,
  gridCols,
  freeformModeEnabled,
  onFreeformModeChange,
  onClearFreeformDots,
  minRows,
  maxRows,
  minCols,
  maxCols,
  onSetGridSize,
  speed,
  onSpeedChange,
  volumePercent,
  onVolumeChange,
  release,
  effectiveRelease,
  releaseAuto,
  releaseAutoOffsetMs,
  onReleaseChange,
  onReleaseAutoChange,
  onReleaseAutoOffsetMsChange,
  bandwidth,
  onBandwidthChange,
  bandwidthOscillationEnabled,
  onBandwidthOscillationChange,
  depth,
  onDepthChange,
  hiHatModeEnabled,
  onHiHatModeChange,
  patternModeEnabled,
  onPatternModeChange,
  patternVolumeDiffDb,
  onPatternVolumeDiffDbChange,
  reverbModeEnabled,
  onReverbModeChange,
  reverbVolumeSpreadDb,
  onReverbVolumeSpreadDbChange,
  hiHatQuietDropDb,
  onHiHatQuietDropDbChange,
  hiHatLoudReleaseBoostMs,
  onHiHatLoudReleaseBoostMsChange,
  repeatCount,
  onRepeatCountChange,
  depthGapDb,
  onDepthGapDbChange,
  eqABEnabled,
  onEqABChange,
  flatSlope,
  onFlatSlopeChange,
  additivePartialsEnabled,
  onAdditivePartialsChange,
  clickTrainEnabled,
  onClickTrainChange,
  clickTrainVolumePercent,
  onClickTrainVolumeChange,
  referenceVolumeBalance,
  onReferenceVolumeBalanceChange,
  referenceVolumeOffsetDb,
  onReferenceVolumeOffsetDbChange,
  referenceVolumeOscillationEnabled,
  onReferenceVolumeOscillationChange,
  allVolumeOscillationEnabled,
  onAllVolumeOscillationChange,
  referenceVolumeMultiplyCount,
  onReferenceVolumeMultiplyCountChange,
}: SettingsPanelProps) {
  const [mounted, setMounted] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  useEffect(() => setMounted(true), [])

  const content = (
    <div className={cn(
      "fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 transition-opacity duration-500 pointer-events-none",
      "opacity-100"
    )}>
      {/* Panel area — horizontal flex: advanced (left) + main (right) */}
      <div className={cn(
        "flex flex-row items-stretch gap-2 transition-all duration-200 ease-out origin-bottom-right",
        collapsed
          ? "opacity-0 scale-95 translate-y-2 pointer-events-none"
          : "opacity-100 scale-100 translate-y-0"
      )}>
        {/* Advanced panel — appears to the left */}
        <div
          className={cn(
            "rounded-xl glass-panel overflow-hidden transition-all duration-200 ease-out origin-bottom-right",
            !collapsed && advancedOpen && "pointer-events-auto",
            advancedOpen
              ? "opacity-100 scale-100 translate-x-0"
              : "opacity-0 scale-95 translate-x-4 pointer-events-none w-0 p-0 border-0"
          )}
        >
          {advancedOpen && (
            <div className="p-4 space-y-4 flex flex-col justify-center h-full">
              <GridSizePicker
                rows={gridRows}
                cols={gridCols}
                minRows={minRows}
                maxRows={maxRows}
                minCols={minCols}
                maxCols={maxCols}
                onSetSize={onSetGridSize}
              />
              <div className="flex items-center justify-between">
                <Tip text="Click anywhere to add a movable dot instead of selecting from the grid">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Freeform dots</span>
                </Tip>
                <Switch
                  checked={freeformModeEnabled}
                  onCheckedChange={onFreeformModeChange}
                />
              </div>
              {freeformModeEnabled && (
                <button
                  type="button"
                  className="text-[10px] font-medium dark:text-white/35 text-black/35 dark:hover:text-white/60 hover:text-black/60 hover:dark:bg-white/[0.05] hover:bg-black/[0.04] px-2 py-1 rounded-md transition-colors"
                  onClick={onClearFreeformDots}
                >
                  Clear freeform dots
                </button>
              )}
              {/* Release time slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="How long each dot's sound rings out before fading to silence"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Release</span></Tip>
                  <div className="flex items-center gap-2">
                    <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                      {effectiveRelease < 1 ? `${Math.round(effectiveRelease * 1000)}ms` : `${effectiveRelease.toFixed(1)}s`}
                    </span>
                    <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Auto</span>
                    <Switch
                      checked={releaseAuto}
                      onCheckedChange={onReleaseAutoChange}
                    />
                  </div>
                </div>
                <Slider
                  value={[release]}
                  min={0.05}
                  max={3}
                  step={0.05}
                  disabled={releaseAuto}
                  className={releaseAuto ? "opacity-45" : undefined}
                  onValueChange={(v) => onReleaseChange(v[0])}
                />
              </div>
              {/* Auto release offset slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Adds a fixed offset to the auto-calculated release time">
                    <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Auto release +ms</span>
                  </Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {releaseAutoOffsetMs > 0 ? "+" : ""}{releaseAutoOffsetMs.toFixed(0)}ms
                  </span>
                </div>
                <Slider
                  value={[releaseAutoOffsetMs]}
                  min={-100}
                  max={500}
                  step={5}
                  disabled={!releaseAuto}
                  className={!releaseAuto ? "opacity-45" : undefined}
                  onValueChange={(v) => onReleaseAutoOffsetMsChange(v[0])}
                />
              </div>
              {/* Bandwidth slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Distance between hi/lo pass filters — controls how wide each dot's frequency band is"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Bandwidth</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {bandwidthOscillationEnabled ? "2-6 oct" : `${bandwidth.toFixed(1)} oct`}
                  </span>
                </div>
                <Slider
                  value={[bandwidth]}
                  min={1}
                  max={8.5}
                  step={0.1}
                  disabled={bandwidthOscillationEnabled}
                  className={bandwidthOscillationEnabled ? "opacity-45" : undefined}
                  onValueChange={(v) => onBandwidthChange(v[0])}
                />
              </div>
              {/* Bandwidth oscillation controls */}
              <div className="flex items-center justify-between">
                <Tip text="Sequences bandwidth like hi-hat accents: 6-2-2-2-4-2-2-2 octaves">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Bandwidth osc</span>
                </Tip>
                <Switch
                  checked={bandwidthOscillationEnabled}
                  onCheckedChange={onBandwidthOscillationChange}
                />
              </div>
              {/* Depth slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Number of volume-ramped hits per dot — plays each position multiple times from quiet to loud"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Depth</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {depth}x
                  </span>
                </div>
                <Slider
                  value={[depth]}
                  min={1}
                  max={4}
                  step={1}
                  onValueChange={(v) => onDepthChange(v[0])}
                />
              </div>
              {/* Hi-hat mode toggle */}
              <div className="flex items-center justify-between">
                <Tip text="One selected dot plays loud-quiet-quiet-quiet-quiet-quiet-quiet-quiet">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Hi-hat</span>
                </Tip>
                <Switch
                  checked={hiHatModeEnabled}
                  onCheckedChange={onHiHatModeChange}
                />
              </div>
              <div className="flex items-center justify-between">
                <Tip text="With exactly three selected dots, plays 1-2-2-2-3-2-2-2 in reading order">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Pattern</span>
                </Tip>
                <Switch
                  checked={patternModeEnabled}
                  onCheckedChange={onPatternModeChange}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Two-dot pattern mode only: dot 2 volume relative to dot 1">
                    <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Pattern diff</span>
                  </Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {patternVolumeDiffDb > 0 ? "+" : ""}{patternVolumeDiffDb.toFixed(0)} dB
                  </span>
                </div>
                <Slider
                  value={[patternVolumeDiffDb]}
                  min={-24}
                  max={24}
                  step={1}
                  disabled={!patternModeEnabled}
                  className={!patternModeEnabled ? "opacity-45" : undefined}
                  onValueChange={(v) => onPatternVolumeDiffDbChange(v[0])}
                />
              </div>
              <div className="flex items-center justify-between">
                <Tip text="Like hi-hat, but quiet hits smoothly swell between quiet and just under loud">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Reverb</span>
                </Tip>
                <Switch
                  checked={reverbModeEnabled}
                  onCheckedChange={onReverbModeChange}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Reverb mode spacing: loud is 0 dB, medium is -spread, quiet is -2x spread">
                    <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Reverb spread</span>
                  </Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {reverbVolumeSpreadDb.toFixed(0)} dB
                  </span>
                </div>
                <Slider
                  value={[reverbVolumeSpreadDb]}
                  min={0}
                  max={30}
                  step={1}
                  disabled={!reverbModeEnabled}
                  className={!reverbModeEnabled ? "opacity-45" : undefined}
                  onValueChange={(v) => onReverbVolumeSpreadDbChange(v[0])}
                />
              </div>
              {/* Hi-hat volume difference slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="How much quieter the quiet hi-hat hits are than the loud accent">
                    <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Hat quiet</span>
                  </Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    -{hiHatQuietDropDb.toFixed(0)} dB
                  </span>
                </div>
                <Slider
                  value={[hiHatQuietDropDb]}
                  min={0}
                  max={80}
                  step={1}
                  disabled={!hiHatModeEnabled && !patternModeEnabled}
                  className={!hiHatModeEnabled && !patternModeEnabled ? "opacity-45" : undefined}
                  onValueChange={(v) => onHiHatQuietDropDbChange(v[0])}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Adds release time to loud hi-hat accents and the first hit of each pattern cycle">
                    <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Accent release</span>
                  </Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    +{hiHatLoudReleaseBoostMs.toFixed(0)}ms
                  </span>
                </div>
                <Slider
                  value={[hiHatLoudReleaseBoostMs]}
                  min={0}
                  max={1000}
                  step={5}
                  disabled={!hiHatModeEnabled && !patternModeEnabled && !reverbModeEnabled}
                  className={!hiHatModeEnabled && !patternModeEnabled && !reverbModeEnabled ? "opacity-45" : undefined}
                  onValueChange={(v) => onHiHatLoudReleaseBoostMsChange(v[0])}
                />
              </div>
              {/* Repeat count slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Repeats every hit in the current sequence before moving to the next hit. 2x turns a-gold into a-a-gold-gold."><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Repeat 2x</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {repeatCount.toFixed(0)}x
                  </span>
                </div>
                <Slider
                  value={[repeatCount]}
                  min={1}
                  max={8}
                  step={1}
                  onValueChange={(v) => onRepeatCountChange(v[0])}
                />
              </div>
              {/* Depth gap slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="How much quieter each lower depth layer is before the next louder layer. Higher values make the quiet-first sweep more dramatic."><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Depth gap</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {depthGapDb.toFixed(0)} dB
                  </span>
                </div>
                <Slider
                  value={[depthGapDb]}
                  min={0}
                  max={40}
                  step={1}
                  onValueChange={(v) => onDepthGapDbChange(v[0])}
                />
              </div>
              {/* Reference balance slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="With exactly three selected dots and a gold dot, gold stays at middle volume while the other two tilt quieter/louder around it."><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Ref balance</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {referenceVolumeBalance > 0 ? "+" : ""}{referenceVolumeBalance.toFixed(0)}
                  </span>
                </div>
                <Slider
                  value={[referenceVolumeBalance]}
                  min={-100}
                  max={100}
                  step={1}
                  onValueChange={(v) => onReferenceVolumeBalanceChange(v[0])}
                />
              </div>
              {/* Gold volume slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Offsets only the gold dot volume while keeping the same playback pattern"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Gold volume</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {referenceVolumeOffsetDb > 0 ? "+" : ""}{referenceVolumeOffsetDb.toFixed(0)} dB
                  </span>
                </div>
                <Slider
                  value={[referenceVolumeOffsetDb]}
                  min={-24}
                  max={24}
                  step={1}
                  onValueChange={(v) => onReferenceVolumeOffsetDbChange(v[0])}
                />
              </div>
              {/* Gold volume oscillation toggle */}
              <div className="flex items-center justify-between">
                <Tip text="Sweeps the gold dot from -10 dB to +10 dB in 2 dB steps each time it plays"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Gold volume oscillation</span></Tip>
                <Switch
                  checked={referenceVolumeOscillationEnabled}
                  onCheckedChange={onReferenceVolumeOscillationChange}
                />
              </div>
              {/* All volume oscillation toggle */}
              <div className="flex items-center justify-between">
                <Tip text="Offsets every dot by -10 dB, 0 dB, then +10 dB, advancing every 4 full play cycles"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">All oscillate</span></Tip>
                <Switch
                  checked={allVolumeOscillationEnabled}
                  onCheckedChange={onAllVolumeOscillationChange}
                />
              </div>
              {/* Reference volume multiply count slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Repeats each non-gold/gold relation before advancing. 2x plays a-gold-a-gold, then b-gold-b-gold."><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Ref 2x</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {referenceVolumeMultiplyCount.toFixed(0)}x
                  </span>
                </div>
                <Slider
                  value={[referenceVolumeMultiplyCount]}
                  min={1}
                  max={4}
                  step={1}
                  onValueChange={(v) => onReferenceVolumeMultiplyCountChange(v[0])}
                />
              </div>
              {/* EQ A/B toggle */}
              <div className="flex items-center justify-between">
                <Tip text="Alternates EQ on/off every `depth` hits so you can hear the difference"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">EQ A/B</span></Tip>
                <Switch
                  checked={eqABEnabled}
                  onCheckedChange={onEqABChange}
                />
              </div>
              {/* Slope toggle */}
              <div className="flex items-center justify-between">
                <Tip text="Noise spectral slope: off = −4.5 dB/oct (default), on = −3.0 dB/oct (flatter / pink)">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">
                    {flatSlope ? "−3 dB/oct" : "−4.5 dB/oct"}
                  </span>
                </Tip>
                <Switch
                  checked={flatSlope}
                  onCheckedChange={onFlatSlopeChange}
                />
              </div>
              <div className="flex items-center justify-between">
                <Tip text="Use a dense bank of sine partials through the same bandpass path instead of filtered noise">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Partials</span>
                </Tip>
                <Switch
                  checked={additivePartialsEnabled}
                  onCheckedChange={onAdditivePartialsChange}
                />
              </div>
              <div className="flex items-center justify-between">
                <Tip text="Use a jittered impulse train through the same bandpass path instead of filtered noise">
                  <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Clicks</span>
                </Tip>
                <Switch
                  checked={clickTrainEnabled}
                  onCheckedChange={onClickTrainChange}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Scales the click-train source before it enters the shared bandpass path">
                    <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Click volume</span>
                  </Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {clickTrainVolumePercent.toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[clickTrainVolumePercent]}
                  min={0}
                  max={500}
                  step={5}
                  disabled={!clickTrainEnabled}
                  className={!clickTrainEnabled ? "opacity-45" : undefined}
                  onValueChange={(v) => onClickTrainVolumeChange(v[0])}
                />
              </div>
            </div>
          )}
        </div>

        {/* Main panel — always visible when settings open */}
        <div className={cn(
          "rounded-xl glass-panel overflow-hidden",
          collapsed ? "pointer-events-none" : "pointer-events-auto"
        )}>
          <div className="p-4 space-y-4">
            <span className="text-[10px] dark:text-white/40 text-black/40 uppercase tracking-wider font-medium">Soundstage grid</span>
            {/* Vertical sliders: Speed & Volume side by side */}
            <div className="flex gap-6 justify-center">
              {/* Speed slider */}
              <div className="flex flex-col items-center gap-2">
                <Tip text="How fast each dot triggers its sound — higher means more rapid hits"><span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Spd</span></Tip>
                <div className="h-28">
                  <Slider
                    orientation="vertical"
                    value={[speed]}
                    min={0.5}
                    max={16}
                    step={0.1}
                    onValueChange={(v) => onSpeedChange(v[0])}
                  />
                </div>
                <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{speed.toFixed(1)}</span>
              </div>

              {/* Volume slider */}
              <div className="flex flex-col items-center gap-2">
                <Tip text="Volume of the soundstage dots"><span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Vol</span></Tip>
                <div className="h-28">
                  <Slider
                    orientation="vertical"
                    value={[volumePercent]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => onVolumeChange(v[0])}
                  />
                </div>
                <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{volumePercent.toFixed(0)}%</span>
              </div>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center gap-1 text-xs dark:text-white/50 text-black/50 uppercase tracking-wider hover:dark:text-white/70 hover:text-black/70 transition-colors"
            >
              <ChevronLeft
                className={cn(
                  "h-3 w-3 transition-transform duration-200",
                  advancedOpen && "rotate-180"
                )}
              />
              Advanced
            </button>
          </div>
        </div>
      </div>

      {/* Settings gear — always pinned at bottom right */}
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
  return createPortal(content, document.body)
}
