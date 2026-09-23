"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { getAudioRouting } from "@/lib/audio/audioRouting"

const MIN_DB = -100
const MAX_DB = 0
const FREQUENCIES = [20, 100, 1000, 10000, 20000]

export function LiveAudioSpectrum() {
  const [collapsed, setCollapsed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (collapsed) return
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return

    const analyser = getAudioRouting().getAnalyserNode()
    if (!analyser) return
    const data = new Float32Array(analyser.frequencyBinCount)
    let frame = 0
    let width = 0
    let height = 0
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const draw = () => {
      frame = requestAnimationFrame(draw)
      if (document.hidden || width < 80 || height < 40) return
      analyser.getFloatFrequencyData(data)
      context.clearRect(0, 0, width, height)

      const left = 32
      const top = 8
      const right = width - 16
      const bottom = height - 22
      const maxFrequency = Math.min(20000, analyser.context.sampleRate / 2)
      const logRange = Math.log(maxFrequency / 20)
      const xForFrequency = (frequency: number) => left + Math.log(frequency / 20) / logRange * (right - left)
      const yForDb = (db: number) => bottom - (Math.max(MIN_DB, Math.min(MAX_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB) * (bottom - top)

      context.font = "10px system-ui, sans-serif"
      context.lineWidth = 1
      context.strokeStyle = "rgba(148, 163, 184, 0.15)"
      context.fillStyle = "#94a3b8"
      context.textAlign = "right"
      for (const db of [0, -40, -80]) {
        const y = yForDb(db)
        context.beginPath()
        context.moveTo(left, y)
        context.lineTo(right, y)
        context.stroke()
        context.fillText(String(db), left - 6, y + 3)
      }
      context.textAlign = "center"
      for (const frequency of FREQUENCIES) {
        if (frequency > maxFrequency) continue
        const x = xForFrequency(frequency)
        context.beginPath()
        context.moveTo(x, top)
        context.lineTo(x, bottom)
        context.stroke()
        context.fillText(frequency >= 1000 ? `${frequency / 1000}k` : String(frequency), x, height - 5)
      }

      // Peak-bin aggregation keeps narrow bands visible on a logarithmic axis.
      // Keep the dB scale fixed so changes in depth and volume remain visible.
      const binHz = analyser.context.sampleRate / analyser.fftSize
      const columns = Math.max(1, Math.floor(right - left))
      context.beginPath()
      context.moveTo(left, bottom)
      for (let column = 0; column <= columns; column++) {
        const low = 20 * Math.exp(column / columns * logRange)
        const high = 20 * Math.exp(Math.min(1, (column + 1) / columns) * logRange)
        const first = Math.max(1, Math.min(data.length - 1, Math.floor(low / binHz)))
        const last = Math.min(data.length - 1, Math.max(first, Math.ceil(high / binHz) - 1))
        let db = MIN_DB
        for (let bin = first; bin <= last; bin++) db = Math.max(db, data[bin])
        context.lineTo(left + column, yForDb(db))
      }
      context.lineTo(right, bottom)
      context.closePath()
      const fill = context.createLinearGradient(0, top, 0, bottom)
      fill.addColorStop(0, "rgba(34, 211, 238, 0.45)")
      fill.addColorStop(1, "rgba(34, 211, 238, 0.03)")
      context.fillStyle = fill
      context.fill()
      context.strokeStyle = "#67e8f9"
      context.lineWidth = 1.5
      context.stroke()
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [collapsed])

  return (
    <section aria-label="Live audio spectrum" className="w-full min-w-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950/90 text-slate-200 shadow-lg backdrop-blur-md">
      <button type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed} aria-controls="live-audio-spectrum-plot" className="flex w-full items-center justify-between gap-4 px-3 py-2 text-xs">
        <span>Live spectrum <span className="ml-2 text-[10px] text-slate-400">Post-EQ · Hz / dB</span></span>
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {!collapsed && <canvas id="live-audio-spectrum-plot" ref={canvasRef} role="img" aria-label="Live audio levels by frequency, from 20 Hz to 20 kHz" className="block h-36 w-full" />}
    </section>
  )
}
