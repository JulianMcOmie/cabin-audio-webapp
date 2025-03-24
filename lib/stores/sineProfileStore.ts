import { create } from 'zustand';
import { SineProfile } from '../models/SineProfile';
import { SyncStatus } from '../models/SyncStatus';
import * as indexedDBManager from '../storage/indexedDBManager';
import { v4 as uuidv4 } from 'uuid';

// Extend SineProfile for our internal use, adding isDefault property
interface SineProfileWithDefault extends SineProfile {
  isDefault?: boolean;
}

interface SineProfileState {
  profiles: Record<string, SineProfileWithDefault>;
  activeProfileId: string | null;
  isLoading: boolean;
  isSineEQEnabled: boolean;
  
  // Actions
  addProfile: (profile: SineProfileWithDefault) => void;
  updateProfile: (profileId: string, updates: Partial<SineProfileWithDefault>) => void;
  deleteProfile: (profileId: string) => void;
  setActiveProfile: (profileId: string | null) => void;
  setSineEQEnabled: (enabled: boolean) => void;
  getProfiles: () => SineProfileWithDefault[];
  getProfileById: (profileId: string) => SineProfileWithDefault | undefined;
  getActiveProfile: () => SineProfileWithDefault | null;
  createNewProfile: (name: string) => string;
}

// Helper function to load profiles from IndexedDB
const loadProfilesFromStorage = async (): Promise<Record<string, SineProfileWithDefault>> => {
  try {
    const profiles = await indexedDBManager.getAllItems<SineProfileWithDefault>(indexedDBManager.STORES.SINE_PROFILES);
    const profilesMap: Record<string, SineProfileWithDefault> = {};
    profiles.forEach(profile => {
      profilesMap[profile.id] = profile;
    });
    return profilesMap;
  } catch (error) {
    console.error('Error loading Sine EQ profiles from storage:', error);
    return {};
  }
};

// Helper to load Sine EQ enabled state from storage
const loadSineEQEnabledState = async (): Promise<boolean> => {
  try {
    const state = await indexedDBManager.getItem<{enabled: boolean}>(indexedDBManager.STORES.SYNC_STATE, 'sineEQEnabled');
    return state?.enabled ?? true; // Default to true if not found
  } catch (error) {
    console.error('Error loading Sine EQ enabled state:', error);
    return true; // Default to true on error
  }
};

export const useSineProfileStore = create<SineProfileState>((set, get) => {
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
      loadSineEQEnabledState()
    ])
      .then(([loadedProfiles, isSineEQEnabled]) => {
        // Create default flat profile ONLY if no profiles exist at all
        if (Object.keys(loadedProfiles).length === 0) {
          const defaultProfile: SineProfileWithDefault = {
            id: 'default-flat',
            name: 'Flat',
            points: [],
            isDefault: true,
            lastModified: Date.now(),
            syncStatus: 'modified'
          };
          
          loadedProfiles[defaultProfile.id] = defaultProfile;
          
          // Save default profile to IndexedDB
          indexedDBManager.addItem(indexedDBManager.STORES.SINE_PROFILES, defaultProfile)
            .catch(error => console.error('Failed to save default Sine EQ profile:', error));
            
          // Set as active profile
          set({ 
            profiles: loadedProfiles, 
            activeProfileId: defaultProfile.id,
            isSineEQEnabled,
            isLoading: false 
          });
        } else {
          // Profiles exist - find default or use first available
          const defaultProfile = Object.values(loadedProfiles).find(p => p.isDefault);
          const firstProfile = Object.values(loadedProfiles)[0];
          
          // Ensure all profiles have a valid points array
          Object.values(loadedProfiles).forEach(profile => {
            if (!profile.points) {
              profile.points = [];
            }
          });
          
          set({ 
            profiles: loadedProfiles, 
            activeProfileId: get().activeProfileId || (defaultProfile?.id || firstProfile?.id || null),
            isSineEQEnabled,
            isLoading: false 
          });
        }
        
        initialized = true;
      })
      .catch(error => {
        console.error('Failed to initialize Sine EQ profile store:', error);
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
    isSineEQEnabled: true, // Default to enabled
    
    addProfile: (profile: SineProfileWithDefault) => {
      // Ensure profile has a valid points array
      if (!profile.points) {
        profile.points = [];
      }
      
      // Update local state first for immediate UI feedback
      set((state) => ({
        profiles: {
          ...state.profiles,
          [profile.id]: profile
        }
      }));
      
      // Then persist to IndexedDB (fire and forget)
      indexedDBManager.addItem(indexedDBManager.STORES.SINE_PROFILES, profile)
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
            
            // Ensure points array exists
            if (!updatedProfile.points) {
              updatedProfile.points = [];
            }
            
            // Use updateItem instead
            indexedDBManager.updateItem(indexedDBManager.STORES.SINE_PROFILES, updatedProfile)
              .catch(updateError => console.error('Failed to update existing Sine EQ profile:', updateError));
          } else {
            // Log other types of errors
            console.error('Failed to save Sine EQ profile:', error);
          }
        });
    },
    
    updateProfile: (profileId: string, updates: Partial<SineProfileWithDefault>) => {
      set((state) => {
        const profile = state.profiles[profileId];
        if (!profile) return state;
        
        const updatedProfile = {
          ...profile,
          ...updates,
          lastModified: Date.now(),
          syncStatus: 'modified' as SyncStatus
        };
        
        // Ensure points array is valid
        if (!updatedProfile.points) {
          updatedProfile.points = [];
        }
        
        // Update local state
        const newState = {
          profiles: {
            ...state.profiles,
            [profileId]: updatedProfile
          }
        };
        
        // Persist to IndexedDB
        indexedDBManager.updateItem(indexedDBManager.STORES.SINE_PROFILES, updatedProfile)
          .catch(error => console.error('Failed to update Sine EQ profile:', error));
        
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
        indexedDBManager.deleteItem(indexedDBManager.STORES.SINE_PROFILES, profileId)
          .catch(error => console.error('Failed to delete Sine EQ profile:', error));
        
        return {
          profiles: newProfiles,
          activeProfileId: newActiveProfileId
        };
      });
    },
    
    setActiveProfile: (profileId: string | null) => {
      set({ activeProfileId: profileId });
    },
    
    setSineEQEnabled: (enabled: boolean) => {
      set({ isSineEQEnabled: enabled });
      
      // Persist to IndexedDB
      indexedDBManager.updateItem(indexedDBManager.STORES.SYNC_STATE, {
        id: 'sineEQEnabled',
        enabled
      }).catch(error => console.error('Failed to save Sine EQ enabled state:', error));
    },
    
    createNewProfile: (name: string) => {
      const id = uuidv4();
      const newProfile: SineProfileWithDefault = {
        id,
        name,
        points: [],
        lastModified: Date.now(),
        syncStatus: 'modified'
      };
      
      get().addProfile(newProfile);
      get().setActiveProfile(id);
      
      return id;
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