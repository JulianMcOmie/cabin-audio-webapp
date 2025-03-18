import { Track } from '../../models/Track';
import { useTrackStore } from '../../stores';
import * as indexedDBManager from '../../storage/indexedDBManager';
// import * as apiClient from '../../api/apiClient';
import * as tracksApi from '../../api/endpoints/tracksApi';

// Sync all tracks with the server
export const syncTracks = async (): Promise<void> => {
  try {
    // Get all tracks from the store
    const tracks = useTrackStore.getState().getTracks();
    
    // Filter tracks that need to be synced
    const tracksToSync = tracks.filter(track => 
      track.syncStatus === 'modified' || track.syncStatus === 'pending'
    );
    
    // Upload modified tracks
    for (const track of tracksToSync) {
      await uploadTrack(track);
    }
    
    // Download new tracks from server
    await downloadNewTracks();
    
  } catch (error) {
    console.error('Error syncing tracks:', error);
    throw error;
  }
};

// Upload a track to the server
export const uploadTrack = async (track: Track): Promise<void> => {
  try {
    // Check if track exists on server
    const exists = await tracksApi.checkTrackExists(track.id);
    
    if (exists) {
      // Update existing track
      await tracksApi.updateTrack(track);
    } else {
      // Create new track
      await tracksApi.createTrack(track);
    }
    
    // Update track sync status
    const updatedTrack = {
      ...track,
      syncStatus: 'synced' as const,
      lastModified: Date.now()
    };
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.TRACKS,
      updatedTrack
    );
    
    // Update in store
    useTrackStore.getState().updateTrack(track.id, {
      syncStatus: 'synced'
    });
    
  } catch (error) {
    console.error(`Error uploading track ${track.id}:`, error);
    
    // Mark as conflict if there was a sync error
    if (error.name === 'ConflictError') {
      const conflictTrack = {
        ...track,
        syncStatus: 'conflict' as const,
        lastModified: Date.now()
      };
      
      // Update in IndexedDB
      await indexedDBManager.updateItem(
        indexedDBManager.STORES.TRACKS,
        conflictTrack
      );
      
      // Update in store
      useTrackStore.getState().updateTrack(track.id, {
        syncStatus: 'conflict'
      });
    }
    
    throw error;
  }
};

// Download new tracks from the server
export const downloadNewTracks = async (): Promise<void> => {
  try {
    // Get last sync time
    const lastSyncTime = await getLastSyncTime();
    
    // Get tracks updated since last sync
    const updatedTracks = await tracksApi.getTracksUpdatedSince(lastSyncTime);
    
    // Process each updated track
    for (const serverTrack of updatedTracks) {
      // Check if we already have this track
      const localTrack = useTrackStore.getState().getTrackById(serverTrack.id);
      
      if (!localTrack) {
        // New track, add it
        await addNewTrack(serverTrack);
      } else if (localTrack.syncStatus !== 'modified' && localTrack.syncStatus !== 'conflict') {
        // Update existing track if it hasn't been modified locally
        await updateExistingTrack(serverTrack, localTrack);
      } else {
        // Handle conflict
        await handleTrackConflict(serverTrack, localTrack);
      }
    }
    
    // Update last sync time
    await setLastSyncTime(Date.now());
    
  } catch (error) {
    console.error('Error downloading tracks:', error);
    throw error;
  }
};

// Add a new track from the server
const addNewTrack = async (serverTrack: Track): Promise<void> => {
  try {
    // Download the audio file
    // const audioBlob = await tracksApi.downloadTrackAudio(serverTrack.id);
    
    // Store the audio file
    // Note: In a real implementation, we would use fileStorage.storeAudioFile
    // but for simplicity, we'll just use the existing storageKey
    
    // Add track to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.TRACKS,
      {
        ...serverTrack,
        syncStatus: 'synced'
      }
    );
    
    // Add track to store
    useTrackStore.getState().addTrack({
      ...serverTrack,
      syncStatus: 'synced'
    });
    
  } catch (error) {
    console.error(`Error adding new track ${serverTrack.id}:`, error);
    throw error;
  }
};

// Update an existing track with server data
const updateExistingTrack = async (serverTrack: Track, localTrack: Track): Promise<void> => {
  try {
    // Update track in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.TRACKS,
      {
        ...serverTrack,
        // Keep local storage keys
        storageKey: localTrack.storageKey,
        coverStorageKey: localTrack.coverStorageKey,
        syncStatus: 'synced'
      }
    );
    
    // Update track in store
    useTrackStore.getState().updateTrack(serverTrack.id, {
      ...serverTrack,
      // Keep local storage keys
      storageKey: localTrack.storageKey,
      coverStorageKey: localTrack.coverStorageKey,
      syncStatus: 'synced'
    });
    
  } catch (error) {
    console.error(`Error updating track ${serverTrack.id}:`, error);
    throw error;
  }
};

// Handle conflict between server and local track
const handleTrackConflict = async (serverTrack: Track, localTrack: Track): Promise<void> => {
  try {
    // For V1, use simple "last write wins" strategy based on timestamps
    if (serverTrack.lastModified > localTrack.lastModified) {
      // Server version is newer
      await updateExistingTrack(serverTrack, localTrack);
    } else {
      // Local version is newer, upload it
      await uploadTrack(localTrack);
    }
    
  } catch (error) {
    console.error(`Error handling conflict for track ${serverTrack.id}:`, error);
    
    // Mark as conflict
    const conflictTrack = {
      ...localTrack,
      syncStatus: 'conflict' as const,
      lastModified: Date.now()
    };
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.TRACKS,
      conflictTrack
    );
    
    // Update in store
    useTrackStore.getState().updateTrack(localTrack.id, {
      syncStatus: 'conflict'
    });
    
    throw error;
  }
};

// Get the last sync time for tracks
const getLastSyncTime = async (): Promise<number> => {
  try {
    const syncState = await indexedDBManager.getItem<{ lastSyncTime: number }>(
      indexedDBManager.STORES.SYNC_STATE,
      'tracks'
    );
    
    return syncState?.lastSyncTime || 0;
  } catch (error) {
    console.error('Error getting last sync time for tracks:', error);
    return 0;
  }
};

// Set the last sync time for tracks
const setLastSyncTime = async (time: number): Promise<void> => {
  try {
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.SYNC_STATE,
      {
        id: 'tracks',
        lastSyncTime: time
      }
    );
  } catch (error) {
    console.error('Error setting last sync time for tracks:', error);
  }
}; 