"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ArrowLeft, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import * as dotGridAudio from "@/lib/audio/dotGridAudio"
import { resumeAudioContext } from "@/lib/audio/audioContext"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { cn } from "@/lib/utils"

const SPEED_MIN = 0.05
const SPEED_MAX = 64
const DEFAULT_SPEED = 32
const MIN_PER_HIT_MS = 30
const MAX_PER_HIT_MS = 2500
const SPEED_INTERVAL_MULTIPLIER = 2
const HIT_ATTACK_S = 0.01
const AUTO_RELEASE_MARGIN_S = 0.005
const DEFAULT_HIT_STAGGER_PERCENT = 100
const FIXED_ACCENT_RELEASE_MS = 200
const DEFAULT_CLICK_TRAIN_VOLUME_PERCENT = 500
const DEFAULT_VOLUME_DB = 0
const LOUD_QUIET_BLOCK_SIZE = 8
const LOUD_QUIET_RATIO = 0.5
const DEFAULT_BANDWIDTH_FILTER_MODE = dotGridAudio.DEFAULT_BANDWIDTH_FILTER_MODE
const MIN_BAND_HEIGHT = dotGridAudio.getBandpassRangeForNormalizedBand(0, 0).upperNormalized

type ColumnBand = {
  id: string
  lower: number
  upper: number
}

type DragMode = "move" | "top" | "bottom"
type SoundChoice = "click" | "band-noise"

const DEFAULT_BANDS: ColumnBand[] = [
  { id: "band-1", lower: 0.08, upper: 0.34 },
  { id: "band-2", lower: 0.22, upper: 0.52 },
  { id: "band-3", lower: 0.38, upper: 0.66 },
  { id: "band-4", lower: 0.48, upper: 0.82 },
  { id: "band-5", lower: 0.62, upper: 0.92 },
]

const BAND_COLORS = [
  "border-cyan-300/80 bg-cyan-400/25 text-cyan-100 shadow-cyan-400/15",
  "border-emerald-300/80 bg-emerald-400/25 text-emerald-100 shadow-emerald-400/15",
  "border-amber-300/80 bg-amber-400/25 text-amber-100 shadow-amber-400/15",
  "border-fuchsia-300/80 bg-fuchsia-400/25 text-fuchsia-100 shadow-fuchsia-400/15",
  "border-sky-300/80 bg-sky-400/25 text-sky-100 shadow-sky-400/15",
  "border-lime-300/80 bg-lime-400/25 text-lime-100 shadow-lime-400/15",
]

const FREQUENCY_LABELS = [20000, 8000, 3000, 1000, 300, 100, 30]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function speedToPerHitSeconds(speed: number): number {
  const t = clamp((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN), 0, 1)
  const perHitMs = MAX_PER_HIT_MS * Math.pow(MIN_PER_HIT_MS / MAX_PER_HIT_MS, t)
  return (perHitMs * SPEED_INTERVAL_MULTIPLIER) / 1000
}

function getAutoReleaseSeconds(perHitSeconds: number): number {
  return Math.max(0.001, perHitSeconds - HIT_ATTACK_S - AUTO_RELEASE_MARGIN_S)
}

function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`
  }

  return `${Math.round(hz)} Hz`
}

function getBandCenter(band: ColumnBand): number {
  return (band.lower + band.upper) / 2
}

function getBandHeight(band: ColumnBand): number {
  return band.upper - band.lower
}

function getFrequencyLabelPosition(frequency: number): number {
  const bottom = 30
  const top = 20000
  return clamp(Math.log2(frequency / bottom) / Math.log2(top / bottom), 0, 1)
}

function clampBand(lower: number, upper: number): Pick<ColumnBand, "lower" | "upper"> {
  const safeLower = clamp(Math.min(lower, upper), 0, 1 - MIN_BAND_HEIGHT)
  const safeUpper = clamp(Math.max(lower, upper), safeLower + MIN_BAND_HEIGHT, 1)
  return { lower: safeLower, upper: safeUpper }
}

function moveBandToCenter(band: ColumnBand, center: number): Pick<ColumnBand, "lower" | "upper"> {
  const height = getBandHeight(band)
  const lower = clamp(center - height / 2, 0, 1 - height)
  return { lower, upper: lower + height }
}

function resizeBandAroundCenter(band: ColumnBand, height: number): Pick<ColumnBand, "lower" | "upper"> {
  const nextHeight = clamp(height, MIN_BAND_HEIGHT, 1)
  const center = getBandCenter(band)
  const lower = clamp(center - nextHeight / 2, 0, 1 - nextHeight)
  return { lower, upper: lower + nextHeight }
}

function SettingSlider({
  label,
  value,
  valueLabel,
  min,
  max,
  step,
  onValueChange,
}: {
  label: string
  value: number
  valueLabel: string
  min: number
  max: number
  step: number
  onValueChange: (value: number) => void
}) {
  return (
    <label className="grid gap-2 text-xs text-white/70">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-white/85">{valueLabel}</span>
      </span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onValueChange(next[0] ?? value)}
        rangeClassName="bg-cyan-300"
        thumbClassName="border-cyan-200"
      />
    </label>
  )
}

export function BandwidthColumnsPage() {
  const setEQEnabled = useEQProfileStore((state) => state.setEQEnabled)
  const [bands, setBands] = useState<ColumnBand[]>(DEFAULT_BANDS)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_BANDS[0].id)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [volumeDb, setVolumeDb] = useState(DEFAULT_VOLUME_DB)
  const [hitMultiplier, setHitMultiplier] = useState(1)
  const [hitStaggerPercent, setHitStaggerPercent] = useState(DEFAULT_HIT_STAGGER_PERCENT)
  const [threeLevelVolumeEnabled, setThreeLevelVolumeEnabled] = useState(false)
  const [soundChoice, setSoundChoice] = useState<SoundChoice>("click")
  const plotRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; mode: DragMode; pointerId: number } | null>(null)

  const dotKeys = useMemo(() => Array.from({ length: bands.length }, (_, index) => `${index},0`), [bands.length])
  const activeDotSet = useMemo(() => new Set(dotKeys), [dotKeys])
  const columnConfigs = useMemo(() => {
    const lastIndex = Math.max(1, bands.length - 1)
    return bands.map((band, index) => {
      const range = dotGridAudio.getBandpassRangeForNormalizedBand(
        band.lower,
        band.upper,
        DEFAULT_BANDWIDTH_FILTER_MODE
      )

      return {
        band,
        key: dotKeys[index] ?? `${index},0`,
        range,
        normalizedX: bands.length <= 1 ? 0.5 : index / lastIndex,
      }
    })
  }, [bands, dotKeys])

  const positionMap = useMemo(() => {
    return new Map(
      columnConfigs.map(({ key, range, normalizedX }) => [
        key,
        { normalizedX, normalizedY: range.audioNormalizedY },
      ])
    )
  }, [columnConfigs])

  const bandwidthMap = useMemo(() => {
    return new Map(columnConfigs.map(({ key, range }) => [key, range.bandwidthOctaves]))
  }, [columnConfigs])

  const selectedBand = bands.find((band) => band.id === selectedId) ?? bands[0]
  const selectedConfig = columnConfigs.find(({ band }) => band.id === selectedBand?.id)
  const perHitSeconds = useMemo(() => speedToPerHitSeconds(speed), [speed])
  const hitStaggerSeconds = useMemo(
    () => perHitSeconds * (hitStaggerPercent / 100),
    [hitStaggerPercent, perHitSeconds]
  )
  const effectiveRelease = useMemo(() => getAutoReleaseSeconds(perHitSeconds), [perHitSeconds])

  const getPointerNormalizedY = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.height <= 0) return null
    return clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
  }, [])

  const updateBandFromPointer = useCallback((id: string, mode: DragMode, normalizedY: number) => {
    setBands((prevBands) => prevBands.map((band) => {
      if (band.id !== id) return band

      if (mode === "move") {
        return { ...band, ...moveBandToCenter(band, normalizedY) }
      }

      if (mode === "top") {
        return { ...band, ...clampBand(band.lower, normalizedY) }
      }

      return { ...band, ...clampBand(normalizedY, band.upper) }
    }))
  }, [])

  const handlePointerDown = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    id: string,
    mode: DragMode
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(id)
    dragRef.current = { id, mode, pointerId: event.pointerId }

    const normalizedY = getPointerNormalizedY(event)
    if (normalizedY !== null) {
      updateBandFromPointer(id, mode, normalizedY)
    }
  }, [getPointerNormalizedY, updateBandFromPointer])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    const normalizedY = getPointerNormalizedY(event)
    if (normalizedY !== null) {
      updateBandFromPointer(drag.id, drag.mode, normalizedY)
    }
  }, [getPointerNormalizedY, updateBandFromPointer])

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
  }, [])

  const updateSelectedBand = useCallback((update: (band: ColumnBand) => Pick<ColumnBand, "lower" | "upper">) => {
    if (!selectedBand) return
    setBands((prevBands) => prevBands.map((band) => (
      band.id === selectedBand.id ? { ...band, ...update(band) } : band
    )))
  }, [selectedBand])

  const handleAddColumn = useCallback(() => {
    setBands((prevBands) => {
      const nextIndex = prevBands.length + 1
      const newBand: ColumnBand = {
        id: `band-${Date.now()}`,
        lower: 0.16 + (nextIndex % 4) * 0.11,
        upper: 0.42 + (nextIndex % 4) * 0.11,
      }
      setSelectedId(newBand.id)
      return [...prevBands, newBand]
    })
  }, [])

  const handleRemoveSelected = useCallback(() => {
    setBands((prevBands) => {
      if (prevBands.length <= 1) return prevBands

      const selectedIndex = prevBands.findIndex((band) => band.id === selectedId)
      const nextBands = prevBands.filter((band) => band.id !== selectedId)
      const nextSelected = nextBands[Math.max(0, Math.min(nextBands.length - 1, selectedIndex))]
      setSelectedId(nextSelected?.id ?? nextBands[0].id)
      return nextBands
    })
  }, [selectedId])

  const handleReset = useCallback(() => {
    setBands(DEFAULT_BANDS)
    setSelectedId(DEFAULT_BANDS[0].id)
  }, [])

  const handlePlayToggle = useCallback(() => {
    setIsPlaying((playing) => !playing)
  }, [])

  useEffect(() => {
    if (bands.some((band) => band.id === selectedId)) return
    setSelectedId(bands[0]?.id ?? "")
  }, [bands, selectedId])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()

    player.clearDotNormalizedPositions()
    player.clearDotBandpassBandwidths()
    player.setLoopSequencerEnabled(true)
    player.setLoopSequencerPlayTogether(false)
    player.setInterleavedHits(false)
    player.setVolumeLevelRangeDb(0)
    player.setSubHitPlaybackEnabled(false)
    player.setHitModeAttack(HIT_ATTACK_S)
    player.setPerCycleVolumeEnabled(false)
    player.setPerDotVolumeWaveEnabled(false)
    player.setAutoVolumeCycleEnabled(false)
    player.setBandwidthOscillationEnabled(false)
    player.setLoudQuietBandwidthModeEnabled(false)
    player.setBandwidthFilterMode(DEFAULT_BANDWIDTH_FILTER_MODE)
    player.setGentleEdgeFalloffDbPerOct(dotGridAudio.DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT)
    player.setBandpassSlope(-4.5)
    player.setFourFourHitModeEnabled(true)
    player.setFourFourVolumeBlockSize(LOUD_QUIET_BLOCK_SIZE)
    player.setFourFourVolumePerDot(false)
    player.setFourFourSidePolarityEnabled(false)
    player.setContinuousLoudQuietRatio(LOUD_QUIET_RATIO)
    player.setHiHatModeEnabled(false)
    player.setPatternModeEnabled(false)
    player.setPatternAccentEvery(8)
    player.setPatternVolumeDiffDb(0)
    player.setExperimentalModeEnabled(false)
    player.setSnareScoopEnabled(false)
    player.setSnareScoopDepthDb(dotGridAudio.DEFAULT_SNARE_SCOOP_DEPTH_DB)
    player.setSnareScoopBandwidthOctaves(dotGridAudio.DEFAULT_SNARE_SCOOP_BANDWIDTH_OCTAVES_BY_MODE.single)
    player.setSnareScoopMode(dotGridAudio.DEFAULT_SNARE_SCOOP_MODE)
    player.setTiltOscillationEnabled(false)
    player.setTiltOscillationAmount(1.5)
    player.setReverbModeEnabled(false)
    player.setReverbVolumeSpreadDb(12)
    player.setHiHatQuietDropDb(20)
    player.setHiHatLoudReleaseBoostMs(FIXED_ACCENT_RELEASE_MS)
    player.setClickTrainGainPercent(DEFAULT_CLICK_TRAIN_VOLUME_PERCENT)
    player.setClickTrainDurationGateEnabled(true)
    player.setVolumeDb(DEFAULT_VOLUME_DB)

    const analyser = player.createPreEQAnalyser()
    player.connectToAnalyser(analyser)
    setEQEnabled(true)

    return () => {
      player.setPlaying(false)
      player.updateDots(new Set(), 1, 1)
      player.clearDotNormalizedPositions()
      player.clearDotBandpassBandwidths()
    }
  }, [setEQEnabled])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setDotNormalizedPositions(positionMap)
    player.setDotBandpassBandwidths(bandwidthMap)
  }, [bandwidthMap, positionMap])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().updateDots(activeDotSet, 1, Math.max(1, bands.length))
  }, [activeDotSet, bands.length])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    const useBandNoise = soundChoice === "band-noise"
    player.setClickTrainDurationGateEnabled(!useBandNoise)
    player.setContinuousNoiseModeEnabled(false, useBandNoise)
    player.setFourFourStraightNoiseEnabled(useBandNoise)
    player.setSoundMode(useBandNoise ? dotGridAudio.SoundMode.BandpassedNoise : dotGridAudio.SoundMode.ClickTrain)
  }, [soundChoice])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    const totalHits = Math.max(1, bands.length)
    player.setHitModeStagger(hitStaggerSeconds)
    player.setHitModeRate(1 / (perHitSeconds * totalHits))
    player.setContinuousLoudQuietStepSeconds(perHitSeconds)
    player.setHitModeRelease(effectiveRelease)
  }, [bands.length, effectiveRelease, hitStaggerSeconds, perHitSeconds])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setNumberOfHits(hitMultiplier)
  }, [hitMultiplier])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.setFourFourThreeLevelVolumeEnabled(threeLevelVolumeEnabled)
    player.setLoudQuietBandwidthModeEnabled(false)
  }, [threeLevelVolumeEnabled])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setVolumeDb(volumeDb)
  }, [volumeDb])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    if (!isPlaying || activeDotSet.size === 0) {
      player.setPlaying(false)
      return
    }

    void resumeAudioContext().then(() => {
      player.setPlaying(true)
    })
  }, [activeDotSet.size, isPlaying])

  const selectedCenterPercent = selectedBand ? getBandCenter(selectedBand) * 100 : 0
  const selectedHeightPercent = selectedBand ? getBandHeight(selectedBand) * 100 : 0

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="icon" className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">
              <Link href="/" aria-label="Back to main view">
                <ArrowLeft />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-white">Bandwidth Columns</h1>
              <p className="text-sm text-white/55">Column height and placement set each occupied band.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handlePlayToggle}
              className="min-w-28 bg-cyan-300 text-zinc-950 hover:bg-cyan-200"
            >
              {isPlaying ? <Pause /> : <Play />}
              {isPlaying ? "Stop" : "Play"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={handleAddColumn}
            >
              <Plus />
              Column
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={handleReset}
            >
              <RotateCcw />
              Reset
            </Button>
          </div>
        </header>

        <section className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative min-h-[520px] overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-2xl shadow-black/30">
            <div className="absolute inset-y-6 left-4 w-12 text-[10px] text-white/45">
              {FREQUENCY_LABELS.map((frequency) => (
                <span
                  key={frequency}
                  className="absolute right-0 -translate-y-1/2 font-mono"
                  style={{ top: `${(1 - getFrequencyLabelPosition(frequency)) * 100}%` }}
                >
                  {formatFrequency(frequency)}
                </span>
              ))}
            </div>

            <div
              ref={plotRef}
              className="absolute inset-y-6 left-20 right-6 rounded-md border border-white/10 bg-[linear-gradient(to_top,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[length:100%_12.5%]"
            >
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${bands.length}, minmax(0, 1fr))` }}>
                {columnConfigs.map(({ band, range }, index) => {
                  const selected = band.id === selectedId
                  const color = BAND_COLORS[index % BAND_COLORS.length]

                  return (
                    <div key={band.id} className="relative min-w-0 border-l border-white/5 first:border-l-0">
                      <button
                        type="button"
                        aria-label={`Select column ${index + 1}`}
                        className={cn(
                          "absolute left-2 right-2 touch-none rounded-md border shadow-lg transition-[border-color,background-color,box-shadow]",
                          "cursor-grab active:cursor-grabbing",
                          color,
                          selected ? "ring-2 ring-white/80" : "hover:ring-1 hover:ring-white/35"
                        )}
                        style={{
                          bottom: `${range.lowerNormalized * 100}%`,
                          height: `${(range.upperNormalized - range.lowerNormalized) * 100}%`,
                        }}
                        onPointerDown={(event) => handlePointerDown(event, band.id, "move")}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}
                      >
                        <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-current/70" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Adjust top of column ${index + 1}`}
                        className={cn(
                          "absolute left-3 right-3 h-3 -translate-y-1/2 touch-none rounded-full border border-white/70 bg-white/90 shadow-sm",
                          "cursor-ns-resize"
                        )}
                        style={{ bottom: `${range.upperNormalized * 100}%` }}
                        onPointerDown={(event) => handlePointerDown(event, band.id, "top")}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}
                      />
                      <button
                        type="button"
                        aria-label={`Adjust bottom of column ${index + 1}`}
                        className={cn(
                          "absolute left-3 right-3 h-3 translate-y-1/2 touch-none rounded-full border border-white/70 bg-white/90 shadow-sm",
                          "cursor-ns-resize"
                        )}
                        style={{ bottom: `${range.lowerNormalized * 100}%` }}
                        onPointerDown={(event) => handlePointerDown(event, band.id, "bottom")}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <aside className="flex min-h-[520px] flex-col gap-4 rounded-lg border border-white/10 bg-zinc-900/95 p-4 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Selected Column</h2>
                {selectedConfig && (
                  <p className="mt-1 font-mono text-xs text-white/55">
                    {formatFrequency(selectedConfig.range.lowerEdge)} - {formatFrequency(selectedConfig.range.upperEdge)}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={handleRemoveSelected}
                disabled={bands.length <= 1}
                aria-label="Remove selected column"
              >
                <Trash2 />
              </Button>
            </div>

            {selectedBand && selectedConfig && (
              <div className="grid gap-4 border-y border-white/10 py-4">
                <SettingSlider
                  label="Position"
                  value={selectedCenterPercent}
                  valueLabel={`${Math.round(selectedCenterPercent)}%`}
                  min={MIN_BAND_HEIGHT * 50}
                  max={100 - MIN_BAND_HEIGHT * 50}
                  step={1}
                  onValueChange={(value) => updateSelectedBand((band) => moveBandToCenter(band, value / 100))}
                />
                <SettingSlider
                  label="Height"
                  value={selectedHeightPercent}
                  valueLabel={`${selectedConfig.range.bandwidthOctaves.toFixed(2)} oct`}
                  min={MIN_BAND_HEIGHT * 100}
                  max={100}
                  step={1}
                  onValueChange={(value) => updateSelectedBand((band) => resizeBandAroundCenter(band, value / 100))}
                />
              </div>
            )}

            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["click", "Click train"],
                  ["band-noise", "Band noise"],
                ] as const).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    className={cn(
                      "border-white/10 text-white hover:bg-white/10 hover:text-white",
                      soundChoice === value ? "bg-cyan-300 text-zinc-950 hover:bg-cyan-200 hover:text-zinc-950" : "bg-white/5"
                    )}
                    onClick={() => setSoundChoice(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              <SettingSlider
                label="Speed"
                value={speed}
                valueLabel={`${(1 / perHitSeconds).toFixed(1)} hit/s`}
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={0.05}
                onValueChange={setSpeed}
              />
              <SettingSlider
                label="Stagger"
                value={hitStaggerPercent}
                valueLabel={`${Math.round(hitStaggerPercent)}%`}
                min={5}
                max={100}
                step={1}
                onValueChange={setHitStaggerPercent}
              />
              <SettingSlider
                label="Hits"
                value={hitMultiplier}
                valueLabel={`${hitMultiplier.toFixed(0)}x`}
                min={1}
                max={32}
                step={1}
                onValueChange={(value) => setHitMultiplier(Math.round(value))}
              />
              <SettingSlider
                label="Volume"
                value={volumeDb}
                valueLabel={`${volumeDb > 0 ? "+" : ""}${volumeDb.toFixed(0)} dB`}
                min={-36}
                max={12}
                step={1}
                onValueChange={setVolumeDb}
              />

              <Button
                type="button"
                variant="outline"
                className={cn(
                  "justify-start border-white/10 text-white hover:bg-white/10 hover:text-white",
                  threeLevelVolumeEnabled ? "bg-emerald-300 text-zinc-950 hover:bg-emerald-200 hover:text-zinc-950" : "bg-white/5"
                )}
                onClick={() => setThreeLevelVolumeEnabled((enabled) => !enabled)}
              >
                3-level volume
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto border-t border-white/10 pt-3">
              <div className="grid gap-2">
                {columnConfigs.map(({ band, range }, index) => (
                  <button
                    key={band.id}
                    type="button"
                    className={cn(
                      "grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition-colors",
                      band.id === selectedId
                        ? "border-white/45 bg-white/12"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                    )}
                    onClick={() => setSelectedId(band.id)}
                  >
                    <span className="font-mono text-white/60">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-white/85">
                        {formatFrequency(range.lowerEdge)} - {formatFrequency(range.upperEdge)}
                      </span>
                      <span className="block font-mono text-[11px] text-white/45">
                        {range.bandwidthOctaves.toFixed(2)} oct
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
