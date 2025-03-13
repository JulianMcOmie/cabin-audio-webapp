import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import * as audioRouting from './audioRouting';
import * as fileStorage from '../storage/fileStorage';
import * as metadataStorage from '../storage/metadataStorage';
import { usePlayerStore, useTrackStore } from '../stores';

// Class to manage audio playback
class AudioPlayer {
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private startTime: number = 0;
  private pausedTime: number = 0;
  private isPlaying: boolean = false;
  private currentTrackId: string | null = null;
  private progressInterval: number | null = null;
  
  constructor() {
    this.initialize();
  }
  
  // Initialize the audio player
  private initialize(): void {
    // Create a gain node for volume control
    this.gainNode = audioContext.createGain();
    
    // Connect to the EQ processor
    this.gainNode.connect(eqProcessor.getEQProcessor().getInputNode());
    
    // Set up progress tracking
    this.setupProgressTracking();
    
    // Subscribe to player store changes
    this.subscribeToStoreChanges();
  }
  
  // Subscribe to store changes to react to UI actions
  private subscribeToStoreChanges(): void {
    usePlayerStore.subscribe((state) => {
      // Handle play/pause state changes
      if (state.isPlaying !== this.isPlaying) {
        if (state.isPlaying) {
          this.play();
        } else {
          this.pause();
        }
      }
      
      // Handle track changes
      if (state.currentTrackId !== this.currentTrackId) {
        if (state.currentTrackId) {
          this.loadTrack(state.currentTrackId);
        } else {
          this.stop();
        }
      }
      
      // Handle volume changes
      if (this.gainNode && state.volume !== this.gainNode.gain.value) {
        this.setVolume(state.volume);
      }
      
      // Handle mute state
      if (this.gainNode) {
        const currentMuted = this.gainNode.gain.value === 0;
        if (state.isMuted !== currentMuted) {
          this.setMute(state.isMuted);
        }
      }
    });
  }
  
  // Set up progress tracking interval
  private setupProgressTracking(): void {
    // Clear any existing interval
    if (this.progressInterval) {
      window.clearInterval(this.progressInterval);
    }
    
    // Update current time every 100ms during playback
    this.progressInterval = window.setInterval(() => {
      if (this.isPlaying) {
        const currentTime = this.getCurrentTime();
        usePlayerStore.getState().setCurrentTime(currentTime);
      }
    }, 100);
  }
  
  // Load a track by ID
  public async loadTrack(trackId: string): Promise<void> {
    try {
      // Update state to loading
      usePlayerStore.getState().setLoadingState('loading');
      
      // Get track from store
      const track = useTrackStore.getState().getTrackById(trackId);
      if (!track) {
        throw new Error(`Track with ID ${trackId} not found`);
      }
      
      // Update current track ID
      this.currentTrackId = trackId;
      
      // Get audio file from storage
      const audioFile = await fileStorage.getAudioFile(track.storageKey);
      if (!audioFile) {
        throw new Error(`Audio file for track ${trackId} not found`);
      }
      
      // Update loading progress
      usePlayerStore.getState().setLoadingProgress(50);
      
      // Convert Blob to ArrayBuffer
      const arrayBuffer = await audioFile.arrayBuffer();
      
      // Update loading state to decoding
      usePlayerStore.getState().setLoadingState('decoding');
      
      // Decode audio data
      this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Update track duration if needed
      if (track.duration === 0 && this.audioBuffer) {
        await metadataStorage.updateTrackDuration(trackId, this.audioBuffer.duration);
      }
      
      // Update player state
      usePlayerStore.getState().setDuration(this.audioBuffer.duration);
      usePlayerStore.getState().setLoadingState('ready');
      usePlayerStore.getState().setLoadingProgress(100);
      
      // Reset playback position
      this.pausedTime = 0;
      usePlayerStore.getState().setCurrentTime(0);
      
      // If player was playing, start the new track
      if (usePlayerStore.getState().isPlaying) {
        this.play();
      }
    } catch (error) {
      console.error('Error loading track:', error);
      usePlayerStore.getState().setError(`Failed to load track: ${error.message}`);
    }
  }
  
  // Play the current track
  public play(): void {
    if (!this.audioBuffer) {
      return;
    }
    
    // Resume audio context if suspended
    audioContext.resumeAudioContext().then(() => {
      // Stop any existing playback
      if (this.sourceNode) {
        this.sourceNode.stop();
        this.sourceNode = null;
      }
      
      // Create a new source node
      this.sourceNode = audioContext.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;
      
      // Connect to gain node
      this.sourceNode.connect(this.gainNode!);
      
      // Set up ended event
      this.sourceNode.onended = this.handlePlaybackEnded.bind(this);
      
      // Start playback from paused position
      this.sourceNode.start(0, this.pausedTime);
      this.startTime = audioContext.getCurrentTime() - this.pausedTime;
      this.isPlaying = true;
      
      // Update player state
      usePlayerStore.getState().setIsPlaying(true);
    });
  }
  
  // Pause the current track
  public pause(): void {
    if (!this.isPlaying || !this.sourceNode) {
      return;
    }
    
    // Calculate current position
    this.pausedTime = this.getCurrentTime();
    
    // Stop the source node
    this.sourceNode.stop();
    this.sourceNode = null;
    this.isPlaying = false;
    
    // Update player state
    usePlayerStore.getState().setIsPlaying(false);
    usePlayerStore.getState().setCurrentTime(this.pausedTime);
  }
  
  // Stop playback completely
  public stop(): void {
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    
    this.isPlaying = false;
    this.pausedTime = 0;
    this.currentTrackId = null;
    this.audioBuffer = null;
    
    // Update player state
    usePlayerStore.getState().setIsPlaying(false);
    usePlayerStore.getState().setCurrentTime(0);
  }
  
  // Seek to a specific time
  public seek(time: number): void {
    if (!this.audioBuffer) {
      return;
    }
    
    // Ensure time is within bounds
    const clampedTime = Math.max(0, Math.min(time, this.audioBuffer.duration));
    
    // If playing, stop and restart at new position
    const wasPlaying = this.isPlaying;
    
    if (this.isPlaying) {
      this.sourceNode?.stop();
      this.sourceNode = null;
      this.isPlaying = false;
    }
    
    this.pausedTime = clampedTime;
    usePlayerStore.getState().setCurrentTime(clampedTime);
    
    if (wasPlaying) {
      this.play();
    }
  }
  
  // Get current playback time
  public getCurrentTime(): number {
    if (!this.isPlaying) {
      return this.pausedTime;
    }
    
    return audioContext.getCurrentTime() - this.startTime;
  }
  
  // Set volume (0-1)
  public setVolume(volume: number): void {
    if (!this.gainNode) {
      return;
    }
    
    // Clamp volume between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    // Apply volume
    this.gainNode.gain.value = clampedVolume;
    
    // Update store if needed
    if (usePlayerStore.getState().volume !== clampedVolume) {
      usePlayerStore.getState().setVolume(clampedVolume);
    }
  }
  
  // Set mute state
  public setMute(muted: boolean): void {
    if (!this.gainNode) {
      return;
    }
    
    if (muted) {
      // Store current volume in a data attribute for unmuting
      this.gainNode.gain.value = 0;
    } else {
      // Restore volume
      this.gainNode.gain.value = usePlayerStore.getState().volume;
    }
    
    // Update store if needed
    if (usePlayerStore.getState().isMuted !== muted) {
      usePlayerStore.getState().setIsMuted(muted);
    }
  }
  
  // Handle playback ended event
  private handlePlaybackEnded(): void {
    // Reset state
    this.sourceNode = null;
    this.isPlaying = false;
    this.pausedTime = 0;
    
    // Update player state
    usePlayerStore.getState().setIsPlaying(false);
    usePlayerStore.getState().setCurrentTime(0);
    
    // TODO: Implement queue functionality to play next track
  }
}

// Singleton instance
let audioPlayerInstance: AudioPlayer | null = null;

// Get or create the audio player instance
export const getAudioPlayer = (): AudioPlayer => {
  if (!audioPlayerInstance) {
    audioPlayerInstance = new AudioPlayer();
  }
  
  return audioPlayerInstance;
};

// Initialize the audio player (call this when the app starts)
export const initializeAudioPlayer = (): void => {
  getAudioPlayer();
};

// Clean up the audio player (call this when the app is unloaded)
export const cleanupAudioPlayer = (): void => {
  if (audioPlayerInstance) {
    // Stop playback
    audioPlayerInstance.stop();
    
    // Clear any intervals
    if ((audioPlayerInstance as any).progressInterval) {
      window.clearInterval((audioPlayerInstance as any).progressInterval);
    }
    
    audioPlayerInstance = null;
  }
}; 