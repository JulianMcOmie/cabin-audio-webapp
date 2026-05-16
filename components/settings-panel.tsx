"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Instant tooltip — no hover delay, positioned above the trigger
// ---------------------------------------------------------------------------

function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ left: 0, top: 0, visibility: 'hidden' })

  useEffect(() => {
    if (!show || !triggerRef.current || !tipRef.current) return
    const tr = triggerRef.current.getBoundingClientRect()
    const tp = tipRef.current.getBoundingClientRect()
    const pad = 6

    // Default: centered above
    let x = tr.left + tr.width / 2 - tp.width / 2
    let y = tr.top - pad - tp.height

    // Clamp horizontal
    if (x < pad) x = pad
    if (x + tp.width > window.innerWidth - pad) x = window.innerWidth - pad - tp.width

    // If clipped above, flip below
    if (y < pad) y = tr.bottom + pad

    setStyle({ left: x, top: y, visibility: 'visible' })
  }, [show])

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => { setShow(false); setStyle(s => ({ ...s, visibility: 'hidden' })) }}
    >
      {children}
      {show && createPortal(
        <span
          ref={tipRef}
          className="fixed px-2 py-1 rounded-md text-[10px] leading-tight whitespace-nowrap dark:bg-white/15 bg-black/80 dark:text-white/90 text-white backdrop-blur-sm pointer-events-none z-[9999]"
          style={style}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  )
}

interface SettingsPanelProps {
  speed: number
  onSpeedChange: (value: number) => void
  volumePercent: number
  onVolumeChange: (value: number) => void
}

const SPEED_MIN_HZ = 0.01
const SPEED_MAX_HZ = 32
const SPEED_SLIDER_MAX = 100

function clampSpeed(speed: number): number {
  return Math.min(SPEED_MAX_HZ, Math.max(SPEED_MIN_HZ, Number.isFinite(speed) ? speed : SPEED_MAX_HZ))
}

function speedToSliderValue(speed: number): number {
  const clamped = clampSpeed(speed)
  const minLog = Math.log(SPEED_MIN_HZ)
  const maxLog = Math.log(SPEED_MAX_HZ)
  return ((Math.log(clamped) - minLog) / (maxLog - minLog)) * SPEED_SLIDER_MAX
}

function sliderValueToSpeed(value: number): number {
  const t = Math.min(1, Math.max(0, value / SPEED_SLIDER_MAX))
  const minLog = Math.log(SPEED_MIN_HZ)
  const maxLog = Math.log(SPEED_MAX_HZ)
  const speed = Math.exp(minLog + t * (maxLog - minLog))
  return Math.round(speed * 1000) / 1000
}

function formatSpeed(speed: number): string {
  const clamped = clampSpeed(speed)
  if (clamped < 0.1) return `${clamped.toFixed(2)}/s`
  if (clamped < 1) return `${clamped.toFixed(1)}/s`
  if (clamped < 10) return `${clamped.toFixed(1)}/s`
  return `${clamped.toFixed(0)}/s`
}

export function SettingsPanel({
  speed,
  onSpeedChange,
  volumePercent,
  onVolumeChange,
}: SettingsPanelProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const content = (
    <div className={cn(
      "fixed right-4 top-1/2 z-50 -translate-y-1/2 transition-opacity duration-500 pointer-events-none",
      "opacity-100"
    )}>
        <div className="rounded-xl glass-panel overflow-hidden pointer-events-auto">
          <div className="p-4 space-y-4">
            <span className="text-[10px] dark:text-white/40 text-black/40 uppercase tracking-wider font-medium">Settings</span>
            <div className="flex gap-6 justify-center">
              {/* Speed slider */}
              <div className="flex flex-col items-center gap-2">
                <Tip text="Dot hit rate in hits per second; the slider is logarithmic so slow speeds are easier to adjust">
                  <span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Spd</span>
                </Tip>
                <div className="h-28">
                  <Slider
                    orientation="vertical"
                    value={[speedToSliderValue(speed)]}
                    min={0}
                    max={SPEED_SLIDER_MAX}
                    step={0.1}
                    onValueChange={(v) => onSpeedChange(sliderValueToSpeed(v[0]))}
                  />
                </div>
                <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">
                  {formatSpeed(speed)}
                </span>
              </div>

              {/* Volume slider */}
              <div className="flex flex-col items-center gap-2">
                <Tip text="Volume of the soundstage dots"><span className="text-[10px] dark:text-white/50 text-black/50 uppercase tracking-wider">Vol</span></Tip>
                <div className="h-28">
                  <Slider
                    orientation="vertical"
                    value={[volumePercent]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => onVolumeChange(v[0])}
                  />
                </div>
                <span className="text-[10px] dark:text-white/70 text-black/70 tabular-nums">{volumePercent.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>
    </div>
  )

  if (!mounted) return null
  return createPortal(content, document.body)
}
