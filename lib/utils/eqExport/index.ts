import type { ExportFormatMeta, ExportConverter } from './types'
import { convertAPO, convertPeaceEQ } from './convertAPO'
import { convertEQMac } from './convertEQMac'
import { convertWavelet } from './convertWavelet'
import { convertPowerAmp } from './convertPowerAmp'
import { convertJSON } from './convertJSON'

export type { ExportFormatId, ExportFormatMeta, ExportInput, ExportResult, ExportConverter } from './types'

export interface FormatEntry {
  meta: ExportFormatMeta
  convert: ExportConverter
}

export const FORMAT_REGISTRY: FormatEntry[] = [
  {
    meta: {
      id: 'eqmac',
      name: 'eqMac',
      platform: 'macOS',
      fileExtension: '.json',
      description: 'eqMac Advanced Equalizer preset',
      instructions: 'Open eqMac → Advanced Equalizer → click the preset menu → Import.',
    },
    convert: convertEQMac,
  },
  {
    meta: {
      id: 'equalizer-apo',
      name: 'Equalizer APO',
      platform: 'Windows',
      fileExtension: '.txt',
      description: 'Parametric EQ config for Equalizer APO',
      instructions: 'Place this file in your Equalizer APO config folder (usually C:\\Program Files\\EqualizerAPO\\config), or paste the contents into the Configuration Editor.',
    },
    convert: convertAPO,
  },
  {
    meta: {
      id: 'peace-eq',
      name: 'Peace EQ',
      platform: 'Windows',
      fileExtension: '.txt',
      description: 'Peace GUI preset (Equalizer APO frontend)',
      instructions: 'Open Peace → click Import → select this file. Peace uses the same format as Equalizer APO.',
    },
    convert: convertPeaceEQ,
  },
  {
    meta: {
      id: 'wavelet',
      name: 'Wavelet',
      platform: 'Android',
      fileExtension: '.txt',
      description: 'GraphicEQ format for Wavelet AutoEQ import',
      instructions: 'Copy this file to your device → open Wavelet → tap AutoEQ → Import. The filename becomes the preset name.',
    },
    convert: convertWavelet,
  },
  {
    meta: {
      id: 'poweramp',
      name: 'PowerAmp',
      platform: 'Android',
      fileExtension: '.txt',
      description: 'AutoEQ parametric preset for PowerAmp (v911+)',
      instructions: 'Copy this file to your device → open PowerAmp EQ → long-press any preset → Import.',
    },
    convert: convertPowerAmp,
  },
  {
    meta: {
      id: 'json',
      name: 'Raw JSON',
      platform: 'Cross-platform',
      fileExtension: '.json',
      description: 'Portable JSON export of the EQ profile',
      instructions: 'Use this file with any app or script that accepts JSON EQ data.',
    },
    convert: convertJSON,
  },
]

/** Get formats grouped by platform, in display order. */
export function getFormatsByPlatform(): { platform: string; formats: FormatEntry[] }[] {
  const platformOrder = ['macOS', 'Windows', 'Android', 'Cross-platform']
  const groups = new Map<string, FormatEntry[]>()

  for (const entry of FORMAT_REGISTRY) {
    const list = groups.get(entry.meta.platform) ?? []
    list.push(entry)
    groups.set(entry.meta.platform, list)
  }

  return platformOrder
    .filter((p) => groups.has(p))
    .map((platform) => ({ platform, formats: groups.get(platform)! }))
}
