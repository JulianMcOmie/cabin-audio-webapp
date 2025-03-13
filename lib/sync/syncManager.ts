import { useSyncStore } from '../stores';
import * as trackSync from './entitySync/trackSync';
import * as albumSync from './entitySync/albumSync';
import * as artistSync from './entitySync/artistSync';
import * as playlistSync from './entitySync/playlistSync';
import * as eqSync from './entitySync/eqSync';

// Minimum time between syncs (in milliseconds)
const MIN_SYNC_INTERVAL = 60000; // 1 minute

// Class to manage synchronization
class SyncManager {
  private isSyncing: boolean = false;
  private syncQueue: Array<() => Promise<void>> = [];
  private lastSyncTime: number = 0;
  
  constructor() {
    this.initialize();
  }
  
  // Initialize the sync manager
  private initialize(): void {
    // Set up event listeners for online/offline status
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));
    
    // Check if we're online at startup
    if (navigator.onLine) {
      this.handleOnline();
    }
  }
  
  // Handle coming online
  private handleOnline(): void {
    console.log('Device is online, checking for pending changes');
    
    // Check if we have pending changes
    if (useSyncStore.getState().hasPendingChanges) {
      // Wait a bit to ensure connection is stable
      setTimeout(() => {
        this.sync();
      }, 5000);
    }
  }
  
  // Handle going offline
  private handleOffline(): void {
    console.log('Device is offline, sync operations paused');
    
    // If we're currently syncing, we'll let the current operations finish
    // but won't start new ones until we're back online
  }
  
  // Start a sync operation
  public async sync(): Promise<void> {
    // Don't sync if we're offline
    if (!navigator.onLine) {
      console.log('Cannot sync while offline');
      return;
    }
    
    // Don't sync if we're already syncing
    if (this.isSyncing) {
      console.log('Sync already in progress');
      return;
    }
    
    // Don't sync too frequently
    const now = Date.now();
    if (now - this.lastSyncTime < MIN_SYNC_INTERVAL) {
      console.log('Sync requested too soon after previous sync');
      return;
    }
    
    try {
      // Update sync state
      this.isSyncing = true;
      useSyncStore.getState().startSync();
      
      console.log('Starting sync operation');
      
      // Sync each entity type
      await this.syncEntities();
      
      // Update last sync time
      this.lastSyncTime = Date.now();
      
      // Update sync state
      useSyncStore.getState().completeSync();
      this.isSyncing = false;
      
      console.log('Sync operation completed successfully');
    } catch (error) {
      console.error('Sync operation failed:', error);
      
      // Update sync state
      useSyncStore.getState().setIsSyncing(false);
      this.isSyncing = false;
    }
  }
  
  // Sync all entity types
  private async syncEntities(): Promise<void> {
    // Sync in order: artists, albums, tracks, playlists, EQ profiles
    // This order ensures dependencies are synced first
    
    // Sync artists
    await artistSync.syncArtists();
    
    // Sync albums
    await albumSync.syncAlbums();
    
    // Sync tracks
    await trackSync.syncTracks();
    
    // Sync playlists
    await playlistSync.syncPlaylists();
    
    // Sync EQ profiles
    await eqSync.syncEQProfiles();
  }
  
  // Queue a sync operation for later
  public queueSync(): void {
    // Mark that we have pending changes
    useSyncStore.getState().setHasPendingChanges(true);
    
    // If we're online, schedule a sync
    if (navigator.onLine && !this.isSyncing) {
      // Debounce sync operations
      setTimeout(() => {
        this.sync();
      }, 5000);
    }
  }
  
  // Check if sync is in progress
  public isSyncInProgress(): boolean {
    return this.isSyncing;
  }
  
  // Get the last sync time
  public getLastSyncTime(): number {
    return this.lastSyncTime;
  }
}

// Singleton instance
let syncManagerInstance: SyncManager | null = null;

// Get or create the sync manager instance
export const getSyncManager = (): SyncManager => {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager();
  }
  
  return syncManagerInstance;
};

// Initialize the sync manager (call this when the app starts)
export const initializeSyncManager = (): void => {
  getSyncManager();
};

// Clean up the sync manager (call this when the app is unloaded)
export const cleanupSyncManager = (): void => {
  if (syncManagerInstance) {
    // Remove event listeners
    window.removeEventListener('online', (syncManagerInstance as any).handleOnline);
    window.removeEventListener('offline', (syncManagerInstance as any).handleOffline);
    
    syncManagerInstance = null;
  }
}; 