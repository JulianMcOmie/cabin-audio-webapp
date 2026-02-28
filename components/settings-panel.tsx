"use client"

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Settings, ChevronLeft } from "lucide-react"
import { Slider } from "@/components/ui/slider"
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
  bandwidth: number
  onBandwidthChange: (value: number) => void
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
  bandwidth,
  onBandwidthChange,
}: SettingsPanelProps) {
  const [mounted, setMounted] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  useEffect(() => setMounted(true), [])

  const content = (
    <div className={cn(
      "fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 transition-opacity duration-500",
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
              {/* Release time slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="How long each dot's sound rings out before fading to silence"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Release</span></Tip>
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
              {/* Bandwidth slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tip text="Distance between hi/lo pass filters — controls how wide each dot's frequency band is"><span className="text-xs dark:text-white/50 text-black/50 uppercase tracking-wider">Bandwidth</span></Tip>
                  <span className="text-xs dark:text-white/70 text-black/70 font-medium tabular-nums">
                    {bandwidth.toFixed(1)} oct
                  </span>
                </div>
                <Slider
                  value={[bandwidth]}
                  min={1}
                  max={8.5}
                  step={0.1}
                  onValueChange={(v) => onBandwidthChange(v[0])}
                />
              </div>
            </div>
          )}
        </div>

        {/* Main panel — always visible when settings open */}
        <div className="rounded-xl glass-panel overflow-hidden">
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
                    max={8}
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
          "glass-panel rounded-lg p-2.5 transition-colors flex-shrink-0",
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
