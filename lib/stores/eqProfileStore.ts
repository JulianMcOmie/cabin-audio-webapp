import { create } from 'zustand';
import { EQProfile } from '../models/EQProfile';
import { SyncStatus } from '../models/SyncStatus';
import * as indexedDBManager from '../storage/indexedDBManager';

export const PROFILE_IDS = ['profile-1', 'profile-2', 'profile-3'] as const;

// Per-profile accent colors along the blue → cyan → green gradient
export const PROFILE_COLORS = {
  'profile-1': {
    // Electric blue (#5577ff)
    text: 'text-blue-400',
    textBright: 'text-blue-300',
    bg: 'bg-blue-400/30',
    bgSubtle: 'bg-blue-400/10',
    ring: 'ring-blue-400/40',
    border: 'border-blue-400/50',
    bgPanel: 'dark:bg-blue-400/10 bg-blue-500/10',
    ringPanel: 'dark:ring-blue-400/20 ring-blue-500/20',
    label: 'dark:text-blue-400 text-blue-600',
    hoverText: 'hover:text-blue-300',
    // Play button / transport accent
    playText: 'dark:text-blue-300 text-blue-600',
    playBg: 'dark:bg-blue-400/10 bg-blue-500/10',
    playGlow: 'dark:bg-blue-400/30 bg-blue-500/25',
    // Slider accent
    sliderRange: 'bg-blue-400',
    sliderThumbBorder: 'border-blue-400/50',
  },
  'profile-2': {
    // Cyan (#00ffff)
    text: 'text-cyan-400',
    textBright: 'text-cyan-300',
    bg: 'bg-cyan-400/30',
    bgSubtle: 'bg-cyan-400/10',
    ring: 'ring-cyan-400/40',
    border: 'border-cyan-400/50',
    bgPanel: 'dark:bg-cyan-400/10 bg-cyan-500/10',
    ringPanel: 'dark:ring-cyan-400/20 ring-cyan-500/20',
    label: 'dark:text-cyan-400 text-cyan-600',
    hoverText: 'hover:text-cyan-300',
    playText: 'dark:text-cyan-300 text-cyan-600',
    playBg: 'dark:bg-cyan-400/10 bg-cyan-500/10',
    playGlow: 'dark:bg-cyan-400/30 bg-cyan-500/25',
    sliderRange: 'bg-cyan-400',
    sliderThumbBorder: 'border-cyan-400/50',
  },
  'profile-3': {
    // Emerald-green (#55ffaa)
    text: 'text-emerald-400',
    textBright: 'text-emerald-300',
    bg: 'bg-emerald-400/30',
    bgSubtle: 'bg-emerald-400/10',
    ring: 'ring-emerald-400/40',
    border: 'border-emerald-400/50',
    bgPanel: 'dark:bg-emerald-400/10 bg-emerald-500/10',
    ringPanel: 'dark:ring-emerald-400/20 ring-emerald-500/20',
    label: 'dark:text-emerald-400 text-emerald-600',
    hoverText: 'hover:text-emerald-300',
    playText: 'dark:text-emerald-300 text-emerald-600',
    playBg: 'dark:bg-emerald-400/10 bg-emerald-500/10',
    playGlow: 'dark:bg-emerald-400/30 bg-emerald-500/25',
    sliderRange: 'bg-emerald-400',
    sliderThumbBorder: 'border-emerald-400/50',
  },
} as const;

// Extend EQProfile for our internal use, adding isDefault property
interface EQProfileWithDefault extends EQProfile {
  isDefault?: boolean;
  dateCreated?: number;
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
    return state?.enabled ?? false; // Default to false if not found
  } catch (error) {
    console.error('Error loading EQ enabled state:', error);
    return false; // Default to false on error
  }
};

// Helper to load distortion gain state from storage
const loadDistortionGainState = async (): Promise<number> => {
  try {
    const state = await indexedDBManager.getItem<{gain: number}>(indexedDBManager.STORES.SYNC_STATE, 'distortionGain');
    return state?.gain ?? 0.3; // Default to 0.3 (30%) if not found
  } catch (error) {
    console.error('Error loading distortion gain state:', error);
    return 0.3; // Default to 0.3 on error
  }
};

// Helper to load active profile ID from storage
const loadActiveProfileId = async (): Promise<string | null> => {
  try {
    const state = await indexedDBManager.getItem<{profileId: string}>(indexedDBManager.STORES.SYNC_STATE, 'activeProfileId');
    return state?.profileId ?? null;
  } catch (error) {
    console.error('Error loading active profile ID:', error);
    return null;
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
      loadDistortionGainState(),
      loadActiveProfileId()
    ])
      .then(async ([loadedProfiles, isEQEnabled, distortionGain, savedActiveProfileId]) => {
        const now = Date.now();
        let activeId = savedActiveProfileId;

        // --- Migration: rename old 'default-flat' → 'profile-1' ---
        if (loadedProfiles['default-flat']) {
          const old = loadedProfiles['default-flat'];
          const migrated: EQProfileWithDefault = {
            ...old,
            id: 'profile-1',
            name: 'Profile 1',
            isDefault: true,
            lastModified: now,
            syncStatus: 'modified',
          };
          delete loadedProfiles['default-flat'];
          loadedProfiles['profile-1'] = migrated;

          // Persist: delete old, save new
          await indexedDBManager.deleteItem(indexedDBManager.STORES.EQ_PROFILES, 'default-flat').catch(() => {});
          await indexedDBManager.addItem(indexedDBManager.STORES.EQ_PROFILES, migrated).catch(() => {
            indexedDBManager.updateItem(indexedDBManager.STORES.EQ_PROFILES, migrated).catch(() => {});
          });

          // Fix active pointer
          if (activeId === 'default-flat') activeId = 'profile-1';
        }

        // --- Ensure all 3 profiles exist ---
        for (const pid of PROFILE_IDS) {
          if (!loadedProfiles[pid]) {
            const profile: EQProfileWithDefault = {
              id: pid,
              name: `Profile ${pid.split('-')[1]}`,
              bands: [],
              volume: 0,
              isDefault: pid === 'profile-1',
              lastModified: now,
              dateCreated: now,
              syncStatus: 'modified',
            };
            loadedProfiles[pid] = profile;
            indexedDBManager.addItem(indexedDBManager.STORES.EQ_PROFILES, profile).catch(() => {});
          }
        }

        // Resolve active profile
        if (!activeId || !loadedProfiles[activeId]) {
          activeId = 'profile-1';
        }

        // Set initial state
        set({
          profiles: loadedProfiles,
          activeProfileId: activeId,
          isEQEnabled,
          distortionGain,
          isLoading: false,
        });

        // Persist active profile id
        setTimeout(() => {
          const store = get();
          if (store.setActiveProfile) {
            store.setActiveProfile(activeId!);
          }
        }, 0);
        
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
    isEQEnabled: false, // Default to disabled
    distortionGain: 0.3, // Default to 30% volume reduction
    
    addProfile: (profile: EQProfileWithDefault) => {
      // Ensure dateCreated is set
      if (!profile.dateCreated) {
        profile.dateCreated = Date.now();
      }
      
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
        
        // If active profile was deleted, persist the change to IndexedDB
        if (state.activeProfileId === profileId) {
          indexedDBManager.updateItem(indexedDBManager.STORES.SYNC_STATE, {
            id: 'activeProfileId',
            profileId: null
          }).catch(error => console.error('Failed to update active profile ID after deletion:', error));
        }
        
        return {
          profiles: newProfiles,
          activeProfileId: newActiveProfileId
        };
      });
    },
    
    setActiveProfile: (profileId: string | null) => {
      set({ activeProfileId: profileId });
      
      // Always persist to IndexedDB, even if null (to clear previous value)
      indexedDBManager.updateItem(indexedDBManager.STORES.SYNC_STATE, {
        id: 'activeProfileId',
        profileId: profileId || null
      }).catch(error => console.error('Failed to save active profile ID:', error));
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