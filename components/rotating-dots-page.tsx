"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ArrowLeft, Pause, Play, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import * as rotatingDotsAudio from "@/lib/audio/rotatingDotsAudio"
import { resumeAudioContext } from "@/lib/audio/audioContext"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { cn } from "@/lib/utils"

const FREQUENCY_LABELS = [20000, 8000, 3000, 1000, 300, 100, 30]
const DOT_COLORS = ["#22d3ee", "#f472b6"] // cyan-400, pink-400
const DOT_NAMES = ["Dot 1", "Dot 2"]
const EDGE_SLOPES: rotatingDotsAudio.EdgeSlope[] = [12, 24, 48]
const ORBIT_SAMPLES = 72

function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`
  }
  return `${Math.round(hz)} Hz`
}

interface SliderControlProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function SliderControl({ label, value, display, min, max, step, onChange }: SliderControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-white/50">{label}</span>
        <span className="text-[10px] tabular-nums text-white/70">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(nextValue) => onChange(nextValue[0] ?? value)}
      />
    </div>
  )
}

interface DotRenderState {
  x: number
  y: number
  scale: number
  depthNorm: number
  gainDb: number
  lowerEdge: number
  upperEdge: number
  muted: boolean
  hitAge: number
}

interface OrbitSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  scale: number
}

type DragMode = "move" | "resize"

// Absolute distance (in stage units) from a point to the orbit ellipse,
// approximated by the ellipse point at the same parametric angle.
function distanceToOrbitRing(
  dx: number,
  dy: number,
  radius: number,
  tiltDegrees: number
): number {
  const rx = Math.max(0.01, radius * Math.cos((tiltDegrees * Math.PI) / 180))
  const ry = radius
  const phi = Math.atan2(dy / ry, dx / rx)
  return Math.hypot(dx - rx * Math.cos(phi), dy - ry * Math.sin(phi))
}

function radiusFromPointer(dx: number, dy: number, tiltDegrees: number): number {
  const cosTilt = Math.max(0.15, Math.cos((tiltDegrees * Math.PI) / 180))
  return Math.hypot(dx / cosTilt, dy)
}

export function RotatingDotsPage() {
  const setEQEnabled = useEQProfileStore((state) => state.setEQEnabled)

  const [isPlaying, setIsPlaying] = useState(false)
  const [rotationRate, setRotationRate] = useState(rotatingDotsAudio.DEFAULT_ROTATION_RATE_HZ)
  const [hitRate, setHitRate] = useState(rotatingDotsAudio.DEFAULT_HIT_RATE_HZ)
  const [radius, setRadius] = useState(rotatingDotsAudio.DEFAULT_RADIUS)
  const [tiltDegrees, setTiltDegrees] = useState(rotatingDotsAudio.DEFAULT_TILT_DEGREES)
  const [bandwidthOctaves, setBandwidthOctaves] = useState(rotatingDotsAudio.DEFAULT_BANDWIDTH_OCTAVES)
  const [volumeDepthDb, setVolumeDepthDb] = useState(rotatingDotsAudio.DEFAULT_VOLUME_DEPTH_DB)
  const [staggerPercent, setStaggerPercent] = useState(rotatingDotsAudio.DEFAULT_STAGGER_PERCENT)
  const [hitReleaseS, setHitReleaseS] = useState(rotatingDotsAudio.DEFAULT_HIT_RELEASE_S)
  const [edgeSlope, setEdgeSlope] = useState<rotatingDotsAudio.EdgeSlope>(rotatingDotsAudio.DEFAULT_EDGE_SLOPE)
  const [volumeDb, setVolumeDb] = useState(0)
  const [mutedDots, setMutedDots] = useState<boolean[]>(() => [...rotatingDotsAudio.DEFAULT_MUTED_DOTS])
  const [centerX, setCenterX] = useState(rotatingDotsAudio.DEFAULT_ORBIT_CENTER_X)
  const [centerY, setCenterY] = useState(rotatingDotsAudio.DEFAULT_ORBIT_CENTER_Y)
  const [dotStates, setDotStates] = useState<DotRenderState[]>([])
  const [orbitSegments, setOrbitSegments] = useState<OrbitSegment[]>([])
  const [hoverMode, setHoverMode] = useState<DragMode | null>(null)

  const animationFrameRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ mode: DragMode; grabDx: number; grabDy: number } | null>(null)

  useEffect(() => {
    setEQEnabled(true)
    return () => {
      rotatingDotsAudio.getRotatingDotsPlayer().stop()
    }
  }, [setEQEnabled])

  useEffect(() => {
    const player = rotatingDotsAudio.getRotatingDotsPlayer()
    player.setRotationRateHz(rotationRate)
    player.setHitRateHz(hitRate)
    player.setRadius(radius)
    player.setTiltDegrees(tiltDegrees)
    player.setBandwidthOctaves(bandwidthOctaves)
    player.setVolumeDepthDb(volumeDepthDb)
    player.setStaggerPercent(staggerPercent)
    player.setHitReleaseS(hitReleaseS)
    player.setEdgeSlope(edgeSlope)
    player.setVolumeDb(volumeDb)
    player.setOrbitCenter(centerX, centerY)
  }, [rotationRate, hitRate, radius, tiltDegrees, bandwidthOctaves, volumeDepthDb, staggerPercent, hitReleaseS, edgeSlope, volumeDb, centerX, centerY])

  // Orbit path only changes with radius/tilt; computed client-side because
  // the player owns the projection (and the AudioContext).
  useEffect(() => {
    const path = rotatingDotsAudio.getRotatingDotsPlayer().getOrbitPath(ORBIT_SAMPLES)
    const segments: OrbitSegment[] = []
    for (let i = 0; i < path.length - 1; i++) {
      segments.push({
        x1: path[i].x * 100,
        y1: (1 - path[i].y) * 100,
        x2: path[i + 1].x * 100,
        y2: (1 - path[i + 1].y) * 100,
        scale: (path[i].scale + path[i + 1].scale) / 2,
      })
    }
    setOrbitSegments(segments)
  }, [radius, tiltDegrees, centerX, centerY])

  const updateVisuals = useCallback(() => {
    const player = rotatingDotsAudio.getRotatingDotsPlayer()
    setDotStates(
      player.getDotVisualStates().map((state) => ({
        x: state.x,
        y: state.y,
        scale: state.scale,
        depthNorm: state.depthNorm,
        gainDb: state.gainDb,
        lowerEdge: state.band.lowerEdge,
        upperEdge: state.band.upperEdge,
        muted: state.muted,
        hitAge: state.hitAge,
      }))
    )
    animationFrameRef.current = requestAnimationFrame(updateVisuals)
  }, [])

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(updateVisuals)
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [updateVisuals])

  const togglePlayback = useCallback(async () => {
    const player = rotatingDotsAudio.getRotatingDotsPlayer()
    if (player.isPlaying()) {
      player.stop()
      setIsPlaying(false)
      return
    }
    await resumeAudioContext()
    player.start()
    setIsPlaying(true)
  }, [])

  const getStagePoint = useCallback((event: ReactPointerEvent) => {
    const stage = stageRef.current
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    return {
      nx: (event.clientX - rect.left) / rect.width,
      ny: 1 - (event.clientY - rect.top) / rect.height,
    }
  }, [])

  const hitTestOrbit = useCallback(
    (nx: number, ny: number): DragMode | null => {
      const dx = nx - centerX
      const dy = ny - centerY
      if (distanceToOrbitRing(dx, dy, radius, tiltDegrees) < 0.045) return "resize"
      const insideT = radiusFromPointer(dx, dy, tiltDegrees) / radius
      if (insideT < 0.85) return "move"
      return null
    },
    [centerX, centerY, radius, tiltDegrees]
  )

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = getStagePoint(event)
      if (!point) return
      const mode = hitTestOrbit(point.nx, point.ny)
      if (!mode) return
      dragRef.current = {
        mode,
        grabDx: point.nx - centerX,
        grabDy: point.ny - centerY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [getStagePoint, hitTestOrbit, centerX, centerY]
  )

  const handleStagePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = getStagePoint(event)
      if (!point) return
      const drag = dragRef.current
      if (!drag) {
        setHoverMode(hitTestOrbit(point.nx, point.ny))
        return
      }
      if (drag.mode === "move") {
        setCenterX(Math.min(0.95, Math.max(0.05, point.nx - drag.grabDx)))
        setCenterY(Math.min(0.95, Math.max(0.05, point.ny - drag.grabDy)))
      } else {
        const nextRadius = radiusFromPointer(point.nx - centerX, point.ny - centerY, tiltDegrees)
        setRadius(
          Math.min(
            rotatingDotsAudio.MAX_RADIUS,
            Math.max(rotatingDotsAudio.MIN_RADIUS, nextRadius)
          )
        )
      }
    },
    [getStagePoint, hitTestOrbit, centerX, centerY, tiltDegrees]
  )

  const handleStagePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      dragRef.current = null
    }
  }, [])

  const toggleMute = useCallback((index: number) => {
    setMutedDots((previous) => {
      const next = [...previous]
      next[index] = !next[index]
      rotatingDotsAudio.getRotatingDotsPlayer().setDotMuted(index, next[index])
      return next
    })
  }, [])

  // Far dots draw first so near dots overlap them.
  const drawOrder = dotStates
    .map((dot, index) => ({ dot, index }))
    .sort((a, b) => a.dot.scale - b.dot.scale)

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold tracking-wide">Rotating Dots</h1>
            <p className="text-[11px] text-white/50">
              Staggered wide-band noise hits · height = band shift · depth = volume
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={isPlaying ? "secondary" : "default"}
          onClick={togglePlayback}
          className="gap-2"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {isPlaying ? "Stop" : "Play"}
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6 lg:flex-row">
        <section className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-[640px] items-stretch gap-3">
            <div className="flex flex-col justify-between py-1 text-right">
              {FREQUENCY_LABELS.map((hz) => (
                <span key={hz} className="text-[10px] tabular-nums text-white/35">
                  {formatFrequency(hz)}
                </span>
              ))}
            </div>
            <div
              ref={stageRef}
              className={cn(
                "relative aspect-square w-full touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-neutral-900",
                hoverMode === "move" && "cursor-move",
                hoverMode === "resize" && "cursor-nwse-resize"
              )}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
              onPointerLeave={() => setHoverMode(null)}
            >
              <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
                {/* Orbit path, faded with depth so the tilt reads as 3D */}
                {orbitSegments.map((segment, index) => {
                  const depthT = Math.max(0, Math.min(1, (segment.scale - 0.8) / 0.5))
                  return (
                    <line
                      key={index}
                      x1={segment.x1}
                      y1={segment.y1}
                      x2={segment.x2}
                      y2={segment.y2}
                      stroke="white"
                      strokeWidth={0.25 + depthT * 0.45}
                      opacity={0.06 + depthT * 0.24}
                    />
                  )
                })}

                {/* Listener marker (stage center) */}
                <line x1={48} y1={50} x2={52} y2={50} stroke="rgba(255,255,255,0.2)" strokeWidth={0.3} />
                <line x1={50} y1={48} x2={50} y2={52} stroke="rgba(255,255,255,0.2)" strokeWidth={0.3} />

                {/* Orbit center (drag inside the ring to move the orbit) */}
                <circle
                  cx={centerX * 100}
                  cy={(1 - centerY) * 100}
                  r={0.9}
                  fill="rgba(255,255,255,0.3)"
                />

                {/* Resize handles at the ring extremes */}
                {[0, 18, 36, 54].map((segmentIndex) => {
                  const segment = orbitSegments[segmentIndex]
                  if (!segment) return null
                  return (
                    <rect
                      key={segmentIndex}
                      x={segment.x1 - 0.9}
                      y={segment.y1 - 0.9}
                      width={1.8}
                      height={1.8}
                      fill="rgba(255,255,255,0.4)"
                    />
                  )
                })}

                {drawOrder.map(({ dot, index }) => {
                  const cx = dot.x * 100
                  const cy = (1 - dot.y) * 100
                  const color = DOT_COLORS[index % DOT_COLORS.length]
                  // Exaggerate perspective so near/far reads instantly
                  const perspective = Math.pow(dot.scale, 2.5)
                  const baseRadius = 2.2 * perspective
                  const pulse = Math.max(0, 1 - Math.min(dot.hitAge, 1))
                  const depthOpacity = 0.3 + 0.7 * Math.max(0, Math.min(1, (dot.scale - 0.75) / 0.55))
                  return (
                    <g
                      key={index}
                      onClick={() => toggleMute(index)}
                      onPointerDown={(event) => event.stopPropagation()}
                      className="cursor-pointer"
                    >
                      {/* Hit pulse ring */}
                      {pulse > 0 && !dot.muted && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={baseRadius + (1 - pulse) * 6 * perspective}
                          fill="none"
                          stroke={color}
                          strokeWidth={0.4}
                          opacity={pulse * 0.7 * depthOpacity}
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={baseRadius + pulse * 0.8}
                        fill={dot.muted ? "transparent" : color}
                        stroke={color}
                        strokeWidth={dot.muted ? 0.5 : 0}
                        strokeDasharray={dot.muted ? "1.2 1.2" : undefined}
                        opacity={dot.muted ? 0.35 : depthOpacity}
                      />
                    </g>
                  )
                })}
              </svg>

              <div className="pointer-events-none absolute left-2 top-2 text-[9px] text-white/30">
                drag inside to move · drag the ring to resize
              </div>

              {/* Per-dot readouts */}
              <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-between text-[9px] tabular-nums">
                {dotStates.map((dot, index) => (
                  <span key={index} style={{ color: DOT_COLORS[index % DOT_COLORS.length] + "99" }}>
                    {DOT_NAMES[index]}
                    {dot.muted
                      ? " · muted"
                      : ` · ${formatFrequency(dot.lowerEdge)}–${formatFrequency(dot.upperEdge)} · ${dot.gainDb.toFixed(1)} dB`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="w-full space-y-5 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 lg:w-72">
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-white/50">Dots</span>
            <div className="flex gap-1.5">
              {DOT_NAMES.map((name, index) => {
                const muted = mutedDots[index]
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleMute(index)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] transition",
                      muted
                        ? "border-white/10 bg-transparent text-white/40"
                        : "border-white/25 bg-white/10 text-white"
                    )}
                    style={{ color: muted ? undefined : DOT_COLORS[index] }}
                  >
                    {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    {name}
                  </button>
                )
              })}
            </div>
          </div>
          <SliderControl
            label="Rotation speed"
            value={rotationRate}
            display={`${rotationRate.toFixed(3)} rev/s`}
            min={rotatingDotsAudio.MIN_ROTATION_RATE_HZ}
            max={rotatingDotsAudio.MAX_ROTATION_RATE_HZ}
            step={0.005}
            onChange={setRotationRate}
          />
          <SliderControl
            label="Hit rate (per dot)"
            value={hitRate}
            display={`${hitRate.toFixed(2)} /s`}
            min={rotatingDotsAudio.MIN_HIT_RATE_HZ}
            max={rotatingDotsAudio.MAX_HIT_RATE_HZ}
            step={0.25}
            onChange={setHitRate}
          />
          <SliderControl
            label="Stagger"
            value={staggerPercent}
            display={`${staggerPercent.toFixed(0)}%`}
            min={0}
            max={100}
            step={5}
            onChange={setStaggerPercent}
          />
          <SliderControl
            label="Bandwidth"
            value={bandwidthOctaves}
            display={`${bandwidthOctaves.toFixed(1)} oct`}
            min={rotatingDotsAudio.MIN_BANDWIDTH_OCTAVES}
            max={rotatingDotsAudio.MAX_BANDWIDTH_OCTAVES}
            step={0.25}
            onChange={setBandwidthOctaves}
          />
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-white/50">Edge slope</span>
            <div className="flex gap-1.5">
              {EDGE_SLOPES.map((slope) => (
                <button
                  key={slope}
                  type="button"
                  onClick={() => setEdgeSlope(slope)}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[10px] tabular-nums transition",
                    edgeSlope === slope
                      ? "border-white/40 bg-white/15 text-white"
                      : "border-white/10 bg-transparent text-white/50 hover:bg-white/5"
                  )}
                >
                  {slope} dB/oct
                </button>
              ))}
            </div>
          </div>
          <SliderControl
            label="Tilt"
            value={tiltDegrees}
            display={`${tiltDegrees.toFixed(0)}°`}
            min={rotatingDotsAudio.MIN_TILT_DEGREES}
            max={rotatingDotsAudio.MAX_TILT_DEGREES}
            step={1}
            onChange={setTiltDegrees}
          />
          <SliderControl
            label="Depth volume"
            value={volumeDepthDb}
            display={`${volumeDepthDb.toFixed(0)} dB`}
            min={rotatingDotsAudio.MIN_VOLUME_DEPTH_DB}
            max={rotatingDotsAudio.MAX_VOLUME_DEPTH_DB}
            step={1}
            onChange={setVolumeDepthDb}
          />
          <SliderControl
            label="Hit release"
            value={hitReleaseS}
            display={`${Math.round(hitReleaseS * 1000)} ms`}
            min={rotatingDotsAudio.MIN_HIT_RELEASE_S}
            max={rotatingDotsAudio.MAX_HIT_RELEASE_S}
            step={0.01}
            onChange={setHitReleaseS}
          />
          <SliderControl
            label="Volume"
            value={volumeDb}
            display={`${volumeDb > 0 ? "+" : ""}${volumeDb.toFixed(0)} dB`}
            min={-36}
            max={12}
            step={1}
            onChange={setVolumeDb}
          />
        </aside>
      </main>
    </div>
  )
}
