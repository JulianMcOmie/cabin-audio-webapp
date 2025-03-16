import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

type DotPosition = {
  x: number;
  y: number;
};

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const ENVELOPE_ATTACK = 0.001; // Faster attack time in seconds - for very punchy transients
const ENVELOPE_RELEASE = 0.001; // Shorter release time in seconds
const MASTER_GAIN = 1.0; // Much louder master gain for calibration

// Polyrhythm settings
const BASE_CYCLE_TIME = 2.0; // Base cycle time in seconds
const MIN_SUBDIVISION = 2; // Minimum subdivision (lower dots)
const MAX_SUBDIVISION = 16; // Maximum subdivision (higher dots)

// Sequential playback settings
const DOT_TIMING = 0.2; // Time between dots in sequential mode (seconds)

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Playback mode enum
export enum PlaybackMode {
  POLYRHYTHM = 'polyrhythm',
  SEQUENTIAL = 'sequential'
}

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private audioNodes: Map<string, {
    source: AudioBufferSourceNode;
    gain: GainNode;
    envelopeGain: GainNode;
    panner: StereoPannerNode;
    filter: BiquadFilterNode;
    position: number; // Position for sorting
    rhythmInterval: number | null; // Rhythm interval ID
    subdivision: number; // Rhythm subdivision
    nextTriggerTime: number; // Next time to trigger this dot
    offset: number; // Offset within the row's rhythm (0-1)
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
  
  private constructor() {
    // Initialize pink noise buffer
    this.generatePinkNoiseBuffer();
  }

  public static getInstance(): DotGridAudioPlayer {
    if (!DotGridAudioPlayer.instance) {
      DotGridAudioPlayer.instance = new DotGridAudioPlayer();
    }
    return DotGridAudioPlayer.instance;
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
    this.pinkNoiseBuffer = buffer;
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
      
      // If already playing, reconnect all sources
      if (this.isPlaying) {
        this.reconnectAllSources();
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
   * Reconnect all sources to include the analyzer in the signal chain
   */
  private reconnectAllSources(): void {
    // Skip if analyzer not created or no gain node
    if (!this.preEQGain) return;
    
    // Reconnect all sources to include analyzer
    this.audioNodes.forEach((nodes) => {
      // Disconnect gain from its current destination
      nodes.gain.disconnect();
      
      // Connect to the pre-EQ gain node
      if (this.preEQGain) {
        nodes.gain.connect(this.preEQGain);
      }
    });
    
    console.log('🔊 Reconnected all sources to include analyzer');
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
        this.stopAllSources();
        this.startAllSources();
        this.startAllRhythms();
      } else {
        this.stopSequence();
        this.stopAllSources();
        this.startAllSources();
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
      this.startAllSources();
      
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
      
      this.stopAllSources();
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
    
    // Trigger the envelope for this dot
    this.triggerDotEnvelope(dotKey);
    
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
        // Trigger the dot
        this.triggerDotEnvelope(dotKey);
        
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
   * Start all audio sources
   */
  private startAllSources(): void {
    console.log(`🔊 Starting all sources`);
    
    const ctx = audioContext.getAudioContext();
    
    // Make sure we have pink noise buffer
    if (!this.pinkNoiseBuffer) {
      console.warn('Pink noise buffer not ready');
      this.generatePinkNoiseBuffer();
      return;
    }
    
    // Create pre-EQ gain node if needed for analyzer
    if (this.preEQAnalyser && !this.preEQGain) {
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
      this.preEQGain.connect(this.preEQAnalyser);
      
      // Connect to EQ processor
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode());
    }
    
    // Get the destination node (either preEQGain or directly to EQ processor)
    const destinationNode = this.preEQGain ? 
      this.preEQGain as AudioNode : 
      eqProcessor.getEQProcessor().getInputNode();
    
    // Start each source
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        // Create a new source
        const source = ctx.createBufferSource();
        source.buffer = this.pinkNoiseBuffer;
        source.loop = true;
        
        // Connect the audio chain
        // source -> filter -> panner -> envelopeGain -> gain -> (preEQGain or EQ) -> destination
        source.connect(nodes.filter);
        nodes.filter.connect(nodes.panner);
        nodes.panner.connect(nodes.envelopeGain);
        nodes.envelopeGain.connect(nodes.gain);
        
        // Connect to destination (preEQGain or directly to EQ)
        if (destinationNode) {
          nodes.gain.connect(destinationNode);
        }
        
        // Start with gain at minimum (silent)
        nodes.envelopeGain.gain.value = ENVELOPE_MIN_GAIN;
        
        // Start playback
        source.start();
        
        // Store the new source
        nodes.source = source;
      } catch (e) {
        console.error(`Error starting source for dot ${dotKey}:`, e);
      }
    });
  }

  /**
   * Stop all audio sources
   */
  private stopAllSources(): void {
    console.log(`🔊 Stopping all sources`);
    
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        if (nodes.source) {
          nodes.source.stop();
          nodes.source.disconnect();
        }
      } catch (e) {
        console.error(`Error stopping source for dot ${dotKey}:`, e);
      }
    });
  }

  /**
   * Trigger the envelope for a specific dot
   */
  private triggerDotEnvelope(dotKey: string): void {
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime;
    
    // Reset to minimum gain
    nodes.envelopeGain.gain.cancelScheduledValues(now);
    nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now);
    
    // Attack - extremely fast rise for punchy sound
    nodes.envelopeGain.gain.linearRampToValueAtTime(
      ENVELOPE_MAX_GAIN, 
      now + ENVELOPE_ATTACK
    );
    
    // Release - short tail
    nodes.envelopeGain.gain.exponentialRampToValueAtTime(
      0.001, // Can't go to zero with exponentialRamp, use very small value
      now + ENVELOPE_ATTACK + ENVELOPE_RELEASE
    );
    
    // Finally set to zero after the exponential ramp
    nodes.envelopeGain.gain.setValueAtTime(0, now + ENVELOPE_ATTACK + ENVELOPE_RELEASE + 0.001);
    
    // Visual feedback via console
    console.log(`🔊 Triggered dot ${dotKey} with subdivision ${nodes.subdivision}`);
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
    
    // Create a gain node for volume with -3dB/octave slope compensation
    const gain = ctx.createGain();
    
    // Simple -3dB/octave slope compensation
    // Calculate how many octaves we are above minFreq
    const octavesAboveMin = Math.log2(centerFreq / minFreq);
    
    // Each octave lower needs compensation based on our slope setting in dB/octave
    // For example: -3dB/octave = 0.5, -6dB/octave = 1.0, -1.5dB/octave = 0.25
    // The formula is: slopeFactor = |dBPerOctave| / 6
    const DB_PER_OCTAVE = -1.5; // Can be adjusted to control the slope
    const slopeFactor = Math.abs(DB_PER_OCTAVE) / 6;
    const frequencyGainFactor = Math.pow(2, -octavesAboveMin * slopeFactor);
    
    // Apply gain with frequency compensation
    gain.gain.value = MASTER_GAIN * frequencyGainFactor;
    
    // Create an envelope gain node for modulation
    const envelopeGain = ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MIN_GAIN;
    
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
    
    // Frequency-dependent Q adjustment - lower Q (wider bandwidth) for low frequencies
    const baseQ = centerFreq < 300 ? 0.3 : centerFreq < 1000 ? 0.5 : 0.8;
    // const minQ = baseQ * 3.0;  // Wide bandwidth at extremes
    // const maxQ = (baseQ + 0.7) * 3.0;  // Narrower in the middle, but still reasonably wide
    const minQ = 0.5;
    const maxQ = 0.5;

    filter.Q.value = maxQ;// - distFromCenter * (maxQ - minQ);
    
    // Calculate position for sorting
    const position = y * this.columnCount + x;
    
    // Calculate subdivision based on vertical position
    const subdivision = this.calculateSubdivision(y);
    
    // Store the nodes
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      envelopeGain,
      panner,
      filter,
      position, // Store position for sorting
      rhythmInterval: null, // Rhythm interval ID
      subdivision, // Subdivision for this dot
      nextTriggerTime: 0, // Will be set when playback starts
      offset: 0 // Default offset, will be updated by calculateRowOffsets
    });
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Pan: ${normalizedX.toFixed(2)}`);
    console.log(`   Position: ${normalizedY.toFixed(2)}`);
    console.log(`   Center frequency: ${centerFreq.toFixed(0)}Hz`);
    console.log(`   Bandwidth (Q): ${filter.Q.value.toFixed(2)}`);
    console.log(`   Subdivision: ${subdivision}`);
    console.log(`   Rhythm: ${(BASE_CYCLE_TIME / subdivision).toFixed(3)}s intervals`);
  }
  
  /**
   * Remove a dot from the audio system
   */
  private removeDot(dotKey: string): void {
    console.log(`🔊 Removing dot: ${dotKey}`);
    
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    // Stop and disconnect the source if it's playing
    if (this.isPlaying && nodes.source) {
      try {
        nodes.source.stop();
        nodes.source.disconnect();
      } catch (e) {
        // Ignore errors when stopping
      }
    }
    
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
    this.stopAllSources();
    
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
    this.pinkNoiseBuffer = null;
  }
}

/**
 * Get the singleton instance of the DotGridAudioPlayer
 */
export function getDotGridAudioPlayer(): DotGridAudioPlayer {
  return DotGridAudioPlayer.getInstance();
}

/**
 * Clean up the dot grid audio player
 */
export function cleanupDotGridAudioPlayer(): void {
  const player = DotGridAudioPlayer.getInstance();
  player.dispose();
} 