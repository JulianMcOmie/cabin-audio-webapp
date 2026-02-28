"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { ArrowLeft, Download, Copy, Check, ChevronDown, Braces, Globe } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { EQProfilePills } from "@/components/eq-profile-pills"
import { ExportCurvePreview } from "@/components/export-curve-preview"
import { useEQProfileStore, PROFILE_COLORS } from "@/lib/stores/eqProfileStore"
import { useToast } from "@/components/common/ToastManager"
import { cn } from "@/lib/utils"
import {
  getFormatsByPlatform,
  type FormatEntry,
  type ExportInput,
  type ExportResult,
} from "@/lib/utils/eqExport"

// ── Accordion panel with JS-measured height ────────────────────────────

function AccordionPanel({
  isOpen,
  children,
}: {
  isOpen: boolean
  children: React.ReactNode
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!innerRef.current) return
    if (isOpen) {
      setHeight(innerRef.current.scrollHeight)
    } else {
      // Collapse: first snapshot the current height explicitly so the
      // browser has a concrete start value, then set to 0 next frame.
      const el = innerRef.current
      setHeight(el.scrollHeight)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0))
      })
    }
  }, [isOpen])

  // Re-measure if children change while open (e.g. code preview renders)
  useEffect(() => {
    if (isOpen && innerRef.current) {
      setHeight(innerRef.current.scrollHeight)
    }
  }, [isOpen, children])

  return (
    <div
      style={{
        height: isOpen ? height : 0,
        transition: "height 500ms cubic-bezier(0.25, 0.1, 0.25, 1)",
      }}
      className="overflow-hidden"
    >
      <div ref={innerRef}>
        <div
          className={cn(
            "transition-opacity duration-300",
            isOpen ? "opacity-100 delay-100" : "opacity-0"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Platform / format icons (inline SVGs for Apple, Windows, Android) ──

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 384 512" fill="currentColor" className={className}>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-62.1 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 448 512" fill="currentColor" className={className}>
      <path d="M0 93.7l183.6-25.3v177.4H0V93.7zm0 324.6l183.6 25.3V268.4H0v149.9zm203.8 28L448 480V268.4H203.8v177.9zm0-380.6v180.1H448V32L203.8 65.7z" />
    </svg>
  )
}

function AndroidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 576 512" fill="currentColor" className={className}>
      <path d="M420.55 301.93a24 24 0 1 1 24-24 24 24 0 0 1-24 24m-265.1 0a24 24 0 1 1 24-24 24 24 0 0 1-24 24m273.7-144.48 47.94-83a10 10 0 1 0-17.27-10l-48.54 84.07a301.25 301.25 0 0 0-246.56 0L116.18 64.45a10 10 0 1 0-17.27 10l47.94 83C64.53 202.22 8.24 285.55 0 384h576c-8.24-98.45-64.54-181.78-146.85-226.55" />
    </svg>
  )
}

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  macOS: AppleIcon,
  Windows: WindowsIcon,
  Android: AndroidIcon,
  "Cross-platform": Globe,
}

const FORMAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  json: Braces,
}

// ── Page ────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const [expandedFormatId, setExpandedFormatId] = useState<string | null>(null)
  const [copiedFormatId, setCopiedFormatId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const router = useRouter()

  const getActiveProfile = useEQProfileStore((s) => s.getActiveProfile)
  const activeProfileId = useEQProfileStore((s) => s.activeProfileId)
  const { showToast } = useToast()

  useEffect(() => setMounted(true), [])

  const triggerExit = useCallback(() => {
    if (isExiting) return
    setIsExiting(true)
    setTimeout(() => router.push("/"), 300)
  }, [isExiting, router])

  const handleBack = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      triggerExit()
    },
    [triggerExit]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") triggerExit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [triggerExit])

  const profile = getActiveProfile()
  const groups = getFormatsByPlatform()

  const pc =
    activeProfileId && activeProfileId in PROFILE_COLORS
      ? PROFILE_COLORS[activeProfileId as keyof typeof PROFILE_COLORS]
      : PROFILE_COLORS["profile-1"]

  const hasBands = profile && (profile.bands?.length ?? 0) > 0

  // Pre-compute all format results so accordion content is always in the DOM
  const allResults = useMemo(() => {
    if (!profile) return {} as Record<string, ExportResult>
    const input: ExportInput = {
      profileName: profile.name,
      bands: profile.bands ?? [],
      preampDb: profile.volume ?? 0,
    }
    const map: Record<string, ExportResult> = {}
    for (const group of groups) {
      for (const entry of group.formats) {
        map[entry.meta.id] = entry.convert(input)
      }
    }
    return map
  }, [profile, groups])

  const handleDownload = useCallback(
    (entry: FormatEntry, e: React.MouseEvent) => {
      e.stopPropagation()
      const result = allResults[entry.meta.id]
      if (!result) return
      const blob = new Blob([result.content], { type: result.mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = result.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast({ message: `Downloaded ${result.fileName}`, variant: "success" })
    },
    [allResults, showToast]
  )

  const handleCopy = useCallback(
    async (entry: FormatEntry, e: React.MouseEvent) => {
      e.stopPropagation()
      const result = allResults[entry.meta.id]
      if (!result) return
      try {
        await navigator.clipboard.writeText(result.content)
        setCopiedFormatId(entry.meta.id)
        showToast({ message: "Copied to clipboard", variant: "success" })
        setTimeout(() => setCopiedFormatId(null), 2000)
      } catch {
        showToast({ message: "Failed to copy", variant: "error" })
      }
    },
    [allResults, showToast]
  )

  const toggleExpand = useCallback((id: string) => {
    setExpandedFormatId((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link
          href="/"
          onClick={handleBack}
          className={cn(
            "inline-flex items-center gap-2 text-[13px] text-white/40 hover:text-white/70 transition-colors mb-6",
            isExiting ? "animate-page-exit" : "animate-page-enter"
          )}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        {/* Title row */}
        <div
          className={cn(
            "flex items-center gap-3 mb-6 flex-wrap",
            isExiting ? "animate-page-exit" : "animate-page-enter"
          )}
          style={{ animationDelay: isExiting ? "30ms" : "50ms" }}
        >
          <h1 className="text-[18px] font-semibold tracking-wide text-white/90">
            Export EQ Profile
          </h1>
          <EQProfilePills size="md" />
          {mounted && profile && (
            <span className={cn("text-[13px] font-medium", pc.label)}>
              {profile.name}
            </span>
          )}
        </div>

        {/* EQ curve hero */}
        <div
          className={cn("mb-6", isExiting ? "animate-page-exit" : "animate-page-enter")}
          style={{ animationDelay: isExiting ? "60ms" : "100ms" }}
        >
          <ExportCurvePreview
            bands={profile?.bands ?? []}
            className="h-[200px] w-full rounded-xl overflow-hidden"
          />
        </div>

        {/* Format list */}
        {!hasBands ? (
          <div
            className={cn(
              "glass-panel rounded-xl p-8 text-center",
              isExiting ? "animate-page-exit" : "animate-page-enter"
            )}
            style={{ animationDelay: isExiting ? "90ms" : "150ms" }}
          >
            <p className="text-[13px] text-white/40">
              No EQ bands to export. Add some bands first.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group, gi) => {
              const PlatformIcon = PLATFORM_ICONS[group.platform]
              return (
                <div
                  key={group.platform}
                  className={isExiting ? "animate-page-exit" : "animate-page-enter"}
                  style={{ animationDelay: isExiting ? `${90 + gi * 30}ms` : `${150 + gi * 50}ms` }}
                >
                  <div className="flex items-center gap-1.5 px-1 mb-2">
                    {PlatformIcon && (
                      <PlatformIcon className="h-3 w-3 text-white/30" />
                    )}
                    <p className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                      {group.platform}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {group.formats.map((entry) => {
                      const isExpanded = expandedFormatId === entry.meta.id
                      const isCopied = copiedFormatId === entry.meta.id
                      const result = allResults[entry.meta.id]
                      const FormatIcon =
                        FORMAT_ICONS[entry.meta.id] ??
                        PLATFORM_ICONS[entry.meta.platform]

                      return (
                        <div
                          key={entry.meta.id}
                          className="glass-panel rounded-xl overflow-hidden"
                        >
                          {/* Row header — div instead of button to avoid nesting buttons */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleExpand(entry.meta.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                toggleExpand(entry.meta.id)
                              }
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.04] transition-colors cursor-pointer select-none"
                          >
                            {FormatIcon && (
                              <FormatIcon className="h-4 w-4 shrink-0 text-white/30" />
                            )}

                            <div className="flex-1 min-w-0">
                              <span className="text-[13px] font-medium text-white/80">
                                {entry.meta.name}
                              </span>
                              <p className="text-[11px] text-white/35 mt-0.5">
                                {entry.meta.description}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => handleDownload(entry, e)}
                              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/8 hover:bg-white/15 text-white/60 hover:text-white/90 transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </button>

                            <ChevronDown
                              className={cn(
                                "h-4 w-4 shrink-0 text-white/25 transition-transform duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]",
                                isExpanded && "rotate-180"
                              )}
                            />
                          </div>

                          {/* Expandable detail */}
                          <AccordionPanel isOpen={isExpanded}>
                            <div className="px-4 pb-4 pt-3.5 space-y-3 border-t border-white/[0.06]">
                              <p className="text-[12px] text-white/50 leading-relaxed">
                                {entry.meta.instructions}
                              </p>

                              {result && (
                                <div className="relative group/code">
                                  <pre className="text-[11px] leading-relaxed text-white/60 bg-white/[0.03] rounded-lg p-4 pr-12 overflow-x-auto max-h-[260px] overflow-y-auto font-mono whitespace-pre-wrap break-all border border-white/[0.06]">
                                    {result.content}
                                  </pre>
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopy(entry, e)}
                                    className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-white/8 hover:bg-white/15 text-white/40 hover:text-white/80 opacity-0 group-hover/code:opacity-100 transition-all"
                                    title="Copy to clipboard"
                                  >
                                    {isCopied ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          </AccordionPanel>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
