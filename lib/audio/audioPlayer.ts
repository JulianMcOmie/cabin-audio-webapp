import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import * as fileStorage from '../storage/fileStorage';
import { useEQProfileStore } from '../stores';
import { clamp } from '../utils/audioMath';

// Define callback types
type ProgressCallback = (progress: number) => void;
type CompletionCallback = (success: boolean, duration?: number, error?: string) => void;

// Class to manage audio playback
class AudioPlayer {
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private distortionGainNode: GainNode | null = null;
  private startTime: number = 0;
  private pausedTime: number = 0;
  private isPlaying: boolean = false;
  private progressInterval: number | null = null;
  private timeUpdateCallback: ((time: number) => void) | null = null;
  private trackEndCallback: (() => void) | null = null; // New callback for track end events
  
  constructor() {
    this.initialize();
  }
  
  // Initialize the audio player
  private initialize(): void {
    
    try {
      // Create a gain node for volume control
      this.gainNode = audioContext.createGain();
      
      // Create a distortion gain node for preventing clipping
      this.distortionGainNode = audioContext.createGain();
      this.distortionGainNode.gain.value = 1.0; // Default to no reduction
      
      // Get the EQ processor and connect through it
      const eq = eqProcessor.getEQProcessor();
      
      // Connect nodes: gainNode -> distortionGainNode -> EQ
      // (EQ output → analyser → headroom → destination is handled by audioRouting)
      this.gainNode.connect(this.distortionGainNode!);
      this.distortionGainNode!.connect(eq.getInputNode());
      
      // Set up progress tracking
      this.setupProgressTracking();
      
      // Apply initial distortion gain from store (only when EQ is on)
      const { distortionGain, isEQEnabled } = useEQProfileStore.getState();
      this.setDistortionGain(isEQEnabled ? distortionGain : 1.0);

      // Subscribe to distortion gain / EQ enabled changes
      useEQProfileStore.subscribe(
        (state) => {
          this.setDistortionGain(state.isEQEnabled ? state.distortionGain : 1.0);
        }
      );
      
    } catch (error) {
      console.error('🎵 Error during AudioPlayer initialization:', error);
    }
  }
  
  // Set distortion gain (0-1) to prevent clipping
  public setDistortionGain(gain: number): void {

    if (!this.distortionGainNode) {
      return;
    }
    
    const clampedGain = clamp(gain, 0, 1);
    
    // Apply gain with a smooth transition
    const audioCtx = audioContext.getAudioContext();
    const currentTime = audioCtx.currentTime;
    const TRANSITION_TIME = 0.05; // 50ms
    
    this.distortionGainNode.gain.linearRampToValueAtTime(
      clampedGain,
      currentTime + TRANSITION_TIME
    );
  }
  
  // Get the distortion gain node for external routing
  public getDistortionGainNode(): GainNode | null {
    return this.distortionGainNode;
  }
  
  // Set up progress tracking interval
  private setupProgressTracking(): void {
    
    // Clear any existing interval
    if (this.progressInterval) {
      window.clearInterval(this.progressInterval);
    }
    
    // Update current time every 100ms during playback
    this.progressInterval = window.setInterval(() => {
      if (this.isPlaying && this.timeUpdateCallback) {
        const currentTime = this.getCurrentTime();
        this.timeUpdateCallback(currentTime);
      }
    }, 100);
  }
  
  // Get the progress interval ID
  public getProgressInterval(): number | null {
    return this.progressInterval;
  }
  
  // Set a callback for time updates
  public setTimeUpdateCallback(callback: (time: number) => void): void {
    this.timeUpdateCallback = callback;
  }
  
  // Set a callback for when the track naturally ends
  public setTrackEndCallback(callback: () => void): void {
    this.trackEndCallback = callback;
  }
  
  // Load a track by storage key
  public async loadTrack(
    storageKey: string, 
    progressCallback?: ProgressCallback,
    completionCallback?: CompletionCallback
  ): Promise<void> {
    
    // Clear existing playback
    if (this.sourceNode) {
      if (this.isPlaying) {
        this.sourceNode.stop();
      }
      this.sourceNode = null;
      this.isPlaying = false;
    }
    
    try {
      // Get audio file from storage
      if (progressCallback) progressCallback(10);
      
      const audioFile = await fileStorage.getAudioFile(storageKey);
      
      if (!audioFile) {
        console.error('🎵 Audio file not found in storage');
        if (completionCallback) completionCallback(false, undefined, `Audio file not found: ${storageKey}`);
        return;
      }
      
      // Update loading progress
      if (progressCallback) progressCallback(40);
      
      // Convert Blob to ArrayBuffer
      const arrayBuffer = await audioFile.arrayBuffer();
      if (progressCallback) progressCallback(60);
      
      // Decode audio data
      this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      if (progressCallback) progressCallback(90);
      
      // Position will be controlled by the playerStore
      // We just use our pausedTime as a temporary variable
      this.pausedTime = 0;
      
      // Complete loading
      if (progressCallback) progressCallback(100);
      if (completionCallback) completionCallback(true, this.audioBuffer.duration);
      
    } catch (error) {
      console.error('🎵 Error loading track:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (completionCallback) completionCallback(false, undefined, errorMessage);
    }
  }
  
  // Play the current track from a specified position
  public play(fromPosition?: number): void {

    if (!this.audioBuffer) {
      console.log('🎵 Cannot play: No audio buffer loaded');
      return;
    }
    
    if (this.isPlaying) {
      console.log('🎵 Already playing, ignoring play request');
      return;
    }
    
    // Cleanup any existing source node first
    if (this.sourceNode) {
      console.log('🎵 Cleaning up existing source node before play');
      this.sourceNode.onended = null;
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    
    // Use provided position if specified, otherwise use saved position
    if (fromPosition !== undefined) {
      this.pausedTime = fromPosition;
    }
    
    console.log('🎵 Starting playback from position:', this.pausedTime);
    
    audioContext.resumeAudioContext().then(() => {
      // Double-check we're still in a state to play
      if (this.isPlaying || !this.audioBuffer) {
        console.log('🎵 State changed during resumeAudioContext, aborting play');
        return;
      }
      
      // Create and connect a new source node
      this.sourceNode = audioContext.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;
      this.sourceNode.connect(this.gainNode!);
      this.sourceNode.onended = this.handlePlaybackEnded.bind(this);
      
      // Start from the specified position
      this.sourceNode.start(0, this.pausedTime);
      this.startTime = audioContext.getCurrentTime() - this.pausedTime;
      this.isPlaying = true;
      
      // Immediately trigger a time update to ensure UI is in sync
      if (this.timeUpdateCallback) {
        this.timeUpdateCallback(this.pausedTime);
      }
    });
  }
  
  // Pause the current track
  public pause(): void {
    if (!this.isPlaying || !this.sourceNode) {
      return;
    }
    
    // Save current position
    this.pausedTime = this.getCurrentTime();
    // CRITICAL: Remove the onended handler before stopping to prevent it from firing
    // This is the key to preventing position reset during pause
    if (this.sourceNode) {
      this.sourceNode.onended = null;
    }
    
    // Stop the source
    this.sourceNode.stop();
    this.sourceNode = null;
    this.isPlaying = false;
    
    // Update UI
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(this.pausedTime);
    }
  }
  
  // Stop playback completely
  public stop(): void {
    if (this.sourceNode) {
      // For intentional stop, we DO want onended to fire
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    
    this.isPlaying = false;
    this.pausedTime = 0;
    this.audioBuffer = null;
    
    // Update time through callback
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(0);
    }
  }
  
  // Seek to a specific time
  public seek(time: number): void {
    
    if (!this.audioBuffer) {
      return;
    }
    
    const clampedTime = clamp(time, 0, this.audioBuffer.duration);

    // If playing, stop and restart at new position
    const wasPlaying = this.isPlaying;
    
    // Always clean up existing source node to prevent multiple playbacks
    if (this.sourceNode) {
      // Remove the onended handler before stopping to prevent it from firing unexpectedly
      this.sourceNode.onended = null;
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    
    this.isPlaying = false;
    this.pausedTime = clampedTime;
    
    // Update time through callback
    if (this.timeUpdateCallback) {
      this.timeUpdateCallback(clampedTime);
    }
    
    // Only start playing again if it was previously playing
    if (wasPlaying) {
      // Small delay to ensure everything is cleaned up
      setTimeout(() => {
        this.play();
      }, 10);
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
    
    const clampedVolume = clamp(volume, 0, 1);
    
    // Apply volume
    this.gainNode.gain.value = clampedVolume;
  }
  
  // Set mute state
  public setMute(muted: boolean, volumeToRestore?: number): void {

    if (!this.gainNode) {
      return;
    }
    
    if (muted) {
      // Store current volume in a data attribute for unmuting
      this.gainNode.gain.value = 0;
    } else {
      // Use provided volume or default to 1
      const volume = volumeToRestore !== undefined ? volumeToRestore : 1;
      this.gainNode.gain.value = volume;
    }
  }
  
  // Handle playback ended event
  private handlePlaybackEnded(): void {

    // We don't reset position here - that's up to the playerStore
    this.sourceNode = null;
    this.isPlaying = false;
    
    // Notify playerStore about track end instead of resetting state
    if (this.trackEndCallback) {
      this.trackEndCallback();
    }
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
    const progressInterval = audioPlayerInstance.getProgressInterval();
    if (progressInterval) {
      window.clearInterval(progressInterval);
    }
    
    audioPlayerInstance = null;
  }
}; 