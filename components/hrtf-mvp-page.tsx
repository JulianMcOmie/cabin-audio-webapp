"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VirtualStereoPlayerTab } from "@/components/virtual-stereo-player-tab"
import { HrtfDrumsPlayer, type DrumName } from "@/lib/audio/hrtfDrumsPlayer"
import type { HrtfDataset } from "@/lib/hrtf/types"

const PAGE_TAB_STORAGE_KEY = "cabin:hrtf:pageTab"
const DRUM_SUBJECT_STORAGE_KEY = "cabin:hrtf:drumSubject"
const DATASET_URL = "/hrtf/cipic-above-head.json"

type PageTab = "explorer" | "virtual-stereo"

interface DrumConfig {
  key: DrumName
  label: string
  positionLabel: string
  tagline: string
}

const DRUMS: DrumConfig[] = [
  {
    key: "hihat",
    label: "Hi-hat",
    positionLabel: "Above · polar 90°",
    tagline: "Overhead cymbal — straight above the listener.",
  },
  {
    key: "snare",
    label: "Snare",
    positionLabel: "Above ↔ Front blend · polar ~45°",
    tagline: "Midway between overhead and directly in front.",
  },
  {
    key: "kick",
    label: "Kick",
    positionLabel: "Front · polar 0°",
    tagline: "Directly in front of the listener, ear level.",
  },
]

function drumStorageKey(drum: DrumName) {
  return `${DRUM_SUBJECT_STORAGE_KEY}:${drum}`
}

function loadStoredNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function saveStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures.
  }
}

function loadStoredPageTab(): PageTab {
  if (typeof window === "undefined") return "explorer"
  try {
    const raw = window.localStorage.getItem(PAGE_TAB_STORAGE_KEY)
    return raw === "virtual-stereo" ? "virtual-stereo" : "explorer"
  } catch {
    return "explorer"
  }
}

function clampIndex(value: number, total: number) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(total - 1, Math.round(value)))
}

export function HrtfMvpPage() {
  const playerRef = useRef<HrtfDrumsPlayer | null>(null)
  if (!playerRef.current) {
    playerRef.current = new HrtfDrumsPlayer()
  }

  const [activeTab, setActiveTab] = useState<PageTab>(() => loadStoredPageTab())
  const [dataset, setDataset] = useState<HrtfDataset | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [subjectIndices, setSubjectIndices] = useState<Record<DrumName, number>>(() => ({
    hihat: Math.max(0, Math.round(loadStoredNumber(drumStorageKey("hihat"), 0))),
    snare: Math.max(0, Math.round(loadStoredNumber(drumStorageKey("snare"), 0))),
    kick: Math.max(0, Math.round(loadStoredNumber(drumStorageKey("kick"), 0))),
  }))

  useEffect(() => {
    const controller = new AbortController()

    async function loadDataset() {
      try {
        setIsLoading(true)
        setErrorMessage(null)

        const response = await fetch(DATASET_URL, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Failed to load dataset (${response.status}).`)
        }

        const nextDataset = (await response.json()) as HrtfDataset
        if (controller.signal.aborted) return

        const total = nextDataset.subjects.length
        const clampedIndices: Record<DrumName, number> = {
          hihat: clampIndex(subjectIndices.hihat, total),
          snare: clampIndex(subjectIndices.snare, total),
          kick: clampIndex(subjectIndices.kick, total),
        }

        playerRef.current?.setDataset(nextDataset)
        ;(Object.keys(clampedIndices) as DrumName[]).forEach((drum) => {
          playerRef.current?.setSubjectIndex(drum, clampedIndices[drum])
        })

        setDataset(nextDataset)
        setSubjectIndices(clampedIndices)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      void playerRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    saveStoredValue(PAGE_TAB_STORAGE_KEY, activeTab)
    if (activeTab !== "explorer" && isPlaying) {
      void playerRef.current?.stop()
      setIsPlaying(false)
    }
  }, [activeTab, isPlaying])

  async function handlePlaybackToggle() {
    if (!dataset) return

    try {
      setErrorMessage(null)

      if (isPlaying) {
        await playerRef.current?.stop()
        setIsPlaying(false)
        return
      }

      await playerRef.current?.start()
      setIsPlaying(true)
    } catch (error) {
      setIsPlaying(false)
      setErrorMessage(error instanceof Error ? error.message : "Audio playback failed.")
    }
  }

  function handleSubjectChange(drum: DrumName, value: number) {
    const total = dataset?.subjects.length ?? 0
    const clamped = clampIndex(value, total)
    setSubjectIndices((current) => ({ ...current, [drum]: clamped }))
    saveStoredValue(drumStorageKey(drum), String(clamped))
    playerRef.current?.setSubjectIndex(drum, clamped)
  }

  const totalSubjects = dataset?.subjects.length ?? 0

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#6f2a0d_0%,rgba(111,42,13,0.15)_28%,transparent_48%),radial-gradient(circle_at_top_right,rgba(22,163,171,0.28),transparent_36%),linear-gradient(180deg,#120d0b_0%,#140f18_52%,#090a0d_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/75 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Cabin Audio
          </Link>

          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.26em] text-white/55">
            Spatial Audio Lab
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as PageTab)}
          className="flex flex-1 flex-col py-8"
        >
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">Mode</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                {activeTab === "explorer" ? "HRTF drum kit" : "Virtual stereo player"}
              </h1>
              <p className="mt-2 text-sm text-white/60">
                {activeTab === "explorer"
                  ? "Three drums sit on a vertical line in front of you. Pick a different HRTF subject for each drum while the kit keeps grooving."
                  : "Play stereo music through a virtual speaker matrix with independent speaker-to-ear EQ."}
              </p>
            </div>

            <TabsList className="h-auto rounded-full border border-white/10 bg-black/25 p-1">
              <TabsTrigger
                value="explorer"
                className="rounded-full px-4 py-2 text-white/70 data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Drum Kit
              </TabsTrigger>
              <TabsTrigger
                value="virtual-stereo"
                className="rounded-full px-4 py-2 text-white/70 data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Virtual Stereo
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="explorer" className="mt-0 space-y-6">
            <div className="rounded-[32px] border border-white/10 bg-white/[0.045] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <p className="text-[11px] uppercase tracking-[0.3em] text-orange-200/60">Kit</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">Three-piece HRTF audition</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
                A kick, snare, and hi-hat play a steady groove, each convolved with its own HRTF pick from the
                CIPIC dataset. The three sources sit on a vertical line directly ahead: hi-hat overhead, snare at
                the midpoint, kick straight in front. Drag any drum&apos;s subject slider while the kit plays to
                hear how that listener&apos;s pinna colors only that drum.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => void handlePlaybackToggle()}
                  disabled={!dataset || isLoading}
                  className="h-12 rounded-full bg-white text-black hover:bg-white/90"
                >
                  {isPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                  {isPlaying ? "Stop kit" : "Start kit"}
                </Button>
                <div className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100">
                  CIPIC · {totalSubjects || "…"} listeners
                </div>
              </div>

              {errorMessage && (
                <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {DRUMS.map((drum) => {
                const index = subjectIndices[drum.key]
                const subjectLabel = dataset?.subjects[index]?.label ?? "—"
                return (
                  <div
                    key={drum.key}
                    className="rounded-[28px] border border-white/10 bg-white/[0.045] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-xl"
                  >
                    <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">
                      {drum.positionLabel}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">{drum.label}</h3>
                    <p className="mt-2 text-sm leading-5 text-white/55">{drum.tagline}</p>

                    <div className="mt-6 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-white">HRTF subject</p>
                        <div className="text-sm text-white/60">
                          {dataset ? `${index + 1} / ${totalSubjects}` : "--"}
                        </div>
                      </div>
                      <Slider
                        aria-label={`${drum.label} HRTF subject`}
                        value={[index]}
                        min={0}
                        max={Math.max(totalSubjects - 1, 0)}
                        step={1}
                        disabled={!dataset || isLoading}
                        onValueChange={(value) => handleSubjectChange(drum.key, value[0] ?? 0)}
                        className="py-3"
                        rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                        thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                      />
                      <p className="text-xs text-white/45">{subjectLabel}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </TabsContent>

          <TabsContent value="virtual-stereo" className="mt-0">
            <VirtualStereoPlayerTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
