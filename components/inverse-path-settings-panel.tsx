"use client"

import { Settings } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  MAX_INVERSE_DOT_BAND_BOOST_DB,
  MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
  MAX_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS,
  MIN_INVERSE_DOT_BAND_BOOST_DB,
  MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
  MIN_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS,
} from "@/lib/audio/inversePathAudio"

type PathPattern = "line" | "line-steps" | "v" | "s" | "sine" | "circle"
type CirclePlaybackMode = "motion" | "all"

function formatDb(value: number): string {
  if (value > 0) return `+${value.toFixed(0)} dB`
  return `${value.toFixed(0)} dB`
}

function formatNumber(value: number): string {
  return value < 1 ? value.toFixed(2) : value.toFixed(1)
}

interface SliderControlProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function SliderControl({ label, value, display, min, max, step, onChange }: SliderControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-white/50">{label}</span>
        <span className="text-[10px] tabular-nums text-white/70">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(nextValue) => onChange(nextValue[0] ?? value)}
      />
    </div>
  )
}

interface PatternControlProps {
  value: PathPattern
  onChange: (value: PathPattern) => void
}

function PatternControl({ value, onChange }: PatternControlProps) {
  return (
    <div className="space-y-2">
      <span className="text-[10px] uppercase tracking-wider text-white/50">Pattern</span>
      <div className="grid grid-cols-6 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
        {[
          { value: "line" as const, label: "Line" },
          { value: "line-steps" as const, label: "Steps" },
          { value: "v" as const, label: "V" },
          { value: "s" as const, label: "S" },
          { value: "sine" as const, label: "Sine" },
          { value: "circle" as const, label: "Circle" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={cn(
              "h-8 rounded-md text-[10px] font-medium uppercase tracking-wider transition",
              value === option.value
                ? "bg-cyan-200 text-black shadow-[0_0_18px_rgba(34,211,238,0.35)]"
                : "text-white/55 hover:bg-white/10 hover:text-white"
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface InversePathSettingsPanelProps {
  collapsed: boolean
  onToggle: () => void
  pathPattern: PathPattern
  onPathPatternChange: (value: PathPattern) => void
  lineStepCount: number
  onLineStepCountChange: (value: number) => void
  speed: number
  onSpeedChange: (value: number) => void
  hitRateHz: number
  onHitRateChange: (value: number) => void
  hitReleaseSeconds: number
  onHitReleaseChange: (value: number) => void
  circleCount: number
  onCircleCountChange: (value: number) => void
  circleRadius: number
  onCircleRadiusChange: (value: number) => void
  circlePlaybackMode: CirclePlaybackMode
  onCirclePlaybackModeChange: (value: CirclePlaybackMode) => void
  circleMotionDotCount: number
  onCircleMotionDotCountChange: (value: number) => void
  circleDotCount: number
  onCircleDotCountChange: (value: number) => void
  volumeDb: number
  onVolumeChange: (value: number) => void
  bandwidth: number
  onBandwidthChange: (value: number) => void
  inverseDotOutsideGapOctaves: number
  onInverseDotOutsideGapChange: (value: number) => void
  inverseDotBandBoostDb: number
  onInverseDotBandBoostChange: (value: number) => void
  circleXTiltDb: number
  onCircleXTiltChange: (value: number) => void
  circleYTiltDb: number
  onCircleYTiltChange: (value: number) => void
  lineStartGainDb: number
  onLineStartGainChange: (value: number) => void
  lineEndGainDb: number
  onLineEndGainChange: (value: number) => void
}

export function InversePathSettingsPanel({
  collapsed,
  onToggle,
  pathPattern,
  onPathPatternChange,
  lineStepCount,
  onLineStepCountChange,
  speed,
  onSpeedChange,
  hitRateHz,
  onHitRateChange,
  hitReleaseSeconds,
  onHitReleaseChange,
  circleCount,
  onCircleCountChange,
  circleRadius,
  onCircleRadiusChange,
  circlePlaybackMode,
  onCirclePlaybackModeChange,
  circleMotionDotCount,
  onCircleMotionDotCountChange,
  circleDotCount,
  onCircleDotCountChange,
  volumeDb,
  onVolumeChange,
  bandwidth,
  onBandwidthChange,
  inverseDotOutsideGapOctaves,
  onInverseDotOutsideGapChange,
  inverseDotBandBoostDb,
  onInverseDotBandBoostChange,
  circleXTiltDb,
  onCircleXTiltChange,
  circleYTiltDb,
  onCircleYTiltChange,
  lineStartGainDb,
  onLineStartGainChange,
  lineEndGainDb,
  onLineEndGainChange,
}: InversePathSettingsPanelProps) {
  return (
    <div
      className={cn(
        "absolute right-4 top-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-black/70 text-white shadow-2xl backdrop-blur-xl",
        collapsed ? "w-auto" : ""
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={collapsed ? "Open inverse path settings" : "Close inverse path settings"}
        onClick={onToggle}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"
      >
        <Settings className="h-4 w-4" />
      </button>

      {!collapsed && (
        <div className="grid gap-4 px-4 pb-4">
          <div className="grid gap-3">
            <PatternControl value={pathPattern} onChange={onPathPatternChange} />
            {pathPattern === "line-steps" && (
              <SliderControl
                label="Positions"
                value={lineStepCount}
                display={lineStepCount.toFixed(0)}
                min={2}
                max={8}
                step={1}
                onChange={onLineStepCountChange}
              />
            )}
            <SliderControl
              label="Move speed"
              value={speed}
              display={formatNumber(speed)}
              min={0.05}
              max={64}
              step={0.05}
              onChange={onSpeedChange}
            />
            <SliderControl
              label="Hit speed"
              value={hitRateHz}
              display={`${formatNumber(hitRateHz)}/s`}
              min={0.5}
              max={24}
              step={0.1}
              onChange={onHitRateChange}
            />
            <SliderControl
              label="Hit release"
              value={hitReleaseSeconds}
              display={`${Math.round(hitReleaseSeconds * 1000)} ms`}
              min={MIN_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS}
              max={MAX_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS}
              step={0.01}
              onChange={onHitReleaseChange}
            />
            <SliderControl
              label="Volume"
              value={volumeDb}
              display={formatDb(volumeDb)}
              min={-60}
              max={24}
              step={1}
              onChange={onVolumeChange}
            />
            <SliderControl
              label="Width"
              value={bandwidth}
              display={`${bandwidth.toFixed(2)} oct`}
              min={0.25}
              max={10}
              step={0.05}
              onChange={onBandwidthChange}
            />
          </div>

          {pathPattern === "circle" && (
            <div className="grid gap-3">
              <SliderControl
                label="Circles"
                value={circleCount}
                display={circleCount.toFixed(0)}
                min={1}
                max={4}
                step={1}
                onChange={onCircleCountChange}
              />
              <SliderControl
                label="Size"
                value={circleRadius}
                display={circleRadius.toFixed(2)}
                min={0.02}
                max={0.5}
                step={0.01}
                onChange={onCircleRadiusChange}
              />
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-wider text-white/50">Play</span>
                <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                  {[
                    { value: "motion" as const, label: "Motion" },
                    { value: "all" as const, label: "All" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={circlePlaybackMode === option.value}
                      className={cn(
                        "h-8 rounded-md text-[10px] font-medium uppercase tracking-wider transition",
                        circlePlaybackMode === option.value
                          ? "bg-cyan-200 text-black shadow-[0_0_18px_rgba(34,211,238,0.35)]"
                          : "text-white/55 hover:bg-white/10 hover:text-white"
                      )}
                      onClick={() => onCirclePlaybackModeChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {circlePlaybackMode === "motion" && (
                <SliderControl
                  label="Dots"
                  value={circleMotionDotCount}
                  display={circleMotionDotCount.toFixed(0)}
                  min={1}
                  max={4}
                  step={1}
                  onChange={onCircleMotionDotCountChange}
                />
              )}
              {circlePlaybackMode === "all" && (
                <SliderControl
                  label="Dots"
                  value={circleDotCount}
                  display={circleDotCount.toFixed(0)}
                  min={2}
                  max={24}
                  step={1}
                  onChange={onCircleDotCountChange}
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <SliderControl
                  label="Tilt X"
                  value={circleXTiltDb}
                  display={formatDb(circleXTiltDb)}
                  min={-24}
                  max={24}
                  step={1}
                  onChange={onCircleXTiltChange}
                />
                <SliderControl
                  label="Tilt Y"
                  value={circleYTiltDb}
                  display={formatDb(circleYTiltDb)}
                  min={-24}
                  max={24}
                  step={1}
                  onChange={onCircleYTiltChange}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <SliderControl
              label="Dot gap"
              value={inverseDotOutsideGapOctaves}
              display={`${inverseDotOutsideGapOctaves.toFixed(2)} oct`}
              min={MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES}
              max={MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES}
              step={0.05}
              onChange={onInverseDotOutsideGapChange}
            />
            <SliderControl
              label="Dot boost"
              value={inverseDotBandBoostDb}
              display={formatDb(inverseDotBandBoostDb)}
              min={MIN_INVERSE_DOT_BAND_BOOST_DB}
              max={MAX_INVERSE_DOT_BAND_BOOST_DB}
              step={1}
              onChange={onInverseDotBandBoostChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SliderControl
              label="A gain"
              value={lineStartGainDb}
              display={formatDb(lineStartGainDb)}
              min={-60}
              max={24}
              step={1}
              onChange={onLineStartGainChange}
            />
            <SliderControl
              label="B gain"
              value={lineEndGainDb}
              display={formatDb(lineEndGainDb)}
              min={-60}
              max={24}
              step={1}
              onChange={onLineEndGainChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}
