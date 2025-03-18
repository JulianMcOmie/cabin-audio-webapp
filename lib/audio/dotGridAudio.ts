import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

type DotPosition = {
  x: number;
  y: number;
};

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx (odd number ensures a middle column)

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const ENVELOPE_ATTACK = 0.01; // Faster attack time in seconds - for very punchy transients
const ENVELOPE_RELEASE_DEFAULT = 0.2; // Default release time (for reference only)
const ENVELOPE_RELEASE_LOW_FREQ = 0.3; // Release time for lowest frequencies (seconds)
const ENVELOPE_RELEASE_HIGH_FREQ = 0.05; // Release time for highest frequencies (seconds)
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

// Updated constants for frequency multiplier
const DEFAULT_FREQ_MULTIPLIER = 1.0; // Default is no change (1.0)
const MIN_FREQ_MULTIPLIER = 0.5; // Half the frequency (lower pitch)
const MAX_FREQ_MULTIPLIER = 2.0; // Double the frequency (higher pitch)
const DEFAULT_SWEEP_DURATION = 8.0; // Default sweep cycle duration in seconds
const MIN_SWEEP_DURATION = 2.0; // Minimum sweep cycle duration
const MAX_SWEEP_DURATION = 30.0; // Maximum sweep cycle duration

// Playback mode enum
export enum PlaybackMode {
  POLYRHYTHM = 'polyrhythm',
  SEQUENTIAL = 'sequential'
}

// Filter mode enum
export enum FilterMode {
  BANDPASS = 'bandpass',
  HIGHPASS_LOWPASS = 'highpass_lowpass'
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
    highpassFilter?: BiquadFilterNode; // Optional highpass filter
    lowpassFilter?: BiquadFilterNode;  // Optional lowpass filter
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
  private filterMode: FilterMode = FilterMode.BANDPASS; // Default to bandpass filter
  private sequenceTimer: number | null = null; // Timer for sequential playback
  private sequenceIndex: number = 0; // Current index in the sequence
  private orderedDots: string[] = []; // Dots ordered for sequential playback
  
  // Replace freqOffset with freqMultiplier
  private freqMultiplier: number = DEFAULT_FREQ_MULTIPLIER;
  private isSweeping: boolean = false;
  private sweepDuration: number = DEFAULT_SWEEP_DURATION;
  private sweepTimeoutId: number | null = null;
  
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
      
      // Start frequency sweep if enabled
      if (this.isSweeping) {
        this.startSweep();
      }
    } else {
      // Stop the appropriate playback based on mode
      if (this.playbackMode === PlaybackMode.POLYRHYTHM) {
        this.stopAllRhythms();
      } else {
        this.stopSequence();
      }
      
      // Stop frequency sweep if enabled
      if (this.isSweeping) {
        this.stopSweep();
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
        
        // Connect the audio chain based on filter mode
        if (this.filterMode === FilterMode.BANDPASS) {
          // Bandpass approach
          // source -> filter -> panner -> envelopeGain -> gain -> (preEQGain or EQ) -> destination
          source.connect(nodes.filter);
          nodes.filter.connect(nodes.panner);
        } else {
          // Highpass+Lowpass approach
          // source -> highpass -> lowpass -> panner -> envelopeGain -> gain -> (preEQGain or EQ) -> destination
          if (nodes.highpassFilter && nodes.lowpassFilter) {
            source.connect(nodes.highpassFilter);
            nodes.highpassFilter.connect(nodes.lowpassFilter);
            nodes.lowpassFilter.connect(nodes.panner);
          } else {
            // Fallback to bandpass if the filters aren't available
            source.connect(nodes.filter);
            nodes.filter.connect(nodes.panner);
          }
        }
        
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
    
    // Calculate release time based on frequency
    // Get the center frequency from the filter
    const centerFreq = nodes.filter.frequency.value;
    
    // Calculate normalized frequency position (0 to 1) on logarithmic scale
    // Using 20Hz and 20kHz as reference points for human hearing range
    const minFreqLog = Math.log2(20);
    const maxFreqLog = Math.log2(20000);
    const freqLog = Math.log2(centerFreq);
    
    // Normalized position between 0 (lowest freq) and 1 (highest freq)
    const normalizedFreq = Math.max(0, Math.min(1, 
      (freqLog - minFreqLog) / (maxFreqLog - minFreqLog)
    ));
    
    // Interpolate release time based on frequency
    // Low frequencies get longer release (ENVELOPE_RELEASE_LOW_FREQ)
    // High frequencies get shorter release (ENVELOPE_RELEASE_HIGH_FREQ)
    const releaseTime = ENVELOPE_RELEASE_LOW_FREQ + 
      normalizedFreq * (ENVELOPE_RELEASE_HIGH_FREQ - ENVELOPE_RELEASE_LOW_FREQ);
    
    // Reset to minimum gain
    nodes.envelopeGain.gain.cancelScheduledValues(now);
    nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now);
    
    // Attack - extremely fast rise for punchy sound
    nodes.envelopeGain.gain.linearRampToValueAtTime(
      ENVELOPE_MAX_GAIN, 
      now + ENVELOPE_ATTACK
    );
    
    // Release - frequency-dependent tail
    nodes.envelopeGain.gain.exponentialRampToValueAtTime(
      0.001, // Can't go to zero with exponentialRamp, use very small value
      now + ENVELOPE_ATTACK + releaseTime
    );
    
    // Finally set to zero after the exponential ramp
    nodes.envelopeGain.gain.setValueAtTime(0, now + ENVELOPE_ATTACK + releaseTime + 0.001);
    
    // Visual feedback via console
    console.log(`🔊 Triggered dot ${dotKey} with subdivision ${nodes.subdivision} and release time ${releaseTime.toFixed(3)}s (freq: ${centerFreq.toFixed(0)}Hz)`);
  }

  /**
   * Set the filter mode
   */
  public setFilterMode(mode: FilterMode): void {
    if (this.filterMode === mode) return;
    
    console.log(`🔊 Switching filter mode to: ${mode}`);
    
    // Store the previous playing state
    const wasPlaying = this.isPlaying;
    
    // Stop current playback
    if (wasPlaying) {
      this.setPlaying(false);
    }
    
    // Update mode
    this.filterMode = mode;
    
    // Recreate all dots with the new filter mode
    this.rebuildDots();
    
    // Resume playback if it was playing
    if (wasPlaying) {
      this.setPlaying(true);
    }
  }
  
  /**
   * Get the current filter mode
   */
  public getFilterMode(): FilterMode {
    return this.filterMode;
  }
  
  /**
   * Rebuild all dots with current filter mode
   */
  private rebuildDots(): void {
    // Store the current dots
    const currentDots = new Set(this.audioNodes.keys());
    
    // Clear all dots
    this.audioNodes.clear();
    
    // Re-add all dots with the new filter mode
    currentDots.forEach(dotKey => {
      this.addDot(dotKey);
    });
    
    // Recalculate row offsets
    this.calculateRowOffsets();
    
    console.log(`🔊 Rebuilt all dots with filter mode: ${this.filterMode}`);
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
    const minFreq = 60;  // Lower minimum for better low-end
    const maxFreq = 10000; // Lower maximum to avoid harsh high-end
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Create a gain node for volume
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN;
    
    // Create a panner node for stereo positioning
    const panner = ctx.createStereoPanner();
    
    // Simple panning calculation that evenly distributes columns from -1 to 1
    // First column (x=0) will be -1 (full left), last column will be 1 (full right)
    const panPosition = this.columnCount <= 1 ? 0 : (2 * (x / (this.columnCount - 1)) - 1);
    
    panner.pan.value = panPosition;
    
    console.log(`   Pan: ${panner.pan.value.toFixed(2)} (column ${x+1} of ${this.columnCount})`);
    
    // Calculate Q (bandwidth)
    const distFromCenter = Math.abs(normalizedY - 0.5) * 2;
    const minQ = 1.0;
    const maxQ = 4.0;
    const qValue = 4.0;//minQ + (1 - distFromCenter) * (maxQ - minQ);
    
    // Create filter(s) based on the filter mode
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerFreq;
    filter.Q.value = qValue;
    
    // For highpass+lowpass mode, create additional filters
    let highpassFilter: BiquadFilterNode | undefined = undefined;
    let lowpassFilter: BiquadFilterNode | undefined = undefined;
    
    if (this.filterMode === FilterMode.HIGHPASS_LOWPASS) {
      // Convert Q to bandwidth in octaves
      // Approximate formula: BW = 2/Q
      const bandwidthInOctaves = 2 / qValue;
      
      // Calculate cutoff frequencies (approximately centerFreq * 2^(±bw/2))
      const lowCutoff = centerFreq * Math.pow(2, -bandwidthInOctaves/2);
      const highCutoff = centerFreq * Math.pow(2, bandwidthInOctaves/2);
      
      // Create highpass filter
      highpassFilter = ctx.createBiquadFilter();
      highpassFilter.type = 'highpass';
      highpassFilter.frequency.value = lowCutoff;
      highpassFilter.Q.value = 0.7071; // Butterworth response
      
      // Create lowpass filter
      lowpassFilter = ctx.createBiquadFilter();
      lowpassFilter.type = 'lowpass';
      lowpassFilter.frequency.value = highCutoff;
      lowpassFilter.Q.value = 0.7071; // Butterworth response
    }
    
    // Calculate position for sorting
    const position = y * this.columnCount + x;
    
    // Calculate subdivision based on vertical position
    const subdivision = this.calculateSubdivision(y);
    
    // Store the nodes
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      envelopeGain: ctx.createGain(),
      panner,
      filter,
      highpassFilter,
      lowpassFilter,
      position, // Store position for sorting
      rhythmInterval: null, // Rhythm interval ID
      subdivision, // Subdivision for this dot
      nextTriggerTime: 0, // Will be set when playback starts
      offset: 0 // Default offset, will be updated by calculateRowOffsets
    });
    
    const filterDescription = this.filterMode === FilterMode.BANDPASS 
      ? `Bandpass at ${centerFreq.toFixed(0)}Hz (Q=${qValue.toFixed(2)})`
      : `Highpass at ${highpassFilter?.frequency.value.toFixed(0)}Hz + Lowpass at ${lowpassFilter?.frequency.value.toFixed(0)}Hz`;
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Position: ${normalizedY.toFixed(2)}`);
    console.log(`   Filter: ${filterDescription}`);
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
   * Set frequency multiplier for all dots
   * @param multiplier Frequency multiplier (0.5 to 2.0)
   */
  public setFrequencyMultiplier(multiplier: number): void {
    // Limit to range
    multiplier = Math.max(MIN_FREQ_MULTIPLIER, Math.min(MAX_FREQ_MULTIPLIER, multiplier));
    
    if (multiplier === this.freqMultiplier) return;
    
    console.log(`🔊 Setting frequency multiplier: ${multiplier.toFixed(2)}×`);
    this.freqMultiplier = multiplier;
    
    // Update filters if playing - immediately apply to all dots
    if (this.isPlaying) {
      this.updateAllFilterFrequencies();
    }
  }
  
  /**
   * Get the current frequency multiplier
   */
  public getFrequencyMultiplier(): number {
    return this.freqMultiplier;
  }
  
  /**
   * Set whether frequency multiplier is sweeping
   */
  public setSweeping(enabled: boolean): void {
    if (enabled === this.isSweeping) return;
    
    console.log(`🔊 Setting frequency sweep: ${enabled ? 'enabled' : 'disabled'}`);
    this.isSweeping = enabled;
    
    if (this.isPlaying) {
      if (enabled) {
        this.startSweep();
      } else {
        this.stopSweep();
      }
    }
  }
  
  /**
   * Get whether frequency multiplier is sweeping
   */
  public isSweepEnabled(): boolean {
    return this.isSweeping;
  }
  
  /**
   * Set sweep duration (time for a complete cycle)
   */
  public setSweepDuration(duration: number): void {
    // Limit to range
    duration = Math.max(MIN_SWEEP_DURATION, Math.min(MAX_SWEEP_DURATION, duration));
    
    if (duration === this.sweepDuration) return;
    
    console.log(`🔊 Setting sweep duration: ${duration.toFixed(1)}s`);
    this.sweepDuration = duration;
    
    // Restart sweep if already sweeping
    if (this.isPlaying && this.isSweeping) {
      this.stopSweep();
      this.startSweep();
    }
  }
  
  /**
   * Get the current sweep duration
   */
  public getSweepDuration(): number {
    return this.sweepDuration;
  }
  
  /**
   * Start frequency sweep
   */
  private startSweep(): void {
    // Clear any existing sweep
    this.stopSweep();
    
    const ctx = audioContext.getAudioContext();
    const sweepTime = this.sweepDuration / 2; // Half cycle time
    
    // Schedule the sweep (runs continuously)
    const scheduleNextSweep = () => {
      if (!this.isPlaying || !this.isSweeping) {
        return; // Exit if we're no longer playing or sweeping
      }
      
      const startTime = ctx.currentTime;
      
      // Animate the frequency multiplier from minimum to maximum and back
      this.audioNodes.forEach((nodes) => {
        const baseFreq = this.calculateBaseFrequency(nodes);
        
        // For bandpass, update the center frequency with a multiplier
        if (this.filterMode === FilterMode.BANDPASS) {
          nodes.filter.frequency.cancelScheduledValues(startTime);
          nodes.filter.frequency.setValueAtTime(
            baseFreq * this.freqMultiplier, 
            startTime
          );
          
          // Sweep from current to max multiplier
          nodes.filter.frequency.exponentialRampToValueAtTime(
            baseFreq * MAX_FREQ_MULTIPLIER,
            startTime + sweepTime
          );
          
          // Sweep from max to min multiplier
          nodes.filter.frequency.exponentialRampToValueAtTime(
            baseFreq * MIN_FREQ_MULTIPLIER,
            startTime + sweepTime * 2
          );
        } else if (nodes.highpassFilter && nodes.lowpassFilter) {
          // For highpass+lowpass, update both filters with a multiplier
          // ... similar implementation for both filters ...
        }
      });
      
      // Schedule the next sweep cycle
      this.sweepTimeoutId = window.setTimeout(() => {
        // Only proceed if we're still playing and sweeping
        if (this.isPlaying && this.isSweeping) {
          scheduleNextSweep();
        }
      }, sweepTime * 2 * 1000 - 50); // Schedule slightly before end
    };
    
    // Start the first sweep cycle
    scheduleNextSweep();
    
    console.log(`🔊 Started frequency sweep: ${MIN_FREQ_MULTIPLIER}× - ${MAX_FREQ_MULTIPLIER}×, duration: ${this.sweepDuration.toFixed(1)}s`);
  }
  
  /**
   * Stop frequency sweep
   */
  private stopSweep(): void {
    // Clear the timeout if one exists
    if (this.sweepTimeoutId !== null) {
      window.clearTimeout(this.sweepTimeoutId);
      this.sweepTimeoutId = null;
    }
    
    // Reset all filter frequencies to base + current multiplier
    if (this.isPlaying) {
      this.updateAllFilterFrequencies();
    }
    
    console.log('🔊 Stopped frequency sweep');
  }
  
  /**
   * Calculate the base frequency for a dot (without multiplier)
   */
  private calculateBaseFrequency(nodes: any): number {
    // Since we're using a multiplier now, we need to get the original base frequency
    return nodes.filter.frequency.value / this.freqMultiplier;
  }
  
  /**
   * Update all filter frequencies based on the current multiplier
   * This is called any time the frequency multiplier changes
   */
  private updateAllFilterFrequencies(): void {
    const ctx = audioContext.getAudioContext();
    
    this.audioNodes.forEach((nodes) => {
      const baseFreq = this.calculateBaseFrequency(nodes);
      const newFreq = baseFreq * this.freqMultiplier;
      
      if (this.filterMode === FilterMode.BANDPASS) {
        // For bandpass, update the center frequency with multiplier
        nodes.filter.frequency.cancelScheduledValues(ctx.currentTime);
        nodes.filter.frequency.setValueAtTime(newFreq, ctx.currentTime);
      } else if (nodes.highpassFilter && nodes.lowpassFilter) {
        // For highpass+lowpass, update both filters
        // ... implementation for both filters ...
      }
    });
    
    console.log(`🔊 Updated all filter frequencies with multiplier: ${this.freqMultiplier.toFixed(2)}×`);
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    console.log('🔊 Disposing DotGridAudioPlayer');
    
    this.setPlaying(false);
    this.stopAllRhythms();
    this.stopSequence();
    this.stopSweep();
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