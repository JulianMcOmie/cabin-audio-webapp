"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { Pause, Play } from "lucide-react"
import { GlyphSequenceAudio, type GlyphPoint } from "@/lib/audio/glyphSequence"

const DEFAULT_RATE = 100
const MAX_RATE = 200
const DEFAULT_DEPTH_DB = 20
const WIDTH = 1000
const HEIGHT = 650
const MIN_SHAPE_SIZE = 0.01
type Playback = { point: GlyphPoint; step: number }
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
type Bounds = { left: number; right: number; top: number; bottom: number }
type Grid = { width: number; height: number; x: number; y: number }
function meanderVertices(count: number): [number, number][] {
  return Array.from({ length: count * 4 }, (_, index) => {
    const column = Math.floor(index / 2)
    return [column / (count * 2 - 1), column % 2 === 0 ? 1 - index % 2 : index % 2]
  })
}
const SHAPES = {
  line: { label: "Line", vertical: false, depth: false },
  square: { label: "Square", vertical: false, depth: false },
  triangle: { label: "Triangle", vertical: false, depth: false },
  circle: { label: "Circle", vertical: false, depth: false },
  horizontal: { label: "Horizontal meander", vertical: false, depth: false },
  vertical: { label: "Vertical meander", vertical: true, depth: false },
  horizontalDepth: { label: "Horizontal depth meander", vertical: false, depth: true },
  verticalDepth: { label: "Vertical depth meander", vertical: true, depth: true },
} as const
type Shape = keyof typeof SHAPES
const SHAPE_NAMES: Record<Shape, string> = { line: "Line", square: "Square", triangle: "Triangle", circle: "Circle", horizontal: "Horizontal", vertical: "Vertical", horizontalDepth: "Horizontal depth", verticalDepth: "Vertical depth" }
const SHAPE_ORDER: Shape[] = ["line", "square", "triangle", "circle", "horizontal", "vertical", "horizontalDepth", "verticalDepth"]

function pathVertices(shape: Shape, count: number): [number, number][] {
  if (shape === "line") return [[0, 0.5], [1, 0.5]]
  if (shape === "square") return [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
  if (shape === "triangle") return [[0.5, 0], [1, 1], [0, 1], [0.5, 0]]
  if (shape === "circle") return Array.from({ length: 33 }, (_, i) => [0.5 + Math.sin(i / 32 * Math.PI * 2) * 0.5, 0.5 - Math.cos(i / 32 * Math.PI * 2) * 0.5])
  return meanderVertices(count)
}
const isClosed = (shape: Shape) => shape === "square" || shape === "triangle" || shape === "circle"

function ShapeIcon({ shape }: { shape: Shape }) {
  const { vertical, depth } = SHAPES[shape]
  const source = pathVertices(shape, 3)
  const vertices = source.map(([along, across]) => {
    if (depth) return vertical ? [12 + across * 8, 5 + along * 22 - across * 3] : [3 + along * 22 + across * 3, 22 - across * 12]
    return vertical ? [5 + across * 22, 3 + along * 26] : [3 + along * 26, 5 + across * 22]
  })
  return <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="shrink-0">
    {vertices.slice(1).map((_, index) => [index, index + 1]).map(([a, b]) => <line key={`${a}-${b}`} x1={vertices[a][0]} y1={vertices[a][1]} x2={vertices[b][0]} y2={vertices[b][1]} stroke="currentColor" strokeWidth="1.3" opacity="0.6" />)}
    {vertices.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="1.6" fill="currentColor" opacity={depth && source[index][1] ? 0.35 : 1} />)}
  </svg>
}

const RESIZE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function gridBounds(grid: Grid): Bounds {
  const x = clamp(grid.x, grid.width / 2, 1 - grid.width / 2)
  const y = clamp(grid.y, grid.height / 2, 1 - grid.height / 2)
  return { left: x - grid.width / 2, right: x + grid.width / 2, top: y - grid.height / 2, bottom: y + grid.height / 2 }
}

function makeGridPoints(grid: Grid, volumeDb: number, depthDb: number, shape: Shape, rotation: number, meanders: number, density: number): GlyphPoint[] {
  const bounds = gridBounds(grid)
  const { vertical, depth } = SHAPES[shape]
  const angle = rotation * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const width = grid.width * WIDTH, height = grid.height * HEIGHT
  const scale = depth ? 1 : Math.min(1,
    width / (Math.abs(cos) * width + Math.abs(sin) * height),
    height / (Math.abs(sin) * width + Math.abs(cos) * height))
  const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2
  const vertices = pathVertices(shape, meanders)
  const samples: [number, number][] = []
  if (shape === "circle") {
    const count = 8 * density
    for (let i = 0; i < count; i++) samples.push([0.5 + Math.sin(i / count * Math.PI * 2) * 0.5, 0.5 - Math.cos(i / count * Math.PI * 2) * 0.5])
  } else {
    for (let i = 0; i < vertices.length - 1; i++) {
      const [x, y] = vertices[i], [nx, ny] = vertices[i + 1]
      for (let j = 0; j < density; j++) samples.push([x + (nx - x) * j / density, y + (ny - y) * j / density])
    }
    if (!isClosed(shape)) samples.push(vertices[vertices.length - 1])
  }
  return samples.map(([along, across], index) => {
    const x = vertical ? (depth ? 0.5 : across) : along
    const y = vertical ? along : (depth ? 0.5 : across)
    return {
      x: depth ? bounds.left + x * grid.width : cx + ((x - 0.5) * width * cos + (y - 0.5) * height * sin) * scale / WIDTH,
      y: depth ? bounds.top + y * grid.height : cy + (-(x - 0.5) * width * sin + (y - 0.5) * height * cos) * scale / HEIGHT,
      depth: depth ? across * 0.9 : 0,
      glyphId: `${shape}:${index}`, vertex: true,
      gain: Math.pow(10, (volumeDb - (depth ? across * depthDb : 0)) / 20),
    }
  })
}

function resizedBounds(bounds: Bounds, handle: ResizeHandle, dx: number, dy: number): Bounds {
  const next = { ...bounds }
  if (handle.includes("w")) next.left = clamp(bounds.left + dx, 0, bounds.right - MIN_SHAPE_SIZE)
  if (handle.includes("e")) next.right = clamp(bounds.right + dx, bounds.left + MIN_SHAPE_SIZE, 1)
  if (handle.includes("n")) next.top = clamp(bounds.top + dy, 0, bounds.bottom - MIN_SHAPE_SIZE)
  if (handle.includes("s")) next.bottom = clamp(bounds.bottom + dy, bounds.top + MIN_SHAPE_SIZE, 1)
  return next
}

// Perspective is only a visual cue; depth changes level, while X/Y retain the
// main dot grid's pan/cutoff mapping. The sequence still follows reading order.
function project(point: GlyphPoint, invertDepth = false) {
  const depth = invertDepth ? 0.9 - (point.depth ?? 0) : (point.depth ?? 0)
  const scale = 1 / (1 + depth * 0.22)
  return { x: (0.5 + (point.x - 0.5) * scale) * WIDTH,
    y: (0.5 + (point.y - 0.5) * scale - depth * 0.035) * HEIGHT, scale }
}

function Range({ label, value, min, max, step = 1, display, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; display: string; onChange: (value: number) => void
}) {
  return <label className="block space-y-3">
    <span className="flex items-center justify-between gap-4 text-xs"><span className="text-[#a9bdc4]">{label}</span><span className="font-mono text-[#d9e7e2]">{display}</span></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} className="w-full cursor-pointer accent-[#b9e5ce]" />
  </label>
}

export function DragGrid() {
  const [maxCutoff, setMaxCutoff] = useState(14000)
  const [rate, setRate] = useState(DEFAULT_RATE)
  const [grid, setGrid] = useState<Grid>({ width: 0.3, height: 0.3, x: 0.5, y: 0.5 })
  const updateGrid = (patch: Partial<Grid>) => setGrid(current => ({ ...current, ...patch }))
  const setCenter = (center: { x: number; y: number }) => updateGrid(center)
  const [eqGains, setEqGains] = useState([0, 0, 0])
  const [musicUrl, setMusicUrl] = useState<string | null>(null)
  const [musicName, setMusicName] = useState("")
  const music = useRef<HTMLAudioElement | null>(null)
  const [volumeDb, setVolumeDb] = useState(0)
  const [shape, setShape] = useState<Shape>("line")
  const { vertical, depth } = SHAPES[shape]
  const columns = depth && vertical ? 1 : 2
  const rows = depth && !vertical ? 1 : 2
  const [invertDepth, setInvertDepth] = useState(false)
  const invertDisplay = depth && invertDepth
  const [density, setDensity] = useState(4)
  const [meanders, setMeanders] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [depthDb, setDepthDb] = useState(DEFAULT_DEPTH_DB)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const gesture = useRef<{ pointer: number; x: number; y: number; center: { x: number; y: number }; bounds: Bounds; handle?: ResizeHandle } | null>(null)
  const engine = useRef<GlyphSequenceAudio | null>(null)
  const mounted = useRef(false)
  const stageGrid = useMemo(() => ({ ...grid, width: columns === 1 ? 0 : grid.width, height: rows === 1 ? 0 : grid.height }), [grid, columns, rows])
  const halfWidth = stageGrid.width / 2, halfHeight = stageGrid.height / 2
  const bounds = gridBounds(stageGrid)
  const safeCenter = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
  const points = useMemo(() => makeGridPoints(stageGrid, volumeDb, depthDb, shape, rotation, meanders, density), [stageGrid, volumeDb, depthDb, shape, rotation, meanders, density])
  const edges = useMemo(() => {
    const links: [number, number][] = points.slice(1).map((_, index) => [index, index + 1])
    if (isClosed(shape)) links.push([points.length - 1, 0])
    return links
  }, [points, shape])
  const sequence = points
  const pointsRef = useRef(sequence)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      engine.current?.dispose()
      engine.current = null
    }
  }, [])

  useLayoutEffect(() => {
    pointsRef.current = sequence
    engine.current?.updatePoints(sequence)
  }, [sequence])

  useLayoutEffect(() => { engine.current?.setRate(rate) }, [rate])
  useLayoutEffect(() => { engine.current?.setMaxLowerCutoffHz(maxCutoff) }, [maxCutoff])
  useLayoutEffect(() => { engine.current?.setMixEQ(eqGains) }, [eqGains])
  useEffect(() => () => { if (musicUrl) URL.revokeObjectURL(musicUrl) }, [musicUrl])

  const getAudio = () => {
    if (!engine.current) {
      engine.current = new GlyphSequenceAudio(rate)
      engine.current.setMixEQ(eqGains)
      engine.current.setMaxLowerCutoffHz(maxCutoff)
    }
    return engine.current
  }

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const draw = () => {
      const current = engine.current?.currentPlayback
      if (current) setPlayback(current)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const togglePlayback = async () => {
    if (busy) return
    if (playing) {
      engine.current?.pause()
      setPlaying(false)
      return
    }
    setBusy(true)
    setError(null)
    setPlayback(null)
    try {
      const audio = getAudio()
      engine.current = audio
      const started = await audio.play(pointsRef.current)
      if (mounted.current && started) setPlaying(true)
    } catch {
      engine.current?.stop()
      if (mounted.current) setError("Audio couldn't start. Press Play to try again.")
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const pointerPosition = (event: PointerEvent<SVGElement>) => {
    // Inverse SVG transform handles letterboxing at any canvas aspect ratio.
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x / WIDTH, y: point.y / HEIGHT }
  }
  const startDrag = (event: PointerEvent<SVGElement>) => {
    if (event.button !== 0 || gesture.current) return
    event.stopPropagation()
    const bounds = gridBounds(stageGrid)
    const position = pointerPosition(event)
    gesture.current = { pointer: event.pointerId, ...position, center: { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }, bounds }
    svg.current?.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const applyBounds = (next: Bounds) => {
    updateGrid({ x: (next.left + next.right) / 2, y: (next.top + next.bottom) / 2,
      width: columns === 1 ? grid.width : next.right - next.left, height: rows === 1 ? grid.height : next.bottom - next.top })
  }
  const startResize = (event: PointerEvent<SVGGElement>, handle: ResizeHandle) => {
    event.stopPropagation()
    if (event.button !== 0 || gesture.current) return
    event.preventDefault()
    gesture.current = { pointer: event.pointerId, ...pointerPosition(event), center: safeCenter, bounds, handle }
    svg.current?.setPointerCapture(event.pointerId)
    setDragging(true)
    setResizeHandle(handle)
  }
  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const position = pointerPosition(event)
    if (active.handle) {
      applyBounds(resizedBounds(active.bounds, active.handle, position.x - active.x, position.y - active.y))
    } else {
      const halfWidth = (active.bounds.right - active.bounds.left) / 2
      const halfHeight = (active.bounds.bottom - active.bounds.top) / 2
      updateGrid({ x: clamp(active.center.x + position.x - active.x, halfWidth, 1 - halfWidth),
        y: clamp(active.center.y + position.y - active.y, halfHeight, 1 - halfHeight) })
    }
  }
  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return
    gesture.current = null
    setDragging(false)
    setResizeHandle(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const activePoint = playing ? playback?.point : sequence[(playback?.step ?? 0) % sequence.length]
  const projectedActive = activePoint ? project(activePoint, invertDisplay) : null
  const left = bounds.left * WIDTH, top = bounds.top * HEIGHT
  const right = bounds.right * WIDTH, bottom = bounds.bottom * HEIGHT
  const handlePositions: { key: ResizeHandle; x: number; y: number; label: string }[] = [
    { key: "nw", x: left - 20, y: top - 20, label: "top-left corner" },
    { key: "n", x: (left + right) / 2, y: top - 20, label: "top edge" },
    { key: "ne", x: right + 20, y: top - 20, label: "top-right corner" },
    { key: "e", x: right + 20, y: (top + bottom) / 2, label: "right edge" },
    { key: "se", x: right + 20, y: bottom + 20, label: "bottom-right corner" },
    { key: "s", x: (left + right) / 2, y: bottom + 20, label: "bottom edge" },
    { key: "sw", x: left - 20, y: bottom + 20, label: "bottom-left corner" },
    { key: "w", x: left - 20, y: (top + bottom) / 2, label: "left edge" },
  ]

  // Keep resize targets accessible when the cube reaches the stage edges.
  const handles = handlePositions.filter(handle => columns === 1 ? handle.key === "n" || handle.key === "s" : rows === 2 || handle.key === "e" || handle.key === "w").map(handle => ({ ...handle,
    x: clamp(handle.x, 16, WIDTH - 16), y: clamp(handle.y, 16, HEIGHT - 16),
  }))

  return <main className="flex min-h-dvh items-center bg-[#090f14] px-4 py-6 text-[#e1ebe6] sm:px-8">
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="sr-only">Cube audio grid</h1>
      <div className="overflow-hidden rounded-2xl border border-[#25363e] bg-[#0d171d]">
          <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Draggable dot grid. Drag to move; drag corner or edge handles to resize." tabIndex={0}
            style={resizeHandle ? { cursor: RESIZE_CURSORS[resizeHandle] } : undefined}
            className={`block aspect-[1000/650] w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bddfcb] ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
              event.preventDefault()
              const step = event.shiftKey ? 0.05 : 0.01
              setCenter({ x: clamp(safeCenter.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), halfWidth, 1 - halfWidth),
                y: clamp(safeCenter.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0), halfHeight, 1 - halfHeight) })
            }}>
            <defs><pattern id="moving-grid-stage" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#172b34" strokeWidth="1" /></pattern></defs>
            <rect width={WIDTH} height={HEIGHT} fill="url(#moving-grid-stage)" />
            <path d="M 500 0 V 650 M 0 325 H 1000" stroke="#27424a" strokeDasharray="3 7" />
            <g stroke="#bddfcb" strokeOpacity="0.45" fill="none">
              {edges.map(([from, to]) => {
                const a = project(points[from], invertDisplay), b = project(points[to], invertDisplay)
                return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              })}
            </g>
            {points.map(point => {
              const p = project(point, invertDisplay)
              return <circle key={point.glyphId} cx={p.x} cy={p.y} r={2} fill="#bddfcb" opacity="0.35" pointerEvents="none" />
            })}
            {projectedActive && <circle cx={projectedActive.x} cy={projectedActive.y} r={8 * projectedActive.scale} fill="#bddfcb" stroke="#eef5e9" strokeWidth="1.5" />}
            {handles.map(handle => <g key={handle.key} role="button" tabIndex={0} aria-label={`Resize ${handle.label}`}
              className="group outline-none" style={{ cursor: RESIZE_CURSORS[handle.key] }} onPointerDown={event => startResize(event, handle.key)}
              onKeyDown={event => {
                event.stopPropagation()
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
                event.preventDefault()
                const step = event.shiftKey ? 0.05 : 0.01
                applyBounds(resizedBounds(bounds, handle.key,
                  event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
                  event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0))
              }}>
              <title>{`Drag to resize ${handle.label}`}</title>
              <rect x={handle.x - 16} y={handle.y - 16} width="32" height="32" fill="transparent" />
              <rect x={handle.x - 5} y={handle.y - 5} width="10" height="10" rx="2" fill="#152b26" stroke="#bddfcb" strokeWidth="2" className="group-hover:fill-[#bddfcb] group-focus-visible:fill-[#bddfcb]" pointerEvents="none" />
            </g>)}
          </svg>
      </div>
      <div className="mt-4 overflow-x-auto pb-1">
        <div role="group" aria-label="Shape" className="mx-auto flex w-max min-w-full gap-1 rounded-xl border border-[#25363e] bg-[#0d171d] p-1 sm:min-w-0">
          {SHAPE_ORDER.map(value => <button key={value} type="button" aria-pressed={shape === value}
            aria-label={SHAPES[value].label} title={SHAPES[value].label} onClick={() => setShape(value)}
            className={`flex min-w-[76px] flex-1 flex-col items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bddfcb] ${shape === value ? "bg-[#bddfcb] text-[#172c22]" : "text-[#a9bdc4] hover:bg-[#1b2b32] hover:text-[#e1ebe6]"}`}>
            <ShapeIcon shape={value} />
            <span className="whitespace-nowrap">{SHAPE_NAMES[value]}</span>
          </button>)}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 items-center gap-x-6 gap-y-5 sm:grid-cols-[auto_1fr_1fr_1fr_1fr] sm:gap-x-8">
        <button onClick={() => void togglePlayback()} disabled={busy} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[#bddfcb] px-5 py-3 text-sm font-medium text-[#172c22] disabled:opacity-50 sm:col-span-1">
          {playing ? <Pause size={16} /> : <Play size={16} />}{busy ? "Starting…" : playing ? "Pause" : "Play"}
        </button>
        <Range label="Density" value={density} min={1} max={20} display={`${points.length} points`} onChange={setDensity} />
        <Range label="Speed" value={rate} min={10} max={MAX_RATE} step={1} display={`${rate}/s`} onChange={setRate} />
        <div className="space-y-3">
        {!depth
          ? <Range label="Rotation" value={rotation} min={0} max={360} display={`${rotation}°`} onChange={setRotation} />
          : <Range label="Depth amount" value={depthDb} min={0} max={40} display={`${depthDb} dB`} onChange={setDepthDb} />}
        {depth && <label className="flex items-center gap-2 text-xs text-[#a9bdc4]">
          <input type="checkbox" checked={invertDepth} onChange={event => setInvertDepth(event.target.checked)} className="accent-[#bddfcb]" />
          Invert depth display
        </label>}
        </div>
        <Range label="Volume" value={volumeDb} min={-36} max={12} display={`${volumeDb > 0 ? "+" : ""}${volumeDb} dB`} onChange={setVolumeDb} />
      </div>
      {(shape === "horizontal" || shape === "vertical" || depth) && <div className="mt-5">
        <Range label="Meanders" value={meanders} min={1} max={10} display={`${meanders}`} onChange={setMeanders} />
      </div>}
      <div className="mt-5">
        <Range label="Max lower cutoff" value={maxCutoff} min={100} max={20000} step={100} display={`${(maxCutoff / 1000).toFixed(1)} kHz`} onChange={setMaxCutoff} />
      </div>
      <details className="mt-5 rounded-xl border border-[#25363e] p-4">
        <summary className="cursor-pointer text-sm text-[#bddfcb]">EQ & music</summary>
      <div className="mt-5 grid gap-6 sm:grid-cols-3">
          {["Bass", "Mid", "Treble"].map((label, index) => <Range key={label} label={label} value={eqGains[index]} min={-12} max={12}
            display={`${eqGains[index] > 0 ? "+" : ""}${eqGains[index]} dB`}
            onChange={value => setEqGains(current => current.map((gain, i) => i === index ? value : gain))} />)}
        </div>
        <button className="mt-3 text-xs text-[#a9bdc4]" onClick={() => setEqGains([0, 0, 0])}>Reset EQ</button>
        <div className="mt-5 space-y-3 border-t border-[#25363e] pt-4">
          <label className="block text-xs text-[#a9bdc4]">Music file
            <input type="file" accept="audio/*" className="mt-2 block w-full text-xs" onChange={event => {
              const file = event.target.files?.[0]
              if (!file) return
              music.current?.pause()
              setMusicName(file.name)
              setMusicUrl(URL.createObjectURL(file))
              setError(null)
            }} />
          </label>
          {musicName && <p className="truncate text-xs text-[#a9bdc4]">{musicName}</p>}
          <audio ref={music} src={musicUrl ?? undefined} controls loop preload="metadata" className="w-full" aria-label="Music playback"
            onPlay={event => {
              const element = event.currentTarget
              void getAudio().playMusic(element).catch(() => {
                element.pause()
                setError("Music couldn't start. Press its play button to try again.")
              })
            }} onError={() => { if (musicUrl) setError("This music file couldn't be played. Try another audio file.") }} />
        </div>
      </details>
      {error && <p role="alert" className="mt-4 text-sm text-[#efb99a]">{error}</p>}
    </div>
  </main>
}
