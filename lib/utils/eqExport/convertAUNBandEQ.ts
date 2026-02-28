import type { ExportInput, ExportResult } from './types'
import { qToBandwidth } from './qConversions'

const TYPE_MAP: Record<string, string> = {
  peaking: 'Parametric',
  lowshelf: 'Low Shelf',
  highshelf: 'High Shelf',
}

export function convertAUNBandEQ(input: ExportInput): ExportResult {
  const sorted = [...input.bands].sort((a, b) => a.frequency - b.frequency).slice(0, 16)
  const lines: string[] = []

  lines.push(`AUNBandEQ Preset: ${input.profileName}`)
  lines.push(`Number of Bands: ${sorted.length}`)
  lines.push('')

  sorted.forEach((band, i) => {
    const type = TYPE_MAP[band.type ?? 'peaking'] ?? 'Parametric'
    const bw = qToBandwidth(band.q)
    lines.push(`Band ${i + 1}:`)
    lines.push(`  Type: ${type}`)
    lines.push(`  Frequency: ${Math.round(band.frequency)} Hz`)
    lines.push(`  Gain: ${band.gain.toFixed(1)} dB`)
    lines.push(`  Bandwidth: ${bw.toFixed(4)} octaves`)
    lines.push('')
  })

  return {
    content: lines.join('\n').trimEnd(),
    fileName: `${input.profileName} - AUNBandEQ.txt`,
    mimeType: 'text/plain',
  }
}
