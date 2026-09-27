export type Position3D = [number, number, number]
export type UndoAmounts = [number, number, number]
export const POINT_COUNT = 24
export const STAGES = [
  { name: "Orbit", color: "#b6ebc5", description: "A tilted, closed circle" },
  { name: "Helix", color: "#eac18d", description: "Two turns through space" },
  { name: "Cube", color: "#afc6fa", description: "A walk around a wireframe" },
  { name: "Knot", color: "#d7b6eb", description: "A looping 3D knot" },
] as const

// Fixed for a trial: moving a slider never generates a new random displacement.
export function randomValue(seed: number): number {
  let value = seed | 0
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296
}

export function randomUndo(seed: number): UndoAmounts[] {
  return STAGES.map((_, stage) => [0, 1, 2].map(axis =>
    Math.round(10 + randomValue(seed + stage * 101 + axis * 31) * 70)) as UndoAmounts)
}

export function originalPoint(stage: number, index: number): Position3D {
  const t = index / POINT_COUNT * Math.PI * 2
  if (stage === 0) return [1.05 * Math.cos(t), 0.65 * Math.sin(t), 0.65 * Math.sin(t)]
  if (stage === 1) return [0.8 * Math.cos(2 * t), -1 + 2 * index / (POINT_COUNT - 1), 0.8 * Math.sin(2 * t)]
  if (stage === 2) {
    const corners: Position3D[] = [[-0.8,-0.8,-0.8], [0.8,-0.8,-0.8], [0.8,0.8,-0.8], [-0.8,0.8,-0.8],
      [-0.8,-0.8,0.8], [0.8,-0.8,0.8], [0.8,0.8,0.8], [-0.8,0.8,0.8]]
    const walk = [0, 1, 2, 3, 0, 4, 5, 1, 5, 6, 7, 4, 0]
    const edge = Math.floor(index / 2), fraction = (index % 2) / 2
    const from = corners[walk[edge]], to = corners[walk[edge + 1]]
    return from.map((value, axis) => value + (to[axis] - value) * fraction) as Position3D
  }
  const radius = 0.65 + 0.3 * Math.cos(3 * t)
  return [radius * Math.cos(2 * t), 0.65 * Math.sin(3 * t), radius * Math.sin(2 * t)]
}

/** Three coupled nonlinear distortions; 100% on all sliders is exactly identity. */
export function scrambledPoint(stage: number, index: number, seed: number, undo: UndoAmounts): Position3D {
  let [x, y, z] = originalPoint(stage, index)
  const trial = seed + stage * 1009
  const strength = (axis: number) => (1 - undo[axis] / 100) * (0.65 + randomValue(trial + axis * 43) * 0.7)
  const twist = strength(0), warp = strength(1), scatter = strength(2)
  const angle = twist * (2.2 * y + 0.8 * Math.sin(3 * z + randomValue(trial) * 6))
  const turnedX = x * Math.cos(angle) - z * Math.sin(angle)
  z = x * Math.sin(angle) + z * Math.cos(angle)
  x = turnedX
  const phase = randomValue(trial + 71) * Math.PI * 2
  // Coupled shears are evaluated in order, producing more than a rigid rotation.
  x += warp * 0.4 * Math.sin(2.7 * y + 1.9 * z + phase)
  y += warp * 0.4 * Math.sin(2.3 * z - 1.7 * x + phase)
  z += warp * 0.4 * Math.sin(2.1 * x + 1.5 * y - phase)
  return [x, y, z].map((value, axis) => value + scatter * 0.65 *
    (2 * randomValue(trial + index * 149 + axis * 307) - 1)) as Position3D
}
