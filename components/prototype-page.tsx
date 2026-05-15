"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play, Power, RotateCcw, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  PrototypeCalibrationPlayer,
  type PrototypeEqCandidate,
  type PrototypePlayerSettings,
  type PrototypePositionId,
  type PrototypeTask,
} from "@/lib/audio/prototypeCalibrationPlayer"

const STORAGE_KEY = "cabin:prototype:v1"

const BASE_FREQUENCIES = [125, 180, 250, 355, 500, 710, 1000, 1400, 2000, 2800, 4000, 5600, 8000]
const GAIN_ROWS = [-9, -6, -3, 3, 6]
const POSITION_GRID: PrototypePositionId[][] = [
  ["FL", "FC", "FR"],
  ["BL", "BC", "BR"],
]

type TaskGoal = "separate" | "same-place" | "line" | "equal-step"

interface TaskOption {
  id: string
  label: string
  shortLabel: string
  goal: TaskGoal
  task: PrototypeTask
}

interface StoredState {
  activeTaskId: string
  baseFrequency: number
  gainDb: number
  q: number
  offsetCents: number
  eqEnabled: boolean
  intervalMs: number
  restMs: number
  volumeDb: number
}

const TASKS: TaskOption[] = [
  {
    id: "depth-left",
    label: "Left Depth",
    shortLabel: "FL BL",
    goal: "same-place",
    task: { kind: "pair", pair: ["FL", "BL"], correctedIndex: 1 },
  },
  {
    id: "depth-center",
    label: "Center Depth",
    shortLabel: "FC BC",
    goal: "same-place",
    task: { kind: "pair", pair: ["FC", "BC"], correctedIndex: 1 },
  },
  {
    id: "depth-right",
    label: "Right Depth",
    shortLabel: "FR BR",
    goal: "same-place",
    task: { kind: "pair", pair: ["FR", "BR"], correctedIndex: 1 },
  },
  {
    id: "front-left",
    label: "Front Left Step",
    shortLabel: "FL FC",
    goal: "separate",
    task: { kind: "pair", pair: ["FL", "FC"], correctedIndex: 1 },
  },
  {
    id: "front-right",
    label: "Front Right Step",
    shortLabel: "FC FR",
    goal: "separate",
    task: { kind: "pair", pair: ["FC", "FR"], correctedIndex: 1 },
  },
  {
    id: "back-left",
    label: "Back Left Step",
    shortLabel: "BL BC",
    goal: "separate",
    task: { kind: "pair", pair: ["BL", "BC"], correctedIndex: 1 },
  },
  {
    id: "back-right",
    label: "Back Right Step",
    shortLabel: "BC BR",
    goal: "separate",
    task: { kind: "pair", pair: ["BC", "BR"], correctedIndex: 1 },
  },
  {
    id: "front-even",
    label: "Front Row Even",
    shortLabel: "FL-FC / FC-FR",
    goal: "equal-step",
    task: { kind: "edge", edges: [["FL", "FC"], ["FC", "FR"]], correctedEdgeIndex: 1 },
  },
  {
    id: "back-even",
    label: "Back Row Even",
    shortLabel: "BL-BC / BC-BR",
    goal: "equal-step",
    task: { kind: "edge", edges: [["BL", "BC"], ["BC", "BR"]], correctedEdgeIndex: 1 },
  },
  {
    id: "left-column",
    label: "Left Column",
    shortLabel: "FL BL",
    goal: "line",
    task: { kind: "pair", pair: ["FL", "BL"], correctedIndex: 1 },
  },
  {
    id: "center-column",
    label: "Center Column",
    shortLabel: "FC BC",
    goal: "line",
    task: { kind: "pair", pair: ["FC", "BC"], correctedIndex: 1 },
  },
  {
    id: "right-column",
    label: "Right Column",
    shortLabel: "FR BR",
    goal: "line",
    task: { kind: "pair", pair: ["FR", "BR"], correctedIndex: 1 },
  },
]

const DEFAULT_STATE: StoredState = {
  activeTaskId: "depth-center",
  baseFrequency: 1000,
  gainDb: -6,
  q: 2,
  offsetCents: 0,
  eqEnabled: true,
  intervalMs: 520,
  restMs: 820,
  volumeDb: -12,
}

const GOAL_COPY: Record<TaskGoal, string> = {
  separate: "Select the cell that separates the two positions most cleanly.",
  "same-place": "Select the cell that keeps the two positions in the same place except depth.",
  line: "Select the cell that makes the pair form a straight column.",
  "equal-step": "Select the cell that makes the two pair-loops feel like the same step.",
}

function loadState(): StoredState {
  if (typeof window === "undefined") return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STATE
  }
}

function shiftedFrequency(baseFrequency: number, offsetCents: number): number {
  return Math.round(baseFrequency * Math.pow(2, offsetCents / 1200))
}

function formatFreq(frequency: number): string {
  if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency >= 10000 ? 0 : 1)}k`
  return `${Math.round(frequency)}`
}

function taskPositions(task: PrototypeTask): Set<PrototypePositionId> {
  if (task.kind === "pair") return new Set(task.pair)
  return new Set([...task.edges[0], ...task.edges[1]])
}

function correctedPositions(task: PrototypeTask): Set<PrototypePositionId> {
  if (task.kind === "pair") return new Set([task.pair[task.correctedIndex]])
  return new Set(task.edges[task.correctedEdgeIndex])
}

function makePlayerSettings(state: StoredState, task: PrototypeTask): PrototypePlayerSettings {
  return {
    task,
    eq: {
      frequency: shiftedFrequency(state.baseFrequency, state.offsetCents),
      gainDb: state.gainDb,
      q: state.q,
    },
    eqEnabled: state.eqEnabled,
    intervalMs: state.intervalMs,
    restMs: state.restMs,
    volumeDb: state.volumeDb,
  }
}

export function PrototypePage() {
  const playerRef = useRef<PrototypeCalibrationPlayer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [state, setState] = useState<StoredState>(() => loadState())

  const activeTask = useMemo(
    () => TASKS.find((task) => task.id === state.activeTaskId) ?? TASKS[0],
    [state.activeTaskId]
  )
  const currentFrequency = shiftedFrequency(state.baseFrequency, state.offsetCents)
  const eqCandidate = useMemo<PrototypeEqCandidate>(
    () => ({ frequency: currentFrequency, gainDb: state.gainDb, q: state.q }),
    [currentFrequency, state.gainDb, state.q]
  )
  const playerSettings = useMemo(
    () => makePlayerSettings(state, activeTask.task),
    [activeTask.task, state]
  )

  const setPartialState = useCallback((partial: Partial<StoredState>) => {
    setState((previous) => ({ ...previous, ...partial }))
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage failures.
    }
  }, [state])

  useEffect(() => {
    playerRef.current?.setSettings(playerSettings)
  }, [playerSettings])

  useEffect(() => {
    return () => {
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [])

  const togglePlayback = useCallback(async () => {
    if (!playerRef.current) playerRef.current = new PrototypeCalibrationPlayer(playerSettings)

    if (playerRef.current.isPlaying) {
      playerRef.current.stop()
      setIsPlaying(false)
      return
    }

    playerRef.current.setSettings(playerSettings)
    await playerRef.current.start()
    setIsPlaying(true)
  }, [playerSettings])

  const selectCandidate = useCallback((baseFrequency: number, gainDb: number) => {
    setState((previous) => ({
      ...previous,
      baseFrequency,
      gainDb,
      eqEnabled: true,
    }))
  }, [])

  const resetOffset = useCallback(() => setPartialState({ offsetCents: 0 }), [setPartialState])

  return (
    <main className="min-h-screen bg-[#090b0f] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-white/55 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={togglePlayback}
              className="gap-2 border-white/12 bg-white/[0.06] text-white hover:bg-white/[0.12]"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isPlaying ? "Stop" : "Play"}
            </Button>

            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2">
              <Volume2 className="h-4 w-4 text-emerald-300" />
              <Slider
                value={[state.volumeDb]}
                min={-42}
                max={0}
                step={1}
                onValueChange={([value]) => setPartialState({ volumeDb: value })}
                className="w-28"
              />
              <span className="w-11 text-right text-xs tabular-nums text-white/55">{state.volumeDb} dB</span>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <aside className="flex min-h-0 flex-col gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-white/45">Pairs</span>
                <span className="text-xs tabular-nums text-white/35">6 pos</span>
              </div>
              <PositionMap task={activeTask.task} />
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
              <div className="border-b border-white/10 px-3 py-2 text-xs font-medium uppercase text-white/45">
                Sequence
              </div>
              <div className="max-h-[48vh] overflow-y-auto p-2">
                {TASKS.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setPartialState({ activeTaskId: task.id })}
                    className={[
                      "mb-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition",
                      task.id === activeTask.id
                        ? "bg-cyan-300 text-black"
                        : "bg-transparent text-white/68 hover:bg-white/[0.07] hover:text-white",
                    ].join(" ")}
                  >
                    <span>{task.label}</span>
                    <span className={task.id === activeTask.id ? "text-black/60" : "text-white/35"}>
                      {task.shortLabel}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="flex min-w-0 flex-col gap-4">
            <div className="rounded-lg border border-white/10 bg-[#10151d] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">{activeTask.label}</h1>
                  <p className="mt-1 text-sm text-white/58">{GOAL_COPY[activeTask.goal]}</p>
                </div>
                <div className="flex items-center gap-3 rounded-md border border-white/10 bg-black/25 px-3 py-2">
                  <Power className={state.eqEnabled ? "h-4 w-4 text-lime-300" : "h-4 w-4 text-white/35"} />
                  <span className="text-xs text-white/55">EQ</span>
                  <Switch
                    checked={state.eqEnabled}
                    onCheckedChange={(checked) => setPartialState({ eqEnabled: checked })}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Metric label="Frequency" value={`${formatFreq(eqCandidate.frequency)} Hz`} />
                <Metric label="Gain" value={`${eqCandidate.gainDb > 0 ? "+" : ""}${eqCandidate.gainDb} dB`} />
                <Metric label="Q" value={eqCandidate.q.toFixed(1)} />
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#10151d] p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase text-white/45">Candidate Grid</div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetOffset}
                    className="h-8 gap-2 border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.1]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Offset
                  </Button>
                  <span className="w-14 text-right text-xs tabular-nums text-white/45">
                    {state.offsetCents > 0 ? "+" : ""}
                    {state.offsetCents} c
                  </span>
                </div>
              </div>

              <div className="mb-4 px-1">
                <Slider
                  value={[state.offsetCents]}
                  min={-600}
                  max={600}
                  step={10}
                  onValueChange={([value]) => setPartialState({ offsetCents: value })}
                />
              </div>

              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `56px repeat(${BASE_FREQUENCIES.length}, minmax(38px, 1fr))` }}
              >
                <div />
                {BASE_FREQUENCIES.map((frequency) => (
                  <div key={frequency} className="truncate text-center text-[11px] tabular-nums text-white/40">
                    {formatFreq(shiftedFrequency(frequency, state.offsetCents))}
                  </div>
                ))}

                {GAIN_ROWS.map((gainDb) => (
                  <GridRow
                    key={gainDb}
                    gainDb={gainDb}
                    selectedBaseFrequency={state.baseFrequency}
                    selectedGainDb={state.gainDb}
                    onSelect={selectCandidate}
                  />
                ))}
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-4 text-xs font-medium uppercase text-white/45">Timing</div>
              <ControlSlider
                label="Gap"
                value={state.intervalMs}
                display={`${state.intervalMs} ms`}
                min={180}
                max={1100}
                step={20}
                onChange={(value) => setPartialState({ intervalMs: value })}
              />
              <ControlSlider
                label="Reset"
                value={state.restMs}
                display={`${state.restMs} ms`}
                min={240}
                max={1800}
                step={20}
                onChange={(value) => setPartialState({ restMs: value })}
              />
              <ControlSlider
                label="Q"
                value={state.q}
                display={state.q.toFixed(1)}
                min={0.5}
                max={8}
                step={0.1}
                onChange={(value) => setPartialState({ q: value })}
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-3 text-xs font-medium uppercase text-white/45">Loop</div>
              <LoopPreview task={activeTask.task} />
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}

function GridRow({
  gainDb,
  selectedBaseFrequency,
  selectedGainDb,
  onSelect,
}: {
  gainDb: number
  selectedBaseFrequency: number
  selectedGainDb: number
  onSelect: (baseFrequency: number, gainDb: number) => void
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-[11px] tabular-nums text-white/42">
        {gainDb > 0 ? "+" : ""}
        {gainDb} dB
      </div>
      {BASE_FREQUENCIES.map((frequency) => {
        const selected = frequency === selectedBaseFrequency && gainDb === selectedGainDb
        return (
          <button
            key={`${frequency}-${gainDb}`}
            type="button"
            onClick={() => onSelect(frequency, gainDb)}
            className={[
              "h-10 rounded-md border text-[0px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200",
              selected
                ? "border-cyan-200 bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.25)]"
                : gainDb < 0
                  ? "border-white/8 bg-sky-400/15 hover:bg-sky-300/28"
                  : "border-white/8 bg-amber-300/18 hover:bg-amber-200/30",
            ].join(" ")}
            aria-label={`${formatFreq(frequency)} Hz ${gainDb > 0 ? "+" : ""}${gainDb} dB`}
          />
        )
      })}
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[11px] uppercase text-white/38">{label}</div>
      <div className="mt-1 text-sm tabular-nums text-white/86">{value}</div>
    </div>
  )
}

function ControlSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm text-white/66">{label}</span>
        <span className="text-xs tabular-nums text-white/45">{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} />
    </div>
  )
}

function PositionMap({ task }: { task: PrototypeTask }) {
  const active = taskPositions(task)
  const corrected = correctedPositions(task)

  return (
    <div className="relative rounded-md border border-white/10 bg-black/25 p-3">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 160" aria-hidden="true">
        <path d="M60 45H150H240M60 115H150H240M60 45V115M150 45V115M240 45V115" stroke="rgba(255,255,255,0.13)" strokeWidth="2" />
        {task.kind === "edge" ? (
          <>
            <EdgeLine edge={task.edges[0]} active corrected={task.correctedEdgeIndex === 0} />
            <EdgeLine edge={task.edges[1]} active corrected={task.correctedEdgeIndex === 1} />
          </>
        ) : (
          <EdgeLine edge={task.pair} active corrected={false} />
        )}
      </svg>
      <div className="relative grid gap-6" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {POSITION_GRID.flat().map((positionId) => {
          const isActive = active.has(positionId)
          const isCorrected = corrected.has(positionId)
          return (
            <div key={positionId} className="flex h-14 items-center justify-center">
              <div
                className={[
                  "flex h-11 w-11 items-center justify-center rounded-full border text-xs font-semibold transition",
                  isCorrected
                    ? "border-lime-200 bg-lime-300 text-black"
                    : isActive
                      ? "border-cyan-200 bg-cyan-300 text-black"
                      : "border-white/12 bg-white/[0.05] text-white/42",
                ].join(" ")}
              >
                {positionId}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EdgeLine({
  edge,
  active,
  corrected,
}: {
  edge: [PrototypePositionId, PrototypePositionId]
  active: boolean
  corrected: boolean
}) {
  const points: Record<PrototypePositionId, [number, number]> = {
    FL: [60, 45],
    FC: [150, 45],
    FR: [240, 45],
    BL: [60, 115],
    BC: [150, 115],
    BR: [240, 115],
  }
  const [x1, y1] = points[edge[0]]
  const [x2, y2] = points[edge[1]]
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={corrected ? "rgb(190,242,100)" : "rgb(103,232,249)"}
      strokeWidth={active ? 5 : 2}
      strokeLinecap="round"
      opacity={active ? 0.85 : 0.4}
    />
  )
}

function LoopPreview({ task }: { task: PrototypeTask }) {
  const steps =
    task.kind === "pair"
      ? task.pair
      : [task.edges[0][0], task.edges[0][1], task.edges[0][0], task.edges[0][1], task.edges[1][0], task.edges[1][1], task.edges[1][0], task.edges[1][1]]

  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((step, index) => {
        const corrected =
          task.kind === "pair"
            ? step === task.pair[task.correctedIndex]
            : index >= 4 === (task.correctedEdgeIndex === 1)
        return (
          <span
            key={`${step}-${index}`}
            className={[
              "rounded-md border px-2 py-1 text-xs font-medium",
              corrected ? "border-lime-200/50 bg-lime-300/18 text-lime-100" : "border-cyan-200/35 bg-cyan-300/12 text-cyan-100",
            ].join(" ")}
          >
            {step}
          </span>
        )
      })}
    </div>
  )
}
