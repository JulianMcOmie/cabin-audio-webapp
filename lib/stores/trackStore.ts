import { create } from 'zustand';
import { Track } from '../models/Track';
import * as indexedDBManager from '../storage/indexedDBManager';

interface TrackState {
  tracks: Record<string, Track>;
  currentTrackId: string | null;
  isPlaying: boolean;
  isLoading?: boolean; // Optional for UI to respond to, but not required
  
  // Actions
  addTrack: (track: Track) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  deleteTrack: (trackId: string) => void;
  setCurrentTrack: (trackId: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  getTracks: () => Track[];
  getTrackById: (trackId: string) => Track | undefined;
}

// Helper function to load tracks from IndexedDB
const loadTracksFromStorage = async (): Promise<Record<string, Track>> => {
  try {
    const tracks = await indexedDBManager.getAllItems<Track>(indexedDBManager.STORES.TRACKS);
    const tracksMap: Record<string, Track> = {};
    tracks.forEach(track => {
      tracksMap[track.id] = track;
    });
    return tracksMap;
  } catch (error) {
    console.error('Error loading tracks from storage:', error);
    return {};
  }
};

export const useTrackStore = create<TrackState>((set, get) => {
  // Start loading tracks immediately but don't block initialization
  let initialized = false;
  let initialLoadPromise: Promise<void> | null = null;
  
  // Define internal initialization function
  const initialize = () => {
    if (initialized || initialLoadPromise) return initialLoadPromise;
    
    // Set loading state
    set({ isLoading: true });
    
    // Load tracks from storage
    initialLoadPromise = loadTracksFromStorage()
      .then(loadedTracks => {
        set({ tracks: loadedTracks, isLoading: false });
        initialized = true;
      })
      .catch(error => {
        console.error('Failed to initialize track store:', error);
        set({ isLoading: false });
      });
    
    return initialLoadPromise;
  };
  
  // Start initialization immediately
  initialize();
  
  return {
    tracks: {},
    currentTrackId: null,
    isPlaying: false,
    isLoading: true, // Initially loading
    
    addTrack: (track: Track) => {
      // Update local state first for immediate UI feedback
      set((state) => ({
        tracks: {
          ...state.tracks,
          [track.id]: track
        }
      }));
      
      // Then persist to IndexedDB (fire and forget)
      indexedDBManager.addItem(indexedDBManager.STORES.TRACKS, track)
        .catch(error => console.error('Failed to save track:', error));
    },
    
    updateTrack: (trackId: string, updates: Partial<Track>) => {
      set((state) => {
        const track = state.tracks[trackId];
        if (!track) return state;
        
        const updatedTrack = {
          ...track,
          ...updates,
          lastModified: Date.now(),
          syncStatus: 'modified' as const
        };
        
        // Update local state first
        const newState = {
          tracks: {
            ...state.tracks,
            [trackId]: updatedTrack
          }
        };
        
        // Then persist to IndexedDB (fire and forget)
        indexedDBManager.updateItem(indexedDBManager.STORES.TRACKS, updatedTrack)
          .catch(error => console.error('Failed to update track:', error));
        
        return newState;
      });
    },
    
    deleteTrack: (trackId: string) => {
      set((state) => {
        const newTracks = { ...state.tracks };
        delete newTracks[trackId];
        
        // Reset current track if it was deleted
        const newCurrentTrackId = 
          state.currentTrackId === trackId ? null : state.currentTrackId;
        
        // Delete from IndexedDB (fire and forget)
        indexedDBManager.deleteItem(indexedDBManager.STORES.TRACKS, trackId)
          .catch(error => console.error('Failed to delete track:', error));
        
        return {
          tracks: newTracks,
          currentTrackId: newCurrentTrackId
        };
      });
    },
    
    setCurrentTrack: (trackId: string | null) => {
      set({ currentTrackId: trackId });
    },
    
    setIsPlaying: (playing: boolean) => {
      set({ isPlaying: playing });
    },
    
    getTracks: () => {
      // Ensure tracks are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      return Object.values(get().tracks);
    },
    
    getTrackById: (trackId: string) => {
      // Ensure tracks are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      return get().tracks[trackId];
    }
  };
}); 