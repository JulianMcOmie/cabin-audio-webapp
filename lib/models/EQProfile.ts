import { EQBand } from './EQBand';
import { SyncStatus } from './SyncStatus';
import { AmplitudeCurveParams } from '@/components/parametric-eq/AmplitudeCurveControls';

// Define wavelet parameters for persistance
export interface WaveletParams {
  frequency: number;
  amplitude: number;
  phase: number;
  centerFreq: number;
  falloff: number;
}

export interface EQProfile {
  id: string;
  name: string;
  bands: EQBand[];
  volume: number;       // Volume offset to apply when profile is enabled (in dB)
  lastModified: number;
  syncStatus: SyncStatus;
  amplitudeCurveParams?: AmplitudeCurveParams; // Parameters for the amplitude curve
  wavelets?: WaveletParams[]; // Array of wavelets for the wavelet control
} 