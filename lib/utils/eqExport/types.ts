import type { EQBand } from '@/lib/models/EQBand'

export type ExportFormatId =
  | 'equalizer-apo'
  | 'peace-eq'
  | 'wavelet'
  | 'poweramp'
  | 'eqmac'
  | 'json'

export interface ExportFormatMeta {
  id: ExportFormatId
  name: string
  platform: string
  fileExtension: string
  description: string
  instructions: string
}

export interface ExportInput {
  profileName: string
  bands: EQBand[]
  preampDb: number
}

export interface ExportResult {
  content: string
  fileName: string
  mimeType: string
}

export type ExportConverter = (input: ExportInput) => ExportResult
