export type EQBandChannel = 'both' | 'left' | 'right';

export interface EQBand {
  id: string;
  frequency: number;
  gain: number;
  q: number;  // Quality factor
  type?: BiquadFilterType; // Optional filter type, defaults to 'peaking'
  channel?: EQBandChannel; // Optional channel assignment — undefined is treated as 'both'
}
