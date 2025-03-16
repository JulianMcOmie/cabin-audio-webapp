import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { getFrequencyResponseSynthesizer } from './frequencyResponseSynthesizer';

type DotPosition = {
  x: number;
  y: number;
};

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const MASTER_GAIN = 1.0; // Master gain for calibration

// Polyrhythm settings
const BASE_CYCLE_TIME = 2.0; // Base cycle time in seconds
const MIN_SUBDIVISION = 2; // Minimum subdivision (lower dots)
const MAX_SUBDIVISION = 16; // Maximum subdivision (higher dots)

// Sequential playback settings
const DOT_TIMING = 0.2; // Time between dots in sequential mode (seconds)

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Slope settings for frequency response
const MIN_SLOPE = -6; // dB/octave for lowest dots (steeper low-frequency emphasis)
const MID_SLOPE = -3; // dB/octave for middle dots (pink noise)
const MAX_SLOPE = 0;  // dB/octave for highest dots (white noise)

// Playback mode enum
export enum PlaybackMode {
  POLYRHYTHM = 'polyrhythm',
  SEQUENTIAL = 'sequential'
}

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private clickBuffers: Map<number, AudioBuffer> = new Map(); // Cache for click buffers with different slopes
  private isPlaying: boolean = false;
  private audioNodes: Map<string, {
    // No more need for source and envelope since we're only using clicks
    gain: GainNode;
    panner: StereoPannerNode;
    filter: BiquadFilterNode;
    position: number; // Position for sorting
    rhythmInterval: number | null; // Rhythm interval ID
    subdivision: number; // Rhythm subdivision
    nextTriggerTime: number; // Next time to trigger this dot
    offset: number; // Offset within the row's rhythm (0-1)
    slope: number; // Spectral slope in dB/octave
  }> = new Map();
  private gridSize: number = 3; // Default row count
  private columnCount: number = COLUMNS; // Default column count
  private masterTimerId: number | null = null;
  private startTime: number = 0; // When playback started
  private preEQAnalyser: AnalyserNode | null = null; // Pre-EQ analyzer node
  private preEQGain: GainNode | null = null; // Gain node for connecting all sources to analyzer
  
  // Sequential playback properties
  private playbackMode: PlaybackMode = PlaybackMode.POLYRHYTHM; // Default to polyrhythm mode
  private sequenceTimer: number | null = null; // Timer for sequential playback
  private sequenceIndex: number = 0; // Current index in the sequence
  private orderedDots: string[] = []; // Dots ordered for sequential playback
  
  // Track initialization status
  private initializeBuffersPromise: Promise<void> = Promise.resolve();

  private constructor() {
    // Initialize click buffers
    this.initializeBuffersPromise = this.initializeBuffers().catch(error => {
      console.error('Failed to initialize audio buffers:', error);
    });
  }

  public static async getInstance(): Promise<DotGridAudioPlayer> {
    if (!DotGridAudioPlayer.instance) {
      DotGridAudioPlayer.instance = new DotGridAudioPlayer();
      // Wait for buffers to initialize
      await DotGridAudioPlayer.instance.initializeBuffersPromise;
    }
    return DotGridAudioPlayer.instance;
  }

  // For backward compatibility with synchronous code
  public static getInstanceSync(): DotGridAudioPlayer {
    if (!DotGridAudioPlayer.instance) {
      DotGridAudioPlayer.instance = new DotGridAudioPlayer();
      // Note: Buffers may not be ready yet when using this method
      console.warn('🔊 Warning: Using synchronous getInstance - audio buffers may not be ready');
    }
    return DotGridAudioPlayer.instance;
  }

  /**
   * Initialize the click buffers for each spectral slope
   */
  private async initializeBuffers(): Promise<void> {
    const synthesizer = getFrequencyResponseSynthesizer();
    
    // Generate a range of slopes from MIN_SLOPE to MAX_SLOPE
    const slopes = [MIN_SLOPE, -4.5, MID_SLOPE, -1.5, MAX_SLOPE];
    
    // Generate click buffers for each slope
    const clickPromises = slopes.map(async slope => {
      try {
        const buffer = await synthesizer.generateClick(slope);
        this.clickBuffers.set(slope, buffer);
        console.log(`🔊 Generated click buffer with slope ${slope} dB/octave`);
      } catch (error) {
        console.error(`Error generating click buffer with slope ${slope}:`, error);
      }
    });
    
    // Wait for all buffers to be generated
    await Promise.all(clickPromises);
    console.log('🔊 All click buffers generated successfully');
  }

  /**
   * Set the playback mode
   */
  public setPlaybackMode(mode: PlaybackMode): void {
    if (this.playbackMode === mode) return;
    
    console.log(`🔊 Switching playback mode to: ${mode}`);
    
    // Store the previous playing state
    const wasPlaying = this.isPlaying;
    
    // Stop current playback
    if (wasPlaying) {
      this.setPlaying(false);
    }
    
    // Update mode
    this.playbackMode = mode;
    
    // Resume playback if it was playing
    if (wasPlaying) {
      this.setPlaying(true);
    }
  }
  
  /**
   * Get the current playback mode
   */
  public getPlaybackMode(): PlaybackMode {
    return this.playbackMode;
  }

  /**
   * Set the current grid size
   */
  public setGridSize(rows: number, columns?: number): void {
    this.gridSize = rows;
    
    if (columns !== undefined && columns !== this.columnCount) {
      this.columnCount = columns;
    }
    
    console.log(`🔊 Grid size set to ${this.gridSize} rows × ${this.columnCount} columns`);
    
    // Update playback based on current mode
    if (this.isPlaying) {
      if (this.playbackMode === PlaybackMode.POLYRHYTHM) {
        this.stopAllRhythms();
        this.startAllRhythms();
      } else {
        // For sequential mode, update the ordered dots
        this.updateOrderedDots();
      }
    }
  }

  /**
   * Calculate spectral slope based on vertical position
   * @param normalizedY Normalized Y position (0 = bottom, 1 = top)
   * @returns Spectral slope in dB/octave
   */
  private calculateSpectralSlope(normalizedY: number): number {
    // Linear interpolation between MIN_SLOPE and MAX_SLOPE based on position
    const slope = MIN_SLOPE + normalizedY * (MAX_SLOPE - MIN_SLOPE);
    
    // Round to nearest 0.5 dB/octave for caching purposes
    return Math.round(slope * 2) / 2;
    // return 3;
  }

  /**
   * Get the closest precomputed slope from the cache
   * @param targetSlope The desired slope
   * @returns The closest available slope
   */
  private getClosestSlope(targetSlope: number): number {
    // Get all available slopes
    const availableSlopes = Array.from(this.clickBuffers.keys());
    
    if (availableSlopes.length === 0) {
      // Return pink noise slope if no buffers are available yet
      return MID_SLOPE;
    }
    
    // Find the closest slope
    let closestSlope = availableSlopes[0];
    let closestDistance = Math.abs(targetSlope - closestSlope);
    
    for (let i = 1; i < availableSlopes.length; i++) {
      const distance = Math.abs(targetSlope - availableSlopes[i]);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSlope = availableSlopes[i];
      }
    }
    
    return closestSlope;
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
      this.preEQAnalyser.fftSize = FFT_SIZE;
      this.preEQAnalyser.smoothingTimeConstant = SMOOTHING;
      
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
   * Update the set of active dots
   */
  public updateDots(dots: Set<string>, currentGridSize?: number, currentColumns?: number): void {
    console.log(`🔊 Updating dots: ${dots.size} selected`);
    
    // Update grid size if provided
    if (currentGridSize && currentGridSize !== this.gridSize) {
      this.setGridSize(currentGridSize, currentColumns);
    }
    
    // Get current dots
    const currentDots = new Set(this.audioNodes.keys());
    
    // Remove dots that are no longer selected
    currentDots.forEach(dotKey => {
      if (!dots.has(dotKey)) {
        this.removeDot(dotKey);
      }
    });
    
    // Add new dots
    dots.forEach(dotKey => {
      if (!this.audioNodes.has(dotKey)) {
        this.addDot(dotKey);
      }
    });
    
    // Calculate offsets for dots in the same row
    this.calculateRowOffsets();
    
    // Update ordered dots for sequential playback
    this.updateOrderedDots();
    
    // If playing, restart based on playback mode
    if (this.isPlaying) {
      if (this.playbackMode === PlaybackMode.POLYRHYTHM) {
        this.stopAllRhythms();
        this.startAllRhythms();
      } else {
        this.stopSequence();
        this.startSequence();
      }
    }
  }
  
  /**
   * Calculate timing offsets for dots in the same row
   */
  private calculateRowOffsets(): void {
    // Group dots by row
    const dotsByRow = new Map<number, string[]>();
    
    // Collect all dots by row
    this.audioNodes.forEach((_, dotKey) => {
      const [x, y] = dotKey.split(',').map(Number);
      if (!dotsByRow.has(y)) {
        dotsByRow.set(y, []);
      }
      dotsByRow.get(y)?.push(dotKey);
    });
    
    // For each row, assign evenly distributed offsets
    dotsByRow.forEach((dotsInRow, rowIndex) => {
      // Sort dots by x-coordinate for consistent assignment
      dotsInRow.sort((a, b) => {
        const xA = parseInt(a.split(',')[0]);
        const xB = parseInt(b.split(',')[0]);
        return xA - xB;
      });
      
      // Assign evenly distributed offsets (0 to just under 1)
      dotsInRow.forEach((dotKey, index) => {
        const nodes = this.audioNodes.get(dotKey);
        if (nodes) {
          // If only one dot, no offset needed
          if (dotsInRow.length === 1) {
            nodes.offset = 0;
          } else {
            // Distribute offsets evenly from 0 to 0.999...
            nodes.offset = index / dotsInRow.length;
          }
        }
      });
      
      console.log(`🔊 Row ${rowIndex}: assigned offsets to ${dotsInRow.length} dots`);
    });
  }

  /**
   * Update the ordered dots for sequential playback
   */
  private updateOrderedDots(): void {
    // Get all dot keys
    const dotKeys = Array.from(this.audioNodes.keys());
    
    // Parse the keys into x,y coordinates for sorting
    const dots = dotKeys.map(key => {
      const [x, y] = key.split(',').map(Number);
      return { key, x, y };
    });
    
    // Sort in reading order (top-to-bottom, left-to-right)
    dots.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y; // Sort by row first
      return a.x - b.x; // Then by column
    });
    
    // Extract the sorted keys
    this.orderedDots = dots.map(dot => dot.key);
    
    console.log(`🔊 Updated ordered dots for sequential playback: ${this.orderedDots.length} dots`);
  }

  /**
   * Calculate subdivision based on vertical position
   * Higher dots (smaller y values) get more subdivisions
   */
  private calculateSubdivision(y: number): number {
    // Invert y to make higher dots have more subdivisions
    // Normalize to 0-1 range
    const normalizedY = 1 - (y / (this.gridSize - 1));
    
    // Calculate subdivision - higher dots get more subdivisions
    const subdivision = Math.floor(MIN_SUBDIVISION + normalizedY * (MAX_SUBDIVISION - MIN_SUBDIVISION));
    
    // Use musically useful subdivisions: 2, 3, 4, 5, 6, 8, 12, 16
    // Find the closest musically useful subdivision
    const musicalSubdivisions = [2, 3, 4, 5, 6, 8, 12, 16];
    let closestSubdivision = musicalSubdivisions[0];
    let closestDistance = Math.abs(subdivision - closestSubdivision);
    
    for (let i = 1; i < musicalSubdivisions.length; i++) {
      const distance = Math.abs(subdivision - musicalSubdivisions[i]);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSubdivision = musicalSubdivisions[i];
      }
    }
    
    return closestSubdivision;
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    console.log(`🔊 Setting playing state: ${playing}`);
    
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;
    
    if (playing) {
      this.startTime = Date.now() / 1000; // Start time in seconds
      
      // Start the appropriate playback based on mode
      if (this.playbackMode === PlaybackMode.POLYRHYTHM) {
        this.startAllRhythms();
      } else {
        this.startSequence();
      }
    } else {
      // Stop the appropriate playback based on mode
      if (this.playbackMode === PlaybackMode.POLYRHYTHM) {
        this.stopAllRhythms();
      } else {
        this.stopSequence();
      }
    }
  }

  /**
   * Start sequential playback
   */
  private startSequence(): void {
    // Reset sequence index
    this.sequenceIndex = 0;
    
    // If no dots, do nothing
    if (this.orderedDots.length === 0) return;
    
    console.log(`🔊 Starting sequential playback with ${this.orderedDots.length} dots`);
    
    // Start the sequence timer
    this.advanceSequence(); // Play the first dot immediately
    
    // Set up timer for subsequent dots
    this.sequenceTimer = window.setInterval(() => {
      this.advanceSequence();
    }, DOT_TIMING * 1000);
  }
  
  /**
   * Advance the sequence to the next dot
   */
  private advanceSequence(): void {
    // If no dots, do nothing
    if (this.orderedDots.length === 0) return;
    
    // Get the current dot key
    const dotKey = this.orderedDots[this.sequenceIndex];
    
    // Play a click for this dot
    this.playClickForDot(dotKey);
    
    // Advance to the next dot
    this.sequenceIndex = (this.sequenceIndex + 1) % this.orderedDots.length;
  }
  
  /**
   * Stop sequential playback
   */
  private stopSequence(): void {
    if (this.sequenceTimer !== null) {
      window.clearInterval(this.sequenceTimer);
      this.sequenceTimer = null;
    }
    
    this.sequenceIndex = 0;
  }

  /**
   * Start all rhythm timers
   */
  private startAllRhythms(): void {
    // Start the master timer that checks all dots
    this.masterTimerId = window.setInterval(() => {
      this.checkAndTriggerDots();
    }, 10); // Check every 10ms for precision
    
    // Initialize next trigger times with proper offsets
    const now = Date.now() / 1000; // Current time in seconds
    this.audioNodes.forEach((nodes, dotKey) => {
      const baseInterval = BASE_CYCLE_TIME / nodes.subdivision;
      // Apply the offset to stagger dots in the same row
      const offsetTime = baseInterval * nodes.offset;
      nodes.nextTriggerTime = now + offsetTime;
    });
    
    console.log(`🔊 Started polyrhythm system with cycle time: ${BASE_CYCLE_TIME}s`);
  }
  
  /**
   * Check all dots and trigger them if it's their time
   */
  private checkAndTriggerDots(): void {
    const now = Date.now() / 1000; // Current time in seconds
    
    this.audioNodes.forEach((nodes, dotKey) => {
      if (now >= nodes.nextTriggerTime) {
        // Play a click for this dot
        this.playClickForDot(dotKey);
        
        // Calculate time for next trigger
        const interval = BASE_CYCLE_TIME / nodes.subdivision;
        nodes.nextTriggerTime = nodes.nextTriggerTime + interval;
        
        // If we've fallen behind significantly, reset to now plus interval
        if (nodes.nextTriggerTime < now) {
          nodes.nextTriggerTime = now + interval;
        }
      }
    });
  }
  
  /**
   * Stop all rhythm timers
   */
  private stopAllRhythms(): void {
    if (this.masterTimerId !== null) {
      window.clearInterval(this.masterTimerId);
      this.masterTimerId = null;
    }
  }

  /**
   * Play a click sound with the appropriate spectral slope for a dot
   */
  private playClickForDot(dotKey: string): void {
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    const ctx = audioContext.getAudioContext();
    const clickBuffer = this.getClickBufferForSlope(nodes.slope);
    
    if (!clickBuffer) {
      console.warn(`No click buffer available for slope ${nodes.slope}`);
      return;
    }
    
    // Create a source for the click
    const clickSource = ctx.createBufferSource();
    clickSource.buffer = clickBuffer;
    
    // Create a gain node for the click
    const clickGain = ctx.createGain();
    clickGain.gain.value = MASTER_GAIN; // Full volume for the click
    
    // Get the destination node (either preEQGain or directly to EQ processor)
    const destinationNode = this.preEQGain ? 
      this.preEQGain as AudioNode : 
      eqProcessor.getEQProcessor().getInputNode();
    
    // Connect through the audio path without applying the IIR filter
    // Skip the filter since the frequency response is already in the synthesized click
    clickSource.connect(nodes.panner);
    nodes.panner.connect(clickGain);
    clickGain.connect(nodes.gain);
    
    // Connect to destination
    nodes.gain.connect(destinationNode);
    
    // Start the click (one-shot playback)
    clickSource.start();
    
    // Clean up when done
    clickSource.onended = () => {
      clickSource.disconnect();
      clickGain.disconnect();
      nodes.gain.disconnect();
    };
    
    // Visual feedback via console
    console.log(`🔊 Played click for dot ${dotKey} with subdivision ${nodes.subdivision} and slope ${nodes.slope}`);
  }
  
  /**
   * Get the appropriate click buffer for a given spectral slope
   */
  private getClickBufferForSlope(slope: number): AudioBuffer | undefined {
    // Find the closest precomputed slope
    const closestSlope = this.getClosestSlope(slope);
    return this.clickBuffers.get(closestSlope);
  }

  /**
   * Add a new dot to the audio system
   */
  private addDot(dotKey: string): void {
    console.log(`🔊 Adding dot: ${dotKey}`);
    
    const [x, y] = dotKey.split(',').map(Number);
    
    // Create audio nodes for this dot
    const ctx = audioContext.getAudioContext();
    
    // Normalize y to 0-1 range (0 = bottom, 1 = top)
    const normalizedY = 1 - (y / (this.gridSize - 1)); // Flip so higher y = higher position
    
    // Calculate the frequency for this position
    const minFreq = 60;
    const maxFreq = 15000;
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Calculate spectral slope based on vertical position
    const spectralSlope = this.calculateSpectralSlope(normalizedY);
    
    // Create a gain node for volume
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN;
    
    // Create a panner node for stereo positioning
    const panner = ctx.createStereoPanner();
    // Normalize x position based on columns (0 to columnCount-1)
    const normalizedX = (x / (this.columnCount - 1)) * 2 - 1; // Convert to range -1 to 1
    panner.pan.value = normalizedX;
    
    // Create a bandpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerFreq;
    
    // Calculate Q (bandwidth)
    const distFromCenter = Math.abs(normalizedY - 0.5) * 2;
    
    // Frequency-dependent Q adjustment - wider bandwidth for extremes
    const minQ = 0.5;
    const maxQ = 0.5;
    filter.Q.value = maxQ;
    
    // Calculate position for sorting
    const position = y * this.columnCount + x;
    
    // Calculate subdivision based on vertical position
    const subdivision = this.calculateSubdivision(y);
    
    // Store the nodes
    this.audioNodes.set(dotKey, {
      gain,
      panner,
      filter,
      position, // Store position for sorting
      rhythmInterval: null, // Rhythm interval ID
      subdivision, // Subdivision for this dot
      nextTriggerTime: 0, // Will be set when playback starts
      offset: 0, // Default offset, will be updated by calculateRowOffsets
      slope: spectralSlope // Spectral slope for this dot
    });
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Pan: ${normalizedX.toFixed(2)}`);
    console.log(`   Position: ${normalizedY.toFixed(2)}`);
    console.log(`   Center frequency: ${centerFreq.toFixed(0)}Hz`);
    console.log(`   Bandwidth (Q): ${filter.Q.value.toFixed(2)}`);
    console.log(`   Subdivision: ${subdivision}`);
    console.log(`   Spectral slope: ${spectralSlope.toFixed(1)} dB/octave`);
    console.log(`   Rhythm: ${(BASE_CYCLE_TIME / subdivision).toFixed(3)}s intervals`);
  }
  
  /**
   * Remove a dot from the audio system
   */
  private removeDot(dotKey: string): void {
    console.log(`🔊 Removing dot: ${dotKey}`);
    
    // Remove from the map
    this.audioNodes.delete(dotKey);
    
    console.log(`🔊 Removed dot ${dotKey}`);
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    console.log('🔊 Disposing DotGridAudioPlayer');
    
    this.setPlaying(false);
    this.stopAllRhythms();
    this.stopSequence();
    
    // Clean up analyzer nodes
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
    }
    
    if (this.preEQAnalyser) {
      this.preEQAnalyser.disconnect();
      this.preEQAnalyser = null;
    }
    
    this.audioNodes.clear();
    this.clickBuffers.clear();
  }
}

/**
 * Get the singleton instance of the DotGridAudioPlayer
 * @deprecated Use getDotGridAudioPlayerAsync instead for safer initialization
 */
export function getDotGridAudioPlayer(): DotGridAudioPlayer {
  return DotGridAudioPlayer.getInstanceSync();
}

/**
 * Get the singleton instance of the DotGridAudioPlayer asynchronously
 * This ensures audio buffers are properly initialized before use
 */
export async function getDotGridAudioPlayerAsync(): Promise<DotGridAudioPlayer> {
  return DotGridAudioPlayer.getInstance();
}

/**
 * Clean up the dot grid audio player
 */
export function cleanupDotGridAudioPlayer(): void {
  // Use the sync version since we're just cleaning up
  const player = DotGridAudioPlayer.getInstanceSync();
  player.dispose();
} 