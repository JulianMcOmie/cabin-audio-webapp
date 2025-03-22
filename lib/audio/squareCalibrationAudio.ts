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
const ENVELOPE_RELEASE = 0.4; // seconds
const BURST_LENGTH = 0.15; // seconds

// Pattern timing
const BURST_INTERVAL = 0.3; // seconds between bursts (reduced from 0.3 to make it faster)
const GROUP_PAUSE = 0.3; // pause between groups (reduced from 0.5)

// Filter settings
const MIN_Q = 2.0;   // Minimum Q value (wider bandwidth)
const MAX_Q = 4.0;  // Maximum Q value (narrower bandwidth)

// Corner indices
enum Corner {
  BOTTOM_LEFT = 0,
  TOP_RIGHT = 1,
  BOTTOM_RIGHT = 2,
  TOP_LEFT = 3
}

// Position along a diagonal
interface DiagonalPosition {
  x: number;
  y: number;
}

// Observer pattern for corner activation
type CornerListener = (corner: Corner) => void;
// Observer for intermediate position activation
type PositionListener = (position: DiagonalPosition, isCorner: boolean, diagonalIndex: number) => void;

class SquareCalibrationAudio {
  private static instance: SquareCalibrationAudio;
  private noiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private currentCorner: Corner = Corner.BOTTOM_LEFT;
  private cornerCount: number = 0;
  private timeoutId: number | null = null;
  private cornerListeners: CornerListener[] = [];
  private positionListeners: PositionListener[] = [];
  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;
  
  // Square position and size (normalized 0-1)
  private squarePosition: [number, number] = [0.2, 0.2]; // [left, bottom]
  private squareSize: [number, number] = [0.6, 0.6]; // [width, height]
  
  // Dot density - number of dots per diagonal (2 = corners only, 3-5 = additional intermediate points)
  private dotDensity: number = 2;
  
  // Current position index along the diagonal
  private currentPositionIndex: number = 0;
  
  // Current diagonal index (0 = bottom-left to top-right, 1 = bottom-right to top-left)
  private currentDiagonalIndex: number = 0;

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
   * Set the dot density (number of dots per diagonal)
   * @param density Number between 2-5 
   */
  public setDotDensity(density: number): void {
    // Ensure density is between 2-5
    const validDensity = Math.max(2, Math.min(5, Math.floor(density)));
    if (this.dotDensity !== validDensity) {
      this.dotDensity = validDensity;
      console.log(`🔊 Dot density set to ${this.dotDensity}`);
    }
  }
  
  /**
   * Get the current dot density
   */
  public getDotDensity(): number {
    return this.dotDensity;
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
   * Add a listener for position activations (including intermediate points)
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
    // Reset counters and start with first diagonal
    this.currentDiagonalIndex = 0;
    this.currentPositionIndex = 0;
    this.cornerCount = 0;
    
    // Schedule first burst
    this.scheduleNextBurst();
  }

  /**
   * Schedule the next noise burst
   */
  private scheduleNextBurst(): void {
    if (!this.isPlaying) return;
    
    // Calculate the current position along the diagonal
    const position = this.getPositionAlongDiagonal(
      this.currentDiagonalIndex, 
      this.currentPositionIndex, 
      this.dotDensity
    );
    
    // Play noise at the calculated position
    this.playNoiseAtPosition(position);
    
    // If this is a corner position, notify corner listeners too
    const isCornerPosition = this.currentPositionIndex === 0 || 
                            this.currentPositionIndex === this.dotDensity - 1;
    
    if (isCornerPosition) {
      // Determine which corner this is
      let corner: Corner;
      if (this.currentDiagonalIndex === 0) {
        // First diagonal (bottom-left to top-right)
        corner = this.currentPositionIndex === 0 ? Corner.BOTTOM_LEFT : Corner.TOP_RIGHT;
      } else {
        // Second diagonal (bottom-right to top-left)
        corner = this.currentPositionIndex === 0 ? Corner.BOTTOM_RIGHT : Corner.TOP_LEFT;
      }
      
      // Notify corner listeners
      this.cornerListeners.forEach(listener => listener(corner));
    }
    
    // Notify position listeners
    this.positionListeners.forEach(listener => 
      listener(position, isCornerPosition, this.currentDiagonalIndex)
    );
    
    // Increment position index
    this.currentPositionIndex++;
    
    // If we've reached the end of the current diagonal
    if (this.currentPositionIndex >= this.dotDensity) {
      this.currentPositionIndex = 0;
      
      // Increment corner count - used to track repeats of the pattern
      this.cornerCount++;
      
      // After 4 complete cycles of a diagonal, switch to the other diagonal
      if (this.cornerCount % 4 === 0) {
        this.currentDiagonalIndex = (this.currentDiagonalIndex + 1) % 2;
      }
    }
    
    // Determine the next interval
    // Add a small pause between diagonals
    const isDigaonalTransition = this.currentPositionIndex === 0 && this.cornerCount % 4 === 0 && this.cornerCount > 0;
    const nextInterval = isDigaonalTransition ? GROUP_PAUSE : BURST_INTERVAL;
    
    // Schedule next burst
    this.timeoutId = window.setTimeout(() => {
      this.scheduleNextBurst();
    }, nextInterval * 1000);
  }
  
  /**
   * Calculate a position along a diagonal
   * @param diagonalIndex 0 for bottom-left to top-right, 1 for bottom-right to top-left
   * @param positionIndex Position along the diagonal (0 to density-1)
   * @param density Number of points along the diagonal
   */
  private getPositionAlongDiagonal(
    diagonalIndex: number, 
    positionIndex: number, 
    density: number
  ): DiagonalPosition {
    // Corners of the square
    const corners = [
      { x: this.squarePosition[0], y: this.squarePosition[1] },                               // Bottom-left
      { x: this.squarePosition[0] + this.squareSize[0], y: this.squarePosition[1] + this.squareSize[1] }, // Top-right
      { x: this.squarePosition[0] + this.squareSize[0], y: this.squarePosition[1] },                     // Bottom-right
      { x: this.squarePosition[0], y: this.squarePosition[1] + this.squareSize[1] }                      // Top-left
    ];
    
    // Calculate the interpolation factor
    const t = density > 1 ? positionIndex / (density - 1) : 0;
    
    // Get the start and end corners for the current diagonal
    let startCorner, endCorner;
    if (diagonalIndex === 0) {
      // First diagonal: bottom-left to top-right
      startCorner = corners[0]; // Bottom-left
      endCorner = corners[1];   // Top-right
    } else {
      // Second diagonal: bottom-right to top-left
      startCorner = corners[2]; // Bottom-right
      endCorner = corners[3];   // Top-left
    }
    
    // Interpolate between start and end corners
    return {
      x: startCorner.x + t * (endCorner.x - startCorner.x),
      y: startCorner.y + t * (endCorner.y - startCorner.y)
    };
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
   * Play a noise burst at a specific position
   */
  private playNoiseAtPosition(position: DiagonalPosition): void {
    if (!this.noiseBuffer) {
      console.warn('Noise buffer not ready');
      return;
    }
    
    const ctx = audioContext.getAudioContext();
    
    // Clamp values to 0-1 range just in case
    const xPos = Math.max(0, Math.min(1, position.x));
    const yPos = Math.max(0, Math.min(1, position.y));
    
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
    
    // Bandwidth is inversely proportional to square height
    // Smaller height = much higher Q (narrower bandwidth)
    // Use exponential scaling for more dramatic effect at small heights
    const normalizedHeight = this.squareSize[1]; // 0 to 1
    const heightFactor = Math.pow(1 - normalizedHeight, 2); // Square it for more dramatic effect at smaller heights
    const Q = MIN_Q + heightFactor * (MAX_Q - MIN_Q);
    
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
    console.log(`🔊 Noise burst at position: x=${xPos.toFixed(2)}, y=${yPos.toFixed(2)}, freq=${centerFreq.toFixed(0)}Hz, Q=${Q.toFixed(1)}, pan=${pan.toFixed(2)}`);
  }
  
  /**
   * Play a noise burst at the specified corner
   * NOTE: Kept for backward compatibility
   */
  private playNoiseAtCorner(corner: Corner): void {
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
    
    this.playNoiseAtPosition({ x: xPos, y: yPos });
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    this.cornerListeners = [];
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

// Export Corner enum
export { Corner };
export type { DiagonalPosition };

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