"use client"

import { useEQProfileStore, PROFILE_IDS, PROFILE_COLORS } from "@/lib/stores/eqProfileStore"
import { cn } from "@/lib/utils"

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
          <button
            key={pid}
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
            title={`Profile ${i + 1}`}
          >
            {i + 1}
          </button>
        )
      })}
    </div>
  )
}
