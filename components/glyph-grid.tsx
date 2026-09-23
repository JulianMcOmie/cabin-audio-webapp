"use client"

import Link from "next/link"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { ArrowLeft, ArrowLeftRight, Pause, Play, RotateCw, Trash2 } from "lucide-react"
import {
  GLYPHS, GLYPH_WIDTH, GLYPH_HEIGHT, GlyphSequenceAudio, makeGlyphSequence, glyphBounds, editableVertexIndices, linkedVertexIndices, glyphRotationAngle, glyphZPhase, projectGlyph,
  type CanvasGlyph, type GlyphId, type Vertex,
} from "@/lib/audio/glyphSequence"

const WIDTH = 1000
const HEIGHT = 650
// Compensate for canvas aspect ratio so a new circle is round on screen.
const glyphX = (glyph: GlyphId, x: number) => glyph === "circle"
  ? 0.5 + (x - 0.5) * (GLYPH_HEIGHT * HEIGHT) / (GLYPH_WIDTH * WIDTH) : x
const clampPosition = (x: number, y: number) => ({
  x: Math.max(0, Math.min(1 - GLYPH_WIDTH, x)),
  y: Math.max(0, Math.min(1 - GLYPH_HEIGHT, y)),
})
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
type Drag = {
  pointer: number; glyph: GlyphId; id?: string; grabX: number; grabY: number
  original?: CanvasGlyph; start?: Vertex; vertex?: number; resize?: ResizeHandle
}
const clampUnit = (value: number) => Math.max(0, Math.min(1, value))
const vertexPoints = (vertices: readonly Vertex[]) => vertices.map(([x, y]) => `${x * WIDTH},${y * HEIGHT}`).join(" ")

function GlyphIcon({ id }: { id: GlyphId }) {
  const glyph = GLYPHS.find(g => g.id === id)!
  return <svg viewBox="-0.2 -0.2 1.4 1.4" className="h-8 w-8" aria-hidden="true">
    <polyline points={glyph.vertices.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor"
      strokeWidth="0.06" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function GlyphGrid() {
  const [items, setItems] = useState<CanvasGlyph[]>([])
  const [subdivisions, setSubdivisions] = useState(6)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ glyph: GlyphId; x: number; y: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [rotationTime, setRotationTime] = useState(0)
  const svg = useRef<SVGSVGElement | null>(null)
  const drag = useRef<Drag | null>(null)
  const draggingTilt = useRef(false)
  const nextId = useRef(1)
  const engine = useRef<GlyphSequenceAudio | null>(null)
  const mounted = useRef(false)
  const animating = items.some(item => (item.rotation && item.rotation.startedAt !== null) || (item.zMotion && item.zMotion.startedAt !== null))
  const displayedItems = useMemo(() => items.map(item => projectGlyph(item, rotationTime)), [items, rotationTime])
  const points = useMemo(() => makeGlyphSequence(items, subdivisions, rotationTime), [items, subdivisions, rotationTime])
  const pointsRef = useRef(points)
  const grouped = useMemo(() => {
    const result = new Map<string, typeof points>()
    points.forEach(point => {
      const group = result.get(point.glyphId) ?? []
      group.push(point)
      result.set(point.glyphId, group)
    })
    return result
  }, [points])
  const activePoint = playing ? points[activeIndex] : null
  const selectedItem = displayedItems.find(item => item.id === selected)
  const selectedBounds = selectedItem ? glyphBounds(selectedItem) : null

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      engine.current?.dispose()
      engine.current = null
    }
  }, [])

  useLayoutEffect(() => {
    pointsRef.current = points
    engine.current?.updatePoints(points)
    if (!points.length) setPlaying(false)
  }, [points])

  useEffect(() => {
    if (!playing && !animating) return
    let frame = 0
    const draw = (time: number) => {
      if (playing) setActiveIndex(engine.current?.currentIndex ?? -1)
      if (animating) setRotationTime(time)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [playing, animating])

  const toggle = async () => {
    if (busy) return
    if (playing) {
      engine.current?.pause()
      setPlaying(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const audio = engine.current ?? new GlyphSequenceAudio()
      engine.current = audio
      const started = await audio.play(pointsRef.current)
      if (mounted.current && started) setPlaying(true)
    } catch {
      engine.current?.stop()
      if (mounted.current) setError("Audio couldn't start. Try Play again.")
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const canvasPosition = (clientX: number, clientY: number) => {
    const bounds = svg.current!.getBoundingClientRect()
    return {
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height,
      inside: clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom,
    }
  }
  const addGlyph = (glyph: GlyphId, x: number, y: number) => {
    const id = `glyph-${nextId.current++}`
    const position = clampPosition(x, y)
    const vertices: Vertex[] = GLYPHS.find(g => g.id === glyph)!.vertices
      .map(([vx, vy, vz = 0]) => [position.x + glyphX(glyph, vx) * GLYPH_WIDTH, position.y + vy * GLYPH_HEIGHT, vz * GLYPH_WIDTH])
    setItems(current => [...current, { id, glyph, vertices }])
    setSelected(id)
  }
  const moveGlyph = (id: string, x: number, y: number) => {
    setItems(current => current.map(item => {
      if (item.id !== id) return item
      const bounds = glyphBounds(projectGlyph(item, performance.now()))
      const dx = Math.max(-bounds.left, Math.min(1 - bounds.right, x - bounds.left))
      const dy = Math.max(-bounds.top, Math.min(1 - bounds.bottom, y - bounds.top))
      return { ...item,
        pivot: item.pivot ? [item.pivot[0] + dx, item.pivot[1] + dy] as Vertex : undefined,
        vertices: item.vertices.map(([vx, vy, vz = 0]): Vertex => [vx + dx, vy + dy, vz]),
      }
    }))
  }
  const setVertices = (id: string, vertices: readonly Vertex[]) => {
    // Bake the visible pose back into 3D without losing its depth or projecting
    // it a second time. Shared corners remain joined when reshaping a solid.
    setItems(current => current.map(item => {
      if (item.id !== id) return item
      const bounds = glyphBounds({ ...item, vertices })
      const pivot: Vertex = [(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2]
      return { ...item, pivot, rotation: undefined, zMotion: undefined,
        vertices: vertices.map(([x, y, z = 0]): Vertex => [
          pivot[0] + (x - pivot[0]) * (2 - z) / 2,
          pivot[1] + (y - pivot[1]) * (2 - z) / 2,
          z,
        ]),
      }
    }))
  }
  const setTilt = (value: number) => {
    setItems(current => current.map(item => item.id === selected ? { ...item, tiltDb: value } : item))
  }
  const toggleRotation = () => {
    const now = performance.now()
    setRotationTime(now)
    setItems(current => current.map(item => item.id === selected ? {
      ...item,
      rotation: {
        angle: glyphRotationAngle(item, now),
        startedAt: item.rotation && item.rotation.startedAt !== null ? null : now,
      },
    } : item))
  }
  const toggleZMotion = () => {
    const now = performance.now()
    setRotationTime(now)
    setItems(current => current.map(item => item.id === selected ? {
      ...item,
      zMotion: {
        phase: glyphZPhase(item, now),
        startedAt: item.zMotion && item.zMotion.startedAt !== null ? null : now,
      },
    } : item))
  }
  const moveVertex = (item: CanvasGlyph, index: number, x: number, y: number) => {
    const next: Vertex = [clampUnit(x), clampUnit(y), item.vertices[index][2] ?? 0]
    const linked = linkedVertexIndices(item.glyph, index)
    setVertices(item.id, item.vertices.map((vertex, i) =>
      linked.includes(i) ? next : vertex))
  }
  const removeGlyph = (id: string) => {
    setItems(current => current.filter(item => item.id !== id))
    setSelected(current => current === id ? null : current)
  }
  const beginPaletteDrag = (event: PointerEvent<HTMLButtonElement>, glyph: GlyphId) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, glyph, grabX: GLYPH_WIDTH / 2, grabY: GLYPH_HEIGHT / 2 }
  }
  const beginMove = (event: PointerEvent<SVGGElement>, item: CanvasGlyph) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    const position = canvasPosition(event.clientX, event.clientY)
    const bounds = glyphBounds(item)
    drag.current = { pointer: event.pointerId, glyph: item.glyph, id: item.id, grabX: position.x - bounds.left, grabY: position.y - bounds.top }
    setSelected(item.id)
  }
  const beginEdit = (event: PointerEvent<SVGElement>, item: CanvasGlyph, edit: { vertex: number } | { resize: ResizeHandle }) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (item.rotation || item.zMotion) setVertices(item.id, item.vertices)
    event.currentTarget.setPointerCapture(event.pointerId)
    const position = canvasPosition(event.clientX, event.clientY)
    drag.current = { pointer: event.pointerId, glyph: item.glyph, id: item.id, grabX: 0, grabY: 0,
      original: item, start: [position.x, position.y], ...edit }
    setSelected(item.id)
  }
  const moveDrag = (event: PointerEvent<Element>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const position = canvasPosition(event.clientX, event.clientY)
    if (current.original && current.start) {
      const original = current.original
      const dx = position.x - current.start[0]
      const dy = position.y - current.start[1]
      if (current.vertex !== undefined) {
        const vertex = original.vertices[current.vertex]
        moveVertex(original, current.vertex, vertex[0] + dx, vertex[1] + dy)
      } else if (current.resize) {
        const bounds = glyphBounds(original)
        let { left, right, top, bottom } = bounds
        const width = right - left
        const height = bottom - top
        const minimumWidth = Math.min(0.01, width)
        const minimumHeight = Math.min(0.01, height)
        if (current.resize.includes("w")) left = Math.max(0, Math.min(right - minimumWidth, left + dx))
        if (current.resize.includes("e")) right = Math.min(1, Math.max(left + minimumWidth, right + dx))
        if (current.resize.includes("n")) top = Math.max(0, Math.min(bottom - minimumHeight, top + dy))
        if (current.resize.includes("s")) bottom = Math.min(1, Math.max(top + minimumHeight, bottom + dy))
        setVertices(original.id, original.vertices.map(([x, y, z = 0]): Vertex => [
          width > 1e-8 ? left + (x - bounds.left) / width * (right - left) : x,
          height > 1e-8 ? top + (y - bounds.top) / height * (bottom - top) : y,
          z,
        ]))
      }
      return
    }
    const next = clampPosition(position.x - current.grabX, position.y - current.grabY)
    if (current.id) moveGlyph(current.id, position.x - current.grabX, position.y - current.grabY)
    else setPreview(position.inside ? { glyph: current.glyph, ...next } : null)
  }
  const endDrag = (event: PointerEvent<Element>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const position = canvasPosition(event.clientX, event.clientY)
    if (!current.id && position.inside) addGlyph(current.glyph, position.x - current.grabX, position.y - current.grabY)
    drag.current = null
    setPreview(null)
  }
  const cancelDrag = () => { drag.current = null; setPreview(null) }
  const shapePoints = (glyph: GlyphId, x: number, y: number) => GLYPHS.find(g => g.id === glyph)!.vertices
    .map(([vx, vy]) => `${(x + glyphX(glyph, vx) * GLYPH_WIDTH) * WIDTH},${(y + vy * GLYPH_HEIGHT) * HEIGHT}`).join(" ")

  return (
    <main className="min-h-screen bg-[#0c1115] p-4 text-[#e5ebe8] sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex items-center gap-3">
          <Link href="/" aria-label="Back to main canvas" className="text-[#80958a] hover:text-white"><ArrowLeft size={17} /></Link>
          <h1 className="text-sm font-medium">Glyph canvas</h1>
        </header>

        <div aria-label="Glyph palette" className="mb-3 flex gap-2 overflow-x-auto rounded-xl border border-[#26332e] bg-[#111a17] p-2">
          {GLYPHS.map(glyph => <button key={glyph.id} type="button" aria-label={`Drag ${glyph.name} onto canvas, or press Enter to add`}
            title={`Drag ${glyph.name} onto canvas`} onPointerDown={event => beginPaletteDrag(event, glyph.id)}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
            onClick={event => { if (event.detail === 0) addGlyph(glyph.id, 0.5 - GLYPH_WIDTH / 2, 0.5 - GLYPH_HEIGHT / 2) }}
            className="flex w-20 shrink-0 touch-none cursor-grab select-none flex-col items-center gap-1 rounded-lg p-2 text-[#a7c8af] hover:bg-[#21352a] focus-visible:outline focus-visible:outline-[#bce9bb] active:cursor-grabbing">
            <GlyphIcon id={glyph.id} /><span className="text-[10px]">{glyph.name}</span>
          </button>)}
        </div>

        <div className="overflow-hidden rounded-xl border border-[#2b3832] bg-[#111916]">
          <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full touch-none" aria-label="Glyph canvas"
            onPointerDown={event => { if (event.target === event.currentTarget || (event.target as Element).getAttribute("data-background")) setSelected(null) }}>
            <rect data-background="true" width={WIDTH} height={HEIGHT} fill="#111916" />
            {!items.length && !preview && <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" fill="#6f8c77" fontSize="18" pointerEvents="none">Drag a glyph here</text>}
            {displayedItems.map(item => <g key={item.id} role="button" tabIndex={0}
              aria-label={`${GLYPHS.find(g => g.id === item.glyph)?.name}. Drag or use arrow keys to move. Delete to remove.`}
              className="group cursor-grab outline-none active:cursor-grabbing"
              onPointerDown={event => beginMove(event, item)} onPointerMove={moveDrag} onPointerUp={endDrag}
              onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
              onFocus={() => setSelected(item.id)}
              onKeyDown={event => {
                const delta = event.shiftKey ? 0.025 : 0.005
                if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                  event.preventDefault()
                  const bounds = glyphBounds(item)
                  moveGlyph(item.id, bounds.left + (event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0),
                    bounds.top + (event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0))
                } else if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault()
                  removeGlyph(item.id)
                }
              }}>
              <polyline points={vertexPoints(item.vertices)} fill="none" stroke="transparent" strokeWidth="28" strokeLinejoin="round" />
              <polyline points={vertexPoints(item.vertices)} fill="none" stroke={selected === item.id ? "#c4e1bd" : "#65856c"}
                strokeWidth="1.5" strokeLinejoin="round" className="group-hover:stroke-[#d4efcc] group-focus-visible:stroke-[#d4efcc]" />
              {(grouped.get(item.id) ?? []).filter(point => !point.vertex).map((point, index) => <circle key={index} cx={point.x * WIDTH} cy={point.y * HEIGHT} r="2" fill="#78967c" pointerEvents="none" />)}
              {editableVertexIndices(item.glyph).map(index => {
                const [x, y] = item.vertices[index]
                return <g key={index}
                role="button" tabIndex={selected === item.id ? 0 : -1} aria-label={`Move vertex ${index + 1}`}
                className="cursor-crosshair outline-none" onPointerDown={event => beginEdit(event, item, { vertex: index })}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
                  event.preventDefault()
                  event.stopPropagation()
                  const delta = event.shiftKey ? 0.025 : 0.005
                  moveVertex(item, index, x + (event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0),
                    y + (event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0))
                }}>
                <title>Drag to reshape</title>
                <circle cx={x * WIDTH} cy={y * HEIGHT} r="12" fill="transparent" />
                <circle cx={x * WIDTH} cy={y * HEIGHT} r={selected === item.id ? 5 : 4} fill={selected === item.id ? "#111916" : "#c4e1bd"} stroke="#c4e1bd" strokeWidth="2" pointerEvents="none" />
              </g>})}
            </g>)}
            {selectedItem && selectedBounds && (() => {
              const b = selectedBounds
              const left = Math.max(7, b.left * WIDTH - 15)
              const right = Math.min(WIDTH - 7, b.right * WIDTH + 15)
              const top = Math.max(7, b.top * HEIGHT - 15)
              const bottom = Math.min(HEIGHT - 7, b.bottom * HEIGHT + 15)
              const handles: { key: ResizeHandle; x: number; y: number; cursor: string }[] = []
              const hasWidth = b.right - b.left > 1e-8
              const hasHeight = b.bottom - b.top > 1e-8
              if (hasWidth) handles.push({ key: "w", x: left, y: (top + bottom) / 2, cursor: "ew-resize" }, { key: "e", x: right, y: (top + bottom) / 2, cursor: "ew-resize" })
              if (hasHeight) handles.push({ key: "n", x: (left + right) / 2, y: top, cursor: "ns-resize" }, { key: "s", x: (left + right) / 2, y: bottom, cursor: "ns-resize" })
              if (hasWidth && hasHeight) handles.push(
                { key: "nw", x: left, y: top, cursor: "nwse-resize" }, { key: "ne", x: right, y: top, cursor: "nesw-resize" },
                { key: "sw", x: left, y: bottom, cursor: "nesw-resize" }, { key: "se", x: right, y: bottom, cursor: "nwse-resize" })
              return <g onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
                <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#5b7864" strokeDasharray="4 5" pointerEvents="none" />
                {handles.map(handle => <g key={handle.key} style={{ cursor: handle.cursor }}
                  onPointerDown={event => beginEdit(event, selectedItem, { resize: handle.key })}>
                  <title>Drag to resize or stretch</title>
                  <rect x={handle.x - 10} y={handle.y - 10} width="20" height="20" fill="transparent" />
                  <rect x={handle.x - 4} y={handle.y - 4} width="8" height="8" rx="1" fill="#111916" stroke="#a7c8af" strokeWidth="1.5" pointerEvents="none" />
                </g>)}
              </g>
            })()}
            {preview && <polyline points={shapePoints(preview.glyph, preview.x, preview.y)} fill="none" stroke="#bce9bb" strokeWidth="2" strokeDasharray="5 4" opacity="0.7" pointerEvents="none" />}
            {activePoint && <circle cx={activePoint.x * WIDTH} cy={activePoint.y * HEIGHT} r="5" fill="#ffc19a" stroke="#ffe9db" strokeWidth="1.5" pointerEvents="none" />}
          </svg>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => void toggle()} disabled={busy || !points.length}
            className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-[#c3e8b9] px-5 py-3 text-sm font-medium text-[#152719] hover:bg-[#d6f2ce] disabled:opacity-35">
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{busy ? "Starting…" : playing ? "Pause" : "Play"}
          </button>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#8eaa98]">
            {selectedItem && <button type="button" onClick={toggleRotation}
              aria-pressed={!!selectedItem.rotation && selectedItem.rotation.startedAt !== null}
              title="Rotate around the glyph's centered vertical axis; one turn every 6 seconds"
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${selectedItem.rotation && selectedItem.rotation.startedAt !== null ? "border-[#a7c8af] text-[#c4e1bd]" : "border-[#354b3b] hover:text-[#c4e1bd]"}`}>
              <RotateCw size={15} />{selectedItem.rotation && selectedItem.rotation.startedAt !== null ? "Stop rotation" : "Rotate Y"}
            </button>}
            {selectedItem && <button type="button" onClick={toggleZMotion}
              aria-pressed={!!selectedItem.zMotion && selectedItem.zMotion.startedAt !== null}
              title="Move toward and away from you every 4 seconds, changing volume and perspective"
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${selectedItem.zMotion && selectedItem.zMotion.startedAt !== null ? "border-[#a7c8af] text-[#c4e1bd]" : "border-[#354b3b] hover:text-[#c4e1bd]"}`}>
              <ArrowLeftRight size={15} />{selectedItem.zMotion && selectedItem.zMotion.startedAt !== null ? "Stop Z motion" : "Back & forth Z"}
            </button>}
            {selectedItem && <div className="w-44">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor="glyph-volume-tilt">Volume tilt</label>
                <button type="button" onClick={() => setTilt(0)} aria-label="Reset volume tilt to neutral" title="Click to reset to neutral" className="tabular-nums text-[#c4e1bd] hover:text-white">
                  {!(selectedItem.tiltDb ?? 0) ? "Neutral" : `${(selectedItem.tiltDb ?? 0) < 0 ? "L" : "R"} +${Math.abs(selectedItem.tiltDb ?? 0)} dB`}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden="true">L</span>
                <div className="relative flex flex-1 items-center">
                  <span aria-hidden="true" className="pointer-events-none absolute left-1/2 h-4 w-px bg-[#c4e1bd]/50" />
                  <input id="glyph-volume-tilt" type="range" min={-24} max={24} step={1} value={selectedItem.tiltDb ?? 0}
                    aria-valuetext={(selectedItem.tiltDb ?? 0) === 0 ? "Neutral" : `${Math.abs(selectedItem.tiltDb ?? 0)} decibels toward ${(selectedItem.tiltDb ?? 0) < 0 ? "left" : "right"}`}
                    onPointerDown={event => { draggingTilt.current = true; event.currentTarget.setPointerCapture(event.pointerId) }}
                    onPointerUp={() => { draggingTilt.current = false }} onPointerCancel={() => { draggingTilt.current = false }} onLostPointerCapture={() => { draggingTilt.current = false }}
                    onChange={event => {
                      const value = Number(event.target.value)
                      setTilt(draggingTilt.current && Math.abs(value) <= 1 ? 0 : value)
                    }}
                    className="relative w-full accent-[#c3e8b9]" />
                </div>
                <span aria-hidden="true">R</span>
              </div>
            </div>}
            <label className="flex items-center gap-2">Points between vertices
              <input aria-label="Points between vertices" type="number" min={0} max={24} value={subdivisions}
                onChange={event => setSubdivisions(Math.max(0, Math.min(24, Math.round(Number(event.target.value) || 0))))}
                className="w-12 rounded border border-[#354b3b] bg-transparent p-1 text-center text-[#c4e1bd]" />
            </label>
            <button type="button" disabled={!selected} onClick={() => selected && removeGlyph(selected)} aria-label="Delete selected glyph" title="Delete selected glyph" className="p-2 hover:text-[#ffc19a] disabled:opacity-25"><Trash2 size={16} /></button>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-[#ffc19a]">{error}</p>}
      </div>
    </main>
  )
}
