import { M_PLUS_1 } from 'next/font/google';
import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores';

// Constants
const MIN_FREQ = 20; // Hz
const MAX_FREQ = 20000; // Hz
const REFERENCE_FREQ = 800; // Hz
const DEFAULT_CALIBRATION_FREQ = 3000; // Hz
const MASTER_GAIN = 2.0;

// Envelope settings
const ENVELOPE_ATTACK = 0.01; // seconds
const ENVELOPE_DECAY = 0.02; // seconds
const ENVELOPE_SUSTAIN = 0.8; // level
const ENVELOPE_RELEASE = 0.01; // seconds
const BURST_LENGTH = 0.09; // seconds

// Pattern timing
const BURST_INTERVAL = 0.2; // seconds between bursts
const ROW_PAUSE = 0.2; // pause between rows

// Filter settings
const DEFAULT_Q = 3.0; // Q for bandwidth
const BANDWIDTH_OCTAVE = 1.5; // Width of the band in octaves (0.5 = half octave)
const FILTER_SLOPE = 24; // Filter slope in dB/octave (24 = steep filter)
const FIXED_BANDWIDTH = 0.05; // Fixed bandwidth for noise bursts in octaves

// Effective frequency range accounting for bandwidth
const EFFECTIVE_MIN_FREQ = MIN_FREQ * Math.pow(2, FIXED_BANDWIDTH); // Min center freq to avoid HP cutoff
const EFFECTIVE_MAX_FREQ = MAX_FREQ / Math.pow(2, FIXED_BANDWIDTH); // Max center freq to avoid LP cutoff

// Bandwidth for different stages
const STAGE_BANDWIDTH = [
  1.0,  // Stage 1: Wide bandwidth (1 octave)
  0.5,  // Stage 2: Medium bandwidth (half octave)
  0.25  // Stage 3: Narrow bandwidth (quarter octave)
];

// Panning positions
const PANNING_POSITIONS = [-1.0, -0.5, 0.0, 0.5, 1.0]; // Full left to full right

// Observer for calibration events
type FrequencyChangeListener = (frequency: number) => void;
type PositionListener = (position: number, isReference: boolean) => void;

class ReferenceCalibrationAudio {
  private static instance: ReferenceCalibrationAudio;
  private noiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private currentPosition: number = 0;
  private isPlayingReference: boolean = true;
  private timeoutId: number | null = null;
  private frequencyListeners: FrequencyChangeListener[] = [];
  private positionListeners: PositionListener[] = [];
  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;
  
  // Calibration frequency (user adjustable)
  private calibrationFrequency: number = DEFAULT_CALIBRATION_FREQ;
  
  // Active filter nodes for real-time updates
  private activeCalibrationFilters: {
    bandpass1: BiquadFilterNode | null;
    bandpass2: BiquadFilterNode | null;
  } = {
    bandpass1: null,
    bandpass2: null
  };
  
  // Add a constant for fixed noise bandwidth
  private readonly FIXED_NOISE_BANDWIDTH = 0.5; // Half octave fixed width for noise bursts
  
  // Add property to store distortion gain value
  private distortionGain: number = 1.0;
  
  private constructor() {
    // Initialize noise buffer
    this.generateNoiseBuffer();
    
    // Apply initial distortion gain from store
    const distortionGain = useEQProfileStore.getState().distortionGain;
    this.setDistortionGain(distortionGain);
    
    // Subscribe to distortion gain changes from the store
    useEQProfileStore.subscribe(
      (state) => {
        this.setDistortionGain(state.distortionGain);
      }
    );
  }

  public static getInstance(): ReferenceCalibrationAudio {
    if (!ReferenceCalibrationAudio.instance) {
      ReferenceCalibrationAudio.instance = new ReferenceCalibrationAudio();
    }
    return ReferenceCalibrationAudio.instance;
  }

  /**
   * Generate white noise buffer
   */
  private async generateNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate white noise - equal energy across all frequencies
    for (let i = 0; i < bufferSize; i++) {
      // Generate white noise sample (values between -1 and 1)
      data[i] = Math.random() * 2 - 1;
    }
    
    // Apply normalization to ensure consistent volume
    // Find the peak amplitude
    let peak = 0;
    for (let i = 0; i < bufferSize; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    
    // Normalize to avoid clipping but maintain energy
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor;
    }

    console.log(`🔊 Generated white noise buffer: ${bufferSize} samples, normalized by ${normalizationFactor.toFixed(4)}`);
    this.noiseBuffer = buffer;
  }

  /**
   * Create and return a pre-EQ analyzer node
   */
  public createPreEQAnalyser(): AnalyserNode {
    const ctx = audioContext.getAudioContext();
    
    // Create analyzer if it doesn't exist
    if (!this.preEQAnalyser) {
      // Create a gain node to combine all sources
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
      
      // Create analyzer node
      this.preEQAnalyser = ctx.createAnalyser();
      this.preEQAnalyser.fftSize = 2048;
      this.preEQAnalyser.smoothingTimeConstant = 0.8;
      
      // Connect the gain to the analyzer
      this.preEQGain.connect(this.preEQAnalyser);
      
      // Connect to EQ processor
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode());
    }
    
    return this.preEQAnalyser;
  }
  
  /**
   * Get the pre-EQ analyzer, creating it if needed
   */
  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser;
  }

  /**
   * Set the calibration frequency with real-time update to active filters
   * @param frequency Frequency in Hz
   */
  public setCalibrationFrequency(frequency: number): void {
    console.log(`🔊 Setting calibration frequency to ${frequency}Hz`);

    // Ensure frequency is in valid range accounting for bandwidth
    const validFreq = Math.max(EFFECTIVE_MIN_FREQ, Math.min(EFFECTIVE_MAX_FREQ, frequency));
    
    if (validFreq !== frequency) {
      console.log(`🔊 Adjusted frequency from ${frequency.toFixed(1)}Hz to ${validFreq.toFixed(1)}Hz to account for bandwidth`);
    }
    
    if (this.calibrationFrequency !== validFreq) {
      this.calibrationFrequency = validFreq;
      
      // Update active filters in real-time if they exist
      this.updateActiveFilters();
      
      // Notify listeners
      this.frequencyListeners.forEach(listener => listener(this.calibrationFrequency));
    }
  }
  
  /**
   * Get the current calibration frequency
   */
  public getCalibrationFrequency(): number {
    return this.calibrationFrequency;
  }

  /**
   * Set the current bandwidth in octaves and update active filters
   * Note: This is kept for API compatibility but has no effect with the new filter design
   * @param bandwidth Width in octaves
   */
  public setBandwidth(bandwidth: number): void {
    // No longer used - we now use adaptive filtering based on frequency
    console.log(`🔊 setBandwidth(${bandwidth}) called - ignored, using adaptive filtering instead`);
    // Kept for API compatibility
  }
  
  /**
   * Get the current bandwidth in octaves
   * Note: This always returns 1.0 as bandwidth isn't used in the new filter design
   */
  public getBandwidth(): number {
    // No longer used - return a default value for compatibility
    return 1.0;
  }
  
  /**
   * Update active filter parameters in real-time
   */
  private updateActiveFilters(): void {
    const ctx = audioContext.getAudioContext();
    const currentTime = ctx.currentTime;
    
    // Skip if no active filters
    if (!this.activeCalibrationFilters.bandpass1 || !this.activeCalibrationFilters.bandpass2) {
      return;
    }
    
    // Check if frequency is at the extreme edges (within 5% of the effective range)
    const isAtMinEdge = this.calibrationFrequency <= EFFECTIVE_MIN_FREQ * 1.05;
    const isAtMaxEdge = this.calibrationFrequency >= EFFECTIVE_MAX_FREQ * 0.95;
    
    // Calculate filter cutoffs - bypassing appropriate filter at extremes
    const highpassCutoff = isAtMinEdge ? 20 : this.calibrationFrequency / Math.pow(2, FIXED_BANDWIDTH/2);
    const lowpassCutoff = isAtMaxEdge ? 20000 : this.calibrationFrequency * Math.pow(2, FIXED_BANDWIDTH/2);
    
    // Update highpass filter (using bandpass1 reference)
    if (this.activeCalibrationFilters.bandpass1.type !== 'highpass') {
      this.activeCalibrationFilters.bandpass1.type = 'highpass';
    }
    
    this.activeCalibrationFilters.bandpass1.frequency.cancelScheduledValues(currentTime);
    this.activeCalibrationFilters.bandpass1.frequency.setTargetAtTime(
      highpassCutoff, 
      currentTime, 
      0.05
    );
    
    this.activeCalibrationFilters.bandpass1.Q.cancelScheduledValues(currentTime);
    this.activeCalibrationFilters.bandpass1.Q.setTargetAtTime(
      DEFAULT_Q, // Standard Q value
      currentTime,
      0.05
    );
    
    // Update lowpass filter (using bandpass2 reference)
    if (this.activeCalibrationFilters.bandpass2.type !== 'lowpass') {
      this.activeCalibrationFilters.bandpass2.type = 'lowpass';
    }
    
    this.activeCalibrationFilters.bandpass2.frequency.cancelScheduledValues(currentTime);
    this.activeCalibrationFilters.bandpass2.frequency.setTargetAtTime(
      lowpassCutoff, 
      currentTime, 
      0.05
    );
    
    this.activeCalibrationFilters.bandpass2.Q.cancelScheduledValues(currentTime);
    this.activeCalibrationFilters.bandpass2.Q.setTargetAtTime(
      DEFAULT_Q, // Standard Q value
      currentTime,
      0.05
    );
    
    // Log what we're doing
    if (isAtMinEdge) {
      console.log(`🔊 Updated filters: freq=${this.calibrationFrequency.toFixed(0)}Hz (bypassing highpass filter, LP=${lowpassCutoff.toFixed(0)}Hz)`);
    } else if (isAtMaxEdge) {
      console.log(`🔊 Updated filters: freq=${this.calibrationFrequency.toFixed(0)}Hz (HP=${highpassCutoff.toFixed(0)}Hz, bypassing lowpass filter)`);
    } else {
      console.log(`🔊 Updated filters: freq=${this.calibrationFrequency.toFixed(0)}Hz (HP=${highpassCutoff.toFixed(0)}Hz LP=${lowpassCutoff.toFixed(0)}Hz)`);
    }
  }

  /**
   * Convert normalized position (0-1) to frequency (Hz)
   * Uses logarithmic scale for perceptual accuracy
   */
  public positionToFrequency(position: number): number {
    // Ensure position is in 0-1 range
    const normalizedPosition = Math.max(0, Math.min(1, position));
    
    // Convert to logarithmic frequency scale
    const logMinFreq = Math.log2(MIN_FREQ);
    const logMaxFreq = Math.log2(MAX_FREQ);
    const logFreq = logMinFreq + normalizedPosition * (logMaxFreq - logMinFreq);
    
    return Math.pow(2, logFreq);
  }
  
  /**
   * Convert frequency (Hz) to normalized position (0-1)
   */
  public frequencyToPosition(frequency: number): number {
    // Ensure frequency is in valid range
    const validFreq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, frequency));
    
    // Convert from logarithmic frequency scale to linear position
    const logMinFreq = Math.log2(MIN_FREQ);
    const logMaxFreq = Math.log2(MAX_FREQ);
    const logFreq = Math.log2(validFreq);
    
    return (logFreq - logMinFreq) / (logMaxFreq - logMinFreq);
  }

  /**
   * Set playing state
   */
  public setPlaying(playing: boolean): void {
    // If there's no state change, just return
    if (playing === this.isPlaying) return;
    
    // Update state first
    this.isPlaying = playing;
    // console.log(`🔊 Reference calibration ${playing ? 'started' : 'stopped'}`);
    
    if (playing) {
      // This will only start a new pattern if one isn't already running
      // (the startPattern method now checks for this)
      this.startPattern();
    } else {
      // Always stop the pattern when requested
      this.stopPattern();
    }
  }

  /**
   * Get playing state
   */
  public isActive(): boolean {
    return this.isPlaying;
  }

  /**
   * Add a listener for frequency changes
   */
  public addFrequencyListener(listener: FrequencyChangeListener): void {
    this.frequencyListeners.push(listener);
  }

  /**
   * Remove a frequency listener
   */
  public removeFrequencyListener(listener: FrequencyChangeListener): void {
    this.frequencyListeners = this.frequencyListeners.filter(l => l !== listener);
  }
  
  /**
   * Add a listener for position activations
   */
  public addPositionListener(listener: PositionListener): void {
    this.positionListeners.push(listener);
  }
  
  /**
   * Remove a position listener
   */
  public removePositionListener(listener: PositionListener): void {
    this.positionListeners = this.positionListeners.filter(l => l !== listener);
  }

  /**
   * Start the noise burst pattern
   */
  private startPattern(): void {
    // Only reset counters if we don't already have a scheduled pattern
    // (i.e., timeoutId is null)
    if (this.timeoutId === null) {
      // Reset counters and start with calibration (not reference)
      this.currentPosition = 0;
      this.isPlayingReference = false; // Start with calibration
      
      // Schedule first burst
      this.scheduleNextBurst();
    }
    // If timeoutId is not null, pattern is already running, so don't restart it
  }

  /**
   * Schedule the next noise burst
   */
  private scheduleNextBurst(): void {
    if (!this.isPlaying) return;
    
    // Get current pan position from the array
    const panPosition = PANNING_POSITIONS[this.currentPosition];
    
    // Play the burst - reference or calibrated
    // Both rows will pan across the stereo field in the same way
    if (this.isPlayingReference) {
      this.playNoiseAtFrequency(REFERENCE_FREQ, panPosition, true);
    } else {
      this.playNoiseAtFrequency(this.calibrationFrequency, panPosition, false);
    }
    
    // Notify position listeners
    this.positionListeners.forEach(listener => 
      listener(panPosition, this.isPlayingReference)
    );
    
    // Increment position within the current row
    this.currentPosition++;
    
    // If we've reached the end of a row
    if (this.currentPosition >= PANNING_POSITIONS.length) {
      this.currentPosition = 0;
      
      // Toggle between reference and calibration rows
      this.isPlayingReference = !this.isPlayingReference;
    }
    
    // Determine the next interval
    // Add a longer pause between rows (when we reset position)
    const isRowTransition = this.currentPosition === 0;
    const nextInterval = isRowTransition ? ROW_PAUSE : BURST_INTERVAL;
    
    // Schedule next burst
    this.timeoutId = window.setTimeout(() => {
      this.scheduleNextBurst();
    }, nextInterval * 1000);
  }

  /**
   * Stop the noise burst pattern
   */
  private stopPattern(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    // Clean up active filters when stopping
    this.cleanupActiveFilters();
  }
  
  /**
   * Clean up active filter connections
   */
  private cleanupActiveFilters(): void {
    if (this.activeCalibrationFilters.bandpass1) {
      this.activeCalibrationFilters.bandpass1.disconnect();
      this.activeCalibrationFilters.bandpass1 = null;
    }
    
    if (this.activeCalibrationFilters.bandpass2) {
      this.activeCalibrationFilters.bandpass2.disconnect();
      this.activeCalibrationFilters.bandpass2 = null;
    }
  }
  
  /**
   * Play a noise burst at a specific frequency and pan position
   */
  private playNoiseAtFrequency(frequency: number, pan: number, isReference: boolean): void {
    if (!this.noiseBuffer) {
      console.warn('Noise buffer not ready');
      return;
    }
    
    const ctx = audioContext.getAudioContext();
    
    // Create nodes
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    
    // Check if frequency is at the extreme edges (within 5% of the effective range)
    const isAtMinEdge = frequency <= EFFECTIVE_MIN_FREQ * 1.05;
    const isAtMaxEdge = frequency >= EFFECTIVE_MAX_FREQ * 0.95;
    
    let centerFreq = frequency;
    
    // Adjust center frequency only if needed to keep it within effective range
    if (!isAtMinEdge && !isAtMaxEdge && (frequency < EFFECTIVE_MIN_FREQ || frequency > EFFECTIVE_MAX_FREQ)) {
      centerFreq = Math.max(EFFECTIVE_MIN_FREQ, Math.min(EFFECTIVE_MAX_FREQ, frequency));
      console.log(`🔊 Adjusted burst frequency from ${frequency.toFixed(1)}Hz to ${centerFreq.toFixed(1)}Hz to account for bandwidth`);
    }
    
    // Calculate filter cutoffs based on center frequency
    // At edges, we'll bypass one filter by setting it to an extreme value
    const highpassCutoff = isAtMinEdge ? 20 : centerFreq / Math.pow(2, FIXED_BANDWIDTH/2);
    const lowpassCutoff = isAtMaxEdge ? 20000 : centerFreq * Math.pow(2, FIXED_BANDWIDTH/2);
    
    // Create filters
    const highpassFilter = ctx.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = highpassCutoff;
    highpassFilter.Q.value = DEFAULT_Q; // Standard Q value
    
    const lowpassFilter = ctx.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = lowpassCutoff;
    lowpassFilter.Q.value = DEFAULT_Q; // Standard Q value
    
    // Store active filter references if this is a calibration (non-reference) play
    if (!isReference) {
      // Replace existing active filters
      if (this.activeCalibrationFilters.bandpass1) {
        this.activeCalibrationFilters.bandpass1.disconnect();
      }
      if (this.activeCalibrationFilters.bandpass2) {
        this.activeCalibrationFilters.bandpass2.disconnect();
      }
      
      // Store new filters for future reference
      this.activeCalibrationFilters.bandpass1 = highpassFilter;
      this.activeCalibrationFilters.bandpass2 = lowpassFilter;
    }
    
    // Create a panner
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    
    // Create a gain node with different levels for reference vs calibration
    // AND apply distortion gain to prevent clipping
    const gainNode = ctx.createGain();
    gainNode.gain.value = isReference ? 
      MASTER_GAIN * 2.0 * this.distortionGain : // Double gain (+6dB) for reference, but apply distortion gain
      MASTER_GAIN * this.distortionGain;        // Apply distortion gain to calibration tone
    
    // Create envelope
    const envelopeGain = ctx.createGain();
    const now = ctx.currentTime;
    
    // Set up ADSR envelope
    envelopeGain.gain.setValueAtTime(0, now);
    envelopeGain.gain.linearRampToValueAtTime(1, now + ENVELOPE_ATTACK);
    envelopeGain.gain.linearRampToValueAtTime(ENVELOPE_SUSTAIN, now + ENVELOPE_ATTACK + ENVELOPE_DECAY);
    envelopeGain.gain.setValueAtTime(ENVELOPE_SUSTAIN, now + BURST_LENGTH);
    envelopeGain.gain.linearRampToValueAtTime(0, now + BURST_LENGTH + ENVELOPE_RELEASE);
    
    // Connect the audio chain
    source.connect(highpassFilter);
    highpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(panner);
    panner.connect(envelopeGain);
    envelopeGain.connect(gainNode);
    
    // Connect to proper destination based on whether this is reference or not
    if (isReference) {
      // Reference signal ALWAYS bypasses EQ and connects directly to main output
      gainNode.connect(audioContext.getAudioContext().destination);
      
      // Also connect to analyzer if it exists (for visualization only)
      if (this.preEQGain) {
        // Create a reduced-volume copy for analyzer to avoid double volume
        const analyzerGain = ctx.createGain();
        analyzerGain.gain.value = 0.2; // Low volume just for visualization
        gainNode.connect(analyzerGain);
        analyzerGain.connect(this.preEQGain);
      }
    } else {
      // Calibration signal goes through EQ
      if (this.preEQGain) {
        gainNode.connect(this.preEQGain);
      } else {
        const eq = eqProcessor.getEQProcessor();
        gainNode.connect(eq.getInputNode());
      }
    }
    
    // Start and automatically stop the source (but not the filters for calibration)
    source.start();
    source.stop(now + BURST_LENGTH + ENVELOPE_RELEASE + 0.1);
    
    // Log the noise burst details
    if (!isReference) {
      if (isAtMinEdge) {
        console.log(`🔊 Calibration burst: freq=${centerFreq.toFixed(0)}Hz (bypassing highpass filter, LP=${lowpassCutoff.toFixed(0)}Hz)`);
      } else if (isAtMaxEdge) {
        console.log(`🔊 Calibration burst: freq=${centerFreq.toFixed(0)}Hz (HP=${highpassCutoff.toFixed(0)}Hz, bypassing lowpass filter)`);
      } else {
        console.log(`🔊 Calibration burst: freq=${centerFreq.toFixed(0)}Hz (HP=${highpassCutoff.toFixed(0)}Hz, LP=${lowpassCutoff.toFixed(0)}Hz)`);
      }
    }
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    this.frequencyListeners = [];
    this.positionListeners = [];
    
    // Clean up filters
    this.cleanupActiveFilters();
    
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
    }
    
    if (this.preEQAnalyser) {
      this.preEQAnalyser.disconnect();
      this.preEQAnalyser = null;
    }
    
    this.noiseBuffer = null;
  }

  /**
   * Update calibration parameters without affecting playback state
   * @param frequency New frequency to set
   * @param bandwidth New bandwidth to set
   */
  public updateCalibrationParameters(frequency?: number, bandwidth?: number): void {
    // Update frequency if provided
    if (frequency !== undefined) {
      this.setCalibrationFrequency(frequency);
    }
    
    // Update bandwidth if provided
    if (bandwidth !== undefined) {
      this.setBandwidth(bandwidth);
    }
    
    // No need to restart pattern - filters will update in real-time
  }

  // Add method to update distortion gain
  private setDistortionGain(gain: number): void {
    // Clamp gain between 0 and 1
    this.distortionGain = Math.max(0, Math.min(1, gain));
    console.log(`🔊 Reference calibration distortion gain set to ${this.distortionGain.toFixed(2)}`);
  }
}

/**
 * Get the singleton instance of the ReferenceCalibrationAudio
 */
export function getReferenceCalibrationAudio(): ReferenceCalibrationAudio {
  return ReferenceCalibrationAudio.getInstance();
}

/**
 * Clean up the reference calibration audio
 */
export function cleanupReferenceCalibrationAudio(): void {
  const player = ReferenceCalibrationAudio.getInstance();
  player.dispose();
} 