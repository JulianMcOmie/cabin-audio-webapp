"use client"

import { useState, useEffect, useRef, useCallback } from "react"

const COLS = 5
const ROWS = 5
const LAYERS = 3
const TOTAL_DOTS = COLS * ROWS * LAYERS

// Dot spacing
const DOT_SPACING = 60
const LAYER_SPACING = 120

// Timing
const FLASH_INTERVAL_MS = 300
const FADE_DURATION_MS = 400

type Dot3D = { x: number; y: number; z: number }

function getDotIndex(x: number, y: number, z: number): number {
  return z * (COLS * ROWS) + y * COLS + x
}

function getDotFromIndex(index: number): Dot3D {
  const z = Math.floor(index / (COLS * ROWS))
  const remainder = index % (COLS * ROWS)
  const y = Math.floor(remainder / COLS)
  const x = remainder % COLS
  return { x, y, z }
}

export default function TestPage() {
  const [activeDotIndex, setActiveDotIndex] = useState<number>(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(FLASH_INTERVAL_MS)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const indexRef = useRef(-1)

  // Flash timestamps: track when each dot was last lit so they can fade out
  const [flashTimes, setFlashTimes] = useState<Map<number, number>>(new Map())
  const animFrameRef = useRef<number | null>(null)
  const [, forceRender] = useState(0)

  // Orbit controls
  const [rotX, setRotX] = useState(0)
  const [rotY, setRotY] = useState(0)
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const sceneRef = useRef<HTMLDivElement>(null)

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const start = useCallback(() => {
    stop()
    indexRef.current = -1
    setActiveDotIndex(-1)
    setFlashTimes(new Map())
    setIsPlaying(true)

    intervalRef.current = setInterval(() => {
      indexRef.current = (indexRef.current + 1) % TOTAL_DOTS
      const now = Date.now()
      setActiveDotIndex(indexRef.current)
      setFlashTimes(prev => {
        const next = new Map(prev)
        next.set(indexRef.current, now)
        return next
      })
    }, speed)
  }, [speed, stop])

  // Animation loop to drive fade-out rendering
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      return
    }
    const tick = () => {
      forceRender(n => n + 1)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  // Restart if speed changes while playing
  useEffect(() => {
    if (isPlaying) {
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed])

  // Mouse drag for orbit
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    setRotY(prev => prev + dx * 0.4)
    setRotX(prev => Math.max(-90, Math.min(90, prev - dy * 0.4)))
  }, [])

  const handlePointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const resetOrientation = useCallback(() => {
    setRotX(0)
    setRotY(0)
  }, [])

  const now = Date.now()

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center pt-12 px-4 select-none">
      <h1 className="text-2xl font-bold mb-2">3D Dot Grid Visualizer</h1>
      <p className="text-zinc-400 mb-6 text-sm text-center max-w-md">
        {COLS}x{ROWS}x{LAYERS} grid — dots flash one at a time then fade out.
        Drag to orbit.
      </p>

      {/* Controls */}
      <div className="flex gap-3 mb-8 items-center flex-wrap justify-center">
        <button
          onClick={isPlaying ? stop : start}
          className={`px-4 py-2 rounded font-medium text-sm ${
            isPlaying
              ? "bg-red-600 hover:bg-red-700"
              : "bg-sky-600 hover:bg-sky-700"
          }`}
        >
          {isPlaying ? "Stop" : "Play"}
        </button>

        <button
          onClick={resetOrientation}
          className="px-3 py-2 rounded font-medium text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Reset view
        </button>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-400">Speed:</span>
          <input
            type="range"
            min={10}
            max={800}
            step={10}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-28"
          />
          <span className="text-zinc-500 w-14 text-right">{speed}ms</span>
        </label>
      </div>

      {/* 3D Scene */}
      <div
        ref={sceneRef}
        className="relative cursor-grab active:cursor-grabbing"
        style={{
          perspective: "900px",
          perspectiveOrigin: "50% 50%",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateX(${rotX}deg) rotateY(${rotY}deg)`,
            width: `${COLS * DOT_SPACING}px`,
            height: `${ROWS * DOT_SPACING}px`,
            position: "relative",
          }}
        >
          {Array.from({ length: LAYERS }, (_, z) => (
            <div
              key={z}
              style={{
                transformStyle: "preserve-3d",
                transform: `translateZ(${((LAYERS - 1) / 2 - z) * LAYER_SPACING}px)`,
                position: "absolute",
                inset: 0,
              }}
            >
              {Array.from({ length: ROWS }, (_, y) =>
                Array.from({ length: COLS }, (_, x) => {
                  const idx = getDotIndex(x, y, z)
                  const isActive = activeDotIndex === idx
                  const flashTime = flashTimes.get(idx)

                  // Calculate fade: 1 at flash moment, 0 after FADE_DURATION_MS
                  let brightness = 0
                  if (flashTime !== undefined) {
                    const elapsed = now - flashTime
                    brightness = Math.max(0, 1 - elapsed / FADE_DURATION_MS)
                  }
                  // Active dot is always full brightness
                  if (isActive) brightness = 1

                  const isVisible = brightness > 0.01
                  const baseOpacity = isVisible ? 0.08 + brightness * 0.92 : 0.08

                  return (
                    <div
                      key={`${x}-${y}-${z}`}
                      className="absolute rounded-full"
                      style={{
                        width: "12px",
                        height: "12px",
                        left: `${x * DOT_SPACING + DOT_SPACING / 2 - 6}px`,
                        top: `${y * DOT_SPACING + DOT_SPACING / 2 - 6}px`,
                        backgroundColor: isVisible
                          ? "rgb(56, 189, 248)"
                          : "rgb(63, 63, 70)",
                        opacity: baseOpacity,
                        boxShadow: brightness > 0.3
                          ? `0 0 ${12 * brightness}px ${4 * brightness}px rgba(56, 189, 248, ${0.5 * brightness})`
                          : "none",
                      }}
                    />
                  )
                })
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="mt-10 text-xs text-zinc-500 text-center space-y-1">
        <p>
          Current dot: {activeDotIndex >= 0 ? (() => {
            const d = getDotFromIndex(activeDotIndex)
            return `(${d.x}, ${d.y}, ${d.z})`
          })() : "—"}{" "}
          | Index: {activeDotIndex >= 0 ? activeDotIndex : "—"} / {TOTAL_DOTS - 1}
        </p>
        <p className="text-zinc-600">
          Rotation: X={rotX.toFixed(0)}° Y={rotY.toFixed(0)}°
        </p>
      </div>
    </div>
  )
}
