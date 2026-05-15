export interface HrtfDatasetSource {
  name: string
  license: string
  repository?: string
}

export interface HrtfPosition {
  key: string
  label: string
  lateralDegrees: number
  polarDegrees: number
}

export interface HrtfMeasurement {
  itd: number
  left: number[]
  right: number[]
  leftDb: number[]
  rightDb: number[]
}

export interface HrtfSubjectData {
  id: string
  label: string
  positions: Record<string, HrtfMeasurement>
}

export interface HrtfDataset {
  source: HrtfDatasetSource
  sampleRate: number
  frequencies: number[]
  positions: HrtfPosition[]
  subjects: HrtfSubjectData[]
}
