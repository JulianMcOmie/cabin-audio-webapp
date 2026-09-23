"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Slider } from "@/components/ui/slider"
import { createSharpHighpassFilters } from "@/lib/audio/sharpHighpass"

const frequencyLabel = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`
const axisPosition = (hz: number) => Math.log(hz / 20) / Math.log(20000 / 20) * 100

interface DemoAudio {
  context: AudioContext
  source: AudioBufferSourceNode
  filters: BiquadFilterNode[]
  lfo: OscillatorNode
  amount: GainNode
  output: GainNode
  phase: number
  phaseTime: number
  rate: number
}

function createDemoAudio(): DemoAudio {
  const context = new AudioContext()
  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filters = createSharpHighpassFilters(context)
  const output = context.createGain()
  output.gain.value = 0
  source.connect(filters[0])
  filters.forEach((filter, index) => filter.connect(filters[index + 1] ?? output))
  output.connect(context.destination)

  // Modulate detune in cents for an even sweep in octaves, on the audio clock.
  const lfo = context.createOscillator()
  lfo.type = "sine"
  lfo.frequency.value = 0.25
  const amount = context.createGain()
  lfo.connect(amount)
  filters.forEach((filter) => amount.connect(filter.detune))
  const now = context.currentTime
  source.start(now)
  lfo.start(now)
  return { context, source, filters, lfo, amount, output, phase: 0, phaseTime: now, rate: 0.25 }
}

function Control({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; onChange: (value: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between gap-4 text-sm">
        <span className="text-white/60">{label}</span>
        <span className="tabular-nums">{display}</span>
      </div>
      <Slider aria-label={label} value={[value]} min={min} max={max} step={step}
        onValueChange={([next]) => { if (next !== undefined) onChange(next) }} />
    </div>
  )
}

export function CutoffDemo() {
  const [minimum, setMinimum] = useState(80)
  const [maximum, setMaximum] = useState(4000)
  const [period, setPeriod] = useState(4)
  const [volume, setVolume] = useState(-24)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cutoff, setCutoff] = useState(Math.sqrt(80 * 4000))
  const audio = useRef<DemoAudio | null>(null)
  const disposed = useRef(false)

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      const engine = audio.current
      audio.current = null
      if (engine) {
        engine.source.stop()
        engine.lfo.stop()
        void engine.context.close()
      }
    }
  }, [])

  useEffect(() => {
    const engine = audio.current
    if (!engine) return
    const now = engine.context.currentTime
    engine.phase = (engine.phase + (now - engine.phaseTime) * engine.rate * 2 * Math.PI) % (2 * Math.PI)
    engine.phaseTime = now
    engine.rate = 1 / period
    engine.lfo.frequency.setValueAtTime(engine.rate, now)
    engine.amount.gain.setValueAtTime(600 * Math.log2(maximum / minimum), now)
    engine.filters.forEach((filter) => filter.frequency.setValueAtTime(Math.sqrt(minimum * maximum), now))
    engine.output.gain.setTargetAtTime(playing ? Math.pow(10, volume / 20) : 0, now, 0.02)
  }, [minimum, maximum, period, volume, playing])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const animate = () => {
      const engine = audio.current
      if (!engine) return
      const phase = engine.phase + (engine.context.currentTime - engine.phaseTime) * engine.rate * 2 * Math.PI
      setCutoff(Math.sqrt(minimum * maximum) * Math.pow(maximum / minimum, Math.sin(phase) / 2))
      frame = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(frame)
  }, [playing, minimum, maximum, period])

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const engine = audio.current ?? createDemoAudio()
      audio.current = engine
      if (playing) {
        engine.output.gain.setTargetAtTime(0, engine.context.currentTime, 0.01)
        await new Promise((resolve) => window.setTimeout(resolve, 60))
        if (!disposed.current) await engine.context.suspend()
      } else {
        await engine.context.resume()
      }
      if (!disposed.current) setPlaying(!playing)
    } catch {
      if (!disposed.current) setError("Audio couldn't start. Please try Play again.")
    } finally {
      if (!disposed.current) setBusy(false)
    }
  }

  const displayedCutoff = playing ? cutoff : Math.sqrt(minimum * maximum)
  return (
    <main className="min-h-screen bg-[#101214] px-6 py-10 text-white">
      <div className="mx-auto max-w-2xl space-y-10">
        <Link href="/" className="text-sm text-white/50 hover:text-white">← Back to canvas</Link>
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Audio demo</p>
          <h1 className="text-3xl font-medium">A moving lower edge</h1>
          <p className="max-w-lg text-sm leading-relaxed text-white/55">Continuous noise with a lower cutoff that sweeps up and down. There is no upper cutoff; the sound gets thinner as the lower edge rises.</p>
        </header>
        <section className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-white/45">{playing ? "Lower cutoff" : "Ready to play"}</p>
              <p className="mt-1 text-3xl tabular-nums">{frequencyLabel(displayedCutoff)}</p>
            </div>
            <button type="button" onClick={toggle} disabled={busy} aria-pressed={playing}
              className="rounded-full bg-cyan-300 px-7 py-3 text-sm font-semibold text-black hover:bg-cyan-200 disabled:opacity-50">
              {busy ? "…" : playing ? "Pause" : "Play"}
            </button>
          </div>
          <div className="relative h-28 overflow-hidden rounded-lg bg-black/30" role="img" aria-label="Band of frequencies above the moving lower cutoff">
            <div className="absolute inset-y-0 border-l-2 border-cyan-200 bg-gradient-to-r from-cyan-300/30 to-cyan-300/5"
              style={{ left: `${axisPosition(displayedCutoff)}%`, right: "0%" }} />
            {[100, 1000, 10000].map((hz) => <div key={hz} className="absolute inset-y-0 border-l border-white/10" style={{ left: `${axisPosition(hz)}%` }} />)}
          </div>
          <div className="flex justify-between text-xs text-white/40"><span>20 Hz</span><span>Logarithmic frequency</span><span>20 kHz</span></div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </section>
        <section className="grid gap-7 rounded-2xl border border-white/10 p-6 sm:grid-cols-2">
          <Control label="Lowest cutoff" value={Math.log2(minimum)} display={frequencyLabel(minimum)} min={Math.log2(30)} max={Math.log2(maximum) - 0.1} step={0.05} onChange={(v) => setMinimum(Math.min(maximum / 2 ** 0.1, 2 ** v))} />
          <Control label="Highest cutoff" value={Math.log2(maximum)} display={frequencyLabel(maximum)} min={Math.log2(minimum) + 0.1} max={Math.log2(14000)} step={0.05} onChange={(v) => setMaximum(Math.min(14000, Math.max(minimum * 2 ** 0.1, 2 ** v)))} />
          <Control label="Cycle duration" value={period} display={`${period.toFixed(1)} s`} min={0.5} max={20} step={0.1} onChange={setPeriod} />
          <Control label="Volume" value={volume} display={`${volume} dB`} min={-48} max={-6} step={1} onChange={setVolume} />
        </section>
      </div>
    </main>
  )
}
