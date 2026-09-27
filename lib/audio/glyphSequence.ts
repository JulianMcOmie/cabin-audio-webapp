import { PositionedAudioService } from "./dotGridAudio"
import { POINTS_PER_SECOND } from "../playback/point-timing"

export const GLYPH_RATE = POINTS_PER_SECOND
export type Vertex = readonly [number, number, number?]
// A connected edge walk keeps playback on the wireframe. Some edges are
// retraced where the solid cannot be drawn in one stroke without doing so.
function wireframe(corners: readonly Vertex[], walk: readonly number[]): Vertex[] {
  const yaw = Math.PI / 5
  const pitch = -Math.PI / 9
  const turned = corners.map(([x, y, z = 0]) => {
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw)
    const rz = -x * Math.sin(yaw) + z * Math.cos(yaw)
    return [rx, y * Math.cos(pitch) - rz * Math.sin(pitch), y * Math.sin(pitch) + rz * Math.cos(pitch)] as const
  })
  const xs = turned.map(v => v[0]), ys = turned.map(v => v[1]), zs = turned.map(v => v[2])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  return walk.map(index => {
    const [x, y, z] = turned[index]
    return [0.5 + (x - cx) / scale, 0.5 + (y - cy) / scale, (z - cz) / scale]
  })
}
export const GLYPHS = [
  { id: "circle", name: "Circle", vertices: Array.from({ length: 33 }, (_, index): Vertex => {
    // Repeat the exact first vertex to close the loop without an extra hit.
    const angle = (index % 32) / 32 * Math.PI * 2 - Math.PI / 2
    return [0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5]
  }) },
  { id: "cube", name: "Cube", vertices: wireframe([
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ], [0, 1, 2, 3, 0, 4, 5, 1, 5, 6, 2, 6, 7, 3, 7, 4, 0]) },
  { id: "pyramid", name: "Pyramid", vertices: wireframe([
    [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [0, -0.5, 0],
  ], [0, 1, 2, 3, 0, 4, 1, 4, 2, 4, 3, 4, 0]) },
  { id: "octahedron", name: "Octahedron", vertices: wireframe([
    [0, -0.65, 0], [-0.5, 0, 0], [0, 0, -0.5], [0.5, 0, 0], [0, 0, 0.5], [0, 0.65, 0],
  ], [0, 1, 2, 0, 3, 2, 5, 1, 4, 3, 5, 4, 0]) },
  { id: "prism", name: "Prism", vertices: wireframe([
    [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0, -0.5, -0.5],
    [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0, -0.5, 0.5],
  ], [0, 1, 2, 0, 3, 4, 1, 4, 5, 2, 5, 3, 0]) },
  { id: "line", name: "Line", vertices: [[0, 0.5], [1, 0.5]] },
  { id: "vertical", name: "Vertical", vertices: [[0.5, 0], [0.5, 1]] },
  { id: "diagonal", name: "Diagonal", vertices: [[0, 1], [1, 0]] },
  { id: "w", name: "W", vertices: [[0, 0], [0.25, 1], [0.5, 0.35], [0.75, 1], [1, 0]] },
  { id: "s", name: "S", vertices: [[1, 0], [0, 0], [0, 0.5], [1, 0.5], [1, 1], [0, 1]] },
  { id: "diamond", name: "Diamond", vertices: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]] },
  { id: "triangle", name: "Triangle", vertices: [[0.5, 0], [1, 1], [0, 1], [0.5, 0]] },
  { id: "square", name: "Square", vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] },
  { id: "z", name: "Z", vertices: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: "chevron", name: "Chevron", vertices: [[0, 1], [0.5, 0], [1, 1]] },
] as const satisfies readonly { id: string; name: string; vertices: readonly Vertex[] }[]

export type GlyphId = typeof GLYPHS[number]["id"]
export interface CanvasGlyph {
  id: string; glyph: GlyphId; vertices: readonly Vertex[]; tiltDb?: number
  pivot?: Vertex
  rotation?: { angle: number; startedAt: number | null }
  zMotion?: { phase: number; startedAt: number | null }
}
const ROTATION_PERIOD_MS = 6000
const Z_MOTION_PERIOD_MS = 4000
export const GLYPH_WIDTH = 0.18
export const GLYPH_HEIGHT = 0.24
export interface GlyphPoint { x: number; y: number; glyphId: string; vertex: boolean; gain: number; depth?: number }

export function isClosedGlyph(id: GlyphId): boolean {
  const vertices = GLYPHS.find(g => g.id === id)!.vertices
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  return first[0] === last[0] && first[1] === last[1] && (first[2] ?? 0) === (last[2] ?? 0)
}

export function linkedVertexIndices(id: GlyphId, index: number): number[] {
  const vertices: readonly Vertex[] = GLYPHS.find(g => g.id === id)!.vertices
  const target = vertices[index]
  return vertices.flatMap((v, i) => v[0] === target[0] && v[1] === target[1] && (v[2] ?? 0) === (target[2] ?? 0) ? [i] : [])
}

export function editableVertexIndices(id: GlyphId): number[] {
  return GLYPHS.find(g => g.id === id)!.vertices.flatMap((_, i) => linkedVertexIndices(id, i)[0] === i ? [i] : [])
}

export function glyphBounds(item: CanvasGlyph) {
  const xs = item.vertices.map(v => v[0])
  const ys = item.vertices.map(v => v[1])
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

export function glyphRotationAngle(item: CanvasGlyph, time: number): number {
  const rotation = item.rotation
  if (!rotation) return 0
  return (rotation.angle + (rotation.startedAt === null ? 0 : Math.max(0, time - rotation.startedAt) / ROTATION_PERIOD_MS * Math.PI * 2)) % (Math.PI * 2)
}

export function glyphZPhase(item: CanvasGlyph, time: number): number {
  const motion = item.zMotion
  if (!motion) return 0
  return (motion.phase + (motion.startedAt === null ? 0 : Math.max(0, time - motion.startedAt) / Z_MOTION_PERIOD_MS * Math.PI * 2)) % (Math.PI * 2)
}

function glyphProjector(item: CanvasGlyph, time: number) {
  const bounds = glyphBounds(item)
  const cx = item.pivot?.[0] ?? (bounds.left + bounds.right) / 2
  const cy = item.pivot?.[1] ?? (bounds.top + bounds.bottom) / 2
  const angle = glyphRotationAngle(item, time)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // Place the virtual listener close enough for depth to be audible, while
  // always keeping it outside the glyph's rotation radius.
  const radius = Math.max(...item.vertices.map(([x, , z = 0]) => Math.hypot(x - cx, z)))
  const listenerDistance = Math.max(0.15, radius * 3)
  // Whole-glyph translation combines with rotation without crossing the listener.
  const zOffset = Math.sin(glyphZPhase(item, time)) * listenerDistance * 0.35
  return (x: number, y: number, depth = 0) => {
    const dx = x - cx
    const dy = y - cy
    const rotatedX = dx * cos + depth * sin
    const z = -dx * sin + depth * cos + zOffset
    const perspective = 2 / (2 - z)
    // Inverse-distance amplitude, relative to this point's unrotated distance.
    // A flat glyph at neutral Z stays at its original volume.
    const flatDistance = Math.hypot(dx, dy, listenerDistance)
    const rotatedDistance = Math.hypot(rotatedX, dy, listenerDistance - z)
    return {
      x: cx + rotatedX * perspective,
      y: cy + dy * perspective,
      z,
      distanceGain: flatDistance / rotatedDistance,
    }
  }
}

export function projectGlyph(item: CanvasGlyph, time: number): CanvasGlyph {
  if (!item.rotation && !item.zMotion && !item.vertices.some(v => v[2])) return item
  const project = glyphProjector(item, time)
  return { ...item, vertices: item.vertices.map(([x, y, z = 0]): Vertex => {
    const position = project(x, y, z)
    return [position.x, position.y, position.z]
  }) }
}

/** Vertices occur once; every connection has exactly `subdivisions` interior points. */
export function makeGlyphSequence(items: readonly CanvasGlyph[], subdivisions: number, time = 0): GlyphPoint[] {
  const points: GlyphPoint[] = []
  const divisions = Math.max(0, Math.min(24, Math.round(subdivisions))) + 1
  items.forEach(item => {
    const vertices = item.vertices
    const first = vertices[0]
    const closed = isClosedGlyph(item.glyph)
    const bounds = glyphBounds(item)
    const width = bounds.right - bounds.left
    const tilt = Math.max(-24, Math.min(24, item.tiltDb ?? 0))
    const project = glyphProjector(item, time)
    const add = (x: number, y: number, z: number, vertex: boolean) => {
      const position = project(x, y, z)
      const tiltGain = width > 1e-8 ? Math.pow(10, tilt * (2 * (x - bounds.left) / width - 1) / 20) : 1
      points.push({
        x: position.x, y: position.y,
        glyphId: item.id, vertex,
        // The volume gradient stays attached to the glyph as it turns.
        gain: tiltGain * position.distanceGain,
      })
    }
    add(first[0], first[1], first[2] ?? 0, true)
    for (let edge = 1; edge < vertices.length; edge++) {
      const from = vertices[edge - 1]
      const to = vertices[edge]
      for (let step = 1; step <= divisions; step++) {
        // Closing a loop returns to its first vertex without playing it twice.
        if (closed && edge === vertices.length - 1 && step === divisions) continue
        const t = step / divisions
        add(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t,
          (from[2] ?? 0) + ((to[2] ?? 0) - (from[2] ?? 0)) * t, step === divisions)
      }
    }
  })
  return points
}

/** A standalone transport using the main canvas's actual sound-generation service. */
export class GlyphSequenceAudio {
  private context = new AudioContext()
  private service = new PositionedAudioService(this.context)
  private points: readonly GlyphPoint[] = []
  private timer: number | null = null
  private startTime = 0
  private nextStep = 0
  private running = false
  private disposed = false
  private revision = 0
  private pausedStep = 0
  private pausedElapsedSeconds = 0
  private playbackOrigin = 0
  private scheduledPoints: { time: number; step: number; elapsedSeconds: number; point: GlyphPoint; points: GlyphPoint[] }[] = []
  private voiceIds: string[] = []
  private mixInput: GainNode | null = null
  private eqFilters: BiquadFilterNode[] = []
  private musicSource: MediaElementAudioSourceNode | null = null

  setMaxLowerCutoffHz(frequency: number): void {
    this.service.setMaxLowerCutoffHz(frequency)
    if (this.points.length) this.updatePoints(this.points, this.voiceIds.length)
  }

  setMixEQ(gains: readonly number[]): void {
    if (!this.mixInput) {
      this.mixInput = this.context.createGain()
      this.service.getOutputNode().disconnect(this.context.destination)
      this.service.getOutputNode().connect(this.mixInput)
      let tail: AudioNode = this.mixInput
      this.eqFilters = [150, 1000, 6000].map((frequency, index) => {
        const filter = this.context.createBiquadFilter()
        filter.type = index === 0 ? "lowshelf" : index === 2 ? "highshelf" : "peaking"
        filter.frequency.value = frequency
        filter.Q.value = 0.7
        tail.connect(filter)
        tail = filter
        return filter
      })
      tail.connect(this.context.destination)
    }
    this.eqFilters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(gains[index] ?? 0, this.context.currentTime, 0.015)
    })
  }

  async playMusic(element: HTMLAudioElement): Promise<void> {
    if (!this.mixInput) this.setMixEQ([0, 0, 0])
    if (!this.musicSource) {
      this.musicSource = this.context.createMediaElementSource(element)
      this.musicSource.connect(this.mixInput!)
    }
    await this.context.resume()
  }

  constructor(
    private rate = GLYPH_RATE,
    private readonly transformPoint?: (point: GlyphPoint, elapsedSeconds: number, step: number) => GlyphPoint | GlyphPoint[],
    voiceCount = 1,
  ) {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Playback rate must be positive")
    this.service.getOutputNode().gain.value = 0
    this.service.setBaseVolumeDb(0)
    this.service.setBandpassSlope(-3.0)
    this.ensureVoices(Math.max(1, Math.floor(voiceCount)))
    this.service.getOutputNode().connect(this.context.destination)
  }

  private ensureVoices(count: number): void {
    while (this.voiceIds.length < count) {
      const index = this.voiceIds.length
      const id = index === 0 ? "glyph" : `glyph-${index}`
      // New grids can join a running transport. Allocate their independent
      // generators silently; their first gain change uses the shared clock.
      this.service.addPoint(id, 0.5, 0.5, 2, 2, 3, true)
      this.voiceIds.push(id)
    }
  }

  async play(points: readonly GlyphPoint[]): Promise<boolean> {
    this.stop(false)
    if (this.disposed || points.length === 0) return false
    this.points = points
    const revision = this.revision
    await this.context.resume()
    if (this.disposed || revision !== this.revision || !this.points.length) return false
    this.running = true
    const resumeTime = this.context.currentTime + 0.03
    this.startTime = resumeTime - this.pausedStep / this.rate
    this.playbackOrigin = resumeTime - this.pausedElapsedSeconds
    this.nextStep = this.pausedStep
    this.service.getOutputNode().gain.setValueAtTime(1, resumeTime)
    this.schedule()
    this.timer = window.setInterval(() => this.schedule(), 20)
    return true
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Playback rate must be positive")
    if (rate === this.rate) return
    if (!this.running) { this.rate = rate; return }
    // Replace the lookahead queue at one audio-clock boundary. Continue with
    // the next dot; the separate elapsed clock keeps depth swaps in seconds.
    const boundary = Math.max(this.context.currentTime + 0.003, this.scheduledPoints[0]?.time ?? 0)
    this.scheduledPoints = this.scheduledPoints.filter(event => event.time < boundary)
    const last = this.scheduledPoints[this.scheduledPoints.length - 1]
    this.nextStep = last ? last.step + 1 : this.pausedStep
    this.rate = rate
    this.startTime = boundary - this.nextStep / rate
    // schedulePositionedHold cancels the previous future pan/filter/gain
    // automation before replacing it, so old-speed notes cannot leak through.
    this.schedule()
  }

  updatePoints(points: readonly GlyphPoint[], voiceCount = 1): void {
    this.points = points
    if (!points.length) { this.stop(); return }
    this.ensureVoices(voiceCount)
    if (!this.running) return
    // Preserve both the clock and the held point. Edits replace only the next
    // boundary onward, including any position already in the lookahead queue.
    const step = Math.max(0, Math.ceil((this.context.currentTime + 0.0005 - this.startTime) * this.rate))
    const boundary = this.startTime + step / this.rate
    this.scheduledPoints = this.scheduledPoints.filter(event => event.time < boundary)
    this.nextStep = step
    this.schedule()
  }

  private schedule(): void {
    if (!this.running || !this.points.length) return
    const now = this.context.currentTime
    // Keep holding the last point after a delayed timer; resume on the original
    // clock's next boundary instead of inserting a gap or bursting stale steps.
    if (this.startTime + this.nextStep / this.rate < now) {
      this.nextStep = Math.max(0, Math.ceil((now + 0.001 - this.startTime) * this.rate))
    }
    while (this.startTime + this.nextStep / this.rate < now + 0.1) {
      const original = this.points[this.nextStep % this.points.length]
      const time = this.startTime + this.nextStep / this.rate
      const elapsedSeconds = Math.max(0, time - this.playbackOrigin)
      const transformed = this.transformPoint?.(original, elapsedSeconds, this.nextStep) ?? original
      const points = (Array.isArray(transformed) ? transformed : [transformed]).map(point => ({ ...point }))
      this.ensureVoices(points.length)
      this.voiceIds.forEach((id, index) => {
        const point = points[index]
        if (point) this.service.schedulePositionedHold(id, point.x, 1 - point.y, time, point.gain)
        else this.service.schedulePointGainOnly(id, time, 0)
      })
      this.scheduledPoints.push({ time, step: this.nextStep, elapsedSeconds, point: points[0], points })
      this.nextStep++
    }
    // Retain the last audible snapshot plus anything still queued for output.
    const audibleTime = this.audibleTime
    while (this.scheduledPoints.length > 1 && this.scheduledPoints[1].time <= audibleTime) {
      this.scheduledPoints.shift()
    }
  }

  private get audibleTime(): number {
    // currentTime is the render clock, ahead of the sound reaching the output.
    // Use the device's timestamp when available so the marker follows hearing.
    const stamp = this.context.getOutputTimestamp?.()
    const outputPerformanceTime = stamp?.performanceTime ?? 0
    const outputContextTime = stamp?.contextTime ?? 0
    if (outputPerformanceTime > 0 && outputContextTime > 0) {
      return Math.min(this.context.currentTime,
        outputContextTime + Math.max(0, performance.now() - outputPerformanceTime) / 1000)
    }
    return this.context.currentTime - (this.context.baseLatency || 0) - (this.context.outputLatency || 0)
  }

  private get currentEvent() {
    if (!this.running) return null
    const time = this.audibleTime
    for (let index = this.scheduledPoints.length - 1; index >= 0; index--) {
      if (this.scheduledPoints[index].time <= time) return this.scheduledPoints[index]
    }
    return null
  }

  get currentPoint(): GlyphPoint | null {
    // Show the exact position/gain that was scheduled, not freshly edited data
    // at an inferred index (which could move ahead of the sound).
    return this.currentEvent?.point ?? null
  }

  get currentPlayback(): { point: GlyphPoint; points: GlyphPoint[]; elapsedSeconds: number; step: number } | null {
    const event = this.currentEvent
    return event ? { point: event.point, points: event.points, elapsedSeconds: event.elapsedSeconds, step: event.step } : null
  }

  pause(): void {
    if (this.running) {
      const event = this.currentEvent
      this.pausedStep = event?.step ?? this.pausedStep
      this.pausedElapsedSeconds = event?.elapsedSeconds ?? this.pausedElapsedSeconds
    }
    this.stop(false)
  }

  stop(resetPosition = true): void {
    if (resetPosition) {
      this.pausedStep = 0
      this.pausedElapsedSeconds = 0
    }
    this.revision++
    this.running = false
    this.scheduledPoints = []
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    const gain = this.service.getOutputNode().gain
    gain.cancelScheduledValues(this.context.currentTime)
    gain.setValueAtTime(0, this.context.currentTime)
    this.voiceIds.forEach(id => this.service.deactivatePoint(id))
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    this.service.dispose()
    this.musicSource?.disconnect()
    this.mixInput?.disconnect()
    this.eqFilters.forEach(filter => filter.disconnect())
    void this.context.close()
  }
}
