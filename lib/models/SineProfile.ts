import { SyncStatus } from './SyncStatus';
import { EQPoint } from '@/components/sine-eq/types';

export interface SineProfile {
  id: string;
  name: string;
  points: EQPoint[];
  lastModified: number;
  syncStatus: SyncStatus;
} 