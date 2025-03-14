import { useCallback, useEffect, useState } from 'react';
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
  
  const getTrackById = useTrackStore(state => state.getTrackById)
  const getTracks = useTrackStore(state => state.getTracks)
  
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
  
  // Set play/pause state
  const setPlayState = useCallback((playing: boolean) => {
    if (currentTrackId) {
      setIsPlaying(playing);
    }
  }, [currentTrackId, setIsPlaying]);
  
  // Navigate to next track
  const next = useCallback(() => {
    if (!currentTrackId) return;
    
    const tracks = getTracks();
    if (!tracks || tracks.length === 0) return;
    
    // Find current track index
    const currentIndex = tracks.findIndex(track => track.id === currentTrackId);
    if (currentIndex === -1) return;
    
    // Get next track (or loop to first)
    const nextIndex = (currentIndex + 1) % tracks.length;
    const nextTrack = tracks[nextIndex];
    
    // Play next track
    setCurrentTrack(nextTrack.id);
    setIsPlaying(true);
  }, [currentTrackId, getTracks, setCurrentTrack, setIsPlaying]);
  
  // Navigate to previous track
  const previous = useCallback(() => {
    if (!currentTrackId) return;
    
    const tracks = getTracks();
    if (!tracks || tracks.length === 0) return;
    
    // Find current track index
    const currentIndex = tracks.findIndex(track => track.id === currentTrackId);
    if (currentIndex === -1) return;
    
    // Get previous track (or loop to last)
    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    const prevTrack = tracks[prevIndex];
    
    // Play previous track
    setCurrentTrack(prevTrack.id);
    setIsPlaying(true);
  }, [currentTrackId, getTracks, setCurrentTrack, setIsPlaying]);
  
  // Seek to a specific time
  const seekTo = useCallback((time: number) => {
    if (currentTrackId) {
      audioPlayer.getAudioPlayer().seek(time);
    }
  }, [currentTrackId]);
  
  // Set volume
  const setPlayerVolume = useCallback((newVolume: number) => {
    setVolume(newVolume);
  }, [setVolume]);
  
  // Set mute state
  const setMuteState = useCallback((muted: boolean) => {
    setIsMuted(muted);
  }, [setIsMuted]);
  
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
  
  // Check if player is in a loading state
  const isLoading = loadingState === 'loading' || loadingState === 'decoding';
  
  // Clear player error
  const clearError = useCallback(() => {
    // This assumes playerStore has a clearError method
    // If not available, this would need to be implemented in the store
    // if (usePlayerStore.getState().clearError) {
    //   usePlayerStore.getState().clearError();
    // }
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
    isLoading,
    
    // Actions
    playTrack,
    setPlayState,
    resetPlayer,
    seekTo,
    seek: seekTo, // Alias for backward compatibility
    next,
    previous,
    setVolume: setPlayerVolume,
    setMuteState,
    clearError,
    
    // Utilities
    getCoverArtUrl,
    formatTime
  };
}; 