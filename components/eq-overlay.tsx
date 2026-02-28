"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { X, Power } from "lucide-react"
import Link from "next/link"
import { FrequencyEQ } from "@/components/parametric-eq"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQProfilePills } from "@/components/eq-profile-pills"
import { cn } from "@/lib/utils"

interface EQOverlayProps {
  isOpen: boolean
  onClose: () => void
}

interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

const VIEWPORT_PADDING = 12
const MIN_WINDOW_WIDTH = 360
const MIN_WINDOW_HEIGHT = 300

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const getViewportConstrainedRect = (rect: WindowRect): WindowRect => {
  if (typeof window === "undefined") return rect

  const maxWidth = Math.max(240, window.innerWidth - VIEWPORT_PADDING * 2)
  const maxHeight = Math.max(220, window.innerHeight - VIEWPORT_PADDING * 2)

  const minWidth = Math.min(MIN_WINDOW_WIDTH, maxWidth)
  const minHeight = Math.min(MIN_WINDOW_HEIGHT, maxHeight)

  const width = clamp(rect.width, minWidth, maxWidth)
  const height = clamp(rect.height, minHeight, maxHeight)

  const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
  const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING)

  return {
    x: clamp(rect.x, VIEWPORT_PADDING, maxX),
    y: clamp(rect.y, VIEWPORT_PADDING, maxY),
    width,
    height,
  }
}

const SSR_FALLBACK_RECT: WindowRect = { x: 16, y: 64, width: 820, height: 420 }

const calcCenteredRect = (): WindowRect => {
  const rect: WindowRect = {
    width: Math.min(900, window.innerWidth - VIEWPORT_PADDING * 2),
    height: Math.min(520, Math.max(320, window.innerHeight * 0.6)),
    x: 0,
    y: Math.max(16, window.innerHeight * 0.08),
  }
  rect.x = (window.innerWidth - rect.width) / 2
  return getViewportConstrainedRect(rect)
}

export function EQOverlay({ isOpen, onClose }: EQOverlayProps) {
  const [instruction, setInstruction] = useState("Click + drag on the center line to add a band")
  const [windowRect, setWindowRect] = useState<WindowRect>(SSR_FALLBACK_RECT)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const getActiveProfile = useEQProfileStore((s) => s.getActiveProfile)
  const isEQEnabled = useEQProfileStore((s) => s.isEQEnabled)
  const setEQEnabled = useEQProfileStore((s) => s.setEQEnabled)
  const autoGainDb = useEQProfileStore((s) => s.autoGainDb)
  const isAutoGainEnabled = useEQProfileStore((s) => s.isAutoGainEnabled)
  const setAutoGainEnabled = useEQProfileStore((s) => s.setAutoGainEnabled)

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; startRect: WindowRect } | null>(null)

  useEffect(() => {
    setWindowRect(calcCenteredRect())
  }, [])

  useEffect(() => {
    const onWindowResize = () => {
      setWindowRect((prev) => getViewportConstrainedRect(prev))
    }

    window.addEventListener("resize", onWindowResize)
    return () => window.removeEventListener("resize", onWindowResize)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setWindowRect((prev) => getViewportConstrainedRect(prev))
  }, [isOpen])

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    if (target.closest("button, input, select, textarea, a, [role='button']")) return

    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - windowRect.x,
      offsetY: event.clientY - windowRect.y,
    }
    setIsDragging(true)
  }, [windowRect.x, windowRect.y])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: windowRect,
    }
    setIsResizing(true)
  }, [windowRect])

  useEffect(() => {
    if (!isDragging && !isResizing) return

    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current && event.pointerId === dragRef.current.pointerId) {
        const { offsetX, offsetY } = dragRef.current
        setWindowRect((prev) =>
          getViewportConstrainedRect({
            ...prev,
            x: event.clientX - offsetX,
            y: event.clientY - offsetY,
          })
        )
      }

      if (resizeRef.current && event.pointerId === resizeRef.current.pointerId) {
        const deltaX = event.clientX - resizeRef.current.startX
        const deltaY = event.clientY - resizeRef.current.startY
        const startRect = resizeRef.current.startRect
        const nextRect = getViewportConstrainedRect({
          ...startRect,
          width: startRect.width + deltaX,
          height: startRect.height + deltaY,
        })
        setWindowRect(nextRect)
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current && event.pointerId === dragRef.current.pointerId) {
        dragRef.current = null
        setIsDragging(false)
      }

      if (resizeRef.current && event.pointerId === resizeRef.current.pointerId) {
        resizeRef.current = null
        setIsResizing(false)
      }
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
    }
  }, [isDragging, isResizing])

  return (
    <div
      className={`fixed z-[60] transition-all duration-200 ease-out ${
        isOpen
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-[0.98] pointer-events-none"
      }`}
      style={{
        left: `${windowRect.x}px`,
        top: `${windowRect.y}px`,
        width: `${windowRect.width}px`,
        height: `${windowRect.height}px`,
      }}
    >
      <div className="glass-panel rounded-xl p-3 md:p-4 h-full flex flex-col min-h-0 shadow-xl relative">
        <div
          onPointerDown={handleDragStart}
          className={`flex items-center justify-between mb-2.5 select-none touch-none ${
            isDragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div className="flex items-center min-w-0">
            <div className="min-w-0">
              <h4 className="text-[13px] font-medium tracking-wide dark:text-white/80 text-black/70">EQ</h4>
              <p className="text-[11px] dark:text-white/40 text-black/40 truncate transition-opacity duration-150">{instruction}</p>
              {autoGainDb < 0 && (
                <p className="text-[10px] dark:text-white/30 text-black/30">
                  Auto-gain: {autoGainDb.toFixed(1)} dB
                </p>
              )}
              <button
                type="button"
                onClick={() => setAutoGainEnabled(!isAutoGainEnabled)}
                className="text-[10px] dark:text-white/30 text-black/30 hover:dark:text-white/50 hover:text-black/50 transition-colors"
              >
                Auto-gain: {isAutoGainEnabled ? "on" : "off"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-3">
            <EQProfilePills size="md" />
            <button
              type="button"
              onClick={() => setEQEnabled(!isEQEnabled)}
              className={cn("p-1.5 rounded-lg transition-colors", isEQEnabled
                ? "text-teal-400 hover:text-teal-300"
                : "dark:text-white/20 text-black/20 dark:hover:text-white/40 hover:text-black/40"
              )}
              title={isEQEnabled ? "Disable EQ" : "Enable EQ"}
            >
              <Power className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 dark:text-white/40 text-black/40 dark:hover:text-white/70 hover:text-black/70 dark:hover:bg-white/8 hover:bg-black/8 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex justify-end mb-1.5">
          <Link
            href="/export"
            className="text-[10px] font-medium dark:text-white/35 text-black/35 dark:hover:text-white/60 hover:text-black/60 hover:dark:bg-white/[0.05] hover:bg-black/[0.04] px-2 py-1 rounded-md transition-colors"
          >
            Export EQ
          </Link>
        </div>
        <div className="min-h-0 flex-1">
          <FrequencyEQ
            profileId={getActiveProfile()?.id}
            disabled={false}
            onInstructionChange={setInstruction}
            onRequestEnable={() => setEQEnabled(true)}
          />
        </div>
        <button
          type="button"
          onPointerDown={handleResizeStart}
          className={`absolute right-1.5 bottom-1.5 h-5 w-5 rounded-sm dark:text-white/40 text-black/40 dark:hover:text-white/70 hover:text-black/70 ${
            isResizing ? "opacity-100" : "opacity-80"
          } cursor-se-resize`}
          aria-label="Resize EQ window"
          title="Resize"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 ml-auto mt-auto">
            <path d="M6 14L14 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M10 14L14 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 14L14 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
