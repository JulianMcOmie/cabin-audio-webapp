"use client"

import { useState, useCallback } from "react"
import { Settings, ChevronDown } from "lucide-react"
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
  release: number
  onReleaseChange: (value: number) => void
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
        <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Grid Size</span>
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
// Collapsible Advanced section
// ---------------------------------------------------------------------------

function AdvancedSection({
  gridRows,
  gridCols,
  minRows,
  maxRows,
  minCols,
  maxCols,
  onSetGridSize,
  release,
  onReleaseChange,
}: {
  gridRows: number
  gridCols: number
  minRows: number
  maxRows: number
  minCols: number
  maxCols: number
  onSetGridSize: (rows: number, cols: number) => void
  release: number
  onReleaseChange: (value: number) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs dark:text-white/50 text-black/50 uppercase tracking-wider hover:dark:text-white/70 hover:text-black/70 transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
        Advanced
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <GridSizePicker
            rows={gridRows}
            cols={gridCols}
            minRows={minRows}
            maxRows={maxRows}
            minCols={minCols}
            maxCols={maxCols}
            onSetSize={onSetGridSize}
          />
          {/* Release time slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Release</span>
              <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                {release < 1 ? `${Math.round(release * 1000)}ms` : `${release.toFixed(1)}s`}
              </span>
            </div>
            <Slider
              value={[release]}
              min={0.05}
              max={3}
              step={0.05}
              onValueChange={(v) => onReleaseChange(v[0])}
            />
          </div>
        </div>
      )}
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
  release,
  onReleaseChange,
  isPlaying,
}: SettingsPanelProps) {
  return (
    <div className={cn(
      "fixed right-4 bottom-4 z-50 flex items-end gap-2 transition-opacity duration-500",
      "opacity-100"
    )}>
      {/* Expanded panel — to the left of the gear */}
      <div
        className={cn(
          "rounded-xl glass-panel overflow-hidden transition-all duration-300 origin-right",
          collapsed ? "max-w-0 opacity-0 pointer-events-none border-0 p-0" : "max-w-[300px] opacity-100"
        )}
      >
        <div className="p-4 space-y-4">
          <span className="text-[10px] dark:text-white/40 text-black/40 uppercase tracking-wider font-medium">Soundstage grid</span>
          {/* Vertical sliders: Speed & Volume side by side */}
          <div className="flex gap-6 justify-center">
            {/* Speed slider */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Spd</span>
              <div className="h-28">
                <Slider
                  orientation="vertical"
                  value={[speed]}
                  min={0.5}
                  max={8}
                  step={0.1}
                  onValueChange={(v) => onSpeedChange(v[0])}
                />
              </div>
              <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{speed.toFixed(1)}</span>
            </div>

            {/* Volume slider */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Vol</span>
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

          {/* Advanced section with grid size & release */}
          <AdvancedSection
            gridRows={gridRows}
            gridCols={gridCols}
            minRows={minRows}
            maxRows={maxRows}
            minCols={minCols}
            maxCols={maxCols}
            onSetGridSize={onSetGridSize}
            release={release}
            onReleaseChange={onReleaseChange}
          />
        </div>
      </div>

      {/* Settings gear — always pinned at bottom right */}
      <button
        onClick={onToggle}
        className={cn(
          "glass-panel rounded-lg p-2.5 transition-colors flex-shrink-0",
          collapsed
            ? "dark:text-white/70 text-black/50 dark:hover:text-white hover:text-black"
            : "dark:text-white text-black dark:bg-white/10 bg-black/10"
        )}
        title={collapsed ? "Open settings" : "Close settings"}
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  )
}
