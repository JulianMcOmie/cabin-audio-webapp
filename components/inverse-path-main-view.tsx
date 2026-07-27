"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { Pause, Play } from "lucide-react"
import { InversePathSettingsPanel } from "@/components/inverse-path-settings-panel"
import * as inversePathAudio from "@/lib/audio/inversePathAudio"
import { getAudioContextState, resumeAudioContext } from "@/lib/audio/audioContext"

const SPEED_MIN = 0.05
const SPEED_MAX = 64
const DEFAULT_SPEED = 32
const HIT_RATE_MIN_HZ = 0.5
const HIT_RATE_MAX_HZ = 24
const DEFAULT_HIT_RATE_HZ = 4
const DEFAULT_HIT_RELEASE_SECONDS = inversePathAudio.DEFAULT_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS
const HIT_RELEASE_MIN_SECONDS = inversePathAudio.MIN_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS
const HIT_RELEASE_MAX_SECONDS = inversePathAudio.MAX_LINE_INVERSE_DOT_HIT_RELEASE_SECONDS
const MIN_PER_HIT_MS = 30
const MAX_PER_HIT_MS = 2500
const SPEED_INTERVAL_MULTIPLIER = 2
const DEFAULT_VOLUME_DB = 0
const VOLUME_MIN_DB = -60
const VOLUME_MAX_DB = 24
const DEFAULT_BANDWIDTH_OCTAVES = 6
const BANDWIDTH_MIN_OCTAVES = 0.25
const BANDWIDTH_MAX_OCTAVES = 10
const DEFAULT_LINE_CENTER: NormalizedPoint = { normalizedX: 0.5, normalizedY: 0.5 }
const DEFAULT_LINE_LENGTH = 0.5
const DEFAULT_LINE_ANGLE_RAD = 0
const DEFAULT_V_BRANCH_ANGLE_RAD = Math.PI / 4
const DEFAULT_S_WIDTH = 0.55
const DEFAULT_S_HEIGHT = 0.7
const DEFAULT_CIRCLE_RADIUS = 0.28
const DEFAULT_CIRCLE_COUNT = 1
const DEFAULT_CIRCLE_PLAYBACK_MODE: CirclePlaybackMode = "motion"
const DEFAULT_CIRCLE_MOTION_DOT_COUNT = 1
const CIRCLE_MOTION_DOT_COUNT_MIN = 1
const CIRCLE_MOTION_DOT_COUNT_MAX = 4
const DEFAULT_CIRCLE_DOT_COUNT = 8
const CIRCLE_DOT_COUNT_MIN = 2
const CIRCLE_DOT_COUNT_MAX = 24
const DEFAULT_ADDITIONAL_CIRCLE_CENTER_OFFSETS: NormalizedPoint[] = [
  { normalizedX: -0.15, normalizedY: 0 },
  { normalizedX: 0.15, normalizedY: 0 },
  { normalizedX: 0, normalizedY: -0.15 },
]
const CIRCLE_COUNT_MIN = 1
const CIRCLE_COUNT_MAX = 4
const DEFAULT_LINE_PATH_SECONDS = 4
const DEFAULT_LINE_STEP_COUNT = 4
const LINE_STEP_COUNT_MIN = 2
const LINE_STEP_COUNT_MAX = 8
const MIN_LINE_LENGTH = 0.02
const MAX_LINE_LENGTH = Math.SQRT2
const MIN_S_SIZE = 0.04
const MIN_CIRCLE_RADIUS = 0.02
const MIN_LINE_PATH_PASS_SECONDS = 0.05
const DEFAULT_LINE_ENDPOINT_GAIN_DB = 0
const LINE_ENDPOINT_GAIN_MIN_DB = -60
const LINE_ENDPOINT_GAIN_MAX_DB = 24
const DEFAULT_CIRCLE_X_TILT_DB = 0
const DEFAULT_CIRCLE_Y_TILT_DB = 0
const CIRCLE_TILT_MIN_DB = -24
const CIRCLE_TILT_MAX_DB = 24
const LINE_DEPTH_FULL_SCALE_DB = LINE_ENDPOINT_GAIN_MAX_DB - LINE_ENDPOINT_GAIN_MIN_DB
const S_PATH_DISTANCE_SAMPLES = 96
const SINE_PATH_DISTANCE_SAMPLES = 96
const SINE_PATH_RENDER_SAMPLES = 72
const CIRCLE_PATH_DISTANCE_SAMPLES = 128
const CIRCLE_VISIBLE_ARC_SAMPLES = 360
const SOUNDSTAGE_EPSILON = 0.000001

type NormalizedPoint = { normalizedX: number; normalizedY: number }
type LineEndpoints = [NormalizedPoint, NormalizedPoint]
type PathPattern = "line" | "line-steps" | "v" | "s" | "sine" | "circle"
type CirclePlaybackMode = "motion" | "all"
type LineDragMode = "move" | "start" | "end" | "width"
type SurfaceSize = { width: number; height: number }
type LineStepPoint = {
  point: NormalizedPoint
  gain: number
}
type CirclePathPlayhead = LineStepPoint & {
  t: number
}
type CircleMotionArc = {
  isFullLoop: boolean
  startT: number
  spanT: number
}
type LineDragState = {
  pointerId: number
  pattern: PathPattern
  mode: LineDragMode
  circleIndex: number
  startPointer: NormalizedPoint
  startCenter: NormalizedPoint
  startLength: number
  startWidth: number
  startHeight: number
  startAngle: number
  startEndpoints: LineEndpoints
}
type SegmentVisual = ReturnType<typeof getSegmentVisual>
type CubicSegment = [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
type VPathGeometry = {
  vertex: NormalizedPoint
  left: NormalizedPoint
  right: NormalizedPoint
  branchLength: number
  branchAngle: number
  leftSegment: SegmentVisual
  rightSegment: SegmentVisual
}
type SPathGeometry = {
  center: NormalizedPoint
  width: number
  height: number
  start: NormalizedPoint
  end: NormalizedPoint
  rightHandle: NormalizedPoint
  leftHandle: NormalizedPoint
  segments: [CubicSegment, CubicSegment]
  pathD: string
}
type SinePathGeometry = {
  center: NormalizedPoint
  width: number
  height: number
  start: NormalizedPoint
  end: NormalizedPoint
  top: NormalizedPoint
  bottom: NormalizedPoint
  rightHandle: NormalizedPoint
  leftHandle: NormalizedPoint
  pathD: string
}
type CirclePathGeometry = {
  center: NormalizedPoint
  radius: number
  xRadius: number
  yRadius: number
  start: NormalizedPoint
  end: NormalizedPoint
  right: NormalizedPoint
  left: NormalizedPoint
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function normalizeLoopT(value: number): number {
  return ((value % 1) + 1) % 1
}

function isPointInSoundstage(point: NormalizedPoint): boolean {
  return (
    point.normalizedX >= -SOUNDSTAGE_EPSILON &&
    point.normalizedX <= 1 + SOUNDSTAGE_EPSILON &&
    point.normalizedY >= -SOUNDSTAGE_EPSILON &&
    point.normalizedY <= 1 + SOUNDSTAGE_EPSILON
  )
}

function dbToLinearGain(db: number): number {
  return Math.pow(10, db / 20)
}

function speedToPerHitSeconds(speed: number): number {
  const t = clamp((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN), 0, 1)
  const perHitMs = MAX_PER_HIT_MS * Math.pow(MIN_PER_HIT_MS / MAX_PER_HIT_MS, t)
  return (perHitMs * SPEED_INTERVAL_MULTIPLIER) / 1000
}

function hitRateToIntervalSeconds(hitRateHz: number): number {
  return 1 / clamp(hitRateHz, HIT_RATE_MIN_HZ, HIT_RATE_MAX_HZ)
}

const DEFAULT_LINE_PATH_PER_HIT_SECONDS = speedToPerHitSeconds(DEFAULT_SPEED)

function getLinePathDistance(lineLength: number, startGainDb: number, endGainDb: number): number {
  const depthDistance = Math.abs(endGainDb - startGainDb) / LINE_DEPTH_FULL_SCALE_DB
  return Math.sqrt(lineLength * lineLength + depthDistance * depthDistance)
}

function getVPathDistance(branchLength: number, startGainDb: number, endGainDb: number): number {
  const branchDepthDistance = Math.abs(endGainDb - startGainDb) / LINE_DEPTH_FULL_SCALE_DB / 2
  return 2 * Math.sqrt(branchLength * branchLength + branchDepthDistance * branchDepthDistance)
}

function getPathDistance(
  pattern: PathPattern,
  lineLength: number,
  sGeometry: SPathGeometry,
  sineGeometry: SinePathGeometry,
  circleGeometry: CirclePathGeometry,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): number {
  if (pattern === "circle") {
    return getCirclePathDistance(circleGeometry, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb)
  }
  if (pattern === "s") {
    return getSPathDistance(sGeometry, startGainDb, endGainDb)
  }
  if (pattern === "sine") {
    return getSinePathDistance(sineGeometry, startGainDb, endGainDb)
  }
  if (pattern === "v") {
    return getVPathDistance(lineLength, startGainDb, endGainDb)
  }
  return getLinePathDistance(lineLength, startGainDb, endGainDb)
}

function getLinePathPassSeconds(
  pattern: PathPattern,
  lineLength: number,
  sGeometry: SPathGeometry,
  sineGeometry: SinePathGeometry,
  circleGeometry: CirclePathGeometry,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number,
  perHitSeconds: number
): number {
  const defaultLineSpeed = DEFAULT_LINE_LENGTH / DEFAULT_LINE_PATH_SECONDS
  const speedMultiplier = DEFAULT_LINE_PATH_PER_HIT_SECONDS / Math.max(0.001, perHitSeconds)
  const normalizedUnitsPerSecond = Math.max(0.001, defaultLineSpeed * speedMultiplier)
  const pathDistance = getPathDistance(
    pattern,
    lineLength,
    sGeometry,
    sineGeometry,
    circleGeometry,
    startGainDb,
    endGainDb,
    circleXTiltDb,
    circleYTiltDb
  )
  return Math.max(MIN_LINE_PATH_PASS_SECONDS, Math.max(MIN_LINE_LENGTH, pathDistance) / normalizedUnitsPerSecond)
}

function clampLineLength(length: number): number {
  return clamp(length, MIN_LINE_LENGTH, MAX_LINE_LENGTH)
}

function clampLineStepCount(count: number): number {
  return Math.round(clamp(Number.isFinite(count) ? count : DEFAULT_LINE_STEP_COUNT, LINE_STEP_COUNT_MIN, LINE_STEP_COUNT_MAX))
}

function clampCircleCount(count: number): number {
  return Math.round(clamp(Number.isFinite(count) ? count : DEFAULT_CIRCLE_COUNT, CIRCLE_COUNT_MIN, CIRCLE_COUNT_MAX))
}

function clampCircleMotionDotCount(count: number): number {
  return Math.round(clamp(
    Number.isFinite(count) ? count : DEFAULT_CIRCLE_MOTION_DOT_COUNT,
    CIRCLE_MOTION_DOT_COUNT_MIN,
    CIRCLE_MOTION_DOT_COUNT_MAX
  ))
}

function clampCircleDotCount(count: number): number {
  return Math.round(clamp(
    Number.isFinite(count) ? count : DEFAULT_CIRCLE_DOT_COUNT,
    CIRCLE_DOT_COUNT_MIN,
    CIRCLE_DOT_COUNT_MAX
  ))
}

function getNormalizedPointFromSetting(value: unknown, fallback: NormalizedPoint): NormalizedPoint {
  if (!value || typeof value !== "object") return { ...fallback }
  const point = value as { normalizedX?: unknown; normalizedY?: unknown }
  return {
    normalizedX: typeof point.normalizedX === "number" ? clamp01(point.normalizedX) : fallback.normalizedX,
    normalizedY: typeof point.normalizedY === "number" ? clamp01(point.normalizedY) : fallback.normalizedY,
  }
}

function getDefaultAdditionalCircleCenter(index: number, primaryCenter = DEFAULT_LINE_CENTER): NormalizedPoint {
  const offset = DEFAULT_ADDITIONAL_CIRCLE_CENTER_OFFSETS[index] ?? { normalizedX: 0, normalizedY: 0 }
  return {
    normalizedX: clamp01(primaryCenter.normalizedX + offset.normalizedX),
    normalizedY: clamp01(primaryCenter.normalizedY + offset.normalizedY),
  }
}

function normalizeAdditionalCircleCenters(centers: unknown, primaryCenter = DEFAULT_LINE_CENTER): NormalizedPoint[] {
  const values = Array.isArray(centers) ? centers : []
  return Array.from({ length: CIRCLE_COUNT_MAX - 1 }, (_, index) =>
    getNormalizedPointFromSetting(values[index], getDefaultAdditionalCircleCenter(index, primaryCenter))
  )
}

function clampLineCenter(center: NormalizedPoint, length: number, angle: number): NormalizedPoint {
  const halfX = Math.abs(Math.cos(angle)) * length * 0.5
  const halfY = Math.abs(Math.sin(angle)) * length * 0.5
  return {
    normalizedX: clamp(center.normalizedX, halfX, 1 - halfX),
    normalizedY: clamp(center.normalizedY, halfY, 1 - halfY),
  }
}

function getNormalizedVBranchAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle)))
}

function getVBranchDelta(length: number, angle: number): { dx: number; dy: number; angle: number } {
  const branchAngle = getNormalizedVBranchAngle(angle)
  return {
    dx: Math.abs(Math.cos(branchAngle)) * length,
    dy: Math.sin(branchAngle) * length,
    angle: branchAngle,
  }
}

function getMaxVBranchLength(vertex: NormalizedPoint, angle: number): number {
  const branchAngle = getNormalizedVBranchAngle(angle)
  const dxUnit = Math.abs(Math.cos(branchAngle))
  const dyUnit = Math.sin(branchAngle)
  const limits = [MAX_LINE_LENGTH]

  if (dxUnit > 0.0001) {
    limits.push(vertex.normalizedX / dxUnit, (1 - vertex.normalizedX) / dxUnit)
  }
  if (dyUnit > 0.0001) {
    limits.push((1 - vertex.normalizedY) / dyUnit)
  } else if (dyUnit < -0.0001) {
    limits.push(vertex.normalizedY / -dyUnit)
  }

  return Math.max(MIN_LINE_LENGTH, Math.min(...limits.filter((value) => Number.isFinite(value) && value > 0)))
}

function clampVBranchLength(length: number, vertex: NormalizedPoint, angle: number): number {
  return clamp(length, MIN_LINE_LENGTH, getMaxVBranchLength(vertex, angle))
}

function clampVVertex(vertex: NormalizedPoint, length: number, angle: number): NormalizedPoint {
  const { dx, dy } = getVBranchDelta(length, angle)
  const minX = clamp(dx, 0, 0.5)
  const maxX = 1 - minX
  const minY = clamp(Math.max(0, -dy), 0, 1)
  const maxY = clamp(Math.min(1, 1 - dy), 0, 1)
  return {
    normalizedX: clamp(vertex.normalizedX, minX, maxX),
    normalizedY: clamp(vertex.normalizedY, Math.min(minY, maxY), Math.max(minY, maxY)),
  }
}

function getLineEndpoints(center: NormalizedPoint, length: number, angle: number): LineEndpoints {
  const safeLength = clampLineLength(length)
  const safeCenter = clampLineCenter(center, safeLength, angle)
  const dx = Math.cos(angle) * safeLength * 0.5
  const dy = Math.sin(angle) * safeLength * 0.5
  return [
    { normalizedX: clamp01(safeCenter.normalizedX - dx), normalizedY: clamp01(safeCenter.normalizedY - dy) },
    { normalizedX: clamp01(safeCenter.normalizedX + dx), normalizedY: clamp01(safeCenter.normalizedY + dy) },
  ]
}

function getSegmentVisual(start: NormalizedPoint, end: NormalizedPoint) {
  const startLeft = start.normalizedX * 100
  const startTop = (1 - start.normalizedY) * 100
  const endLeft = end.normalizedX * 100
  const endTop = (1 - end.normalizedY) * 100
  const deltaX = endLeft - startLeft
  const deltaY = endTop - startTop
  const width = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  return {
    startLeft,
    startTop,
    endLeft,
    endTop,
    centerLeft: (startLeft + endLeft) / 2,
    centerTop: (startTop + endTop) / 2,
    width,
    screenAngle: Math.atan2(deltaY, deltaX),
  }
}

function getLineVisual([start, end]: LineEndpoints) {
  const segment = getSegmentVisual(start, end)
  return {
    ...segment,
    centerLeft: (segment.startLeft + segment.endLeft) / 2,
    centerTop: (segment.startTop + segment.endTop) / 2,
  }
}

function getVPathGeometry(vertex: NormalizedPoint, length: number, angle: number): VPathGeometry {
  const branchAngle = getNormalizedVBranchAngle(angle)
  const branchLength = clampVBranchLength(length, vertex, branchAngle)
  const safeVertex = clampVVertex(vertex, branchLength, branchAngle)
  const { dx, dy } = getVBranchDelta(branchLength, branchAngle)
  const left = {
    normalizedX: clamp01(safeVertex.normalizedX - dx),
    normalizedY: clamp01(safeVertex.normalizedY + dy),
  }
  const right = {
    normalizedX: clamp01(safeVertex.normalizedX + dx),
    normalizedY: clamp01(safeVertex.normalizedY + dy),
  }

  return {
    vertex: safeVertex,
    left,
    right,
    branchLength,
    branchAngle,
    leftSegment: getSegmentVisual(left, safeVertex),
    rightSegment: getSegmentVisual(safeVertex, right),
  }
}

function clampSWidth(width: number, center: NormalizedPoint): number {
  const maxWidth = Math.max(MIN_S_SIZE, 2 * Math.min(center.normalizedX, 1 - center.normalizedX))
  return clamp(Number.isFinite(width) ? width : DEFAULT_S_WIDTH, MIN_S_SIZE, maxWidth)
}

function clampSHeight(height: number, center: NormalizedPoint): number {
  const maxHeight = Math.max(MIN_S_SIZE, 2 * Math.min(center.normalizedY, 1 - center.normalizedY))
  return clamp(Number.isFinite(height) ? height : DEFAULT_S_HEIGHT, MIN_S_SIZE, maxHeight)
}

function clampSCenter(center: NormalizedPoint, width: number, height: number): NormalizedPoint {
  const halfWidth = clamp(width, MIN_S_SIZE, 1) * 0.5
  const halfHeight = clamp(height, MIN_S_SIZE, 1) * 0.5
  return {
    normalizedX: clamp(center.normalizedX, halfWidth, 1 - halfWidth),
    normalizedY: clamp(center.normalizedY, halfHeight, 1 - halfHeight),
  }
}

function getCubicPoint(segment: CubicSegment, t: number): NormalizedPoint {
  const safeT = clamp01(t)
  const invT = 1 - safeT
  const [p0, p1, p2, p3] = segment
  return {
    normalizedX:
      invT * invT * invT * p0.normalizedX +
      3 * invT * invT * safeT * p1.normalizedX +
      3 * invT * safeT * safeT * p2.normalizedX +
      safeT * safeT * safeT * p3.normalizedX,
    normalizedY:
      invT * invT * invT * p0.normalizedY +
      3 * invT * invT * safeT * p1.normalizedY +
      3 * invT * safeT * safeT * p2.normalizedY +
      safeT * safeT * safeT * p3.normalizedY,
  }
}

function getSvgPoint(point: NormalizedPoint): string {
  return `${(point.normalizedX * 100).toFixed(3)} ${((1 - point.normalizedY) * 100).toFixed(3)}`
}

function getSPathGeometry(center: NormalizedPoint, width: number, height: number): SPathGeometry {
  const safeWidth = clampSWidth(width, center)
  const safeHeight = clampSHeight(height, center)
  const safeCenter = clampSCenter(center, safeWidth, safeHeight)
  const halfWidth = safeWidth * 0.5
  const halfHeight = safeHeight * 0.5
  const start = { normalizedX: safeCenter.normalizedX, normalizedY: safeCenter.normalizedY + halfHeight }
  const middle = { ...safeCenter }
  const end = { normalizedX: safeCenter.normalizedX, normalizedY: safeCenter.normalizedY - halfHeight }
  const rightHandle = { normalizedX: safeCenter.normalizedX + halfWidth, normalizedY: safeCenter.normalizedY + halfHeight * 0.5 }
  const leftHandle = { normalizedX: safeCenter.normalizedX - halfWidth, normalizedY: safeCenter.normalizedY - halfHeight * 0.5 }
  const topRight = { normalizedX: safeCenter.normalizedX + halfWidth, normalizedY: safeCenter.normalizedY + halfHeight }
  const midRight = { normalizedX: safeCenter.normalizedX + halfWidth, normalizedY: safeCenter.normalizedY }
  const midLeft = { normalizedX: safeCenter.normalizedX - halfWidth, normalizedY: safeCenter.normalizedY }
  const bottomLeft = { normalizedX: safeCenter.normalizedX - halfWidth, normalizedY: safeCenter.normalizedY - halfHeight }
  const segments: [CubicSegment, CubicSegment] = [
    [start, topRight, midRight, middle],
    [middle, midLeft, bottomLeft, end],
  ]

  return {
    center: safeCenter,
    width: safeWidth,
    height: safeHeight,
    start,
    end,
    rightHandle,
    leftHandle,
    segments,
    pathD: `M ${getSvgPoint(start)} C ${getSvgPoint(topRight)} ${getSvgPoint(midRight)} ${getSvgPoint(middle)} C ${getSvgPoint(midLeft)} ${getSvgPoint(bottomLeft)} ${getSvgPoint(end)}`,
  }
}

function getSinePathPointAtT(geometry: Pick<SinePathGeometry, "center" | "width" | "height">, t: number): NormalizedPoint {
  const safeT = clamp01(t)
  const halfWidth = geometry.width * 0.5
  const halfHeight = geometry.height * 0.5
  return {
    normalizedX: geometry.center.normalizedX - halfWidth + geometry.width * safeT,
    normalizedY: geometry.center.normalizedY + Math.sin(Math.PI * 2 * safeT) * halfHeight,
  }
}

function getSinePathGeometry(center: NormalizedPoint, width: number, height: number): SinePathGeometry {
  const safeWidth = clampSWidth(width, center)
  const safeHeight = clampSHeight(height, center)
  const safeCenter = clampSCenter(center, safeWidth, safeHeight)
  const halfWidth = safeWidth * 0.5
  const halfHeight = safeHeight * 0.5
  const geometryBase: Omit<SinePathGeometry, "pathD"> = {
    center: safeCenter,
    width: safeWidth,
    height: safeHeight,
    start: { normalizedX: safeCenter.normalizedX - halfWidth, normalizedY: safeCenter.normalizedY },
    end: { normalizedX: safeCenter.normalizedX + halfWidth, normalizedY: safeCenter.normalizedY },
    top: { normalizedX: safeCenter.normalizedX - safeWidth * 0.25, normalizedY: safeCenter.normalizedY + halfHeight },
    bottom: { normalizedX: safeCenter.normalizedX + safeWidth * 0.25, normalizedY: safeCenter.normalizedY - halfHeight },
    rightHandle: { normalizedX: safeCenter.normalizedX + halfWidth, normalizedY: safeCenter.normalizedY },
    leftHandle: { normalizedX: safeCenter.normalizedX - halfWidth, normalizedY: safeCenter.normalizedY },
  }
  const samples = Array.from({ length: SINE_PATH_RENDER_SAMPLES + 1 }, (_, index) =>
    getSvgPoint(getSinePathPointAtT(geometryBase, index / SINE_PATH_RENDER_SAMPLES))
  )

  return {
    ...geometryBase,
    pathD: `M ${samples.join(" L ")}`,
  }
}

function getSurfaceMinDimension(surfaceSize: SurfaceSize): number {
  return Math.max(1, Math.min(surfaceSize.width || 1, surfaceSize.height || 1))
}

function getCircleAxisScale(surfaceSize: SurfaceSize): { xScale: number; yScale: number } {
  const minDimension = getSurfaceMinDimension(surfaceSize)
  return {
    xScale: minDimension / Math.max(1, surfaceSize.width),
    yScale: minDimension / Math.max(1, surfaceSize.height),
  }
}

function getMaxCircleRadius(center: NormalizedPoint, surfaceSize: SurfaceSize): number {
  void center
  void surfaceSize
  return 0.5
}

function clampCircleRadius(radius: number, center: NormalizedPoint, surfaceSize: SurfaceSize): number {
  return clamp(
    Number.isFinite(radius) ? radius : DEFAULT_CIRCLE_RADIUS,
    MIN_CIRCLE_RADIUS,
    getMaxCircleRadius(center, surfaceSize)
  )
}

function clampCircleCenter(center: NormalizedPoint, radius: number, surfaceSize: SurfaceSize): NormalizedPoint {
  void radius
  void surfaceSize
  return {
    normalizedX: clamp01(center.normalizedX),
    normalizedY: clamp01(center.normalizedY),
  }
}

function getCirclePathGeometry(center: NormalizedPoint, radius: number, surfaceSize: SurfaceSize): CirclePathGeometry {
  const safeRadius = clampCircleRadius(radius, center, surfaceSize)
  const safeCenter = clampCircleCenter(center, safeRadius, surfaceSize)
  const finalRadius = clampCircleRadius(safeRadius, safeCenter, surfaceSize)
  const { xScale, yScale } = getCircleAxisScale(surfaceSize)
  const xRadius = finalRadius * xScale
  const yRadius = finalRadius * yScale

  return {
    center: safeCenter,
    radius: finalRadius,
    xRadius,
    yRadius,
    start: { normalizedX: safeCenter.normalizedX, normalizedY: safeCenter.normalizedY + yRadius },
    end: { normalizedX: safeCenter.normalizedX, normalizedY: safeCenter.normalizedY - yRadius },
    right: { normalizedX: safeCenter.normalizedX + xRadius, normalizedY: safeCenter.normalizedY },
    left: { normalizedX: safeCenter.normalizedX - xRadius, normalizedY: safeCenter.normalizedY },
  }
}

function getLinePointAtT([start, end]: LineEndpoints, t: number): NormalizedPoint {
  const safeT = clamp01(t)
  return {
    normalizedX: start.normalizedX + (end.normalizedX - start.normalizedX) * safeT,
    normalizedY: start.normalizedY + (end.normalizedY - start.normalizedY) * safeT,
  }
}

function getCirclePathPointAtT(geometry: CirclePathGeometry, t: number): NormalizedPoint {
  const angle = Math.PI * 2 * normalizeLoopT(t)
  return {
    normalizedX: geometry.center.normalizedX + geometry.xRadius * Math.sin(angle),
    normalizedY: geometry.center.normalizedY + geometry.yRadius * Math.cos(angle),
  }
}

function getCircleMotionArc(geometry: CirclePathGeometry): CircleMotionArc {
  const insideSamples = Array.from({ length: CIRCLE_VISIBLE_ARC_SAMPLES }, (_, index) =>
    isPointInSoundstage(getCirclePathPointAtT(geometry, index / CIRCLE_VISIBLE_ARC_SAMPLES))
  )
  if (insideSamples.every(Boolean)) {
    return { isFullLoop: true, startT: 0, spanT: 1 }
  }
  if (!insideSamples.some(Boolean)) {
    return { isFullLoop: false, startT: 0, spanT: 0 }
  }

  const falseIndex = insideSamples.findIndex((inside) => !inside)
  const scanStart = (falseIndex + 1) % CIRCLE_VISIBLE_ARC_SAMPLES
  let bestStartOffset = 0
  let bestEndOffset = 0
  let bestLength = -1
  let currentStartOffset: number | null = null

  for (let offset = 0; offset < CIRCLE_VISIBLE_ARC_SAMPLES; offset += 1) {
    const index = (scanStart + offset) % CIRCLE_VISIBLE_ARC_SAMPLES
    if (insideSamples[index]) {
      currentStartOffset ??= offset
      continue
    }

    if (currentStartOffset === null) continue

    const currentEndOffset = offset - 1
    const length = currentEndOffset - currentStartOffset
    if (length > bestLength) {
      bestLength = length
      bestStartOffset = currentStartOffset
      bestEndOffset = currentEndOffset
    }
    currentStartOffset = null
  }

  if (currentStartOffset !== null) {
    const currentEndOffset = CIRCLE_VISIBLE_ARC_SAMPLES - 1
    const length = currentEndOffset - currentStartOffset
    if (length > bestLength) {
      bestStartOffset = currentStartOffset
      bestEndOffset = currentEndOffset
    }
  }

  const startIndex = scanStart + bestStartOffset
  const endIndex = scanStart + bestEndOffset
  return {
    isFullLoop: false,
    startT: startIndex / CIRCLE_VISIBLE_ARC_SAMPLES,
    spanT: Math.max(0, (endIndex - startIndex) / CIRCLE_VISIBLE_ARC_SAMPLES),
  }
}

function getSPathPointAtT(geometry: SPathGeometry, t: number): NormalizedPoint {
  const safeT = clamp01(t)
  return safeT <= 0.5
    ? getCubicPoint(geometry.segments[0], safeT * 2)
    : getCubicPoint(geometry.segments[1], (safeT - 0.5) * 2)
}

function getCircleVerticalT(t: number): number {
  const safeT = normalizeLoopT(t)
  return safeT <= 0.5 ? safeT * 2 : 2 - safeT * 2
}

function getCircleYTiltT(t: number): number {
  return Math.sin(Math.PI * 2 * normalizeLoopT(t))
}

function getCircleXTiltT(t: number): number {
  return Math.cos(Math.PI * 2 * normalizeLoopT(t))
}

function getCirclePathGainDb(
  t: number,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): number {
  const verticalGainDb = startGainDb + (endGainDb - startGainDb) * getCircleVerticalT(t)
  return clamp(
    verticalGainDb +
      clamp(circleXTiltDb, CIRCLE_TILT_MIN_DB, CIRCLE_TILT_MAX_DB) * getCircleXTiltT(t) +
      clamp(circleYTiltDb, CIRCLE_TILT_MIN_DB, CIRCLE_TILT_MAX_DB) * getCircleYTiltT(t),
    LINE_ENDPOINT_GAIN_MIN_DB,
    LINE_ENDPOINT_GAIN_MAX_DB
  )
}

function getCircleDepthAtT(
  t: number,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): number {
  return (getCirclePathGainDb(t, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb) - startGainDb) / LINE_DEPTH_FULL_SCALE_DB
}

function getSPathDistance(geometry: SPathGeometry, startGainDb: number, endGainDb: number): number {
  const depthDistance = Math.abs(endGainDb - startGainDb) / LINE_DEPTH_FULL_SCALE_DB
  let distance = 0
  let previousPoint = getSPathPointAtT(geometry, 0)
  let previousDepth = 0

  for (let index = 1; index <= S_PATH_DISTANCE_SAMPLES; index += 1) {
    const t = index / S_PATH_DISTANCE_SAMPLES
    const point = getSPathPointAtT(geometry, t)
    const depth = depthDistance * t
    const deltaX = point.normalizedX - previousPoint.normalizedX
    const deltaY = point.normalizedY - previousPoint.normalizedY
    const deltaDepth = depth - previousDepth
    distance += Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaDepth * deltaDepth)
    previousPoint = point
    previousDepth = depth
  }

  return distance
}

function getSinePathDistance(geometry: SinePathGeometry, startGainDb: number, endGainDb: number): number {
  const depthDistance = Math.abs(endGainDb - startGainDb) / LINE_DEPTH_FULL_SCALE_DB
  let distance = 0
  let previousPoint = getSinePathPointAtT(geometry, 0)
  let previousDepth = 0

  for (let index = 1; index <= SINE_PATH_DISTANCE_SAMPLES; index += 1) {
    const t = index / SINE_PATH_DISTANCE_SAMPLES
    const point = getSinePathPointAtT(geometry, t)
    const depth = depthDistance * t
    const deltaX = point.normalizedX - previousPoint.normalizedX
    const deltaY = point.normalizedY - previousPoint.normalizedY
    const deltaDepth = depth - previousDepth
    distance += Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaDepth * deltaDepth)
    previousPoint = point
    previousDepth = depth
  }

  return distance
}

function getCirclePathDistance(
  geometry: CirclePathGeometry,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): number {
  const motionArc = getCircleMotionArc(geometry)
  const spanT = motionArc.isFullLoop ? 1 : motionArc.spanT
  if (spanT <= 0) return 0

  let distance = 0
  let previousPoint = getCirclePathPointAtT(geometry, motionArc.startT)
  let previousDepth = getCircleDepthAtT(motionArc.startT, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb)

  for (let index = 1; index <= CIRCLE_PATH_DISTANCE_SAMPLES; index += 1) {
    const t = motionArc.startT + spanT * (index / CIRCLE_PATH_DISTANCE_SAMPLES)
    const point = getCirclePathPointAtT(geometry, t)
    const depth = getCircleDepthAtT(t, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb)
    const deltaX = point.normalizedX - previousPoint.normalizedX
    const deltaY = point.normalizedY - previousPoint.normalizedY
    const deltaDepth = depth - previousDepth
    distance += Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaDepth * deltaDepth)
    previousPoint = point
    previousDepth = depth
  }

  return distance * (motionArc.isFullLoop ? 1 : 2)
}

function getPathPointAtT(
  pattern: PathPattern,
  lineEndpoints: LineEndpoints,
  vGeometry: VPathGeometry,
  sGeometry: SPathGeometry,
  sineGeometry: SinePathGeometry,
  circleGeometry: CirclePathGeometry,
  t: number
): NormalizedPoint {
  const safeT = clamp01(t)
  if (pattern === "circle") {
    return getCirclePathPointAtT(circleGeometry, safeT)
  }
  if (pattern === "s") {
    return getSPathPointAtT(sGeometry, safeT)
  }
  if (pattern === "sine") {
    return getSinePathPointAtT(sineGeometry, safeT)
  }
  if (pattern === "v") {
    return safeT <= 0.5
      ? getLinePointAtT([vGeometry.left, vGeometry.vertex], safeT * 2)
      : getLinePointAtT([vGeometry.vertex, vGeometry.right], (safeT - 0.5) * 2)
  }

  return getLinePointAtT(lineEndpoints, safeT)
}

function getPathGainDb(
  pattern: PathPattern,
  t: number,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): number {
  const safeT = clamp01(t)
  if (pattern === "circle") {
    return getCirclePathGainDb(t, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb)
  }

  return startGainDb + (endGainDb - startGainDb) * safeT
}

function getCirclePlayheadT(index: number, baseT: number, motionArc: CircleMotionArc): number {
  const direction = index % 2 === 0 ? 1 : -1
  if (!motionArc.isFullLoop) {
    const bounceT = baseT <= 0.5 ? baseT * 2 : 2 - baseT * 2
    const directedT = direction === 1 ? bounceT : 1 - bounceT
    return motionArc.startT + motionArc.spanT * directedT
  }

  const rawT = direction === 1
    ? baseT
    : -baseT
  return normalizeLoopT(rawT)
}

function getCirclePathPlayheads(
  geometries: CirclePathGeometry[],
  count: number,
  motionDotCount: number,
  baseT: number,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): CirclePathPlayhead[] {
  const safeCount = clampCircleCount(count)
  const safeMotionDotCount = clampCircleMotionDotCount(motionDotCount)
  const fallbackGeometry = geometries[0]
  if (!fallbackGeometry) return []

  return Array.from({ length: safeCount }, (_, circleIndex) => {
    const geometry = geometries[circleIndex] ?? fallbackGeometry
    const motionArc = getCircleMotionArc(geometry)

    return Array.from({ length: safeMotionDotCount }, (_, dotIndex) => {
      const dotOffset = dotIndex / safeMotionDotCount
      const t = getCirclePlayheadT(circleIndex, normalizeLoopT(baseT + dotOffset), motionArc)

      return {
        t,
        point: getCirclePathPointAtT(geometry, t),
        gain: 0.8 * dbToLinearGain(getCirclePathGainDb(t, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb)),
      }
    })
  }).flat()
}

function getAlternatingCirclePlayheadIndex(playheadCount: number, elapsedSeconds: number, hitIntervalSeconds: number): number {
  if (playheadCount <= 1) return 0
  const hitIndex = Math.floor(elapsedSeconds / Math.max(0.03, hitIntervalSeconds))
  return hitIndex % playheadCount
}

function getCircleSimultaneousPoints(
  geometries: CirclePathGeometry[],
  circleCount: number,
  dotCount: number,
  startGainDb: number,
  endGainDb: number,
  circleXTiltDb: number,
  circleYTiltDb: number
): CirclePathPlayhead[] {
  const safeCircleCount = clampCircleCount(circleCount)
  const safeDotCount = clampCircleDotCount(dotCount)
  const activeGeometries = geometries.slice(0, safeCircleCount)

  return activeGeometries.flatMap((geometry) => {
    const motionArc = getCircleMotionArc(geometry)
    if (!motionArc.isFullLoop && motionArc.spanT <= 0) return []

    const lastIndex = Math.max(1, safeDotCount - 1)
    return Array.from({ length: safeDotCount }, (_, index) => {
      const t = motionArc.isFullLoop
        ? index / safeDotCount
        : motionArc.startT + motionArc.spanT * (index / lastIndex)
      return {
        t,
        point: getCirclePathPointAtT(geometry, t),
        gain: 0.8 * dbToLinearGain(getCirclePathGainDb(t, startGainDb, endGainDb, circleXTiltDb, circleYTiltDb)),
      }
    }).filter(({ point }) => isPointInSoundstage(point))
  })
}

function getCircleTiltVisual(circleXTiltDb: number, circleYTiltDb: number) {
  const nearX = clamp(circleYTiltDb, CIRCLE_TILT_MIN_DB, CIRCLE_TILT_MAX_DB)
  const nearY = -clamp(circleXTiltDb, CIRCLE_TILT_MIN_DB, CIRCLE_TILT_MAX_DB)
  const magnitude = Math.sqrt(nearX * nearX + nearY * nearY)
  if (magnitude < 0.001) {
    return {
      tilted: false,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      nearOpacity: 0,
      farOpacity: 0,
    }
  }

  const unitX = nearX / magnitude
  const unitY = nearY / magnitude
  const intensity = clamp(magnitude / CIRCLE_TILT_MAX_DB, 0, 1)
  return {
    tilted: true,
    x1: 50 - unitX * 50,
    y1: 50 - unitY * 50,
    x2: 50 + unitX * 50,
    y2: 50 + unitY * 50,
    nearOpacity: 0.16 + intensity * 0.22,
    farOpacity: 0.08 + intensity * 0.12,
  }
}

function parsePathPattern(value: unknown): PathPattern {
  if (value === "line-steps" || value === "v" || value === "s" || value === "sine" || value === "circle") return value
  return "line"
}

function parseCirclePlaybackMode(value: unknown): CirclePlaybackMode {
  return value === "all" ? "all" : "motion"
}

function getPointerNormalizedPoint(
  event: PointerEvent<HTMLElement>,
  element: HTMLElement | null
): NormalizedPoint {
  const rect = element?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return DEFAULT_LINE_CENTER
  return {
    normalizedX: clamp01((event.clientX - rect.left) / rect.width),
    normalizedY: clamp01(1 - (event.clientY - rect.top) / rect.height),
  }
}

function loadSetting<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveSetting<T>(key: string, value: T): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures.
  }
}

export function InversePathMainView() {
  const [settingsCollapsed, setSettingsCollapsed] = useState(false)
  const [pathPattern, setPathPattern] = useState<PathPattern>("line")
  const [lineStepCount, setLineStepCount] = useState(DEFAULT_LINE_STEP_COUNT)
  const [surfaceSize, setSurfaceSize] = useState<SurfaceSize>({ width: 1, height: 1 })
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [hitRateHz, setHitRateHz] = useState(DEFAULT_HIT_RATE_HZ)
  const [hitReleaseSeconds, setHitReleaseSeconds] = useState(DEFAULT_HIT_RELEASE_SECONDS)
  const [volumeDb, setVolumeDb] = useState(DEFAULT_VOLUME_DB)
  const [bandwidth, setBandwidth] = useState(DEFAULT_BANDWIDTH_OCTAVES)
  const [inverseDotOutsideGapOctaves, setInverseDotOutsideGapOctaves] = useState(
    inversePathAudio.DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES
  )
  const [inverseDotBandBoostDb, setInverseDotBandBoostDb] = useState(
    inversePathAudio.DEFAULT_INVERSE_DOT_BAND_BOOST_DB
  )
  const [lineCenter, setLineCenter] = useState<NormalizedPoint>(DEFAULT_LINE_CENTER)
  const [lineLength, setLineLength] = useState(DEFAULT_LINE_LENGTH)
  const [lineAngle, setLineAngle] = useState(DEFAULT_LINE_ANGLE_RAD)
  const [sWidth, setSWidth] = useState(DEFAULT_S_WIDTH)
  const [sHeight, setSHeight] = useState(DEFAULT_S_HEIGHT)
  const [circleRadius, setCircleRadius] = useState(DEFAULT_CIRCLE_RADIUS)
  const [circleCount, setCircleCount] = useState(DEFAULT_CIRCLE_COUNT)
  const [circlePlaybackMode, setCirclePlaybackMode] = useState<CirclePlaybackMode>(DEFAULT_CIRCLE_PLAYBACK_MODE)
  const [circleMotionDotCount, setCircleMotionDotCount] = useState(DEFAULT_CIRCLE_MOTION_DOT_COUNT)
  const [circleDotCount, setCircleDotCount] = useState(DEFAULT_CIRCLE_DOT_COUNT)
  const [additionalCircleCenters, setAdditionalCircleCenters] = useState<NormalizedPoint[]>(() =>
    normalizeAdditionalCircleCenters(null)
  )
  const [circleXTiltDb, setCircleXTiltDb] = useState(DEFAULT_CIRCLE_X_TILT_DB)
  const [circleYTiltDb, setCircleYTiltDb] = useState(DEFAULT_CIRCLE_Y_TILT_DB)
  const [lineStartGainDb, setLineStartGainDb] = useState(DEFAULT_LINE_ENDPOINT_GAIN_DB)
  const [lineEndGainDb, setLineEndGainDb] = useState(DEFAULT_LINE_ENDPOINT_GAIN_DB)
  const [audioStarted, setAudioStarted] = useState(false)
  const [isPathPlaying, setIsPathPlaying] = useState(false)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const circleMarkerRefs = useRef<Array<HTMLSpanElement | null>>([])
  const dragRef = useRef<LineDragState | null>(null)
  const surfaceSizeRef = useRef<SurfaceSize>(surfaceSize)
  surfaceSizeRef.current = surfaceSize

  const lineEndpoints = useMemo(
    () => getLineEndpoints(lineCenter, lineLength, lineAngle),
    [lineAngle, lineCenter, lineLength]
  )
  const vGeometry = useMemo(
    () => getVPathGeometry(lineCenter, lineLength, lineAngle),
    [lineAngle, lineCenter, lineLength]
  )
  const sGeometry = useMemo(
    () => getSPathGeometry(lineCenter, sWidth, sHeight),
    [lineCenter, sHeight, sWidth]
  )
  const sineGeometry = useMemo(
    () => getSinePathGeometry(lineCenter, sWidth, sHeight),
    [lineCenter, sHeight, sWidth]
  )
  const circleCenters = useMemo(
    () => [
      clampCircleCenter(lineCenter, circleRadius, surfaceSize),
      ...additionalCircleCenters.map((center) => clampCircleCenter(center, circleRadius, surfaceSize)),
    ],
    [additionalCircleCenters, circleRadius, lineCenter, surfaceSize]
  )
  const circleGeometries = useMemo(
    () => circleCenters.map((center) => getCirclePathGeometry(center, circleRadius, surfaceSize)),
    [circleCenters, circleRadius, surfaceSize]
  )
  const circleGeometry = circleGeometries[0] ?? getCirclePathGeometry(lineCenter, circleRadius, surfaceSize)
  const activePathEndpoints = useMemo<LineEndpoints>(
    () => {
      if (pathPattern === "circle") return [circleGeometry.start, circleGeometry.end]
      if (pathPattern === "s") return [sGeometry.start, sGeometry.end]
      if (pathPattern === "sine") return [sineGeometry.start, sineGeometry.end]
      if (pathPattern === "v") return [vGeometry.left, vGeometry.right]
      return lineEndpoints
    },
    [
      circleGeometry.end,
      circleGeometry.start,
      lineEndpoints,
      pathPattern,
      sineGeometry.end,
      sineGeometry.start,
      sGeometry.end,
      sGeometry.start,
      vGeometry.left,
      vGeometry.right,
    ]
  )
  const lineVisual = useMemo(() => getLineVisual(lineEndpoints), [lineEndpoints])
  const lineStepPoints = useMemo<LineStepPoint[]>(() => {
    const count = clampLineStepCount(lineStepCount)
    const lastIndex = Math.max(1, count - 1)
    return Array.from({ length: count }, (_, index) => {
      const t = index / lastIndex
      return {
        point: getLinePointAtT(lineEndpoints, t),
        gain: 0.8 * dbToLinearGain(lineStartGainDb + (lineEndGainDb - lineStartGainDb) * t),
      }
    })
  }, [lineEndGainDb, lineEndpoints, lineStartGainDb, lineStepCount])
  const dotHitIntervalSeconds = useMemo(() => hitRateToIntervalSeconds(hitRateHz), [hitRateHz])
  const linePathPassSeconds = useMemo(
    () => getLinePathPassSeconds(
      pathPattern,
      pathPattern === "v" ? vGeometry.branchLength : lineLength,
      sGeometry,
      sineGeometry,
      circleGeometry,
      lineStartGainDb,
      lineEndGainDb,
      circleXTiltDb,
      circleYTiltDb,
      speedToPerHitSeconds(speed)
    ),
    [circleGeometry, circleXTiltDb, circleYTiltDb, lineEndGainDb, lineLength, lineStartGainDb, pathPattern, sineGeometry, sGeometry, speed, vGeometry.branchLength]
  )

  const lineEndpointsRef = useRef<LineEndpoints>(lineEndpoints)
  const vGeometryRef = useRef<VPathGeometry>(vGeometry)
  const sGeometryRef = useRef<SPathGeometry>(sGeometry)
  const sineGeometryRef = useRef<SinePathGeometry>(sineGeometry)
  const circleGeometryRef = useRef<CirclePathGeometry>(circleGeometry)
  const circleGeometriesRef = useRef<CirclePathGeometry[]>(circleGeometries)
  const pathPatternRef = useRef<PathPattern>(pathPattern)
  const circleCountRef = useRef(circleCount)
  const circlePlaybackModeRef = useRef(circlePlaybackMode)
  const circleMotionDotCountRef = useRef(circleMotionDotCount)
  const circleDotCountRef = useRef(circleDotCount)
  const lineStepPointsRef = useRef<LineStepPoint[]>(lineStepPoints)
  const dotHitIntervalSecondsRef = useRef(dotHitIntervalSeconds)
  const hitReleaseSecondsRef = useRef(hitReleaseSeconds)
  const linePathPassSecondsRef = useRef(linePathPassSeconds)
  const lineEndpointGainDbRef = useRef<[number, number]>([lineStartGainDb, lineEndGainDb])
  const circleXTiltDbRef = useRef(circleXTiltDb)
  const circleYTiltDbRef = useRef(circleYTiltDb)
  lineEndpointsRef.current = lineEndpoints
  vGeometryRef.current = vGeometry
  sGeometryRef.current = sGeometry
  sineGeometryRef.current = sineGeometry
  circleGeometryRef.current = circleGeometry
  circleGeometriesRef.current = circleGeometries
  pathPatternRef.current = pathPattern
  circleCountRef.current = circleCount
  circlePlaybackModeRef.current = circlePlaybackMode
  circleMotionDotCountRef.current = circleMotionDotCount
  circleDotCountRef.current = circleDotCount
  lineStepPointsRef.current = lineStepPoints
  dotHitIntervalSecondsRef.current = dotHitIntervalSeconds
  hitReleaseSecondsRef.current = hitReleaseSeconds
  linePathPassSecondsRef.current = linePathPassSeconds
  lineEndpointGainDbRef.current = [lineStartGainDb, lineEndGainDb]
  circleXTiltDbRef.current = circleXTiltDb
  circleYTiltDbRef.current = circleYTiltDb

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const updateSurfaceSize = () => {
      const rect = surface.getBoundingClientRect()
      setSurfaceSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      })
    }

    updateSurfaceSize()
    const observer = new ResizeObserver(updateSurfaceSize)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  const startAudio = useCallback(async () => {
    try {
      await resumeAudioContext()
    } finally {
      setAudioStarted(getAudioContextState() === "running")
    }
  }, [])

  const playPath = useCallback(async () => {
    await startAudio()
    setIsPathPlaying(true)
  }, [startAudio])

  const pausePath = useCallback(() => {
    setIsPathPlaying(false)
  }, [])

  const togglePlayback = useCallback(() => {
    if (isPathPlaying) {
      pausePath()
      return
    }

    void playPath()
  }, [isPathPlaying, pausePath, playPath])

  const handlePathPatternChange = useCallback((nextPattern: PathPattern) => {
    setPathPattern(nextPattern)

    if (nextPattern === "circle") {
      const nextRadius = clampCircleRadius(circleRadius, lineCenter, surfaceSizeRef.current)
      setCircleRadius(nextRadius)
      setLineCenter(clampCircleCenter(lineCenter, nextRadius, surfaceSizeRef.current))
      return
    }

    if (nextPattern === "s" || nextPattern === "sine") {
      const nextWidth = clampSWidth(sWidth, lineCenter)
      const nextHeight = clampSHeight(sHeight, lineCenter)
      setSWidth(nextWidth)
      setSHeight(nextHeight)
      setLineCenter(clampSCenter(lineCenter, nextWidth, nextHeight))
      return
    }

    if (nextPattern !== "v") return

    const nextAngle = Math.abs(Math.sin(lineAngle)) < 0.05
      ? DEFAULT_V_BRANCH_ANGLE_RAD
      : getNormalizedVBranchAngle(lineAngle)
    const nextLength = clampVBranchLength(lineLength, lineCenter, nextAngle)

    setLineAngle(nextAngle)
    setLineLength(nextLength)
    setLineCenter(clampVVertex(lineCenter, nextLength, nextAngle))
  }, [circleRadius, lineAngle, lineCenter, lineLength, sHeight, sWidth])

  useEffect(() => {
    setSettingsCollapsed(loadSetting("cabin:inversePath:settingsCollapsed", false))
    setPathPattern(parsePathPattern(loadSetting("cabin:inversePath:pathPattern", "line")))
    setLineStepCount(clampLineStepCount(loadSetting("cabin:inversePath:lineStepCount", DEFAULT_LINE_STEP_COUNT)))
    setSpeed(clamp(loadSetting("cabin:inversePath:speed", DEFAULT_SPEED), SPEED_MIN, SPEED_MAX))
    setHitRateHz(clamp(loadSetting("cabin:inversePath:hitRateHz", DEFAULT_HIT_RATE_HZ), HIT_RATE_MIN_HZ, HIT_RATE_MAX_HZ))
    setHitReleaseSeconds(clamp(
      loadSetting("cabin:inversePath:hitReleaseSeconds", DEFAULT_HIT_RELEASE_SECONDS),
      HIT_RELEASE_MIN_SECONDS,
      HIT_RELEASE_MAX_SECONDS
    ))
    setVolumeDb(clamp(loadSetting("cabin:inversePath:volumeDb", DEFAULT_VOLUME_DB), VOLUME_MIN_DB, VOLUME_MAX_DB))
    setBandwidth(clamp(
      loadSetting("cabin:inversePath:bandwidth", DEFAULT_BANDWIDTH_OCTAVES),
      BANDWIDTH_MIN_OCTAVES,
      BANDWIDTH_MAX_OCTAVES
    ))
    setInverseDotOutsideGapOctaves(clamp(
      loadSetting("cabin:inversePath:dotGap", inversePathAudio.DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES),
      inversePathAudio.MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
      inversePathAudio.MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES
    ))
    setInverseDotBandBoostDb(clamp(
      loadSetting("cabin:inversePath:dotBoost", inversePathAudio.DEFAULT_INVERSE_DOT_BAND_BOOST_DB),
      inversePathAudio.MIN_INVERSE_DOT_BAND_BOOST_DB,
      inversePathAudio.MAX_INVERSE_DOT_BAND_BOOST_DB
    ))
    const nextLineCenter = {
      normalizedX: clamp01(loadSetting("cabin:inversePath:lineCenterX", DEFAULT_LINE_CENTER.normalizedX)),
      normalizedY: clamp01(loadSetting("cabin:inversePath:lineCenterY", DEFAULT_LINE_CENTER.normalizedY)),
    }
    setLineCenter(nextLineCenter)
    setLineLength(clampLineLength(loadSetting("cabin:inversePath:lineLength", DEFAULT_LINE_LENGTH)))
    setLineAngle(loadSetting("cabin:inversePath:lineAngle", DEFAULT_LINE_ANGLE_RAD))
    setSWidth(clamp(loadSetting("cabin:inversePath:sWidth", DEFAULT_S_WIDTH), MIN_S_SIZE, 1))
    setSHeight(clamp(loadSetting("cabin:inversePath:sHeight", DEFAULT_S_HEIGHT), MIN_S_SIZE, 1))
    setCircleRadius(clamp(loadSetting("cabin:inversePath:circleRadius", DEFAULT_CIRCLE_RADIUS), MIN_CIRCLE_RADIUS, 0.5))
    setCircleCount(clampCircleCount(loadSetting("cabin:inversePath:circleCount", DEFAULT_CIRCLE_COUNT)))
    setCirclePlaybackMode(parseCirclePlaybackMode(loadSetting(
      "cabin:inversePath:circlePlaybackMode",
      DEFAULT_CIRCLE_PLAYBACK_MODE
    )))
    setCircleMotionDotCount(clampCircleMotionDotCount(loadSetting(
      "cabin:inversePath:circleMotionDotCount",
      DEFAULT_CIRCLE_MOTION_DOT_COUNT
    )))
    setCircleDotCount(clampCircleDotCount(loadSetting("cabin:inversePath:circleDotCount", DEFAULT_CIRCLE_DOT_COUNT)))
    setAdditionalCircleCenters(normalizeAdditionalCircleCenters(
      loadSetting("cabin:inversePath:additionalCircleCenters", null),
      nextLineCenter
    ))
    setCircleXTiltDb(clamp(
      loadSetting("cabin:inversePath:circleXTiltDb", DEFAULT_CIRCLE_X_TILT_DB),
      CIRCLE_TILT_MIN_DB,
      CIRCLE_TILT_MAX_DB
    ))
    setCircleYTiltDb(clamp(
      loadSetting("cabin:inversePath:circleYTiltDb", DEFAULT_CIRCLE_Y_TILT_DB),
      CIRCLE_TILT_MIN_DB,
      CIRCLE_TILT_MAX_DB
    ))
    setLineStartGainDb(clamp(
      loadSetting("cabin:inversePath:lineStartGainDb", DEFAULT_LINE_ENDPOINT_GAIN_DB),
      LINE_ENDPOINT_GAIN_MIN_DB,
      LINE_ENDPOINT_GAIN_MAX_DB
    ))
    setLineEndGainDb(clamp(
      loadSetting("cabin:inversePath:lineEndGainDb", DEFAULT_LINE_ENDPOINT_GAIN_DB),
      LINE_ENDPOINT_GAIN_MIN_DB,
      LINE_ENDPOINT_GAIN_MAX_DB
    ))
  }, [])

  useEffect(() => { saveSetting("cabin:inversePath:settingsCollapsed", settingsCollapsed) }, [settingsCollapsed])
  useEffect(() => { saveSetting("cabin:inversePath:pathPattern", pathPattern) }, [pathPattern])
  useEffect(() => { saveSetting("cabin:inversePath:lineStepCount", lineStepCount) }, [lineStepCount])
  useEffect(() => { saveSetting("cabin:inversePath:speed", speed) }, [speed])
  useEffect(() => { saveSetting("cabin:inversePath:hitRateHz", hitRateHz) }, [hitRateHz])
  useEffect(() => { saveSetting("cabin:inversePath:hitReleaseSeconds", hitReleaseSeconds) }, [hitReleaseSeconds])
  useEffect(() => { saveSetting("cabin:inversePath:volumeDb", volumeDb) }, [volumeDb])
  useEffect(() => { saveSetting("cabin:inversePath:bandwidth", bandwidth) }, [bandwidth])
  useEffect(() => { saveSetting("cabin:inversePath:dotGap", inverseDotOutsideGapOctaves) }, [inverseDotOutsideGapOctaves])
  useEffect(() => { saveSetting("cabin:inversePath:dotBoost", inverseDotBandBoostDb) }, [inverseDotBandBoostDb])
  useEffect(() => { saveSetting("cabin:inversePath:lineCenterX", lineCenter.normalizedX) }, [lineCenter.normalizedX])
  useEffect(() => { saveSetting("cabin:inversePath:lineCenterY", lineCenter.normalizedY) }, [lineCenter.normalizedY])
  useEffect(() => { saveSetting("cabin:inversePath:lineLength", lineLength) }, [lineLength])
  useEffect(() => { saveSetting("cabin:inversePath:lineAngle", lineAngle) }, [lineAngle])
  useEffect(() => { saveSetting("cabin:inversePath:sWidth", sWidth) }, [sWidth])
  useEffect(() => { saveSetting("cabin:inversePath:sHeight", sHeight) }, [sHeight])
  useEffect(() => { saveSetting("cabin:inversePath:circleRadius", circleRadius) }, [circleRadius])
  useEffect(() => { saveSetting("cabin:inversePath:circleCount", circleCount) }, [circleCount])
  useEffect(() => { saveSetting("cabin:inversePath:circlePlaybackMode", circlePlaybackMode) }, [circlePlaybackMode])
  useEffect(() => { saveSetting("cabin:inversePath:circleMotionDotCount", circleMotionDotCount) }, [circleMotionDotCount])
  useEffect(() => { saveSetting("cabin:inversePath:circleDotCount", circleDotCount) }, [circleDotCount])
  useEffect(() => { saveSetting("cabin:inversePath:additionalCircleCenters", additionalCircleCenters) }, [additionalCircleCenters])
  useEffect(() => { saveSetting("cabin:inversePath:circleXTiltDb", circleXTiltDb) }, [circleXTiltDb])
  useEffect(() => { saveSetting("cabin:inversePath:circleYTiltDb", circleYTiltDb) }, [circleYTiltDb])
  useEffect(() => { saveSetting("cabin:inversePath:lineStartGainDb", lineStartGainDb) }, [lineStartGainDb])
  useEffect(() => { saveSetting("cabin:inversePath:lineEndGainDb", lineEndGainDb) }, [lineEndGainDb])

  useEffect(() => {
    const player = inversePathAudio.getDotGridAudioPlayer()
    player.setContinuousNoiseModeEnabled(
      true,
      false,
      inversePathAudio.SoundMode.BandpassedNoise,
      inversePathAudio.SoundMode.InverseDotNoise
    )
    player.setVolumeDb(volumeDb)
    player.setBandwidthFilterMode(inversePathAudio.DEFAULT_BANDWIDTH_FILTER_MODE)
    player.setBandpassBandwidth(bandwidth)
    player.setInverseDotOutsideGapOctaves(inverseDotOutsideGapOctaves)
    player.setInverseDotBandBoostDb(inverseDotBandBoostDb)
  }, [bandwidth, inverseDotBandBoostDb, inverseDotOutsideGapOctaves, volumeDb])

  useEffect(() => {
    const player = inversePathAudio.getDotGridAudioPlayer()
    player.stopLineCalibration()

    if (!isPathPlaying) {
      player.stopLinePathPoint()
      player.stopLinePathPoints()
      player.stopLineStepPoints()
      player.stopCircleSimultaneousPoints()
      return
    }

    player.setContinuousNoiseModeEnabled(
      true,
      false,
      inversePathAudio.SoundMode.BandpassedNoise,
      inversePathAudio.SoundMode.InverseDotNoise
    )

    let frameId = 0
    const startedAt = performance.now()
    let wasStepMode = false
    let wasCircleMode = false
    let wasCircleSimultaneousMode = false
    let wasCircleAlternatingMotionMode = false
    const tick = (now: number) => {
      if (pathPatternRef.current === "line-steps") {
        if (!wasStepMode) {
          player.stopLinePathPoint()
          player.stopLinePathPoints()
          player.stopCircleSimultaneousPoints()
          wasStepMode = true
          wasCircleMode = false
          wasCircleSimultaneousMode = false
          wasCircleAlternatingMotionMode = false
        }

        const stepPoints = lineStepPointsRef.current
        const activeIndex = player.updateLineStepPoints(stepPoints.map(({ point, gain }) => ({
          normalizedX: point.normalizedX,
          normalizedY: point.normalizedY,
          gain,
        })), dotHitIntervalSecondsRef.current)
        const activePoint = stepPoints[activeIndex]?.point ?? stepPoints[0]?.point ?? DEFAULT_LINE_CENTER
        const marker = markerRef.current
        if (marker) {
          marker.style.left = `${activePoint.normalizedX * 100}%`
          marker.style.top = `${(1 - activePoint.normalizedY) * 100}%`
        }

        frameId = requestAnimationFrame(tick)
        return
      }

      if (wasStepMode) {
        player.stopLineStepPoints()
        wasStepMode = false
      }

      const currentPattern = pathPatternRef.current
      const passSeconds = linePathPassSecondsRef.current
      const elapsedSeconds = (now - startedAt) / 1000
      const elapsedPasses = elapsedSeconds / passSeconds
      const phase = elapsedPasses % 2
      const t = currentPattern === "circle"
        ? elapsedPasses % 1
        : phase <= 1 ? phase : 2 - phase

      if (currentPattern === "circle") {
        if (!wasCircleMode) {
          player.stopLinePathPoint()
          wasCircleMode = true
        }

        const [startGainDb, endGainDb] = lineEndpointGainDbRef.current
        if (circlePlaybackModeRef.current === "all") {
          if (!wasCircleSimultaneousMode) {
            player.stopLinePathPoint()
            player.stopLinePathPoints()
            wasCircleSimultaneousMode = true
            wasCircleAlternatingMotionMode = false
          }

          const simultaneousPoints = getCircleSimultaneousPoints(
            circleGeometriesRef.current,
            circleCountRef.current,
            circleDotCountRef.current,
            startGainDb,
            endGainDb,
            circleXTiltDbRef.current,
            circleYTiltDbRef.current
          )
          const firstPoint = simultaneousPoints[0]?.point ?? getCirclePathPointAtT(circleGeometryRef.current, 0)
          const marker = markerRef.current
          if (marker) {
            marker.style.left = `${firstPoint.normalizedX * 100}%`
            marker.style.top = `${(1 - firstPoint.normalizedY) * 100}%`
          }
          player.updateCircleSimultaneousPoints(simultaneousPoints.map(({ point, gain }) => ({
            normalizedX: point.normalizedX,
            normalizedY: point.normalizedY,
            gain,
          })), dotHitIntervalSecondsRef.current, hitReleaseSecondsRef.current)
          frameId = requestAnimationFrame(tick)
          return
        }

        if (wasCircleSimultaneousMode) {
          player.stopCircleSimultaneousPoints()
          wasCircleSimultaneousMode = false
        }

        const motionDotCount = clampCircleMotionDotCount(circleMotionDotCountRef.current)
        const circlePlayheads = getCirclePathPlayheads(
          circleGeometriesRef.current,
          circleCountRef.current,
          motionDotCount,
          t,
          startGainDb,
          endGainDb,
          circleXTiltDbRef.current,
          circleYTiltDbRef.current
        )
        const firstPlayhead = circlePlayheads[0] ?? {
          point: getCirclePathPointAtT(circleGeometryRef.current, 0),
          gain: 0.8,
          t: 0,
        }
        const marker = markerRef.current
        if (marker) {
          marker.style.left = `${firstPlayhead.point.normalizedX * 100}%`
          marker.style.top = `${(1 - firstPlayhead.point.normalizedY) * 100}%`
        }
        circleMarkerRefs.current.forEach((markerNode, markerIndex) => {
          const playhead = circlePlayheads[markerIndex + 1]
          if (!markerNode || !playhead) return
          markerNode.style.left = `${playhead.point.normalizedX * 100}%`
          markerNode.style.top = `${(1 - playhead.point.normalizedY) * 100}%`
        })
        if (motionDotCount > 1) {
          if (!wasCircleAlternatingMotionMode) {
            player.stopLinePathPoints()
            wasCircleAlternatingMotionMode = true
          }
          const activePlayhead = circlePlayheads[
            getAlternatingCirclePlayheadIndex(
              circlePlayheads.length,
              elapsedSeconds,
              dotHitIntervalSecondsRef.current
            )
          ] ?? firstPlayhead
          player.updateLinePathPoint(
            activePlayhead.point,
            activePlayhead.gain,
            true,
            dotHitIntervalSecondsRef.current,
            hitReleaseSecondsRef.current
          )
        } else {
          if (wasCircleAlternatingMotionMode) {
            player.stopLinePathPoint()
            wasCircleAlternatingMotionMode = false
          }
          player.updateLinePathPoints(circlePlayheads.map(({ point, gain }) => ({
            normalizedX: point.normalizedX,
            normalizedY: point.normalizedY,
            gain,
          })), dotHitIntervalSecondsRef.current, hitReleaseSecondsRef.current)
        }
        frameId = requestAnimationFrame(tick)
        return
      }

      if (wasCircleMode) {
        player.stopLinePathPoint()
        player.stopLinePathPoints()
        player.stopCircleSimultaneousPoints()
        wasCircleMode = false
        wasCircleSimultaneousMode = false
        wasCircleAlternatingMotionMode = false
      }

      const point = getPathPointAtT(
        currentPattern,
        lineEndpointsRef.current,
        vGeometryRef.current,
        sGeometryRef.current,
        sineGeometryRef.current,
        circleGeometryRef.current,
        t
      )
      const [startGainDb, endGainDb] = lineEndpointGainDbRef.current
      const pathGain = 0.8 * dbToLinearGain(
        getPathGainDb(currentPattern, t, startGainDb, endGainDb, circleXTiltDbRef.current, circleYTiltDbRef.current)
      )

      const marker = markerRef.current
      if (marker) {
        marker.style.left = `${point.normalizedX * 100}%`
        marker.style.top = `${(1 - point.normalizedY) * 100}%`
      }

      player.updateLinePathPoint(
        point,
        pathGain,
        true,
        dotHitIntervalSecondsRef.current,
        hitReleaseSecondsRef.current
      )
      frameId = requestAnimationFrame(tick)
    }

    tick(startedAt)

    return () => {
      cancelAnimationFrame(frameId)
      player.stopLinePathPoint()
      player.stopLinePathPoints()
      player.stopLineStepPoints()
      player.stopCircleSimultaneousPoints()
    }
  }, [isPathPlaying])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey) return

      const target = event.target instanceof HTMLElement ? event.target : null
      const interactiveTarget = target?.closest(
        'button, input, textarea, select, [role="slider"], [contenteditable="true"]'
      )
      if (interactiveTarget) return

      event.preventDefault()
      togglePlayback()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [togglePlayback])

  const beginDrag = useCallback((event: PointerEvent<HTMLElement>, mode: LineDragMode, circleIndex = 0) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    void startAudio()
    const safeCircleIndex = Math.round(clamp(circleIndex, 0, CIRCLE_COUNT_MAX - 1))
    const dragCircleGeometry = circleGeometries[safeCircleIndex] ?? circleGeometry
    dragRef.current = {
      pointerId: event.pointerId,
      pattern: pathPattern,
      mode,
      circleIndex: safeCircleIndex,
      startPointer: getPointerNormalizedPoint(event, surfaceRef.current),
      startCenter: pathPattern === "circle"
        ? dragCircleGeometry.center
        : pathPattern === "sine"
          ? sineGeometry.center
        : pathPattern === "s" ? sGeometry.center : pathPattern === "v" ? vGeometry.vertex : lineCenter,
      startLength: pathPattern === "circle" ? dragCircleGeometry.radius : pathPattern === "v" ? vGeometry.branchLength : lineLength,
      startWidth: pathPattern === "sine" ? sineGeometry.width : pathPattern === "s" ? sGeometry.width : sWidth,
      startHeight: pathPattern === "sine" ? sineGeometry.height : pathPattern === "s" ? sGeometry.height : sHeight,
      startAngle: pathPattern === "v" ? vGeometry.branchAngle : lineAngle,
      startEndpoints: activePathEndpoints,
    }
  }, [activePathEndpoints, circleGeometries, circleGeometry, lineAngle, lineCenter, lineLength, pathPattern, sineGeometry, sGeometry, sHeight, sWidth, startAudio, vGeometry])

  const updateDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    const pointer = getPointerNormalizedPoint(event, surfaceRef.current)

    if (drag.pattern === "circle") {
      if (drag.mode === "move") {
        const nextCenter = clampCircleCenter({
          normalizedX: drag.startCenter.normalizedX + pointer.normalizedX - drag.startPointer.normalizedX,
          normalizedY: drag.startCenter.normalizedY + pointer.normalizedY - drag.startPointer.normalizedY,
        }, drag.startLength, surfaceSizeRef.current)
        if (drag.circleIndex === 0) {
          setLineCenter(nextCenter)
        } else {
          setAdditionalCircleCenters((centers) => {
            const nextCenters = normalizeAdditionalCircleCenters(centers)
            nextCenters[drag.circleIndex - 1] = nextCenter
            return nextCenters
          })
        }
        return
      }

      const { xScale, yScale } = getCircleAxisScale(surfaceSizeRef.current)
      const deltaX = (pointer.normalizedX - drag.startCenter.normalizedX) / xScale
      const deltaY = (pointer.normalizedY - drag.startCenter.normalizedY) / yScale
      const nextRadius = clampCircleRadius(Math.sqrt(deltaX * deltaX + deltaY * deltaY), drag.startCenter, surfaceSizeRef.current)
      setCircleRadius(nextRadius)
      setLineCenter(clampCircleCenter(drag.startCenter, nextRadius, surfaceSizeRef.current))
      setAdditionalCircleCenters((centers) =>
        normalizeAdditionalCircleCenters(centers).map((center) => clampCircleCenter(center, nextRadius, surfaceSizeRef.current))
      )
      return
    }

    if (drag.pattern === "s" || drag.pattern === "sine") {
      if (drag.mode === "move") {
        const nextCenter = clampSCenter({
          normalizedX: drag.startCenter.normalizedX + pointer.normalizedX - drag.startPointer.normalizedX,
          normalizedY: drag.startCenter.normalizedY + pointer.normalizedY - drag.startPointer.normalizedY,
        }, drag.startWidth, drag.startHeight)
        setLineCenter(nextCenter)
        return
      }

      if (drag.mode === "width") {
        const nextWidth = clampSWidth(Math.abs(pointer.normalizedX - drag.startCenter.normalizedX) * 2, drag.startCenter)
        setSWidth(nextWidth)
        setLineCenter(clampSCenter(drag.startCenter, nextWidth, drag.startHeight))
        return
      }

      const nextHeight = clampSHeight(Math.abs(pointer.normalizedY - drag.startCenter.normalizedY) * 2, drag.startCenter)
      setSHeight(nextHeight)
      setLineCenter(clampSCenter(drag.startCenter, drag.startWidth, nextHeight))
      return
    }

    if (drag.pattern === "v") {
      if (drag.mode === "move") {
        const nextVertex = clampVVertex({
          normalizedX: drag.startCenter.normalizedX + pointer.normalizedX - drag.startPointer.normalizedX,
          normalizedY: drag.startCenter.normalizedY + pointer.normalizedY - drag.startPointer.normalizedY,
        }, drag.startLength, drag.startAngle)
        setLineCenter(nextVertex)
        return
      }

      const rawDx = Math.max(0.0001, Math.abs(pointer.normalizedX - drag.startCenter.normalizedX))
      const rawDy = pointer.normalizedY - drag.startCenter.normalizedY
      const nextAngle = getNormalizedVBranchAngle(Math.atan2(rawDy, rawDx))
      const nextLength = clampVBranchLength(
        Math.sqrt(rawDx * rawDx + rawDy * rawDy),
        drag.startCenter,
        nextAngle
      )

      setLineAngle(nextAngle)
      setLineLength(nextLength)
      setLineCenter(clampVVertex(drag.startCenter, nextLength, nextAngle))
      return
    }

    if (drag.mode === "move") {
      const nextCenter = clampLineCenter({
        normalizedX: drag.startCenter.normalizedX + pointer.normalizedX - drag.startPointer.normalizedX,
        normalizedY: drag.startCenter.normalizedY + pointer.normalizedY - drag.startPointer.normalizedY,
      }, drag.startLength, drag.startAngle)
      setLineCenter(nextCenter)
      return
    }

    const fixedPoint = drag.mode === "start" ? drag.startEndpoints[1] : drag.startEndpoints[0]
    const movingPoint = pointer
    const nextCenter = {
      normalizedX: (fixedPoint.normalizedX + movingPoint.normalizedX) / 2,
      normalizedY: (fixedPoint.normalizedY + movingPoint.normalizedY) / 2,
    }
    const deltaX = movingPoint.normalizedX - fixedPoint.normalizedX
    const deltaY = movingPoint.normalizedY - fixedPoint.normalizedY
    const nextLength = clampLineLength(Math.sqrt(deltaX * deltaX + deltaY * deltaY))
    const nextAngle = drag.mode === "start"
      ? Math.atan2(fixedPoint.normalizedY - movingPoint.normalizedY, fixedPoint.normalizedX - movingPoint.normalizedX)
      : Math.atan2(deltaY, deltaX)

    setLineLength(nextLength)
    setLineAngle(nextAngle)
    setLineCenter(clampLineCenter(nextCenter, nextLength, nextAngle))
  }, [])

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
  }, [])

  const circlePreviewPlayheads = useMemo(
    () => pathPattern === "circle"
      ? getCirclePathPlayheads(
          circleGeometries,
          circleCount,
          circleMotionDotCount,
          0,
          lineStartGainDb,
          lineEndGainDb,
          circleXTiltDb,
          circleYTiltDb
        )
      : [],
    [
      circleCount,
      circleGeometries,
      circleMotionDotCount,
      circleXTiltDb,
      circleYTiltDb,
      lineEndGainDb,
      lineStartGainDb,
      pathPattern,
    ]
  )
  const circleSimultaneousPreviewPoints = useMemo(
    () => pathPattern === "circle" && circlePlaybackMode === "all"
      ? getCircleSimultaneousPoints(
          circleGeometries,
          circleCount,
          circleDotCount,
          lineStartGainDb,
          lineEndGainDb,
          circleXTiltDb,
          circleYTiltDb
        )
      : [],
    [
      circleCount,
      circleDotCount,
      circleGeometries,
      circlePlaybackMode,
      circleXTiltDb,
      circleYTiltDb,
      lineEndGainDb,
      lineStartGainDb,
      pathPattern,
    ]
  )
  const markerStartPoint = pathPattern === "circle"
    ? (circlePlaybackMode === "all"
        ? circleSimultaneousPreviewPoints[0]?.point
        : circlePreviewPlayheads[0]?.point) ?? circleGeometry.start
    : pathPattern === "sine"
      ? sineGeometry.start
    : pathPattern === "s"
      ? sGeometry.start
      : pathPattern === "v" ? vGeometry.left : lineEndpoints[0]
  const centerHandlePoint = pathPattern === "v"
    ? vGeometry.vertex
    : pathPattern === "circle"
      ? circleGeometry.center
    : pathPattern === "sine"
      ? sineGeometry.center
    : pathPattern === "s"
      ? sGeometry.center
    : { normalizedX: lineVisual.centerLeft / 100, normalizedY: 1 - lineVisual.centerTop / 100 }
  const endpointHandles = pathPattern === "v"
    ? [
        { id: "start" as const, point: vGeometry.left, label: "A" },
        { id: "end" as const, point: vGeometry.right, label: "B" },
      ]
    : pathPattern === "circle"
      ? [
          { id: "start" as const, point: circleGeometry.start, label: "A" },
          { id: "end" as const, point: circleGeometry.end, label: "B" },
        ]
    : pathPattern === "sine"
      ? [
          { id: "start" as const, point: sineGeometry.top, label: "A" },
          { id: "end" as const, point: sineGeometry.bottom, label: "B" },
        ]
    : pathPattern === "s"
      ? [
          { id: "start" as const, point: sGeometry.start, label: "A" },
          { id: "end" as const, point: sGeometry.end, label: "B" },
        ]
    : [
        { id: "start" as const, point: lineEndpoints[0], label: "A" },
        { id: "end" as const, point: lineEndpoints[1], label: "B" },
      ]
  const vSegments = [vGeometry.leftSegment, vGeometry.rightSegment]
  const shapeWidthGeometry = pathPattern === "sine" ? sineGeometry : sGeometry
  const curvyPathD = pathPattern === "sine" ? sineGeometry.pathD : sGeometry.pathD
  const sWidthHandles = [
    { id: "right", point: shapeWidthGeometry.rightHandle },
    { id: "left", point: shapeWidthGeometry.leftHandle },
  ]
  const centerHandleLabel = pathPattern === "circle"
    ? "O"
    : pathPattern === "sine"
      ? "~"
    : pathPattern === "v" || pathPattern === "s"
      ? pathPattern.toUpperCase()
      : ""
  const circleTiltVisual = getCircleTiltVisual(circleXTiltDb, circleYTiltDb)
  const activeCircleGeometries = pathPattern === "circle"
    ? circleGeometries.slice(0, clampCircleCount(circleCount))
    : []
  const additionalCircleMarkerIndexes = pathPattern === "circle" && circlePlaybackMode === "motion"
    ? Array.from({ length: Math.max(0, circlePreviewPlayheads.length - 1) }, (_, index) => index)
    : []

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-black text-white"
      onPointerDownCapture={() => void startAudio()}
      onKeyDownCapture={() => void startAudio()}
    >
      <div
        ref={surfaceRef}
        className="absolute inset-0 touch-none bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.12),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0))]"
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="pointer-events-none absolute inset-6 rounded-lg border border-white/10" />

        {pathPattern === "circle" ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {circleTiltVisual.tilted && (
              <defs>
                <linearGradient
                  id="inverse-path-circle-tilt-stroke"
                  gradientUnits="userSpaceOnUse"
                  x1={circleTiltVisual.x1.toFixed(3)}
                  y1={circleTiltVisual.y1.toFixed(3)}
                  x2={circleTiltVisual.x2.toFixed(3)}
                  y2={circleTiltVisual.y2.toFixed(3)}
                >
                  <stop offset="0%" stopColor="rgba(8, 47, 73, 0.58)" />
                  <stop offset="52%" stopColor="rgba(103, 232, 249, 0.72)" />
                  <stop offset="100%" stopColor="rgba(255, 255, 255, 0.96)" />
                </linearGradient>
                <linearGradient
                  id="inverse-path-circle-tilt-fill"
                  gradientUnits="userSpaceOnUse"
                  x1={circleTiltVisual.x1.toFixed(3)}
                  y1={circleTiltVisual.y1.toFixed(3)}
                  x2={circleTiltVisual.x2.toFixed(3)}
                  y2={circleTiltVisual.y2.toFixed(3)}
                >
                  <stop offset="0%" stopColor={`rgba(8, 47, 73, ${circleTiltVisual.farOpacity.toFixed(3)})`} />
                  <stop offset="58%" stopColor="rgba(34, 211, 238, 0.035)" />
                  <stop offset="100%" stopColor={`rgba(255, 255, 255, ${circleTiltVisual.nearOpacity.toFixed(3)})`} />
                </linearGradient>
              </defs>
            )}
            {activeCircleGeometries.map((geometry, index) => (
              <g key={index} opacity={index === 0 ? 1 : 0.86}>
                {circleTiltVisual.tilted && (
                  <ellipse
                    cx={(geometry.center.normalizedX * 100).toFixed(3)}
                    cy={((1 - geometry.center.normalizedY) * 100).toFixed(3)}
                    rx={(geometry.xRadius * 100).toFixed(3)}
                    ry={(geometry.yRadius * 100).toFixed(3)}
                    fill="url(#inverse-path-circle-tilt-fill)"
                  />
                )}
                <ellipse
                  cx={(geometry.center.normalizedX * 100).toFixed(3)}
                  cy={((1 - geometry.center.normalizedY) * 100).toFixed(3)}
                  rx={(geometry.xRadius * 100).toFixed(3)}
                  ry={(geometry.yRadius * 100).toFixed(3)}
                  fill="none"
                  stroke="rgba(103, 232, 249, 0.12)"
                  strokeWidth="16"
                  vectorEffect="non-scaling-stroke"
                />
                <ellipse
                  cx={(geometry.center.normalizedX * 100).toFixed(3)}
                  cy={((1 - geometry.center.normalizedY) * 100).toFixed(3)}
                  rx={(geometry.xRadius * 100).toFixed(3)}
                  ry={(geometry.yRadius * 100).toFixed(3)}
                  fill="none"
                  stroke={circleTiltVisual.tilted ? "url(#inverse-path-circle-tilt-stroke)" : "rgba(165, 243, 252, 0.86)"}
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  className="drop-shadow-[0_0_14px_rgba(34,211,238,0.74)]"
                />
              </g>
            ))}
          </svg>
        ) : pathPattern === "s" || pathPattern === "sine" ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <path
              d={curvyPathD}
              fill="none"
              stroke="rgba(165, 243, 252, 0.86)"
              strokeLinecap="round"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              className="drop-shadow-[0_0_14px_rgba(34,211,238,0.74)]"
            />
            <path
              d={curvyPathD}
              fill="none"
              stroke="rgba(103, 232, 249, 0.12)"
              strokeLinecap="round"
              strokeWidth="16"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : pathPattern === "v" ? (
          vSegments.map((segment, index) => (
            <button
              key={index}
              type="button"
              aria-label="Move inverse path V"
              className="absolute h-14 cursor-grab touch-none focus:outline-none active:cursor-grabbing"
              style={{
                left: `${segment.startLeft}%`,
                top: `${segment.startTop}%`,
                width: `${Math.max(0.1, segment.width)}%`,
                transform: `translateY(-50%) rotate(${segment.screenAngle}rad)`,
                transformOrigin: "0 50%",
              }}
              onPointerDown={(event) => beginDrag(event, "move")}
            >
              <span className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-cyan-200/80 shadow-[0_0_24px_rgba(34,211,238,0.78)]" />
              <span className="absolute left-0 right-0 top-1/2 h-8 -translate-y-1/2 rounded-full bg-cyan-300/10" />
            </button>
          ))
        ) : (
          <button
            type="button"
            aria-label="Move inverse path line"
            className="absolute h-14 cursor-grab touch-none focus:outline-none active:cursor-grabbing"
            style={{
              left: `${lineVisual.startLeft}%`,
              top: `${lineVisual.startTop}%`,
              width: `${Math.max(0.1, lineVisual.width)}%`,
              transform: `translateY(-50%) rotate(${lineVisual.screenAngle}rad)`,
              transformOrigin: "0 50%",
            }}
            onPointerDown={(event) => beginDrag(event, "move")}
          >
            <span className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-cyan-200/80 shadow-[0_0_24px_rgba(34,211,238,0.78)]" />
            <span className="absolute left-0 right-0 top-1/2 h-8 -translate-y-1/2 rounded-full bg-cyan-300/10" />
          </button>
        )}

        {pathPattern === "line-steps" && lineStepPoints.map(({ point }, index) => (
          <span
            key={index}
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/70 bg-black/75 shadow-[0_0_18px_rgba(34,211,238,0.55)]"
            style={{ left: `${point.normalizedX * 100}%`, top: `${(1 - point.normalizedY) * 100}%` }}
          >
            <span className="absolute inset-[5px] rounded-full bg-cyan-200/85" />
          </span>
        ))}

        {pathPattern === "circle" && circlePlaybackMode === "all" ? (
          circleSimultaneousPreviewPoints.map(({ point }, index) => (
            <span
              key={index}
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-100/80 bg-fuchsia-300/75 shadow-[0_0_24px_rgba(217,70,239,0.72)]"
              style={{ left: `${point.normalizedX * 100}%`, top: `${(1 - point.normalizedY) * 100}%` }}
            >
              <span className="absolute inset-[6px] rounded-full bg-white/90" />
            </span>
          ))
        ) : (
          <>
            <span
              ref={markerRef}
              className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-100/85 bg-fuchsia-300/80 shadow-[0_0_30px_rgba(217,70,239,0.82)]"
              style={{ left: `${markerStartPoint.normalizedX * 100}%`, top: `${(1 - markerStartPoint.normalizedY) * 100}%` }}
            >
              <span className="absolute inset-[8px] rounded-full bg-white/90" />
            </span>

            {additionalCircleMarkerIndexes.map((markerIndex) => {
              const previewPoint = circlePreviewPlayheads[markerIndex + 1]?.point ?? markerStartPoint

              return (
                <span
                  key={markerIndex}
                  ref={(node) => {
                    circleMarkerRefs.current[markerIndex] = node
                  }}
                  className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100/85 bg-amber-300/80 shadow-[0_0_26px_rgba(251,191,36,0.75)]"
                  style={{ left: `${previewPoint.normalizedX * 100}%`, top: `${(1 - previewPoint.normalizedY) * 100}%` }}
                >
                  <span className="absolute inset-[7px] rounded-full bg-white/90" />
                </span>
              )
            })}
          </>
        )}

        {pathPattern === "circle" ? (
          activeCircleGeometries.map((geometry, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Move inverse path circle ${index + 1} center`}
              className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border border-white/70 bg-black/55 shadow-[0_0_20px_rgba(255,255,255,0.35)] backdrop-blur-sm focus:outline-none active:cursor-grabbing"
              style={{ left: `${geometry.center.normalizedX * 100}%`, top: `${(1 - geometry.center.normalizedY) * 100}%` }}
              onPointerDown={(event) => beginDrag(event, "move", index)}
            >
              <span className="text-[9px] font-semibold text-white/80">{`C${index + 1}`}</span>
            </button>
          ))
        ) : (
          <button
            type="button"
            aria-label={
              pathPattern === "v"
                ? "Move inverse path vertex"
                : pathPattern === "sine"
                  ? "Move inverse path sine center"
                  : pathPattern === "s"
                    ? "Move inverse path S center"
                    : "Move inverse path line center"
            }
            className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border border-white/70 bg-black/55 shadow-[0_0_20px_rgba(255,255,255,0.35)] backdrop-blur-sm focus:outline-none active:cursor-grabbing"
            style={{ left: `${centerHandlePoint.normalizedX * 100}%`, top: `${(1 - centerHandlePoint.normalizedY) * 100}%` }}
            onPointerDown={(event) => beginDrag(event, "move")}
          >
            {centerHandleLabel && <span className="text-[9px] font-semibold text-white/80">{centerHandleLabel}</span>}
          </button>
        )}

        {endpointHandles.map((endpoint) => (
          <button
            key={endpoint.id}
            type="button"
            aria-label={`${endpoint.label} endpoint`}
            className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border border-cyan-100/80 bg-cyan-300/80 text-[10px] font-semibold text-black shadow-[0_0_26px_rgba(34,211,238,0.78)] focus:outline-none"
            style={{ left: `${endpoint.point.normalizedX * 100}%`, top: `${(1 - endpoint.point.normalizedY) * 100}%` }}
            onPointerDown={(event) => beginDrag(event, endpoint.id)}
          >
            {endpoint.label}
          </button>
        ))}

        {(pathPattern === "s" || pathPattern === "sine") && sWidthHandles.map((handle) => (
          <button
            key={handle.id}
            type="button"
            aria-label="Adjust inverse path S width"
            className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border border-fuchsia-100/80 bg-fuchsia-300/75 text-[9px] font-semibold text-black shadow-[0_0_24px_rgba(217,70,239,0.72)] focus:outline-none"
            style={{ left: `${handle.point.normalizedX * 100}%`, top: `${(1 - handle.point.normalizedY) * 100}%` }}
            onPointerDown={(event) => beginDrag(event, "width")}
          >
            W
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute left-4 top-4 z-20">
        <div className="rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-xs uppercase tracking-wider text-white/65 backdrop-blur-sm">
          Inverse Path
        </div>
      </div>

      <button
        type="button"
        aria-label={isPathPlaying ? "Pause inverse path" : "Play inverse path"}
        aria-pressed={isPathPlaying}
        className="absolute bottom-4 left-4 z-40 inline-flex h-11 items-center gap-2 rounded-lg border border-cyan-200/30 bg-black/75 px-4 text-xs font-medium uppercase tracking-wider text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.18)] backdrop-blur-sm hover:bg-cyan-300/10"
        onClick={togglePlayback}
      >
        {isPathPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {isPathPlaying ? "Pause" : "Play"}
        {!audioStarted && <span className="text-white/40">Space</span>}
      </button>

      <InversePathSettingsPanel
        collapsed={settingsCollapsed}
        onToggle={() => setSettingsCollapsed((value) => !value)}
        pathPattern={pathPattern}
        onPathPatternChange={handlePathPatternChange}
        lineStepCount={lineStepCount}
        onLineStepCountChange={(value) => setLineStepCount(clampLineStepCount(value))}
        speed={speed}
        onSpeedChange={(value) => setSpeed(clamp(value, SPEED_MIN, SPEED_MAX))}
        hitRateHz={hitRateHz}
        onHitRateChange={(value) => setHitRateHz(clamp(value, HIT_RATE_MIN_HZ, HIT_RATE_MAX_HZ))}
        hitReleaseSeconds={hitReleaseSeconds}
        onHitReleaseChange={(value) => setHitReleaseSeconds(clamp(
          value,
          HIT_RELEASE_MIN_SECONDS,
          HIT_RELEASE_MAX_SECONDS
        ))}
        circleCount={circleCount}
        onCircleCountChange={(value) => setCircleCount(clampCircleCount(value))}
        circleRadius={circleRadius}
        onCircleRadiusChange={(value) => {
          const nextRadius = clampCircleRadius(value, lineCenter, surfaceSizeRef.current)
          setCircleRadius(nextRadius)
          setLineCenter((center) => clampCircleCenter(center, nextRadius, surfaceSizeRef.current))
          setAdditionalCircleCenters((centers) =>
            normalizeAdditionalCircleCenters(centers, lineCenter).map((center) =>
              clampCircleCenter(center, nextRadius, surfaceSizeRef.current)
            )
          )
        }}
        circlePlaybackMode={circlePlaybackMode}
        onCirclePlaybackModeChange={setCirclePlaybackMode}
        circleMotionDotCount={circleMotionDotCount}
        onCircleMotionDotCountChange={(value) => setCircleMotionDotCount(clampCircleMotionDotCount(value))}
        circleDotCount={circleDotCount}
        onCircleDotCountChange={(value) => setCircleDotCount(clampCircleDotCount(value))}
        volumeDb={volumeDb}
        onVolumeChange={(value) => setVolumeDb(clamp(value, VOLUME_MIN_DB, VOLUME_MAX_DB))}
        bandwidth={bandwidth}
        onBandwidthChange={(value) => setBandwidth(clamp(value, BANDWIDTH_MIN_OCTAVES, BANDWIDTH_MAX_OCTAVES))}
        inverseDotOutsideGapOctaves={inverseDotOutsideGapOctaves}
        onInverseDotOutsideGapChange={(value) => setInverseDotOutsideGapOctaves(clamp(
          value,
          inversePathAudio.MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
          inversePathAudio.MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES
        ))}
        inverseDotBandBoostDb={inverseDotBandBoostDb}
        onInverseDotBandBoostChange={(value) => setInverseDotBandBoostDb(clamp(
          value,
          inversePathAudio.MIN_INVERSE_DOT_BAND_BOOST_DB,
          inversePathAudio.MAX_INVERSE_DOT_BAND_BOOST_DB
        ))}
        circleXTiltDb={circleXTiltDb}
        onCircleXTiltChange={(value) => setCircleXTiltDb(clamp(
          value,
          CIRCLE_TILT_MIN_DB,
          CIRCLE_TILT_MAX_DB
        ))}
        circleYTiltDb={circleYTiltDb}
        onCircleYTiltChange={(value) => setCircleYTiltDb(clamp(
          value,
          CIRCLE_TILT_MIN_DB,
          CIRCLE_TILT_MAX_DB
        ))}
        lineStartGainDb={lineStartGainDb}
        onLineStartGainChange={(value) => setLineStartGainDb(clamp(
          value,
          LINE_ENDPOINT_GAIN_MIN_DB,
          LINE_ENDPOINT_GAIN_MAX_DB
        ))}
        lineEndGainDb={lineEndGainDb}
        onLineEndGainChange={(value) => setLineEndGainDb(clamp(
          value,
          LINE_ENDPOINT_GAIN_MIN_DB,
          LINE_ENDPOINT_GAIN_MAX_DB
        ))}
      />
    </main>
  )
}
