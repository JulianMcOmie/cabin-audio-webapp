"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ArrowLeft, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { FrequencyEQ } from "@/components/parametric-eq"
import { EQProfilePills } from "@/components/eq-profile-pills"
import { EqPatternExperimentAudio, type EqPatternExperimentVisualState } from "@/lib/audio/eqPatternExperimentAudio"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import type { QualityLevel } from "@/components/unified-particle-scene"

const UnifiedParticleScene = dynamic(
  () => import("@/components/unified-particle-scene").then((mod) => mod.UnifiedParticleScene),
  { ssr: false }
)

const MIN_ROWS = 3
const MAX_ROWS = 12
const MIN_COLS = 3
const MAX_COLS = 16
const SPEED_MIN = 0.5
const SPEED_MAX = 64
const DEFAULT_SPEED = SPEED_MAX
const MIN_PER_HIT_MS = 15
const MAX_PER_HIT_MS = 500
const SPEED_INTERVAL_MULTIPLIER = 2

function speedToPerHitSeconds(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)))
  const perHitMs = MAX_PER_HIT_MS - t * (MAX_PER_HIT_MS - MIN_PER_HIT_MS)
  return (perHitMs * SPEED_INTERVAL_MULTIPLIER) / 1000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function GridSizePicker({
  rows,
  cols,
  onSetSize,
}: {
  rows: number
  cols: number
  onSetSize: (rows: number, cols: number) => void
}) {
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  const [hoverCol, setHoverCol] = useState<number | null>(null)
  const previewRows = hoverRow ?? rows
  const previewCols = hoverCol ?? cols

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider dark:text-white/45 text-black/45">Grid</span>
        <span className="text-xs tabular-nums dark:text-white/70 text-black/70">{previewRows} x {previewCols}</span>
      </div>
      <div
        className="grid gap-1 w-fit"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 0.7rem)` }}
        onMouseLeave={() => {
          setHoverRow(null)
          setHoverCol(null)
        }}
      >
        {Array.from({ length: MAX_ROWS }).map((_, r) =>
          Array.from({ length: MAX_COLS }).map((__, c) => {
            const cellRows = r + 1
            const cellCols = c + 1
            const enabled = cellRows >= MIN_ROWS && cellCols >= MIN_COLS
            const active = cellRows <= previewRows && cellCols <= previewCols
            return (
              <button
                key={`${c},${r}`}
                type="button"
                disabled={!enabled}
                onMouseEnter={() => {
                  if (!enabled) return
                  setHoverRow(cellRows)
                  setHoverCol(cellCols)
                }}
                onClick={() => {
                  if (enabled) onSetSize(cellRows, cellCols)
                }}
                className={`h-2.5 w-2.5 rounded-sm transition-colors ${
                  active
                    ? "bg-cyan-300/80"
                    : enabled
                      ? "dark:bg-white/15 bg-black/15 hover:bg-cyan-300/40"
                      : "dark:bg-white/5 bg-black/5"
                }`}
                aria-label={`${cellRows} by ${cellCols}`}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider dark:text-white/45 text-black/45">{label}</span>
        <span className="text-xs tabular-nums dark:text-white/70 text-black/70">
          {value.toFixed(step < 1 ? 1 : 0)}{suffix}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  )
}

export function EQPatternExperimentPage() {
  const [selectedDot, setSelectedDot] = useState("2,1")
  const [freeformModeEnabled, setFreeformModeEnabled] = useState(false)
  const [freeformPosition, setFreeformPosition] = useState({ normalizedX: 0.5, normalizedY: 0.5 })
  const [gridRows, setGridRows] = useState(3)
  const [gridCols, setGridCols] = useState(5)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [bandwidth, setBandwidth] = useState(6)
  const [volumePercent, setVolumePercent] = useState(100)
  const [clickVolumePercent, setClickVolumePercent] = useState(1400)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hoveredDot, setHoveredDot] = useState<string | null>(null)
  const [activeBand, setActiveBand] = useState<{ frequency: number; gain: number; q: number } | null>(null)
  const [instruction, setInstruction] = useState("Click + drag on the center line to add a band")
  const [visualState, setVisualState] = useState<EqPatternExperimentVisualState>({
    playingDotKey: null,
    beatIndex: 0,
    beatInPattern: 0,
    eqHit: false,
  })

  const playerRef = useRef<EqPatternExperimentAudio | null>(null)
  const previousEQEnabledRef = useRef<boolean | null>(null)
  const freeformDraggingRef = useRef(false)
  const setEQEnabled = useEQProfileStore((s) => s.setEQEnabled)
  const getActiveProfile = useEQProfileStore((s) => s.getActiveProfile)

  const selectedDots = useMemo(() => freeformModeEnabled ? new Set<string>() : new Set([selectedDot]), [freeformModeEnabled, selectedDot])
  const intervalSeconds = useMemo(() => speedToPerHitSeconds(speed), [speed])

  const eqHighlights = useMemo(() => {
    if (!activeBand || activeBand.gain === 0) return null
    const highlights = new Map<string, number>()
    const topUpperEdge = 20000
    const topLowerEdge = topUpperEdge / Math.pow(2, bandwidth)
    const bottomLowerEdge = 20

    for (let row = 0; row < gridRows; row++) {
      const normalizedY = gridRows <= 1 ? 0.5 : row / (gridRows - 1)
      const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, normalizedY)
      const upperEdge = lowerEdge * Math.pow(2, bandwidth)
      const centerFreq = Math.sqrt(lowerEdge * upperEdge)
      const octaveDistance = Math.abs(Math.log2(centerFreq / activeBand.frequency))
      const halfBandwidth = 1 / activeBand.q
      const intensity = Math.exp(-Math.pow(octaveDistance / halfBandwidth, 2)) * Math.min(1, Math.abs(activeBand.gain) / 12)

      if (intensity > 0.01) {
        for (let col = 0; col < gridCols; col++) {
          highlights.set(`${col},${row}`, intensity)
        }
      }
    }

    return highlights
  }, [activeBand, bandwidth, gridRows, gridCols])

  useEffect(() => {
    const player = new EqPatternExperimentAudio()
    playerRef.current = player
    player.setVisualStateListener(setVisualState)
    previousEQEnabledRef.current = useEQProfileStore.getState().isEQEnabled
    setEQEnabled(true)

    return () => {
      player.dispose()
      playerRef.current = null
      const previous = previousEQEnabledRef.current
      if (previous !== null) setEQEnabled(previous)
    }
  }, [setEQEnabled])

  useEffect(() => {
    playerRef.current?.configure({
      dotKey: selectedDot,
      position: freeformModeEnabled ? freeformPosition : null,
      rows: gridRows,
      cols: gridCols,
      intervalSeconds,
      bandwidthOctaves: bandwidth,
      volumePercent,
      clickVolumePercent,
    })
  }, [selectedDot, freeformModeEnabled, freeformPosition, gridRows, gridCols, intervalSeconds, bandwidth, volumePercent, clickVolumePercent])

  const handlePlayToggle = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    if (isPlaying) {
      player.stop()
      setIsPlaying(false)
      return
    }

    void player.start().then(() => setIsPlaying(true))
  }, [isPlaying])

  const handleDotSelect = useCallback((x: number, y: number) => {
    if (freeformModeEnabled) return
    setSelectedDot(`${x},${y}`)
  }, [freeformModeEnabled])

  const handleDotDeselect = useCallback((x: number, y: number) => {
    if (freeformModeEnabled) return
    setSelectedDot(`${x},${y}`)
  }, [freeformModeEnabled])

  const handleSetGridSize = useCallback((rows: number, cols: number) => {
    setGridRows(rows)
    setGridCols(cols)
    setSelectedDot((dotKey) => {
      const [xRaw, yRaw] = dotKey.split(",").map(Number)
      const x = clamp(Number.isFinite(xRaw) ? xRaw : 0, 0, cols - 1)
      const y = clamp(Number.isFinite(yRaw) ? yRaw : 0, 0, rows - 1)
      return `${x},${y}`
    })
  }, [])

  const updateFreeformPositionFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const nextPosition = {
      normalizedX: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      normalizedY: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    }
    setFreeformPosition(nextPosition)
    playerRef.current?.configure({ position: nextPosition })
  }, [])

  const handleFreeformPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!freeformModeEnabled || event.button !== 0) return
    freeformDraggingRef.current = true
    updateFreeformPositionFromPointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [freeformModeEnabled, updateFreeformPositionFromPointer])

  const handleFreeformPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!freeformDraggingRef.current) return
    updateFreeformPositionFromPointer(event)
  }, [updateFreeformPositionFromPointer])

  const handleFreeformPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    freeformDraggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const beatLabel = visualState.eqHit ? "2" : "1"
  const quality: QualityLevel = "low"
  const freeformHue = 227 + (150 - 227) * freeformPosition.normalizedY
  const freeformPulse = freeformModeEnabled && visualState.playingDotKey !== null

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#080a10] text-white">
      <div className="absolute inset-0 lg:right-[460px]">
        <UnifiedParticleScene
          gridRows={gridRows}
          gridCols={gridCols}
          selectedDots={selectedDots}
          constantDots={new Set()}
          referenceDotKey={null}
          onDotSelect={handleDotSelect}
          onDotDeselect={handleDotDeselect}
          playingDotKey={freeformModeEnabled ? null : visualState.playingDotKey}
          beatIndex={visualState.beatIndex}
          hoveredDot={hoveredDot}
          onHoverDot={setHoveredDot}
          quality={quality}
          highlightTarget={null}
          inputDisabled={freeformModeEnabled}
          inviteDotKey={null}
          eqHighlights={eqHighlights}
        />
        {freeformModeEnabled && (
          <div
            className="absolute inset-0 z-20 touch-none cursor-crosshair"
            onPointerDown={handleFreeformPointerDown}
            onPointerMove={handleFreeformPointerMove}
            onPointerUp={handleFreeformPointerUp}
            onPointerCancel={handleFreeformPointerUp}
          >
            <div
              className="absolute h-9 w-9 rounded-full border border-white/80 shadow-[0_0_28px_rgba(0,255,255,0.45)] transition-transform duration-75"
              style={{
                left: `${freeformPosition.normalizedX * 100}%`,
                top: `${(1 - freeformPosition.normalizedY) * 100}%`,
                transform: `translate(-50%, -50%) scale(${freeformPulse ? 1.12 : 1})`,
                backgroundColor: `hsla(${freeformHue}, 100%, 62%, 0.9)`,
                boxShadow: `0 0 ${freeformPulse ? 38 : 24}px hsla(${freeformHue}, 100%, 62%, 0.55)`,
              }}
            />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-3 lg:right-[472px]">
        <Button asChild variant="outline" size="sm" className="pointer-events-auto glass-panel border-white/10 bg-black/20 text-white hover:bg-white/10 hover:text-white">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Main
          </Link>
        </Button>
        <div className="pointer-events-auto glass-panel rounded-lg px-3 py-2 text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/45">Beat</div>
          <div className="text-sm font-medium tabular-nums">
            {beatLabel} / {visualState.beatInPattern + 1}
          </div>
        </div>
      </div>

      <aside className="absolute inset-x-0 bottom-0 top-auto z-30 flex max-h-[58vh] flex-col border-t border-white/10 bg-[#0a0b12]/92 backdrop-blur-2xl lg:inset-y-0 lg:left-auto lg:w-[460px] lg:max-h-none lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-sm font-medium tracking-wide text-white/85">EQ Pattern</h1>
            <p className="truncate text-[11px] text-white/40">{instruction}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-[10px] uppercase tracking-wider ${visualState.eqHit ? "bg-cyan-300/15 text-cyan-200" : "bg-white/10 text-white/65"}`}>
              {visualState.eqHit ? "EQ" : "Dry"}
            </span>
            <Button size="sm" onClick={handlePlayToggle} className="min-w-[92px]">
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider dark:text-white/45 text-black/45">Freeform</span>
                <Switch checked={freeformModeEnabled} onCheckedChange={setFreeformModeEnabled} />
              </div>
              <GridSizePicker rows={gridRows} cols={gridCols} onSetSize={handleSetGridSize} />
            </div>
            <div className="space-y-4">
              <SettingSlider label="Speed" value={speed} min={SPEED_MIN} max={SPEED_MAX} step={0.1} onChange={setSpeed} />
              <SettingSlider label="Bandwidth" value={bandwidth} min={1} max={8.5} step={0.1} suffix=" oct" onChange={setBandwidth} />
              <SettingSlider label="Volume" value={volumePercent} min={0} max={100} step={1} suffix="%" onChange={setVolumePercent} />
              <SettingSlider label="Click" value={clickVolumePercent} min={0} max={2000} step={25} suffix="%" onChange={setClickVolumePercent} />
            </div>
          </div>

          <div className="min-h-[300px] rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <EQProfilePills size="sm" />
              <span className="rounded-md bg-cyan-300/10 px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-200">2 path</span>
            </div>
            <div className="h-[260px]">
              <FrequencyEQ
                profileId={getActiveProfile()?.id}
                disabled={false}
                onInstructionChange={setInstruction}
                onRequestEnable={() => setEQEnabled(true)}
                onActiveBandChange={setActiveBand}
              />
            </div>
          </div>
        </div>
      </aside>
    </main>
  )
}
