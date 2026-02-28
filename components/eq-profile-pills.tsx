"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useEQProfileStore, PROFILE_IDS, PROFILE_COLORS } from "@/lib/stores/eqProfileStore"
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

interface EQProfilePillsProps {
  size?: "sm" | "md"
}

export function EQProfilePills({ size = "md" }: EQProfilePillsProps) {
  const activeProfileId = useEQProfileStore((s) => s.activeProfileId)
  const setActiveProfile = useEQProfileStore((s) => s.setActiveProfile)

  const dim = size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]"

  return (
    <div className="flex items-center gap-1">
      {PROFILE_IDS.map((pid, i) => {
        const isActive = activeProfileId === pid
        const c = PROFILE_COLORS[pid]
        return (
          <Tip key={pid} text={`EQ Profile ${i + 1}`}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setActiveProfile(pid)
              }}
              className={cn(
                "rounded-full font-semibold flex items-center justify-center transition-all",
                dim,
                isActive
                  ? "text-teal-300 bg-teal-400/30"
                  : cn(c.text, "opacity-30 hover:opacity-60 hover:bg-white/[0.06]")
              )}
            >
              {i + 1}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}
