import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import * as pinkNoise from './pinkNoiseCalibration';

// Constants
const GRID_ROWS = 7; // Number of rows in the grid
const GRID_COLS = 9; // Number of columns in the grid
const MASTER_GAIN = 0.5; // Default gain level
const PULSE_RATE = 4.0; // Pulses per second (Hz)
const PAN_VALUES = [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8]; // Pan values for 9 columns

// Image definitions (1 = active pixel, 0 = inactive)
// These are simple patterns defined as 2D arrays
const IMAGE_PATTERNS = {
  H: [
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
  ],
  Z: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  SQUARE: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  ]
};

// Class to manage image noise calibration
class ImageNoiseCalibrator {
  private static instance: ImageNoiseCalibrator;
  private isPlaying: boolean = false;
  private currentImageKey: string = 'H'; // Default image
  private activeGrid: boolean[][] = []; // Current grid of active points
  private pinkNoiseCalibrator: ReturnType<typeof pinkNoise.getPinkNoiseCalibrator>;
  private audioNodes: Map<string, {
    source: AudioBufferSourceNode;
    lowpassFilter: BiquadFilterNode;
    highpassFilter: BiquadFilterNode;
    panner: StereoPannerNode;
    pulseGain: GainNode;
    gain: GainNode;
    rhythmTimer?: number;
  }> = new Map();
  private preEQGain: GainNode | null = null;
  private preEQAnalyser: AnalyserNode | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private globalRhythmTimer: number | null = null;

  private constructor() {
    this.pinkNoiseCalibrator = pinkNoise.getPinkNoiseCalibrator();
    this.resetGrid();
    this.setImagePattern(this.currentImageKey);
  }

  public static getInstance(): ImageNoiseCalibrator {
    if (!ImageNoiseCalibrator.instance) {
      ImageNoiseCalibrator.instance = new ImageNoiseCalibrator();
    }
    return ImageNoiseCalibrator.instance;
  }

  /**
   * Initialize a clean grid with all points inactive
   */
  private resetGrid(): void {
    this.activeGrid = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(false));
  }

  /**
   * Set the current image pattern
   * @param imageKey Key of the image pattern to use
   */
  public setImagePattern(imageKey: string): void {
    // Check if image key exists in our patterns
    if (!IMAGE_PATTERNS.hasOwnProperty(imageKey)) {
      console.warn(`Unknown image pattern: ${imageKey}`);
      return;
    }

    const wasPlaying = this.isPlaying;
    
    // Stop playback if currently playing
    if (wasPlaying) {
      this.setPlaying(false);
    }

    // Update current image key
    this.currentImageKey = imageKey;
    
    // Reset grid
    this.resetGrid();
    
    // Set active points based on pattern
    const pattern = IMAGE_PATTERNS[imageKey as keyof typeof IMAGE_PATTERNS];
    for (let row = 0; row < Math.min(GRID_ROWS, pattern.length); row++) {
      for (let col = 0; col < Math.min(GRID_COLS, pattern[row].length); col++) {
        this.activeGrid[row][col] = pattern[row][col] === 1;
      }
    }
    
    console.log(`🔊 Set image pattern to '${imageKey}'`);
    
    // Resume playback if it was playing
    if (wasPlaying) {
      this.setPlaying(true);
    }
  }

  /**
   * Get available image pattern keys
   */
  public getAvailableImagePatterns(): string[] {
    return Object.keys(IMAGE_PATTERNS);
  }

  /**
   * Get the current image key
   */
  public getCurrentImageKey(): string {
    return this.currentImageKey;
  }

  /**
   * Set a custom image pattern
   * @param pattern 2D array where 1 = active, 0 = inactive
   * @param name Optional name for the pattern
   */
  public setCustomImagePattern(pattern: number[][], name?: string): void {
    if (!pattern || !Array.isArray(pattern) || pattern.length === 0) {
      console.error('Invalid pattern format');
      return;
    }

    // Verify dimensions
    if (pattern.length > GRID_ROWS) {
      console.warn(`Pattern has more rows (${pattern.length}) than supported (${GRID_ROWS})`);
    }

    const wasPlaying = this.isPlaying;
    
    // Stop playback if currently playing
    if (wasPlaying) {
      this.setPlaying(false);
    }

    // Reset grid
    this.resetGrid();
    
    // Set active points based on pattern
    for (let row = 0; row < Math.min(GRID_ROWS, pattern.length); row++) {
      for (let col = 0; col < Math.min(GRID_COLS, pattern[row].length); col++) {
        this.activeGrid[row][col] = pattern[row][col] === 1;
      }
    }
    
    // If name provided, add to patterns
    if (name) {
      (IMAGE_PATTERNS as any)[name] = pattern;
      this.currentImageKey = name;
      console.log(`🔊 Added custom image pattern '${name}'`);
    } else {
      this.currentImageKey = 'CUSTOM';
      console.log(`🔊 Set custom image pattern`);
    }
    
    // Resume playback if it was playing
    if (wasPlaying) {
      this.setPlaying(true);
    }
  }

  /**
   * Toggle an individual grid point
   * @param row Row index (0-indexed)
   * @param col Column index (0-indexed)
   */
  public toggleGridPoint(row: number, col: number): void {
    // Check bounds
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      console.warn(`Invalid grid coordinates: (${row}, ${col})`);
      return;
    }
    
    // Toggle point
    this.activeGrid[row][col] = !this.activeGrid[row][col];
    
    // Set to custom pattern since we've modified it
    this.currentImageKey = 'CUSTOM';
    
    // Update playback if currently playing
    if (this.isPlaying) {
      this.updatePlayingGrid();
    }
  }

  /**
   * Get current grid state
   */
  public getGridState(): boolean[][] {
    return this.activeGrid.map(row => [...row]); // Return a copy to prevent external modifications
  }

  /**
   * Set playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    console.log(`🔊 Setting image noise playing state: ${playing}`);
    
    this.isPlaying = playing;
    
    if (playing) {
      this.startPlayback();
    } else {
      this.stopPlayback();
    }
  }

  /**
   * Get the current playing state
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Get a pink noise buffer (shared with the pink noise calibrator)
   */
  private getPinkNoiseBuffer(): AudioBuffer | null {
    // Try to access the buffer via the pinkNoiseCalibrator first
    const pinkNoiseBufferField = Object.entries(this.pinkNoiseCalibrator).find(([key]) => 
      key === 'pinkNoiseBuffer'
    );
    
    if (pinkNoiseBufferField && pinkNoiseBufferField[1]) {
      return pinkNoiseBufferField[1] as AudioBuffer;
    }
    
    // Fall back to the local buffer if available
    return this.pinkNoiseBuffer;
  }

  /**
   * Start playback of the current image pattern
   */
  private startPlayback(): void {
    // Get pink noise buffer
    const pinkNoiseBuffer = this.getPinkNoiseBuffer();
    if (!pinkNoiseBuffer) {
      console.warn('Pink noise buffer not ready');
      return;
    }
    
    const ctx = audioContext.getAudioContext();
    
    // Get destination node (either preEQGain or directly to EQ processor)
    const destinationNode = this.preEQGain ? 
      this.preEQGain as AudioNode : 
      eqProcessor.getEQProcessor().getInputNode();
    
    // Calculate frequency ranges using pink noise calibrator's logic
    const frequencyRanges = this.calculateFrequencyRanges();
    
    // Set up audio nodes for each active point in the grid
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (this.activeGrid[row][col]) {
          this.createAudioNodeForPoint(row, col, frequencyRanges[row], PAN_VALUES[col], pinkNoiseBuffer, destinationNode);
        }
      }
    }
    
    console.log(`🔊 Started playback of image pattern: ${this.currentImageKey}`);
  }

  /**
   * Calculate frequency ranges similar to how pink noise calibrator does it
   */
  private calculateFrequencyRanges(): [number, number][] {
    // Use logarithmic spacing to get perceptually uniform distribution
    const MIN_FREQ = 20;
    const MAX_FREQ = 20000;
    const logMinFreq = Math.log10(MIN_FREQ);
    const logMaxFreq = Math.log10(MAX_FREQ);
    const logStep = (logMaxFreq - logMinFreq) / GRID_ROWS;
    
    const ranges: [number, number][] = [];
    
    for (let i = 0; i < GRID_ROWS; i++) {
      const lowFreq = Math.pow(10, logMinFreq + i * logStep);
      const highFreq = Math.pow(10, logMinFreq + (i + 1) * logStep);
      ranges.push([lowFreq, highFreq]);
    }
    
    return ranges;
  }

  /**
   * Create audio node for a specific grid point
   */
  private createAudioNodeForPoint(
    row: number, 
    col: number, 
    freqRange: [number, number], 
    panValue: number, 
    buffer: AudioBuffer, 
    destinationNode: AudioNode
  ): void {
    const ctx = audioContext.getAudioContext();
    const nodeId = `${row}-${col}`;
    
    // Create audio source
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    
    // Create filters
    const highpassFilter = ctx.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.Q.value = 0.7071; // Butterworth response
    
    const lowpassFilter = ctx.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.Q.value = 0.7071; // Butterworth response
    
    // Set filter frequencies based on row
    const [lowFreq, highFreq] = freqRange;
    highpassFilter.frequency.value = lowFreq;
    lowpassFilter.frequency.value = highFreq;
    
    // Create panner, pulse gain, and final gain nodes
    const panner = ctx.createStereoPanner();
    panner.pan.value = panValue;
    
    const pulseGain = ctx.createGain();
    const gain = ctx.createGain();
    
    // Connect the chain
    source.connect(highpassFilter);
    highpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(panner);
    panner.connect(pulseGain);
    pulseGain.connect(gain);
    gain.connect(destinationNode);
    
    // Set initial gain values
    pulseGain.gain.value = 1.0; // Start at full volume
    gain.gain.value = MASTER_GAIN; // Set to master gain level
    
    // Get a rhythm pattern based on grid position
    // We'll vary the rhythm pattern based on position to create more distinct spatial cues
    const rhythmPattern = this.getRhythmPatternForPoint(row, col);
    
    // Start the source
    source.start();
    
    // Store the nodes
    this.audioNodes.set(nodeId, {
      source,
      highpassFilter,
      lowpassFilter,
      panner,
      pulseGain,
      gain,
      rhythmPattern,
    });
    
    console.log(`🔊 Created pink noise source for point (${row}, ${col}) with range ${lowFreq.toFixed(1)}Hz - ${highFreq.toFixed(1)}Hz, pan ${panValue}`);
  }

  /**
   * Get a rhythm pattern for a specific grid point
   * This creates varied rhythms for different points to help with spatial distinction
   */
  private getRhythmPatternForPoint(row: number, col: number): number[] {
    // Get patterns from the pink noise module
    const RHYTHM_PATTERNS = [
      // Pattern 1: Constant 4/4 (quarter notes)
      [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      
      // Pattern 2: Triplets (4/4 with triplet feel)
      [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      
      // Pattern 3: Dotted eighth - dotted eighth - eighth (jersey club beat)
      [1, 0, 0, 1, 0, 0, 1, 0],
      
      // Pattern 4: Eighth - eighth - rest - rest
      [1, 0, 1, 0, 0, 0, 0, 0],
      
      // Pattern 5: Eighth - rest - eighth - eighth
      [1, 0, 0, 0, 1, 0, 1, 0],
      
      // Additional patterns
      [1, 0, 1, 0, 1, 0, 0, 0], // Pattern 6: Eighth - eighth - eighth - rest
      [1, 1, 0, 0, 1, 0, 0, 0]  // Pattern 7: Sixteenth - sixteenth - rest - rest - eighth - rest
    ];
    
    // Select pattern based on position
    // We'll alternate patterns to create more spatial variation
    const patternIndex = (row + col) % RHYTHM_PATTERNS.length;
    return RHYTHM_PATTERNS[patternIndex];
  }

  /**
   * Update which grid points are playing
   */
  private updatePlayingGrid(): void {
    if (!this.isPlaying) return;
    
    this.stopPlayback();
    this.startPlayback();
  }

  /**
   * Stop playback of all audio nodes
   */
  private stopPlayback(): void {
    // Stop all audio nodes
    this.audioNodes.forEach((nodes, nodeId) => {
      try {
        nodes.source.stop();
        nodes.source.disconnect();
        nodes.gain.disconnect();
        nodes.pulseGain.disconnect();
        nodes.panner.disconnect();
        nodes.lowpassFilter.disconnect();
        nodes.highpassFilter.disconnect();
        
        // Clear any rhythm timer
        if (nodes.rhythmTimer) {
          clearInterval(nodes.rhythmTimer);
        }
      } catch (e) {
        console.error(`Error stopping source for node ${nodeId}:`, e);
      }
    });
    
    // Clear audio nodes
    this.audioNodes.clear();
    
    // Stop the global rhythm timer
    if (this.globalRhythmTimer !== null) {
      clearInterval(this.globalRhythmTimer);
      this.globalRhythmTimer = null;
    }
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
      
      // If already playing, we need to reconnect all sources
      if (this.isPlaying) {
        this.stopPlayback();
        this.startPlayback();
      }
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
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    
    // Clean up analyzer nodes
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
    }
    
    if (this.preEQAnalyser) {
      this.preEQAnalyser.disconnect();
      this.preEQAnalyser = null;
    }
  }
}

/**
 * Get the singleton instance of the ImageNoiseCalibrator
 */
export function getImageNoiseCalibrator(): ImageNoiseCalibrator {
  return ImageNoiseCalibrator.getInstance();
}

/**
 * Clean up the image noise calibrator
 */
export function cleanupImageNoiseCalibrator(): void {
  const calibrator = ImageNoiseCalibrator.getInstance();
  calibrator.dispose();
} 