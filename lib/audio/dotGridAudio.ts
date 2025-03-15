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
const ENVELOPE_ATTACK = 0.002; // Faster attack time in seconds - for very punchy transients
const ENVELOPE_RELEASE = 0.5; // Shorter release time in seconds
const DOT_TIMING = 0.1; // Fixed timing for each step in the sequence (seconds)
const MASTER_GAIN = 3.0; // Much louder master gain for calibration

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private audioNodes: Map<string, {
    source: AudioBufferSourceNode;
    gain: GainNode;
    envelopeGain: GainNode; // New gain node for envelope
    panner: StereoPannerNode;
    filter: BiquadFilterNode;
    position: number; // Position in the sequence (index)
  }> = new Map();
  private gridSize: number = 3; // Default, will be updated when dots are added
  private sequenceIndex: number = 0; // Current position in the sequence
  private sequenceTimer: number | null = null; // Timer ID for the sequence
  private allPositions: string[] = []; // All possible dot positions in reading order
  private lastSequenceTime: number = 0; // Last time the sequence was updated
  
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
   * Set the current grid size
   */
  public setGridSize(size: number): void {
    this.gridSize = size;
    console.log(`🔊 Grid size set to ${size} rows`);
    
    // Update the sequence with the new grid size
    this.updateSequence();
  }

  /**
   * Generate pink noise buffer
   */
  private async generatePinkNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generating pink noise using Paul Kellet's method
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      
      // Pink noise filtering
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      
      // Combine and scale
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      
      // Prevent clipping
      if (data[i] > 0.95) data[i] = 0.95;
      if (data[i] < -0.95) data[i] = -0.95;
    }

    this.pinkNoiseBuffer = buffer;
  }

  /**
   * Update the set of active dots
   */
  public updateDots(dots: Set<string>, currentGridSize?: number): void {
    console.log(`🔊 Updating dots: ${dots.size} selected`);
    
    // Update grid size if provided
    if (currentGridSize && currentGridSize !== this.gridSize) {
      this.setGridSize(currentGridSize);
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
    
    // If playing and dots changed, restart the sources to ensure proper audio
    if (this.isPlaying && 
       (currentDots.size !== dots.size || 
        ![...currentDots].every(dot => dots.has(dot)))) {
      this.stopAllSources();
      this.startAllSources();
      
      // No need to restart the sequence timer - it continues uninterrupted
    }
  }

  /**
   * Update the sequence with the current grid size
   */
  private updateSequence(): void {
    // Create array of all positions in reading order (left to right, top to bottom)
    this.allPositions = [];
    
    // Generate positions in reading order
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < COLUMNS; x++) {
        this.allPositions.push(`${x},${y}`);
      }
    }
    
    console.log(`🔊 Sequence updated: ${this.allPositions.length} positions, grid size: ${this.gridSize}x${COLUMNS}`);
    console.log(`🔊 Reading order: left-to-right, top-to-bottom, ${DOT_TIMING.toFixed(2)}s per position`);
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    console.log(`🔊 Setting playing state: ${playing}`);
    
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;
    
    if (playing) {
      this.startAllSources();
      this.startSequenceTimer();
    } else {
      this.stopAllSources();
      this.stopSequenceTimer();
    }
  }

  /**
   * Start the sequence timer to advance through dot positions
   */
  private startSequenceTimer(): void {
    // Clear any existing timer
    this.stopSequenceTimer();
    
    // Reset sequence position
    this.sequenceIndex = 0;
    
    // Use a simple interval timer for predictable timing
    this.sequenceTimer = window.setInterval(() => {
      this.advanceSequence();
    }, DOT_TIMING * 1000);
    
    // Immediately trigger the first position
    this.advanceSequence();
  }
  
  /**
   * Stop the sequence timer
   */
  private stopSequenceTimer(): void {
    if (this.sequenceTimer !== null) {
      window.clearInterval(this.sequenceTimer);
      this.sequenceTimer = null;
    }
  }
  
  /**
   * Advance to the next position in the sequence
   */
  private advanceSequence(): void {
    // Get the current position
    const sequencePosition = this.sequenceIndex % this.allPositions.length;
    const position = this.allPositions[sequencePosition];
    
    // Only trigger envelope if a dot is selected at this position
    if (this.audioNodes.has(position)) {
      this.triggerDotEnvelope(position);
    }
    
    // Always advance to the next position in the sequence
    this.sequenceIndex = (this.sequenceIndex + 1) % this.allPositions.length;
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
    console.log(`🔊 Triggered envelope for dot ${dotKey}`);
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
    
    // Get the EQ processor for audio processing
    const eq = eqProcessor.getEQProcessor();
    
    // Start each source
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        // Create a new source
        const source = ctx.createBufferSource();
        source.buffer = this.pinkNoiseBuffer;
        source.loop = true;
        
        // Connect the audio chain
        // source -> filter -> panner -> envelopeGain -> gain -> EQ -> destination
        source.connect(nodes.filter);
        nodes.filter.connect(nodes.panner);
        nodes.panner.connect(nodes.envelopeGain);
        nodes.envelopeGain.connect(nodes.gain);
        
        // Connect to EQ processor instead of directly to destination
        nodes.gain.connect(eq.getInputNode());
        
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
   * Add a new dot to the audio system
   */
  private addDot(dotKey: string): void {
    console.log(`🔊 Adding dot: ${dotKey}`);
    
    const [x, y] = dotKey.split(',').map(Number);
    
    // Find position in sequence
    const position = this.allPositions.indexOf(dotKey);
    
    // Create audio nodes for this dot
    const ctx = audioContext.getAudioContext();
    
    // Create a gain node for volume
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN; // Use the much louder master gain
    
    // Create an envelope gain node for modulation
    const envelopeGain = ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MIN_GAIN; // Start at minimum gain
    
    // Create a panner node for stereo positioning
    // x value determines pan position (-1 to 1)
    const panner = ctx.createStereoPanner();
    // Normalize x position based on fixed 5 columns (0-4)
    const normalizedX = (x / (COLUMNS - 1)) * 2 - 1; // Convert to range -1 to 1
    panner.pan.value = normalizedX;
    
    // Use the actual grid size from the component
    // Normalize y to 0-1 range (0 = bottom, 1 = top)
    // gridSize-1 is the last row index, so y/(gridSize-1) gives us the relative position
    const normalizedY = 1 - (y / (this.gridSize - 1)); // Flip so higher y = higher position
    
    // Create a bandpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    
    // Map vertical position to frequency logarithmically (20Hz - 20kHz)
    const minFreq = 20;
    const maxFreq = 20000;
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    
    // Calculate center frequency
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    filter.frequency.value = centerFreq;
    
    // Calculate Q (bandwidth)
    // Lower Q = wider bandwidth
    // At middle, more focused (higher Q)
    // At extremes, wider bandwidth (lower Q)
    
    // Distance from center (0 = middle, 1 = extreme top/bottom)
    const distFromCenter = Math.abs(normalizedY - 0.5) * 2;
    
    // Q range: wider at extremes (Q=0.5), narrower in middle (Q=1.5)
    // Still fairly wide throughout as requested
    const minQ = 0.5;  // Wide bandwidth at extremes
    const maxQ = 1.5;  // Narrower in the middle, but still reasonably wide
    
    filter.Q.value = maxQ - distFromCenter * (maxQ - minQ);
    
    // Store the nodes
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      envelopeGain,
      panner,
      filter,
      position // Store position in sequence
    });
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Grid size: ${this.gridSize} rows`);
    console.log(`   Pan: ${normalizedX.toFixed(2)}`);
    console.log(`   Position: ${normalizedY.toFixed(2)}`);
    console.log(`   Center frequency: ${centerFreq.toFixed(0)}Hz`);
    console.log(`   Bandwidth (Q): ${filter.Q.value.toFixed(2)}`);
    console.log(`   Sequence position: ${position}`);
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
    this.stopSequenceTimer();
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