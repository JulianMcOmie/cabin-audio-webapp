import { EQBand } from '@/lib/models/EQBand';

export interface FrequencyResponse {
  frequency: number;
  magnitude: number;
}

// Extended EQBand for UI interaction, including additional properties
// to handle rendering and interaction
export interface EQBandWithUI extends EQBand {
  isHovered: boolean;
  type: BiquadFilterType;
  frequencyResponse?: FrequencyResponse[];
}

// We now import EQBand from lib/models/EQBand.ts 