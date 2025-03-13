import { create } from 'zustand';
import { EQProfile } from '../models/EQProfile';

interface EQProfileState {
  profiles: Record<string, EQProfile>;
  activeProfileId: string | null;
  
  // Actions
  addProfile: (profile: EQProfile) => void;
  updateProfile: (profileId: string, updates: Partial<EQProfile>) => void;
  deleteProfile: (profileId: string) => void;
  setActiveProfile: (profileId: string | null) => void;
  getProfiles: () => EQProfile[];
  getProfileById: (profileId: string) => EQProfile | undefined;
  getActiveProfile: () => EQProfile | null;
}

export const useEQProfileStore = create<EQProfileState>((set, get) => ({
  profiles: {},
  activeProfileId: null,
  
  addProfile: (profile: EQProfile) => {
    set((state) => ({
      profiles: {
        ...state.profiles,
        [profile.id]: profile
      }
    }));
  },
  
  updateProfile: (profileId: string, updates: Partial<EQProfile>) => {
    set((state) => {
      const profile = state.profiles[profileId];
      if (!profile) return state;
      
      return {
        profiles: {
          ...state.profiles,
          [profileId]: {
            ...profile,
            ...updates,
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  deleteProfile: (profileId: string) => {
    set((state) => {
      const newProfiles = { ...state.profiles };
      delete newProfiles[profileId];
      
      // Reset active profile if it was deleted
      const newActiveProfileId = 
        state.activeProfileId === profileId ? null : state.activeProfileId;
      
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
    return Object.values(get().profiles);
  },
  
  getProfileById: (profileId: string) => {
    return get().profiles[profileId];
  },
  
  getActiveProfile: () => {
    const { activeProfileId, profiles } = get();
    if (!activeProfileId) return null;
    return profiles[activeProfileId] || null;
  }
})); 