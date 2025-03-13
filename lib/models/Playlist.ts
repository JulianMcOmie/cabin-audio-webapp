import { SyncStatus } from './SyncStatus';

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];  // References to Tracks
  lastModified: number;
  syncStatus: SyncStatus;
} 