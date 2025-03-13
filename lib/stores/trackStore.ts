import { create } from 'zustand';
import { Track } from '../models/Track';

interface TrackState {
  tracks: Record<string, Track>;
  currentTrackId: string | null;
  isPlaying: boolean;
  
  // Actions
  addTrack: (track: Track) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  deleteTrack: (trackId: string) => void;
  setCurrentTrack: (trackId: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  getTracks: () => Track[];
  getTrackById: (trackId: string) => Track | undefined;
}

export const useTrackStore = create<TrackState>((set, get) => ({
  tracks: {},
  currentTrackId: null,
  isPlaying: false,
  
  addTrack: (track: Track) => {
    set((state) => ({
      tracks: {
        ...state.tracks,
        [track.id]: track
      }
    }));
  },
  
  updateTrack: (trackId: string, updates: Partial<Track>) => {
    set((state) => {
      const track = state.tracks[trackId];
      if (!track) return state;
      
      return {
        tracks: {
          ...state.tracks,
          [trackId]: {
            ...track,
            ...updates,
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  deleteTrack: (trackId: string) => {
    set((state) => {
      const newTracks = { ...state.tracks };
      delete newTracks[trackId];
      
      // Reset current track if it was deleted
      const newCurrentTrackId = 
        state.currentTrackId === trackId ? null : state.currentTrackId;
      
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
    return Object.values(get().tracks);
  },
  
  getTrackById: (trackId: string) => {
    return get().tracks[trackId];
  }
})); 