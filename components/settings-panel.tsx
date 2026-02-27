"use client"

import { useState, useCallback } from "react"
import { Settings, ChevronRight } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

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
  volumePercent: number
  onVolumeChange: (value: number) => void
}

// ---------------------------------------------------------------------------
// Mini grid picker — hover over cells to preview, click to set dimensions
// Like a table size picker in word processors
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
        <span className="text-xs text-white/50 uppercase tracking-wider">Grid Size</span>
        <span className="text-xs text-white/70 font-medium tabular-nums">
          {previewRows} × {previewCols}
        </span>
      </div>
      <div
        className="inline-grid gap-[3px] p-1.5 rounded-lg bg-white/5 border border-white/5"
        style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}
        onMouseLeave={() => { setHoverRow(null); setHoverCol(null) }}
      >
        {Array.from({ length: maxRows }, (_, r) => {
          const row = r + 1
          return Array.from({ length: maxCols }, (_, c) => {
            const col = c + 1
            const isWithinCurrent = row <= rows && col <= cols
            const isWithinHover = hoverRow !== null && hoverCol !== null && row <= hoverRow && col <= hoverCol
            const isBelowMin = row < minRows || col < minCols

            return (
              <button
                key={`${r}-${c}`}
                type="button"
                className={cn(
                  "w-[14px] h-[14px] rounded-[2px] transition-colors duration-75",
                  isWithinHover
                    ? "bg-cyan-400/60 border border-cyan-400/80"
                    : isWithinCurrent
                      ? "bg-white/20 border border-white/15"
                      : "bg-white/[0.04] border border-white/[0.06]",
                  isBelowMin && !isWithinHover ? "opacity-30" : ""
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
  minRows,
  maxRows,
  minCols,
  maxCols,
  onSetGridSize,
  speed,
  onSpeedChange,
  volumePercent,
  onVolumeChange,
}: SettingsPanelProps) {
  return (
    <div className="absolute right-4 top-4 z-10 flex items-start gap-2">
      {/* Collapsed toggle button */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="rounded-lg bg-black/60 backdrop-blur-xl border border-white/10 p-2.5 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          title="Open settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      )}

      {/* Expanded panel */}
      <div
        className={cn(
          "w-72 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 overflow-hidden transition-all duration-300",
          collapsed ? "max-h-0 opacity-0 pointer-events-none w-0 border-0 p-0" : "max-h-[700px] opacity-100"
        )}
      >
        <div className="p-4 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white/90">Settings</span>
            <button
              onClick={onToggle}
              className="rounded-md p-1 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Close settings"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Speed */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/50">Speed</span>
              <span className="text-white/70">{speed.toFixed(1)} hits/sec</span>
            </div>
            <Slider
              value={[speed]}
              min={0.5}
              max={8}
              step={0.1}
              onValueChange={(v) => onSpeedChange(v[0])}
            />
          </div>

          {/* Volume */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/50">Volume</span>
              <span className="text-white/70">{volumePercent.toFixed(0)}%</span>
            </div>
            <Slider
              value={[volumePercent]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => onVolumeChange(v[0])}
            />
          </div>

          {/* Grid size picker */}
          <GridSizePicker
            rows={gridRows}
            cols={gridCols}
            minRows={minRows}
            maxRows={maxRows}
            minCols={minCols}
            maxCols={maxCols}
            onSetSize={onSetGridSize}
          />
        </div>
      </div>
    </div>
  )
}
