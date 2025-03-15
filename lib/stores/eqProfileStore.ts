import { create } from 'zustand';
import { EQProfile } from '../models/EQProfile';
import { SyncStatus } from '../models/SyncStatus';
import * as indexedDBManager from '../storage/indexedDBManager';

// Extend EQProfile for our internal use, adding isDefault property
interface EQProfileWithDefault extends EQProfile {
  isDefault?: boolean;
}

interface EQProfileState {
  profiles: Record<string, EQProfileWithDefault>;
  activeProfileId: string | null;
  isLoading: boolean;
  isEQEnabled: boolean;
  distortionGain: number;
  
  // Actions
  addProfile: (profile: EQProfileWithDefault) => void;
  updateProfile: (profileId: string, updates: Partial<EQProfileWithDefault>) => void;
  deleteProfile: (profileId: string) => void;
  setActiveProfile: (profileId: string | null) => void;
  setEQEnabled: (enabled: boolean) => void;
  setDistortionGain: (gain: number) => void;
  getProfiles: () => EQProfileWithDefault[];
  getProfileById: (profileId: string) => EQProfileWithDefault | undefined;
  getActiveProfile: () => EQProfileWithDefault | null;
}

// Helper function to load profiles from IndexedDB
const loadProfilesFromStorage = async (): Promise<Record<string, EQProfileWithDefault>> => {
  try {
    const profiles = await indexedDBManager.getAllItems<EQProfileWithDefault>(indexedDBManager.STORES.EQ_PROFILES);
    const profilesMap: Record<string, EQProfileWithDefault> = {};
    profiles.forEach(profile => {
      profilesMap[profile.id] = profile;
    });
    return profilesMap;
  } catch (error) {
    console.error('Error loading EQ profiles from storage:', error);
    return {};
  }
};

// Helper to load EQ enabled state from storage
const loadEQEnabledState = async (): Promise<boolean> => {
  try {
    const state = await indexedDBManager.getItem<{enabled: boolean}>(indexedDBManager.STORES.SYNC_STATE, 'eqEnabled');
    return state?.enabled ?? true; // Default to true if not found
  } catch (error) {
    console.error('Error loading EQ enabled state:', error);
    return true; // Default to true on error
  }
};

// Helper to load distortion gain state from storage
const loadDistortionGainState = async (): Promise<number> => {
  try {
    const state = await indexedDBManager.getItem<{gain: number}>(indexedDBManager.STORES.SYNC_STATE, 'distortionGain');
    return state?.gain ?? 1.0; // Default to 1.0 (no reduction) if not found
  } catch (error) {
    console.error('Error loading distortion gain state:', error);
    return 1.0; // Default to 1.0 on error
  }
};

export const useEQProfileStore = create<EQProfileState>((set, get) => {
  // Track initialization state
  let initialized = false;
  let initialLoadPromise: Promise<void> | null = null;
  
  // Define internal initialization function
  const initialize = () => {
    if (initialized || initialLoadPromise) return initialLoadPromise;
    
    // Set loading state
    set({ isLoading: true });
    
    // Load profiles from storage
    initialLoadPromise = Promise.all([
      loadProfilesFromStorage(),
      loadEQEnabledState(),
      loadDistortionGainState()
    ])
      .then(([loadedProfiles, isEQEnabled, distortionGain]) => {
        // Create default flat profile ONLY if no profiles exist at all
        if (Object.keys(loadedProfiles).length === 0) {
          const defaultProfile: EQProfileWithDefault = {
            id: 'default-flat',
            name: 'Flat',
            bands: [],
            volume: 0,
            isDefault: true,
            lastModified: Date.now(),
            syncStatus: 'modified'
          };
          
          loadedProfiles[defaultProfile.id] = defaultProfile;
          
          // Save default profile to IndexedDB
          indexedDBManager.addItem(indexedDBManager.STORES.EQ_PROFILES, defaultProfile)
            .catch(error => console.error('Failed to save default EQ profile:', error));
            
          // Set as active profile
          set({ 
            profiles: loadedProfiles, 
            activeProfileId: defaultProfile.id,
            isEQEnabled,
            distortionGain,
            isLoading: false 
          });
        } else {
          // Profiles exist - find default or use first available
          const defaultProfile = Object.values(loadedProfiles).find(p => p.isDefault);
          const firstProfile = Object.values(loadedProfiles)[0];
          
          set({ 
            profiles: loadedProfiles, 
            activeProfileId: get().activeProfileId || (defaultProfile?.id || firstProfile?.id || null),
            isEQEnabled,
            distortionGain,
            isLoading: false 
          });
        }
        
        initialized = true;
      })
      .catch(error => {
        console.error('Failed to initialize EQ profile store:', error);
        set({ isLoading: false });
      });
    
    return initialLoadPromise;
  };
  
  // Start initialization immediately
  initialize();
  
  return {
    profiles: {},
    activeProfileId: null,
    isLoading: true, // Initially loading
    isEQEnabled: true, // Default to enabled
    distortionGain: 1.0, // Default to no reduction
    
    addProfile: (profile: EQProfileWithDefault) => {
      // Update local state first for immediate UI feedback
      set((state) => ({
        profiles: {
          ...state.profiles,
          [profile.id]: profile
        }
      }));
      
      // Then persist to IndexedDB (fire and forget)
      indexedDBManager.addItem(indexedDBManager.STORES.EQ_PROFILES, profile)
        .catch(error => {
          // Check if this is a constraint error (key already exists)
          if (error.name === 'ConstraintError' || (error.toString && error.toString().includes('Key already exists'))) {
            console.log(`Profile ${profile.id} already exists, updating instead of adding`);
            
            // Update the profile with current timestamp and sync status
            const updatedProfile = {
              ...profile,
              lastModified: Date.now(),
              syncStatus: 'modified' as SyncStatus
            };
            
            // Use updateItem instead
            indexedDBManager.updateItem(indexedDBManager.STORES.EQ_PROFILES, updatedProfile)
              .catch(updateError => console.error('Failed to update existing EQ profile:', updateError));
          } else {
            // Log other types of errors
            console.error('Failed to save EQ profile:', error);
          }
        });
    },
    
    updateProfile: (profileId: string, updates: Partial<EQProfileWithDefault>) => {
      set((state) => {
        const profile = state.profiles[profileId];
        if (!profile) return state;
        
        const updatedProfile = {
          ...profile,
          ...updates,
          lastModified: Date.now(),
          syncStatus: 'modified' as SyncStatus
        };
        
        // Update local state
        const newState = {
          profiles: {
            ...state.profiles,
            [profileId]: updatedProfile
          }
        };
        
        // Persist to IndexedDB
        indexedDBManager.updateItem(indexedDBManager.STORES.EQ_PROFILES, updatedProfile)
          .catch(error => console.error('Failed to update EQ profile:', error));
        
        return newState;
      });
    },
    
    deleteProfile: (profileId: string) => {
      set((state) => {
        const newProfiles = { ...state.profiles };
        delete newProfiles[profileId];
        
        // Reset active profile if it was deleted
        const newActiveProfileId = 
          state.activeProfileId === profileId ? null : state.activeProfileId;
        
        // Delete from IndexedDB
        indexedDBManager.deleteItem(indexedDBManager.STORES.EQ_PROFILES, profileId)
          .catch(error => console.error('Failed to delete EQ profile:', error));
        
        return {
          profiles: newProfiles,
          activeProfileId: newActiveProfileId
        };
      });
    },
    
    setActiveProfile: (profileId: string | null) => {
      set({ activeProfileId: profileId });
    },
    
    setEQEnabled: (enabled: boolean) => {
      set({ isEQEnabled: enabled });
      
      // Persist to IndexedDB
      indexedDBManager.updateItem(indexedDBManager.STORES.SYNC_STATE, {
        id: 'eqEnabled',
        enabled
      }).catch(error => console.error('Failed to save EQ enabled state:', error));
    },
    
    setDistortionGain: (gain: number) => {
      set({ distortionGain: gain });
      
      // Persist to IndexedDB
      indexedDBManager.updateItem(indexedDBManager.STORES.SYNC_STATE, {
        id: 'distortionGain',
        gain
      }).catch(error => console.error('Failed to save distortion gain state:', error));
    },
    
    getProfiles: () => {
      // Ensure profiles are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      return Object.values(get().profiles);
    },
    
    getProfileById: (profileId: string) => {
      // Ensure profiles are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      return get().profiles[profileId];
    },
    
    getActiveProfile: () => {
      // Ensure profiles are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      const { activeProfileId, profiles } = get();
      if (!activeProfileId) return null;
      return profiles[activeProfileId] || null;
    }
  };
}); 