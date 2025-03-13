import { EQBand } from './EQBand';
import { SyncStatus } from './SyncStatus';

export interface EQProfile {
  id: string;
  name: string;
  bands: EQBand[];
  volume: number;       // Volume offset to apply when profile is enabled (in dB)
  lastModified: number;
  syncStatus: SyncStatus;
} 