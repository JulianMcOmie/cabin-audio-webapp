import { SyncStatus } from './SyncStatus';

export interface Artist {
  id: string;
  name: string;
  lastModified: number;
  syncStatus: SyncStatus;
}