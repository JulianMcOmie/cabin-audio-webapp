"use client"

import { useMemo, useState } from "react"
import { ChevronUp, Sliders } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FrequencyEQ } from "@/components/parametric-eq"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"

const MIN_FREQ = 20
const MAX_FREQ = 20000
const PREVIEW_W = 140
const PREVIEW_H = 28

function buildPreviewPath(points: Array<{ frequency: number; gain: number }>): string {
  const samples = 36
  const minLog = Math.log10(MIN_FREQ)
  const maxLog = Math.log10(MAX_FREQ)

  const control = [{ frequency: MIN_FREQ, gain: 0 }, ...points, { frequency: MAX_FREQ, gain: 0 }]
    .sort((a, b) => a.frequency - b.frequency)

  const xForFreq = (freq: number) => {
    const x = (Math.log10(freq) - minLog) / (maxLog - minLog)
    return x * PREVIEW_W
  }

  const yForGain = (gain: number) => {
    const clamped = Math.max(-24, Math.min(24, gain))
    return PREVIEW_H / 2 - (clamped / 24) * (PREVIEW_H / 2)
  }

  const curvePoints: Array<{ x: number; y: number }> = []

  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * PREVIEW_W

    let left = control[0]
    let right = control[control.length - 1]

    for (let j = 0; j < control.length - 1; j++) {
      const a = control[j]
      const b = control[j + 1]
      const ax = xForFreq(a.frequency)
      const bx = xForFreq(b.frequency)
      if (x >= ax && x <= bx) {
        left = a
        right = b
        break
      }
    }

    const leftX = xForFreq(left.frequency)
    const rightX = xForFreq(right.frequency)
    const t = rightX === leftX ? 0 : (x - leftX) / (rightX - leftX)
    const gain = left.gain + (right.gain - left.gain) * t
    curvePoints.push({ x, y: yForGain(gain) })
  }

  return curvePoints.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
}

export function EQToolDock() {
  const [isOpen, setIsOpen] = useState(false)
  const [instruction, setInstruction] = useState("Click + drag on the center line to add a band")

  const profiles = useEQProfileStore((s) => s.profiles)
  const activeProfileId = useEQProfileStore((s) => s.activeProfileId)
  const getActiveProfile = useEQProfileStore((s) => s.getActiveProfile)
  const isEQEnabled = useEQProfileStore((s) => s.isEQEnabled)
  const setEQEnabled = useEQProfileStore((s) => s.setEQEnabled)

  const activeBands = useMemo(() => {
    if (!activeProfileId) return []
    return profiles[activeProfileId]?.bands ?? []
  }, [activeProfileId, profiles])

  const previewPath = useMemo(
    () =>
      buildPreviewPath(
        activeBands.map((b) => ({
          frequency: b.frequency,
          gain: b.gain,
        }))
      ),
    [activeBands]
  )

  return (
    <div className="relative z-30 border-t bg-background/95">
      <div
        className={`absolute left-3 right-3 bottom-full mb-2 transition-all duration-300 ease-out ${
          isOpen ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-8 pointer-events-none"
        }`}
      >
        <div className="rounded-xl border bg-card/95 backdrop-blur shadow-xl p-3 md:p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-semibold">EQ Tool</h4>
              <p className="text-xs text-muted-foreground">{instruction}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>
              Collapse
            </Button>
          </div>
          <div className="h-[280px] md:h-[340px]">
            <FrequencyEQ
              profileId={getActiveProfile()?.id}
              disabled={false}
              onInstructionChange={setInstruction}
              onRequestEnable={() => setEQEnabled(true)}
            />
          </div>
        </div>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-3">
          <Button className="min-w-[126px]" variant={isOpen ? "default" : "outline"} onClick={() => setIsOpen((v) => !v)}>
            <Sliders className="h-4 w-4 mr-2" />
            {isOpen ? "Hide EQ Tool" : "Open EQ Tool"}
          </Button>

          <button
            type="button"
            onClick={() => setEQEnabled(!isEQEnabled)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              isEQEnabled
                ? "bg-electric-blue/10 text-electric-blue border-electric-blue/40"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {isEQEnabled ? "EQ Active" : "EQ Inactive"}
          </button>

          <div className="ml-auto flex items-center gap-2 min-w-[180px]">
            <svg width={PREVIEW_W} height={PREVIEW_H} viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`} className="overflow-visible">
              <line x1={0} y1={PREVIEW_H / 2} x2={PREVIEW_W} y2={PREVIEW_H / 2} stroke="currentColor" className="text-muted/60" strokeWidth="1" />
              <path
                d={previewPath}
                fill="none"
                stroke={isEQEnabled ? "currentColor" : "currentColor"}
                className={isEQEnabled ? "text-electric-blue" : "text-muted-foreground"}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <ChevronUp className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </div>
        </div>
      </div>
    </div>
  )
}

