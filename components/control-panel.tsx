"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Volume1, Loader2, Power } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { useToast } from "@/components/common/ToastManager"
import { usePlayerStore, useTrackStore, useArtistStore, useAlbumStore } from "@/lib/stores"
import { useEQProfileStore, PROFILE_COLORS } from "@/lib/stores/eqProfileStore"
import { useBassReactive } from "@/lib/hooks/useBassReactive"
import { getAudioRouting } from "@/lib/audio/audioRouting"
import { cn } from "@/lib/utils"
import * as fileStorage from "@/lib/storage/fileStorage"
import Image from "next/image"
import type { HighlightTarget } from "@/components/top-overlay"
import type { QualityLevel } from "@/components/unified-particle-scene"
import { EQProfilePills } from "@/components/eq-profile-pills"

// ---------------------------------------------------------------------------
// EQ Preview — uses real biquad filter frequency response for smooth curves
// ---------------------------------------------------------------------------

const PREVIEW_W = 100
const PREVIEW_H = 28
const PREVIEW_POINTS = 64
const PREVIEW_FFT_POINTS = 120
const PREVIEW_TARGET_FFT_SIZE = 16384
const FFT_DB_FLOOR = -96
const FFT_DB_CEIL = -8
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const PLAYBAR_SHAKE_BUCKETS = 36

interface MicroJerkPattern {
  offsets: Array<{ x: number; y: number }>
  stepMs: number
}

const hash01 = (seed: number) => {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function buildPitchJerkPattern(bucket: number): MicroJerkPattern {
  const jerkCount = hash01(bucket * 19.7 + 2.1) > 0.46 ? 4 : 3
  const stepMs = 15 + Math.floor(hash01(bucket * 7.1 + 9.8) * 10) // 15-24ms

  // A tiny deterministic vector per bucket, then alternating sign creates speaker-like oscillation.
  const baseX = (hash01(bucket * 13.2 + 1.4) - 0.5) * 1.6
  const baseY = (hash01(bucket * 29.4 + 3.7) - 0.5) * 1.2
  const offsets: Array<{ x: number; y: number }> = []

  for (let i = 0; i < jerkCount; i++) {
    const sign = i % 2 === 0 ? 1 : -1
    const decay = 1 - i * 0.2
    const jitterX = (hash01(bucket * 41.3 + i * 5.9) - 0.5) * 0.22
    const jitterY = (hash01(bucket * 53.6 + i * 7.2) - 0.5) * 0.18
    offsets.push({
      x: (baseX * sign + jitterX) * decay,
      y: (baseY * sign + jitterY) * decay,
    })
  }

  return { offsets, stepMs }
}

function buildSmoothPreviewPath(
  bands: Array<{ frequency: number; gain: number; q: number }>,
): string {
  if (bands.length === 0) {
    // Flat line
    return `M 0 ${PREVIEW_H / 2} L ${PREVIEW_W} ${PREVIEW_H / 2}`
  }

  // Sample log-spaced frequencies 20 Hz – 20 kHz
  const minLog = Math.log10(20)
  const maxLog = Math.log10(20000)
  const points: Array<{ x: number; y: number }> = []

  for (let i = 0; i <= PREVIEW_POINTS; i++) {
    const t = i / PREVIEW_POINTS
    const freq = Math.pow(10, minLog + t * (maxLog - minLog))
    const x = t * PREVIEW_W

    // Sum gain from every band using the analog peaking EQ transfer function
    let totalGainDb = 0
    for (const band of bands) {
      const f0 = band.frequency
      const G = band.gain
      const Q = band.q || 1
      // H(f) for peaking EQ — second-order resonance approximation
      const ratio = freq / f0
      const denom = Math.sqrt(
        Math.pow(1 - ratio * ratio, 2) + Math.pow(ratio / Q, 2)
      )
      // Bell shape: gain * (ratio/Q) / denom
      const magnitude = (ratio / Q) / denom
      totalGainDb += G * magnitude
    }

    const clamped = Math.max(-24, Math.min(24, totalGainDb))
    const y = PREVIEW_H / 2 - (clamped / 24) * (PREVIEW_H / 2)
    points.push({ x, y })
  }

  // Build a smooth cubic spline SVG path
  if (points.length < 2) return ""
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const cpx = (prev.x + curr.x) / 2
    d += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
  }
  return d
}

function getEqCurveTargetValue(
  freq: number,
  bands: Array<{ frequency: number; gain: number; q: number }>
): number {
  if (bands.length === 0) return 0.5

  let totalGainDb = 0
  for (const band of bands) {
    const f0 = band.frequency
    const G = band.gain
    const Q = band.q || 1
    const ratio = freq / f0
    const denom = Math.sqrt(
      Math.pow(1 - ratio * ratio, 2) + Math.pow(ratio / Q, 2)
    )
    const magnitude = (ratio / Q) / denom
    totalGainDb += G * magnitude
  }

  const clamped = Math.max(-24, Math.min(24, totalGainDb))
  return clamp01((clamped + 24) / 48)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ControlPanelProps {
  showEQOverlay: boolean
  onToggleEQOverlay: () => void
  onToggleLibrary: () => void
  highlightTarget: HighlightTarget
  quality: QualityLevel
}

export function ControlPanel({ showEQOverlay, onToggleEQOverlay, onToggleLibrary, highlightTarget, quality }: ControlPanelProps) {
  const { showToast } = useToast()

  const {
    currentTrackId,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    loadingState,
    error,
    setCurrentTrack,
    setIsPlaying,
    setVolume,
    setIsMuted,
    seekTo
  } = usePlayerStore()

  const getTrackById = useTrackStore(state => state.getTrackById)
  const getTracks = useTrackStore(state => state.getTracks)
  const currentTrack = currentTrackId ? getTrackById(currentTrackId) : null

  const getArtistById = useArtistStore(state => state.getArtistById)
  const getAlbumById = useAlbumStore(state => state.getAlbumById)

  const { isEQEnabled, setEQEnabled } = useEQProfileStore()
  const profiles = useEQProfileStore((s) => s.profiles)
  const activeProfileId = useEQProfileStore((s) => s.activeProfileId)

  const pc = activeProfileId && activeProfileId in PROFILE_COLORS
    ? PROFILE_COLORS[activeProfileId as keyof typeof PROFILE_COLORS]
    : PROFILE_COLORS['profile-1']

  const activeBands = useMemo(() => {
    if (!activeProfileId) return []
    return profiles[activeProfileId]?.bands ?? []
  }, [activeProfileId, profiles])

  const previewPath = useMemo(
    () =>
      buildSmoothPreviewPath(
        activeBands.map((b) => ({
          frequency: b.frequency,
          gain: b.gain,
          q: b.q,
        }))
      ),
    [activeBands]
  )

  const [isTrackLoading, setIsTrackLoading] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekPosition, setSeekPosition] = useState(0)
  const wasPlayingRef = useRef(false)
  const defaultCover = "/default_img_dark.jpg"
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [artistNameText, setArtistNameText] = useState<string>("Unknown Artist")
  const bassDataRef = useBassReactive()
  const playbarMotionRef = useRef<HTMLDivElement | null>(null)
  const shakePatternCacheRef = useRef<Map<number, MicroJerkPattern>>(new Map())
  const eqFftStrokePathRef = useRef<SVGPathElement | null>(null)
  const eqFftFillPathRef = useRef<SVGPathElement | null>(null)
  const qualityRef = useRef(quality)
  const isPlayingRef = useRef(isPlaying)
  const currentTrackIdRef = useRef(currentTrackId)
  const eqBandsRef = useRef(
    activeBands.map((b) => ({
      frequency: b.frequency,
      gain: b.gain,
      q: b.q,
    }))
  )

  useEffect(() => {
    setIsTrackLoading(loadingState === 'loading' || loadingState === 'decoding')
  }, [loadingState])

  useEffect(() => {
    if (!isSeeking) setSeekPosition(currentTime)
  }, [currentTime, isSeeking])

  useEffect(() => {
    let rafId = 0
    let smoothMag = 0
    let smoothTransient = 0
    let smoothPitch = 0
    const motionEl = playbarMotionRef.current
    const patternCache = shakePatternCacheRef.current

    const tick = () => {
      const bass = bassDataRef.current
      const magnitude = clamp01(Number.isFinite(bass.magnitude) ? bass.magnitude : 0)
      const transient = clamp01(Number.isFinite(bass.transient) ? bass.transient : 0)
      const pitch = clamp01(Number.isFinite(bass.pitch) ? bass.pitch : 0)

      smoothMag += (magnitude - smoothMag) * (magnitude > smoothMag ? 0.35 : 0.1)
      smoothTransient += (transient - smoothTransient) * 0.32
      smoothPitch += (pitch - smoothPitch) * 0.22

      // Strong shake only on very low-bass hits; quieter for higher bass notes.
      const lowBassWeight = clamp01((0.35 - pitch) / 0.35)
      const lowBassFocus = lowBassWeight * lowBassWeight
      const transientPunch = Math.pow(clamp01(smoothTransient * 1.9), 1.7)
      const rumble = Math.pow(smoothMag, 2.1) * lowBassFocus
      const hugeHit = Math.pow(clamp01(smoothTransient * 2.4), 2.3) * lowBassFocus
      const shake = isPlaying && qualityRef.current !== "low" ? (transientPunch * (0.32 + lowBassFocus * 2.45) + rumble * 0.85 + hugeHit * 1.9) * 9.5 : 0

      if (motionEl) {
        const bucket = Math.max(0, Math.min(PLAYBAR_SHAKE_BUCKETS - 1, Math.floor(smoothPitch * (PLAYBAR_SHAKE_BUCKETS - 1))))
        let pattern = patternCache.get(bucket)
        if (!pattern) {
          pattern = buildPitchJerkPattern(bucket)
          patternCache.set(bucket, pattern)
        }

        const repeatBoost = 1 + clamp01(smoothTransient * 1.9 + lowBassFocus * 0.65) * 1.8
        const stepMs = Math.max(8, pattern.stepMs / repeatBoost)
        const cycleIdx = Math.floor(performance.now() / stepMs) % pattern.offsets.length
        const offset = pattern.offsets[cycleIdx]
        const tx = offset.x * shake
        const ty = offset.y * shake
        motionEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      if (motionEl) {
        motionEl.style.transform = ""
      }
    }
  }, [bassDataRef, isPlaying])

  useEffect(() => {
    if (error) showToast({ message: `Playback error: ${error}`, variant: "error" })
  }, [error, showToast])

  useEffect(() => {
    qualityRef.current = quality
  }, [quality])

  useEffect(() => {
    isPlayingRef.current = isPlaying
    currentTrackIdRef.current = currentTrackId
  }, [currentTrackId, isPlaying])

  useEffect(() => {
    eqBandsRef.current = activeBands.map((b) => ({
      frequency: b.frequency,
      gain: b.gain,
      q: b.q,
    }))
  }, [activeBands])

  useEffect(() => {
    const minLog = Math.log(20)
    const maxLog = Math.log(20000)
    const pointCount = PREVIEW_FFT_POINTS + 1
    const xPoints = new Float32Array(pointCount)
    const freqPoints = new Float32Array(pointCount)
    const display = new Float32Array(pointCount)
    const initialBands = eqBandsRef.current

    for (let i = 0; i < pointCount; i++) {
      const t = i / PREVIEW_FFT_POINTS
      xPoints[i] = t * PREVIEW_W
      const freq = Math.exp(minLog + t * (maxLog - minLog))
      freqPoints[i] = freq
      display[i] = getEqCurveTargetValue(freq, initialBands)
    }

    let freqBuffer: Float32Array | null = null
    let rafId = 0

    const tick = () => {
      const analyser = getAudioRouting().getAnalyserNode()
      const stroke = eqFftStrokePathRef.current
      const fill = eqFftFillPathRef.current

      if (!analyser || !stroke || !fill) {
        rafId = requestAnimationFrame(tick)
        return
      }

      const useLiveFFT = isPlayingRef.current && !!currentTrackIdRef.current
      const bands = eqBandsRef.current
      if (useLiveFFT && analyser.fftSize < PREVIEW_TARGET_FFT_SIZE) {
        analyser.fftSize = PREVIEW_TARGET_FFT_SIZE
      }

      if (useLiveFFT && (!freqBuffer || freqBuffer.length !== analyser.frequencyBinCount)) {
        freqBuffer = new Float32Array(analyser.frequencyBinCount)
      }

      if (useLiveFFT && freqBuffer) {
        analyser.getFloatFrequencyData(freqBuffer)
      }

      const dbRange = FFT_DB_CEIL - FFT_DB_FLOOR
      let path = ""

      for (let i = 0; i < pointCount; i++) {
        const freq = freqPoints[i]
        const x = xPoints[i]
        let target = getEqCurveTargetValue(freq, bands)

        if (useLiveFFT && freqBuffer) {
          const idx = Math.max(
            1,
            Math.min(freqBuffer.length - 2, Math.round((freq / (analyser.context.sampleRate * 0.5)) * (freqBuffer.length - 1)))
          )
          const db = (freqBuffer[idx - 1] + freqBuffer[idx] + freqBuffer[idx + 1]) / 3
          const norm = clamp01((Math.max(FFT_DB_FLOOR, db) - FFT_DB_FLOOR) / dbRange)
          target = Math.pow(norm, 0.92)
        }

        const prev = display[i]
        const blend = useLiveFFT ? (target > prev ? 0.64 : 0.22) : 0.11
        const value = prev + (target - prev) * blend
        display[i] = value
        const y = 1 + (1 - value) * (PREVIEW_H - 2)
        const point = `${x.toFixed(2)} ${y.toFixed(2)}`
        path += i === 0 ? `M ${point}` : ` L ${point}`
      }

      stroke.setAttribute("d", path)
      fill.setAttribute("d", `${path} L ${PREVIEW_W} ${PREVIEW_H - 1} L 0 ${PREVIEW_H - 1} Z`)

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    if (currentTrack) {
      if (currentTrack.artistId) {
        const artist = getArtistById(currentTrack.artistId)
        setArtistNameText(artist ? artist.name : "Unknown Artist")
      } else {
        setArtistNameText("Unknown Artist")
      }
      if (currentTrack.coverStorageKey) {
        fileStorage.getImageFileUrl(currentTrack.coverStorageKey)
          .then(url => setCoverImageUrl(url))
          .catch(() => setCoverImageUrl(null))
      } else {
        setCoverImageUrl(null)
      }
    }
  }, [currentTrack, getArtistById, getAlbumById])

  const handlePlay = useCallback(() => setIsPlaying(true), [setIsPlaying])
  const handlePause = useCallback(() => setIsPlaying(false), [setIsPlaying])

  const handleSkipForward = useCallback(() => {
    const allTracks = getTracks()
    if (!allTracks.length || !currentTrackId) return
    const idx = allTracks.findIndex(t => t.id === currentTrackId)
    setCurrentTrack(allTracks[(idx + 1) % allTracks.length].id)
  }, [getTracks, currentTrackId, setCurrentTrack])

  const handleSkipBack = useCallback(() => {
    const allTracks = getTracks()
    if (!allTracks.length || !currentTrackId) return
    const idx = allTracks.findIndex(t => t.id === currentTrackId)
    setCurrentTrack(allTracks[(idx - 1 + allTracks.length) % allTracks.length].id)
  }, [getTracks, currentTrackId, setCurrentTrack])

  const toggleMute = useCallback(() => setIsMuted(!isMuted), [setIsMuted, isMuted])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleProgressDrag = useCallback((value: number[]) => {
    if (!isSeeking) {
      setIsSeeking(true)
      wasPlayingRef.current = isPlaying
      if (isPlaying) setIsPlaying(false)
    }
    setSeekPosition(value[0])
  }, [isSeeking, isPlaying, setIsPlaying])

  const handleProgressCommit = useCallback((value: number[]) => {
    if (currentTrackId && duration > 0) {
      setIsSeeking(false)
      seekTo(value[0])
      if (wasPlayingRef.current) setTimeout(() => setIsPlaying(true), 100)
    }
  }, [currentTrackId, duration, seekTo, setIsPlaying])

  const handleVolumeChange = useCallback((value: number[]) => {
    setVolume(value[0] / 100)
    if (value[0] === 0) setIsMuted(true)
    else if (isMuted) setIsMuted(false)
  }, [setVolume, setIsMuted, isMuted])

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className={cn(
      "absolute bottom-4 left-4 right-16 z-40 max-w-2xl flex flex-col items-center transition-opacity duration-200",
      highlightTarget === "grid" && !isPlaying && "opacity-30"
    )}>
      {/* Main control bar */}
      <div ref={playbarMotionRef} className="w-full relative" style={{ willChange: "transform" }}>
        <div className="rounded-2xl overflow-hidden relative !border-0 bg-white/18 dark:bg-black/22 backdrop-blur-[8px]">
          {/* Top section: track info + transport */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-3 relative z-10">
            {/* Album art + track info — tap to open library */}
            <button
              type="button"
              onClick={onToggleLibrary}
              className={cn(
                "flex items-center gap-3 min-w-0 flex-1 rounded-lg -m-1.5 p-1.5 transition-colors dark:hover:bg-white/[0.04] hover:bg-black/[0.03] cursor-pointer text-left",
                highlightTarget === "music" && "ring-2 ring-cyan-400/80 animate-highlight-breathe shadow-[0_0_20px_rgba(34,211,238,0.5),0_0_40px_rgba(34,211,238,0.25)]"
              )}
              title="Open library"
            >
              {/* Album art */}
              <div className="flex-shrink-0">
                {isTrackLoading ? (
                  <div className="h-11 w-11 rounded-lg dark:bg-white/[0.06] bg-black/[0.06] animate-pulse" />
                ) : (
                  <div className="h-11 w-11 rounded-lg overflow-hidden relative shadow-lg shadow-black/20 ring-1 dark:ring-white/10 ring-black/5">
                    <Image src={coverImageUrl || defaultCover} alt="Cover" fill className="object-cover" unoptimized />
                  </div>
                )}
              </div>

              {/* Track info */}
              <div className="flex flex-col min-w-0 flex-1">
                {isTrackLoading ? (
                  <>
                    <div className="h-3.5 dark:bg-white/[0.08] bg-black/[0.08] rounded w-28 animate-pulse mb-1" />
                    <div className="h-2.5 dark:bg-white/[0.06] bg-black/[0.06] rounded w-20 animate-pulse" />
                  </>
                ) : currentTrack ? (
                  <>
                    <span className="text-[13px] font-semibold truncate dark:text-white/95 text-black/85 leading-tight">
                      {currentTrack.title}
                    </span>
                    <span className="text-[11px] truncate dark:text-white/45 text-black/45 leading-tight">
                      {artistNameText}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] dark:text-white/50 text-black/40">+ Add Music</span>
                )}
              </div>
            </button>

            {/* Transport controls */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                className="p-1.5 rounded-full dark:text-white/50 text-black/40 dark:hover:text-white/90 hover:text-black/80 dark:hover:bg-white/[0.06] hover:bg-black/[0.06] transition-all disabled:opacity-30"
                onClick={handleSkipBack}
                disabled={!currentTrackId}
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                className={cn(
                  "p-2 rounded-full transition-all",
                  isPlaying
                    ? "dark:text-cyan-300 text-cyan-600 dark:bg-cyan-400/10 bg-cyan-500/10"
                    : "dark:text-white/80 text-black/70 dark:hover:bg-white/[0.08] hover:bg-black/[0.08]",
                  (!currentTrackId && !isTrackLoading) && "opacity-30 pointer-events-none",
                  highlightTarget === "grid" && isPlaying && "animate-highlight-breathe dark:bg-cyan-400/30 bg-cyan-500/25 shadow-[0_0_16px_rgba(34,211,238,0.5),0_0_32px_rgba(34,211,238,0.25)]"
                )}
                onClick={isPlaying ? handlePause : handlePlay}
              >
                {isTrackLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-5 w-5" fill="currentColor" />
                ) : (
                  <Play className="h-5 w-5" fill="currentColor" />
                )}
              </button>
              <button
                className="p-1.5 rounded-full dark:text-white/50 text-black/40 dark:hover:text-white/90 hover:text-black/80 dark:hover:bg-white/[0.06] hover:bg-black/[0.06] transition-all disabled:opacity-30"
                onClick={handleSkipForward}
                disabled={!currentTrackId}
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-4 pb-2 flex items-center gap-2 relative z-10">
            <span className="text-[10px] w-8 text-right dark:text-white/40 text-black/40 tabular-nums font-medium">
              {formatTime(isSeeking ? seekPosition : currentTime)}
            </span>
            <Slider
              value={[isSeeking ? seekPosition : currentTime]}
              max={duration || 1}
              step={0.1}
              onValueChange={handleProgressDrag}
              onValueCommit={handleProgressCommit}
              className="flex-1"
              aria-label="Playback progress"
              disabled={!currentTrackId || duration === 0}
            />
            <span className="text-[10px] w-8 dark:text-white/40 text-black/40 tabular-nums font-medium">
              {formatTime(duration)}
            </span>
          </div>

          {/* Bottom toolbar: EQ / volume / library */}
          <div className="px-3 pb-2.5 pt-0.5 flex items-center justify-between relative z-10">
            {/* EQ inline strip: profiles + power + separator + curve preview */}
            <div className="flex items-center gap-1.5">
              <EQProfilePills size="sm" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setEQEnabled(!isEQEnabled)
                }}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  isEQEnabled
                    ? "text-teal-400 hover:text-teal-300"
                    : "dark:text-white/20 text-black/20 dark:hover:text-white/40 hover:text-black/40"
                )}
                title={isEQEnabled ? "Disable EQ" : "Enable EQ"}
              >
                <Power className="h-3.5 w-3.5" />
              </button>
              <div className="w-px h-4 dark:bg-white/10 bg-black/10 mx-0.5" />
              <button
                type="button"
                onClick={onToggleEQOverlay}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-xl transition-all group",
                  showEQOverlay
                    ? cn(pc.bgPanel, "ring-1", pc.ringPanel)
                    : "dark:hover:bg-white/[0.05] hover:bg-black/[0.04]",
                  highlightTarget === "eq" && "ring-2 ring-cyan-400/80 animate-highlight-breathe shadow-[0_0_20px_rgba(34,211,238,0.5),0_0_40px_rgba(34,211,238,0.25)]"
                )}
                title="Toggle EQ"
              >
                <svg
                  width={PREVIEW_W}
                  height={PREVIEW_H}
                  viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
                  className="overflow-visible hidden sm:block"
                >
                  {/* Zero line */}
                  <line
                    x1={0} y1={PREVIEW_H / 2} x2={PREVIEW_W} y2={PREVIEW_H / 2}
                    stroke="currentColor"
                    className="dark:text-white/10 text-black/10"
                    strokeWidth="0.75"
                  />
                  {/* EQ curve / FFT — morphs between them */}
                  <path
                    ref={eqFftFillPathRef}
                    d={previewPath + ` L ${PREVIEW_W} ${PREVIEW_H / 2} L 0 ${PREVIEW_H / 2} Z`}
                    fill="currentColor"
                    className={cn("transition-colors", pc.label)}
                    style={{ opacity: isEQEnabled ? 0.15 : 0.08 }}
                  />
                  <path
                    ref={eqFftStrokePathRef}
                    d={previewPath}
                    fill="none"
                    stroke="currentColor"
                    className={cn("transition-colors", pc.label)}
                    style={{ opacity: isEQEnabled ? 1 : 0.35 }}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {/* Pill label */}
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider transition-colors",
                  pc.label,
                  !isEQEnabled && "opacity-40"
                )}>
                  EQ
                </span>
              </button>
            </div>

            {/* Volume */}
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                className="p-1 rounded-md dark:text-white/40 text-black/35 dark:hover:text-white/70 hover:text-black/70 transition-colors"
                onClick={toggleMute}
              >
                <VolumeIcon className="h-3.5 w-3.5" />
              </button>
              <Slider
                value={[isMuted ? 0 : volume * 100]}
                max={100}
                step={1}
                onValueChange={handleVolumeChange}
                className="w-20"
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
