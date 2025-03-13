import { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEQProfileStore } from '../stores';
import * as eqProcessor from '../audio/eqProcessor';
import * as indexedDBManager from '../storage/indexedDBManager';
import { EQProfile } from '../models/EQProfile';
import { EQBand } from '../models/EQBand';
import * as syncManager from '../sync/syncManager';

// Hook for EQ controls
export const useEQ = () => {
  const {
    profiles,
    activeProfileId,
    addProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    getProfiles,
    getProfileById,
    getActiveProfile
  } = useEQProfileStore();
  
  const [isEnabled, setIsEnabled] = useState(true);
  
  // Initialize EQ on mount
  useEffect(() => {
    const processor = eqProcessor.getEQProcessor();
    
    // Set initial enabled state
    setIsEnabled(processor.isEQEnabled());
    
    // If we have an active profile, apply it
    const activeProfile = getActiveProfile();
    if (activeProfile) {
      processor.applyProfile(activeProfile);
    }
    
    // If we don't have any profiles, create a default one
    if (Object.keys(profiles).length === 0) {
      const defaultProfile = processor.createDefaultProfile();
      addProfile(defaultProfile);
      setActiveProfile(defaultProfile.id);
      processor.applyProfile(defaultProfile);
      
      // Save to IndexedDB
      indexedDBManager.addItem(
        indexedDBManager.STORES.EQ_PROFILES,
        defaultProfile
      );
    }
  }, [profiles, addProfile, setActiveProfile, getActiveProfile]);
  
  // Toggle EQ enabled/disabled
  const toggleEnabled = useCallback(() => {
    const processor = eqProcessor.getEQProcessor();
    const newEnabled = !processor.isEQEnabled();
    processor.setEnabled(newEnabled);
    setIsEnabled(newEnabled);
  }, []);
  
  // Create a new profile
  const createProfile = useCallback(async (name: string) => {
    // Create default bands
    const bands: EQBand[] = eqProcessor.DEFAULT_FREQUENCIES.map(frequency => ({
      frequency,
      gain: 0,
      q: eqProcessor.DEFAULT_Q
    }));
    
    // Create new profile
    const newProfile: EQProfile = {
      id: uuidv4(),
      name,
      bands,
      volume: 0,
      lastModified: Date.now(),
      syncStatus: 'pending'
    };
    
    // Add to store
    addProfile(newProfile);
    
    // Save to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.EQ_PROFILES,
      newProfile
    );
    
    // Queue sync
    syncManager.getSyncManager().queueSync();
    
    return newProfile;
  }, [addProfile]);
  
  // Duplicate a profile
  const duplicateProfile = useCallback(async (profileId: string, newName: string) => {
    const sourceProfile = getProfileById(profileId);
    if (!sourceProfile) {
      throw new Error(`Profile with ID ${profileId} not found`);
    }
    
    // Create new profile with same settings
    const newProfile: EQProfile = {
      id: uuidv4(),
      name: newName,
      bands: [...sourceProfile.bands],
      volume: sourceProfile.volume,
      lastModified: Date.now(),
      syncStatus: 'pending'
    };
    
    // Add to store
    addProfile(newProfile);
    
    // Save to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.EQ_PROFILES,
      newProfile
    );
    
    // Queue sync
    syncManager.getSyncManager().queueSync();
    
    return newProfile;
  }, [getProfileById, addProfile]);
  
  // Rename a profile
  const renameProfile = useCallback(async (profileId: string, newName: string) => {
    // Update in store
    updateProfile(profileId, { name: newName });
    
    // Get updated profile
    const profile = getProfileById(profileId);
    if (!profile) {
      throw new Error(`Profile with ID ${profileId} not found`);
    }
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.EQ_PROFILES,
      {
        ...profile,
        name: newName,
        lastModified: Date.now(),
        syncStatus: 'modified'
      }
    );
    
    // Queue sync
    syncManager.getSyncManager().queueSync();
  }, [updateProfile, getProfileById]);
  
  // Delete a profile
  const removeProfile = useCallback(async (profileId: string) => {
    // Check if this is the active profile
    if (activeProfileId === profileId) {
      // Find another profile to set as active
      const allProfiles = getProfiles();
      const otherProfile = allProfiles.find(p => p.id !== profileId);
      
      if (otherProfile) {
        // Set another profile as active
        setActiveProfile(otherProfile.id);
        
        // Apply the new active profile
        const processor = eqProcessor.getEQProcessor();
        processor.applyProfile(otherProfile);
      } else {
        // No other profiles, create a default one
        const processor = eqProcessor.getEQProcessor();
        const defaultProfile = processor.createDefaultProfile();
        
        // Add to store
        addProfile(defaultProfile);
        setActiveProfile(defaultProfile.id);
        
        // Apply the default profile
        processor.applyProfile(defaultProfile);
        
        // Save to IndexedDB
        await indexedDBManager.addItem(
          indexedDBManager.STORES.EQ_PROFILES,
          defaultProfile
        );
      }
    }
    
    // Delete from store
    deleteProfile(profileId);
    
    // Delete from IndexedDB
    await indexedDBManager.deleteItem(
      indexedDBManager.STORES.EQ_PROFILES,
      profileId
    );
    
    // Queue sync
    syncManager.getSyncManager().queueSync();
  }, [activeProfileId, getProfiles, setActiveProfile, addProfile, deleteProfile]);
  
  // Select a profile
  const selectProfile = useCallback((profileId: string) => {
    // Get the profile
    const profile = getProfileById(profileId);
    if (!profile) {
      throw new Error(`Profile with ID ${profileId} not found`);
    }
    
    // Set as active
    setActiveProfile(profileId);
    
    // Apply the profile
    const processor = eqProcessor.getEQProcessor();
    processor.applyProfile(profile);
    
    // Queue sync of active profile
    syncManager.getSyncManager().queueSync();
  }, [getProfileById, setActiveProfile]);
  
  // Update a band in the current profile
  const updateBand = useCallback(async (bandIndex: number, gain: number) => {
    // Get active profile
    const profile = getActiveProfile();
    if (!profile) {
      return;
    }
    
    // Update the band in the processor
    const processor = eqProcessor.getEQProcessor();
    processor.updateBand(bandIndex, gain);
    
    // Create updated bands array
    const updatedBands = [...profile.bands];
    updatedBands[bandIndex] = {
      ...updatedBands[bandIndex],
      gain
    };
    
    // Update in store
    updateProfile(profile.id, { bands: updatedBands });
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.EQ_PROFILES,
      {
        ...profile,
        bands: updatedBands,
        lastModified: Date.now(),
        syncStatus: 'modified'
      }
    );
    
    // Queue sync
    syncManager.getSyncManager().queueSync();
  }, [getActiveProfile, updateProfile]);
  
  // Update volume offset in the current profile
  const updateVolume = useCallback(async (volume: number) => {
    // Get active profile
    const profile = getActiveProfile();
    if (!profile) {
      return;
    }
    
    // Update the volume in the processor
    const processor = eqProcessor.getEQProcessor();
    processor.updateVolume(volume);
    
    // Update in store
    updateProfile(profile.id, { volume });
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.EQ_PROFILES,
      {
        ...profile,
        volume,
        lastModified: Date.now(),
        syncStatus: 'modified'
      }
    );
    
    // Queue sync
    syncManager.getSyncManager().queueSync();
  }, [getActiveProfile, updateProfile]);
  
  return {
    // State
    profiles: Object.values(profiles),
    activeProfileId,
    activeProfile: getActiveProfile(),
    isEnabled,
    
    // Actions
    toggleEnabled,
    createProfile,
    duplicateProfile,
    renameProfile,
    removeProfile,
    selectProfile,
    updateBand,
    updateVolume
  };
}; 