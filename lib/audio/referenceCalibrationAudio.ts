import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
const MIN_FREQ = 20; // Hz
const MAX_FREQ = 20000; // Hz
const REFERENCE_FREQ = 800; // Hz
const DEFAULT_CALIBRATION_FREQ = 3000; // Hz
const MASTER_GAIN = 0.8;

// Envelope settings
const ENVELOPE_ATTACK = 0.01; // seconds
const ENVELOPE_DECAY = 0.02; // seconds
const ENVELOPE_SUSTAIN = 0.8; // level
const ENVELOPE_RELEASE = 0.3; // seconds
const BURST_LENGTH = 0.15; // seconds

// Pattern timing
const BURST_INTERVAL = 0.2; // seconds between bursts
const ROW_PAUSE = 0.2; // pause between rows

// Filter settings
const DEFAULT_Q = 3.0; // Q for bandwidth
const BANDWIDTH_OCTAVE = 1.5; // Width of the band in octaves (0.5 = half octave)
const FILTER_SLOPE = 24; // Filter slope in dB/octave (24 = steep filter)

// Bandwidth for different stages
const STAGE_BANDWIDTH = [
  1.0,  // Stage 1: Wide bandwidth (1 octave)
  0.5,  // Stage 2: Medium bandwidth (half octave)
  0.25  // Stage 3: Narrow bandwidth (quarter octave)
];

// Panning positions
const PANNING_POSITIONS = [-1.0, -0.33, 0.33, 1.0]; // Full left to full right

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
  
  // Calibration bandwidth (adjustable per stage)
  private currentBandwidth: number = BANDWIDTH_OCTAVE;
  
  // Active filter nodes for real-time updates
  private activeCalibrationFilters: {
    bandpass1: BiquadFilterNode | null;
    bandpass2: BiquadFilterNode | null;
  } = {
    bandpass1: null,
    bandpass2: null
  };
  
  // Add a constant for fixed noise bandwidth
  private readonly FIXED_NOISE_BANDWIDTH = 1.0; // Half octave fixed width for noise bursts
  
  private constructor() {
    // Initialize noise buffer
    this.generateNoiseBuffer();
  }

  public static getInstance(): ReferenceCalibrationAudio {
    if (!ReferenceCalibrationAudio.instance) {
      ReferenceCalibrationAudio.instance = new ReferenceCalibrationAudio();
    }
    return ReferenceCalibrationAudio.instance;
  }

  /**
   * Generate pink noise buffer
   * Uses Paul Kellet's refined method for generating pink noise
   */
  private async generateNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Pink noise generation using Paul Kellet's refined method
    // This produces a true -3dB/octave spectrum characteristic of pink noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
      // Generate white noise sample
      const white = Math.random() * 2 - 1;
      
      // Pink noise filtering - refined coefficients for accurate spectral slope
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      b6 = white * 0.5362;
      
      // Combine with proper scaling to maintain pink noise characteristics
      // The sum is multiplied by 0.11 to normalize the output
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6) * 0.11;
    }
    
    // Apply a second-pass normalization to ensure consistent volume
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

    console.log(`🔊 Generated pink noise buffer: ${bufferSize} samples, normalized by ${normalizationFactor.toFixed(4)}`);
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
    // Ensure frequency is in valid range
    const validFreq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, frequency));
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
   * @param bandwidth Width in octaves
   */
  public setBandwidth(bandwidth: number): void {
    this.currentBandwidth = Math.max(0.1, Math.min(2.0, bandwidth));
    
    // Update active filters in real-time if they exist
    this.updateActiveFilters();
  }
  
  /**
   * Get the current bandwidth in octaves
   */
  public getBandwidth(): number {
    return this.currentBandwidth;
  }
  
  /**
   * Update active filter parameters in real-time
   */
  private updateActiveFilters(): void {
    const ctx = audioContext.getAudioContext();
    const currentTime = ctx.currentTime;
    
    if (this.activeCalibrationFilters.bandpass1) {
      // Smooth transition to new frequency (faster than default for responsive UI)
      this.activeCalibrationFilters.bandpass1.frequency.cancelScheduledValues(currentTime);
      this.activeCalibrationFilters.bandpass1.frequency.setTargetAtTime(
        this.calibrationFrequency, 
        currentTime, 
        0.05 // Time constant for exponential approach (smaller = faster)
      );
      
      // Keep Q value constant using fixed bandwidth
      this.activeCalibrationFilters.bandpass1.Q.cancelScheduledValues(currentTime);
      this.activeCalibrationFilters.bandpass1.Q.setTargetAtTime(
        1.0 / this.FIXED_NOISE_BANDWIDTH,
        currentTime,
        0.05
      );
    }
    
    if (this.activeCalibrationFilters.bandpass2) {
      // Update second filter in the same way with a slight variation for natural sound
      this.activeCalibrationFilters.bandpass2.frequency.cancelScheduledValues(currentTime);
      this.activeCalibrationFilters.bandpass2.frequency.setTargetAtTime(
        this.calibrationFrequency, 
        currentTime, 
        0.05
      );
      
      this.activeCalibrationFilters.bandpass2.Q.cancelScheduledValues(currentTime);
      this.activeCalibrationFilters.bandpass2.Q.setTargetAtTime(
        1.0 / this.FIXED_NOISE_BANDWIDTH * 0.9,
        currentTime,
        0.05
      );
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
    
    // In the new pattern, we alternate between calibration and reference for each position
    // Calibration pans across positions, reference stays centered
    if (this.isPlayingReference) {
      // Play reference always at center (pan = 0)
      this.playNoiseAtFrequency(REFERENCE_FREQ, 0, true);
    } else {
      // Play calibration at the current pan position
      this.playNoiseAtFrequency(this.calibrationFrequency, panPosition, false);
    }
    
    // Notify position listeners
    this.positionListeners.forEach(listener => 
      listener(this.isPlayingReference ? 0 : panPosition, this.isPlayingReference)
    );
    
    // Toggle between reference and calibration for EACH position
    this.isPlayingReference = !this.isPlayingReference;
    
    // Only increment position after playing both reference and calibration at current position
    if (!this.isPlayingReference) {
      // We just played calibration, so next will be reference at a new position
      this.currentPosition++;
      
      // Reset position when we've gone through all positions
      if (this.currentPosition >= PANNING_POSITIONS.length) {
        this.currentPosition = 0;
      }
    }
    
    // Determine the next interval
    // Add a longer pause between rows only when we complete a full cycle
    const isFullCycleComplete = this.currentPosition === 0 && this.isPlayingReference;
    const nextInterval = isFullCycleComplete ? ROW_PAUSE : BURST_INTERVAL;
    
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
    
    // Use FIXED_NOISE_BANDWIDTH instead of this.currentBandwidth for consistent noise character
    const octaveRatio = Math.pow(2, this.FIXED_NOISE_BANDWIDTH / 2); // Half bandwidth on each side
    const lowFreq = frequency / octaveRatio;
    const highFreq = frequency * octaveRatio;
    
    let bandpassFilter1, bandpassFilter2;
    
    if (isReference) {
      // Reference uses fixed bandwidth for consistent sound
      bandpassFilter1 = ctx.createBiquadFilter();
      bandpassFilter1.type = 'bandpass';
      bandpassFilter1.frequency.value = frequency;
      bandpassFilter1.Q.value = 1.0 / this.FIXED_NOISE_BANDWIDTH; // Use fixed bandwidth
      
      bandpassFilter2 = ctx.createBiquadFilter();
      bandpassFilter2.type = 'bandpass';
      bandpassFilter2.frequency.value = frequency;
      bandpassFilter2.Q.value = 1.0 / this.FIXED_NOISE_BANDWIDTH * 0.9; // Slight variation
    } else {
      // For calibration, use the active filters or create new ones
      if (!this.activeCalibrationFilters.bandpass1) {
        this.activeCalibrationFilters.bandpass1 = ctx.createBiquadFilter();
        this.activeCalibrationFilters.bandpass1.type = 'bandpass';
        this.activeCalibrationFilters.bandpass1.frequency.value = this.calibrationFrequency;
        this.activeCalibrationFilters.bandpass1.Q.value = 1.0 / this.FIXED_NOISE_BANDWIDTH;
      }
      
      if (!this.activeCalibrationFilters.bandpass2) {
        this.activeCalibrationFilters.bandpass2 = ctx.createBiquadFilter();
        this.activeCalibrationFilters.bandpass2.type = 'bandpass';
        this.activeCalibrationFilters.bandpass2.frequency.value = this.calibrationFrequency;
        this.activeCalibrationFilters.bandpass2.Q.value = 1.0 / this.FIXED_NOISE_BANDWIDTH * 0.9;
      }
      
      bandpassFilter1 = this.activeCalibrationFilters.bandpass1;
      bandpassFilter2 = this.activeCalibrationFilters.bandpass2;
    }
    
    // Create a panner
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    
    // Create a gain node
    const gainNode = ctx.createGain();
    gainNode.gain.value = MASTER_GAIN;
    
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
    source.connect(bandpassFilter1);
    bandpassFilter1.connect(bandpassFilter2);
    bandpassFilter2.connect(panner);
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
      console.log(`🔊 Calibration burst: freq=${this.calibrationFrequency.toFixed(0)}Hz (band: ${lowFreq.toFixed(0)}-${highFreq.toFixed(0)}Hz, BW=${this.FIXED_NOISE_BANDWIDTH.toFixed(2)})`);
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