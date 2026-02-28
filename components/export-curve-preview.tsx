"use client"

import { useRef, useEffect, useCallback } from "react"
import type { EQBand } from "@/lib/models/EQBand"
import type { EQBandWithUI } from "@/components/parametric-eq/types"
import { calculateCombinedFrequencyResponse } from "@/components/parametric-eq/useEQProcessor"
import { EQCoordinateUtils } from "@/components/parametric-eq/EQCoordinateUtils"
import type { FrequencyResponse } from "@/components/parametric-eq/types"

const FREQ_RANGE = { min: 20, max: 20000 }
const ANIM_DURATION = 500 // ms

interface ExportCurvePreviewProps {
  bands: EQBand[]
  className?: string
}

/** Lerp between two magnitude arrays (must be same length). */
function lerpResponses(
  from: FrequencyResponse[],
  to: FrequencyResponse[],
  t: number
): FrequencyResponse[] {
  const len = Math.min(from.length, to.length)
  const out: FrequencyResponse[] = new Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = {
      frequency: to[i].frequency,
      magnitude: from[i].magnitude + (to[i].magnitude - from[i].magnitude) * t,
    }
  }
  return out
}

export function ExportCurvePreview({ bands, className }: ExportCurvePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Animation state refs (no re-renders needed)
  const prevResponseRef = useRef<FrequencyResponse[] | null>(null)
  const targetResponseRef = useRef<FrequencyResponse[] | null>(null)
  const animStartRef = useRef<number>(0)
  const rafRef = useRef<number>(0)

  const paintFrame = useCallback((response: FrequencyResponse[]) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // -- 0 dB center line --
    const centerY = h / 2
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(w, centerY)
    ctx.strokeStyle = "rgba(255,255,255,0.08)"
    ctx.lineWidth = 1
    ctx.stroke()

    if (response.length === 0) return

    // Build points
    const points: { x: number; y: number }[] = []
    for (const pt of response) {
      if (pt.frequency >= FREQ_RANGE.min && pt.frequency <= FREQ_RANGE.max) {
        const x = EQCoordinateUtils.freqToX(pt.frequency, w, FREQ_RANGE)
        const y = EQCoordinateUtils.gainToY(pt.magnitude, h)
        if (points.length === 0 || Math.abs(x - points[points.length - 1].x) >= 1) {
          points.push({ x, y })
        }
      }
    }
    if (points.length < 2) return

    const traceCurve = () => {
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]
        const cur = points[i]
        const cpX = (prev.x + cur.x) / 2
        const cpY = (prev.y + cur.y) / 2
        ctx.quadraticCurveTo(prev.x, prev.y, cpX, cpY)
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
    }

    // Gradient constants
    const logMin = Math.log10(FREQ_RANGE.min)
    const logMax = Math.log10(FREQ_RANGE.max)
    const logRange = logMax - logMin
    const stops = 20

    // -- Gradient fill --
    ctx.beginPath()
    ctx.moveTo(points[0].x, centerY)
    ctx.lineTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      const cpX = (prev.x + cur.x) / 2
      const cpY = (prev.y + cur.y) / 2
      ctx.quadraticCurveTo(prev.x, prev.y, cpX, cpY)
    }
    ctx.lineTo(points[points.length - 1].x, centerY)
    ctx.closePath()

    const fillGrad = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops
      const freq = Math.pow(10, logMin + pos * logRange)
      fillGrad.addColorStop(pos, EQCoordinateUtils.getBandColor(freq, 0.12, true))
    }
    ctx.fillStyle = fillGrad
    ctx.fill()

    // -- Bold gradient stroke --
    ctx.beginPath()
    traceCurve()
    const strokeGrad = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops
      const freq = Math.pow(10, logMin + pos * logRange)
      strokeGrad.addColorStop(pos, EQCoordinateUtils.getBandColor(freq, 1, true))
    }
    ctx.strokeStyle = strokeGrad
    ctx.lineWidth = 3
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.stroke()
  }, [])

  // Kick off animation whenever bands change
  useEffect(() => {
    // Compute target response
    const bandsWithUI: EQBandWithUI[] = bands.map((b) => ({
      ...b,
      type: b.type ?? "peaking",
      isHovered: false,
    }))
    const target = calculateCombinedFrequencyResponse(bandsWithUI)

    // If no previous response, paint immediately (first mount)
    if (!prevResponseRef.current) {
      prevResponseRef.current = target
      targetResponseRef.current = target
      paintFrame(target)
      return
    }

    // Start animation from current displayed state
    const from = targetResponseRef.current ?? prevResponseRef.current
    prevResponseRef.current = from
    targetResponseRef.current = target
    animStartRef.current = performance.now()

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const tick = (now: number) => {
      const elapsed = now - animStartRef.current
      const t = Math.min(elapsed / ANIM_DURATION, 1)
      // Sinusoidal ease-in-out — very gentle
      const eased = (1 - Math.cos(Math.PI * t)) / 2

      const interpolated = lerpResponses(
        prevResponseRef.current!,
        targetResponseRef.current!,
        eased
      )
      paintFrame(interpolated)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        // Animation done — settle on target
        prevResponseRef.current = targetResponseRef.current
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [bands, paintFrame])

  // Repaint on resize (no animation, just redraw current target)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      if (targetResponseRef.current) paintFrame(targetResponseRef.current)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [paintFrame])

  return (
    <div ref={containerRef} className={className} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </div>
  )
}
