import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
const DEFAULT_ROWS = 3; // Default number of frequency bands
const MIN_ROWS = 1; // Minimum number of rows
const MAX_ROWS = 7; // Maximum number of rows
const PAN_DURATION = 3.0; // Duration for a full pan cycle (left to right and back) in seconds
const MASTER_GAIN = 0.5; // Default gain level

// Frequency ranges for different numbers of rows
// These define the cutoff frequencies for each band based on the number of rows
const FREQUENCY_RANGES = {
  1: [[20, 20000]],  // Full spectrum for 1 row
  2: [[20, 500], [500, 20000]],  // 2 bands for 2 rows
  3: [[20, 250], [250, 2500], [2500, 20000]],  // 3 bands for 3 rows
  4: [[20, 200], [200, 1000], [1000, 5000], [5000, 20000]],  // 4 bands
  5: [[20, 150], [150, 500], [500, 2000], [2000, 8000], [8000, 20000]],  // 5 bands
  6: [[20, 120], [120, 300], [300, 1000], [1000, 3000], [3000, 9000], [9000, 20000]],  // 6 bands
  7: [[20, 100], [100, 250], [250, 700], [700, 2000], [2000, 5000], [5000, 12000], [12000, 20000]]  // 7 bands
};

// Class to manage pink noise calibration
class PinkNoiseCalibrator {
  private static instance: PinkNoiseCalibrator;
  private isPlaying: boolean = false;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private rowCount: number = DEFAULT_ROWS;
  private selectedRows: Set<number> = new Set(); // Set of selected row indices (0-based)
  private audioNodes: Map<number, {
    source: AudioBufferSourceNode;
    lowpassFilter: BiquadFilterNode;
    highpassFilter: BiquadFilterNode;
    panner: StereoPannerNode;
    gain: GainNode;
  }> = new Map();
  private panLFO: OscillatorNode | null = null;
  private preEQGain: GainNode | null = null;
  private preEQAnalyser: AnalyserNode | null = null;

  private constructor() {
    // Generate pink noise buffer on initialization
    this.generatePinkNoiseBuffer();
  }

  public static getInstance(): PinkNoiseCalibrator {
    if (!PinkNoiseCalibrator.instance) {
      PinkNoiseCalibrator.instance = new PinkNoiseCalibrator();
    }
    return PinkNoiseCalibrator.instance;
  }

  /**
   * Generate pink noise buffer
   */
  private async generatePinkNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Improved pink noise generation using Paul Kellet's refined method
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
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6) * 0.11;
    }
    
    // Normalize to avoid clipping
    let peak = 0;
    for (let i = 0; i < bufferSize; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor;
    }

    console.log(`🔊 Generated pink noise buffer: ${bufferSize} samples`);
    this.pinkNoiseBuffer = buffer;
  }

  /**
   * Set the number of rows (frequency bands)
   */
  public setRowCount(count: number): void {
    // Ensure count is within valid range
    count = Math.max(MIN_ROWS, Math.min(MAX_ROWS, count));
    
    if (count === this.rowCount) return;
    
    console.log(`🔊 Setting pink noise calibration rows to ${count}`);
    
    // Store the previous playing state
    const wasPlaying = this.isPlaying;
    
    // Stop if currently playing
    if (wasPlaying) {
      this.setPlaying(false);
    }
    
    this.rowCount = count;
    
    // Reset selected rows
    this.selectedRows.clear();
    
    // Resume playback if it was playing
    if (wasPlaying) {
      this.setPlaying(true);
    }
  }

  /**
   * Get the current row count
   */
  public getRowCount(): number {
    return this.rowCount;
  }

  /**
   * Toggle selection of a specific row
   */
  public toggleRow(rowIndex: number): void {
    // Ensure index is within range
    if (rowIndex < 0 || rowIndex >= this.rowCount) return;
    
    // Toggle the row selection
    if (this.selectedRows.has(rowIndex)) {
      this.selectedRows.delete(rowIndex);
    } else {
      this.selectedRows.add(rowIndex);
    }
    
    console.log(`🔊 Row ${rowIndex} selection toggled, ${this.selectedRows.size} rows selected`);
    
    // Update audio if playing
    if (this.isPlaying) {
      this.updatePlayingRows();
    }
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    console.log(`🔊 Setting pink noise calibration playing state: ${playing}`);
    
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
   * Get the set of selected rows
   */
  public getSelectedRows(): Set<number> {
    return new Set(this.selectedRows);
  }

  /**
   * Update which rows are playing based on selection
   */
  private updatePlayingRows(): void {
    const allRows = Array.from(Array(this.rowCount).keys()); // [0, 1, 2, ...]
    
    // If no rows are selected, play all rows
    const rowsToPlay = this.selectedRows.size === 0 ? allRows : Array.from(this.selectedRows);
    
    // Set gain for each row
    allRows.forEach(rowIndex => {
      const nodes = this.audioNodes.get(rowIndex);
      if (nodes) {
        // Set gain based on whether this row should play
        nodes.gain.gain.setTargetAtTime(
          rowsToPlay.includes(rowIndex) ? MASTER_GAIN : 0,
          audioContext.getAudioContext().currentTime,
          0.05 // Time constant
        );
      }
    });
    
    console.log(`🔊 Updated playing rows. Active: ${rowsToPlay.join(', ')}`);
  }

  /**
   * Start playback of pink noise
   */
  private startPlayback(): void {
    // Make sure we have a pink noise buffer
    if (!this.pinkNoiseBuffer) {
      console.warn('Pink noise buffer not ready');
      this.generatePinkNoiseBuffer();
      return;
    }
    
    const ctx = audioContext.getAudioContext();
    
    // Get destination node (either preEQGain or directly to EQ processor)
    const destinationNode = this.preEQGain ? 
      this.preEQGain as AudioNode : 
      eqProcessor.getEQProcessor().getInputNode();
    
    // Set up audio nodes for each row
    for (let i = 0; i < this.rowCount; i++) {
      // Create audio source
      const source = ctx.createBufferSource();
      source.buffer = this.pinkNoiseBuffer;
      source.loop = true;
      
      // Create filters
      const highpassFilter = ctx.createBiquadFilter();
      highpassFilter.type = 'highpass';
      highpassFilter.Q.value = 0.7071; // Butterworth response
      
      const lowpassFilter = ctx.createBiquadFilter();
      lowpassFilter.type = 'lowpass';
      lowpassFilter.Q.value = 0.7071; // Butterworth response
      
      // Set filter frequencies based on row index
      const [lowFreq, highFreq] = FREQUENCY_RANGES[this.rowCount as keyof typeof FREQUENCY_RANGES][i];
      highpassFilter.frequency.value = lowFreq;
      lowpassFilter.frequency.value = highFreq;
      
      // Create panner and gain nodes
      const panner = ctx.createStereoPanner();
      const gain = ctx.createGain();
      
      // Connect the chain
      source.connect(highpassFilter);
      highpassFilter.connect(lowpassFilter);
      lowpassFilter.connect(panner);
      panner.connect(gain);
      gain.connect(destinationNode);
      
      // Set initial gain to 0
      gain.gain.value = 0;
      
      // Start the source
      source.start();
      
      // Store nodes
      this.audioNodes.set(i, {
        source,
        highpassFilter,
        lowpassFilter,
        panner,
        gain
      });
      
      console.log(`🔊 Created pink noise source for row ${i} with range ${lowFreq}Hz - ${highFreq}Hz`);
    }
    
    // Create LFO for panning
    this.panLFO = ctx.createOscillator();
    this.panLFO.type = 'sine';
    this.panLFO.frequency.value = 1 / PAN_DURATION; // Cycle duration in Hz
    
    // Connect the LFO to all panners with a gain node to control depth
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.0; // Full panning range
    this.panLFO.connect(lfoGain);
    
    // Connect LFO to all panners
    for (let i = 0; i < this.rowCount; i++) {
      const nodes = this.audioNodes.get(i);
      if (nodes) {
        lfoGain.connect(nodes.panner.pan);
      }
    }
    
    // Start the LFO
    this.panLFO.start();
    
    // Update which rows should be playing
    this.updatePlayingRows();
  }

  /**
   * Stop playback of pink noise
   */
  private stopPlayback(): void {
    // Stop the LFO
    if (this.panLFO) {
      this.panLFO.stop();
      this.panLFO.disconnect();
      this.panLFO = null;
    }
    
    // Stop and disconnect all audio nodes
    this.audioNodes.forEach((nodes, rowIndex) => {
      try {
        nodes.source.stop();
        nodes.source.disconnect();
        nodes.gain.disconnect();
        nodes.panner.disconnect();
        nodes.lowpassFilter.disconnect();
        nodes.highpassFilter.disconnect();
      } catch (e) {
        console.error(`Error stopping source for row ${rowIndex}:`, e);
      }
    });
    
    // Clear audio nodes
    this.audioNodes.clear();
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
    
    this.pinkNoiseBuffer = null;
  }
}

/**
 * Get the singleton instance of the PinkNoiseCalibrator
 */
export function getPinkNoiseCalibrator(): PinkNoiseCalibrator {
  return PinkNoiseCalibrator.getInstance();
}

/**
 * Clean up the pink noise calibrator
 */
export function cleanupPinkNoiseCalibrator(): void {
  const calibrator = PinkNoiseCalibrator.getInstance();
  calibrator.dispose();
} 