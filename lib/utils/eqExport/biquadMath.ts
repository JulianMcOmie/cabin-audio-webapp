/**
 * Pure-math biquad filter magnitude calculation (no AudioContext needed).
 * Based on Robert Bristow-Johnson's Audio EQ Cookbook.
 */

import type { EQBand } from '@/lib/models/EQBand'

const SAMPLE_RATE = 48000

interface BiquadCoeffs {
  b0: number; b1: number; b2: number
  a0: number; a1: number; a2: number
}

function peakingCoeffs(f0: number, gain: number, Q: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40)
  const w0 = 2 * Math.PI * f0 / SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * Q)
  return {
    b0: 1 + alpha * A,
    b1: -2 * Math.cos(w0),
    b2: 1 - alpha * A,
    a0: 1 + alpha / A,
    a1: -2 * Math.cos(w0),
    a2: 1 - alpha / A,
  }
}

function lowShelfCoeffs(f0: number, gain: number, Q: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40)
  const w0 = 2 * Math.PI * f0 / SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * Q)
  const sqrtA2alpha = 2 * Math.sqrt(A) * alpha
  return {
    b0: A * ((A + 1) - (A - 1) * Math.cos(w0) + sqrtA2alpha),
    b1: 2 * A * ((A - 1) - (A + 1) * Math.cos(w0)),
    b2: A * ((A + 1) - (A - 1) * Math.cos(w0) - sqrtA2alpha),
    a0: (A + 1) + (A - 1) * Math.cos(w0) + sqrtA2alpha,
    a1: -2 * ((A - 1) + (A + 1) * Math.cos(w0)),
    a2: (A + 1) + (A - 1) * Math.cos(w0) - sqrtA2alpha,
  }
}

function highShelfCoeffs(f0: number, gain: number, Q: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40)
  const w0 = 2 * Math.PI * f0 / SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * Q)
  const sqrtA2alpha = 2 * Math.sqrt(A) * alpha
  return {
    b0: A * ((A + 1) + (A - 1) * Math.cos(w0) + sqrtA2alpha),
    b1: -2 * A * ((A - 1) + (A + 1) * Math.cos(w0)),
    b2: A * ((A + 1) + (A - 1) * Math.cos(w0) - sqrtA2alpha),
    a0: (A + 1) - (A - 1) * Math.cos(w0) + sqrtA2alpha,
    a1: 2 * ((A - 1) - (A + 1) * Math.cos(w0)),
    a2: (A + 1) - (A - 1) * Math.cos(w0) - sqrtA2alpha,
  }
}

function getCoeffs(band: EQBand): BiquadCoeffs {
  const type = band.type ?? 'peaking'
  switch (type) {
    case 'lowshelf': return lowShelfCoeffs(band.frequency, band.gain, band.q)
    case 'highshelf': return highShelfCoeffs(band.frequency, band.gain, band.q)
    default: return peakingCoeffs(band.frequency, band.gain, band.q)
  }
}

function magnitudeDb(c: BiquadCoeffs, freq: number): number {
  const w = 2 * Math.PI * freq / SAMPLE_RATE
  const cosw = Math.cos(w)
  const cos2w = Math.cos(2 * w)
  const sinw = Math.sin(w)
  const sin2w = Math.sin(2 * w)

  const numReal = c.b0 + c.b1 * cosw + c.b2 * cos2w
  const numImag = -(c.b1 * sinw + c.b2 * sin2w)
  const denReal = c.a0 + c.a1 * cosw + c.a2 * cos2w
  const denImag = -(c.a1 * sinw + c.a2 * sin2w)

  const numMag2 = numReal * numReal + numImag * numImag
  const denMag2 = denReal * denReal + denImag * denImag

  if (denMag2 === 0) return 0
  return 10 * Math.log10(numMag2 / denMag2)
}

/**
 * Compute the combined magnitude response of all bands at the given frequencies.
 * Returns an array of gain values in dB, one per frequency.
 */
export function combinedMagnitudeAt(bands: EQBand[], frequencies: number[]): number[] {
  const allCoeffs = bands.map(getCoeffs)
  return frequencies.map((freq) => {
    let totalDb = 0
    for (const c of allCoeffs) {
      totalDb += magnitudeDb(c, freq)
    }
    return totalDb
  })
}

/**
 * Generate `count` logarithmically spaced frequencies from `min` to `max` Hz.
 */
export function logFrequencies(min: number, max: number, count: number): number[] {
  const logMin = Math.log10(min)
  const logMax = Math.log10(max)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push(Math.pow(10, logMin + (i / (count - 1)) * (logMax - logMin)))
  }
  return out
}
