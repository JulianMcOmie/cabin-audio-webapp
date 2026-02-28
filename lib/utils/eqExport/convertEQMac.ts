import type { ExportInput, ExportResult } from './types'

export function convertEQMac(input: ExportInput): ExportResult {
  const sorted = [...input.bands].sort((a, b) => a.frequency - b.frequency)

  const data = {
    name: input.profileName,
    global: { gain: input.preampDb },
    bands: sorted.map((band) => ({
      frequency: band.frequency,
      gain: band.gain,
      q: band.q,
      type: band.type ?? 'peaking',
    })),
  }

  return {
    content: JSON.stringify(data, null, 2),
    fileName: `${input.profileName} - EQMac.json`,
    mimeType: 'application/json',
  }
}
