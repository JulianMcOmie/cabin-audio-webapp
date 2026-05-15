import type { HrtfDataset, HrtfMeasurement, HrtfPosition, HrtfSubjectData } from "@/lib/hrtf/types"
import { normalizeStereoPair, synthesizeImpulseFromCurve } from "@/lib/hrtf/processing"

const SAMPLE_RATE = 44_100
const IMPULSE_LENGTH = 200
const DISPLAY_POINTS = 96
const FREQ_MIN = 20
const FREQ_MAX = 20_000
export const CUSTOM_VARIANT_COUNT = 16

export const CUSTOM_POSITIONS: HrtfPosition[] = [
  { key: "above", label: "Above", lateralDegrees: 0, polarDegrees: 90 },
  { key: "front", label: "Front", lateralDegrees: 0, polarDegrees: 0 },
  { key: "back", label: "Back", lateralDegrees: 0, polarDegrees: 180 },
  { key: "left", label: "Left", lateralDegrees: -90, polarDegrees: 0 },
  { key: "right", label: "Right", lateralDegrees: 90, polarDegrees: 0 },
  { key: "front_left", label: "Front Left", lateralDegrees: -45, polarDegrees: 0 },
  { key: "front_right", label: "Front Right", lateralDegrees: 45, polarDegrees: 0 },
  { key: "back_left", label: "Back Left", lateralDegrees: -45, polarDegrees: 180 },
  { key: "back_right", label: "Back Right", lateralDegrees: 45, polarDegrees: 180 },
]

export interface CustomSynthParams {
  commonShape: number
  spatialContour: number
  earContrast: number
}

interface CustomVariantSeed {
  tilt: number
  body: number
  presence: number
  contour: number
  pinna: number
  notch: number
  air: number
  shoulder: number
  earBias: number
  delayBias: number
}

function logFrequencyAxis() {
  return Array.from({ length: DISPLAY_POINTS }, (_, index) => {
    const ratio = index / (DISPLAY_POINTS - 1)
    return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, ratio)
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function fract(value: number) {
  return value - Math.floor(value)
}

function gaussianLog(frequency: number, center: number, widthOctaves: number) {
  const distance = Math.log2(frequency / center)
  return Math.exp(-0.5 * Math.pow(distance / widthOctaves, 2))
}

function normalizeRelativeResponse(values: number[]) {
  const peak = Math.max(...values)
  return values.map((value) => value - peak)
}

function buildVariantSeed(index: number): CustomVariantSeed {
  const angleA = (index / CUSTOM_VARIANT_COUNT) * Math.PI * 2
  const angleB = (((index * 5) % CUSTOM_VARIANT_COUNT) / CUSTOM_VARIANT_COUNT) * Math.PI * 2
  const noise = (salt: number) => fract(Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453123) * 2 - 1

  return {
    tilt: Math.cos(angleA),
    body: Math.sin(angleA),
    presence: Math.cos(angleB),
    contour: Math.sin(angleB),
    pinna: noise(0.31),
    notch: noise(0.73),
    air: noise(1.17),
    shoulder: noise(1.61),
    earBias: noise(2.07),
    delayBias: noise(2.53),
  }
}

function buildTargetCurve(
  frequencies: number[],
  position: HrtfPosition,
  params: CustomSynthParams,
  seed: CustomVariantSeed,
  ear: "left" | "right"
) {
  const shape = clamp((params.commonShape - 50) / 50, -1, 1)
  const contour = clamp((params.spatialContour - 50) / 50, -1, 1)
  const earContrast = clamp(params.earContrast / 100, 0, 1)
  const lateralNorm = clamp(position.lateralDegrees / 90, -1, 1)
  const sideWeight = Math.abs(lateralNorm)
  const earDirection = ear === "left" ? -1 : 1

  const frontWeight = Math.exp(-0.5 * Math.pow(position.polarDegrees / 45, 2))
  const backWeight = Math.exp(-0.5 * Math.pow((position.polarDegrees - 180) / 45, 2))
  const aboveWeight = Math.exp(-0.5 * Math.pow((position.polarDegrees - 90) / 35, 2))
  const exposure = clamp(
    earDirection *
      (lateralNorm * (0.72 + sideWeight * 0.48) +
        seed.earBias * (0.16 + aboveWeight * 0.42 + backWeight * 0.22)),
    -1.35,
    1.35
  )
  const exposed = Math.max(exposure, 0)
  const shadowed = Math.max(-exposure, 0)
  const contrastDrive = earContrast * (0.2 + sideWeight * 0.72 + aboveWeight * 0.28 + backWeight * 0.18)

  return frequencies.map((frequency) => {
    const tilt = (shape * 4.3 + seed.tilt * 1.6) * Math.log2(frequency / 1300)
    const body = (1.4 - shape * 0.9 + seed.body * 0.9) * gaussianLog(frequency, 180 + seed.body * 45, 1.3)
    const shoulder = (1.1 - shape * 0.35 + seed.shoulder * 0.75) * gaussianLog(frequency, 950 + seed.shoulder * 140, 1.0)
    const presence = (1.3 + shape * 1.2 + seed.presence * 0.95) * gaussianLog(frequency, 2800 + seed.presence * 380, 0.85)
    const air = (0.75 + Math.max(shape, 0) * 1.7 + seed.air * 0.8) * gaussianLog(frequency, 11000 + seed.air * 900, 0.72)

    const frontBackShape =
      contour *
      (frontWeight *
        ((3.2 + seed.contour * 0.85) * gaussianLog(frequency, 3300 + seed.presence * 280, 0.84) -
          (1.9 + Math.abs(seed.notch) * 0.95) * gaussianLog(frequency, 7700 + seed.pinna * 550, 0.5)) +
        backWeight *
          (-(2.8 + seed.contour * 0.8) * gaussianLog(frequency, 2500 + seed.body * 250, 0.95) +
            (2.9 + seed.notch * 0.95) * gaussianLog(frequency, 6900 + seed.notch * 650, 0.74)) +
        aboveWeight *
          ((3.4 + seed.air * 1.0) * gaussianLog(frequency, 8600 + seed.pinna * 1050, 0.45) -
            (3.0 + Math.abs(seed.notch) * 1.15) * gaussianLog(frequency, 11800 + seed.notch * 900, 0.34)) +
        sideWeight *
          ((1.0 + seed.shoulder * 0.65) * gaussianLog(frequency, 1450 + seed.body * 120, 1.0) -
            (1.5 + seed.pinna * 0.85) * gaussianLog(frequency, 4700 + seed.pinna * 700, 0.66)))

    const exposedPinnaCenter = 5200 + seed.pinna * 950 + contrastDrive * exposed * 1350
    const shadowNotchCenter = 7600 + seed.notch * 1200 + contrastDrive * shadowed * 900
    const airPeakCenter = 11800 + seed.air * 1300 + contrastDrive * exposed * 850
    const earDifference =
      contrastDrive *
      (exposed *
        ((1.35 + seed.shoulder * 0.5) * gaussianLog(frequency, 1900 + seed.body * 170, 0.96) +
          (3.3 + Math.abs(seed.pinna) * 1.15) * gaussianLog(frequency, exposedPinnaCenter, 0.48) +
          (1.9 + Math.abs(seed.air) * 0.8) * gaussianLog(frequency, airPeakCenter, 0.43)) +
        shadowed *
          ((-1.6 - Math.abs(seed.body) * 0.45) * gaussianLog(frequency, 1350 + seed.body * 150, 1.08) +
            (-2.5 - Math.abs(seed.presence) * 0.65) * gaussianLog(frequency, 3600 + seed.presence * 320, 0.76) +
            (-4.3 - Math.abs(seed.notch) * 1.2) * gaussianLog(frequency, shadowNotchCenter, 0.33) +
            (-1.35 - Math.abs(seed.air) * 0.45) * gaussianLog(frequency, 10400 + seed.air * 780, 0.5)))

    return body + shoulder + presence + air + tilt + frontBackShape + earDifference
  })
}

function buildMeasurement(
  position: HrtfPosition,
  frequencies: number[],
  params: CustomSynthParams,
  seed: CustomVariantSeed
): HrtfMeasurement {
  const earContrast = clamp(params.earContrast / 100, 0, 1)
  const lateralNorm = clamp(position.lateralDegrees / 90, -1, 1)
  const backWeight = Math.exp(-0.5 * Math.pow((position.polarDegrees - 180) / 45, 2))
  const aboveWeight = Math.exp(-0.5 * Math.pow((position.polarDegrees - 90) / 35, 2))

  const leftCurve = buildTargetCurve(frequencies, position, params, seed, "left")
  const rightCurve = buildTargetCurve(frequencies, position, params, seed, "right")

  const relativeDelaySamples =
    earContrast *
    (lateralNorm * (10 + Math.abs(lateralNorm) * 8) + seed.delayBias * (2 + aboveWeight * 3 + backWeight * 2))
  const leftDelaySamples = Math.max(0, relativeDelaySamples)
  const rightDelaySamples = Math.max(0, -relativeDelaySamples)

  const rawLeft = synthesizeImpulseFromCurve(frequencies, leftCurve, SAMPLE_RATE, IMPULSE_LENGTH, leftDelaySamples)
  const rawRight = synthesizeImpulseFromCurve(frequencies, rightCurve, SAMPLE_RATE, IMPULSE_LENGTH, rightDelaySamples)
  const normalized = normalizeStereoPair(rawLeft, rawRight)

  return {
    itd: (Math.abs(leftDelaySamples - rightDelaySamples) * 1000) / SAMPLE_RATE,
    left: Array.from(normalized.left),
    right: Array.from(normalized.right),
    leftDb: normalizeRelativeResponse(leftCurve),
    rightDb: normalizeRelativeResponse(rightCurve),
  }
}

export function buildCustomDataset(params: CustomSynthParams): HrtfDataset {
  const frequencies = logFrequencyAxis()
  const positions = CUSTOM_POSITIONS
  const subjects: HrtfSubjectData[] = Array.from({ length: CUSTOM_VARIANT_COUNT }, (_, index) => {
    const seed = buildVariantSeed(index)

    return {
      id: `custom-${index + 1}`,
      label: `Variant ${String(index + 1).padStart(2, "0")}`,
      positions: Object.fromEntries(
        positions.map((position) => [position.key, buildMeasurement(position, frequencies, params, seed)])
      ),
    }
  })

  return {
    source: {
      name: "Cabin Audio Custom Synth",
      license: "Synthetic generated response",
    },
    sampleRate: SAMPLE_RATE,
    frequencies,
    positions,
    subjects,
  }
}
