import * as audioContext from './audioContext';
import { dbToLinear } from './sineFrequencyResponse';

// Class to manage SineEQ audio feedback
class SineEQAudio {
  private audioCtx: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private oscillatorNode: OscillatorNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private envelopeNode: GainNode | null = null;
  
  private isPlaying: boolean = false;
  private patternTimeout: number | null = null;
  
  // Reference frequency (1kHz)
  private referenceFrequency: number = 1000;
  // Current calibration frequency (adjustable)
  private calibrationFrequency: number = 1000;
  // Current amplitude in dB
  private calibrationAmplitude: number = 0;
  
  // Timing parameters
  private toneDuration: number = 150; // ms
  private gapDuration: number = 50; // ms
  private panPositions: number[] = [-1, -0.5, 0, 0.5, 1];
  
  constructor() {
    this.initialize();
  }
  
  private initialize(): void {
    try {
      this.audioCtx = audioContext.getAudioContext();
      
      // Create master gain node (for overall volume control)
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.value = 0.15; // Lower volume to avoid being too loud
      
      // Connect master gain to destination
      this.masterGainNode.connect(this.audioCtx.destination);
    } catch (error) {
      console.error('Error initializing SineEQAudio:', error);
    }
  }
  
  // Calculate the pink noise adjustment (-3dB/octave) for a given frequency
  private calculatePinkNoiseAdjustment(frequency: number): number {
    // Calculate octave difference from reference (1kHz)
    const octaveDifference = Math.log2(frequency / this.referenceFrequency);
    
    // Apply -3dB per octave slope
    return -3 * octaveDifference;
  }
  
  // Start the tone pattern
  public startPattern(frequency: number, amplitude: number): void {
    // Don't restart if already playing
    if (this.isPlaying) {
      // Just update parameters if already playing
      this.calibrationFrequency = frequency;
      this.calibrationAmplitude = amplitude;
      return;
    }
    
    this.isPlaying = true;
    this.calibrationFrequency = frequency;
    this.calibrationAmplitude = amplitude;
    
    // Resume audio context if suspended
    audioContext.resumeAudioContext().then(() => {
      // Start the pattern
      this.playNextTone(0, true);
    });
  }
  
  // Stop the tone pattern
  public stopPattern(): void {
    this.isPlaying = false;
    
    // Clear any pending timeouts
    if (this.patternTimeout !== null) {
      window.clearTimeout(this.patternTimeout);
      this.patternTimeout = null;
    }
    
    // Stop the current oscillator
    this.stopCurrentOscillator();
  }
  
  // Update the calibration frequency and amplitude (while dragging)
  public updateCalibration(frequency: number, amplitude: number): void {
    this.calibrationFrequency = frequency;
    this.calibrationAmplitude = amplitude;
    
    // If oscillator is currently playing a calibration tone, update it immediately
    if (this.isPlaying && this.oscillatorNode) {
      // Check if we're currently playing a calibration tone (not reference)
      // by comparing current frequency with reference frequency
      const isPlayingCalibration = Math.abs(this.oscillatorNode.frequency.value - this.referenceFrequency) > 1;
      
      if (isPlayingCalibration) {
        // Update frequency in real-time
        this.oscillatorNode.frequency.setValueAtTime(
          frequency,
          this.audioCtx!.currentTime
        );
        
        // Update gain for amplitude, applying the pink noise adjustment
        if (this.envelopeNode) {
          // Apply pink noise slope adjustment
          const adjustedAmplitude = amplitude + this.calculatePinkNoiseAdjustment(frequency);
          const linearGain = dbToLinear(adjustedAmplitude);
          
          // Don't change immediately, apply to the sustain portion of envelope
          const now = this.audioCtx!.currentTime;
          this.envelopeNode.gain.cancelScheduledValues(now);
          // Maintain current value and schedule a ramp to new value
          const currentGain = this.envelopeNode.gain.value;
          this.envelopeNode.gain.setValueAtTime(currentGain, now);
          this.envelopeNode.gain.linearRampToValueAtTime(linearGain * 0.7, now + 0.05);
        }
      }
    }
  }
  
  // Play the next tone in the pattern
  private playNextTone(index: number, isReference: boolean): void {
    if (!this.isPlaying || !this.audioCtx || !this.masterGainNode) return;
    
    // Stop any existing oscillator
    this.stopCurrentOscillator();
    
    // Create new oscillator
    this.oscillatorNode = this.audioCtx.createOscillator();
    this.oscillatorNode.type = 'sine';
    
    // Create panner for stereo positioning
    this.pannerNode = this.audioCtx.createStereoPanner();
    this.pannerNode.pan.value = this.panPositions[index];
    
    // Create envelope node for ADSR
    this.envelopeNode = this.audioCtx.createGain();
    this.envelopeNode.gain.value = 0; // Start silent
    
    // Set frequency based on whether this is reference or calibration
    const frequency = isReference ? this.referenceFrequency : this.calibrationFrequency;
    this.oscillatorNode.frequency.value = frequency;
    
    // Connect nodes: oscillator -> envelope -> panner -> master gain -> destination
    this.oscillatorNode.connect(this.envelopeNode);
    this.envelopeNode.connect(this.pannerNode);
    this.pannerNode.connect(this.masterGainNode);
    
    // Start the oscillator
    this.oscillatorNode.start();
    
    // Apply ADSR envelope
    const now = this.audioCtx.currentTime;
    const attackTime = 0.01; // 10ms attack
    const decayTime = 0.02; // 20ms decay
    
    // Calculate amplitude with pink noise adjustment
    let amplitude = isReference ? 0 : this.calibrationAmplitude;
    if (!isReference) {
      // Apply pink noise slope adjustment to calibration tone
      amplitude += this.calculatePinkNoiseAdjustment(frequency);
    }
    
    // Convert to linear gain and apply envelope
    const sustainLevel = isReference ? 0.7 : dbToLinear(amplitude) * 0.7;
    const releaseTime = 0.05; // 50ms release
    
    // Attack phase
    this.envelopeNode.gain.setValueAtTime(0, now);
    this.envelopeNode.gain.linearRampToValueAtTime(1.0, now + attackTime);
    
    // Decay to sustain phase
    this.envelopeNode.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);
    
    // Release phase (scheduled for later)
    const toneEnd = now + (this.toneDuration / 1000);
    this.envelopeNode.gain.setValueAtTime(sustainLevel, toneEnd);
    this.envelopeNode.gain.linearRampToValueAtTime(0, toneEnd + releaseTime);
    
    // Schedule next tone
    this.patternTimeout = window.setTimeout(() => {
      // Calculate next index and whether it should be reference or calibration
      let nextIndex = index;
      let nextIsReference = isReference;
      
      // Move to next pan position or switch between reference/calibration
      if (index >= this.panPositions.length - 1) {
        nextIndex = 0;
        nextIsReference = !isReference;
      } else {
        nextIndex = index + 1;
      }
      
      // Play next tone
      this.playNextTone(nextIndex, nextIsReference);
    }, this.toneDuration + this.gapDuration);
    
    // Schedule oscillator stop
    this.oscillatorNode.stop(toneEnd + releaseTime + 0.01); // Add small buffer after release
  }
  
  // Stop the current oscillator
  private stopCurrentOscillator(): void {
    if (this.oscillatorNode) {
      try {
        this.oscillatorNode.stop();
        this.oscillatorNode.disconnect();
      } catch (e) {
        // Ignore errors if already stopped
      }
      this.oscillatorNode = null;
    }
    
    if (this.pannerNode) {
      this.pannerNode.disconnect();
      this.pannerNode = null;
    }
    
    if (this.envelopeNode) {
      this.envelopeNode.disconnect();
      this.envelopeNode = null;
    }
  }
  
  // Set master volume (0-1)
  public setVolume(volume: number): void {
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
}

// Singleton instance
let sineEQAudioInstance: SineEQAudio | null = null;

// Get or create the SineEQAudio instance
export const getSineEQAudio = (): SineEQAudio => {
  if (!sineEQAudioInstance) {
    sineEQAudioInstance = new SineEQAudio();
  }
  return sineEQAudioInstance;
};

// Cleanup function
export const cleanupSineEQAudio = (): void => {
  if (sineEQAudioInstance) {
    sineEQAudioInstance.stopPattern();
    sineEQAudioInstance = null;
  }
}; 