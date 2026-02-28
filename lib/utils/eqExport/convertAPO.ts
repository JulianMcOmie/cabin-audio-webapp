import type { ExportInput, ExportResult } from './types'

const TYPE_MAP: Record<string, string> = {
  peaking: 'PK',
  lowshelf: 'LSC',
  highshelf: 'HSC',
}

function formatAPO(input: ExportInput): string {
  const sorted = [...input.bands].sort((a, b) => a.frequency - b.frequency)
  const lines: string[] = []

  if (input.preampDb !== 0) {
    lines.push(`Preamp: ${input.preampDb.toFixed(1)} dB`)
  }

  sorted.forEach((band, i) => {
    const type = TYPE_MAP[band.type ?? 'peaking'] ?? 'PK'
    const freq = Math.round(band.frequency)
    const gain = band.gain.toFixed(1)
    const q = band.q.toFixed(4)
    lines.push(`Filter ${i + 1}: ON ${type} Fc ${freq} Hz Gain ${gain} dB Q ${q}`)
  })

  return lines.join('\n')
}

export function convertAPO(input: ExportInput): ExportResult {
  return {
    content: formatAPO(input),
    fileName: `${input.profileName} - EqualizerAPO.txt`,
    mimeType: 'text/plain',
  }
}

export function convertPeaceEQ(input: ExportInput): ExportResult {
  return {
    content: formatAPO(input),
    fileName: `${input.profileName} - PeaceEQ.txt`,
    mimeType: 'text/plain',
  }
}
