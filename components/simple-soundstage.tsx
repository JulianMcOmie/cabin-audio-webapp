"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useDarkMode } from "@/lib/hooks/useDarkMode"
import { usePlayerStore } from "@/lib/stores"
import { SimpleFFT } from "@/components/simple-fft"

// ---------------------------------------------------------------------------
// Color palette matching the Three.js particle scene
// bass=#5577ff → mid=#00ffff → treble=#55ffaa (dark)
// bass=#334499 → mid=#007777 → treble=#337755 (light)
// ---------------------------------------------------------------------------
function getDotColor(
  row: number,
  gridRows: number,
  isDarkMode: boolean
): { hsl: string; glowHsl: string } {
  const t = gridRows > 1 ? row / (gridRows - 1) : 0.5

  let h: number, s: number, l: number
  if (isDarkMode) {
    if (t < 0.5) {
      const u = t * 2
      h = 227 + (180 - 227) * u
      s = 100
      l = 73 + (50 - 73) * u
    } else {
      const u = (t - 0.5) * 2
      h = 180 + (150 - 180) * u
      s = 100
      l = 50 + (67 - 50) * u
    }
  } else {
    if (t < 0.5) {
      const u = t * 2
      h = 224 + (180 - 224) * u
      s = 50 + (100 - 50) * u
      l = 40 + (23 - 40) * u
    } else {
      const u = (t - 0.5) * 2
      h = 180 + (152 - 180) * u
      s = 100 + (40 - 100) * u
      l = 23 + (33 - 23) * u
    }
  }

  return {
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
    glowHsl: `hsla(${h}, ${s}%, ${l}%, ${isDarkMode ? 0.6 : 0.45})`,
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface SimpleSoundstageProps {
  gridRows: number
  gridCols: number
  selectedDots: Set<string>
  onDotSelect: (x: number, y: number) => void
  onDotDeselect: (x: number, y: number) => void
  playingDotKey: string | null
  beatIndex: number
  hoveredDot: string | null
  onHoverDot: (key: string | null) => void
  highlightGrid?: boolean
  onDragStateChange?: (isDragging: boolean) => void
  cursorDotPosition?: { normalizedX: number; normalizedY: number } | null
  onCursorDotMove?: (normalizedX: number, normalizedY: number) => void
  onCursorDotEnd?: () => void
  inviteDotKey?: string | null
  eqHighlights?: Map<string, number> | null
}

const FADE_MS = 500

export function SimpleSoundstage({
  gridRows,
  gridCols,
  selectedDots,
  onDotSelect,
  onDotDeselect,
  playingDotKey,
  hoveredDot,
  onHoverDot,
  highlightGrid,
  onDragStateChange,
  cursorDotPosition,
  onCursorDotMove,
  onCursorDotEnd,
  inviteDotKey,
  eqHighlights,
}: SimpleSoundstageProps) {
  const isDarkMode = useDarkMode()
  const isSongPlaying = usePlayerStore((s) => s.isPlaying)

  // Animated transition: 0 = soundstage visible, 1 = FFT visible
  const [transition, setTransition] = useState(0)
  const transitionRef = useRef(0)
  const rafTransRef = useRef(0)

  useEffect(() => {
    const target = isSongPlaying ? 1 : 0
    let lastTime = performance.now()

    const animate = (now: number) => {
      const dt = now - lastTime
      lastTime = now
      const rate = dt / FADE_MS

      if (target === 1) {
        transitionRef.current = Math.min(1, transitionRef.current + rate)
      } else {
        transitionRef.current = Math.max(0, transitionRef.current - rate)
      }

      setTransition(transitionRef.current)

      if ((target === 1 && transitionRef.current < 1) || (target === 0 && transitionRef.current > 0)) {
        rafTransRef.current = requestAnimationFrame(animate)
      }
    }

    rafTransRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafTransRef.current)
  }, [isSongPlaying])

  // Initial deploy: fade dots in on mount (mirroring particle scene deploy)
  const DEPLOY_MS = 950
  const [deploy, setDeploy] = useState(0)
  const deployRef = useRef(0)

  useEffect(() => {
    let raf = 0
    let lastTime = performance.now()
    const animate = (now: number) => {
      const dt = now - lastTime
      lastTime = now
      deployRef.current = Math.min(1, deployRef.current + dt / DEPLOY_MS)
      setDeploy(deployRef.current)
      if (deployRef.current < 1) {
        raf = requestAnimationFrame(animate)
      }
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- Drag interaction state ----
  const dragMode = useRef<"select" | "deselect" | null>(null)
  const visited = useRef<Set<string>>(new Set())

  const resolveGrid = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const cellW = rect.width / gridCols
      const cellH = rect.height / gridRows
      const col = Math.floor(x / cellW)
      const row = Math.floor(y / cellH)
      if (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
        return { col, row: gridRows - 1 - row }
      }
      return null
    },
    [gridRows, gridCols]
  )

  const applyToHit = useCallback(
    (col: number, row: number) => {
      const key = `${col},${row}`
      if (visited.current.has(key)) return
      visited.current.add(key)
      if (dragMode.current === "select") {
        onDotSelect(col, row)
      } else if (dragMode.current === "deselect") {
        onDotDeselect(col, row)
      }
    },
    [onDotSelect, onDotDeselect]
  )

  const interactionDisabled = transition > 0.05

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (interactionDisabled) return
      const hit = resolveGrid(e)
      if (!hit) return
      const key = `${hit.col},${hit.row}`
      dragMode.current = selectedDots.has(key) ? "deselect" : "select"
      visited.current = new Set()
      applyToHit(hit.col, hit.row)
      onDragStateChange?.(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [resolveGrid, selectedDots, applyToHit, interactionDisabled, onDragStateChange]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Command-key cursor dot mode
      if (e.metaKey && onCursorDotMove) {
        const rect = e.currentTarget.getBoundingClientRect()
        const pad = 32 // 2rem padding
        const innerW = rect.width - pad * 2
        const innerH = rect.height - pad * 2
        const x = e.clientX - rect.left - pad
        const y = e.clientY - rect.top - pad
        const normalizedX = Math.max(0, Math.min(1, x / innerW))
        // Invert Y: top of container = high frequency (normalizedY=1)
        const normalizedY = Math.max(0, Math.min(1, 1 - y / innerH))
        onCursorDotMove(normalizedX, normalizedY)
        return
      }

      const hit = resolveGrid(e)
      if (interactionDisabled) {
        onHoverDot(null)
        return
      }
      onHoverDot(hit ? `${hit.col},${hit.row}` : null)
      if (dragMode.current && hit) {
        applyToHit(hit.col, hit.row)
      }
    },
    [resolveGrid, onHoverDot, applyToHit, interactionDisabled, onCursorDotMove]
  )

  const handlePointerUp = useCallback(() => {
    dragMode.current = null
    visited.current.clear()
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const handlePointerLeave = useCallback(() => {
    dragMode.current = null
    visited.current.clear()
    onHoverDot(null)
    onDragStateChange?.(false)
    onCursorDotEnd?.()
  }, [onHoverDot, onDragStateChange, onCursorDotEnd])

  // ---- Measure container to compute cell-relative dot sizes ----
  const containerRef = useRef<HTMLDivElement>(null)
  const [cellSize, setCellSize] = useState(60)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const pad = 32 * 2 // 2rem padding each side
      const cellW = (el.clientWidth - pad) / gridCols
      const cellH = (el.clientHeight - pad) / gridRows
      setCellSize(Math.min(cellW, cellH))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [gridRows, gridCols])

  // ---- Render ----
  const bg = isDarkMode ? "#0a0a0f" : "#f0f0f5"
  const deploySmooth = deploy * deploy * (3 - 2 * deploy) // smoothstep easing
  const dotOpacity = (1 - transition) * deploySmooth
  const fftOpacity = transition

  // All dots same size — distinction is purely color/glow
  const dotSize = cellSize * 0.63

  // Build grid cells
  const cells: React.ReactNode[] = []
  for (let displayRow = 0; displayRow < gridRows; displayRow++) {
    for (let col = 0; col < gridCols; col++) {
      const row = gridRows - 1 - displayRow
      const key = `${col},${row}`
      const isSelected = selectedDots.has(key)
      const isPlaying = playingDotKey === key
      const isHovered = hoveredDot === key

      const { hsl, glowHsl } = getDotColor(row, gridRows, isDarkMode)
      const isInviteDot = inviteDotKey === key
      const eqIntensity = eqHighlights?.get(key) ?? 0

      let bgColor: string
      let shadow: string

      if (highlightGrid && !isSongPlaying) {
        // Grid highlight: all dots glow in their frequency color
        bgColor = hsl
        shadow = `0 0 16px ${glowHsl}, 0 0 32px ${glowHsl}`
      } else if (isPlaying) {
        bgColor = hsl
        shadow = `0 0 18px ${glowHsl}, 0 0 36px ${glowHsl}`
      } else if (isSelected) {
        bgColor = hsl
        shadow = `0 0 14px ${glowHsl}`
      } else if (eqIntensity > 0.01) {
        // EQ-reactive highlight: blend toward frequency color by intensity
        bgColor = hsl
        const glowSize = Math.round(12 + eqIntensity * 20)
        shadow = `0 0 ${glowSize}px ${glowHsl}`
      } else if (isInviteDot) {
        // First-visit invite dot: glow in frequency color
        bgColor = hsl
        shadow = `0 0 14px ${glowHsl}`
      } else if (isHovered) {
        bgColor = isDarkMode ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.22)"
        shadow = "none"
      } else {
        bgColor = isDarkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"
        shadow = "none"
      }

      const highlightActive = highlightGrid && !isSongPlaying

      let animation: string | undefined
      if (highlightActive) {
        animation = "dot-highlight-breathe 1.2s ease-in-out infinite"
      } else if (isInviteDot && !isSelected) {
        animation = "dot-invite-breathe 2s ease-in-out infinite"
      }

      // EQ highlight opacity boost
      const opacityStyle = eqIntensity > 0.01 ? Math.min(1, 0.3 + eqIntensity * 0.7) : undefined

      cells.push(
        <div
          key={key}
          className="flex items-center justify-center"
          style={{ gridColumn: col + 1, gridRow: displayRow + 1 }}
        >
          <div
            className="rounded-full transition-colors transition-shadow duration-150"
            style={{
              width: dotSize,
              height: dotSize,
              backgroundColor: bgColor,
              boxShadow: shadow,
              animation,
              opacity: opacityStyle,
            }}
          />
        </div>
      )
    }
  }

  return (
    <div className="absolute inset-0" style={{ background: bg }}>
      {/* Dot grid layer */}
      <div
        ref={containerRef}
        className="absolute inset-0 select-none touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        style={{
          cursor: interactionDisabled ? "default" : "pointer",
          opacity: dotOpacity,
          pointerEvents: interactionDisabled ? "none" : undefined,
        }}
      >
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gridTemplateRows: `repeat(${gridRows}, 1fr)`,
            padding: "2rem",
            pointerEvents: "none",
          }}
        >
          {cells}
        </div>
      </div>

      {/* FFT layer — fades in when playing */}
      <div
        className="absolute inset-0"
        style={{ opacity: fftOpacity, pointerEvents: "none" }}
      >
        <SimpleFFT />
      </div>

      {/* Cursor dot overlay — rendered above everything, even during FFT transition */}
      {cursorDotPosition && containerRef.current && (() => {
        const rect = containerRef.current!.getBoundingClientRect()
        const pad = 32
        const innerW = rect.width - pad * 2
        const innerH = rect.height - pad * 2
        // Convert normalized position to pixel position within the padded area
        const pixelX = pad + cursorDotPosition.normalizedX * innerW
        // Invert Y back: normalizedY=1 is top of container
        const pixelY = pad + (1 - cursorDotPosition.normalizedY) * innerH

        // Color based on Y position (use continuous value, not grid-snapped)
        const { hsl, glowHsl } = getDotColor(
          cursorDotPosition.normalizedY * (gridRows - 1),
          gridRows,
          isDarkMode
        )

        return (
          <div
            className="absolute pointer-events-none z-30"
            style={{
              left: pixelX,
              top: pixelY,
              width: dotSize,
              height: dotSize,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              backgroundColor: hsl,
              boxShadow: `0 0 18px ${glowHsl}, 0 0 36px ${glowHsl}`,
            }}
          />
        )
      })()}
    </div>
  )
}
