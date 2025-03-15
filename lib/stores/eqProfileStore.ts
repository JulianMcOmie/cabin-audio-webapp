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
  
  // Actions
  addProfile: (profile: EQProfileWithDefault) => void;
  updateProfile: (profileId: string, updates: Partial<EQProfileWithDefault>) => void;
  deleteProfile: (profileId: string) => void;
  setActiveProfile: (profileId: string | null) => void;
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
    initialLoadPromise = loadProfilesFromStorage()
      .then(loadedProfiles => {
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
            isLoading: false 
          });
        } else {
          // Profiles exist - find default or use first available
          const defaultProfile = Object.values(loadedProfiles).find(p => p.isDefault);
          const firstProfile = Object.values(loadedProfiles)[0];
          
          set({ 
            profiles: loadedProfiles, 
            activeProfileId: get().activeProfileId || (defaultProfile?.id || firstProfile?.id || null),
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
        .catch(error => console.error('Failed to save EQ profile:', error));
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