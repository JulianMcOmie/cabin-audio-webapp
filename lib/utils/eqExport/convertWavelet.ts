import type { ExportInput, ExportResult } from './types'
import { combinedMagnitudeAt, logFrequencies } from './biquadMath'

// 128 logarithmically spaced points from 20 Hz–20 kHz (standard GraphicEQ density)
const GRAPHIC_EQ_FREQS = logFrequencies(20, 20000, 128)

export function convertWavelet(input: ExportInput): ExportResult {
  const gains = combinedMagnitudeAt(input.bands, GRAPHIC_EQ_FREQS)

  // Apply preamp
  const pairs = GRAPHIC_EQ_FREQS.map((freq, i) => {
    const g = gains[i] + input.preampDb
    return `${Math.round(freq)} ${g.toFixed(1)}`
  })

  const content = `GraphicEQ: ${pairs.join('; ')}`

  return {
    content,
    fileName: `${input.profileName} - Wavelet.txt`,
    mimeType: 'text/plain',
  }
}
