import { create } from 'zustand';
import { useTrackStore } from './trackStore';
import { getAudioPlayer } from '../audio/initAudio';

// We don't import audioPlayer here as it already imports and subscribes to this store
// This prevents circular dependencies
const LAST_PLAYED_TRACK_STORAGE_KEY = 'cabin:lastPlayedTrackId';

const persistLastPlayedTrackId = (trackId: string | null) => {
  if (typeof window === 'undefined') return;

  try {
    if (trackId) {
      window.localStorage.setItem(LAST_PLAYED_TRACK_STORAGE_KEY, trackId);
    }
  } catch {
    // ignore storage errors
  }
};

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
  setCurrentTrack: (trackId: string | null, autoPlay?: boolean) => void;
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

  setCurrentTrack: (trackId: string | null, autoPlay = true) => {
    persistLastPlayedTrackId(trackId);

    const shouldAutoPlay = autoPlay;

    // Update state first (immediate UI feedback)
    set({
      currentTrackId: trackId,
      currentTime: 0, // Reset position when changing tracks
      loadingState: trackId ? 'loading' : 'idle',
      loadingProgress: 0,
      error: null
    });

    if (trackId) {
      // Get track from track store
      const track = useTrackStore.getState().getTrackById(trackId);

      if (!track) {
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
        audioPlayer.setTimeUpdateCallback((time) => {
          set({ currentTime: time });
        });

        // Set up track end callback
        audioPlayer.setTrackEndCallback(() => {
          // Track finished playing naturally
          set({
            isPlaying: false,
            currentTime: 0 // Reset position on natural track end
          });
        });

        // Update loading state
        set({ loadingState: 'loading', loadingProgress: 0 });

        // Set up loading progress handler
        const progressHandler = (progress: number) => {
          set({ loadingProgress: progress });
        };

        // Set up completion handler
        const completionHandler = (success: boolean, duration?: number, error?: string) => {
          if (success && duration) {
            set({
              loadingState: 'ready',
              loadingProgress: 100,
              duration: duration,
              error: null
            });

            // Auto-play once track is loaded and ready
            if (shouldAutoPlay) {
              set({ isPlaying: true });
              audioPlayer.play(0); // Start from the beginning with new track
            }
          } else {
            set({
              loadingState: 'error',
              error: error || 'Unknown error loading track'
            });
          }
        };

        // Load the track
        audioPlayer.loadTrack(track.storageKey, progressHandler, completionHandler);
      } catch (error) {
        console.error('Error accessing audio player:', error);
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
      } catch {
        // ignore
      }
    }
  },

  setIsPlaying: (isPlaying: boolean) => {
    // Validate we can change state
    if (isPlaying && !get().currentTrackId) {
      return;
    }

    if (get().loadingState !== 'ready' && isPlaying) {
      return;
    }

    // If already in the desired state, do nothing
    if (get().isPlaying === isPlaying) {
      return;
    }

    // Get the current position and duration before making any state changes
    const currentPosition = get().currentTime;
    const duration = get().duration;

    // Check if track is at the end when trying to play
    if (isPlaying && duration > 0 && currentPosition >= duration - 0.5) {
      // If trying to play a completed track, reset to beginning
      set({ currentTime: 0 });

      // Update state first - but only the isPlaying flag
      set({ isPlaying });

      // Then control audio player
      try {
        const audioPlayer = getAudioPlayer();
        audioPlayer.play(0); // Play from beginning
      } catch (error) {
        console.error('Error controlling playback:', error);
        set({
          isPlaying: false,
          error: 'Playback control failed. Try refreshing the page.'
        });
      }

      return;
    }

    // Update state first - but only the isPlaying flag,
    // don't touch the currentTime to preserve position
    set({ isPlaying });

    // Then control audio player
    try {
      const audioPlayer = getAudioPlayer();
      if (isPlaying) {
        // Always explicitly provide the position to play from
        audioPlayer.play(currentPosition);
      } else {
        audioPlayer.pause();
      }
    } catch (error) {
      console.error('Error controlling playback:', error);
      set({
        isPlaying: false,
        error: 'Playback control failed. Try refreshing the page.'
      });
    }
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

    // Update state first (store the linear slider value)
    set({ volume: clampedVolume });

    // Linear dB scale: 100% = 0 dB, ~0% = -60 dB, 0% = silence
    // Convert dB to amplitude for the gain node
    const gain = clampedVolume === 0 ? 0 : Math.pow(10, (-60 + clampedVolume * 60) / 20);

    // Then control audio player with the gain
    try {
      const audioPlayer = getAudioPlayer();
      audioPlayer.setVolume(gain);
    } catch {
      // ignore
    }
  },

  setIsMuted: (isMuted: boolean) => {
    // Update state first
    set({ isMuted });

    // Then control audio player (apply same dB-to-gain curve for unmute restore)
    try {
      const audioPlayer = getAudioPlayer();
      const currentVolume = get().volume;
      const gain = currentVolume === 0 ? 0 : Math.pow(10, (-60 + currentVolume * 60) / 20);
      audioPlayer.setMute(isMuted, gain);
    } catch {
      // ignore
    }
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
      audioPlayer.stop();
    } catch {
      // ignore
    }
  },

  seekTo: (time: number) => {
    // Validate we can seek
    if (get().loadingState !== 'ready') {
      return;
    }

    // Update state first (for immediate UI feedback)
    set({ currentTime: time });

    // Then control audio player
    try {
      const audioPlayer = getAudioPlayer();
      audioPlayer.seek(time);
    } catch {
      // ignore
    }
  }
}));
