import { create } from 'zustand';
import { useTrackStore } from './trackStore';
import { getAudioPlayer } from '../audio/initAudio';

// We don't import audioPlayer here as it already imports and subscribes to this store
// This prevents circular dependencies

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
  seekTo: (time: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
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
    console.log('🔊 playerStore.setCurrentTrack called with:', trackId);
    
    // Update state first (immediate UI feedback)
    set({ 
      currentTrackId: trackId,
      currentTime: 0,
      loadingState: trackId ? 'loading' : 'idle',
      loadingProgress: 0,
      error: null
    });
    
    if (trackId) {
      // Get track from track store
      const track = useTrackStore.getState().getTrackById(trackId);
      console.log('🔊 Track from store:', track);
      
      if (!track) {
        console.log('🔊 Track not found in trackStore');
        set({
          loadingState: 'error',
          error: `Track with ID ${trackId} not found`
        });
        return;
      }
      
      // We have a valid track, get audioPlayer and load the track
      try {
        const audioPlayer = getAudioPlayer();
        
        // Set up time update callback to keep the store in sync with actual playback
        console.log('🔊 Setting time update callback on audioPlayer');
        audioPlayer.setTimeUpdateCallback((time) => {
          console.log('🔊 Time update from audioPlayer:', time);
          set({ currentTime: time });
        });
        
        // Update loading state
        set({ loadingState: 'loading', loadingProgress: 0 });
        
        // Start loading the track - will handle states
        console.log('🔊 Loading track with storage key:', track.storageKey);
        
        // Set up loading progress handler
        const progressHandler = (progress: number) => {
          console.log('🔊 Track loading progress:', progress);
          set({ loadingProgress: progress });
        };
        
        // Set up completion handler
        const completionHandler = (success: boolean, duration?: number, error?: string) => {
          if (success && duration) {
            console.log('🔊 Track loaded successfully, duration:', duration);
            set({ 
              loadingState: 'ready', 
              loadingProgress: 100,
              duration: duration,
              error: null
            });
          } else {
            console.log('🔊 Track loading failed:', error);
            set({ 
              loadingState: 'error',
              error: error || 'Unknown error loading track'
            });
          }
        };
        
        // Load the track
        audioPlayer.loadTrack(track.storageKey, progressHandler, completionHandler);
      } catch (error) {
        console.error('🔊 Error accessing audio player:', error);
        set({ 
          loadingState: 'error',
          error: 'Failed to access audio system. Try refreshing the page.'
        });
      }
    } else {
      // No track ID - stop playback
      try {
        const audioPlayer = getAudioPlayer();
        audioPlayer.stop();
      } catch (error) {
        console.error('🔊 Error stopping playback:', error);
      }
    }
  },
  
  setIsPlaying: (isPlaying: boolean) => {
    console.log('🔊 playerStore.setIsPlaying called with:', isPlaying);
    
    // Validate we can change state
    if (isPlaying && !get().currentTrackId) {
      console.log('🔊 Cannot play: No track selected');
      return;
    }
    
    if (get().loadingState !== 'ready' && isPlaying) {
      console.log('🔊 Cannot play: Track not ready, state:', get().loadingState);
      return;
    }
    
    // If already in the desired state, do nothing
    if (get().isPlaying === isPlaying) {
      console.log('🔊 Already in the requested play state:', isPlaying);
      return;
    }
    
    // Update state first - but only the isPlaying flag, 
    // don't touch the currentTime to preserve position
    set({ isPlaying });
    
    // Then control audio player
    try {
      const audioPlayer = getAudioPlayer();
      if (isPlaying) {
        console.log('🔊 Calling audioPlayer.play() to resume from:', get().currentTime);
        audioPlayer.play();
      } else {
        console.log('🔊 Calling audioPlayer.pause() at position:', get().currentTime);
        audioPlayer.pause();
      }
    } catch (error) {
      console.error('🔊 Error controlling playback:', error);
      set({ 
        isPlaying: false,
        error: 'Playback control failed. Try refreshing the page.'
      });
    }
  },
  
  setCurrentTime: (time: number) => {
    console.log('🔊 playerStore.setCurrentTime called with:', time);
    set({ currentTime: time });
  },
  
  setDuration: (duration: number) => {
    console.log('🔊 playerStore.setDuration called with:', duration);
    set({ duration });
  },
  
  setVolume: (volume: number) => {
    console.log('🔊 playerStore.setVolume called with:', volume);
    
    // Ensure volume is between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    // Update state first
    set({ volume: clampedVolume });
    
    // Then control audio player
    try {
      const audioPlayer = getAudioPlayer();
      console.log('🔊 Calling audioPlayer.setVolume()');
      audioPlayer.setVolume(clampedVolume);
    } catch (error) {
      console.error('🔊 Error setting volume:', error);
    }
    
    console.log('🔊 New volume state:', get().volume);
  },
  
  setIsMuted: (isMuted: boolean) => {
    console.log('🔊 playerStore.setIsMuted called with:', isMuted);
    
    // Update state first
    set({ isMuted });
    
    // Then control audio player
    try {
      const audioPlayer = getAudioPlayer();
      const currentVolume = get().volume;
      console.log('🔊 Calling audioPlayer.setMute() with current volume:', currentVolume);
      audioPlayer.setMute(isMuted, currentVolume);
    } catch (error) {
      console.error('🔊 Error setting mute state:', error);
    }
    
    console.log('🔊 New isMuted state:', get().isMuted);
  },
  
  setLoadingState: (state) => {
    console.log('🔊 playerStore.setLoadingState called with:', state);
    set({ loadingState: state });
    console.log('🔊 New loadingState:', get().loadingState);
  },
  
  setLoadingProgress: (progress: number) => {
    console.log('🔊 playerStore.setLoadingProgress called with:', progress);
    set({ loadingProgress: progress });
  },
  
  setError: (error: string | null) => {
    console.log('🔊 playerStore.setError called with:', error);
    set({ 
      error,
      loadingState: error ? 'error' : 'idle'
    });
    console.log('🔊 New error state:', get().error, 'loadingState:', get().loadingState);
  },
  
  resetPlayer: () => {
    console.log('🔊 playerStore.resetPlayer called');
    
    // Reset state
    set({
      currentTrackId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      loadingState: 'idle',
      loadingProgress: 0,
      error: null
    });
    
    // Stop playback
    try {
      const audioPlayer = getAudioPlayer();
      console.log('🔊 Calling audioPlayer.stop()');
      audioPlayer.stop();
    } catch (error) {
      console.error('🔊 Error stopping playback:', error);
    }
    
    console.log('🔊 Player reset complete');
  },
  
  seekTo: (time: number) => {
    console.log('🔊 playerStore.seekTo called with:', time);
    
    // Validate we can seek
    if (get().loadingState !== 'ready') {
      console.log('🔊 Cannot seek: Track not ready, current state:', get().loadingState);
      return;
    }
    
    // Update state first (for immediate UI feedback)
    set({ currentTime: time });
    
    // Then control audio player
    try {
      const audioPlayer = getAudioPlayer();
      console.log('🔊 Calling audioPlayer.seek()');
      audioPlayer.seek(time);
    } catch (error) {
      console.error('🔊 Error seeking:', error);
    }
  }
})); 