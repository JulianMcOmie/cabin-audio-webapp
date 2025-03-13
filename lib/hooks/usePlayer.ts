import { useCallback, useEffect } from 'react';
import { usePlayerStore, useTrackStore } from '../stores';
import * as audioPlayer from '../audio/audioPlayer';
import * as fileStorage from '../storage/fileStorage';

// Hook for player controls
export const usePlayer = () => {
  const {
    currentTrackId,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    loadingState,
    loadingProgress,
    error,
    setCurrentTrack,
    setIsPlaying,
    setVolume,
    setIsMuted,
    resetPlayer
  } = usePlayerStore();
  
  const { getTrackById } = useTrackStore.getState();
  
  // Initialize player on mount
  useEffect(() => {
    audioPlayer.initializeAudioPlayer();
    
    // Clean up on unmount
    return () => {
      audioPlayer.cleanupAudioPlayer();
    };
  }, []);
  
  // Play a track by ID
  const playTrack = useCallback((trackId: string) => {
    // If already playing this track, just toggle play/pause
    if (currentTrackId === trackId) {
      setIsPlaying(!isPlaying);
      return;
    }
    
    // Otherwise, set the new track and start playing
    setCurrentTrack(trackId);
    setIsPlaying(true);
  }, [currentTrackId, isPlaying, setCurrentTrack, setIsPlaying]);
  
  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (currentTrackId) {
      setIsPlaying(!isPlaying);
    }
  }, [currentTrackId, isPlaying, setIsPlaying]);
  
  // Stop playback
  const stop = useCallback(() => {
    resetPlayer();
  }, [resetPlayer]);
  
  // Seek to a specific time
  const seek = useCallback((time: number) => {
    if (currentTrackId) {
      audioPlayer.getAudioPlayer().seek(time);
    }
  }, [currentTrackId]);
  
  // Set volume
  const setPlayerVolume = useCallback((newVolume: number) => {
    setVolume(newVolume);
  }, [setVolume]);
  
  // Toggle mute
  const toggleMute = useCallback(() => {
    setIsMuted(!isMuted);
  }, [isMuted, setIsMuted]);
  
  // Get current track info
  const currentTrack = currentTrackId ? getTrackById(currentTrackId) : null;
  
  // Get cover art URL
  const getCoverArtUrl = useCallback(async (trackId: string) => {
    const track = getTrackById(trackId);
    if (track && track.coverStorageKey) {
      try {
        return await fileStorage.getImageFileUrl(track.coverStorageKey);
      } catch (error) {
        console.error('Error getting cover art URL:', error);
        return null;
      }
    }
    return null;
  }, [getTrackById]);
  
  // Format time (seconds to MM:SS)
  const formatTime = useCallback((timeInSeconds: number) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);
  
  return {
    // State
    currentTrackId,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    loadingState,
    loadingProgress,
    error,
    
    // Actions
    playTrack,
    togglePlayPause,
    stop,
    seek,
    setVolume: setPlayerVolume,
    toggleMute,
    
    // Utilities
    getCoverArtUrl,
    formatTime
  };
}; 