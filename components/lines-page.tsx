"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Pause, Play, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { LinePlayer, Line3DClickTrainPlayer, GridPlayer, type LinePoint, type GridRect, type GridSize, type GridReadingOrder } from "@/lib/audio/linePlayer"

const CANVAS_ASPECT = 16 / 9
const BURST_DOT_RADIUS = 5
const HANDLE_RADIUS = 10
const CENTROID_RADIUS = 8
const GRID_DOT_RADIUS = 7
const HANDLE_HIT_RADIUS = 22
const CENTROID_HIT_RADIUS = 20
const ANIM_FPS = 30
const DOUBLE_CLICK_MS = 350
const DEFAULT_HIT_RELEASE = 0.07
const DEFAULT_DEPTH = 1
const DEFAULT_LINE_3D_RATE = 1.4
const DEFAULT_MASTER_GAIN_DB = 0
const DEFAULT_MASTER_GAIN_OSC_AMOUNT_DB = 0
const DEFAULT_MASTER_GAIN_OSC_RATE_HZ = 1
const MIN_POINT_GAIN_DB = -60
const MAX_POINT_GAIN_DB = 24
const DEFAULT_POINT_GAIN_DB = 0

// ── per-group colors ────────────────────────────────────────────────────
const GROUP_COLORS = [
  { r: 103, g: 232, b: 249 },
  { r: 167, g: 139, b: 250 },
  { r: 52, g: 211, b: 153 },
  { r: 250, g: 204, b: 21 },
  { r: 244, g: 114, b: 182 },
  { r: 251, g: 146, b: 60 },
]

function gc(groupIdx: number) {
  const c = GROUP_COLORS[groupIdx % GROUP_COLORS.length]
  return { ...c, rgb: `${c.r},${c.g},${c.b}` }
}

// ── types ───────────────────────────────────────────────────────────────
interface LineGroupData {
  id: number
  type: "line"
  vertices: LinePoint[]
}

interface Line3DGroupData {
  id: number
  type: "line3d"
  vertices: LinePoint[]
}

interface GridGroupData {
  id: number
  type: "grid"
  rect: GridRect
  size: GridSize
  readingOrder: GridReadingOrder
}

type LineLikeGroupData = LineGroupData | Line3DGroupData
type Group = LineGroupData | Line3DGroupData | GridGroupData

type DragTarget =
  | { type: "vertex"; groupId: number; vertexIdx: number }
  | { type: "centroid"; groupId: number; anchorPointer: LinePoint; anchorVertices: LinePoint[] }
  | { type: "gridCenter"; groupId: number; anchorPointer: LinePoint; anchorRect: GridRect }
  | { type: "gridCorner"; groupId: number; cornerIdx: number; anchorPointer: LinePoint; anchorRect: GridRect }
  | null

let nextGroupId = 2

function isLineLikeGroup(group: Group): group is LineLikeGroupData {
  return group.type === "line" || group.type === "line3d"
}

export function LinesPage() {
  // ── shared audio context ──────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null)
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    return audioCtxRef.current
  }

  const linePlayersRef = useRef<Map<number, LinePlayer>>(new Map())
  const line3DPlayersRef = useRef<Map<number, Line3DClickTrainPlayer>>(new Map())
  const gridPlayersRef = useRef<Map<number, GridPlayer>>(new Map())

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animFrameRef = useRef<number | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [groups, setGroups] = useState<Group[]>([
    {
      id: 1,
      type: "line3d",
      vertices: [
        { x: 0.28, y: 0.38, depth: 0, gainDb: DEFAULT_POINT_GAIN_DB },
        { x: 0.72, y: 0.62, depth: 0.65, gainDb: DEFAULT_POINT_GAIN_DB },
      ],
    },
  ])
  const [activeGroupId, setActiveGroupId] = useState(1)
  const [stepInterval, setStepInterval] = useState(40)
  const steps = 32
  const [bandwidth, setBandwidth] = useState(6)
  const [hitRelease, setHitRelease] = useState(DEFAULT_HIT_RELEASE)
  const depth = DEFAULT_DEPTH
  const [line3DRate, setLine3DRate] = useState(DEFAULT_LINE_3D_RATE)
  const [volume, setVolume] = useState(1)
  const [masterGainDb, setMasterGainDb] = useState(DEFAULT_MASTER_GAIN_DB)
  const [masterGainOscAmountDb, setMasterGainOscAmountDb] = useState(DEFAULT_MASTER_GAIN_OSC_AMOUNT_DB)
  const [masterGainOscRateHz, setMasterGainOscRateHz] = useState(DEFAULT_MASTER_GAIN_OSC_RATE_HZ)
  const [error, setError] = useState<string | null>(null)
  const [currentTs, setCurrentTs] = useState<Map<number, number>>(new Map())
  const [currentLine3DTs, setCurrentLine3DTs] = useState<Map<number, number>>(new Map())
  const [currentGridDots, setCurrentGridDots] = useState<Map<number, number>>(new Map())
  const [selectedNode, setSelectedNode] = useState<{ groupId: number; idx: number } | null>(null)
  const [checkerboard, setCheckerboard] = useState(false)
  const [checkerboardVolumeDiff, setCheckerboardVolumeDiff] = useState(8)
  const [checkerboardOscillate, setCheckerboardOscillate] = useState(true)
  const [checkerboardOscillateMode, setCheckerboardOscillateMode] = useState<"continuous" | "instant">("continuous")
  const [checkerboardOscillatePeriod, setCheckerboardOscillatePeriod] = useState(4000)
  const [checkerboardSwitchMode, setCheckerboardSwitchMode] = useState<"auto" | "manual">("auto")
  const [simultaneous, setSimultaneous] = useState(false)
  const [diagonalDiff, setDiagonalDiff] = useState(false)
  const [diagonalDiffDb, setDiagonalDiffDb] = useState(0)
  const [slopeDbPerOct, setSlopeDbPerOct] = useState<-3.0 | -4.5>(-4.5)
  const [activeCheckerboardGroups, setActiveCheckerboardGroups] = useState<Map<number, { group: number; groups: [number[], number[]]; offsetsDb: Map<number, number>; diagonalDiff?: boolean }>>(new Map())

  const dragTarget = useRef<DragTarget>(null)
  const lastPointerDownTime = useRef(0)
  const lastPointerDownKey = useRef<string | null>(null)

  // ── ensure players ────────────────────────────────────────────────────
  function ensureLinePlayer(groupId: number): LinePlayer {
    let player = linePlayersRef.current.get(groupId)
    if (!player) {
      const ctx = getAudioCtx()
      player = new LinePlayer(ctx, ctx.destination)
      linePlayersRef.current.set(groupId, player)
    }
    return player
  }

  function ensureLine3DPlayer(groupId: number): Line3DClickTrainPlayer {
    let player = line3DPlayersRef.current.get(groupId)
    if (!player) {
      const ctx = getAudioCtx()
      player = new Line3DClickTrainPlayer(ctx, ctx.destination)
      line3DPlayersRef.current.set(groupId, player)
    }
    return player
  }

  function ensureGridPlayer(groupId: number): GridPlayer {
    let player = gridPlayersRef.current.get(groupId)
    if (!player) {
      const ctx = getAudioCtx()
      player = new GridPlayer(ctx, ctx.destination)
      gridPlayersRef.current.set(groupId, player)
    }
    return player
  }

  // ── keep players in sync ──────────────────────────────────────────────
  useEffect(() => {
    const activeLineIds = new Set<number>()
    const activeLine3DIds = new Set<number>()
    const activeGridIds = new Set<number>()

    for (const g of groups) {
      if (g.type === "line") {
        activeLineIds.add(g.id)
        const p = ensureLinePlayer(g.id)
        p.setPoints(g.vertices)
      } else if (g.type === "line3d") {
        activeLine3DIds.add(g.id)
        const p = ensureLine3DPlayer(g.id)
        p.setPoints(g.vertices)
      } else {
        activeGridIds.add(g.id)
        const p = ensureGridPlayer(g.id)
        p.setGridSize(g.size)
        p.setReadingOrder(g.readingOrder)
        p.setRect(g.rect)
      }
    }

    for (const [id, p] of linePlayersRef.current) {
      if (!activeLineIds.has(id)) { void p.destroy(); linePlayersRef.current.delete(id) }
    }
    for (const [id, p] of line3DPlayersRef.current) {
      if (!activeLine3DIds.has(id)) { void p.destroy(); line3DPlayersRef.current.delete(id) }
    }
    for (const [id, p] of gridPlayersRef.current) {
      if (!activeGridIds.has(id)) { void p.destroy(); gridPlayersRef.current.delete(id) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setStepInterval(stepInterval)
    for (const [, p] of line3DPlayersRef.current) p.setHitInterval(stepInterval)
    for (const [, p] of gridPlayersRef.current) p.setStepInterval(stepInterval)
  }, [stepInterval])

  useEffect(() => {
    for (const [, p] of line3DPlayersRef.current) p.setTravelRate(line3DRate)
  }, [line3DRate])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setSteps(steps)
  }, [steps])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setBandwidth(bandwidth)
    for (const [, p] of line3DPlayersRef.current) p.setBandwidth(bandwidth)
    for (const [, p] of gridPlayersRef.current) p.setBandwidth(bandwidth)
  }, [bandwidth])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setHitRelease(hitRelease)
    for (const [, p] of line3DPlayersRef.current) p.setHitRelease(hitRelease)
    for (const [, p] of gridPlayersRef.current) p.setHitRelease(hitRelease)
  }, [hitRelease])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setDepth(depth)
    for (const [, p] of gridPlayersRef.current) p.setDepth(depth)
  }, [depth])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setVolume(volume)
    for (const [, p] of line3DPlayersRef.current) p.setVolume(volume)
    for (const [, p] of gridPlayersRef.current) p.setVolume(volume)
  }, [volume])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setMasterGainDb(masterGainDb)
    for (const [, p] of line3DPlayersRef.current) p.setMasterGainDb(masterGainDb)
  }, [masterGainDb])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setMasterGainOscillationAmountDb(masterGainOscAmountDb)
    for (const [, p] of line3DPlayersRef.current) p.setMasterGainOscillationAmountDb(masterGainOscAmountDb)
  }, [masterGainOscAmountDb])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) p.setMasterGainOscillationRateHz(masterGainOscRateHz)
    for (const [, p] of line3DPlayersRef.current) p.setMasterGainOscillationRateHz(masterGainOscRateHz)
  }, [masterGainOscRateHz])

  useEffect(() => {
    for (const [, p] of linePlayersRef.current) void p.setSlope(slopeDbPerOct)
    for (const [, p] of line3DPlayersRef.current) p.setSlope(slopeDbPerOct)
    for (const [, p] of gridPlayersRef.current) void p.setSlope(slopeDbPerOct)
  }, [slopeDbPerOct])

  useEffect(() => {
    for (const [, p] of gridPlayersRef.current) {
      p.setCheckerboard(checkerboard)
      p.setCheckerboardVolumeDiff(checkerboardVolumeDiff)
      p.setCheckerboardOscillate(checkerboardOscillate)
      p.setCheckerboardOscillatePeriod(checkerboardOscillatePeriod)
      p.setCheckerboardOscillateMode(checkerboardOscillateMode)
      p.setCheckerboardSwitchMode(checkerboardSwitchMode)
      p.setSimultaneous(simultaneous)
      p.setDiagonalDiff(diagonalDiff)
      p.setDiagonalDiffDb(diagonalDiffDb)
    }
  }, [checkerboard, checkerboardVolumeDiff, checkerboardOscillate, checkerboardOscillatePeriod, checkerboardOscillateMode, checkerboardSwitchMode, simultaneous, diagonalDiff, diagonalDiffDb])

  // ── cleanup ───────────────────────────────────────────────────────────
  useEffect(() => {
    const linePlayers = linePlayersRef.current
    const line3DPlayers = line3DPlayersRef.current
    const gridPlayers = gridPlayersRef.current

    return () => {
      for (const [, p] of linePlayers) void p.destroy()
      for (const [, p] of line3DPlayers) void p.destroy()
      for (const [, p] of gridPlayers) void p.destroy()
      linePlayers.clear()
      line3DPlayers.clear()
      gridPlayers.clear()
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
      if (audioCtxRef.current?.state === "running") void audioCtxRef.current.suspend()
    }
  }, [])

  // ── animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return
    let lastTime = 0
    const interval = 1000 / ANIM_FPS
    function loop(ts: number) {
      if (ts - lastTime >= interval) {
        lastTime = ts
        const map = new Map<number, number>()
        for (const [id, p] of linePlayersRef.current) {
          map.set(id, p.getCurrentNormalizedStep())
        }
        const line3DMap = new Map<number, number>()
        for (const [id, p] of line3DPlayersRef.current) {
          line3DMap.set(id, p.getCurrentT())
        }
        const gridMap = new Map<number, number>()
        const cbMap = new Map<number, { group: number; groups: [number[], number[]]; offsetsDb: Map<number, number>; diagonalDiff?: boolean }>()
        for (const [id, p] of gridPlayersRef.current) {
          gridMap.set(id, p.getCurrentDotIndex())
          if (p.getCheckerboard() || p.getDiagonalDiff()) {
            cbMap.set(id, {
              group: p.getActiveCheckerboardGroup(),
              groups: p.getCheckerboardGroups(),
              offsetsDb: p.getCheckerboardDotOffsetsDb(),
              diagonalDiff: p.getDiagonalDiff() && !p.getCheckerboard(),
            })
          }
        }
        setCurrentTs(map)
        setCurrentLine3DTs(line3DMap)
        setCurrentGridDots(gridMap)
        setActiveCheckerboardGroups(cbMap)
      }
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying])

  // ── helpers ───────────────────────────────────────────────────────────
  function centroid(verts: LinePoint[]): LinePoint {
    let sx = 0, sy = 0
    for (const v of verts) { sx += v.x; sy += v.y }
    return { x: sx / verts.length, y: sy / verts.length }
  }

  function gridCorners(r: GridRect): LinePoint[] {
    return [
      { x: r.cx - r.hw, y: r.cy - r.hh },
      { x: r.cx + r.hw, y: r.cy - r.hh },
      { x: r.cx - r.hw, y: r.cy + r.hh },
      { x: r.cx + r.hw, y: r.cy + r.hh },
    ]
  }

  function gridDots(r: GridRect, size: GridSize, readingOrder: GridReadingOrder): LinePoint[] {
    const pts: LinePoint[] = []
    const { rows, cols } = size

    const pointFor = (row: number, col: number): LinePoint => {
      const tx = cols > 1 ? col / (cols - 1) : 0.5
      const ty = rows > 1 ? row / (rows - 1) : 0.5
      return {
        x: Math.max(0, Math.min(1, r.cx - r.hw + tx * r.hw * 2)),
        y: Math.max(0, Math.min(1, r.cy - r.hh + ty * r.hh * 2)),
      }
    }

    if (readingOrder === "rows") {
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          pts.push(pointFor(row, col))
        }
      }
    } else {
      for (let col = 0; col < cols; col++) {
        for (let row = rows - 1; row >= 0; row--) {
          pts.push(pointFor(row, col))
        }
      }
    }

    return pts
  }

  function formatSeconds(seconds: number): string {
    return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`
  }

  function formatDb(db: number): string {
    if (db <= MIN_POINT_GAIN_DB) return "Off"
    if (db === 0) return "0 dB"
    return `${db > 0 ? "+" : ""}${db} dB`
  }

  function formatOscAmountDb(db: number): string {
    return db <= 0 ? "Off" : `±${db} dB`
  }

  function formatHz(rateHz: number): string {
    return `${rateHz < 10 ? rateHz.toFixed(2) : rateHz.toFixed(1)} Hz`
  }

  const activeGroup = groups.find(g => g.id === activeGroupId)
  const activeGridGroup = activeGroup?.type === "grid" ? activeGroup : null
  const activeLine3DGroup = activeGroup?.type === "line3d"
    ? activeGroup
    : groups.find((g): g is Line3DGroupData => g.type === "line3d") ?? null
  const activeLine3DIndex = activeLine3DGroup
    ? groups.findIndex(g => g.id === activeLine3DGroup.id)
    : -1

  // ── canvas rendering ──────────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = rect.width
    const h = Math.round(w / CANVAS_ASPECT)

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // background grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)"
    ctx.lineWidth = 1
    for (let i = 1; i < 8; i += 1) {
      const gx = (i / 8) * w
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke()
    }
    for (let i = 1; i < 5; i += 1) {
      const gy = (i / 5) * h
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke()
    }

    // axis labels
    ctx.fillStyle = "rgba(255,255,255,0.25)"
    ctx.font = "10px sans-serif"
    ctx.textAlign = "center"
    ctx.fillText("L", 12, h / 2 + 3)
    ctx.fillText("R", w - 12, h / 2 + 3)
    ctx.fillText("High", w / 2, 14)
    ctx.fillText("Low", w / 2, h - 6)

    const toScreen = (p: LinePoint) => ({ sx: p.x * w, sy: (1 - p.y) * h })

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]
      const color = gc(gi)
      const isActive = group.id === activeGroupId

      if (group.type === "line" || group.type === "line3d") {
        drawLineGroup(ctx, group, color, isActive, w, h, toScreen)
      } else {
        drawGridGroup(ctx, group, color, isActive, w, h, toScreen, activeCheckerboardGroups.get(group.id))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, activeGroupId, isPlaying, currentTs, currentLine3DTs, currentGridDots, selectedNode, activeCheckerboardGroups])

  function drawLineGroup(
    ctx: CanvasRenderingContext2D,
    group: LineLikeGroupData,
    color: { rgb: string },
    isActive: boolean,
    _w: number,
    _h: number,
    toScreen: (p: LinePoint) => { sx: number; sy: number },
  ) {
    const verts = group.vertices
    const is3DLine = group.type === "line3d"
    const lineAlpha = isActive ? 0.5 : 0.25
    ctx.strokeStyle = `rgba(${color.rgb},${lineAlpha})`
    ctx.lineWidth = is3DLine ? (isActive ? 3 : 2) : (isActive ? 2 : 1.5)
    ctx.setLineDash(is3DLine ? [] : [6, 4])
    ctx.beginPath()
    const first = toScreen(verts[0])
    ctx.moveTo(first.sx, first.sy)
    for (let i = 1; i < verts.length; i++) {
      const p = toScreen(verts[i])
      ctx.lineTo(p.sx, p.sy)
    }
    ctx.stroke()
    ctx.setLineDash([])

    for (let i = 0; i < verts.length; i++) {
      const p = toScreen(verts[i])
      const nodeGain = is3DLine
        ? Math.max(0, Math.min(1, ((verts[i].gainDb ?? DEFAULT_POINT_GAIN_DB) - MIN_POINT_GAIN_DB) / (MAX_POINT_GAIN_DB - MIN_POINT_GAIN_DB)))
        : verts[i].gain ?? 1
      const nodeDepth = verts[i].depth ?? 0
      const isDragging = dragTarget.current?.type === "vertex" &&
        dragTarget.current.groupId === group.id &&
        dragTarget.current.vertexIdx === i
      const isSel = selectedNode?.groupId === group.id && selectedNode?.idx === i
      drawHandle(ctx, p.sx, p.sy, isDragging, isSel, nodeGain, color.rgb, isActive, is3DLine ? nodeDepth : undefined)
    }

    const c = centroid(verts)
    const cs = toScreen(c)
    const isCentroidDrag = dragTarget.current?.type === "centroid" &&
      dragTarget.current.groupId === group.id
    drawCentroidDiamond(ctx, cs.sx, cs.sy, color.rgb, isActive, isCentroidDrag)

    if (isPlaying) {
      const t = is3DLine ? currentLine3DTs.get(group.id) ?? 0 : currentTs.get(group.id) ?? 0
      const bs = toScreen(interpolatePolyline(verts, t))

      const grad = ctx.createRadialGradient(bs.sx, bs.sy, 0, bs.sx, bs.sy, BURST_DOT_RADIUS * 4)
      grad.addColorStop(0, `rgba(${color.rgb},0.55)`)
      grad.addColorStop(1, `rgba(${color.rgb},0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(bs.sx, bs.sy, BURST_DOT_RADIUS * 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = `rgba(${color.rgb},1)`
      ctx.beginPath()
      ctx.arc(bs.sx, bs.sy, BURST_DOT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function drawGridGroup(
    ctx: CanvasRenderingContext2D,
    group: GridGroupData,
    color: { rgb: string },
    isActive: boolean,
    _w: number,
    _h: number,
    toScreen: (p: LinePoint) => { sx: number; sy: number },
    cbInfo?: { group: number; groups: [number[], number[]]; offsetsDb: Map<number, number>; diagonalDiff?: boolean },
  ) {
    const corners = gridCorners(group.rect)
    const screenCorners = corners.map(toScreen)
    const dots = gridDots(group.rect, group.size, group.readingOrder)
    const screenDots = dots.map(toScreen)
    const alpha = isActive ? 0.35 : 0.15
    const isPlayingNow = isPlaying
    const activeDotIndex = isPlayingNow ? currentGridDots.get(group.id) ?? 0 : -1

    // checkerboard active dot set — in diagonal-diff mode all dots remain fully active.
    const cbActiveDots = cbInfo && !cbInfo.diagonalDiff ? new Set(cbInfo.groups[cbInfo.group]) : null

    // bounding box
    ctx.strokeStyle = `rgba(${color.rgb},${alpha})`
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(screenCorners[0].sx, screenCorners[0].sy) // BL
    ctx.lineTo(screenCorners[1].sx, screenCorners[1].sy) // BR
    ctx.lineTo(screenCorners[3].sx, screenCorners[3].sy) // TR
    ctx.lineTo(screenCorners[2].sx, screenCorners[2].sy) // TL
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])

    for (let i = 0; i < screenDots.length; i++) {
      const s = screenDots[i]
      const isSequentialDot = i === activeDotIndex
      const isCbActive = cbActiveDots ? cbActiveDots.has(i) : true
      const cbDim = isCbActive ? 1 : 0.2

      // Per-dot offset in dB (from oscillation/volume-diff); undefined = not applicable.
      const offsetDb = cbInfo?.offsetsDb.get(i)
      // Size/brightness scale based on offset: +24 dB → ~1.6x, -24 dB → ~0.5x.
      const offsetFactor = offsetDb !== undefined ? Math.pow(2, offsetDb / 24) : 1

      const dotAlpha = (isSequentialDot
        ? (isActive ? 1 : 0.75)
        : (isActive ? 0.45 : 0.25)) * cbDim * (offsetDb !== undefined ? Math.max(0.2, Math.min(1.3, offsetFactor)) : 1)

      if (isPlayingNow && isSequentialDot) {
        const glowAlpha = 0.5 * (isActive ? 1 : 0.65) * cbDim
        const grad = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, GRID_DOT_RADIUS * 3)
        grad.addColorStop(0, `rgba(${color.rgb},${glowAlpha})`)
        grad.addColorStop(1, `rgba(${color.rgb},0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(s.sx, s.sy, GRID_DOT_RADIUS * 3, 0, Math.PI * 2)
        ctx.fill()
      }

      // dot fill — radius scales with current dB offset for active-group dots
      let dotRadius = GRID_DOT_RADIUS
      if (!isCbActive) dotRadius = GRID_DOT_RADIUS * 0.55
      else if (offsetDb !== undefined) dotRadius = GRID_DOT_RADIUS * Math.max(0.5, Math.min(1.7, offsetFactor))

      ctx.fillStyle = `rgba(${color.rgb},${Math.min(1, dotAlpha)})`
      ctx.beginPath()
      ctx.arc(s.sx, s.sy, dotRadius, 0, Math.PI * 2)
      ctx.fill()

      // dot border
      ctx.strokeStyle = `rgba(${color.rgb},${Math.min(1, dotAlpha + 0.2)})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(s.sx, s.sy, dotRadius, 0, Math.PI * 2)
      ctx.stroke()

      // dB label for active-group dots when there's a non-trivial offset
      if (isCbActive && offsetDb !== undefined && Math.abs(offsetDb) >= 0.5) {
        const sign = offsetDb > 0 ? "+" : ""
        const label = `${sign}${offsetDb.toFixed(0)} dB`
        ctx.font = "11px ui-sans-serif, system-ui"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        // subtle glow behind text
        const labelColor = offsetDb > 0 ? "110,231,183" : "252,165,165"
        ctx.fillStyle = `rgba(${labelColor},0.95)`
        ctx.fillText(label, s.sx, s.sy - dotRadius - 10)
      }
    }

    // center diamond
    const cs = toScreen({ x: group.rect.cx, y: group.rect.cy })
    const isCenterDrag = dragTarget.current?.type === "gridCenter" &&
      dragTarget.current.groupId === group.id
    drawCentroidDiamond(ctx, cs.sx, cs.sy, color.rgb, isActive, isCenterDrag)
  }

  useEffect(() => { drawCanvas() }, [drawCanvas])

  useEffect(() => {
    function onResize() { drawCanvas() }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [drawCanvas])

  // ── hit testing ───────────────────────────────────────────────────────
  function pointerNorm(e: React.PointerEvent<HTMLCanvasElement>): LinePoint {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    }
  }

  function pxDist(e: React.PointerEvent<HTMLCanvasElement>, pt: LinePoint): number {
    const rect = canvasRef.current!.getBoundingClientRect()
    const dx = (e.clientX - rect.left) - pt.x * rect.width
    const dy = (e.clientY - rect.top) - (1 - pt.y) * rect.height
    return Math.sqrt(dx * dx + dy * dy)
  }

  type HitResult =
    | { type: "vertex"; groupId: number; vertexIdx: number; dist: number }
    | { type: "centroid"; groupId: number; dist: number }
    | { type: "gridCorner"; groupId: number; cornerIdx: number; dist: number }
    | { type: "gridCenter"; groupId: number; dist: number }

  function hitTest(e: React.PointerEvent<HTMLCanvasElement>): HitResult | null {
    let best: HitResult | null = null

    for (const group of groups) {
      if (isLineLikeGroup(group)) {
        for (let vi = 0; vi < group.vertices.length; vi++) {
          const d = pxDist(e, group.vertices[vi])
          if (d <= HANDLE_HIT_RADIUS && (!best || d < best.dist)) {
            best = { type: "vertex", groupId: group.id, vertexIdx: vi, dist: d }
          }
        }
      } else {
        const corners = gridCorners(group.rect)
        for (let ci = 0; ci < 4; ci++) {
          const d = pxDist(e, corners[ci])
          if (d <= HANDLE_HIT_RADIUS && (!best || d < best.dist)) {
            best = { type: "gridCorner", groupId: group.id, cornerIdx: ci, dist: d }
          }
        }
      }
    }
    if (best) return best

    // centroids / grid centers
    for (const group of groups) {
      if (isLineLikeGroup(group)) {
        const c = centroid(group.vertices)
        const d = pxDist(e, c)
        if (d <= CENTROID_HIT_RADIUS && (!best || d < best.dist)) {
          best = { type: "centroid", groupId: group.id, dist: d }
        }
      } else {
        const d = pxDist(e, { x: group.rect.cx, y: group.rect.cy })
        if (d <= CENTROID_HIT_RADIUS && (!best || d < best.dist)) {
          best = { type: "gridCenter", groupId: group.id, dist: d }
        }
      }
    }
    return best
  }

  // ── pointer handlers ──────────────────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const now = Date.now()
    const hit = hitTest(e)
    const hitKey = hit
      ? hit.type === "vertex" ? `v-${hit.groupId}-${hit.vertexIdx}`
      : hit.type === "gridCorner" ? `gc-${hit.groupId}-${hit.cornerIdx}`
      : `c-${hit.groupId}`
      : null

    // double-click on line vertex → remove it
    if (
      hit?.type === "vertex" &&
      now - lastPointerDownTime.current < DOUBLE_CLICK_MS &&
      lastPointerDownKey.current === hitKey
    ) {
      const group = groups.find(g => g.id === hit.groupId)
      if (group?.type === "line" && group.vertices.length > 2) {
        lastPointerDownTime.current = 0
        setGroups(prev => prev.map(g =>
          g.id === hit.groupId && g.type === "line"
            ? { ...g, vertices: g.vertices.filter((_, i) => i !== hit.vertexIdx) }
            : g
        ))
        setSelectedNode(null)
        return
      }
    }

    lastPointerDownTime.current = now
    lastPointerDownKey.current = hitKey

    if (hit?.type === "vertex") {
      setActiveGroupId(hit.groupId)
      setSelectedNode({ groupId: hit.groupId, idx: hit.vertexIdx })
      dragTarget.current = { type: "vertex", groupId: hit.groupId, vertexIdx: hit.vertexIdx }
      canvasRef.current?.setPointerCapture(e.pointerId)
    } else if (hit?.type === "centroid") {
      setActiveGroupId(hit.groupId)
      setSelectedNode(null)
      const group = groups.find(g => g.id === hit.groupId) as LineLikeGroupData
      dragTarget.current = {
        type: "centroid",
        groupId: hit.groupId,
        anchorPointer: pointerNorm(e),
        anchorVertices: group.vertices.map(v => ({ ...v })),
      }
      canvasRef.current?.setPointerCapture(e.pointerId)
    } else if (hit?.type === "gridCenter") {
      setActiveGroupId(hit.groupId)
      setSelectedNode(null)
      const group = groups.find(g => g.id === hit.groupId) as GridGroupData
      dragTarget.current = {
        type: "gridCenter",
        groupId: hit.groupId,
        anchorPointer: pointerNorm(e),
        anchorRect: { ...group.rect },
      }
      canvasRef.current?.setPointerCapture(e.pointerId)
    } else if (hit?.type === "gridCorner") {
      setActiveGroupId(hit.groupId)
      setSelectedNode(null)
      const group = groups.find(g => g.id === hit.groupId) as GridGroupData
      dragTarget.current = {
        type: "gridCorner",
        groupId: hit.groupId,
        cornerIdx: hit.cornerIdx,
        anchorPointer: pointerNorm(e),
        anchorRect: { ...group.rect },
      }
      canvasRef.current?.setPointerCapture(e.pointerId)
    } else {
      setSelectedNode(null)
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const dt = dragTarget.current
    if (!dt) return

    const p = pointerNorm(e)

    if (dt.type === "vertex") {
      setGroups(prev => prev.map(g =>
        g.id === dt.groupId && isLineLikeGroup(g)
          ? { ...g, vertices: g.vertices.map((v, i) => (i === dt.vertexIdx ? { ...v, ...p } : v)) }
          : g
      ))
    } else if (dt.type === "centroid") {
      const dx = p.x - dt.anchorPointer.x
      const dy = p.y - dt.anchorPointer.y
      setGroups(prev => prev.map(g =>
        g.id === dt.groupId && isLineLikeGroup(g)
          ? {
              ...g,
              vertices: dt.anchorVertices.map(v => ({
                ...v,
                x: Math.max(0, Math.min(1, v.x + dx)),
                y: Math.max(0, Math.min(1, v.y + dy)),
              })),
            }
          : g
      ))
    } else if (dt.type === "gridCenter") {
      const dx = p.x - dt.anchorPointer.x
      const dy = p.y - dt.anchorPointer.y
      setGroups(prev => prev.map(g =>
        g.id === dt.groupId && g.type === "grid"
          ? {
              ...g,
              rect: {
                ...dt.anchorRect,
                cx: Math.max(0, Math.min(1, dt.anchorRect.cx + dx)),
                cy: Math.max(0, Math.min(1, dt.anchorRect.cy + dy)),
              },
            }
          : g
      ))
    } else if (dt.type === "gridCorner") {
      const ar = dt.anchorRect
      const newHw = Math.max(0.02, Math.abs(p.x - ar.cx))
      const newHh = Math.max(0.02, Math.abs(p.y - ar.cy))

      setGroups(prev => prev.map(g =>
        g.id === dt.groupId && g.type === "grid"
          ? { ...g, rect: { ...ar, hw: newHw, hh: newHh } }
          : g
      ))
    }
  }

  function handlePointerUp() {
    dragTarget.current = null
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeGroup || activeGroup.type !== "line") return

    const rect = canvasRef.current!.getBoundingClientRect()
    const np: LinePoint = {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
      gain: 1,
    }

    // don't add if click was on an existing handle
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    for (const group of groups) {
      const pts = isLineLikeGroup(group)
        ? group.vertices
        : [...gridDots(group.rect, group.size, group.readingOrder), { x: group.rect.cx, y: group.rect.cy }]
      for (const v of pts) {
        const dx = px - v.x * rect.width
        const dy = py - (1 - v.y) * rect.height
        if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_HIT_RADIUS) return
      }
    }

    const verts = activeGroup.vertices
    const dFirst = Math.hypot(np.x - verts[0].x, np.y - verts[0].y)
    const dLast = Math.hypot(np.x - verts[verts.length - 1].x, np.y - verts[verts.length - 1].y)
    setGroups(prev => prev.map(g =>
      g.id === activeGroupId && g.type === "line"
        ? {
            ...g,
            vertices: dFirst < dLast
              ? [np, ...g.vertices]
              : [...g.vertices, np],
          }
        : g
    ))
  }

  // ── group management ──────────────────────────────────────────────────
  function addLine3DGroup() {
    const id = nextGroupId++
    const newGroup: Line3DGroupData = {
      id,
      type: "line3d",
      vertices: [
        { x: 0.26 + Math.random() * 0.08, y: 0.35 + Math.random() * 0.25, depth: 0, gainDb: DEFAULT_POINT_GAIN_DB },
        { x: 0.66 + Math.random() * 0.08, y: 0.48 + Math.random() * 0.25, depth: 0.65, gainDb: DEFAULT_POINT_GAIN_DB },
      ],
    }
    setGroups(prev => [...prev, newGroup])
    setActiveGroupId(id)
    setSelectedNode(null)

    if (isPlaying) {
      const p = ensureLine3DPlayer(id)
      p.setPoints(newGroup.vertices)
      p.setTravelRate(line3DRate)
      p.setHitInterval(stepInterval)
      p.setBandwidth(bandwidth)
      p.setHitRelease(hitRelease)
      p.setVolume(volume)
      p.setMasterGainDb(masterGainDb)
      p.setMasterGainOscillationAmountDb(masterGainOscAmountDb)
      p.setMasterGainOscillationRateHz(masterGainOscRateHz)
      p.setSlope(slopeDbPerOct)
      void p.start()
    }
  }

  function setActiveGridSize(size: GridSize) {
    if (!activeGridGroup) return
    setGroups(prev => prev.map(g =>
      g.id === activeGridGroup.id && g.type === "grid"
        ? { ...g, size }
        : g
    ))
  }

  function setActiveGridReadingOrder(readingOrder: GridReadingOrder) {
    if (!activeGridGroup) return
    setGroups(prev => prev.map(g =>
      g.id === activeGridGroup.id && g.type === "grid"
        ? { ...g, readingOrder }
        : g
    ))
  }

  function removeGroup(id: number) {
    if (groups.length <= 1) return
    const lp = linePlayersRef.current.get(id)
    if (lp) { void lp.destroy(); linePlayersRef.current.delete(id) }
    const l3p = line3DPlayersRef.current.get(id)
    if (l3p) { void l3p.destroy(); line3DPlayersRef.current.delete(id) }
    const gp = gridPlayersRef.current.get(id)
    if (gp) { void gp.destroy(); gridPlayersRef.current.delete(id) }

    setGroups(prev => {
      const next = prev.filter(g => g.id !== id)
      if (activeGroupId === id) setActiveGroupId(next[0].id)
      return next
    })
    if (selectedNode?.groupId === id) setSelectedNode(null)
  }

  // ── playback ──────────────────────────────────────────────────────────
  async function togglePlay() {
    try {
      setError(null)
      if (isPlaying) {
        for (const [, p] of linePlayersRef.current) await p.stop()
        for (const [, p] of line3DPlayersRef.current) await p.stop()
        for (const [, p] of gridPlayersRef.current) await p.stop()
        const ctx = audioCtxRef.current
        if (ctx?.state === "running") await ctx.suspend()
        setIsPlaying(false)
      } else {
        for (const [, p] of linePlayersRef.current) await p.destroy()
        for (const [, p] of line3DPlayersRef.current) await p.destroy()
        for (const [, p] of gridPlayersRef.current) await p.destroy()
        linePlayersRef.current.clear()
        line3DPlayersRef.current.clear()
        gridPlayersRef.current.clear()

        const ctx = getAudioCtx()
        await ctx.resume()
        for (const g of groups) {
          if (g.type === "line") {
            const p = ensureLinePlayer(g.id)
            p.setPoints(g.vertices)
            p.setStepInterval(stepInterval)
            p.setSteps(steps)
            p.setBandwidth(bandwidth)
            p.setHitRelease(hitRelease)
            p.setDepth(depth)
            p.setVolume(volume)
            p.setMasterGainDb(masterGainDb)
            p.setMasterGainOscillationAmountDb(masterGainOscAmountDb)
            p.setMasterGainOscillationRateHz(masterGainOscRateHz)
            await p.setSlope(slopeDbPerOct)
            await p.start()
          } else if (g.type === "line3d") {
            const p = ensureLine3DPlayer(g.id)
            p.setPoints(g.vertices)
            p.setTravelRate(line3DRate)
            p.setHitInterval(stepInterval)
            p.setBandwidth(bandwidth)
            p.setHitRelease(hitRelease)
            p.setVolume(volume)
            p.setMasterGainDb(masterGainDb)
            p.setMasterGainOscillationAmountDb(masterGainOscAmountDb)
            p.setMasterGainOscillationRateHz(masterGainOscRateHz)
            p.setSlope(slopeDbPerOct)
            await p.start()
          } else {
            const p = ensureGridPlayer(g.id)
            p.setGridSize(g.size)
            p.setReadingOrder(g.readingOrder)
            p.setRect(g.rect)
            p.setStepInterval(stepInterval)
            p.setBandwidth(bandwidth)
            p.setHitRelease(hitRelease)
            p.setDepth(depth)
            p.setCheckerboard(checkerboard)
            p.setCheckerboardVolumeDiff(checkerboardVolumeDiff)
            p.setCheckerboardOscillate(checkerboardOscillate)
            p.setCheckerboardOscillatePeriod(checkerboardOscillatePeriod)
            p.setCheckerboardOscillateMode(checkerboardOscillateMode)
            p.setCheckerboardSwitchMode(checkerboardSwitchMode)
            p.setSimultaneous(simultaneous)
            p.setDiagonalDiff(diagonalDiff)
            p.setDiagonalDiffDb(diagonalDiffDb)
            p.setVolume(volume)
            await p.setSlope(slopeDbPerOct)
            await p.start()
          }
        }
        setIsPlaying(true)
      }
    } catch (e) {
      setIsPlaying(false)
      setError(e instanceof Error ? e.message : "Playback failed.")
    }
  }

  // ── selected node helpers ─────────────────────────────────────────────
  const selGroup = selectedNode ? groups.find(g => g.id === selectedNode.groupId) : null
  const selVertex = selGroup && isLineLikeGroup(selGroup) && selectedNode ? selGroup.vertices[selectedNode.idx] : null

  function setLine3DPointDepth(pointIdx: number, pointDepth: number) {
    if (!activeLine3DGroup) return
    if (activeGroupId !== activeLine3DGroup.id) setActiveGroupId(activeLine3DGroup.id)
    const nextVertices = activeLine3DGroup.vertices.map((pt, i) => (
      i === pointIdx ? { ...pt, depth: Math.max(0, Math.min(1, pointDepth)) } : pt
    ))
    line3DPlayersRef.current.get(activeLine3DGroup.id)?.setPoints(nextVertices, { clearActiveHits: true })
    setGroups(prev => prev.map(gr =>
      gr.id === activeLine3DGroup.id && gr.type === "line3d"
        ? { ...gr, vertices: nextVertices }
        : gr
    ))
  }

  function setLine3DPointGainDb(pointIdx: number, pointGainDb: number) {
    if (!activeLine3DGroup) return
    if (activeGroupId !== activeLine3DGroup.id) setActiveGroupId(activeLine3DGroup.id)
    const nextVertices = activeLine3DGroup.vertices.map((pt, i) => (
      i === pointIdx
        ? { ...pt, gainDb: Math.max(MIN_POINT_GAIN_DB, Math.min(MAX_POINT_GAIN_DB, pointGainDb)) }
        : pt
    ))
    line3DPlayersRef.current.get(activeLine3DGroup.id)?.setPoints(nextVertices, { clearActiveHits: true })
    setGroups(prev => prev.map(gr =>
      gr.id === activeLine3DGroup.id && gr.type === "line3d"
        ? { ...gr, vertices: nextVertices }
        : gr
    ))
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#0d3a6f_0%,rgba(13,58,111,0.15)_28%,transparent_48%),radial-gradient(circle_at_top_right,rgba(22,163,171,0.22),transparent_36%),linear-gradient(180deg,#0b0d12_0%,#10121a_52%,#090a0d_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/75 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Cabin Audio
          </Link>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.26em] text-white/55">
            3D Line
          </div>
        </div>

        <div className="mt-8 space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">Mode</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">3D line sweep</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Draw two-point 3D click-train lines. Drag the endpoint handles to set the usual left/right and low/high positions,
              use Point A/B depth for front/back level, and drag the diamond to move the whole line.
            </p>
          </div>

          {/* group tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {groups.map((g, gi) => {
              const color = gc(gi)
              const isActive = g.id === activeGroupId
              return (
                <button
                  key={g.id}
                  onClick={() => { setActiveGroupId(g.id); setSelectedNode(null) }}
                  className={`relative flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition ${
                    isActive
                      ? "border-white/25 bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-white/50 hover:text-white/70"
                  }`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: `rgb(${color.rgb})` }}
                  />
                  {g.type === "line"
                    ? `Line ${gi + 1}`
                    : g.type === "line3d"
                      ? `3D line ${gi + 1}`
                      : `Grid ${gi + 1} (${g.size.cols}x${g.size.rows})`}
                  {groups.length > 1 && (
                    <span
                      onClick={(ev) => { ev.stopPropagation(); removeGroup(g.id) }}
                      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-white/30 hover:bg-white/10 hover:text-white/70"
                    >
                      <Trash2 className="h-3 w-3" />
                    </span>
                  )}
                </button>
              )
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={addLine3DGroup}
              className="h-9 rounded-full border border-dashed border-white/15 text-xs text-white/50 hover:border-white/25 hover:text-white/70"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add 3D line
            </Button>
          </div>

          {/* canvas */}
          <div ref={containerRef} className="w-full">
            <canvas
              ref={canvasRef}
              className="w-full cursor-grab rounded-[24px] border border-white/10 bg-black/30 backdrop-blur-md active:cursor-grabbing"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={handleDoubleClick}
            />
          </div>

          {/* controls */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void togglePlay()}
              className="h-11 rounded-full bg-white text-black hover:bg-white/90"
            >
              {isPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {isPlaying ? "Stop" : "Play"}
            </Button>

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
              {([-3.0, -4.5] as const).map(slope => {
                const selected = slopeDbPerOct === slope
                return (
                  <button
                    key={slope}
                    type="button"
                    onClick={() => setSlopeDbPerOct(slope)}
                    className={`h-9 rounded-full px-4 text-xs font-medium transition ${
                      selected
                        ? "bg-white text-black"
                        : "text-white/55 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    {slope.toFixed(1)} dB/oct
                  </button>
                )
              })}
            </div>

            {activeGridGroup && (
              <>
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
                  {([
                    { rows: 2, cols: 1 },
                    { rows: 2, cols: 2 },
                    { rows: 3, cols: 3 },
                    { rows: 2, cols: 3 },
                    { rows: 2, cols: 4 },
                    { rows: 2, cols: 5 },
                  ] as const).map(size => {
                    const selected = activeGridGroup.size.rows === size.rows && activeGridGroup.size.cols === size.cols
                    return (
                      <button
                        key={`${size.rows}x${size.cols}`}
                        type="button"
                        onClick={() => setActiveGridSize(size)}
                        className={`h-9 rounded-full px-4 text-xs font-medium transition ${
                          selected
                            ? "bg-white text-black"
                            : "text-white/55 hover:bg-white/10 hover:text-white/80"
                        }`}
                      >
                        {size.cols}x{size.rows}
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
                  {([
                    ["rows", "Rows"],
                    ["columns", "Columns"],
                  ] as const).map(([order, label]) => {
                    const selected = activeGridGroup.readingOrder === order
                    return (
                      <button
                        key={order}
                        type="button"
                        onClick={() => setActiveGridReadingOrder(order)}
                        className={`h-9 rounded-full px-4 text-xs font-medium transition ${
                          selected
                            ? "bg-white text-black"
                            : "text-white/55 hover:bg-white/10 hover:text-white/80"
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setCheckerboard(prev => !prev)}
                  className={`h-9 rounded-full px-4 text-xs font-medium border transition ${
                    checkerboard
                      ? "bg-white text-black border-white"
                      : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80"
                  }`}
                >
                  Checkerboard
                </button>

                <button
                  type="button"
                  onClick={() => setSimultaneous(prev => !prev)}
                  className={`h-9 rounded-full px-4 text-xs font-medium border transition ${
                    simultaneous
                      ? "bg-white text-black border-white"
                      : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80"
                  }`}
                >
                  Simultaneous
                </button>

                {!checkerboard && (
                  <button
                    type="button"
                    onClick={() => setDiagonalDiff(prev => !prev)}
                    className={`h-9 rounded-full px-4 text-xs font-medium border transition ${
                      diagonalDiff
                        ? "bg-white text-black border-white"
                        : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    Diagonal diff
                  </button>
                )}

                {checkerboard && (
                  <button
                    type="button"
                    onClick={() => setCheckerboardOscillate(prev => !prev)}
                    className={`h-9 rounded-full px-4 text-xs font-medium border transition ${
                      checkerboardOscillate
                        ? "bg-white text-black border-white"
                        : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    Oscillate diff
                  </button>
                )}

                {checkerboard && checkerboardOscillate && (
                  <button
                    type="button"
                    onClick={() => setCheckerboardOscillateMode(prev => prev === "continuous" ? "instant" : "continuous")}
                    className="h-9 rounded-full px-4 text-xs font-medium border transition border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  >
                    {checkerboardOscillateMode === "continuous" ? "Continuous" : "Instant"}
                  </button>
                )}

                {checkerboard && (
                  <button
                    type="button"
                    onClick={() => setCheckerboardSwitchMode(prev => prev === "auto" ? "manual" : "auto")}
                    className="h-9 rounded-full px-4 text-xs font-medium border transition border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  >
                    {checkerboardSwitchMode === "auto" ? "Auto switch" : "Manual switch"}
                  </button>
                )}

                {checkerboard && checkerboardSwitchMode === "manual" && (
                  <button
                    type="button"
                    onClick={() => {
                      for (const [, p] of gridPlayersRef.current) {
                        p.toggleCheckerboardGroup()
                      }
                    }}
                    className="h-9 rounded-full px-4 text-xs font-medium border transition border-cyan-300/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                  >
                    Switch group
                  </button>
                )}
              </>
            )}
          </div>

          {error && (
            <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          {/* sliders */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Step delay</p>
                <span className="text-xs text-white/70 tabular-nums">{stepInterval} ms</span>
              </div>
              <Slider
                aria-label="Step delay"
                value={[stepInterval]}
                min={10}
                max={2000}
                step={5}
                onValueChange={(v) => setStepInterval(v[0] ?? 60)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Release</p>
                <span className="text-xs text-white/70 tabular-nums">{formatSeconds(hitRelease)}</span>
              </div>
              <Slider
                aria-label="Hit release"
                value={[hitRelease]}
                min={0.05}
                max={3}
                step={0.05}
                onValueChange={(v) => setHitRelease(v[0] ?? DEFAULT_HIT_RELEASE)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Bandwidth</p>
                <span className="text-xs text-white/70 tabular-nums">{bandwidth.toFixed(1)} oct</span>
              </div>
              <Slider
                aria-label="Bandwidth"
                value={[bandwidth]}
                min={1}
                max={10}
                step={0.5}
                onValueChange={(v) => setBandwidth(v[0] ?? 6)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Volume</p>
                <span className="text-xs text-white/70 tabular-nums">{Math.round(volume * 100)}%</span>
              </div>
              <Slider
                aria-label="Volume"
                value={[volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(v) => setVolume(v[0] ?? 1)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Master gain</p>
                <span className="text-xs text-white/70 tabular-nums">
                  {masterGainDb === 0 ? "0 dB" : `${masterGainDb > 0 ? "+" : ""}${masterGainDb} dB`}
                </span>
              </div>
              <Slider
                aria-label="Master gain"
                value={[masterGainDb]}
                min={-60}
                max={24}
                step={1}
                onValueChange={(v) => setMasterGainDb(v[0] ?? DEFAULT_MASTER_GAIN_DB)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Master osc</p>
                <span className="text-xs text-white/70 tabular-nums">{formatOscAmountDb(masterGainOscAmountDb)}</span>
              </div>
              <Slider
                aria-label="Master gain oscillation amount"
                value={[masterGainOscAmountDb]}
                min={0}
                max={48}
                step={1}
                onValueChange={(v) => setMasterGainOscAmountDb(v[0] ?? DEFAULT_MASTER_GAIN_OSC_AMOUNT_DB)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Osc rate</p>
                <span className="text-xs text-white/70 tabular-nums">{formatHz(masterGainOscRateHz)}</span>
              </div>
              <Slider
                aria-label="Master gain oscillation rate"
                value={[masterGainOscRateHz]}
                min={0.05}
                max={20}
                step={0.05}
                onValueChange={(v) => setMasterGainOscRateHz(v[0] ?? DEFAULT_MASTER_GAIN_OSC_RATE_HZ)}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>

            {!checkerboard && diagonalDiff && (
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-white/50">Diagonal Diff</p>
                  <span className="text-xs text-white/70 tabular-nums">
                    {diagonalDiffDb === 0 ? "0 dB" : `${diagonalDiffDb > 0 ? "+" : ""}${diagonalDiffDb} dB`}
                  </span>
                </div>
                <Slider
                  aria-label="Diagonal volume differential"
                  value={[diagonalDiffDb]}
                  min={-24}
                  max={24}
                  step={1}
                  onValueChange={(v) => setDiagonalDiffDb(v[0] ?? 0)}
                  className="mt-3 py-3"
                  rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                  thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                />
              </div>
            )}

            {checkerboard && (
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-white/50">Low/High Diff</p>
                  <span className="text-xs text-white/70 tabular-nums">
                    {checkerboardVolumeDiff === 0 ? "0 dB" : `${checkerboardVolumeDiff > 0 ? "+" : ""}${checkerboardVolumeDiff} dB`}
                  </span>
                </div>
                <Slider
                  aria-label="Checkerboard volume differential"
                  value={[checkerboardVolumeDiff]}
                  min={-24}
                  max={24}
                  step={1}
                  onValueChange={(v) => setCheckerboardVolumeDiff(v[0] ?? 0)}
                  className="mt-3 py-3"
                  rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                  thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                />
              </div>
            )}

            {checkerboard && checkerboardOscillate && (
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-white/50">Osc period</p>
                  <span className="text-xs text-white/70 tabular-nums">
                    {checkerboardOscillatePeriod < 1000
                      ? `${checkerboardOscillatePeriod} ms`
                      : `${(checkerboardOscillatePeriod / 1000).toFixed(1)} s`} · {(1000 / checkerboardOscillatePeriod).toFixed(2)} Hz
                  </span>
                </div>
                <Slider
                  aria-label="Oscillation period"
                  value={[checkerboardOscillatePeriod]}
                  min={500}
                  max={15000}
                  step={100}
                  onValueChange={(v) => setCheckerboardOscillatePeriod(v[0] ?? 4000)}
                  className="mt-3 py-3"
                  rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                  thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                />
              </div>
            )}
          </div>

          {activeLine3DGroup && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-[24px] border border-cyan-300/15 bg-white/[0.045] p-5 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-white/50">
                    3D line {activeLine3DIndex + 1} travel
                  </p>
                  <span className="text-xs text-white/70 tabular-nums">{line3DRate.toFixed(2)} pass/s</span>
                </div>
                <Slider
                  aria-label="3D line travel rate"
                  value={[line3DRate]}
                  min={0.05}
                  max={8}
                  step={0.05}
                  onValueChange={(v) => setLine3DRate(v[0] ?? DEFAULT_LINE_3D_RATE)}
                  className="mt-3 py-3"
                  rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                  thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                />
              </div>

              {[0, 1].map(pointIdx => {
                const point = activeLine3DGroup.vertices[pointIdx]
                const pointDepth = point?.depth ?? 0
                const pointGainDb = point?.gainDb ?? DEFAULT_POINT_GAIN_DB
                const pointLabel = pointIdx === 0 ? "A" : "B"
                return (
                  <div key={pointIdx} className="contents">
                    <div className="rounded-[24px] border border-cyan-300/15 bg-white/[0.045] p-5 backdrop-blur-xl">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-wider text-white/50">Point {pointLabel} depth</p>
                        <span className="text-xs text-white/70 tabular-nums">{Math.round(pointDepth * 100)}%</span>
                      </div>
                      <Slider
                        aria-label={`Point ${pointLabel} depth`}
                        value={[pointDepth]}
                        min={0}
                        max={1}
                        step={0.01}
                        onValueChange={(v) => setLine3DPointDepth(pointIdx, v[0] ?? 0)}
                        className="mt-3 py-3"
                        rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                        thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                      />
                    </div>

                    <div className="rounded-[24px] border border-cyan-300/15 bg-white/[0.045] p-5 backdrop-blur-xl">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-wider text-white/50">Point {pointLabel} gain</p>
                        <span className="text-xs text-white/70 tabular-nums">{formatDb(pointGainDb)}</span>
                      </div>
                      <Slider
                        aria-label={`Point ${pointLabel} gain`}
                        value={[pointGainDb]}
                        min={MIN_POINT_GAIN_DB}
                        max={MAX_POINT_GAIN_DB}
                        step={1}
                        onValueChange={(v) => setLine3DPointGainDb(pointIdx, v[0] ?? DEFAULT_POINT_GAIN_DB)}
                        className="mt-3 py-3"
                        rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                        thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* per-node gain */}
          {selVertex && selectedNode && selGroup?.type === "line" && (
            <div className="rounded-[24px] border border-cyan-300/15 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">
                  Node {selectedNode.idx + 1} gain
                </p>
                <span className="text-xs text-white/70 tabular-nums">
                  {Math.round((selVertex.gain ?? 1) * 100)}%
                </span>
              </div>
              <Slider
                aria-label={`Node ${selectedNode.idx + 1} gain`}
                value={[selVertex.gain ?? 1]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(v) => {
                  const g = v[0] ?? 1
                  const { groupId, idx } = selectedNode
                  setGroups(prev => prev.map(gr =>
                    gr.id === groupId && isLineLikeGroup(gr)
                      ? { ...gr, vertices: gr.vertices.map((pt, i) => (i === idx ? { ...pt, gain: g } : pt)) }
                      : gr
                  ))
                }}
                className="mt-3 py-3"
                rangeClassName="bg-[linear-gradient(90deg,#67e8f9_0%,#fb923c_100%)]"
                thumbClassName="h-5 w-5 border-white/40 bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]"
              />
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

// ── drawing helpers ─────────────────────────────────────────────────────────

function interpolatePolyline(pts: LinePoint[], t: number): LinePoint {
  if (pts.length < 2 || t <= 0) return pts[0]
  if (t >= 1) return pts[pts.length - 1]

  const cumDist: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  const total = cumDist[cumDist.length - 1]
  if (total === 0) return pts[0]

  const targetDist = t * total
  for (let i = 1; i < cumDist.length; i++) {
    if (targetDist <= cumDist[i]) {
      const segLen = cumDist[i] - cumDist[i - 1]
      const localT = segLen > 0 ? (targetDist - cumDist[i - 1]) / segLen : 0
      return {
        x: pts[i - 1].x + localT * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + localT * (pts[i].y - pts[i - 1].y),
      }
    }
  }
  return pts[pts.length - 1]
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  active: boolean, selected: boolean,
  gain: number, rgb: string, groupActive: boolean,
  depth?: number,
) {
  const baseAlpha = groupActive ? 1 : 0.5
  const depthNorm = depth === undefined ? null : Math.max(0, Math.min(1, depth))

  if (gain < 1) {
    const arcAngle = gain * Math.PI * 2
    ctx.strokeStyle = `rgba(251,146,60,${0.5 * baseAlpha})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, HANDLE_RADIUS + 5, -Math.PI / 2, -Math.PI / 2 + arcAngle)
    ctx.stroke()
  }

  if (depthNorm !== null) {
    const depthRadius = HANDLE_RADIUS + 5 + depthNorm * 10
    ctx.strokeStyle = `rgba(${rgb},${(0.18 + depthNorm * 0.28) * baseAlpha})`
    ctx.lineWidth = 2
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.arc(x, y, depthRadius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.strokeStyle = selected
    ? `rgba(251,146,60,${0.9 * baseAlpha})`
    : `rgba(${rgb},${(active ? 0.9 : 0.6) * baseAlpha})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2)
  ctx.stroke()

  const fillAlpha = (selected ? 0.35 : active ? 0.3 : 0.1 + gain * 0.15) * baseAlpha
  ctx.fillStyle = selected
    ? `rgba(251,146,60,${fillAlpha})`
    : `rgba(${rgb},${fillAlpha})`
  ctx.beginPath()
  ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = selected
    ? `rgba(251,146,60,${0.9 * baseAlpha})`
    : `rgba(${rgb},${0.9 * baseAlpha})`
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawCentroidDiamond(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  rgb: string, groupActive: boolean, dragging: boolean,
) {
  const alpha = groupActive ? 1 : 0.4
  const r = CENTROID_RADIUS

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.PI / 4)

  ctx.fillStyle = dragging
    ? `rgba(${rgb},${0.4 * alpha})`
    : `rgba(${rgb},${0.15 * alpha})`
  ctx.fillRect(-r / 2, -r / 2, r, r)

  ctx.strokeStyle = `rgba(${rgb},${(dragging ? 0.9 : 0.6) * alpha})`
  ctx.lineWidth = 1.5
  ctx.strokeRect(-r / 2, -r / 2, r, r)

  ctx.restore()
}
