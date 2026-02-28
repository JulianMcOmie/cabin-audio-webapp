"use client"

import { useState } from "react"
import { HelpCircle, X, ChevronDown } from "lucide-react"
import type { QualityLevel } from "@/components/unified-particle-scene"

const QUALITY_OPTIONS: { value: QualityLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
]

export type HighlightTarget = "grid" | "eq" | "music" | null

interface TopOverlayProps {
  quality: QualityLevel
  onQualityChange: (q: QualityLevel) => void
  onHighlightTarget: (target: HighlightTarget) => void
}

function InteractiveRef({
  label,
  target,
  onHighlightTarget,
}: {
  label: string
  target: "grid" | "eq" | "music"
  onHighlightTarget: (target: HighlightTarget) => void
}) {
  return (
    <span
      className="text-cyan-400 font-medium underline decoration-dotted decoration-cyan-400/40 underline-offset-2 cursor-default transition-all hover:text-cyan-300 hover:decoration-cyan-300/60"
      style={{ textShadow: "0 0 8px rgba(34,211,238,0.4)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textShadow = "0 0 12px rgba(34,211,238,0.9), 0 0 24px rgba(34,211,238,0.5), 0 0 40px rgba(34,211,238,0.3)"
        onHighlightTarget(target)
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textShadow = "0 0 8px rgba(34,211,238,0.4)"
        onHighlightTarget(null)
      }}
    >
      {label}
    </span>
  )
}

function Step({
  number,
  action,
  children,
}: {
  number: number
  action: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 text-white/70 text-[10px] font-semibold flex items-center justify-center mt-0.5">
        {number}
      </span>
      <div className="min-w-0">
        <p className="text-white/85 font-medium">{action}</p>
        <p className="mt-0.5 text-white/50">{children}</p>
      </div>
    </div>
  )
}

export function TopOverlay({ quality, onQualityChange, onHighlightTarget }: TopOverlayProps) {
  const [showGuide, setShowGuide] = useState(false)
  const [learnMoreOpen, setLearnMoreOpen] = useState(false)

  return (
    <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className="flex items-center justify-between px-5 py-4">
        <h1 className="text-lg font-semibold text-white/90 drop-shadow-sm select-none pointer-events-none">
          Cabin Audio
        </h1>
        <div className="flex items-center gap-2">
          {/* Quality selector */}
          <div className="pointer-events-auto glass-panel rounded-lg px-3 py-1.5 flex items-center gap-2">
            <span className="text-xs text-white/45">Graphics</span>
            <div className="flex items-center gap-0.5">
              {QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onQualityChange(opt.value)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    quality === opt.value
                      ? "bg-white/15 text-white"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* How to Use */}
          <div className="relative">
            <button
              onClick={() => setShowGuide((v) => !v)}
              className="pointer-events-auto glass-panel rounded-lg px-3 py-1.5 hover:bg-white/10 transition-colors flex items-center gap-1.5 text-sm"
            >
              <HelpCircle className="h-3.5 w-3.5 text-white/80" />
              <span className="text-white/80">How to Use</span>
            </button>

            <div
              className={`absolute top-full right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto glass-panel rounded-xl p-4 shadow-lg transition-all duration-200 ease-out origin-top-right ${
                showGuide
                  ? "pointer-events-auto opacity-100 scale-100 translate-y-0"
                  : "pointer-events-none opacity-0 scale-95 -translate-y-1"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold text-white/90">How to Use</h2>
                <button
                  onClick={() => setShowGuide(false)}
                  className="rounded-sm p-0.5 hover:bg-white/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-white/60" />
                </button>
              </div>

              <p className="text-xs text-white/45 mb-4">
                A tool for shaping your headphone soundstage with EQ.
              </p>

              <div className="space-y-3.5 text-xs leading-relaxed">
                <Step
                  number={1}
                  action={
                    <>
                      Tap the{" "}
                      <InteractiveRef label="grid" target="grid" onHighlightTarget={onHighlightTarget} />
                    </>
                  }
                >
                  Each position plays noise at a different frequency range and stereo placement. Drag to select multiple. Arrow keys to move.
                </Step>

                <Step number={2} action="Listen to where each position appears">
                  You&apos;ll hear each one at a different perceived location. The goal: make them sound as spread out and spatially defined as possible &mdash; matching the general layout of the grid.
                </Step>

                <Step
                  number={3}
                  action={
                    <>
                      Shape it with{" "}
                      <InteractiveRef label="EQ" target="eq" onHighlightTarget={onHighlightTarget} />
                    </>
                  }
                >
                  EQ changes your soundstage. Drag the curve and listen for positions to shift &mdash; there&apos;s no formula, just experiment.
                </Step>

                <Step
                  number={4}
                  action={
                    <>
                      Test with{" "}
                      <InteractiveRef label="music" target="music" onHighlightTarget={onHighlightTarget} />
                    </>
                  }
                >
                  Add tracks from the library and listen. The same EQ applies to everything &mdash; grid and music.
                </Step>
              </div>

              {/* Learn more */}
              <div className="mt-4 pt-3 border-t border-white/8">
                <button
                  onClick={() => setLearnMoreOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-white/40 hover:text-white/60 transition-colors text-xs"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform duration-200 ${learnMoreOpen ? "rotate-180" : ""}`}
                  />
                  Learn more
                </button>
                <div
                  className={`overflow-hidden transition-all duration-200 ease-out ${
                    learnMoreOpen ? "max-h-[600px] opacity-100 mt-3" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="space-y-3 text-xs leading-relaxed text-white/50">
                    <p>
                      <span className="text-white/70 font-medium">Soundstage</span> is how spread out and spatially defined different instruments sound during a song. The grid simulates this &mdash; each position is like an instrument at a different spot in space.
                    </p>
                    <p>
                      Your results depend on your headphones/speakers and the shape of your ears (called <span className="text-white/70 font-medium">HRTF</span>). There&apos;s no single &ldquo;right&rdquo; EQ &mdash; experiment to find what sounds most defined to you.
                    </p>
                    <p>
                      Try a large bass boost, a large high-end boost, an upper midrange dip, and sharp narrow peaks and dips in the ultra high end. These can correspond to HRTF cues for spatial positioning and elevation. Select a single position to hear exactly how your changes affect it.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
