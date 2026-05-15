"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Position = "left" | "center" | "right"
type SequenceId = "lcr" | "lcrc" | "lclcrcrc"

interface SequenceOption {
  id: SequenceId
  label: string
  positions: Position[]
}

const SEQUENCES: SequenceOption[] = [
  {
    id: "lcr",
    label: "Left -> Center -> Right",
    positions: ["left", "center", "right"],
  },
  {
    id: "lcrc",
    label: "Left -> Center -> Right -> Center",
    positions: ["left", "center", "right", "center"],
  },
  {
    id: "lclcrcrc",
    label: "Left -> Center -> Left -> Center -> Right -> Center -> Right -> Center",
    positions: ["left", "center", "left", "center", "right", "center", "right", "center"],
  },
]

const POSITION_LABELS: Record<Position, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
}

const POSITION_X: Record<Position, string> = {
  left: "16%",
  center: "50%",
  right: "84%",
}

export function VisualizationPage() {
  const [sequenceId, setSequenceId] = useState<SequenceId>("lcr")
  const [speedHz, setSpeedHz] = useState(2)
  const [stepIndex, setStepIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)

  const activeSequence = useMemo(
    () => SEQUENCES.find((sequence) => sequence.id === sequenceId) ?? SEQUENCES[0],
    [sequenceId]
  )
  const currentPosition = activeSequence.positions[stepIndex % activeSequence.positions.length]
  const intervalMs = Math.max(25, 1000 / speedHz)

  useEffect(() => {
    setStepIndex(0)
  }, [sequenceId])

  useEffect(() => {
    if (!isPlaying) return

    const intervalId = window.setInterval(() => {
      setStepIndex((previous) => (previous + 1) % activeSequence.positions.length)
    }, intervalMs)

    return () => window.clearInterval(intervalId)
  }, [activeSequence.positions.length, intervalMs, isPlaying])

  return (
    <main className="min-h-screen bg-[#08090d] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
            <Link href="/">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">Visualization</div>
        </div>

        <section className="grid flex-1 grid-rows-[auto_1fr_auto] gap-6 py-6">
          <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.045] p-4 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-white/50">Sequence</label>
              <Select value={sequenceId} onValueChange={(value) => setSequenceId(value as SequenceId)}>
                <SelectTrigger className="border-white/15 bg-black/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEQUENCES.map((sequence) => (
                    <SelectItem key={sequence.id} value={sequence.id}>
                      {sequence.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-wider text-white/50">Speed</label>
                <span className="text-xs font-medium tabular-nums text-white/70">{speedHz.toFixed(1)} Hz</span>
              </div>
              <Slider
                value={[speedHz]}
                min={0.5}
                max={40}
                step={0.5}
                onValueChange={(value) => setSpeedHz(value[0])}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => setIsPlaying((value) => !value)}
            >
              {isPlaying ? <Pause /> : <Play />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
          </div>

          <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-white/10 bg-[#10131a]">
            <div className="absolute inset-x-[16%] top-1/2 h-px bg-white/12" />
            {(["left", "center", "right"] as Position[]).map((position) => (
              <div
                key={position}
                className="absolute top-1/2 h-12 w-px -translate-y-1/2 bg-white/10"
                style={{ left: POSITION_X[position] }}
              />
            ))}

            <div
              className="absolute top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/60 bg-cyan-300 shadow-[0_0_38px_rgba(103,232,249,0.45)]"
              style={{ left: POSITION_X[currentPosition] }}
            />

            <div className="absolute inset-x-0 bottom-8 grid grid-cols-3 px-[11%] text-center text-xs uppercase tracking-wider text-white/45">
              <span>Left</span>
              <span>Center</span>
              <span>Right</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {activeSequence.positions.map((position, index) => {
              const isCurrent = index === stepIndex % activeSequence.positions.length
              return (
                <div
                  key={`${position}-${index}`}
                  className={`min-w-16 rounded-md border px-3 py-2 text-center text-xs font-medium transition-colors ${
                    isCurrent
                      ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-100"
                      : "border-white/10 bg-white/[0.035] text-white/45"
                  }`}
                >
                  {POSITION_LABELS[position]}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
