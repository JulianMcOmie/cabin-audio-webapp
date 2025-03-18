import { EQProfile } from '../../models/EQProfile';
import { useEQProfileStore } from '../../stores';
import * as indexedDBManager from '../../storage/indexedDBManager';
// import * as apiClient from '../../api/apiClient';
import * as eqApi from '../../api/endpoints/eqApi';

// Sync all EQ profiles with the server
export const syncEQProfiles = async (): Promise<void> => {
  try {
    // Get all profiles from the store
    const profiles = useEQProfileStore.getState().getProfiles();
    
    // Filter profiles that need to be synced
    const profilesToSync = profiles.filter(profile => 
      profile.syncStatus === 'modified' || profile.syncStatus === 'pending'
    );
    
    // Upload modified profiles
    for (const profile of profilesToSync) {
      await uploadEQProfile(profile);
    }
    
    // Download new profiles from server
    await downloadNewEQProfiles();
    
    // Sync active profile ID
    await syncActiveProfileId();
    
  } catch (error) {
    console.error('Error syncing EQ profiles:', error);
    throw error;
  }
};

// Upload an EQ profile to the server
export const uploadEQProfile = async (profile: EQProfile): Promise<void> => {
  try {
    // Check if profile exists on server
    const exists = await eqApi.checkEQProfileExists(profile.id);
    
    if (exists) {
      // Update existing profile
      await eqApi.updateEQProfile(profile);
    } else {
      // Create new profile
      await eqApi.createEQProfile(profile);
    }
    
    // Update profile sync status
    const updatedProfile = {
      ...profile,
      syncStatus: 'synced' as const,
      lastModified: Date.now()
    };
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.EQ_PROFILES,
      updatedProfile
    );
    
    // Update in store
    useEQProfileStore.getState().updateProfile(profile.id, {
      syncStatus: 'synced'
    });
    
  } catch (error) {
    console.error(`Error uploading EQ profile ${profile.id}:`, error);
    
    // Mark as conflict if there was a sync error
    if (error.name === 'ConflictError') {
      const conflictProfile = {
        ...profile,
        syncStatus: 'conflict' as const,
        lastModified: Date.now()
      };
      
      // Update in IndexedDB
      await indexedDBManager.updateItem(
        indexedDBManager.STORES.EQ_PROFILES,
        conflictProfile
      );
      
      // Update in store
      useEQProfileStore.getState().updateProfile(profile.id, {
        syncStatus: 'conflict'
      });
    }
    
    throw error;
  }
};

// Download new EQ profiles from the server
export const downloadNewEQProfiles = async (): Promise<void> => {
  try {
    // Get last sync time
    const lastSyncTime = await getLastSyncTime();
    
    // Get profiles updated since last sync
    const updatedProfiles = await eqApi.getEQProfilesUpdatedSince(lastSyncTime);
    
    // Process each updated profile
    for (const serverProfile of updatedProfiles) {
      // Check if we already have this profile
      const localProfile = useEQProfileStore.getState().getProfileById(serverProfile.id);
      
      if (!localProfile) {
        // New profile, add it
        await addNewEQProfile(serverProfile);
      } else if (localProfile.syncStatus !== 'modified' && localProfile.syncStatus !== 'conflict') {
        // Update existing profile if it hasn't been modified locally
        await updateExistingEQProfile(serverProfile);
      } else {
        // Handle conflict
        await handleEQProfileConflict(serverProfile, localProfile);
      }
    }
    
    // Update last sync time
    await setLastSyncTime(Date.now());
    
  } catch (error) {
    console.error('Error downloading EQ profiles:', error);
    throw error;
  }
};

// Add a new EQ profile from the server
const addNewEQProfile = async (serverProfile: EQProfile): Promise<void> => {
  try {
    // Add profile to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.EQ_PROFILES,
      {
        ...serverProfile,
        syncStatus: 'synced'
      }
    );
    
    // Add profile to store
    useEQProfileStore.getState().addProfile({
      ...serverProfile,
      syncStatus: 'synced'
    });
    
  } catch (error) {
    console.error(`Error adding new EQ profile ${serverProfile.id}:`, error);
    throw error;
  }
};

// Update an existing EQ profile with server data
const updateExistingEQProfile = async (serverProfile: EQProfile): Promise<void> => {
  try {
    // Update profile in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.EQ_PROFILES,
      {
        ...serverProfile,
        syncStatus: 'synced'
      }
    );
    
    // Update profile in store
    useEQProfileStore.getState().updateProfile(serverProfile.id, {
      ...serverProfile,
      syncStatus: 'synced'
    });
    
  } catch (error) {
    console.error(`Error updating EQ profile ${serverProfile.id}:`, error);
    throw error;
  }
};

// Handle conflict between server and local EQ profile
const handleEQProfileConflict = async (serverProfile: EQProfile): Promise<void> => {
  try {
    // For EQ profiles, we'll create a new version with a conflict suffix
    // This allows the user to choose which version to keep
    
    // Create a new profile with conflict suffix
    const conflictProfile: EQProfile = {
      ...serverProfile,
      id: `${serverProfile.id}_conflict_${Date.now()}`,
      name: `${serverProfile.name} (Server Version)`,
      syncStatus: 'pending',
      lastModified: Date.now()
    };
    
    // Add conflict profile to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.EQ_PROFILES,
      conflictProfile
    );
    
    // Add conflict profile to store
    useEQProfileStore.getState().addProfile(conflictProfile);
    
  } catch (error) {
    console.error(`Error handling conflict for EQ profile ${serverProfile.id}:`, error);
    throw error;
  }
};

// Sync the active profile ID with the server
const syncActiveProfileId = async (): Promise<void> => {
  try {
    // Get current active profile ID
    const activeProfileId = useEQProfileStore.getState().activeProfileId;
    
    // Upload to server
    await eqApi.setActiveEQProfile(activeProfileId);
    
    // Get server active profile ID
    const serverActiveProfileId = await eqApi.getActiveEQProfile();
    
    // If server has a different active profile, use that
    if (serverActiveProfileId && serverActiveProfileId !== activeProfileId) {
      // Check if we have this profile
      const profile = useEQProfileStore.getState().getProfileById(serverActiveProfileId);
      
      if (profile) {
        // Set as active
        useEQProfileStore.getState().setActiveProfile(serverActiveProfileId);
      }
    }
    
  } catch (error) {
    console.error('Error syncing active EQ profile ID:', error);
    // Non-critical error, don't throw
  }
};

// Get the last sync time for EQ profiles
const getLastSyncTime = async (): Promise<number> => {
  try {
    const syncState = await indexedDBManager.getItem<{ lastSyncTime: number }>(
      indexedDBManager.STORES.SYNC_STATE,
      'eqProfiles'
    );
    
    return syncState?.lastSyncTime || 0;
  } catch (error) {
    console.error('Error getting last sync time for EQ profiles:', error);
    return 0;
  }
};

// Set the last sync time for EQ profiles
const setLastSyncTime = async (time: number): Promise<void> => {
  try {
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.SYNC_STATE,
      {
        id: 'eqProfiles',
        lastSyncTime: time
      }
    );
  } catch (error) {
    console.error('Error setting last sync time for EQ profiles:', error);
  }
}; 