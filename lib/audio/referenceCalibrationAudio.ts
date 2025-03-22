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
const ENVELOPE_RELEASE = 0.5; // seconds
const BURST_LENGTH = 0.15; // seconds

// Pattern timing
const BURST_INTERVAL = 0.3; // seconds between bursts
const ROW_PAUSE = 0.5; // pause between rows

// Filter settings
const DEFAULT_Q = 3.0; // Q for bandwidth
const BANDWIDTH_OCTAVE = 0.1; // Width of the band in octaves (0.5 = half octave)
const FILTER_SLOPE = 24; // Filter slope in dB/octave (24 = steep filter)

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
   * Set the calibration frequency
   * @param frequency Frequency in Hz
   */
  public setCalibrationFrequency(frequency: number): void {
    // Ensure frequency is in valid range
    const validFreq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, frequency));
    if (this.calibrationFrequency !== validFreq) {
      this.calibrationFrequency = validFreq;
      console.log(`🔊 Calibration frequency set to ${this.calibrationFrequency} Hz`);
      
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
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;
    console.log(`🔊 Reference calibration ${playing ? 'started' : 'stopped'}`);
    
    if (playing) {
      this.startPattern();
    } else {
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
    // Reset counters and start with reference row
    this.currentPosition = 0;
    this.isPlayingReference = true;
    
    // Schedule first burst
    this.scheduleNextBurst();
  }

  /**
   * Schedule the next noise burst
   */
  private scheduleNextBurst(): void {
    if (!this.isPlaying) return;
    
    // Get current pan position
    const panPosition = PANNING_POSITIONS[this.currentPosition];
    
    // Play the burst - reference or calibrated
    if (this.isPlayingReference) {
      this.playNoiseAtFrequency(REFERENCE_FREQ, panPosition, true);
    } else {
      this.playNoiseAtFrequency(this.calibrationFrequency, panPosition, false);
    }
    
    // Notify position listeners
    this.positionListeners.forEach(listener => 
      listener(panPosition, this.isPlayingReference)
    );
    
    // Increment position
    this.currentPosition++;
    
    // If we've reached the end of a row
    if (this.currentPosition >= PANNING_POSITIONS.length) {
      this.currentPosition = 0;
      
      // Toggle between reference and calibration
      this.isPlayingReference = !this.isPlayingReference;
    }
    
    // Determine the next interval
    // Add a longer pause between rows
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
    
    // Calculate frequency range for the band
    // Using equal temperament formula: f * 2^(n/12) where n is semitones
    const octaveRatio = Math.pow(2, BANDWIDTH_OCTAVE);
    const lowFreq = frequency / octaveRatio;
    const highFreq = frequency * octaveRatio;
    
    // Create a highpass filter (blocks frequencies below the cutoff)
    const highpassFilter = ctx.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = lowFreq;
    highpassFilter.Q.value = 1.0; // Q affects resonance at cutoff
    
    // Create a second highpass filter for steeper slope
    const highpassFilter2 = ctx.createBiquadFilter();
    highpassFilter2.type = 'highpass';
    highpassFilter2.frequency.value = lowFreq;
    highpassFilter2.Q.value = 0.7; // Slightly different Q for natural response
    
    // Create a lowpass filter (blocks frequencies above the cutoff)
    const lowpassFilter = ctx.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = highFreq;
    lowpassFilter.Q.value = 1.0;
    
    // Create a second lowpass filter for steeper slope
    const lowpassFilter2 = ctx.createBiquadFilter();
    lowpassFilter2.type = 'lowpass';
    lowpassFilter2.frequency.value = highFreq;
    lowpassFilter2.Q.value = 0.7;
    
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
    
    // Connect the audio chain - chaining filters for steeper slopes
    source.connect(highpassFilter);
    highpassFilter.connect(highpassFilter2);
    highpassFilter2.connect(lowpassFilter);
    lowpassFilter.connect(lowpassFilter2);
    lowpassFilter2.connect(panner);
    panner.connect(envelopeGain);
    envelopeGain.connect(gainNode);
    
    // Connect to proper destination based on whether this is reference or not
    if (isReference) {
      // Reference signal bypasses EQ and connects directly to main output
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
    
    // Start and automatically stop
    source.start();
    source.stop(now + BURST_LENGTH + ENVELOPE_RELEASE + 0.1);
    
    // Log the noise burst details
    console.log(`🔊 Noise burst: freq=${frequency.toFixed(0)}Hz (band: ${lowFreq.toFixed(0)}-${highFreq.toFixed(0)}Hz), pan=${pan.toFixed(2)}, reference=${isReference}`);
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    this.frequencyListeners = [];
    this.positionListeners = [];
    
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