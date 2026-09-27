"use client"

import Link from "next/link"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { Edges, OrbitControls } from "@react-three/drei"
import { ArrowLeft, Pause, Play, Shuffle } from "lucide-react"
import { POINTS_PER_SECOND } from "@/lib/playback/point-timing"
import { POINT_COUNT, STAGES, randomUndo, scrambledPoint, type Position3D, type UndoAmounts } from "@/lib/playback/scramble"

type Trial = { seed: number; undo: UndoAmounts[] }
type Frame = { step: number; points: Position3D[]; undo: UndoAmounts[]; single: boolean }
const HOLD_MS = 1000 / POINTS_PER_SECOND
const INITIAL_TRIAL: Trial = { seed: 3241, undo: randomUndo(3241) }
const CONTROL_NAMES = ["Untwist", "Unwarp", "Unscatter"]

function snapshot(trial: Trial, step: number, single: boolean): Frame {
  const index = (single ? Math.floor(step / STAGES.length) : step) % POINT_COUNT
  return { step, single, undo: trial.undo.map(values => [...values] as UndoAmounts),
    points: STAGES.map((_, stage) => scrambledPoint(stage, index, trial.seed, trial.undo[stage])) }
}

function Stage({ point, color, label }: { point: Position3D | null; color: string; label: string }) {
  return <div className="relative h-[290px] overflow-hidden rounded-xl bg-[#0b1218] sm:h-[320px]" role="img" aria-label={label}>
    <Canvas camera={{ position: [5.6, 3.8, 6.5], fov: 46 }} dpr={[1, 1.5]} frameloop="demand">
      <color attach="background" args={["#0b1218"]} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[3, 6, 4]} intensity={2} />
      <gridHelper args={[6, 12, "#344651", "#1a2932"]} position={[0, -2.35, 0]} />
      <mesh>
        <boxGeometry args={[4.7, 4.7, 4.7]} />
        <meshBasicMaterial visible={false} />
        <Edges color="#263740" />
      </mesh>
      {point && <mesh position={point}>
        <sphereGeometry args={[0.11, 24, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.4} />
      </mesh>}
      <OrbitControls makeDefault enablePan={false} minDistance={6} maxDistance={16}
        minPolarAngle={0.2} maxPolarAngle={Math.PI * 0.8} enableDamping={false} />
    </Canvas>
    <div className="pointer-events-none absolute bottom-3 left-3 text-[10px] tracking-wide text-[#677e8a]">DRAG TO ORBIT · SCROLL TO ZOOM</div>
  </div>
}

export function ScrambleDemo() {
  const [trial, setTrial] = useState<Trial>(INITIAL_TRIAL)
  const [playing, setPlaying] = useState(true)
  const [single, setSingle] = useState(false)
  const [frame, setFrame] = useState(() => snapshot(INITIAL_TRIAL, 0, false))
  const settings = useRef({ trial, single })
  const elapsed = useRef(0)
  const startedAt = useRef<number | null>(null)
  const lastStep = useRef(0)
  useLayoutEffect(() => { settings.current = { trial, single } }, [trial, single])

  const publish = useCallback((step: number) => {
    lastStep.current = step
    const current = settings.current
    setFrame(snapshot(current.trial, step, current.single))
  }, [])

  const newTrial = useCallback(() => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    const next = { seed, undo: randomUndo(seed) }
    settings.current = { ...settings.current, trial: next }
    setTrial(next)
    elapsed.current = 0
    if (startedAt.current !== null) startedAt.current = performance.now()
    publish(0)
  }, [publish])

  useEffect(() => { newTrial() }, [newTrial])

  useEffect(() => {
    if (!playing) return
    startedAt.current = performance.now()
    let request = 0
    const tick = (now: number) => {
      const step = Math.floor((elapsed.current + now - startedAt.current!) / HOLD_MS)
      // Absolute clock boundaries avoid accumulating setInterval drift. Only
      // one snapshot is published after a late frame; no burst of missed dots.
      if (step !== lastStep.current) publish(step)
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(request)
      if (startedAt.current !== null) elapsed.current += performance.now() - startedAt.current
      startedAt.current = null
    }
  }, [playing, publish])

  const changeUndo = (stage: number, axis: number, value: number) => {
    setTrial(current => ({ ...current, undo: current.undo.map((amounts, index) => index === stage
      ? amounts.map((amount, control) => control === axis ? value : amount) as UndoAmounts : amounts) }))
  }

  const restoreAll = () => setTrial(current => ({ ...current, undo: STAGES.map(() => [100, 100, 100]) }))
  const pointIndex = (frame.single ? Math.floor(frame.step / STAGES.length) : frame.step) % POINT_COUNT
  return <main className="min-h-dvh bg-[#080d11] px-4 py-7 text-[#e3eae8] sm:px-8 sm:py-10">
    <div className="mx-auto max-w-6xl">
      <header className="mb-7">
        <Link href="/" className="mb-7 inline-flex items-center gap-2 text-xs text-[#82968e] hover:text-white"><ArrowLeft size={14} /> Cabin Audio</Link>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[#9fc2b1]">A sequential perception experiment</p>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Unscramble the stage.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#8b9c9d]">Four hidden shapes. One point at a time. Undo the distortion and follow the shape as it emerges through time.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPlaying(value => !value)} className="inline-flex items-center gap-2 rounded-lg bg-[#c1e5cc] px-5 py-3 text-sm font-medium text-[#14251d] hover:bg-[#d1efda]">
              {playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "Pause" : "Play"}
            </button>
            <button onClick={newTrial} className="inline-flex items-center gap-2 rounded-lg border border-[#2a393c] px-4 py-3 text-sm hover:bg-[#162126]"><Shuffle size={15} /> New scramble</button>
          </div>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#233137] bg-[#10191e] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-mono text-[#c1e5cc]">{POINTS_PER_SECOND} points / sec</span>
          <span className="text-[#91a3a8]">{HOLD_MS} ms hold · instant switch · no fading</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#b6c5c6]">
          <input type="checkbox" checked={single} onChange={event => setSingle(event.target.checked)} className="h-4 w-4 accent-[#c1e5cc]" />
          One dot across all stages
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {STAGES.map((stage, index) => {
          const visible = !frame.single || frame.step % STAGES.length === index
          const pending = trial.undo[index].some((value, axis) => value !== frame.undo[index][axis])
          return <section key={stage.name} aria-label={`${stage.name} stage`} className="min-w-0 rounded-2xl border border-[#243139] bg-[#10181e] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-3"><span className="font-mono text-[10px] text-[#5e737e]">0{index + 1}</span><h2 className="text-sm font-medium" style={{ color: stage.color }}>{stage.name}</h2><span className="hidden text-xs text-[#748994] sm:inline">{stage.description}</span></div>
              <span className="font-mono text-[10px] text-[#95a9b2]">{visible ? `${String(pointIndex + 1).padStart(2, "0")} / ${POINT_COUNT}` : "WAITING"}</span>
            </div>
            <Stage point={visible ? frame.points[index] : null} color={stage.color}
              label={`${stage.name}: ${visible ? `point ${pointIndex + 1} of ${POINT_COUNT}` : "waiting for its turn"}. Drag to rotate the 3D view.`} />
            <div className="space-y-4 px-1 pb-1 pt-5">
              {CONTROL_NAMES.map((name, axis) => <div key={name} className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3">
                <label htmlFor={`undo-${index}-${axis}`} className="text-xs text-[#b0c0c5]">{name}</label>
                <input id={`undo-${index}-${axis}`} type="range" min={0} max={100} step={1} value={trial.undo[index][axis]}
                  aria-label={`${stage.name}: ${name}`} aria-valuetext={`${trial.undo[index][axis]} percent restored`}
                  onChange={event => changeUndo(index, axis, Number(event.target.value))}
                  className="h-5 w-full cursor-pointer" style={{ accentColor: stage.color }} />
                <output htmlFor={`undo-${index}-${axis}`} className="text-right font-mono text-[11px] text-[#93a7b1]">{trial.undo[index][axis]}%</output>
              </div>)}
              <div className="flex items-center justify-between text-[10px] text-[#6e858f]"><span>0% scrambled → 100% restored</span><span>{pending ? playing ? "Applies at next switch" : "Queued until playback resumes" : "Holding selected restoration"}</span></div>
            </div>
          </section>
        })}
      </div>

      <footer className="mt-6 flex flex-wrap items-start justify-between gap-4 text-xs leading-6 text-[#7f969e]">
        <p className="max-w-2xl">Each trial randomizes the distortion and starting slider amounts. Sliders change the next point, never the held point. This silent demo follows glyph playback’s hold-and-switch timing; no trails or complete shapes are shown.</p>
        <Link href="/drag-grid" className="text-[#bacfc5] underline underline-offset-4">Try the draggable audio grid →</Link>
        <button onClick={restoreAll} className="rounded-lg border border-[#2a393c] px-4 py-2 text-[#bacfc5] hover:bg-[#162126]">Restore all to 100%</button>
      </footer>
    </div>
  </main>
}
