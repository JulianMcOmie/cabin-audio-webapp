"use client"

import { useEffect, useRef } from "react"
import { useDarkMode } from "@/lib/hooks/useDarkMode"
import { getEQProcessor } from "@/lib/audio/eqProcessor"
import { getAudioContext } from "@/lib/audio/audioContext"

const BAR_COUNT = 64

export function SimpleFFT() {
  const isDarkMode = useDarkMode()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const bufferRef = useRef<Float32Array | null>(null)
  const rafRef = useRef(0)

  // Create and connect a dedicated analyser node
  useEffect(() => {
    let analyser: AnalyserNode | null = null
    let connected = false

    const tryConnect = () => {
      try {
        const ctx = getAudioContext()
        const output = getEQProcessor().getOutputNode()
        analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.15
        output.connect(analyser)
        analyserRef.current = analyser
        bufferRef.current = new Float32Array(analyser.frequencyBinCount)
        connected = true
      } catch {
        // Audio not ready yet — retry
      }
    }

    tryConnect()
    // If audio wasn't ready, poll briefly
    let retryId: ReturnType<typeof setInterval> | null = null
    if (!connected) {
      retryId = setInterval(() => {
        tryConnect()
        if (connected && retryId) clearInterval(retryId)
      }, 200)
    }

    return () => {
      if (retryId) clearInterval(retryId)
      if (analyser && connected) {
        try {
          const output = getEQProcessor().getOutputNode()
          output.disconnect(analyser)
        } catch { /* already disconnected */ }
      }
      analyserRef.current = null
      bufferRef.current = null
    }
  }, [])

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) { rafRef.current = requestAnimationFrame(draw); return }

      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(draw); return }

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const analyser = analyserRef.current
      const buffer = bufferRef.current
      if (!analyser || !buffer) { rafRef.current = requestAnimationFrame(draw); return }

      analyser.getFloatFrequencyData(buffer)

      const binCount = buffer.length
      const barW = w / BAR_COUNT
      const gap = Math.max(1, barW * 0.15)
      const barNetW = barW - gap

      for (let i = 0; i < BAR_COUNT; i++) {
        // Log-spaced bin sampling
        const t = i / (BAR_COUNT - 1)
        const binIdx = Math.min(binCount - 1, Math.round(t * t * (binCount - 1)))

        // Normalize dB to 0–1
        const db = Math.max(-80, buffer[binIdx])
        const mag = Math.max(0, (db + 80) / 70)

        const barH = Math.max(1, mag * h * 0.88)
        const x = i * barW + gap / 2
        const y = h - barH

        // Frequency-based color (bass=blue, mid=cyan, treble=green)
        const ft = i / (BAR_COUNT - 1)
        let bh: number, bs: number, bl: number
        if (isDarkMode) {
          if (ft < 0.5) {
            const u = ft * 2
            bh = 227 + (180 - 227) * u
            bs = 100
            bl = 73 + (50 - 73) * u
          } else {
            const u = (ft - 0.5) * 2
            bh = 180 + (150 - 180) * u
            bs = 100
            bl = 50 + (67 - 50) * u
          }
        } else {
          if (ft < 0.5) {
            const u = ft * 2
            bh = 224 + (180 - 224) * u
            bs = 50 + (100 - 50) * u
            bl = 40 + (23 - 40) * u
          } else {
            const u = (ft - 0.5) * 2
            bh = 180 + (152 - 180) * u
            bs = 100 + (40 - 100) * u
            bl = 23 + (33 - 23) * u
          }
        }

        const grad = ctx.createLinearGradient(x, h, x, y)
        grad.addColorStop(0, `hsla(${bh}, ${bs}%, ${bl}%, 0.9)`)
        grad.addColorStop(0.5, `hsla(${bh}, ${bs}%, ${bl}%, 0.45)`)
        grad.addColorStop(1, `hsla(${bh}, ${bs}%, ${bl}%, 0.08)`)

        ctx.fillStyle = grad
        ctx.beginPath()
        const r = Math.min(3, barNetW / 2)
        ctx.roundRect(x, y, barNetW, barH, [r, r, 0, 0])
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isDarkMode])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: "none" }}
    />
  )
}
