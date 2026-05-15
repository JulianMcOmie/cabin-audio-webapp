"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play, RotateCcw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { EQBand } from "@/lib/models/EQBand"
import { combinedMagnitudeAt, logFrequencies } from "@/lib/utils/eqExport/biquadMath"
import {
  SPATIAL_BANDWIDTH_MAX_OCT,
  SPATIAL_BANDWIDTH_MIN_OCT,
  SPATIAL_GAIN_MAX_DB,
  SPATIAL_GAIN_MIN_DB,
  SpatialCalibrationPlayer,
  bandwidthOctToQ,
  buildSpatialPlaces,
  createDefaultSpatialBands,
  formatSpatialFrequency,
  type SpatialBandChannel,
  type SpatialEqBand,
  type SpatialPlace,
} from "@/lib/audio/spatialCalibrationPlayer"

const STORAGE_KEY = "cabin:spatial-editor:v1"
const CHANNELS: SpatialBandChannel[] = ["left", "both", "right"]
const RESPONSE_FREQS = logFrequencies(20, 20000, 180)

const CHANNEL_STYLE: Record<SpatialBandChannel, { label: string; text: string; border: string; fill: string; line: string }> = {
  left: {
    label: "L",
    text: "text-cyan-200",
    border: "border-cyan-300/65",
    fill: "bg-cyan-300",
    line: "#22d3ee",
  },
  both: {
    label: "L+R",
    text: "text-violet-200",
    border: "border-violet-300/65",
    fill: "bg-violet-300",
    line: "#a78bfa",
  },
  right: {
    label: "R",
    text: "text-amber-200",
    border: "border-amber-300/65",
    fill: "bg-amber-300",
    line: "#f59e0b",
  },
}

interface StoredSpatialState {
  activePlaceId: string
  bands: SpatialEqBand[]
  volumeDb: number
}

function loadStoredState(places: SpatialPlace[]): StoredSpatialState {
  const fallback = {
    activePlaceId: places[Math.floor(places.length / 2)]?.id ?? "place-3",
    bands: createDefaultSpatialBands(places),
    volumeDb: -12,
  }
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredSpatialState>
    return {
      activePlaceId: parsed.activePlaceId ?? fallback.activePlaceId,
      bands: Array.isArray(parsed.bands) ? parsed.bands : fallback.bands,
      volumeDb: typeof parsed.volumeDb === "number" ? parsed.volumeDb : fallback.volumeDb,
    }
  } catch {
    return fallback
  }
}

function logX(frequency: number): number {
  return (Math.log2(frequency / 20) / Math.log2(20000 / 20)) * 100
}

function gainY(gainDb: number): number {
  const clamped = Math.max(SPATIAL_GAIN_MIN_DB, Math.min(SPATIAL_GAIN_MAX_DB, gainDb))
  return ((SPATIAL_GAIN_MAX_DB - clamped) / (SPATIAL_GAIN_MAX_DB - SPATIAL_GAIN_MIN_DB)) * 100
}

function responsePath(values: number[], width: number, height: number): string {
  return values
    .map((gainDb, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width
      const y = (gainY(gainDb) / 100) * height
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}

function bandsForChannel(bands: SpatialEqBand[], channel: "left" | "right"): EQBand[] {
  return bands
    .filter((band) => !band.bypassed && (band.channel === channel || band.channel === "both"))
    .map((band) => ({
      id: band.id,
      frequency: band.frequency,
      gain: band.gainDb,
      q: bandwidthOctToQ(band.bandwidthOct),
      type: "peaking" as BiquadFilterType,
      channel,
    }))
}

function EqCurve({
  bands,
  activePlace,
  activeBandId,
}: {
  bands: SpatialEqBand[]
  activePlace: SpatialPlace
  activeBandId: string | null
}) {
  const width = 760
  const height = 250
  const leftValues = useMemo(() => combinedMagnitudeAt(bandsForChannel(bands, "left"), RESPONSE_FREQS), [bands])
  const rightValues = useMemo(() => combinedMagnitudeAt(bandsForChannel(bands, "right"), RESPONSE_FREQS), [bands])

  return (
    <div className="relative h-[300px] rounded-lg border border-white/10 bg-black/20 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id="spatial-grid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill="url(#spatial-grid)" rx="8" />
        {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((freq) => {
          const x = (logX(freq) / 100) * width
          return (
            <g key={freq}>
              <line x1={x} x2={x} y1={0} y2={height} stroke="rgba(255,255,255,0.07)" />
              <text x={x + 4} y={height - 8} fill="rgba(255,255,255,0.38)" fontSize="10">
                {formatSpatialFrequency(freq)}
              </text>
            </g>
          )
        })}
        {[SPATIAL_GAIN_MIN_DB, -12, -6, 0, 6, 12, SPATIAL_GAIN_MAX_DB].map((gain) => {
          const y = (gainY(gain) / 100) * height
          return (
            <g key={gain}>
              <line x1={0} x2={width} y1={y} y2={y} stroke={gain === 0 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)"} />
              <text x={8} y={y - 4} fill="rgba(255,255,255,0.42)" fontSize="10">
                {gain > 0 ? "+" : ""}{gain}
              </text>
            </g>
          )
        })}
        <rect
          x={(logX(activePlace.lowerHz) / 100) * width}
          y={0}
          width={((logX(activePlace.upperHz) - logX(activePlace.lowerHz)) / 100) * width}
          height={height}
          fill="rgba(255,255,255,0.045)"
        />
        <path d={responsePath(leftValues, width, height)} fill="none" stroke={CHANNEL_STYLE.left.line} strokeWidth="3" strokeLinecap="round" />
        <path d={responsePath(rightValues, width, height)} fill="none" stroke={CHANNEL_STYLE.right.line} strokeWidth="3" strokeLinecap="round" />
        {bands.map((band) => {
          const x = (logX(band.frequency) / 100) * width
          const y = (gainY(band.gainDb) / 100) * height
          const style = CHANNEL_STYLE[band.channel]
          return (
            <circle
              key={band.id}
              cx={x}
              cy={y}
              r={activeBandId === band.id ? 7 : 5}
              fill={band.bypassed ? "rgba(255,255,255,0.26)" : style.line}
              stroke={activeBandId === band.id ? "white" : "rgba(0,0,0,0.45)"}
              strokeWidth="2"
            />
          )
        })}
      </svg>
      <div className="absolute right-4 top-3 flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-cyan-200"><span className="h-2 w-5 rounded-full bg-cyan-300" />Left</span>
        <span className="flex items-center gap-1 text-amber-200"><span className="h-2 w-5 rounded-full bg-amber-300" />Right</span>
      </div>
    </div>
  )
}

function XYBandPad({
  band,
  place,
  onChange,
  onFocus,
}: {
  band: SpatialEqBand
  place: SpatialPlace
  onChange: (patch: Partial<SpatialEqBand>) => void
  onFocus: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const style = CHANNEL_STYLE[band.channel]
  const xPct = ((Math.log2(band.frequency / place.lowerHz)) / Math.log2(place.upperHz / place.lowerHz)) * 100
  const yPct = gainY(band.gainDb)

  const updateFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const frequency = place.lowerHz * Math.pow(place.upperHz / place.lowerHz, x)
    const gainDb = SPATIAL_GAIN_MAX_DB - y * (SPATIAL_GAIN_MAX_DB - SPATIAL_GAIN_MIN_DB)
    onChange({ frequency, gainDb })
  }, [onChange, place.lowerHz, place.upperHz])

  return (
    <div
      ref={ref}
      className={cn("relative h-52 touch-none select-none rounded-lg border bg-black/25", band.bypassed ? "border-white/10 opacity-55" : style.border)}
      onPointerDown={(event) => {
        onFocus()
        event.currentTarget.setPointerCapture(event.pointerId)
        updateFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) return
        updateFromPointer(event)
      }}
    >
      <div className="absolute inset-x-0 top-1/2 border-t border-white/12" />
      <div className="absolute inset-y-0 left-1/2 border-l border-white/12" />
      <div className="absolute bottom-2 left-3 text-[10px] text-white/42">{formatSpatialFrequency(place.lowerHz)}</div>
      <div className="absolute bottom-2 right-3 text-[10px] text-white/42">{formatSpatialFrequency(place.upperHz)}</div>
      <div className="absolute left-3 top-2 text-[10px] text-white/42">+18</div>
      <div className="absolute bottom-7 left-3 text-[10px] text-white/42">-18</div>
      <div
        className={cn("absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.25)]", band.bypassed ? "bg-white/40" : style.fill)}
        style={{ left: `${xPct}%`, top: `${yPct}%` }}
      />
    </div>
  )
}

function BandEditor({
  band,
  place,
  active,
  onChange,
  onFocus,
}: {
  band: SpatialEqBand
  place: SpatialPlace
  active: boolean
  onChange: (patch: Partial<SpatialEqBand>) => void
  onFocus: () => void
}) {
  const style = CHANNEL_STYLE[band.channel]
  return (
    <div className={cn("space-y-3 rounded-lg border bg-white/[0.035] p-3", active ? style.border : "border-white/10")}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onFocus}
          className={cn("rounded border px-2 py-1 text-xs font-semibold", style.border, style.text)}
        >
          Band {band.label}
        </button>
        <div className="flex items-center gap-2 text-xs text-white/55">
          <span>Bypass</span>
          <Switch checked={!band.bypassed} onCheckedChange={(checked) => onChange({ bypassed: !checked })} />
        </div>
      </div>
      <XYBandPad band={band} place={place} onChange={onChange} onFocus={onFocus} />
      <div className="grid grid-cols-3 gap-1">
        {CHANNELS.map((channel) => (
          <button
            key={channel}
            type="button"
            onClick={() => onChange({ channel })}
            className={cn(
              "h-8 rounded border text-xs font-semibold transition-colors",
              band.channel === channel
                ? `${CHANNEL_STYLE[channel].border} ${CHANNEL_STYLE[channel].text} bg-white/10`
                : "border-white/10 text-white/45 hover:border-white/25 hover:text-white/70"
            )}
          >
            {CHANNEL_STYLE[channel].label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/45">Bandwidth</span>
          <span className="tabular-nums text-white/65">{band.bandwidthOct.toFixed(2)} oct</span>
        </div>
        <Slider
          value={[band.bandwidthOct]}
          min={SPATIAL_BANDWIDTH_MIN_OCT}
          max={SPATIAL_BANDWIDTH_MAX_OCT}
          step={0.01}
          onValueChange={([value]) => onChange({ bandwidthOct: value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs tabular-nums text-white/55">
        <span>{formatSpatialFrequency(band.frequency)} Hz</span>
        <span className="text-right">{band.gainDb > 0 ? "+" : ""}{band.gainDb.toFixed(1)} dB</span>
      </div>
    </div>
  )
}

export function SpatialPage() {
  const places = useMemo(() => buildSpatialPlaces(), [])
  const stored = useMemo(() => loadStoredState(places), [places])
  const [activePlaceId, setActivePlaceId] = useState(stored.activePlaceId)
  const [bands, setBands] = useState<SpatialEqBand[]>(stored.bands)
  const [volumeDb, setVolumeDb] = useState(stored.volumeDb)
  const [activeBandId, setActiveBandId] = useState<string | null>(null)
  const [calibrationPlaying, setCalibrationPlaying] = useState(false)
  const [musicPlaying, setMusicPlaying] = useState(false)
  const [audioName, setAudioName] = useState<string | null>(null)
  const [audioDuration, setAudioDuration] = useState<number | null>(null)
  const playerRef = useRef<SpatialCalibrationPlayer | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activePlace = places.find((place) => place.id === activePlaceId) ?? places[Math.floor(places.length / 2)]
  const activeBands = bands.filter((band) => band.placeId === activePlace.id)

  const getPlayer = useCallback(() => {
    if (!playerRef.current) playerRef.current = new SpatialCalibrationPlayer(bands, volumeDb)
    return playerRef.current
  }, [bands, volumeDb])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePlaceId, bands, volumeDb }))
    } catch {
      // Ignore storage failures.
    }
  }, [activePlaceId, bands, volumeDb])

  useEffect(() => {
    playerRef.current?.updateBands(bands)
  }, [bands])

  useEffect(() => {
    playerRef.current?.setVolumeDb(volumeDb)
  }, [volumeDb])

  useEffect(() => {
    if (!calibrationPlaying) return
    void getPlayer().startCalibration(activePlace)
  }, [activePlace, calibrationPlaying, getPlayer])

  useEffect(() => {
    if (activeBands.length > 0 && !activeBands.some((band) => band.id === activeBandId)) {
      setActiveBandId(activeBands[0].id)
    }
  }, [activeBandId, activeBands])

  useEffect(() => {
    return () => {
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [])

  const updateBand = useCallback((bandId: string, patch: Partial<SpatialEqBand>) => {
    setBands((previous) => previous.map((band) => band.id === bandId ? { ...band, ...patch } : band))
  }, [])

  const toggleCalibration = useCallback(async () => {
    const player = getPlayer()
    if (calibrationPlaying) {
      player.stopCalibration()
      setCalibrationPlaying(false)
      return
    }
    await player.startCalibration(activePlace)
    setCalibrationPlaying(true)
  }, [activePlace, calibrationPlaying, getPlayer])

  const handleAudioFile = useCallback(async (file: File | null) => {
    if (!file) return
    const buffer = await getPlayer().loadMusicFile(file)
    setAudioName(file.name)
    setAudioDuration(buffer.duration)
    setMusicPlaying(false)
  }, [getPlayer])

  const toggleMusic = useCallback(async () => {
    const player = getPlayer()
    if (musicPlaying) {
      player.pauseMusic()
      setMusicPlaying(false)
      return
    }
    await player.playMusic()
    setMusicPlaying(player.isMusicPlaying)
  }, [getPlayer, musicPlaying])

  const resetBands = useCallback(() => {
    const next = createDefaultSpatialBands(places)
    setBands(next)
    setActiveBandId(next.find((band) => band.placeId === activePlace.id)?.id ?? null)
  }, [activePlace.id, places])

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#090b0f_0%,#101418_48%,#08090c_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5 sm:px-7 lg:px-9">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="text-white/65 hover:text-white">
              <Link href="/" aria-label="Back to main page">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-lg font-semibold tracking-normal text-white">Spatial EQ</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
                <span>7 places</span>
                <span className="h-1 w-1 rounded-full bg-white/25" />
                <span>2 octave noise</span>
                <span className="h-1 w-1 rounded-full bg-white/25" />
                <span>-4.5 dB/oct</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={toggleCalibration} variant={calibrationPlaying ? "secondary" : "outline"} className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              {calibrationPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              Noise
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              <Upload className="h-4 w-4" />
              Audio
            </Button>
            <Button onClick={toggleMusic} disabled={!audioName} variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
              {musicPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              Track
            </Button>
            <Button onClick={resetBands} variant="ghost" size="icon" className="text-white/55 hover:text-white" aria-label="Reset bands">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => void handleAudioFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="mb-3 flex items-center justify-between text-xs text-white/55">
                <span>Slice</span>
                <span>{activePlace.label}</span>
              </div>
              <div className="flex h-[560px] flex-col-reverse gap-2">
                {places.map((place) => {
                  const selected = place.id === activePlace.id
                  const placeBands = bands.filter((band) => band.placeId === place.id)
                  return (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => {
                        setActivePlaceId(place.id)
                        setActiveBandId(placeBands[0]?.id ?? null)
                      }}
                      className={cn(
                        "flex flex-1 flex-col justify-center rounded-md border px-3 text-left transition-colors",
                        selected ? "border-white/40 bg-white/12" : "border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/8"
                      )}
                    >
                      <span className="text-sm font-medium text-white/85">{place.label}</span>
                      <span className="mt-1 text-[10px] tabular-nums text-white/42">
                        {formatSpatialFrequency(place.lowerHz)}-{formatSpatialFrequency(place.upperHz)}
                      </span>
                      <span className="mt-2 flex gap-1">
                        {placeBands.map((band) => (
                          <span
                            key={band.id}
                            className={cn(
                              "h-2.5 w-2.5 rounded-full",
                              band.bypassed ? "bg-white/20" : CHANNEL_STYLE[band.channel].fill
                            )}
                          />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-white/45">Output</span>
                <span className="tabular-nums text-white/65">{volumeDb} dB</span>
              </div>
              <Slider value={[volumeDb]} min={-36} max={0} step={1} onValueChange={([value]) => setVolumeDb(value)} />
              {audioName && (
                <div className="mt-3 truncate text-xs text-white/45">
                  {audioName} {audioDuration ? `(${Math.round(audioDuration)}s)` : ""}
                </div>
              )}
            </div>
          </aside>

          <section className="min-w-0 space-y-4">
            <EqCurve bands={bands} activePlace={activePlace} activeBandId={activeBandId} />
            <div className="grid gap-4 xl:grid-cols-2">
              {activeBands.map((band) => (
                <BandEditor
                  key={band.id}
                  band={band}
                  place={activePlace}
                  active={activeBandId === band.id}
                  onFocus={() => setActiveBandId(band.id)}
                  onChange={(patch) => updateBand(band.id, patch)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
