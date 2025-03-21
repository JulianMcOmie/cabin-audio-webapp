import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
const MIN_FREQ = 20; // Hz
const MAX_FREQ = 20000; // Hz
const MASTER_GAIN = 0.8;

// Envelope settings
const ENVELOPE_ATTACK = 0.01; // seconds
const ENVELOPE_DECAY = 0.02; // seconds
const ENVELOPE_SUSTAIN = 0.8; // level
const ENVELOPE_RELEASE = 0.2; // seconds
const BURST_LENGTH = 0.15; // seconds

// Pattern timing
const BURST_INTERVAL = 0.3; // seconds between bursts
const GROUP_PAUSE = 0.5; // pause between groups

// Corner indices
enum Corner {
  BOTTOM_LEFT = 0,
  TOP_RIGHT = 1,
  BOTTOM_RIGHT = 2,
  TOP_LEFT = 3
}

// Observer pattern for corner activation
type CornerListener = (corner: Corner) => void;

class SquareCalibrationAudio {
  private static instance: SquareCalibrationAudio;
  private noiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private currentCorner: Corner = Corner.BOTTOM_LEFT;
  private cornerCount: number = 0;
  private timeoutId: number | null = null;
  private cornerListeners: CornerListener[] = [];
  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;
  
  // Square position and size (normalized 0-1)
  private squarePosition: [number, number] = [0.2, 0.2]; // [left, bottom]
  private squareSize: [number, number] = [0.6, 0.6]; // [width, height]

  private constructor() {
    // Initialize noise buffer
    this.generateNoiseBuffer();
  }

  public static getInstance(): SquareCalibrationAudio {
    if (!SquareCalibrationAudio.instance) {
      SquareCalibrationAudio.instance = new SquareCalibrationAudio();
    }
    return SquareCalibrationAudio.instance;
  }

  /**
   * Generate white noise buffer
   */
  private async generateNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate white noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    console.log(`🔊 Generated noise buffer: ${bufferSize} samples`);
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
   * Set the square position and size
   * @param position [left, bottom] normalized 0-1
   * @param size [width, height] normalized 0-1
   */
  public setSquare(position: [number, number], size: [number, number]): void {
    this.squarePosition = position;
    this.squareSize = size;
    console.log(`🔊 Square updated: pos=${position}, size=${size}`);
  }

  /**
   * Get the current square position and size
   */
  public getSquare(): { position: [number, number], size: [number, number] } {
    return {
      position: this.squarePosition,
      size: this.squareSize
    };
  }

  /**
   * Set playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;
    console.log(`🔊 Square calibration ${playing ? 'started' : 'stopped'}`);
    
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
   * Add a listener for corner activations
   */
  public addCornerListener(listener: CornerListener): void {
    this.cornerListeners.push(listener);
  }

  /**
   * Remove a corner listener
   */
  public removeCornerListener(listener: CornerListener): void {
    this.cornerListeners = this.cornerListeners.filter(l => l !== listener);
  }

  /**
   * Start the noise burst pattern
   */
  private startPattern(): void {
    // Reset counter and start with first corner
    this.currentCorner = Corner.BOTTOM_LEFT;
    this.cornerCount = 0;
    
    // Schedule first burst
    this.scheduleNextBurst();
  }

  /**
   * Schedule the next noise burst
   */
  private scheduleNextBurst(): void {
    if (!this.isPlaying) return;
    
    // Play current burst
    this.playNoiseAtCorner(this.currentCorner);
    
    // Notify listeners
    this.cornerListeners.forEach(listener => listener(this.currentCorner));
    
    // Update for next burst
    this.cornerCount++;
    
    // Determine next corner in pattern: 
    // (bottom-left, top-right) x4, (bottom-right, top-left) x4, repeat
    if (this.cornerCount % 8 < 4) {
      // First group: alternate between bottom-left and top-right
      this.currentCorner = this.cornerCount % 2 === 0 ? Corner.BOTTOM_LEFT : Corner.TOP_RIGHT;
    } else {
      // Second group: alternate between bottom-right and top-left
      this.currentCorner = this.cornerCount % 2 === 0 ? Corner.BOTTOM_RIGHT : Corner.TOP_LEFT;
    }
    
    // Add a pause between groups
    const nextInterval = this.cornerCount % 4 === 0 && this.cornerCount > 0 ? 
      GROUP_PAUSE : BURST_INTERVAL;
    
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
   * Play a noise burst at the specified corner
   */
  private playNoiseAtCorner(corner: Corner): void {
    if (!this.noiseBuffer) {
      console.warn('Noise buffer not ready');
      return;
    }
    
    const ctx = audioContext.getAudioContext();
    
    // Calculate position based on corner
    let xPos = 0, yPos = 0;
    
    switch (corner) {
      case Corner.BOTTOM_LEFT:
        xPos = this.squarePosition[0];
        yPos = this.squarePosition[1];
        break;
      case Corner.TOP_RIGHT:
        xPos = this.squarePosition[0] + this.squareSize[0];
        yPos = this.squarePosition[1] + this.squareSize[1];
        break;
      case Corner.BOTTOM_RIGHT:
        xPos = this.squarePosition[0] + this.squareSize[0];
        yPos = this.squarePosition[1];
        break;
      case Corner.TOP_LEFT:
        xPos = this.squarePosition[0];
        yPos = this.squarePosition[1] + this.squareSize[1];
        break;
    }
    
    // Clamp values to 0-1 range just in case
    xPos = Math.max(0, Math.min(1, xPos));
    yPos = Math.max(0, Math.min(1, yPos));
    
    // Create nodes
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    
    // Create a bandpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    
    // Map y position to frequency (logarithmic)
    const logMinFreq = Math.log2(MIN_FREQ);
    const logMaxFreq = Math.log2(MAX_FREQ);
    const logFreqRange = logMaxFreq - logMinFreq;
    const centerFreq = Math.pow(2, logMinFreq + yPos * logFreqRange);
    
    filter.frequency.value = centerFreq;
    
    // Bandwidth is proportional to square height
    // Smaller height = narrower bandwidth
    const Q = 2.0 + (1.0 - this.squareSize[1]) * 8.0; // Q from 2.0 to 10.0
    filter.Q.value = Q;
    
    // Create a panner
    const panner = ctx.createStereoPanner();
    
    // Map x position to panning
    // 0 = full left, 1 = full right
    const pan = xPos * 2 - 1; // Convert to -1 to 1 range
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
    source.connect(filter);
    filter.connect(panner);
    panner.connect(envelopeGain);
    envelopeGain.connect(gainNode);
    
    // Connect to the output destination
    if (this.preEQGain) {
      gainNode.connect(this.preEQGain);
    } else {
      const eq = eqProcessor.getEQProcessor();
      gainNode.connect(eq.getInputNode());
    }
    
    // Start and automatically stop
    source.start();
    source.stop(now + BURST_LENGTH + ENVELOPE_RELEASE + 0.1);
    
    // Log the noise burst details
    console.log(`🔊 Noise burst at corner ${Corner[corner]}: x=${xPos.toFixed(2)}, y=${yPos.toFixed(2)}, freq=${centerFreq.toFixed(0)}Hz, Q=${Q.toFixed(1)}, pan=${pan.toFixed(2)}`);
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    this.cornerListeners = [];
    
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

// Export Corner enum
export { Corner };

/**
 * Get the singleton instance of the SquareCalibrationAudio
 */
export function getSquareCalibrationAudio(): SquareCalibrationAudio {
  return SquareCalibrationAudio.getInstance();
}

/**
 * Clean up the square calibration audio
 */
export function cleanupSquareCalibrationAudio(): void {
  const player = SquareCalibrationAudio.getInstance();
  player.dispose();
} 