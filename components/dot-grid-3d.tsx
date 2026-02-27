"use client"

import { useRef, useMemo, useCallback, useEffect } from "react"
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber"
import { EffectComposer, Bloom } from "@react-three/postprocessing"
import * as THREE from "three"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DotGrid3DProps {
  gridRows: number
  gridCols: number
  selectedDots: Set<string>
  onDotSelect: (x: number, y: number) => void
  onDotDeselect: (x: number, y: number) => void
  playingDotKey: string | null
  beatIndex: number
  hoveredDot: string | null
  onHoverDot: (key: string | null) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 1200
const NEON_CYAN = new THREE.Color("#00ffff")
const ACTIVE_DIM_CYAN = new THREE.Color("#3aadbe")
const DIM_GRAY = new THREE.Color("#8080a0")
const ATTACK_MS = 10
const RELEASE_TAU = 0.4

// ---------------------------------------------------------------------------
// Envelope tracker — strictly one dot glows at a time.
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
      // Move any non-idle envelopes into release, decaying from their current value
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

    // Advance all active envelopes (not just the current one)
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
// GridPointCloud — every grid point is a particle cloud.
// Inactive = gray dim. Active = vibrant cyan. Hit = burst.
// ---------------------------------------------------------------------------

function GridPointCloud({
  dotKey,
  position,
  isActive,
  isHovered,
  getEnvelope,
}: {
  dotKey: string
  position: [number, number, number]
  isActive: boolean
  isHovered: boolean
  getEnvelope: (key: string) => number
}) {
  const pointsRef = useRef<THREE.Points>(null)

  // Base positions — each particle's "home" offset from center
  const basePositions = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.random() * 0.45
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      pos[i * 3 + 2] = r * Math.cos(phi)
    }
    return pos
  }, [])

  // Per-particle random phase offsets for organic shaking
  const phaseOffsets = useMemo(() => {
    const phases = new Float32Array(PARTICLE_COUNT)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      phases[i] = Math.random() * Math.PI * 2
    }
    return phases
  }, [])

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(PARTICLE_COUNT * 3)
    // Copy base positions as initial
    pos.set(basePositions)
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    return g
  }, [basePositions])

  const mat = useMemo(() => new THREE.PointsMaterial({
    size: 1.0,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), [])

  const timeRef = useRef(0)

  useFrame((_, delta) => {
    timeRef.current += delta
    const t = timeRef.current
    const envelope = getEnvelope(dotKey)

    // Visual parameters — hovering only affects brightness/glow, not motion or color
    const baseSize = isActive ? 1.6 : (isHovered ? 1.3 : 1.0)
    const baseOpacity = isActive ? 0.6 : (isHovered ? 0.65 : 0.4)
    // Color: smooth blend from dim to bright cyan based on envelope
    if (isActive) {
      const blend = Math.min(1, envelope / 0.3)
      mat.color.copy(ACTIVE_DIM_CYAN).lerp(NEON_CYAN, blend)
    } else {
      // Off particles stay gray; hover just increases brightness/opacity
      mat.color.copy(DIM_GRAY)
    }

    // Base layer: always-on idle jitter (constant rate/amp, never changes)
    const baseAmp = isActive ? 0.035 : 0.03
    const baseRate = isActive ? 6.0 : 3.0
    // Envelope layer: added on top, scales to zero smoothly
    const envAmp = envelope * 0.08
    const envRate = 16.0

    const posAttr = geom.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    const norm = 1 / 1.75 // normalize 3-octave sum (1 + 0.5 + 0.25)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = phaseOffsets[i]

      // Base jitter — always running, constant speed
      const bx = (Math.sin(t * baseRate + p)
           + 0.5 * Math.sin(t * baseRate * 2.37 + p * 3.1)
           + 0.25 * Math.sin(t * baseRate * 5.09 + p * 7.3)) * norm * baseAmp
      const by = (Math.cos(t * baseRate * 1.13 + p * 1.7)
           + 0.5 * Math.cos(t * baseRate * 2.81 + p * 4.3)
           + 0.25 * Math.cos(t * baseRate * 5.71 + p * 9.1)) * norm * baseAmp
      const bz = (Math.sin(t * baseRate * 0.87 + p * 2.1)
           + 0.5 * Math.sin(t * baseRate * 2.13 + p * 5.7)
           + 0.25 * Math.sin(t * baseRate * 4.51 + p * 8.9)) * norm * baseAmp

      // Envelope noise — added on top, fades to zero with envelope
      const ex = (Math.sin(t * envRate + p * 1.3)
           + 0.5 * Math.sin(t * envRate * 2.71 + p * 4.7)
           + 0.25 * Math.sin(t * envRate * 5.43 + p * 8.1)) * norm * envAmp
      const ey = (Math.cos(t * envRate * 1.19 + p * 2.3)
           + 0.5 * Math.cos(t * envRate * 3.07 + p * 5.9)
           + 0.25 * Math.cos(t * envRate * 6.11 + p * 10.3)) * norm * envAmp
      const ez = (Math.sin(t * envRate * 0.93 + p * 3.7)
           + 0.5 * Math.sin(t * envRate * 2.53 + p * 6.1)
           + 0.25 * Math.sin(t * envRate * 4.87 + p * 11.7)) * norm * envAmp

      arr[i * 3]     = basePositions[i * 3]     + bx + ex
      arr[i * 3 + 1] = basePositions[i * 3 + 1] + by + ey
      arr[i * 3 + 2] = basePositions[i * 3 + 2] + bz + ez
    }
    posAttr.needsUpdate = true

    // Size + opacity: envelope makes them swell up then fade
    mat.opacity = baseOpacity + envelope * 0.4
    mat.size = baseSize + envelope * 1.8
  })

  return (
    <group position={position}>
      <points ref={pointsRef} geometry={geom} material={mat} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Click + hover plane
// ---------------------------------------------------------------------------

function InteractionPlane({
  gridRows,
  gridCols,
  selectedDots,
  onDotSelect,
  onDotDeselect,
  onHoverDot,
}: {
  gridRows: number
  gridCols: number
  selectedDots: Set<string>
  onDotSelect: (x: number, y: number) => void
  onDotDeselect: (x: number, y: number) => void
  onHoverDot: (key: string | null) => void
}) {
  const planeWidth = gridCols + 1
  const planeHeight = gridRows + 1
  // Drag state: null = not dragging, "select" or "deselect" = painting mode
  const dragMode = useRef<"select" | "deselect" | null>(null)
  const visited = useRef<Set<string>>(new Set())

  const resolveGrid = useCallback(
    (point: THREE.Vector3) => {
      const col = Math.round(point.x + (gridCols - 1) / 2)
      const row = Math.round(point.z + (gridRows - 1) / 2)
      if (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
        return { col, row }
      }
      return null
    },
    [gridRows, gridCols]
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
      e.stopPropagation()
      const hit = resolveGrid(e.point)
      if (!hit) return
      const key = `${hit.col},${hit.row}`
      // First dot determines mode: if it's selected we deselect, otherwise select
      dragMode.current = selectedDots.has(key) ? "deselect" : "select"
      visited.current = new Set()
      applyToHit(hit.col, hit.row)
    },
    [resolveGrid, selectedDots, applyToHit]
  )

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const hit = resolveGrid(e.point)
      onHoverDot(hit ? `${hit.col},${hit.row}` : null)
      if (dragMode.current && hit) {
        applyToHit(hit.col, hit.row)
      }
    },
    [resolveGrid, onHoverDot, applyToHit]
  )

  const handlePointerUp = useCallback(() => {
    dragMode.current = null
    visited.current.clear()
  }, [])

  const handlePointerLeave = useCallback(() => {
    dragMode.current = null
    visited.current.clear()
    onHoverDot(null)
  }, [onHoverDot])

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[0, -0.01, 0]}
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
// Scene content
// ---------------------------------------------------------------------------

function SceneContent({
  gridRows,
  gridCols,
  selectedDots,
  onDotSelect,
  onDotDeselect,
  playingDotKey,
  beatIndex,
  hoveredDot,
  onHoverDot,
}: DotGrid3DProps) {
  const { tick, getEnvelope } = useEnvelopeTracker(selectedDots, playingDotKey, beatIndex)
  const clockRef = useRef(0)

  const { camera, size: viewportSize } = useThree()
  useEffect(() => {
    camera.position.set(0, 20, 0)
    camera.lookAt(0, 0, 0)
    camera.up.set(0, 0, -1)
  }, [camera])

  useFrame((_, delta) => {
    // Update camera frustum every frame for smooth resize
    if (camera instanceof THREE.OrthographicCamera) {
      const aspect = viewportSize.width / viewportSize.height
      const padding = 0.8

      const gridW = (gridCols - 1) + padding * 2
      const gridH = (gridRows - 1) + padding * 2

      const gridAspect = gridW / gridH
      let halfW: number, halfH: number
      if (aspect > gridAspect) {
        halfH = gridH / 2
        halfW = halfH * aspect
      } else {
        halfW = gridW / 2
        halfH = halfW / aspect
      }

      camera.left = -halfW
      camera.right = halfW
      camera.top = halfH
      camera.bottom = -halfH
      camera.updateProjectionMatrix()
    }
    clockRef.current += delta * 1000
    tick(clockRef.current)
  })

  // Build ALL grid points
  const allDots = useMemo(() => {
    const dots: { key: string; position: [number, number, number] }[] = []
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        dots.push({
          key: `${col},${row}`,
          position: [col - (gridCols - 1) / 2, 0, row - (gridRows - 1) / 2],
        })
      }
    }
    return dots
  }, [gridRows, gridCols])

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 10, 0]} intensity={0.5} color="#4488ff" />

      {allDots.map((dot) => (
        <GridPointCloud
          key={dot.key}
          dotKey={dot.key}
          position={dot.position}
          isActive={selectedDots.has(dot.key)}
          isHovered={hoveredDot === dot.key}
          getEnvelope={getEnvelope}
        />
      ))}

      <InteractionPlane
        gridRows={gridRows}
        gridCols={gridCols}
        selectedDots={selectedDots}
        onDotSelect={onDotSelect}
        onDotDeselect={onDotDeselect}
        onHoverDot={onHoverDot}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function DotGrid3D(props: DotGrid3DProps) {
  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 2]}
        orthographic
        gl={{ antialias: true, alpha: false }}
        camera={{
          position: [0, 20, 0],
          zoom: 1,
          near: 0.1,
          far: 100,
        }}
        style={{ background: "#0a0a0f" }}
      >
        <SceneContent
          gridRows={props.gridRows}
          gridCols={props.gridCols}
          selectedDots={props.selectedDots}
          onDotSelect={props.onDotSelect}
          onDotDeselect={props.onDotDeselect}
          playingDotKey={props.playingDotKey}
          beatIndex={props.beatIndex}
          hoveredDot={props.hoveredDot}
          onHoverDot={props.onHoverDot}
        />
        <EffectComposer>
          <Bloom
            intensity={1.5}
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
