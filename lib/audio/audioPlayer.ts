import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import * as audioRouting from './audioRouting';
import * as fileStorage from '../storage/fileStorage';
import * as metadataStorage from '../storage/metadataStorage';
import { useTrackStore } from '../stores';

// Define callback types
type ProgressCallback = (progress: number) => void;
type CompletionCallback = (success: boolean, duration?: number, error?: string) => void;

// Class to manage audio playback
class AudioPlayer {
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private startTime: number = 0;
  private pausedTime: number = 0;
  private isPlaying: boolean = false;
  private progressInterval: number | null = null;
  private timeUpdateCallback: ((time: number) => void) | null = null;
  
  constructor() {
    console.log('🎵 AudioPlayer constructor called');
    this.initialize();
  }
  
  // Initialize the audio player
  private initialize(): void {
    console.log('🎵 AudioPlayer.initialize called');
    
    try {
      // Create a gain node for volume control
      this.gainNode = audioContext.createGain();
      console.log('🎵 Gain node created:', this.gainNode);
      
      // Connect to the EQ processor
      const eqInput = eqProcessor.getEQProcessor().getInputNode();
      console.log('🎵 EQ processor input node:', eqInput);
      this.gainNode.connect(eqInput);
      console.log('🎵 Gain node connected to EQ processor');
      
      // Set up progress tracking
      this.setupProgressTracking();
      
      console.log('🎵 AudioPlayer initialization complete');
    } catch (error) {
      console.error('🎵 Error during AudioPlayer initialization:', error);
    }
  }
  
  // Set up progress tracking interval
  private setupProgressTracking(): void {
    console.log('🎵 AudioPlayer.setupProgressTracking called');
    
    // Clear any existing interval
    if (this.progressInterval) {
      window.clearInterval(this.progressInterval);
      console.log('🎵 Cleared existing progress tracking interval');
    }
    
    // Update current time every 100ms during playback
    this.progressInterval = window.setInterval(() => {
      if (this.isPlaying && this.timeUpdateCallback) {
        const currentTime = this.getCurrentTime();
        this.timeUpdateCallback(currentTime);
      }
    }, 100);
    console.log('🎵 Progress tracking interval set up');
  }
  
  // Set a callback for time updates
  public setTimeUpdateCallback(callback: (time: number) => void): void {
    this.timeUpdateCallback = callback;
  }
  
  // Load a track by storage key
  public async loadTrack(
    storageKey: string, 
    progressCallback?: ProgressCallback,
    completionCallback?: CompletionCallback
  ): Promise<void> {
    console.log('🎵 AudioPlayer.loadTrack called with storageKey:', storageKey);
    
    try {
      // Get audio file from storage
      console.log('🎵 Getting audio file from storage');
      if (progressCallback) progressCallback(10);
      
      const audioFile = await fileStorage.getAudioFile(storageKey);
      console.log('🎵 Audio file retrieved:', audioFile ? 'successfully' : 'failed');
      
      if (!audioFile) {
        console.error('🎵 Audio file not found in storage');
        if (completionCallback) completionCallback(false, undefined, `Audio file not found: ${storageKey}`);
        return;
      }
      
      // Update loading progress
      console.log('🎵 File retrieved, converting to ArrayBuffer');
      if (progressCallback) progressCallback(40);
      
      // Convert Blob to ArrayBuffer
      const arrayBuffer = await audioFile.arrayBuffer();
      console.log('🎵 ArrayBuffer created, size:', arrayBuffer.byteLength);
      if (progressCallback) progressCallback(60);
      
      // Decode audio data
      console.log('🎵 Decoding audio data');
      this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('🎵 Audio buffer created:', this.audioBuffer);
      if (progressCallback) progressCallback(90);
      
      // Reset playback position
      this.pausedTime = 0;
      console.log('🎵 Reset paused time to 0');
      
      // Complete loading
      if (progressCallback) progressCallback(100);
      if (completionCallback) completionCallback(true, this.audioBuffer.duration);
      
      console.log('🎵 Track loaded successfully');
    } catch (error) {
      console.error('🎵 Error loading track:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (completionCallback) completionCallback(false, undefined, errorMessage);
    }
  }
  
  // Play the current track
  public play(): void {
    console.log('🎵 AudioPlayer.play called');
    
    if (!this.audioBuffer) {
      console.log('🎵 Cannot play: No audio buffer available');
      return;
    }
    
    // Resume audio context if suspended
    console.log('🎵 Resuming audio context');
    audioContext.resumeAudioContext().then(() => {
      console.log('🎵 Audio context resumed');
      
      // Stop any existing playback
      if (this.sourceNode) {
        console.log('🎵 Stopping existing source node');
        this.sourceNode.stop();
        this.sourceNode = null;
      }
      
      // Create a new source node
      console.log('🎵 Creating new buffer source node');
      this.sourceNode = audioContext.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;
      console.log('🎵 Source node created with buffer:', this.sourceNode);
      
      // Connect to gain node
      console.log('🎵 Connecting source to gain node');
      this.sourceNode.connect(this.gainNode!);
      
      // Set up ended event
      console.log('🎵 Setting up onended handler');
      this.sourceNode.onended = this.handlePlaybackEnded.bind(this);
      
      // Start playback from paused position
      console.log('🎵 Starting playback from position:', this.pausedTime);
      this.sourceNode.start(0, this.pausedTime);
      this.startTime = audioContext.getCurrentTime() - this.pausedTime;
      console.log('🎵 Playback started, start time:', this.startTime);
      this.isPlaying = true;
    }).catch(error => {
      console.error('🎵 Error resuming audio context:', error);
    });
  }
  
  // Pause the current track
  public pause(): void {
    console.log('🎵 AudioPlayer.pause called');
    
    if (!this.isPlaying || !this.sourceNode) {
      console.log('🎵 Cannot pause: Not playing or no source node');
      return;
    }
    
    // Calculate current position
    this.pausedTime = this.getCurrentTime();
    console.log('🎵 Current position:', this.pausedTime);
    
    // Stop the source node
    console.log('🎵 Stopping source node');
    this.sourceNode.stop();
    this.sourceNode = null;
    this.isPlaying = false;
    
    // Update time through callback
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(this.pausedTime);
    }
    
    console.log('🎵 Playback paused');
  }
  
  // Stop playback completely
  public stop(): void {
    console.log('🎵 AudioPlayer.stop called');
    
    if (this.sourceNode) {
      console.log('🎵 Stopping source node');
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    
    this.isPlaying = false;
    this.pausedTime = 0;
    this.audioBuffer = null;
    console.log('🎵 Reset player state');
    
    // Update time through callback
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(0);
    }
    
    console.log('🎵 Playback stopped completely');
  }
  
  // Seek to a specific time
  public seek(time: number): void {
    console.log('🎵 AudioPlayer.seek called with time:', time);
    
    if (!this.audioBuffer) {
      console.log('🎵 Cannot seek: No audio buffer available');
      return;
    }
    
    // Ensure time is within bounds
    const clampedTime = Math.max(0, Math.min(time, this.audioBuffer.duration));
    console.log('🎵 Clamped time:', clampedTime);
    
    // If playing, stop and restart at new position
    const wasPlaying = this.isPlaying;
    console.log('🎵 Was playing before seek:', wasPlaying);
    
    if (this.isPlaying) {
      console.log('🎵 Stopping current playback for seek');
      this.sourceNode?.stop();
      this.sourceNode = null;
      this.isPlaying = false;
    }
    
    this.pausedTime = clampedTime;
    console.log('🎵 Updated pausedTime to:', this.pausedTime);
    
    // Update time through callback
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(clampedTime);
    }
    
    if (wasPlaying) {
      console.log('🎵 Restarting playback at new position');
      this.play();
    } else {
      console.log('🎵 Not restarting playback (was paused)');
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
    console.log('🎵 AudioPlayer.setVolume called with:', volume);
    
    if (!this.gainNode) {
      console.log('🎵 Cannot set volume: No gain node');
      return;
    }
    
    // Clamp volume between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    // Apply volume
    console.log('🎵 Setting gain node value to:', clampedVolume);
    this.gainNode.gain.value = clampedVolume;
  }
  
  // Set mute state
  public setMute(muted: boolean): void {
    console.log('🎵 AudioPlayer.setMute called with:', muted);
    
    if (!this.gainNode) {
      console.log('🎵 Cannot set mute: No gain node');
      return;
    }
    
    if (muted) {
      // Store current volume in a data attribute for unmuting
      console.log('🎵 Muting: Setting gain to 0');
      this.gainNode.gain.value = 0;
    } else {
      // Get volume from store or use default
      const volume = 1; // Default volume if not provided
      console.log('🎵 Unmuting: Restoring gain to:', volume);
      this.gainNode.gain.value = volume;
    }
  }
  
  // Handle playback ended event
  private handlePlaybackEnded(): void {
    console.log('🎵 AudioPlayer.handlePlaybackEnded called (track finished)');
    
    // Reset state
    this.sourceNode = null;
    this.isPlaying = false;
    this.pausedTime = 0;
    console.log('🎵 Reset playback state');
    
    // Update time through callback
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(0);
    }
  }
}

// Singleton instance
let audioPlayerInstance: AudioPlayer | null = null;

// Get or create the audio player instance
export const getAudioPlayer = (): AudioPlayer => {
  console.log('🎵 getAudioPlayer called, instance exists:', !!audioPlayerInstance);
  
  if (!audioPlayerInstance) {
    console.log('🎵 Creating new AudioPlayer instance');
    audioPlayerInstance = new AudioPlayer();
  }
  
  return audioPlayerInstance;
};

// Initialize the audio player (call this when the app starts)
export const initializeAudioPlayer = (): void => {
  console.log('🎵 initializeAudioPlayer called');
  getAudioPlayer();
};

// Clean up the audio player (call this when the app is unloaded)
export const cleanupAudioPlayer = (): void => {
  console.log('🎵 cleanupAudioPlayer called');
  
  if (audioPlayerInstance) {
    // Stop playback
    console.log('🎵 Stopping playback during cleanup');
    audioPlayerInstance.stop();
    
    // Clear any intervals
    if ((audioPlayerInstance as any).progressInterval) {
      console.log('🎵 Clearing progress interval during cleanup');
      window.clearInterval((audioPlayerInstance as any).progressInterval);
    }
    
    audioPlayerInstance = null;
    console.log('🎵 AudioPlayer instance destroyed');
  }
}; 