import { SyncStatus } from './SyncStatus';

export interface Album {
  id: string;
  title: string;
  artistId?: string;    // Reference to Artist
  year?: number;
  coverStorageKey?: string;
  lastModified: number;
  syncStatus: SyncStatus;
} 