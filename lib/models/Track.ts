import { SyncStatus } from './SyncStatus';

export interface Track {
  id: string;
  title: string;
  artistId?: string;
  albumId?: string;
  duration: number;
  trackNumber?: number;
  year?: number;
  genre?: string;
  storageKey: string;  // IndexedDB key
  coverStorageKey?: string;
  lastModified: number;
  syncStatus: SyncStatus;
} 