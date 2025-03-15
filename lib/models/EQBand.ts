export interface EQBand {
  id: string;
  frequency: number;
  gain: number;
  q: number;  // Quality factor
  type?: BiquadFilterType; // Optional filter type, defaults to 'peaking'
} 