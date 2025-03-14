export interface FrequencyResponse {
  frequency: number;
  magnitude: number;
}

// Extended EQBand for UI interaction, including additional properties
// to handle rendering and interaction
export interface EQBandWithUI extends EQBand {
  id: string;
  type: BiquadFilterType;
  isHovered: boolean;
  frequencyResponse?: FrequencyResponse[];
}

// Base EQBand from the model for storage
export interface EQBand {
  frequency: number;
  gain: number;
  q: number;
  type: BiquadFilterType;
} 