"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { RotateCcw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { VirtualStereoPlayer, DEFAULT_VIRTUAL_STEREO_SETTINGS } from "@/lib/audio/virtualStereoPlayer"
import type { HrtfDataset, HrtfMeasurement } from "@/lib/hrtf/types"

const DATASET_URL = "/hrtf/cipic-above-head.json"
const LEFT_SPEAKER_POSITION_KEY = "front_left"
const RIGHT_SPEAKER_POSITION_KEY = "front_right"
const STORAGE_PREFIX = "cabin:hrtf:virtualStereo"
const MASTER_GAIN_STORAGE_KEY = `${STORAGE_PREFIX}:masterGain`
const SUBJECT_INDEX_STORAGE_KEY = `${STORAGE_PREFIX}:subjectIndex`

const CHART_WIDTH = 360
const CHART_HEIGHT = 144
const CHART_DB_FLOOR = -30
const CHART_DB_CEIL = 0
const FREQUENCY_TICKS = [20, 100, 1000, 10000, 20000]
const DB_TICKS = [0, -10, -20, -30]

function loadStoredNumber(key: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) {
      return fallback
    }
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function saveStoredValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures and keep the player usable.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampIndex(index: number, total: number) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(total - 1, Math.round(index)))
}

function formatFrequencyLabel(frequency: number) {
  return frequency >= 1000 ? `${Math.round(frequency / 100) / 10}k` : `${Math.round(frequency)}`
}

function chartX(frequency: number) {
  const min = Math.log10(20)
  const max = Math.log10(20000)
  return ((Math.log10(frequency) - min) / (max - min)) * CHART_WIDTH
}

function chartY(db: number) {
  const clamped = clamp(db, CHART_DB_FLOOR, CHART_DB_CEIL)
  return ((CHART_DB_CEIL - clamped) / (CHART_DB_CEIL - CHART_DB_FLOOR)) * CHART_HEIGHT
}

function buildResponsePath(frequencies: number[], values: number[]) {
  if (frequencies.length === 0 || frequencies.length !== values.length) {
    return ""
  }

  return frequencies
    .map((frequency, index) => `${index === 0 ? "M" : "L"} ${chartX(frequency).toFixed(2)} ${chartY(values[index]).toFixed(2)}`)
    .join(" ")
}

function ResponsePreview({
  title,
  measurement,
  frequencies,
}: {
  title: string
  measurement: HrtfMeasurement | null
  frequencies: number[]
}) {
  const leftPath = useMemo(
    () => buildResponsePath(frequencies, measurement?.leftDb ?? []),
    [frequencies, measurement?.leftDb]
  )
  const rightPath = useMemo(
    () => buildResponsePath(frequencies, measurement?.rightDb ?? []),
    [frequencies, measurement?.rightDb]
  )
  const gradientBaseId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-")

  return (
    <div className="rounded-[28px] border border-white/10 bg-black/25 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-orange-200/55">Speaker HRTF</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-white/55">
            The cyan curve is what reaches the left ear. The orange curve is what reaches the right ear.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-white/65">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-300" />
            Left ear
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-300" />
            Right ear
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-4 py-4">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-[144px] w-full">
          <defs>
            <linearGradient id={`${gradientBaseId}-left-curve`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(103,232,249,0.6)" />
              <stop offset="100%" stopColor="rgba(34,211,238,1)" />
            </linearGradient>
            <linearGradient id={`${gradientBaseId}-right-curve`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(253,186,116,0.7)" />
              <stop offset="100%" stopColor="rgba(251,146,60,1)" />
            </linearGradient>
          </defs>

          {DB_TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1="0"
                x2={CHART_WIDTH}
                y1={chartY(tick)}
                y2={chartY(tick)}
                stroke="rgba(255,255,255,0.08)"
                strokeDasharray="4 6"
              />
            </g>
          ))}

          {FREQUENCY_TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1={chartX(tick)}
                x2={chartX(tick)}
                y1="0"
                y2={CHART_HEIGHT}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="4 8"
              />
              <text
                x={chartX(tick)}
                y={CHART_HEIGHT - 6}
                fill="rgba(255,255,255,0.5)"
                fontSize="11"
                textAnchor={tick === 20 ? "start" : tick === 20000 ? "end" : "middle"}
              >
                {formatFrequencyLabel(tick)}
              </text>
            </g>
          ))}

          <path d={leftPath} fill="none" stroke={`url(#${gradientBaseId}-left-curve)`} strokeWidth="3" strokeLinecap="round" />
          <path d={rightPath} fill="none" stroke={`url(#${gradientBaseId}-right-curve)`} strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}

export function VirtualStereoPlayerTab() {
  const playerRef = useRef<VirtualStereoPlayer | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  if (!playerRef.current) {
    playerRef.current = new VirtualStereoPlayer()
  }

  const [dataset, setDataset] = useState<HrtfDataset | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [masterGain, setMasterGain] = useState(() =>
    loadStoredNumber(MASTER_GAIN_STORAGE_KEY, DEFAULT_VIRTUAL_STEREO_SETTINGS.masterGain * 100)
  )
  const [selectedIndex, setSelectedIndex] = useState(() => loadStoredNumber(SUBJECT_INDEX_STORAGE_KEY, 0))
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selectedSubject = dataset?.subjects[clampIndex(selectedIndex, dataset?.subjects.length ?? 0)] ?? null
  const leftSpeakerMeasurement = selectedSubject?.positions[LEFT_SPEAKER_POSITION_KEY] ?? null
  const rightSpeakerMeasurement = selectedSubject?.positions[RIGHT_SPEAKER_POSITION_KEY] ?? null

  useEffect(() => {
    const player = playerRef.current
    const audioElement = audioElementRef.current
    if (!player || !audioElement) {
      return
    }

    player.attachMediaElement(audioElement)

    return () => {
      void player.destroy()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadDataset() {
      try {
        setIsLoading(true)
        setErrorMessage(null)

        const response = await fetch(DATASET_URL, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Failed to load HRTF dataset (${response.status}).`)
        }

        const nextDataset = (await response.json()) as HrtfDataset
        if (controller.signal.aborted) return

        const positionKeys = new Set(nextDataset.positions.map((position) => position.key))
        if (!positionKeys.has(LEFT_SPEAKER_POSITION_KEY) || !positionKeys.has(RIGHT_SPEAKER_POSITION_KEY)) {
          throw new Error("The HRTF dataset does not include front-left and front-right speaker positions.")
        }

        setDataset(nextDataset)
        playerRef.current?.setDataset(nextDataset)
        setSelectedIndex((current) => clampIndex(current, nextDataset.subjects.length))
      } catch (error) {
        if (controller.signal.aborted) return
        setErrorMessage(error instanceof Error ? error.message : "Failed to load the HRTF dataset.")
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadDataset()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!dataset) {
      return
    }

    const clamped = clampIndex(selectedIndex, dataset.subjects.length)
    saveStoredValue(SUBJECT_INDEX_STORAGE_KEY, String(clamped))
    playerRef.current?.setSubjectIndex(clamped)
  }, [dataset, selectedIndex])

  useEffect(() => {
    const clamped = clamp(masterGain, 0, 150)
    saveStoredValue(MASTER_GAIN_STORAGE_KEY, String(clamped))
    playerRef.current?.setSettings({
      masterGain: clamped / 100,
    })
  }, [masterGain])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  function resetDefaults() {
    setMasterGain(DEFAULT_VIRTUAL_STEREO_SETTINGS.masterGain * 100)
    setSelectedIndex(0)
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (!nextFile) {
      return
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const nextUrl = URL.createObjectURL(nextFile)
    objectUrlRef.current = nextUrl
    setAudioUrl(nextUrl)
    setFileName(nextFile.name)

    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current.currentTime = 0
      audioElementRef.current.src = nextUrl
      audioElementRef.current.load()
    }

    await playerRef.current?.resume()
  }

  return (
    <section className="grid gap-8 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <div className="rounded-[32px] border border-white/10 bg-white/[0.045] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <p className="text-[11px] uppercase tracking-[0.3em] text-orange-200/60">Virtual Stereo</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-white">Front speaker HRTF player</h1>
          <p className="mt-4 text-sm leading-6 text-white/68">
            Load a stereo music file, then render the left channel as a virtual front-left speaker and the right
            channel as a virtual front-right speaker through the selected HRTF profile.
          </p>

          <div className="mt-6 grid gap-3 text-sm text-white/74">
            <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
              Left program channel uses the selected profile&apos;s <span className="font-medium text-white">front-left</span> measurement.
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
              Right program channel uses the same profile&apos;s <span className="font-medium text-white">front-right</span> measurement.
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
              The current bundled public pack for this view is <span className="font-medium text-white">CIPIC</span>, because it includes both required speaker angles.
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">Audio file</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 rounded-full bg-white text-black hover:bg-white/90"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Load music
                </Button>
                <span className="text-sm text-white/55">{fileName ?? "No file loaded yet"}</span>
              </div>
              <Input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={(event) => void handleFileChange(event)}
                className="hidden"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <audio
                ref={audioElementRef}
                controls
                preload="metadata"
                className="w-full"
                src={audioUrl ?? undefined}
              >
                Your browser does not support the audio element.
              </audio>
            </div>
          </div>

          {errorMessage && (
            <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="rounded-[32px] border border-white/10 bg-white/[0.045] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.3)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">Profile</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {selectedSubject ? selectedSubject.label : "Loading HRTF profiles"}
              </h2>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={resetDefaults}
              className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>

          <div className="mt-6 space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">HRTF profile</p>
                  <p className="text-xs text-white/50">Sweep through the available CIPIC measured listeners.</p>
                </div>
                <div className="text-sm text-white/60">
                  {dataset ? `${clampIndex(selectedIndex, dataset.subjects.length) + 1} / ${dataset.subjects.length}` : "--"}
                </div>
              </div>
              <Slider
                aria-label="Virtual stereo HRTF profile"
                value={[clampIndex(selectedIndex, dataset?.subjects.length ?? 0)]}
                min={0}
                max={Math.max((dataset?.subjects.length ?? 1) - 1, 0)}
                step={1}
                disabled={!dataset || isLoading}
                onValueChange={(value) => setSelectedIndex(value[0] ?? 0)}
                className="py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Master output</p>
                  <p className="text-xs text-white/50">Overall level after both virtual speakers are summed.</p>
                </div>
                <div className="text-sm text-white/60">{Math.round(masterGain)}%</div>
              </div>
              <Slider
                aria-label="Virtual stereo output"
                value={[masterGain]}
                min={20}
                max={150}
                step={1}
                onValueChange={(value) => setMasterGain(value[0] ?? 72)}
                className="py-3"
                rangeClassName="bg-[linear-gradient(90deg,#34d399_0%,#22c55e_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-white/[0.045] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.3)] backdrop-blur-xl">
          <p className="text-[11px] uppercase tracking-[0.28em] text-orange-200/60">Source</p>
          <p className="mt-3 text-sm leading-6 text-white/65">
            Source:{" "}
            {dataset?.source.repository ? (
              <a
                href={dataset.source.repository}
                target="_blank"
                rel="noreferrer"
                className="text-orange-200 underline decoration-orange-200/35 underline-offset-4"
              >
                {dataset.source.name}
              </a>
            ) : (
              dataset?.source.name ?? "HRTF dataset"
            )}
            . This mode fixes the scene to two speakers in front of you: one front-left and one front-right.
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        {isLoading || !dataset || !selectedSubject ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.045] p-6 text-white/55 backdrop-blur-xl">
            Loading virtual speaker HRTF profiles...
          </div>
        ) : (
          <>
            <ResponsePreview
              title="Left Speaker · Front Left"
              measurement={leftSpeakerMeasurement}
              frequencies={dataset.frequencies}
            />
            <ResponsePreview
              title="Right Speaker · Front Right"
              measurement={rightSpeakerMeasurement}
              frequencies={dataset.frequencies}
            />
          </>
        )}
      </div>
    </section>
  )
}
