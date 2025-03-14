import { create } from 'zustand';

interface PlayerState {
  currentTrackId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  loadingState: 'idle' | 'loading' | 'decoding' | 'ready' | 'error';
  loadingProgress: number; // 0-100 percentage for tracking file loading
  error: string | null;
  
  // Actions
  setCurrentTrack: (trackId: string | null) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (isMuted: boolean) => void;
  setLoadingState: (state: PlayerState['loadingState']) => void;
  setLoadingProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  resetPlayer: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentTrackId: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  loadingState: 'idle',
  loadingProgress: 0,
  error: null,
  
  setCurrentTrack: (trackId: string | null) => {
    set({ 
      currentTrackId: trackId,
      currentTime: 0,
      duration: 0,
      loadingState: trackId ? 'loading' : 'idle',
      loadingProgress: 0,
      error: null
    });
    
    // Simulate loading process if a track is selected
    if (trackId) {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        set((state) => {
          // Stop updating if we've reached 100% or if state is no longer loading
          if (state.loadingProgress >= 100 || state.loadingState !== 'loading') {
            clearInterval(progressInterval);
            return state;
          }
          return { loadingProgress: 0 };
        });
      }, 50);
      
      // Simulate track loading completion after 0.5 seconds
      setTimeout(() => {
        clearInterval(progressInterval);
        set({ 
          loadingState: 'ready',
          loadingProgress: 0,
          duration: 240 // Set a default duration of 4 minutes
        });
      }, 500);
    }
  },
  
  setIsPlaying: (isPlaying: boolean) => {
    set({ isPlaying });
  },
  
  setCurrentTime: (time: number) => {
    set({ currentTime: time });
  },
  
  setDuration: (duration: number) => {
    set({ duration });
  },
  
  setVolume: (volume: number) => {
    // Ensure volume is between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ volume: clampedVolume });
  },
  
  setIsMuted: (isMuted: boolean) => {
    set({ isMuted });
  },
  
  setLoadingState: (state) => {
    set({ loadingState: state });
  },
  
  setLoadingProgress: (progress: number) => {
    set({ loadingProgress: progress });
  },
  
  setError: (error: string | null) => {
    set({ 
      error,
      loadingState: error ? 'error' : 'idle'
    });
  },
  
  resetPlayer: () => {
    set({
      currentTrackId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      loadingState: 'idle',
      loadingProgress: 0,
      error: null
    });
  }
})); 