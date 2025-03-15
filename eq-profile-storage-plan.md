# Plan for Integrating EQ Profile Store with IndexedDB

## Overview

This document outlines a plan to integrate the EQ profile store with IndexedDB persistent storage, similar to how the track store is currently implemented. This will ensure that EQ profiles persist between browser sessions and can be synchronized with a backend service in the future.

## Current State

Currently, the `useEQProfileStore` maintains EQ profiles in memory without persistence:
- Profiles are lost when the page is refreshed
- No initialization from stored data
- No synchronization with IndexedDB

## Implementation Plan

### 1. Modify the EQ Profile Store

#### Add Storage Integration
Modify `lib/stores/eqProfileStore.ts` to:
- Add initialization logic that loads profiles from IndexedDB on store creation
- Update store actions to write changes to IndexedDB

#### Add Loading State
- Add an `isLoading` state flag to indicate when profiles are being loaded from storage
- Expose this state through the store API to allow UI to show loading indicators

### 2. Implementation Details

#### Initial Loading

```typescript
// Helper function to load profiles from IndexedDB
const loadProfilesFromStorage = async (): Promise<Record<string, EQProfile>> => {
  try {
    const profiles = await indexedDBManager.getAllItems<EQProfile>(indexedDBManager.STORES.EQ_PROFILES);
    const profilesMap: Record<string, EQProfile> = {};
    profiles.forEach(profile => {
      profilesMap[profile.id] = profile;
    });
    return profilesMap;
  } catch (error) {
    console.error('Error loading EQ profiles from storage:', error);
    return {};
  }
};

// Inside store creation:
let initialized = false;
let initialLoadPromise: Promise<void> | null = null;

const initialize = () => {
  if (initialized || initialLoadPromise) return initialLoadPromise;
  
  set({ isLoading: true });
  
  initialLoadPromise = loadProfilesFromStorage()
    .then(loadedProfiles => {
      set({ profiles: loadedProfiles, isLoading: false });
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
```

#### CRUD Operations

Update each store action to persist changes to IndexedDB:

1. Add Profile:
```typescript
addProfile: (profile: EQProfile) => {
  // Update local state first
  set((state) => ({
    profiles: {
      ...state.profiles,
      [profile.id]: profile
    }
  }));
  
  // Then persist to IndexedDB (fire and forget)
  indexedDBManager.addItem(indexedDBManager.STORES.EQ_PROFILES, profile)
    .catch(error => console.error('Failed to save EQ profile:', error));
}
```

2. Update Profile:
```typescript
updateProfile: (profileId: string, updates: Partial<EQProfile>) => {
  set((state) => {
    const profile = state.profiles[profileId];
    if (!profile) return state;
    
    const updatedProfile = {
      ...profile,
      ...updates,
      lastModified: Date.now(),
      syncStatus: 'modified' as const
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
}
```

3. Delete Profile:
```typescript
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
}
```

4. Update Getter Methods:
```typescript
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
```

### 3. Default Profile Creation

It's critical to create a default "Flat" profile **only when no profiles exist** in IndexedDB. This prevents potential conflicts with existing profiles:

```typescript
const initialize = () => {
  if (initialized || initialLoadPromise) return initialLoadPromise;
  
  set({ isLoading: true });
  
  initialLoadPromise = loadProfilesFromStorage()
    .then(loadedProfiles => {
      // Create default flat profile ONLY if no profiles exist at all
      if (Object.keys(loadedProfiles).length === 0) {
        const defaultProfile: EQProfile = {
          id: 'default-flat',
          name: 'Flat',
          bands: [],
          isDefault: true,
          createdAt: Date.now(),
          lastModified: Date.now(),
          syncStatus: 'local'
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
```

### 4. UI Integration

Update components to handle loading state:
- Add loading indicators in the EQ interface when profiles are being loaded
- Disable interactions when loading
- Handle empty profile state gracefully

### 5. Sync Status Support

When updating profiles, include a `syncStatus` field to track which profiles need to be synced with the backend in the future:
- `'local'` - Only exists locally, needs to be created on backend
- `'synced'` - In sync with backend
- `'modified'` - Modified locally, needs to be updated on backend
- `'deleted'` - Marked for deletion on backend

