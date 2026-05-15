"use client"

import { useState } from "react"
import { X, Power } from "lucide-react"
import Link from "next/link"
import { FrequencyEQ } from "@/components/parametric-eq"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQProfilePills } from "@/components/eq-profile-pills"
import { cn } from "@/lib/utils"
import type { EQBandChannel } from "@/lib/models/EQBand"

interface EQOverlayProps {
  isOpen: boolean
  onClose: () => void
  onActiveBandChange?: (band: { frequency: number; gain: number; q: number } | null) => void
}

export function EQOverlay({ isOpen, onClose, onActiveBandChange }: EQOverlayProps) {
  const [instruction, setInstruction] = useState("Click + drag on the center line to add a band")
  const [activeChannel, setActiveChannel] = useState<EQBandChannel>("both")
  const getActiveProfile = useEQProfileStore((s) => s.getActiveProfile)
  const isEQEnabled = useEQProfileStore((s) => s.isEQEnabled)
  const setEQEnabled = useEQProfileStore((s) => s.setEQEnabled)
  const autoGainDb = useEQProfileStore((s) => s.autoGainDb)
  const isAutoGainEnabled = useEQProfileStore((s) => s.isAutoGainEnabled)
  const setAutoGainEnabled = useEQProfileStore((s) => s.setAutoGainEnabled)

  return (
    <div
      className={`fixed left-4 right-32 bottom-44 z-[60] h-[33vh] transition-all duration-200 ease-out ${
        isOpen
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-[0.98] pointer-events-none"
      }`}
    >
      <div className="glass-panel rounded-xl p-3 md:p-4 h-full flex flex-col min-h-0 shadow-xl relative">
        <div
          className="flex items-center justify-between mb-2.5 select-none"
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
            {/* L / Both / R channel selector for new bands */}
            <div
              className="flex items-center rounded-md border dark:border-white/10 border-black/10 overflow-hidden"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(["left", "both", "right"] as const).map((ch) => {
                const label = ch === "left" ? "L" : ch === "right" ? "R" : "L+R"
                const active = activeChannel === ch
                const activeClass = ch === "left"
                  ? "dark:bg-blue-400/20 bg-blue-500/20 dark:text-blue-200 text-blue-700"
                  : ch === "right"
                  ? "dark:bg-rose-400/20 bg-rose-500/20 dark:text-rose-200 text-rose-700"
                  : "dark:bg-white/10 bg-black/10 dark:text-white/80 text-black/70"
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setActiveChannel(ch)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-medium tracking-wide uppercase transition-colors",
                      active
                        ? activeClass
                        : "dark:text-white/40 text-black/40 dark:hover:text-white/70 hover:text-black/70"
                    )}
                    title={`Add new bands to ${ch === "both" ? "both channels" : ch + " channel"}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
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
            activeChannel={activeChannel}
            onInstructionChange={setInstruction}
            onRequestEnable={() => setEQEnabled(true)}
            onActiveBandChange={onActiveBandChange}
          />
        </div>
      </div>
    </div>
  )
}
