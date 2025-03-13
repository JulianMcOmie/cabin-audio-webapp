import { create } from 'zustand';

interface SyncState {
  hasPendingChanges: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  
  // Actions
  setHasPendingChanges: (hasPendingChanges: boolean) => void;
  setIsSyncing: (isSyncing: boolean) => void;
  setLastSyncTime: (time: number) => void;
  startSync: () => void;
  completeSync: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  hasPendingChanges: false,
  isSyncing: false,
  lastSyncTime: null,
  
  setHasPendingChanges: (hasPendingChanges: boolean) => {
    set({ hasPendingChanges });
  },
  
  setIsSyncing: (isSyncing: boolean) => {
    set({ isSyncing });
  },
  
  setLastSyncTime: (time: number) => {
    set({ lastSyncTime: time });
  },
  
  startSync: () => {
    set({ isSyncing: true });
  },
  
  completeSync: () => {
    set({
      isSyncing: false,
      hasPendingChanges: false,
      lastSyncTime: Date.now()
    });
  }
})); 