"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play, RotateCcw, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { GapsPlayer, type FrequencyGap, type BandInfo } from "@/lib/audio/gapsPlayer"

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY_GAPS = "cabin:gaps:gaps"
const STORAGE_KEY_VOLUME = "cabin:gaps:volume"

const MIN_FREQ = 20
const MAX_FREQ = 20000
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]

// ─── Helpers ────────────────────────────────────────────────────────────────

function freqToX(hz: number, width: number): number {
  const logMin = Math.log2(MIN_FREQ)
  const logMax = Math.log2(MAX_FREQ)
  return ((Math.log2(hz) - logMin) / (logMax - logMin)) * width
}

function xToFreq(x: number, width: number): number {
  const logMin = Math.log2(MIN_FREQ)
  const logMax = Math.log2(MAX_FREQ)
  const ratio = Math.max(0, Math.min(1, x / width))
  return Math.pow(2, logMin + ratio * (logMax - logMin))
}

function formatFreq(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k`
  return `${Math.round(hz)}`
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function loadNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

let nextGapId = 1
function makeGapId(): string {
  return `gap-${nextGapId++}-${Date.now()}`
}

// ─── Component ──────────────────────────────────────────────────────────────

export function GapsPage() {
  const playerRef = useRef<GapsPlayer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [gaps, setGaps] = useState<FrequencyGap[]>(() => loadJson(STORAGE_KEY_GAPS, []))
  const [volume, setVolume] = useState(() => loadNumber(STORAGE_KEY_VOLUME, -6))
  const [bands, setBands] = useState<BandInfo[]>([])

  // Drag state for creating / resizing gaps
  const editorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startX: number
    startHz: number
    gapId: string | null
    mode: "create" | "resize-left" | "resize-right" | "move"
    offsetHz?: number
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ startHz: number; endHz: number } | null>(null)

  // Spectrum analyser canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)

  // ── Get or create player ───────────────────────────────────────────────

  const getPlayer = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = new GapsPlayer()
    }
    return playerRef.current
  }, [])

  // ── Sync gaps to player + localStorage ─────────────────────────────────

  useEffect(() => {
    const player = playerRef.current
    if (player) {
      player.setGaps(gaps)
      setBands(player.getBandInfos())
    }
    localStorage.setItem(STORAGE_KEY_GAPS, JSON.stringify(gaps))
  }, [gaps])

  // ── Sync volume ────────────────────────────────────────────────────────

  useEffect(() => {
    playerRef.current?.setVolume(volume)
    localStorage.setItem(STORAGE_KEY_VOLUME, String(volume))
  }, [volume])

  // ── Cleanup ────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [])

  // ── Spectrum drawing ───────────────────────────────────────────────────

  const drawSpectrum = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = playerRef.current?.getAnalyserNode()
    if (!canvas || !analyser) {
      animFrameRef.current = requestAnimationFrame(drawSpectrum)
      return
    }

    const ctx = canvas.getContext("2d")!
    const { width, height } = canvas

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Float32Array(bufferLength)
    analyser.getFloatFrequencyData(dataArray)

    ctx.clearRect(0, 0, width, height)

    // Draw frequency response curve
    const sampleRate = analyser.context.sampleRate
    ctx.beginPath()
    ctx.strokeStyle = "rgba(22, 163, 171, 0.7)"
    ctx.lineWidth = 1.5

    let started = false
    for (let i = 1; i < bufferLength; i++) {
      const freq = (i * sampleRate) / (analyser.fftSize)
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue

      const x = freqToX(freq, width)
      // Map dB to y: -100dB at bottom, -20dB at top
      const db = dataArray[i]
      const y = ((db - (-20)) / (-100 - (-20))) * height
      const clampedY = Math.max(0, Math.min(height, y))

      if (!started) {
        ctx.moveTo(x, clampedY)
        started = true
      } else {
        ctx.lineTo(x, clampedY)
      }
    }
    ctx.stroke()

    animFrameRef.current = requestAnimationFrame(drawSpectrum)
  }, [])

  // ── Play / Pause ───────────────────────────────────────────────────────

  const togglePlayback = useCallback(async () => {
    const player = getPlayer()
    if (player.isPlaying) {
      player.stop()
      cancelAnimationFrame(animFrameRef.current)
      setIsPlaying(false)
      setBands([])
    } else {
      player.setVolume(volume)
      await player.start()
      player.setGaps(gaps)
      setBands(player.getBandInfos())
      setIsPlaying(true)
      animFrameRef.current = requestAnimationFrame(drawSpectrum)
    }
  }, [getPlayer, gaps, volume, drawSpectrum])

  // ── Pointer handlers for gap editing ───────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = editorRef.current?.getBoundingClientRect()
      if (!rect) return

      const x = e.clientX - rect.left
      const w = rect.width
      const hz = xToFreq(x, w)

      // Check if clicking on an existing gap edge (for resize) or body (for move)
      const EDGE_PX = 8
      for (const gap of gaps) {
        const leftX = freqToX(gap.startHz, w)
        const rightX = freqToX(gap.endHz, w)

        if (Math.abs(x - leftX) < EDGE_PX) {
          dragRef.current = { startX: x, startHz: hz, gapId: gap.id, mode: "resize-left" }
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
        if (Math.abs(x - rightX) < EDGE_PX) {
          dragRef.current = { startX: x, startHz: hz, gapId: gap.id, mode: "resize-right" }
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
        if (x > leftX && x < rightX) {
          dragRef.current = { startX: x, startHz: hz, gapId: gap.id, mode: "move", offsetHz: hz - gap.startHz }
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
      }

      // Otherwise, start creating a new gap
      const id = makeGapId()
      dragRef.current = { startX: x, startHz: hz, gapId: id, mode: "create" }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [gaps]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const rect = editorRef.current?.getBoundingClientRect()
      if (!rect) return

      const x = e.clientX - rect.left
      const w = rect.width
      const hz = xToFreq(x, w)
      const drag = dragRef.current

      if (drag.mode === "create") {
        const lo = Math.min(drag.startHz, hz)
        const hi = Math.max(drag.startHz, hz)
        setDragPreview({ startHz: lo, endHz: hi })
      } else if (drag.mode === "resize-left" && drag.gapId) {
        setGaps((prev) =>
          prev.map((g) =>
            g.id === drag.gapId
              ? { ...g, startHz: Math.min(hz, g.endHz - 1) }
              : g
          )
        )
      } else if (drag.mode === "resize-right" && drag.gapId) {
        setGaps((prev) =>
          prev.map((g) =>
            g.id === drag.gapId
              ? { ...g, endHz: Math.max(hz, g.startHz + 1) }
              : g
          )
        )
      } else if (drag.mode === "move" && drag.gapId) {
        const offset = drag.offsetHz ?? 0
        setGaps((prev) =>
          prev.map((g) => {
            if (g.id !== drag.gapId) return g
            const width = g.endHz - g.startHz
            const newStart = Math.max(MIN_FREQ, Math.min(MAX_FREQ - width, hz - offset))
            return { ...g, startHz: newStart, endHz: newStart + width }
          })
        )
      }
    },
    []
  )

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return

    if (drag.mode === "create" && dragPreview) {
      // Only add if the gap has some meaningful width (at least ~1/20 octave)
      const widthOctaves = Math.log2(dragPreview.endHz / dragPreview.startHz)
      if (widthOctaves > 0.05) {
        const newGap: FrequencyGap = {
          id: drag.gapId!,
          startHz: dragPreview.startHz,
          endHz: dragPreview.endHz,
        }
        setGaps((prev) => [...prev, newGap])
      }
    }

    dragRef.current = null
    setDragPreview(null)
  }, [dragPreview])

  // ── Remove a gap ───────────────────────────────────────────────────────

  const removeGap = useCallback((id: string) => {
    setGaps((prev) => prev.filter((g) => g.id !== id))
  }, [])

  const clearAllGaps = useCallback(() => {
    setGaps([])
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────

  const editorHeight = 200

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#6f2a0d_0%,rgba(111,42,13,0.15)_28%,transparent_48%),radial-gradient(circle_at_top_right,rgba(22,163,171,0.28),transparent_36%),linear-gradient(180deg,#120d0b_0%,#140f18_52%,#090a0d_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-lg font-medium tracking-tight">Gap Editor</h1>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-white/60 hover:bg-white/5 hover:text-white"
          >
            <Link href="/gaps/compare">EQ compare</Link>
          </Button>
        </header>

        {/* Controls bar */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={togglePlayback}
            className="gap-2 border-white/10 bg-white/5 hover:bg-white/10"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? "Stop" : "Play"}
          </Button>

          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-white/50" />
            <Slider
              value={[volume]}
              min={-40}
              max={6}
              step={1}
              onValueChange={([v]) => setVolume(v)}
              className="w-32"
            />
            <span className="w-12 text-right text-xs tabular-nums text-white/50">
              {volume > 0 ? "+" : ""}
              {volume} dB
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllGaps}
            className="gap-1.5 text-white/50 hover:text-white"
            disabled={gaps.length === 0}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear gaps
          </Button>
        </div>

        {/* Frequency editor */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
          {/* Frequency axis labels */}
          <div className="relative h-6 border-b border-white/5 px-0">
            {FREQ_TICKS.map((hz) => {
              const pct = ((Math.log2(hz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
              return (
                <span
                  key={hz}
                  className="absolute -translate-x-1/2 text-[10px] tabular-nums text-white/40"
                  style={{ left: `${pct}%`, top: 4 }}
                >
                  {formatFreq(hz)}
                </span>
              )
            })}
          </div>

          {/* Editor area */}
          <div
            ref={editorRef}
            className="relative cursor-crosshair select-none"
            style={{ height: editorHeight }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Background band indicators */}
            {bands.map((b) => {
              const leftPct = ((Math.log2(b.lowerHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
              const rightPct = ((Math.log2(b.upperHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
              return (
                <div
                  key={b.index}
                  className="absolute top-0 bottom-0 border-r border-white/[0.03]"
                  style={{
                    left: `${leftPct}%`,
                    width: `${rightPct - leftPct}%`,
                    backgroundColor: b.active
                      ? "rgba(22, 163, 171, 0.08)"
                      : "transparent",
                  }}
                />
              )
            })}

            {/* Existing gaps */}
            {gaps.map((gap) => {
              const leftPct = ((Math.log2(gap.startHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
              const rightPct = ((Math.log2(gap.endHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
              return (
                <div
                  key={gap.id}
                  className="group absolute top-0 bottom-0"
                  style={{
                    left: `${leftPct}%`,
                    width: `${rightPct - leftPct}%`,
                  }}
                >
                  {/* Gap fill */}
                  <div className="absolute inset-0 bg-red-500/15 border-l border-r border-red-400/30 transition-colors group-hover:bg-red-500/25" />

                  {/* Resize handles */}
                  <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize" />
                  <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize" />

                  {/* Delete button */}
                  <button
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-red-500/50 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/80"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeGap(gap.id)
                    }}
                  >
                    ×
                  </button>

                  {/* Gap label */}
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-red-300/80 opacity-0 transition-opacity group-hover:opacity-100">
                    {formatFreq(gap.startHz)} – {formatFreq(gap.endHz)}
                  </div>
                </div>
              )
            })}

            {/* Drag preview */}
            {dragPreview && (
              <div
                className="absolute top-0 bottom-0 border border-dashed border-red-400/50 bg-red-500/10"
                style={{
                  left: `${((Math.log2(dragPreview.startHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100}%`,
                  width: `${((Math.log2(dragPreview.endHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ)) - (Math.log2(dragPreview.startHz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100}%`,
                }}
              />
            )}

            {/* Spectrum analyser overlay */}
            <canvas
              ref={canvasRef}
              width={960}
              height={editorHeight}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />

            {/* Frequency gridlines */}
            {FREQ_TICKS.map((hz) => {
              const pct = ((Math.log2(hz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
              return (
                <div
                  key={hz}
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/[0.06]"
                  style={{ left: `${pct}%` }}
                />
              )
            })}
          </div>
        </div>

        {/* Instructions */}
        <p className="mt-4 text-xs text-white/30">
          Click and drag on the editor to create a frequency gap. Hover over a gap to resize (drag edges),
          move (drag body), or delete (× button). The noise is shaped at −4.5 dB/oct and built from {bands.length || 40} parallel bandpassed noise bands.
        </p>

        {/* Gap list */}
        {gaps.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-medium text-white/60">Active gaps</h2>
            <div className="flex flex-wrap gap-2">
              {gaps.map((gap) => (
                <div
                  key={gap.id}
                  className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs"
                >
                  <span className="tabular-nums text-red-300">
                    {formatFreq(gap.startHz)} – {formatFreq(gap.endHz)}
                  </span>
                  <button
                    onClick={() => removeGap(gap.id)}
                    className="text-red-400/60 transition-colors hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
