"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { GapsComparePlayer, type CompareSettings } from "@/lib/audio/gapsComparePlayer"

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "cabin:gaps:compare:settings"
const STORAGE_KEY_VOLUME = "cabin:gaps:compare:volume"

const MIN_FREQ = 20
const MAX_FREQ = 20000
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]

const DB_MIN = -18
const DB_MAX = 6

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

function dbToY(db: number, height: number): number {
  return ((DB_MAX - db) / (DB_MAX - DB_MIN)) * height
}

function formatFreq(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 2)}k`
  return `${Math.round(hz)}`
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return { ...fallback, ...JSON.parse(raw) }
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

const DEFAULT_SETTINGS: CompareSettings = {
  freqA: 500,
  freqB: 2000,
  q: 2,
  burstsPerSecond: 2,
  playsPerSound: 2,
}

// ─── EQ visualization ───────────────────────────────────────────────────────

interface EqVisualProps {
  label: string
  color: string
  freq: number
  q: number
  onFreqChange: (hz: number) => void
}

function EqVisual({ label, color, freq, q, onFreqChange }: EqVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  // Render the bell curve.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    // Background grid: 0 dB line
    ctx.strokeStyle = "rgba(255,255,255,0.08)"
    ctx.lineWidth = 1
    const zeroY = dbToY(0, cssH)
    ctx.beginPath()
    ctx.moveTo(0, zeroY)
    ctx.lineTo(cssW, zeroY)
    ctx.stroke()

    // Frequency gridlines
    for (const hz of FREQ_TICKS) {
      const x = freqToX(hz, cssW)
      ctx.strokeStyle = "rgba(255,255,255,0.05)"
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssH)
      ctx.stroke()
    }

    // Bell curve
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    const samples = 256
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const hz = Math.pow(2, Math.log2(MIN_FREQ) + t * (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ)))
      const db = GapsComparePlayer.peakingResponseDb(hz, freq, q, GapsComparePlayer.bellCutDb)
      const x = freqToX(hz, cssW)
      const y = dbToY(db, cssH)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Fill under curve down to 0
    ctx.lineTo(cssW, zeroY)
    ctx.lineTo(0, zeroY)
    ctx.closePath()
    ctx.fillStyle = color.replace(/[\d.]+\)$/, "0.12)")
    ctx.fill()

    // Center marker
    const cx = freqToX(freq, cssW)
    ctx.strokeStyle = color
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, cssH)
    ctx.stroke()
    ctx.setLineDash([])

    // Center dot at the curve minimum
    const minDb = GapsComparePlayer.peakingResponseDb(freq, freq, q, GapsComparePlayer.bellCutDb)
    const minY = dbToY(minDb, cssH)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, minY, 5, 0, Math.PI * 2)
    ctx.fill()
  }, [freq, q, color])

  const updateFromPointer = useCallback(
    (clientX: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left
      const hz = xToFreq(x, rect.width)
      onFreqChange(hz)
    },
    [onFreqChange]
  )

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <span className="text-xs font-medium tracking-wide text-white/70">{label}</span>
        <span className="tabular-nums text-xs text-white/50">
          {formatFreq(freq)} Hz · −12 dB
        </span>
      </div>
      <div
        ref={containerRef}
        className="relative cursor-ew-resize select-none touch-none"
        style={{ height: 160 }}
        onPointerDown={(e) => {
          draggingRef.current = true
          ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
          updateFromPointer(e.clientX)
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updateFromPointer(e.clientX)
        }}
        onPointerUp={(e) => {
          draggingRef.current = false
          try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId) } catch {}
        }}
        onPointerCancel={() => { draggingRef.current = false }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="relative h-5 border-t border-white/5">
        {FREQ_TICKS.map((hz) => {
          const pct = ((Math.log2(hz) - Math.log2(MIN_FREQ)) / (Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ))) * 100
          return (
            <span
              key={hz}
              className="absolute -translate-x-1/2 text-[10px] tabular-nums text-white/40"
              style={{ left: `${pct}%`, top: 3 }}
            >
              {formatFreq(hz)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function GapsComparePage() {
  const playerRef = useRef<GapsComparePlayer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [settings, setSettings] = useState<CompareSettings>(() =>
    loadJson(STORAGE_KEY, DEFAULT_SETTINGS)
  )
  const [volume, setVolume] = useState(() => loadNumber(STORAGE_KEY_VOLUME, -6))

  const getPlayer = useCallback(() => {
    if (!playerRef.current) playerRef.current = new GapsComparePlayer()
    return playerRef.current
  }, [])

  // Sync settings → player + storage
  useEffect(() => {
    playerRef.current?.setSettings(settings)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  // Sync volume
  useEffect(() => {
    playerRef.current?.setVolume(volume)
    localStorage.setItem(STORAGE_KEY_VOLUME, String(volume))
  }, [volume])

  // Cleanup
  useEffect(() => {
    return () => {
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [])

  const togglePlayback = useCallback(async () => {
    const player = getPlayer()
    if (player.isPlaying) {
      player.stop()
      setIsPlaying(false)
    } else {
      player.setVolume(volume)
      player.setSettings(settings)
      await player.start()
      setIsPlaying(true)
    }
  }, [getPlayer, settings, volume])

  const updateSetting = useCallback(<K extends keyof CompareSettings>(key: K, value: CompareSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#6f2a0d_0%,rgba(111,42,13,0.15)_28%,transparent_48%),radial-gradient(circle_at_top_right,rgba(22,163,171,0.28),transparent_36%),linear-gradient(180deg,#120d0b_0%,#140f18_52%,#090a0d_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <Link
            href="/gaps"
            className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-lg font-medium tracking-tight">EQ Comparison</h1>
          <div className="w-16" />
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
        </div>

        {/* EQ visualizations */}
        <div className="grid gap-4 md:grid-cols-2">
          <EqVisual
            label="Sound A"
            color="rgba(34, 197, 94, 0.95)"
            freq={settings.freqA}
            q={settings.q}
            onFreqChange={(hz) => updateSetting("freqA", hz)}
          />
          <EqVisual
            label="Sound B"
            color="rgba(239, 68, 68, 0.95)"
            freq={settings.freqB}
            q={settings.q}
            onFreqChange={(hz) => updateSetting("freqB", hz)}
          />
        </div>

        {/* Sliders */}
        <div className="mt-6 grid gap-5 rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md md:grid-cols-2">
          <SliderRow
            label="Freq A"
            value={settings.freqA}
            min={MIN_FREQ}
            max={MAX_FREQ}
            step={1}
            log
            display={`${formatFreq(settings.freqA)} Hz`}
            onChange={(v) => updateSetting("freqA", v)}
          />
          <SliderRow
            label="Freq B"
            value={settings.freqB}
            min={MIN_FREQ}
            max={MAX_FREQ}
            step={1}
            log
            display={`${formatFreq(settings.freqB)} Hz`}
            onChange={(v) => updateSetting("freqB", v)}
          />
          <SliderRow
            label="Q (both)"
            value={settings.q}
            min={0.3}
            max={12}
            step={0.1}
            display={settings.q.toFixed(1)}
            onChange={(v) => updateSetting("q", v)}
          />
          <SliderRow
            label="Rate"
            value={settings.burstsPerSecond}
            min={0.5}
            max={10}
            step={0.1}
            display={`${settings.burstsPerSecond.toFixed(1)} /s`}
            onChange={(v) => updateSetting("burstsPerSecond", v)}
          />
          <SliderRow
            label="Plays per sound"
            value={settings.playsPerSound}
            min={1}
            max={8}
            step={1}
            display={`${settings.playsPerSound}×`}
            onChange={(v) => updateSetting("playsPerSound", v)}
          />
        </div>

        <p className="mt-4 text-xs text-white/30">
          Plays −4.5 dB/oct shaped noise bursts, alternating between two −12 dB bell cuts at the chosen
          frequencies. Drag the curves or use the sliders to set each cut frequency.
        </p>
      </div>
    </main>
  )
}

// ─── Slider row helper ──────────────────────────────────────────────────────

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  log?: boolean
  display: string
  onChange: (value: number) => void
}

function SliderRow({ label, value, min, max, step, log, display, onChange }: SliderRowProps) {
  // For log scale, we map slider ticks 0..1000 to log range, then back.
  const isLog = !!log
  const TICKS = 1000

  const sliderValue = isLog
    ? ((Math.log2(value) - Math.log2(min)) / (Math.log2(max) - Math.log2(min))) * TICKS
    : value
  const sliderMin = isLog ? 0 : min
  const sliderMax = isLog ? TICKS : max
  const sliderStep = isLog ? 1 : step

  const handleChange = (raw: number) => {
    if (isLog) {
      const t = raw / TICKS
      const hz = Math.pow(2, Math.log2(min) + t * (Math.log2(max) - Math.log2(min)))
      onChange(hz)
    } else {
      onChange(raw)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/60">{label}</span>
        <span className="tabular-nums text-xs text-white/50">{display}</span>
      </div>
      <Slider
        value={[sliderValue]}
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        onValueChange={([v]) => handleChange(v)}
      />
    </div>
  )
}
