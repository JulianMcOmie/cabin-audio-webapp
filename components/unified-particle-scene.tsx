"use client"

import { useRef, useMemo, useCallback, useEffect, useState } from "react"
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber"
import { EffectComposer, Bloom } from "@react-three/postprocessing"
import * as THREE from "three"
import { useStereoFFT, STEREO_DISPLAY_BINS } from "@/lib/hooks/useStereoFFT"
import { useBassReactive } from "@/lib/hooks/useBassReactive"
import { useDarkMode } from "@/lib/hooks/useDarkMode"
import { usePlayerStore } from "@/lib/stores"
import { SimpleSoundstage } from "@/components/simple-soundstage"
import type { HighlightTarget } from "@/components/top-overlay"

// ---------------------------------------------------------------------------
// Layout — from visualizer
// ---------------------------------------------------------------------------

const DISPLAY_BINS = STEREO_DISPLAY_BINS

export type QualityLevel = "low" | "medium" | "high"
const PARTICLE_COUNTS: Record<QualityLevel, number> = {
  low: 0,
  medium: 18_000,
  high: 52_000,
}
const BLOOM_DARK: Record<QualityLevel, number> = { low: 0, medium: 3.0, high: 2.2 }
const BLOOM_LIGHT: Record<QualityLevel, number> = { low: 0, medium: 1.4, high: 1.0 }

let TOTAL_PARTICLES = PARTICLE_COUNTS.medium

const X_HALF = 18
const Y_MIN = -9.5
const Y_MAX = 9.5
const Y_MID = (Y_MIN + Y_MAX) * 0.5
const Z_MIN = -2.6
const Z_MAX = 3.4

const WORLD_H = Y_MAX - Y_MIN
const WORLD_D = Z_MAX - Z_MIN
const X_WRAP_MIN = -X_HALF - 6.2
const X_WRAP_MAX = X_HALF + 6.2
const Y_WRAP_MIN = Y_MIN - 4.2
const Y_WRAP_MAX = Y_MAX + 4.2
const WRAP_W = X_WRAP_MAX - X_WRAP_MIN
const WRAP_H = Y_WRAP_MAX - Y_WRAP_MIN

const MAX_DT = 1 / 30
const MAX_SPEED = 8.4
// MAX_SPEED_SQ not needed — speed limit is dynamic based on transition
const LINEAR_DRAG = 1.45

const BASE_FLOW_FORCE = 2.7
const THERMAL_FORCE = 1.45
const CONFINEMENT_FORCE = 0.18
const CALM_RECENTER_FORCE = 0.95
const AUDIO_PULL_FORCE = 16.5
const AUDIO_PUSH_FORCE = 11.8
const AUDIO_PUSH_HIT_GAIN = 32.0
const AUDIO_SWIRL = 4.8
const AUDIO_VORTEX_FORCE = 4.8
const CORE_CAPTURE_FORCE = 8.0
const CORE_BURST_FORCE = 24.0
const CORE_CAPTURE_RADIUS_SQ = 0.12
const CORE_BURST_RADIUS_SQ = 0.022
const AUDIO_Z_PUSH = 5.2
const AUDIO_BIN_INFLUENCE = 2
const TRANSIENT_FORCE_WEIGHT = 1.75
const MAG_FORCE_WEIGHT = 0.45
const LOW_BAND_END_T = 0.26
const MID_BAND_END_T = 0.72
const MID_SUPER_START_T = 0.47
const MID_SUPER_END_T = 0.58
const BASS_BAND_UP_FORCE = 32.0
const MID_BAND_INWARD_FORCE = 64.0
const MID_BAND_OUTWARD_FORCE = 35.0
const MID_BAND_SWIRL_FORCE = 11.0
const HIGH_BAND_DOWN_FORCE = 28.0
const HIGH_BAND_PUNCH_FORCE = 39.0
const GLOBAL_FORCE_GAIN = 1.32
const SHAKE_INTENSITY_MULT = 3.0
const PAN_STEER_FORCE = 14.0
const ORIGIN_STEER_FORCE = 10.0
const PAN_ORIGIN_SWIRL_FORCE = 6.0
const PERIM_EMIT_RATE_MAX = 7600
const PERIM_EMIT_RATE_BASE = 2600
const PERIM_EMIT_MIN_TRIGGER = 0.05
const EMIT_MARGIN_X = 3.4
const EMIT_MARGIN_Y = 2.4
const BASS_BOTTOM_EXTRA_WIDTH = 2.0
const CENTER_SPAWN_RADIUS = 2.1
const AMBIENT_CENTER_SPAWN_CHANCE = 0.18
const AMBIENT_EVERYWHERE_SPAWN_CHANCE = 0.32
const LIFE_CENTER_SPAWN_CHANCE = 0.22
const LIFE_EVERYWHERE_SPAWN_CHANCE = 0.4
const SIDE_MIX_ZONE = 1.35
const SIDE_MIX_FORCE = 46.0
const SIDE_MIX_SWIRL = 18.0
const SIDE_BOUNCE_RESTITUTION = 1.42
const SIDE_CORNER_ESCAPE_FORCE = 34.0
const TOP_MIX_ZONE = 1.3
const TOP_MIX_FORCE = 34.0
const TOP_MIX_SWIRL = 11.0
const TOP_BOUNCE_RESTITUTION = 1.08
const BOTTOM_MIX_ZONE = 1.35
const BOTTOM_MIX_FORCE = 38.0
const BOTTOM_MIX_SWIRL = 12.0
const BOTTOM_BOUNCE_RESTITUTION = 1.14
const EDGE_ESCAPE_FORCE = 58.0
const PARTICLE_LIFE_MIN = 8.5
const PARTICLE_LIFE_MAX = 20.0
const LIFE_FADE_IN = 0.07
const LIFE_FADE_OUT = 0.22

const DENSITY_COLS = 60
const DENSITY_ROWS = 34
const DENSITY_CELLS = DENSITY_COLS * DENSITY_ROWS
const EXPECTED_DENSITY = TOTAL_PARTICLES / DENSITY_CELLS
const INV_EXPECTED_DENSITY = 1 / EXPECTED_DENSITY
const DENSITY_REPULSION = 3.3

// ---------------------------------------------------------------------------
// Grid spring constants
// ---------------------------------------------------------------------------

const GRID_SPRING_K = 120.0
const GRID_IDLE_DAMPING = 14.0
const GRID_COALESCE_SPRING_BOOST = 220.0
const GRID_COALESCE_SPEED_BOOST = 1.8
const GRID_COALESCE_DEADZONE = 0.45
const GRID_COALESCE_BOOST_DISTANCE = 5.0
const SOUNDSTAGE_SETTLE_SPEED_MULT = 5.0
const GRID_SPHERE_RADIUS = 1.45
const GRID_HOVER_RADIAL_BREATH = 0.04
const GRID_HOVER_BREATH_FREQ = 1.9
const GRID_HOVER_TANGENT_SWAY = 0.12
const GRID_HOVER_ORBIT_SPEED = 1.7
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const SOUNDSTAGE_DEPLOY_DURATION = 0.95
const SOUNDSTAGE_COLLAPSE_JITTER = 0.016
const SOUNDSTAGE_COLLAPSE_OUTWARD_SPEED = 0.16
const SOUNDSTAGE_VIZ_FIELD_TR_CUTOFF = 0.45
const GRID_SPACING_MAX = 4.6
const GRID_SPACING_SPAN = 24.0

// ---------------------------------------------------------------------------
// Cursor dot attraction constants
// ---------------------------------------------------------------------------

const CURSOR_ATTRACT_RADIUS = 3.5
const CURSOR_ATTRACT_RADIUS_SQ = CURSOR_ATTRACT_RADIUS * CURSOR_ATTRACT_RADIUS
const CURSOR_ATTRACT_FORCE = 280.0
const CURSOR_ORBIT_FORCE = 12.0
const CURSOR_RADIAL_OSCILLATION = 0.06
const CURSOR_BREATH_FREQ = 2.5
const CURSOR_ACTIVATION_RATE = 8.0
const CURSOR_DEACTIVATION_RATE = 4.0
const CURSOR_SPHERE_PARTICLE_COUNT = 300
const CURSOR_SPHERE_RADIUS = 1.2
const CURSOR_FALLBACK_FORCE = 40.0

const TRANSITION_RATE_TO_VISUALIZER = 3.0
const TRANSITION_RATE_TO_SOUNDSTAGE = 9.5

// ---------------------------------------------------------------------------
// Hue gradient colors
// ---------------------------------------------------------------------------

const BASS_DARK = new THREE.Color("#5577ff")
const MID_DARK = new THREE.Color("#00ffff")
const TREBLE_DARK = new THREE.Color("#55ffaa")
const DIM_DARK = new THREE.Color("#8080a0")

const BASS_LIGHT = new THREE.Color("#334499")
const MID_LIGHT = new THREE.Color("#007777")
const TREBLE_LIGHT = new THREE.Color("#337755")
const DIM_LIGHT = new THREE.Color("#8888a0")

// Envelope constants
const ATTACK_MS = 10
const RELEASE_TAU = 0.4

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const wrap = (value: number, min: number, max: number): number => {
  const range = max - min
  if (value < min) return value + range
  if (value > max) return value - range
  return value
}

// ---------------------------------------------------------------------------
// Shaders — from visualizer
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute vec3 aColor;
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    vOpacity = aOpacity;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (150.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uCircle;
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    float alpha = texture2D(uCircle, gl_PointCoord).a;
    gl_FragColor = vec4(vColor, vOpacity * alpha);
  }
`

// Generate a soft-circle texture at module level (once)
function createCircleTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  const half = size / 2
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0.0, "rgba(255,255,255,1)")
  grad.addColorStop(0.7, "rgba(255,255,255,1)")
  grad.addColorStop(1.0, "rgba(255,255,255,0)")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

let _circleTexture: THREE.Texture | null = null
function getCircleTexture(): THREE.Texture {
  if (!_circleTexture) _circleTexture = createCircleTexture()
  return _circleTexture
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiedParticleSceneProps {
  gridRows: number
  gridCols: number
  selectedDots: Set<string>
  onDotSelect: (x: number, y: number) => void
  onDotDeselect: (x: number, y: number) => void
  playingDotKey: string | null
  beatIndex: number
  hoveredDot: string | null
  onHoverDot: (key: string | null) => void
  quality?: QualityLevel
  highlightTarget?: HighlightTarget
  onDragStateChange?: (isDragging: boolean) => void
  cursorDotPosition?: { normalizedX: number; normalizedY: number } | null
  onCursorDotMove?: (normalizedX: number, normalizedY: number) => void
  onCursorDotEnd?: () => void
}

// ---------------------------------------------------------------------------
// Envelope tracker — from dot-grid-3d
// ---------------------------------------------------------------------------

interface EnvelopeState {
  value: number
  phase: "attack" | "release" | "idle"
  phaseStartTime: number
  releaseStartValue: number
}

function useEnvelopeTracker(selectedDots: Set<string>, playingDotKey: string | null, beatIndex: number) {
  const envelopes = useRef<Map<string, EnvelopeState>>(new Map())
  const prevPlaying = useRef<string | null>(null)
  const prevBeat = useRef<number>(-1)

  const tick = useCallback((clockMs: number) => {
    const currentPlaying = playingDotKey
    const beatChanged = beatIndex !== prevBeat.current

    if (currentPlaying !== prevPlaying.current || beatChanged) {
      envelopes.current.forEach((env, key) => {
        if (key !== currentPlaying && env.phase !== "idle") {
          env.releaseStartValue = env.value
          env.phase = "release"
          env.phaseStartTime = clockMs
        }
      })

      if (currentPlaying) {
        envelopes.current.set(currentPlaying, {
          value: 0,
          phase: "attack",
          phaseStartTime: clockMs,
          releaseStartValue: 1,
        })
      }
      prevPlaying.current = currentPlaying
      prevBeat.current = beatIndex
    }

    envelopes.current.forEach((env) => {
      const dt = clockMs - env.phaseStartTime
      if (env.phase === "attack") {
        env.value = Math.min(1, dt / ATTACK_MS)
        if (dt >= ATTACK_MS) {
          env.releaseStartValue = env.value
          env.phase = "release"
          env.phaseStartTime = clockMs
        }
      } else if (env.phase === "release") {
        env.value = env.releaseStartValue * Math.exp(-dt / (RELEASE_TAU * 1000))
        if (env.value < 0.01) {
          env.phase = "idle"
          env.value = 0
        }
      }
    })

    for (const dotKey of envelopes.current.keys()) {
      if (!selectedDots.has(dotKey)) {
        envelopes.current.delete(dotKey)
      }
    }
  }, [playingDotKey, beatIndex, selectedDots])

  const getEnvelope = useCallback((dotKey: string): number => {
    const env = envelopes.current.get(dotKey)
    if (!env) return 0
    return env.value
  }, [])

  return { tick, getEnvelope }
}

// ---------------------------------------------------------------------------
// Pre-computed data — from visualizer
// ---------------------------------------------------------------------------

function buildParticleData() {
  const initialPositions = new Float32Array(TOTAL_PARTICLES * 3)
  const velX = new Float32Array(TOTAL_PARTICLES)
  const velY = new Float32Array(TOTAL_PARTICLES)
  const velZ = new Float32Array(TOTAL_PARTICLES)
  const originDirX = new Float32Array(TOTAL_PARTICLES)
  const originDirY = new Float32Array(TOTAL_PARTICLES)
  const phases = new Float32Array(TOTAL_PARTICLES)
  const ages = new Float32Array(TOTAL_PARTICLES)
  const lifespans = new Float32Array(TOTAL_PARTICLES)

  for (let i = 0; i < TOTAL_PARTICLES; i++) {
    const i3 = i * 3
    initialPositions[i3] = X_WRAP_MIN + Math.random() * WRAP_W
    initialPositions[i3 + 1] = Y_WRAP_MIN + Math.random() * WRAP_H
    initialPositions[i3 + 2] = Z_MIN + Math.random() * WORLD_D

    const angle = Math.random() * Math.PI * 2
    const speed = 0.12 + Math.random() * 0.34
    velX[i] = Math.cos(angle) * speed
    velY[i] = Math.sin(angle) * speed
    velZ[i] = (Math.random() - 0.5) * 0.22
    setOriginDirection(i, velX[i], velY[i], originDirX, originDirY)
    phases[i] = Math.random() * Math.PI * 2

    const life = PARTICLE_LIFE_MIN + Math.random() * (PARTICLE_LIFE_MAX - PARTICLE_LIFE_MIN)
    lifespans[i] = life
    ages[i] = Math.random() * life
  }

  return { initialPositions, velX, velY, velZ, originDirX, originDirY, phases, ages, lifespans }
}

function resetParticleLife(index: number, ages: Float32Array, lifespans: Float32Array) {
  const life = PARTICLE_LIFE_MIN + Math.random() * (PARTICLE_LIFE_MAX - PARTICLE_LIFE_MIN)
  lifespans[index] = life
  ages[index] = 0
}

function setOriginDirection(
  index: number,
  vx: number,
  vy: number,
  originDirX: Float32Array,
  originDirY: Float32Array,
) {
  const len = Math.hypot(vx, vy)
  if (len > 1e-5) {
    originDirX[index] = vx / len
    originDirY[index] = vy / len
    return
  }
  const angle = Math.random() * Math.PI * 2
  originDirX[index] = Math.cos(angle)
  originDirY[index] = Math.sin(angle)
}

function respawnParticleFromPerimeter(
  index: number,
  positions: Float32Array,
  velX: Float32Array,
  velY: Float32Array,
  velZ: Float32Array,
  originDirX: Float32Array,
  originDirY: Float32Array,
  ages: Float32Array,
  lifespans: Float32Array,
  launchScale: number,
  forcedSide: number = -1,
) {
  const i3 = index * 3
  const side = forcedSide >= 0 ? forcedSide : Math.floor(Math.random() * 4)
  const along = Math.random()
  const depth = Math.random()
  const launch = launchScale * (0.65 + Math.random() * 1.35)
  const z = Z_MIN + depth * WORLD_D

  let x = 0
  let y = 0
  let vx = 0
  let vy = 0

  if (side === 0) {
    x = -X_HALF - EMIT_MARGIN_X - along * 3.2
    y = Y_MIN - 0.7 + Math.random() * (WORLD_H + 1.4)
    vx = launch * (1.0 + Math.random() * 1.8)
    vy = launch * ((Math.random() - 0.5) * 1.5)
  } else if (side === 1) {
    x = X_HALF + EMIT_MARGIN_X + along * 3.2
    y = Y_MIN - 0.7 + Math.random() * (WORLD_H + 1.4)
    vx = -launch * (1.0 + Math.random() * 1.8)
    vy = launch * ((Math.random() - 0.5) * 1.5)
  } else if (side === 2) {
    x = -X_HALF - 0.8 + along * (X_HALF * 2 + 1.6)
    y = Y_MAX + EMIT_MARGIN_Y + Math.random() * 2.6
    vx = launch * ((Math.random() - 0.5) * 1.9)
    vy = -launch * (0.95 + Math.random() * 1.7)
  } else {
    x = -X_HALF - 0.8 + along * (X_HALF * 2 + 1.6)
    y = Y_MIN - EMIT_MARGIN_Y - Math.random() * 2.6
    vx = launch * ((Math.random() - 0.5) * 1.9)
    vy = launch * (0.95 + Math.random() * 2.0)
  }

  positions[i3] = x
  positions[i3 + 1] = y
  positions[i3 + 2] = z

  velX[index] = vx + (-x) * 0.12 * (0.6 + Math.random() * 0.8)
  velY[index] = vy + (Y_MID - y) * 0.1 * (0.6 + Math.random() * 0.8)
  velZ[index] = (Math.random() - 0.5) * (0.85 + launchScale * 1.55)
  setOriginDirection(index, velX[index], velY[index], originDirX, originDirY)

  resetParticleLife(index, ages, lifespans)
}

function respawnParticleEverywhere(
  index: number,
  positions: Float32Array,
  velX: Float32Array,
  velY: Float32Array,
  velZ: Float32Array,
  originDirX: Float32Array,
  originDirY: Float32Array,
  ages: Float32Array,
  lifespans: Float32Array,
  launchScale: number,
) {
  const i3 = index * 3
  const x = -X_HALF + Math.random() * (X_HALF * 2)
  const y = Y_MIN + Math.random() * WORLD_H
  const z = Z_MIN + Math.random() * WORLD_D
  const angle = Math.random() * Math.PI * 2
  const speed = launchScale * (0.35 + Math.random() * 1.35)

  positions[i3] = x
  positions[i3 + 1] = y
  positions[i3 + 2] = z

  velX[index] = Math.cos(angle) * speed + (-x) * 0.03
  velY[index] = Math.sin(angle) * speed + (Y_MID - y) * 0.03
  velZ[index] = (Math.random() - 0.5) * (0.55 + launchScale * 1.25)
  setOriginDirection(index, velX[index], velY[index], originDirX, originDirY)

  resetParticleLife(index, ages, lifespans)
}

function respawnParticleFromCenter(
  index: number,
  positions: Float32Array,
  velX: Float32Array,
  velY: Float32Array,
  velZ: Float32Array,
  originDirX: Float32Array,
  originDirY: Float32Array,
  ages: Float32Array,
  lifespans: Float32Array,
  launchScale: number,
) {
  const i3 = index * 3
  const angle = Math.random() * Math.PI * 2
  const radial = Math.pow(Math.random(), 0.65) * CENTER_SPAWN_RADIUS
  const x = Math.cos(angle) * radial
  const y = Y_MID + Math.sin(angle) * radial * 0.85
  const z = Z_MIN + (0.25 + Math.random() * 0.5) * WORLD_D
  const out = launchScale * (1.0 + Math.random() * 2.4)
  const radialX = Math.cos(angle)
  const radialY = Math.sin(angle)

  positions[i3] = x
  positions[i3 + 1] = y
  positions[i3 + 2] = z

  velX[index] = radialX * out + (-x) * 0.02
  velY[index] = radialY * out + (Math.random() - 0.2) * out * 0.6
  velZ[index] = (Math.random() - 0.5) * (0.65 + launchScale * 1.65)
  setOriginDirection(index, velX[index], velY[index], originDirX, originDirY)

  resetParticleLife(index, ages, lifespans)
}

function respawnParticleMixed(
  index: number,
  positions: Float32Array,
  velX: Float32Array,
  velY: Float32Array,
  velZ: Float32Array,
  originDirX: Float32Array,
  originDirY: Float32Array,
  ages: Float32Array,
  lifespans: Float32Array,
  launchScale: number,
  centerChance: number,
  everywhereChance: number,
) {
  const roll = Math.random()
  if (roll < centerChance) {
    respawnParticleFromCenter(index, positions, velX, velY, velZ, originDirX, originDirY, ages, lifespans, launchScale)
    return
  }
  if (roll < centerChance + everywhereChance) {
    respawnParticleEverywhere(index, positions, velX, velY, velZ, originDirX, originDirY, ages, lifespans, launchScale)
    return
  }
  respawnParticleFromPerimeter(index, positions, velX, velY, velZ, originDirX, originDirY, ages, lifespans, launchScale)
}

function respawnParticleFromBottomBand(
  index: number,
  positions: Float32Array,
  velX: Float32Array,
  velY: Float32Array,
  velZ: Float32Array,
  originDirX: Float32Array,
  originDirY: Float32Array,
  ages: Float32Array,
  lifespans: Float32Array,
  launchScale: number,
) {
  const i3 = index * 3
  const x =
    -X_HALF - BASS_BOTTOM_EXTRA_WIDTH + Math.random() * (X_HALF * 2 + BASS_BOTTOM_EXTRA_WIDTH * 2)
  const y = Y_MIN - EMIT_MARGIN_Y - Math.random() * 2.8
  const z = Z_MIN + Math.random() * (WORLD_D * 0.55)
  const up = launchScale * (1.1 + Math.random() * 2.4)
  const lateral = launchScale * ((Math.random() - 0.5) * 2.1)

  positions[i3] = x
  positions[i3 + 1] = y
  positions[i3 + 2] = z

  velX[index] = lateral + (-x) * 0.08 * (0.5 + Math.random() * 0.7)
  velY[index] = up + (Math.random() - 0.3) * up * 0.25
  velZ[index] = (Math.random() - 0.5) * (0.9 + launchScale * 1.35)
  setOriginDirection(index, velX[index], velY[index], originDirX, originDirY)

  resetParticleLife(index, ages, lifespans)
}

function buildBinYPositions(): Float32Array {
  const positions = new Float32Array(DISPLAY_BINS)
  for (let i = 0; i < DISPLAY_BINS; i++) {
    positions[i] = Y_MIN + (i / (DISPLAY_BINS - 1)) * (Y_MAX - Y_MIN)
  }
  return positions
}

// ---------------------------------------------------------------------------
// Build home positions: assign each particle to a grid point on the XY plane
// ---------------------------------------------------------------------------

function buildHomePositions(
  gridRows: number,
  gridCols: number,
  homePositions: Float32Array,
  homeAssignment: Int32Array,
  dotCenters: Float32Array,
  homeNormalX: Float32Array,
  homeNormalY: Float32Array,
  homeNormalZ: Float32Array,
  homeTangentAX: Float32Array,
  homeTangentAY: Float32Array,
  homeTangentAZ: Float32Array,
  homeTangentBX: Float32Array,
  homeTangentBY: Float32Array,
  homeTangentBZ: Float32Array,
  homeRadius: Float32Array,
) {
  const totalDots = gridRows * gridCols
  if (totalDots === 0) {
    homeAssignment.fill(-1)
    homeRadius.fill(0)
    return
  }
  const perDot = Math.floor(TOTAL_PARTICLES / totalDots)
  const remainder = TOTAL_PARTICLES - perDot * totalDots

  // Grid spacing: spread grid across a visible area on XY plane
  // Scale grid to fit reasonably within the visualizer camera view
  const spacing = Math.min(GRID_SPACING_MAX, GRID_SPACING_SPAN / Math.max(gridCols - 1, gridRows - 1, 1))

  let particleIdx = 0
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const dotIdx = row * gridCols + col
      // Grid center on XY plane (z=0), facing perspective camera at (0,0,20)
      const cx = (col - (gridCols - 1) / 2) * spacing
      const cy = (row - (gridRows - 1) / 2) * spacing
      const cz = 0
      const centerI3 = dotIdx * 3
      dotCenters[centerI3] = cx
      dotCenters[centerI3 + 1] = cy
      dotCenters[centerI3 + 2] = cz

      const count = perDot + (dotIdx < remainder ? 1 : 0)
      for (let p = 0; p < count; p++) {
        if (particleIdx >= TOTAL_PARTICLES) break
        // Evenly spaced points on a sphere using a Fibonacci lattice.
        const u = (p + 0.5) / count
        const nz = 1 - 2 * u
        const radial = Math.sqrt(Math.max(0, 1 - nz * nz))
        const theta = p * GOLDEN_ANGLE
        const nx = Math.cos(theta) * radial
        const ny = Math.sin(theta) * radial
        const radius = Math.min(GRID_SPHERE_RADIUS, spacing * 0.42)

        const i3 = particleIdx * 3
        homePositions[i3] = cx + nx * radius
        homePositions[i3 + 1] = cy + ny * radius
        homePositions[i3 + 2] = cz + nz * radius
        homeNormalX[particleIdx] = nx
        homeNormalY[particleIdx] = ny
        homeNormalZ[particleIdx] = nz
        homeRadius[particleIdx] = radius

        // Build an orthonormal tangent basis used for subtle in-place hover motion.
        const refX = Math.abs(nz) > 0.96 ? 0 : 0
        const refY = Math.abs(nz) > 0.96 ? 1 : 0
        const refZ = Math.abs(nz) > 0.96 ? 0 : 1
        let tax = refY * nz - refZ * ny
        let tay = refZ * nx - refX * nz
        let taz = refX * ny - refY * nx
        const tLen = Math.hypot(tax, tay, taz) || 1
        tax /= tLen
        tay /= tLen
        taz /= tLen
        homeTangentAX[particleIdx] = tax
        homeTangentAY[particleIdx] = tay
        homeTangentAZ[particleIdx] = taz

        homeTangentBX[particleIdx] = ny * taz - nz * tay
        homeTangentBY[particleIdx] = nz * tax - nx * taz
        homeTangentBZ[particleIdx] = nx * tay - ny * tax
        homeAssignment[particleIdx] = dotIdx
        particleIdx++
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cursor sphere template — Fibonacci lattice with tangent bases
// ---------------------------------------------------------------------------

interface CursorSphereTemplate {
  normalX: Float32Array
  normalY: Float32Array
  normalZ: Float32Array
  tangentAX: Float32Array
  tangentAY: Float32Array
  tangentAZ: Float32Array
  tangentBX: Float32Array
  tangentBY: Float32Array
  tangentBZ: Float32Array
}

function buildCursorSphereTemplate(): CursorSphereTemplate {
  const n = CURSOR_SPHERE_PARTICLE_COUNT
  const normalX = new Float32Array(n)
  const normalY = new Float32Array(n)
  const normalZ = new Float32Array(n)
  const tangentAX = new Float32Array(n)
  const tangentAY = new Float32Array(n)
  const tangentAZ = new Float32Array(n)
  const tangentBX = new Float32Array(n)
  const tangentBY = new Float32Array(n)
  const tangentBZ = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n
    const nz = 1 - 2 * u
    const radial = Math.sqrt(Math.max(0, 1 - nz * nz))
    const theta = i * GOLDEN_ANGLE
    const nx = Math.cos(theta) * radial
    const ny = Math.sin(theta) * radial
    normalX[i] = nx
    normalY[i] = ny
    normalZ[i] = nz

    // Tangent basis (same algorithm as buildHomePositions)
    const refX = Math.abs(nz) > 0.96 ? 0 : 0
    const refY = Math.abs(nz) > 0.96 ? 1 : 0
    const refZ = Math.abs(nz) > 0.96 ? 0 : 1
    let tax = refY * nz - refZ * ny
    let tay = refZ * nx - refX * nz
    let taz = refX * ny - refY * nx
    const tLen = Math.hypot(tax, tay, taz) || 1
    tax /= tLen
    tay /= tLen
    taz /= tLen
    tangentAX[i] = tax
    tangentAY[i] = tay
    tangentAZ[i] = taz

    tangentBX[i] = ny * taz - nz * tay
    tangentBY[i] = nz * tax - nx * taz
    tangentBZ[i] = nx * tay - ny * tax
  }

  return { normalX, normalY, normalZ, tangentAX, tangentAY, tangentAZ, tangentBX, tangentBY, tangentBZ }
}

// ---------------------------------------------------------------------------
// InteractionPlane — adapted for XY plane with perspective camera
// ---------------------------------------------------------------------------

function InteractionPlane({
  gridRows,
  gridCols,
  gridSpacing,
  selectedDots,
  onDotSelect,
  onDotDeselect,
  onHoverDot,
  disabled,
  onDragStateChange,
}: {
  gridRows: number
  gridCols: number
  gridSpacing: number
  selectedDots: Set<string>
  onDotSelect: (x: number, y: number) => void
  onDotDeselect: (x: number, y: number) => void
  onHoverDot: (key: string | null) => void
  disabled: boolean
  onDragStateChange?: (isDragging: boolean) => void
}) {
  const planeWidth = (gridCols + 1) * gridSpacing
  const planeHeight = (gridRows + 1) * gridSpacing
  const dragMode = useRef<"select" | "deselect" | null>(null)
  const visited = useRef<Set<string>>(new Set())

  const resolveGrid = useCallback(
    (point: THREE.Vector3) => {
      // Point is on XY plane (z=0)
      const col = Math.round(point.x / gridSpacing + (gridCols - 1) / 2)
      const row = Math.round(point.y / gridSpacing + (gridRows - 1) / 2)
      if (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
        return { col, row }
      }
      return null
    },
    [gridRows, gridCols, gridSpacing]
  )

  const applyToHit = useCallback(
    (col: number, row: number) => {
      const key = `${col},${row}`
      if (visited.current.has(key)) return
      visited.current.add(key)
      if (dragMode.current === "select") {
        onDotSelect(col, row)
      } else if (dragMode.current === "deselect") {
        onDotDeselect(col, row)
      }
    },
    [onDotSelect, onDotDeselect]
  )

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (disabled) return
      e.stopPropagation()
      const hit = resolveGrid(e.point)
      if (!hit) return
      const key = `${hit.col},${hit.row}`
      dragMode.current = selectedDots.has(key) ? "deselect" : "select"
      visited.current = new Set()
      applyToHit(hit.col, hit.row)
      onDragStateChange?.(true)
    },
    [resolveGrid, selectedDots, applyToHit, disabled, onDragStateChange]
  )

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (disabled) {
        onHoverDot(null)
        return
      }
      const hit = resolveGrid(e.point)
      onHoverDot(hit ? `${hit.col},${hit.row}` : null)
      if (dragMode.current && hit) {
        applyToHit(hit.col, hit.row)
      }
    },
    [resolveGrid, onHoverDot, applyToHit, disabled]
  )

  const handlePointerUp = useCallback(() => {
    dragMode.current = null
    visited.current.clear()
    onDragStateChange?.(false)
  }, [onDragStateChange])

  const handlePointerLeave = useCallback(() => {
    dragMode.current = null
    visited.current.clear()
    onHoverDot(null)
    onDragStateChange?.(false)
  }, [onHoverDot, onDragStateChange])

  return (
    <mesh
      position={[0, 0, -0.01]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Unified scene content
// ---------------------------------------------------------------------------

function UnifiedSceneContent({
  gridRows,
  gridCols,
  selectedDots,
  onDotSelect,
  onDotDeselect,
  playingDotKey,
  beatIndex,
  hoveredDot,
  onHoverDot,
  isDarkMode,
  highlightTarget,
  onDragStateChange,
  cursorDotPosition,
}: UnifiedParticleSceneProps & { isDarkMode: boolean }) {
  // Subscribe to isPlaying from the player store
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  // Transition value: 0 = idle/grid, 1 = playing/visualizer
  const transitionRef = useRef(0)
  const soundstageDeployRef = useRef(0)
  const pendingSoundstageResetRef = useRef(true)
  const prevIsPlayingRef = useRef(isPlaying)
  const soundstageSeedMask = useMemo(() => new Uint8Array(TOTAL_PARTICLES), [])
  const soundstageSeedOrder = useMemo(() => {
    const order = new Uint32Array(TOTAL_PARTICLES)
    for (let i = 0; i < TOTAL_PARTICLES; i++) order[i] = i
    for (let i = TOTAL_PARTICLES - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = order[i]
      order[i] = order[j]
      order[j] = tmp
    }
    return order
  }, [])
  const soundstageSeededCountRef = useRef(0)

  useEffect(() => {
    soundstageSeedMask.fill(0)
    soundstageSeededCountRef.current = 0
  }, [soundstageSeedMask])

  // Envelope tracker for dot glow
  const { tick: envelopeTick, getEnvelope } = useEnvelopeTracker(selectedDots, playingDotKey, beatIndex)
  const clockRef = useRef(0)

  // Cursor dot tracking
  const cursorWorldRef = useRef({ x: 0, y: 0, active: false })
  const cursorActivationRef = useRef(0)
  const cursorSphereTemplate = useMemo(() => buildCursorSphereTemplate(), [])
  const cursorSphereFlags = useMemo(() => new Uint8Array(TOTAL_PARTICLES), [])

  // FFT hooks — only enabled when playing (or transitioning) to avoid idle overhead
  const fftEnabled = isPlaying || transitionRef.current > 0.01
  const { dataRef: fftDataRef, update: fftUpdate } = useStereoFFT(fftEnabled)
  const { dataRef: bassDataRef, update: bassUpdate } = useBassReactive(fftEnabled)

  const timeRef = useRef(0)
  const smoothPan = useRef(new Float32Array(DISPLAY_BINS))
  const smoothMag = useRef(new Float32Array(DISPLAY_BINS))
  const smoothTransient = useRef(new Float32Array(DISPLAY_BINS))
  const binXBuf = useRef(new Float32Array(DISPLAY_BINS))
  const respawnCursor = useRef(0)
  const ambientEmitterCarry = useRef(0)
  const bassEmitterCarry = useRef(0)

  // Particle data
  const { initialPositions, velX, velY, velZ, originDirX, originDirY, phases, ages, lifespans } = useMemo(() => buildParticleData(), [])
  const binY = useMemo(() => buildBinYPositions(), [])
  const densityField = useMemo(() => new Float32Array(DENSITY_CELLS), [])
  const densityGradX = useMemo(() => new Float32Array(DENSITY_CELLS), [])
  const densityGradY = useMemo(() => new Float32Array(DENSITY_CELLS), [])

  // Home positions for grid mode
  const homePositions = useMemo(() => new Float32Array(TOTAL_PARTICLES * 3), [])
  const homeAssignment = useMemo(() => new Int32Array(TOTAL_PARTICLES), [])
  const homeNormalX = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeNormalY = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeNormalZ = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeTangentAX = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeTangentAY = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeTangentAZ = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeTangentBX = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeTangentBY = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeTangentBZ = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const homeRadius = useMemo(() => new Float32Array(TOTAL_PARTICLES), [])
  const dotCenters = useMemo(() => new Float32Array(Math.max(1, gridRows * gridCols * 3)), [gridRows, gridCols])

  // Grid spacing computed from grid dimensions
  const gridSpacing = useMemo(
    () => Math.min(GRID_SPACING_MAX, GRID_SPACING_SPAN / Math.max(gridCols - 1, gridRows - 1, 1)),
    [gridRows, gridCols]
  )

  // Rebuild home positions when grid changes
  useEffect(() => {
    buildHomePositions(
      gridRows,
      gridCols,
      homePositions,
      homeAssignment,
      dotCenters,
      homeNormalX,
      homeNormalY,
      homeNormalZ,
      homeTangentAX,
      homeTangentAY,
      homeTangentAZ,
      homeTangentBX,
      homeTangentBY,
      homeTangentBZ,
      homeRadius,
    )
  }, [
    gridRows,
    gridCols,
    homePositions,
    homeAssignment,
    dotCenters,
    homeNormalX,
    homeNormalY,
    homeNormalZ,
    homeTangentAX,
    homeTangentAY,
    homeTangentAZ,
    homeTangentBX,
    homeTangentBY,
    homeTangentBZ,
    homeRadius,
  ])

  // Geometry + attributes
  const { geometry, posAttr, colorAttr, sizeAttr, opacityAttr } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(initialPositions)
    const colors = new Float32Array(TOTAL_PARTICLES * 3)
    const sizes = new Float32Array(TOTAL_PARTICLES).fill(0.09)
    const opacities = new Float32Array(TOTAL_PARTICLES).fill(0.08)

    const pa = new THREE.BufferAttribute(positions, 3)
    const ca = new THREE.BufferAttribute(colors, 3)
    const sa = new THREE.BufferAttribute(sizes, 1)
    const oa = new THREE.BufferAttribute(opacities, 1)

    geo.setAttribute("position", pa)
    geo.setAttribute("aColor", ca)
    geo.setAttribute("aSize", sa)
    geo.setAttribute("aOpacity", oa)

    return { geometry: geo, posAttr: pa, colorAttr: ca, sizeAttr: sa, opacityAttr: oa }
  }, [initialPositions])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uCircle: { value: getCircleTexture() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }, [])

  useEffect(() => {
    material.blending = isDarkMode ? THREE.AdditiveBlending : THREE.NormalBlending
    material.needsUpdate = true
  }, [isDarkMode, material])

  const { gl, size } = useThree()
  useEffect(() => {
    gl.setClearColor(isDarkMode ? "#0a0a0f" : "#f0f0f5")
  }, [isDarkMode, gl])

  // Precompute dotIdx → dotKey for reverse lookup
  const dotIdxToKey = useMemo(() => {
    const arr: string[] = []
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        arr[row * gridCols + col] = `${col},${row}`
      }
    }
    return arr
  }, [gridRows, gridCols])

  // ---------------------------------------------------------------------------
  // Main frame loop
  // ---------------------------------------------------------------------------

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DT)
    timeRef.current += dt
    const t = timeRef.current

    if (prevIsPlayingRef.current && !isPlaying) {
      pendingSoundstageResetRef.current = true
      soundstageDeployRef.current = 0
    } else if (!prevIsPlayingRef.current && isPlaying) {
      pendingSoundstageResetRef.current = false
      soundstageDeployRef.current = 1
      soundstageSeedMask.fill(1)
      soundstageSeededCountRef.current = TOTAL_PARTICLES
    }
    prevIsPlayingRef.current = isPlaying

    // Animate transition: exponential ease toward target
    const transitionTarget = isPlaying ? 1.0 : 0.0
    const transitionRate =
      transitionTarget < transitionRef.current
        ? TRANSITION_RATE_TO_SOUNDSTAGE
        : TRANSITION_RATE_TO_VISUALIZER
    transitionRef.current += (transitionTarget - transitionRef.current) * (1 - Math.exp(-transitionRate * dt))
    // Snap to avoid floating point drift
    if (Math.abs(transitionRef.current - transitionTarget) < 0.001) {
      transitionRef.current = transitionTarget
    }
    const tr = transitionRef.current
    if (!isPlaying) {
      soundstageDeployRef.current = Math.min(1, soundstageDeployRef.current + dt / SOUNDSTAGE_DEPLOY_DURATION)
    } else {
      soundstageDeployRef.current = 1
    }
    const soundstageDeployLinear = soundstageDeployRef.current
    const soundstageDeploy =
      soundstageDeployLinear * soundstageDeployLinear * (3 - 2 * soundstageDeployLinear)
    const forceTr = isPlaying ? tr : 0
    const vizFieldWeight = isPlaying && tr > SOUNDSTAGE_VIZ_FIELD_TR_CUTOFF ? 1 : 0

    // Envelope tracker for dot glow (active during idle/grid mode)
    clockRef.current += dt * 1000
    envelopeTick(clockRef.current)

    // FFT + bass update
    fftUpdate()
    bassUpdate()
    const fft = fftDataRef.current

    // Blending mode
    const targetBlending = isDarkMode ? THREE.AdditiveBlending : THREE.NormalBlending
    if (material.blending !== targetBlending) {
      material.blending = targetBlending
      material.needsUpdate = true
    }

    // Color palettes
    const bass = isDarkMode ? BASS_DARK : BASS_LIGHT
    const mid = isDarkMode ? MID_DARK : MID_LIGHT
    const treble = isDarkMode ? TREBLE_DARK : TREBLE_LIGHT
    const dim = isDarkMode ? DIM_DARK : DIM_LIGHT
    const dimR = dim.r, dimG = dim.g, dimB = dim.b

    // Smooth per-bin FFT data (updated smoothing coefficients)
    const sp = smoothPan.current
    const sm = smoothMag.current
    const st = smoothTransient.current
    const bx = binXBuf.current

    let totalEnergy = 0
    let totalTransient = 0
    let centroidAccum = 0
    let lowBandDrive = 0
    let midLowDrive = 0
    let superMidDrive = 0
    let midHighDrive = 0
    let highBandDrive = 0
    let lowBandCount = 0
    let midLowCount = 0
    let superMidCount = 0
    let midHighCount = 0
    let highBandCount = 0
    let highBandTransientDrive = 0
    for (let b = 0; b < DISPLAY_BINS; b++) {
      const rawMag = fft.active ? fft.magnitude[b] : 0
      const rawTransient = fft.active ? fft.transient[b] : 0
      const rawPan = fft.active ? fft.pan[b] : 0

      if (rawMag > sm[b]) {
        sm[b] += (rawMag - sm[b]) * 0.78
      } else {
        sm[b] += (rawMag - sm[b]) * 0.28
      }
      if (rawTransient > st[b]) {
        st[b] += (rawTransient - st[b]) * 0.9
      } else {
        st[b] += (rawTransient - st[b]) * 0.38
      }
      sp[b] += (rawPan - sp[b]) * 0.35
      bx[b] = sp[b] * X_HALF
      totalEnergy += sm[b]
      totalTransient += st[b]
      centroidAccum += sm[b] * b

      const bandT = b / (DISPLAY_BINS - 1)
      const drive = sm[b] * 0.95 + st[b] * 1.5
      if (bandT < LOW_BAND_END_T) {
        lowBandDrive += drive
        lowBandCount++
      } else if (bandT < MID_BAND_END_T) {
        if (bandT < MID_SUPER_START_T) {
          midLowDrive += drive
          midLowCount++
        } else if (bandT <= MID_SUPER_END_T) {
          superMidDrive += drive
          superMidCount++
        } else {
          midHighDrive += drive
          midHighCount++
        }
      } else {
        highBandDrive += drive
        highBandCount++
        highBandTransientDrive += st[b]
      }
    }

    const avgEnergy = totalEnergy / DISPLAY_BINS
    const avgTransient = totalTransient / DISPLAY_BINS
    const globalEnergy = clamp01(avgEnergy * 2.4)
    const globalTransient = clamp01(avgTransient * 3.2)
    const ambientEnergy = Math.max(globalEnergy, 0.17)
    const centroidBin = totalEnergy > 1e-5 ? centroidAccum / totalEnergy : (DISPLAY_BINS - 1) * 0.5
    const centroidY = Y_MIN + (centroidBin / (DISPLAY_BINS - 1)) * WORLD_H
    const soundstageSettleMult = isPlaying ? 1 : SOUNDSTAGE_SETTLE_SPEED_MULT
    const idleDampingNow = GRID_IDLE_DAMPING / soundstageSettleMult
    const damping = Math.exp(-(LINEAR_DRAG * forceTr + idleDampingNow * (1 - forceTr)) * dt)

    // Bass reactive data
    const bassData = bassDataRef.current
    const bassMag = clamp01(Number.isFinite(bassData.magnitude) ? bassData.magnitude : 0)
    const bassTransient = clamp01(Number.isFinite(bassData.transient) ? bassData.transient : 0)
    const dominantBassHz = Number.isFinite(bassData.frequency) ? bassData.frequency : (20 + clamp01(bassData.pitch) * 130)
    const subT = clamp01((100 - dominantBassHz) / 80)
    const deepSubT = clamp01((55 - dominantBassHz) / 35)
    const highCut = Math.pow(clamp01((160 - dominantBassHz) / 60), 3.8)
    const inverseLow = Math.pow(100 / Math.max(20, dominantBassHz), 1.85)
    const lowFreqWeight =
      (0.18 + subT * 2.6 + deepSubT * 9.5 + inverseLow * 0.38) * (0.06 + highCut * 0.94)
    const weightedTransient = bassTransient * (0.05 + highCut * 0.95)
    const lowBassPowerRaw = (bassMag * 1.2 + weightedTransient * 3.4) * lowFreqWeight
    const lowBassCap = 2.4 + highCut * 10 + subT * 8 + deepSubT * 24
    const lowBassPower = Math.min(lowBassCap, lowBassPowerRaw)
    const lowBassImpact = clamp01(lowBassPower / 2.1)
    const lowBandAvg = lowBandCount > 0 ? lowBandDrive / lowBandCount : 0
    const midLowAvg = midLowCount > 0 ? midLowDrive / midLowCount : 0
    const superMidAvg = superMidCount > 0 ? superMidDrive / superMidCount : 0
    const midHighAvg = midHighCount > 0 ? midHighDrive / midHighCount : 0
    const highBandAvg = highBandCount > 0 ? highBandDrive / highBandCount : 0
    const highBandTransientAvg = highBandCount > 0 ? highBandTransientDrive / highBandCount : 0
    const surroundMidAvg = (midLowAvg + midHighAvg) * 0.5
    const bassBandPushUp = BASS_BAND_UP_FORCE * clamp01(lowBandAvg * 2.9 + lowBassImpact * 0.42)
    const midBandInwardPush = MID_BAND_INWARD_FORCE * clamp01(surroundMidAvg * 2.8 + globalTransient * 0.2)
    const superMidOutwardPush = MID_BAND_OUTWARD_FORCE * clamp01(superMidAvg * 3.2 + globalTransient * 0.28)
    const midBandSwirlPush = MID_BAND_SWIRL_FORCE * clamp01((surroundMidAvg * 0.8 + superMidAvg * 0.9) * 2.8 + globalTransient * 0.3)
    const highBandPushDown = HIGH_BAND_DOWN_FORCE * clamp01(highBandAvg * 3.0 + globalTransient * 0.14)
    const highBandPunchDown = HIGH_BAND_PUNCH_FORCE * Math.pow(clamp01(highBandTransientAvg * 5.0 + globalTransient * 0.25), 1.22)
    const globalGlowBoost = clamp01(lowBassPower * 0.11 + bassTransient * 0.88)
    const shakeDrive = clamp01(0.12 + lowBassPower * 0.12 + bassTransient * 1.35)
    const lowHzT = clamp01((100 - dominantBassHz) / 80)
    const deepJitterT = Math.pow(clamp01((60 - dominantBassHz) / 40), 1.65)
    const shakeFreqMult = 1 + lowHzT * 1.35 + deepJitterT * 2.1
    const shakeAmplitudeTighten = 1 - Math.min(0.82, lowHzT * 0.48 + deepJitterT * 0.34)
    const shakePhase = t * (24 + shakeDrive * 46) * shakeFreqMult
    const shakeForceX =
      (Math.sin(shakePhase) + 0.45 * Math.sin(shakePhase * 2.3 + 0.7)) *
      (9.2 + lowBassPower * 3.1) *
      SHAKE_INTENSITY_MULT *
      shakeAmplitudeTighten
    const shakeForceY =
      (Math.cos(shakePhase * 1.8 + 1.1) + 0.35 * Math.sin(shakePhase * 3.2)) *
      (5.4 + lowBassPower * 2.35) *
      SHAKE_INTENSITY_MULT *
      shakeAmplitudeTighten
    const upwardBassForce = Math.min(40.0, lowBassPower * 10.2)
    const playbarY = Y_MIN + 0.85
    const blowStrength = lowBassImpact * (8.5 + bassTransient * 8.8)

    const positions = posAttr.array as Float32Array
    const colors = colorAttr.array as Float32Array
    const sizes = sizeAttr.array as Float32Array
    const opacities = opacityAttr.array as Float32Array
    const density = densityField
    const gradX = densityGradX
    const gradY = densityGradY

    if (pendingSoundstageResetRef.current) {
      soundstageSeedMask.fill(0)
      soundstageSeededCountRef.current = 0
      pendingSoundstageResetRef.current = false
    }
    if (!isPlaying) {
      const targetSeededCount = Math.floor(TOTAL_PARTICLES * soundstageDeploy)
      let seededCount = soundstageSeededCountRef.current
      while (seededCount < targetSeededCount) {
        const i = soundstageSeedOrder[seededCount]
        const dotIdx = homeAssignment[i]
        const centerI3 = dotIdx * 3
        if (dotIdx >= 0 && centerI3 + 2 < dotCenters.length) {
          const i3 = i * 3
          const cx = dotCenters[centerI3]
          const cy = dotCenters[centerI3 + 1]
          const cz = dotCenters[centerI3 + 2]
          const jitterX = (Math.random() - 0.5) * SOUNDSTAGE_COLLAPSE_JITTER
          const jitterY = (Math.random() - 0.5) * SOUNDSTAGE_COLLAPSE_JITTER
          const jitterZ = (Math.random() - 0.5) * SOUNDSTAGE_COLLAPSE_JITTER
          positions[i3] = cx + jitterX
          positions[i3 + 1] = cy + jitterY
          positions[i3 + 2] = cz + jitterZ

          const outward = SOUNDSTAGE_COLLAPSE_OUTWARD_SPEED * (0.65 + Math.random() * 0.35)
          const tangentJitter = (Math.random() - 0.5) * 0.08
          velX[i] = homeNormalX[i] * outward + homeTangentAX[i] * tangentJitter
          velY[i] = homeNormalY[i] * outward + homeTangentAY[i] * tangentJitter
          velZ[i] = homeNormalZ[i] * outward + homeTangentAZ[i] * tangentJitter
        }
        soundstageSeedMask[i] = 1
        seededCount++
      }
      soundstageSeededCountRef.current = seededCount
    }

    // Perimeter emitter — disabled in soundstage so particles can settle quickly.
    const emitterScale = isPlaying
      ? clamp01((tr - SOUNDSTAGE_VIZ_FIELD_TR_CUTOFF) / (1 - SOUNDSTAGE_VIZ_FIELD_TR_CUTOFF))
      : 0
    const ambientRate = (PERIM_EMIT_RATE_BASE + (ambientEnergy + globalTransient * 0.65) * 1400) * emitterScale
    ambientEmitterCarry.current += ambientRate * dt
    const ambientCount = Math.min(280, Math.floor(ambientEmitterCarry.current))
    ambientEmitterCarry.current -= ambientCount
    for (let n = 0; n < ambientCount; n++) {
      const idx = respawnCursor.current
      respawnCursor.current = (respawnCursor.current + 1) % TOTAL_PARTICLES
      respawnParticleMixed(
        idx,
        positions,
        velX,
        velY,
        velZ,
        originDirX,
        originDirY,
        ages,
        lifespans,
        0.9 + ambientEnergy * 0.55,
        AMBIENT_CENTER_SPAWN_CHANCE,
        AMBIENT_EVERYWHERE_SPAWN_CHANCE,
      )
    }

    // Low-bass jets — gated by transition
    const emitStrength = clamp01(lowBassPower * 0.2 + bassTransient * 0.95) * emitterScale
    if (emitStrength > PERIM_EMIT_MIN_TRIGGER) {
      const rate = PERIM_EMIT_RATE_MAX * Math.pow(emitStrength, 1.5)
      bassEmitterCarry.current += rate * dt
      const emitCount = Math.min(440, Math.floor(bassEmitterCarry.current))
      bassEmitterCarry.current -= emitCount

      for (let n = 0; n < emitCount; n++) {
        const idx = respawnCursor.current
        respawnCursor.current = (respawnCursor.current + 1) % TOTAL_PARTICLES
        respawnParticleFromBottomBand(
          idx,
          positions,
          velX,
          velY,
          velZ,
          originDirX,
          originDirY,
          ages,
          lifespans,
          1.35 + emitStrength * 4.5,
        )
      }
    } else {
      bassEmitterCarry.current *= 0.52
    }

    // Density field computation (visualizer-only to avoid box artifacts in soundstage)
    if (vizFieldWeight > 0.5) {
      density.fill(0)
      for (let i = 0; i < TOTAL_PARTICLES; i++) {
        const i3 = i * 3
        const x = positions[i3]
        const y = positions[i3 + 1]
        const nx = clamp01((x - X_WRAP_MIN) / WRAP_W)
        const ny = clamp01((y - Y_WRAP_MIN) / WRAP_H)
        const cellX = Math.min(DENSITY_COLS - 1, Math.floor(nx * DENSITY_COLS))
        const cellY = Math.min(DENSITY_ROWS - 1, Math.floor(ny * DENSITY_ROWS))
        density[cellY * DENSITY_COLS + cellX] += 1
      }

      for (let y = 0; y < DENSITY_ROWS; y++) {
        const yUp = y > 0 ? y - 1 : y
        const yDown = y < DENSITY_ROWS - 1 ? y + 1 : y
        for (let x = 0; x < DENSITY_COLS; x++) {
          const xLeft = x > 0 ? x - 1 : x
          const xRight = x < DENSITY_COLS - 1 ? x + 1 : x
          const idx = y * DENSITY_COLS + x
          const left = density[y * DENSITY_COLS + xLeft]
          const right = density[y * DENSITY_COLS + xRight]
          const up = density[yUp * DENSITY_COLS + x]
          const down = density[yDown * DENSITY_COLS + x]
          gradX[idx] = (right - left) * 0.5 * INV_EXPECTED_DENSITY
          gradY[idx] = (down - up) * 0.5 * INV_EXPECTED_DENSITY
        }
      }
    } else {
      density.fill(0)
      gradX.fill(0)
      gradY.fill(0)
    }

    // ---------------------------------------------------------------------------
    // Cursor dot → world position conversion
    // ---------------------------------------------------------------------------
    const cursorPos = cursorDotPosition
    if (cursorPos) {
      // Camera: fov=50, z=20 → halfH = tan(25°) * 20
      const halfH = Math.tan(25 * Math.PI / 180) * 20 // ≈ 9.326
      const aspect = size.width / size.height
      cursorWorldRef.current.x = (cursorPos.normalizedX * 2 - 1) * halfH * aspect
      cursorWorldRef.current.y = (cursorPos.normalizedY * 2 - 1) * halfH
      cursorWorldRef.current.active = true
    } else {
      cursorWorldRef.current.active = false
    }

    // Smooth cursor activation
    const cursorTarget = cursorWorldRef.current.active ? 1 : 0
    const cursorRate = cursorTarget > cursorActivationRef.current
      ? CURSOR_ACTIVATION_RATE
      : CURSOR_DEACTIVATION_RATE
    cursorActivationRef.current += (cursorTarget - cursorActivationRef.current) * (1 - Math.exp(-cursorRate * dt))
    if (Math.abs(cursorActivationRef.current - cursorTarget) < 0.001) {
      cursorActivationRef.current = cursorTarget
    }
    const cursorActivation = cursorActivationRef.current
    const cursorWX = cursorWorldRef.current.x
    const cursorWY = cursorWorldRef.current.y

    // ---------------------------------------------------------------------------
    // Per-particle update
    // ---------------------------------------------------------------------------

    let cursorSphereSlot = 0
    cursorSphereFlags.fill(0)

    for (let i = 0; i < TOTAL_PARTICLES; i++) {
      const i3 = i * 3
      let x = positions[i3]
      let y = positions[i3 + 1]
      let z = positions[i3 + 2]
      let vx = velX[i]
      let vy = velY[i]
      let vz = velZ[i]
      const ph = phases[i]
      let age = ages[i] + dt
      let gridCoalesceBoost = 0
      const soundstageSeeded = isPlaying || soundstageSeedMask[i] === 1
      const stageParticipation = isPlaying || soundstageSeeded ? 1 : 0

      // Lifespan respawn — only during playing (t>0.3), else skip
      if (forceTr > 0.3 && age >= lifespans[i]) {
        respawnParticleMixed(
          i,
          positions,
          velX,
          velY,
          velZ,
          originDirX,
          originDirY,
          ages,
          lifespans,
          0.8 + ambientEnergy * 0.6,
          LIFE_CENTER_SPAWN_CHANCE,
          LIFE_EVERYWHERE_SPAWN_CHANCE,
        )
        x = positions[i3]
        y = positions[i3 + 1]
        z = positions[i3 + 2]
        vx = velX[i]
        vy = velY[i]
        vz = velZ[i]
        age = ages[i]
      }
      const ox = originDirX[i]
      const oy = originDirY[i]

      // -----------------------------------------------------------------------
      // GRID SPRING FORCE — pulls toward home position, weighted by (1-t)
      // -----------------------------------------------------------------------
      const gridWeight = (1 - forceTr) * stageParticipation
      if (gridWeight > 0.001) {
        let hx = homePositions[i3]
        let hy = homePositions[i3 + 1]
        let hz = homePositions[i3 + 2]
        const dotIdx = homeAssignment[i]
        if (dotIdx >= 0 && dotIdx * 3 + 2 < dotCenters.length) {
          const dc3 = dotIdx * 3
          const cx = dotCenters[dc3]
          const cy = dotCenters[dc3 + 1]
          const cz = dotCenters[dc3 + 2]

          // Dot state for hover + envelope-driven noise
          const dotKey = dotIdx < dotIdxToKey.length ? dotIdxToKey[dotIdx] : null
          const isDotHovered = dotKey !== null && hoveredDot === dotKey
          const isDotActive = dotKey !== null && selectedDots.has(dotKey)
          const envelope = dotKey !== null ? getEnvelope(dotKey) : 0

          // Hover amplifies breathing/orbit for both selected and unselected dots
          const hoverMult = isDotHovered ? 1.6 : 1

          let radius = homeRadius[i] * (isPlaying ? 1 : soundstageDeploy)

          // Grid highlight: oscillate sphere radius with 1.2s ease-in-out cycle
          // matching the low-graphics-mode dot-highlight-breathe animation
          if (highlightTarget === "grid" && !isPlaying) {
            const breathe = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 1.2 - Math.PI / 2)
            radius *= 1.0 + 2.5 * breathe
          }
          const radialPulse = 1 + GRID_HOVER_RADIAL_BREATH * hoverMult * Math.sin(t * GRID_HOVER_BREATH_FREQ * hoverMult + ph * 1.37)
          const orbitPhase = t * GRID_HOVER_ORBIT_SPEED * hoverMult + ph
          const tangentSway = radius * GRID_HOVER_TANGENT_SWAY * hoverMult * (isPlaying ? 1 : soundstageDeploy)
          const orbitS = Math.sin(orbitPhase)
          const orbitC = Math.cos(orbitPhase * 1.13)

          // Envelope-driven noisy displacement for sound-producing dots
          let envNoiseX = 0, envNoiseY = 0, envNoiseZ = 0
          if (envelope > 0.01 && isDotActive) {
            const n1 = Math.sin(t * 11.3 + ph * 17.1) * 0.6 + Math.sin(t * 23.7 + ph * 7.3) * 0.4
            const n2 = Math.cos(t * 13.9 + ph * 11.9) * 0.6 + Math.cos(t * 19.1 + ph * 5.7) * 0.4
            const n3 = Math.sin(t * 9.7 + ph * 23.3) * 0.5 + Math.cos(t * 17.3 + ph * 13.1) * 0.5
            const envStrength = envelope * 1.2
            envNoiseX = n1 * envStrength
            envNoiseY = n2 * envStrength
            envNoiseZ = n3 * envStrength * 0.6
          }

          hx =
            cx +
            homeNormalX[i] * radius * radialPulse +
            homeTangentAX[i] * tangentSway * orbitS +
            homeTangentBX[i] * tangentSway * orbitC +
            envNoiseX
          hy =
            cy +
            homeNormalY[i] * radius * radialPulse +
            homeTangentAY[i] * tangentSway * orbitS +
            homeTangentBY[i] * tangentSway * orbitC +
            envNoiseY
          hz =
            cz +
            homeNormalZ[i] * radius * radialPulse +
            homeTangentAZ[i] * tangentSway * orbitS +
            homeTangentBZ[i] * tangentSway * orbitC +
            envNoiseZ
        }
        const dx = hx - x
        const dy = hy - y
        const dz = hz - z
        const homeDist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        gridCoalesceBoost = clamp01((homeDist - GRID_COALESCE_DEADZONE) / GRID_COALESCE_BOOST_DISTANCE)
        const springK = (GRID_SPRING_K + GRID_COALESCE_SPRING_BOOST * gridCoalesceBoost) * soundstageSettleMult
        // Weaken grid spring for particles claimed by cursor sphere (previous frame flag)
        const cursorGridScale = cursorSphereFlags[i] === 1 ? (1 - cursorActivation) : 1
        vx += dx * springK * gridWeight * cursorGridScale * dt
        vy += dy * springK * gridWeight * cursorGridScale * dt
        vz += dz * springK * gridWeight * cursorGridScale * dt
      }

      // -----------------------------------------------------------------------
      // CURSOR SPHERE FORMATION — particles form 3D Fibonacci sphere at cursor
      // -----------------------------------------------------------------------
      if (cursorActivation > 0.001 && !isPlaying) {
        const cdx = x - cursorWX
        const cdy = y - cursorWY
        const cdistSq = cdx * cdx + cdy * cdy

        if (cdistSq < CURSOR_ATTRACT_RADIUS_SQ) {
          if (cursorSphereSlot < CURSOR_SPHERE_PARTICLE_COUNT) {
            // Assign this particle a slot on the Fibonacci sphere
            const slot = cursorSphereSlot++
            cursorSphereFlags[i] = 1

            const tmpl = cursorSphereTemplate
            const breathScale = 1 + CURSOR_RADIAL_OSCILLATION * Math.sin(t * CURSOR_BREATH_FREQ + ph * 3.7)
            const r = CURSOR_SPHERE_RADIUS * breathScale

            // Target position on sphere centered at cursor
            const tx = cursorWX + tmpl.normalX[slot] * r
            const ty = cursorWY + tmpl.normalY[slot] * r
            const tz = tmpl.normalZ[slot] * r

            // Spring force toward sphere slot
            const sdx = tx - x
            const sdy = ty - y
            const sdz = tz - z
            const springF = CURSOR_ATTRACT_FORCE * cursorActivation * dt
            vx += sdx * springF
            vy += sdy * springF
            vz += sdz * springF

            // Orbital sway — tangential motion for living feel
            const orbitPhase = t * GRID_HOVER_ORBIT_SPEED * 1.3 + ph
            const swayS = Math.sin(orbitPhase)
            const swayC = Math.cos(orbitPhase * 1.13)
            const swayStrength = CURSOR_ORBIT_FORCE * cursorActivation * dt
            vx += (tmpl.tangentAX[slot] * swayS + tmpl.tangentBX[slot] * swayC) * swayStrength
            vy += (tmpl.tangentAY[slot] * swayS + tmpl.tangentBY[slot] * swayC) * swayStrength
            vz += (tmpl.tangentAZ[slot] * swayS + tmpl.tangentBZ[slot] * swayC) * swayStrength
          } else {
            // Beyond sphere capacity: gentle fallback attraction
            const cdist = Math.sqrt(cdistSq)
            const invDist = cdist > 0.001 ? 1 / cdist : 0
            const falloffT = cdist / CURSOR_ATTRACT_RADIUS
            const influence = (1 - falloffT * falloffT) * cursorActivation
            const pullF = CURSOR_FALLBACK_FORCE * influence * dt
            vx += -cdx * invDist * pullF
            vy += -cdy * invDist * pullF
            vz += -z * 4.0 * influence * dt
          }
        }
      }

      // -----------------------------------------------------------------------
      // AMBIENT FLOW — always on, stronger during playback
      // -----------------------------------------------------------------------
      const soundstageDrift = isPlaying
        ? 1
        : soundstageSeeded
          ? 0.02 + soundstageDeploy * 0.16
          : 0.05
      const flowWeight = (0.15 + 0.85 * forceTr) * soundstageDrift
      const flowX = Math.sin(y * 0.82 + t * 0.63 + ph * 0.9) + 0.45 * Math.cos(z * 1.5 - t * 0.34 + ph * 0.7)
      const flowY = Math.cos(x * 0.72 - t * 0.49 + ph * 0.6) + 0.45 * Math.sin(z * 1.18 + t * 0.4 + ph * 1.1)
      const flowZ = Math.sin((x + y) * 0.42 + t * 0.56 + ph * 1.3) + 0.35 * Math.cos(x * 0.67 - y * 0.44 - t * 0.3 + ph * 0.8)

      let forceX = flowX * BASE_FLOW_FORCE * flowWeight
      let forceY = flowY * BASE_FLOW_FORCE * flowWeight
      let forceZ = flowZ * BASE_FLOW_FORCE * 0.75 * flowWeight

      // Thermal agitation — always on, scaled
      const thermalWeight = (0.2 + 0.8 * forceTr) * soundstageDrift
      forceX += (Math.sin(t * 2.1 + ph * 7.3) + Math.cos(t * 1.4 + ph * 3.7)) * THERMAL_FORCE * ambientEnergy * thermalWeight
      forceY += (Math.cos(t * 1.9 + ph * 6.1) + Math.sin(t * 1.2 + ph * 5.2)) * THERMAL_FORCE * ambientEnergy * thermalWeight
      forceZ += Math.sin(t * 1.6 + ph * 4.6) * THERMAL_FORCE * ambientEnergy * 0.5 * thermalWeight

      // -----------------------------------------------------------------------
      // AUDIO FORCES — weighted by transition t
      // -----------------------------------------------------------------------
      const yNorm = clamp01((y - Y_MIN) / WORLD_H)
      const centerBin = Math.floor(yNorm * (DISPLAY_BINS - 1))
      let localEnergy = 0
      let localTransient = 0
      let panDirectionalDrive = 0
      let originDirectionalDrive = 0

      if (forceTr > 0.01) {
        const startBin = Math.max(0, centerBin - AUDIO_BIN_INFLUENCE)
        const endBin = Math.min(DISPLAY_BINS - 1, centerBin + AUDIO_BIN_INFLUENCE)
        for (let b = startBin; b <= endBin; b++) {
          const mag = sm[b]
          const transient = st[b]
          const drive = mag * MAG_FORCE_WEIGHT + transient * TRANSIENT_FORCE_WEIGHT
          if (drive < 0.0008) continue

          const adx = x - bx[b]
          const ady = y - binY[b]
          const r2 = adx * adx + ady * ady + 1e-6
          const invR = 1 / Math.sqrt(r2)
          const anx = adx * invR
          const any = ady * invR
          const pullFalloff = 1 / (1 + adx * adx * 0.95 + ady * ady * 26.0)
          const pushFalloff = 1 / (1 + adx * adx * 0.2 + ady * ady * 6.4)
          const hitStrength = clamp01(transient * 1.9 + drive * 0.55)
          const pan = sp[b]
          const panAbs = Math.abs(pan)
          const directionalWeight = drive * (0.35 + hitStrength * 0.65)
          panDirectionalDrive += pan * directionalWeight
          originDirectionalDrive += (1 - panAbs) * directionalWeight

          const pullInfluence = drive * pullFalloff
          const pushInfluence = drive * pushFalloff * (AUDIO_PUSH_FORCE + AUDIO_PUSH_HIT_GAIN * hitStrength * hitStrength)

          forceX += (-adx * AUDIO_PULL_FORCE * pullInfluence + adx * pushInfluence) * forceTr
          forceY += (-ady * AUDIO_PULL_FORCE * pullInfluence + ady * pushInfluence) * forceTr

          const swirlDrive = drive * (0.45 * pullFalloff + 0.9 * pushFalloff) * (0.6 + hitStrength * 0.9)
          forceX += -ady * AUDIO_SWIRL * swirlDrive * forceTr
          forceY += adx * AUDIO_SWIRL * swirlDrive * forceTr

          const captureGate = clamp01((CORE_CAPTURE_RADIUS_SQ - r2) / CORE_CAPTURE_RADIUS_SQ)
          const captureStrength = drive * (0.3 + hitStrength) * captureGate
          forceX += -anx * CORE_CAPTURE_FORCE * captureStrength * forceTr
          forceY += -any * CORE_CAPTURE_FORCE * captureStrength * forceTr

          const vortexSpin = drive * (0.25 + hitStrength * 1.25) / (1 + r2 * 11)
          forceX += -any * AUDIO_VORTEX_FORCE * vortexSpin * forceTr
          forceY += anx * AUDIO_VORTEX_FORCE * vortexSpin * forceTr

          const burstGate = clamp01((CORE_BURST_RADIUS_SQ - r2) / CORE_BURST_RADIUS_SQ)
          if (burstGate > 0) {
            const burstStrength = (0.35 + hitStrength * 1.8) * burstGate * burstGate * (0.55 + transient * 2.1)
            forceX += anx * CORE_BURST_FORCE * burstStrength * forceTr
            forceY += any * CORE_BURST_FORCE * burstStrength * forceTr
            forceZ += CORE_BURST_FORCE * 0.22 * burstStrength * forceTr
            localTransient += burstStrength * 0.28
          }

          forceZ += (pullInfluence + pushInfluence * 0.6) * AUDIO_Z_PUSH * forceTr
          localEnergy += pullInfluence + pushInfluence * 0.55
          localTransient += transient * (0.35 * pullFalloff + 0.9 * pushFalloff)
        }
      }

      localEnergy = clamp01(localEnergy * 1.9 + ambientEnergy * 0.22)
      localTransient = clamp01(localTransient * 2.4 + globalTransient * 0.2)

      // Directional steering — gated by transition
      if (forceTr > 0.01) {
        const panDriveMag = clamp01(Math.abs(panDirectionalDrive) * 1.55)
        const panSign = panDirectionalDrive < -1e-5 ? -1 : panDirectionalDrive > 1e-5 ? 1 : 0
        if (panSign !== 0) {
          const originPanAlign = clamp01(0.5 + 0.5 * ox * panSign)
          forceX += panSign * PAN_STEER_FORCE * panDriveMag * (0.35 + originPanAlign * 0.95) * forceTr
          forceY += oy * PAN_STEER_FORCE * panDriveMag * 0.22 * forceTr
        }
        const originDrive = clamp01(originDirectionalDrive * 1.35)
        forceX += ox * ORIGIN_STEER_FORCE * originDrive * forceTr
        forceY += oy * ORIGIN_STEER_FORCE * originDrive * 0.92 * forceTr
        forceX += -oy * PAN_ORIGIN_SWIRL_FORCE * panDriveMag * forceTr
        forceY += ox * PAN_ORIGIN_SWIRL_FORCE * panDriveMag * forceTr
      }

      // Bass shake — gated by transition
      forceX += shakeForceX * forceTr
      forceY += shakeForceY * forceTr

      // Low bass push up — gated by transition
      if (forceTr > 0.01) {
        const bottomProximity = clamp01((Y_MAX - y) / (Y_MAX - Y_MIN))
        forceY += (upwardBassForce + bassBandPushUp) * (0.12 + bottomProximity * 1.45) * forceTr

        const sideNorm = clamp01(Math.abs(x) / X_HALF)
        const sideInwardSign = x >= 0 ? -1 : 1
        const sideOutwardSign = -sideInwardSign
        const midSideProfile = 0.22 + sideNorm * sideNorm * 1.95
        const superMidProfile = 0.2 + (1 - sideNorm) * (1 - sideNorm) * 1.35
        forceX += sideInwardSign * midBandInwardPush * midSideProfile * forceTr
        forceX += sideOutwardSign * superMidOutwardPush * superMidProfile * forceTr
        forceY += Math.sin(t * 6.6 + ph * 3.4 + x * 0.32) * midBandSwirlPush * (0.25 + sideNorm * 0.75) * forceTr

        const topProfile = clamp01((y - Y_MIN) / WORLD_H)
        forceY -= highBandPushDown * (0.12 + topProfile * topProfile * 1.18) * forceTr
        forceY -= highBandPunchDown * (0.2 + topProfile * topProfile * 1.55) * forceTr

        // Playbar blow-away
        const pbDx = x
        const pbDy = y - playbarY
        const pbFalloff = Math.exp(-(pbDx * pbDx * 0.22 + pbDy * pbDy * 1.9))
        if (pbFalloff > 0.0006 && blowStrength > 0.0006) {
          const invLen = 1 / Math.sqrt(pbDx * pbDx + pbDy * pbDy + 0.06)
          forceX += pbDx * invLen * blowStrength * pbFalloff * 14 * forceTr
          forceY += (pbDy * invLen * 0.9 + 0.6) * blowStrength * pbFalloff * 12 * forceTr
          forceZ += blowStrength * pbFalloff * 3.2 * forceTr
          localTransient = clamp01(localTransient + pbFalloff * blowStrength * 0.08)
        }
      }

      // Visualizer boundary + density shaping. Disabled in soundstage to remove box artifacts.
      if (vizFieldWeight > 0.5) {
        const edgeDist = Math.abs(x) - (X_HALF - SIDE_MIX_ZONE)
        if (edgeDist > 0) {
          const edgeT = clamp01(edgeDist / SIDE_MIX_ZONE)
          const sideSign = x >= 0 ? 1 : -1
          const mixPhase = t * 7.5 + ph * 2.7 + y * 1.3
          const topProximity = clamp01((y - (Y_MAX - SIDE_MIX_ZONE * 1.1)) / (SIDE_MIX_ZONE * 1.1))
          const bottomProximity2 = clamp01(((Y_MIN + SIDE_MIX_ZONE * 1.1) - y) / (SIDE_MIX_ZONE * 1.1))
          const cornerProximity = Math.max(topProximity, bottomProximity2)
          const centerReturn = (Y_MID - y) / (Y_MAX - Y_MIN)
          forceX += -sideSign * SIDE_MIX_FORCE * edgeT * edgeT
          forceY += Math.sin(mixPhase) * SIDE_MIX_SWIRL * edgeT
          forceZ += Math.cos(mixPhase * 0.9) * SIDE_MIX_SWIRL * 0.55 * edgeT
          forceY += centerReturn * SIDE_CORNER_ESCAPE_FORCE * edgeT * (0.35 + cornerProximity * 1.6)

          if ((sideSign > 0 && vx > 0) || (sideSign < 0 && vx < 0)) {
            vx = -vx * (SIDE_BOUNCE_RESTITUTION + edgeT * 0.28 + cornerProximity * 0.2)
            vy += Math.sin(mixPhase * 1.7) * edgeT * 3.6
            vy += Math.sign(centerReturn || 1) * edgeT * (2.8 + cornerProximity * 5.5)
            vz += Math.cos(mixPhase * 1.4) * edgeT * 2.4
            localTransient = clamp01(localTransient + edgeT * 0.1)
          }
        }

        const topEdgeDist = y - (Y_MAX - TOP_MIX_ZONE)
        if (topEdgeDist > 0) {
          const edgeT = clamp01(topEdgeDist / TOP_MIX_ZONE)
          const mixPhase = t * 8.2 + ph * 3.1 + x * 1.45
          forceY += -TOP_MIX_FORCE * edgeT * edgeT
          forceX += Math.sin(mixPhase) * TOP_MIX_SWIRL * edgeT
          forceZ += Math.cos(mixPhase * 0.85) * TOP_MIX_SWIRL * 0.7 * edgeT

          if (vy > 0) {
            vy = -vy * (TOP_BOUNCE_RESTITUTION + edgeT * 0.14)
            vx += Math.sin(mixPhase * 1.6) * edgeT * 2.4
            vz += Math.cos(mixPhase * 1.3) * edgeT * 1.8
            localTransient = clamp01(localTransient + edgeT * 0.08)
          }
        }

        const bottomEdgeDist = (Y_MIN + BOTTOM_MIX_ZONE) - y
        if (bottomEdgeDist > 0) {
          const edgeT = clamp01(bottomEdgeDist / BOTTOM_MIX_ZONE)
          const mixPhase = t * 8.6 + ph * 2.4 + x * 1.3
          forceY += BOTTOM_MIX_FORCE * edgeT * edgeT
          forceX += Math.sin(mixPhase) * BOTTOM_MIX_SWIRL * edgeT
          forceZ += Math.cos(mixPhase * 0.9) * BOTTOM_MIX_SWIRL * 0.75 * edgeT

          if (vy < 0) {
            vy = -vy * (BOTTOM_BOUNCE_RESTITUTION + edgeT * 0.16)
            vx += Math.sin(mixPhase * 1.45) * edgeT * 2.8
            vz += Math.cos(mixPhase * 1.35) * edgeT * 2.1
            localTransient = clamp01(localTransient + edgeT * 0.1)
          }
        }

        // Edge escape pressure
        const leftNear = 1 - clamp01((x + X_HALF) / 1.6)
        const rightNear = 1 - clamp01((X_HALF - x) / 1.6)
        const topNear = 1 - clamp01((Y_MAX - y) / 1.6)
        const bottomNear = 1 - clamp01((y - Y_MIN) / 1.6)
        forceX += (leftNear * leftNear - rightNear * rightNear) * EDGE_ESCAPE_FORCE
        forceY += (bottomNear * bottomNear - topNear * topNear) * EDGE_ESCAPE_FORCE * 0.7

        // Density repulsion
        const dnx = clamp01((x - X_WRAP_MIN) / WRAP_W)
        const dny = clamp01((y - Y_WRAP_MIN) / WRAP_H)
        const cellX = Math.min(DENSITY_COLS - 1, Math.floor(dnx * DENSITY_COLS))
        const cellY = Math.min(DENSITY_ROWS - 1, Math.floor(dny * DENSITY_ROWS))
        const cellIndex = cellY * DENSITY_COLS + cellX
        const localDensity = density[cellIndex] * INV_EXPECTED_DENSITY
        forceX += -gradX[cellIndex] * DENSITY_REPULSION
        forceY += -gradY[cellIndex] * DENSITY_REPULSION
        forceZ += -Math.max(0, localDensity - 1.35) * 0.45
      }

      // Calm recenter — always on, helps idle state too
      const forceActivity = clamp01(localEnergy * 0.9 + localTransient * 1.1 + globalEnergy * 0.45)
      const calm = 1 - forceActivity
      forceX += -x * CALM_RECENTER_FORCE * calm * forceTr
      forceY += -(y - Y_MID) * CALM_RECENTER_FORCE * calm * 0.88 * forceTr
      forceZ += -z * CALM_RECENTER_FORCE * calm * 0.3 * forceTr

      // Confinement
      const confinementWeight = isPlaying ? (0.3 + 0.7 * forceTr) : (0.03 + 0.27 * stageParticipation)
      forceX += -x * CONFINEMENT_FORCE * confinementWeight
      forceY += -(y - Y_MID) * CONFINEMENT_FORCE * 0.82 * confinementWeight
      forceZ += -(z - 0.1) * CONFINEMENT_FORCE * 0.58

      // Spectral centroid
      forceY += (centroidY - y) * globalEnergy * 0.24 * forceTr

      forceX *= GLOBAL_FORCE_GAIN
      forceY *= GLOBAL_FORCE_GAIN
      forceZ *= GLOBAL_FORCE_GAIN

      vx = (vx + forceX * dt) * damping
      vy = (vy + forceY * dt) * damping
      vz = (vz + forceZ * dt) * damping

      const speedSq = vx * vx + vy * vy + vz * vz
      // Limit speed — tighter during idle
      const maxSpeedNow =
        MAX_SPEED * (0.32 + 0.68 * forceTr) +
        GRID_COALESCE_SPEED_BOOST * soundstageSettleMult * gridWeight * gridCoalesceBoost
      const maxSpeedSqNow = maxSpeedNow * maxSpeedNow
      if (speedSq > maxSpeedSqNow) {
        const scale = maxSpeedNow / Math.sqrt(speedSq)
        vx *= scale
        vy *= scale
        vz *= scale
      }

      x += vx * dt
      y += vy * dt
      z += vz * dt

      // Wrapping — only during playing; during idle, let spring handle containment
      if (forceTr > 0.3) {
        x = wrap(x, X_WRAP_MIN, X_WRAP_MAX)
        y = wrap(y, Y_WRAP_MIN, Y_WRAP_MAX)
      }

      if (z < Z_MIN) {
        z = Z_MIN
        vz *= -0.45
      } else if (z > Z_MAX) {
        z = Z_MAX
        vz *= -0.45
      }

      positions[i3] = x
      positions[i3 + 1] = y
      positions[i3 + 2] = z

      velX[i] = vx
      velY[i] = vy
      velZ[i] = vz
      ages[i] = age

      // -----------------------------------------------------------------------
      // COLOR: lerp between soundstage color and visualizer color
      // -----------------------------------------------------------------------

      // Visualizer color (frequency-based)
      const ft = clamp01((y - Y_MIN) / WORLD_H)
      let brightR: number, brightG: number, brightB: number
      if (ft < 0.5) {
        const u = ft * 2
        brightR = bass.r + (mid.r - bass.r) * u
        brightG = bass.g + (mid.g - bass.g) * u
        brightB = bass.b + (mid.b - bass.b) * u
      } else {
        const u = (ft - 0.5) * 2
        brightR = mid.r + (treble.r - mid.r) * u
        brightG = mid.g + (treble.g - mid.g) * u
        brightB = mid.b + (treble.b - mid.b) * u
      }

      const kinetic = clamp01(Math.sqrt(vx * vx + vy * vy + vz * vz) / MAX_SPEED)
      const lifeT = clamp01(age / lifespans[i])
      const lifeFade = tr > 0.3
        ? Math.min(clamp01(lifeT / LIFE_FADE_IN), clamp01((1 - lifeT) / LIFE_FADE_OUT))
        : 1.0 // No life fading in idle mode
      const vizBrightness = clamp01(localEnergy * 0.64 + localTransient * 0.9 + kinetic * 0.45 + ambientEnergy * 0.12 + globalGlowBoost * 0.55)

      // Visualizer final color
      const vizR = dimR + (brightR - dimR) * vizBrightness
      const vizG = dimG + (brightG - dimG) * vizBrightness
      const vizB = dimB + (brightB - dimB) * vizBrightness
      const vizSize = (0.075 + vizBrightness * 0.14 + kinetic * 0.05 + globalGlowBoost * 0.05) * (0.7 + lifeFade * 0.3)
      const vizOpacity = Math.min(0.92, 0.04 + vizBrightness * 0.28 + globalGlowBoost * 0.22) * lifeFade

      // Keep existing visualizer particles around briefly and fade them out as
      // new soundstage particles are seeded in from the centers.
      if (!isPlaying && !soundstageSeeded) {
        const legacyFade = clamp01(1 - soundstageDeploy)
        colors[i3] = vizR
        colors[i3 + 1] = vizG
        colors[i3 + 2] = vizB
        sizes[i] = vizSize
        opacities[i] = vizOpacity * legacyFade
        continue
      }

      // Soundstage color: frequency-based gradient like visualizer, dimmed
      // Use the particle's home Y position to determine its hue band
      let ssR: number, ssG: number, ssB: number
      let ssSize: number
      let ssOpacity: number
      const soundstageReveal = isPlaying ? 1 : clamp01((soundstageDeploy - 0.08) / 0.92)
      const dotIdx = homeAssignment[i]
      if (dotIdx >= 0 && dotIdx < dotIdxToKey.length) {
        const dotKey = dotIdxToKey[dotIdx]
        const isActive = selectedDots.has(dotKey)
        const isHovered = hoveredDot === dotKey

        // Base color: frequency gradient based on home Y position
        const homeY = homePositions[i * 3 + 1]
        // Map home Y from grid range to 0-1 (bottom=bass, top=treble)
        const totalGridH = (gridRows - 1) * gridSpacing
        const gridBottom = -(gridRows - 1) / 2 * gridSpacing
        const gridFt = totalGridH > 0 ? clamp01((homeY - gridBottom) / totalGridH) : 0.5
        let baseR: number, baseG: number, baseB: number
        if (gridFt < 0.5) {
          const u = gridFt * 2
          baseR = bass.r + (mid.r - bass.r) * u
          baseG = bass.g + (mid.g - bass.g) * u
          baseB = bass.b + (mid.b - bass.b) * u
        } else {
          const u = (gridFt - 0.5) * 2
          baseR = mid.r + (treble.r - mid.r) * u
          baseG = mid.g + (treble.g - mid.g) * u
          baseB = mid.b + (treble.b - mid.b) * u
        }

        if (isActive) {
          // Selected: full frequency color, very glowy
          const ssBrightness = isHovered ? 0.95 : 0.88
          ssR = dimR + (baseR - dimR) * ssBrightness
          ssG = dimG + (baseG - dimG) * ssBrightness
          ssB = dimB + (baseB - dimB) * ssBrightness
          const baseOpacity = isDarkMode ? 0.6 : 0.72
          ssOpacity = (baseOpacity + (isHovered ? 0.1 : 0)) * (0.2 + 0.8 * soundstageReveal)
          ssSize = (isHovered ? 0.24 : 0.22) * (0.7 + 0.3 * soundstageReveal)
        } else {
          // Unselected: pure neutral grey, no color. Brighter on hover.
          const grey = isDarkMode ? 0.35 : 0.55
          const hoverGrey = isDarkMode ? 0.6 : 0.7
          const neutralVal = isHovered ? hoverGrey : grey
          ssR = neutralVal
          ssG = neutralVal
          ssB = neutralVal
          const baseOpacity = isDarkMode
            ? (isHovered ? 0.4 : 0.2)
            : (isHovered ? 0.55 : 0.28)
          ssOpacity = baseOpacity * (0.2 + 0.8 * soundstageReveal)
          ssSize = (isHovered ? 0.16 : 0.13) * (0.7 + 0.3 * soundstageReveal)
        }
      } else {
        ssR = dimR
        ssG = dimG
        ssB = dimB
        ssOpacity = 0.12 * (0.2 + 0.8 * soundstageReveal)
        ssSize = 0.09
      }

      // Grid highlight: boost size + brightness when hovering "grid tool"
      // (position oscillation is handled in the grid spring section above)
      if (highlightTarget === "grid" && !isPlaying) {
        const sinVal = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 1.2)
        const sizeBreathe = 1.0 + 0.6 * sinVal
        ssSize *= sizeBreathe
        ssOpacity = Math.min(1, ssOpacity * 1.4)
        // Push colors toward bright frequency colors
        ssR = ssR + (brightR - ssR) * 0.35
        ssG = ssG + (brightG - ssG) * 0.35
        ssB = ssB + (brightB - ssB) * 0.35
      }

      // Cursor dot: blend color, boost size + opacity for nearby particles
      if (cursorActivation > 0.001 && !isPlaying) {
        const cdx = x - cursorWX
        const cdy = y - cursorWY
        const cdistSq = cdx * cdx + cdy * cdy

        if (cdistSq < CURSOR_ATTRACT_RADIUS_SQ) {
          const falloffT = cdistSq / CURSOR_ATTRACT_RADIUS_SQ
          const cursorInfluence = (1 - falloffT) * cursorActivation

          // Frequency-based cursor color (same palette as visualizer)
          const cursorNY = clamp01((cursorWY - Y_MIN) / WORLD_H)
          let curR: number, curG: number, curB: number
          if (cursorNY < 0.5) {
            const u = cursorNY * 2
            curR = bass.r + (mid.r - bass.r) * u
            curG = bass.g + (mid.g - bass.g) * u
            curB = bass.b + (mid.b - bass.b) * u
          } else {
            const u = (cursorNY - 0.5) * 2
            curR = mid.r + (treble.r - mid.r) * u
            curG = mid.g + (treble.g - mid.g) * u
            curB = mid.b + (treble.b - mid.b) * u
          }

          // Blend toward cursor color
          const colorBlend = cursorInfluence * 0.85
          ssR = ssR + (curR - ssR) * colorBlend
          ssG = ssG + (curG - ssG) * colorBlend
          ssB = ssB + (curB - ssB) * colorBlend

          // Boost size and opacity
          ssSize *= 1 + cursorInfluence * 1.8
          ssOpacity = Math.min(1, ssOpacity + cursorInfluence * 0.55)
        }
      }

      // Lerp between soundstage and visualizer
      colors[i3] = ssR + (vizR - ssR) * tr
      colors[i3 + 1] = ssG + (vizG - ssG) * tr
      colors[i3 + 2] = ssB + (vizB - ssB) * tr

      // Size
      sizes[i] = ssSize + (vizSize - ssSize) * tr

      // Opacity
      opacities[i] = ssOpacity + (vizOpacity - ssOpacity) * tr
    }

    posAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    opacityAttr.needsUpdate = true
  })

  return (
    <>
      <points geometry={geometry} material={material} />
      <InteractionPlane
        gridRows={gridRows}
        gridCols={gridCols}
        gridSpacing={gridSpacing}
        selectedDots={selectedDots}
        onDotSelect={onDotSelect}
        onDotDeselect={onDotDeselect}
        onHoverDot={onHoverDot}
        disabled={isPlaying}
        onDragStateChange={onDragStateChange}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cursor dot overlay — event capture only (visual handled by particle system)
// ---------------------------------------------------------------------------
function CursorDotOverlay({
  onCursorDotMove,
  onCursorDotEnd,
}: {
  onCursorDotMove?: (normalizedX: number, normalizedY: number) => void
  onCursorDotEnd?: () => void
}) {
  const [metaHeld, setMetaHeld] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") setMetaHeld(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") setMetaHeld(false)
    }
    const handleBlur = () => setMetaHeld(false)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onCursorDotMove) return
      const rect = e.currentTarget.getBoundingClientRect()
      const normalizedX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const normalizedY = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
      onCursorDotMove(normalizedX, normalizedY)
    },
    [onCursorDotMove],
  )

  const handlePointerLeave = useCallback(() => {
    onCursorDotEnd?.()
  }, [onCursorDotEnd])

  if (!metaHeld) return null

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: "auto", zIndex: 50 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  )
}

export function UnifiedParticleScene(props: UnifiedParticleSceneProps) {
  const isDarkMode = useDarkMode()
  const quality = props.quality ?? "low"
  const bg = isDarkMode ? "#0a0a0f" : "#f0f0f5"

  if (quality === "low") {
    return (
      <SimpleSoundstage
        gridRows={props.gridRows}
        gridCols={props.gridCols}
        selectedDots={props.selectedDots}
        onDotSelect={props.onDotSelect}
        onDotDeselect={props.onDotDeselect}
        playingDotKey={props.playingDotKey}
        beatIndex={props.beatIndex}
        hoveredDot={props.hoveredDot}
        onHoverDot={props.onHoverDot}
        highlightGrid={props.highlightTarget === "grid"}
        onDragStateChange={props.onDragStateChange}
        cursorDotPosition={props.cursorDotPosition}
        onCursorDotMove={props.onCursorDotMove}
        onCursorDotEnd={props.onCursorDotEnd}
      />
    )
  }

  // Set module-level particle count before render — remount via key ensures clean state
  TOTAL_PARTICLES = PARTICLE_COUNTS[quality]

  return (
    <div className="absolute inset-0">
      <Canvas
        key={quality}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{
          fov: 50,
          position: [0, 0, 20],
          near: 0.1,
          far: 100,
        }}
        style={{ background: bg }}
      >
        <UnifiedSceneContent
          gridRows={props.gridRows}
          gridCols={props.gridCols}
          selectedDots={props.selectedDots}
          onDotSelect={props.onDotSelect}
          onDotDeselect={props.onDotDeselect}
          playingDotKey={props.playingDotKey}
          beatIndex={props.beatIndex}
          hoveredDot={props.hoveredDot}
          onHoverDot={props.onHoverDot}
          isDarkMode={isDarkMode}
          highlightTarget={props.highlightTarget}
          onDragStateChange={props.onDragStateChange}
          cursorDotPosition={props.cursorDotPosition}
        />
        <EffectComposer>
          <Bloom
            intensity={isDarkMode ? BLOOM_DARK[quality] : BLOOM_LIGHT[quality]}
            luminanceThreshold={isDarkMode ? 0.2 : 0.5}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
      <CursorDotOverlay
        onCursorDotMove={props.onCursorDotMove}
        onCursorDotEnd={props.onCursorDotEnd}
      />
    </div>
  )
}
