import * as audioContext from './audioContext';

type DotPosition = {
  x: number;
  y: number;
};

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx

// Envelope settings
const ENVELOPE_PERIOD = 2.0; // Length of one envelope cycle in seconds
const ENVELOPE_MIN_GAIN = 0.3; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const ENVELOPE_ATTACK = 0.005; // Attack time in seconds - MUCH faster for sharp transients
const ENVELOPE_RELEASE = 0.005; // Release time in seconds

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
    envelopeOffset: number; // Offset for staggering envelopes
  }> = new Map();
  private gridSize: number = 3; // Default, will be updated when dots are added

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
    console.log(`🔊 Updating dots: ${dots.size}`);
    
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
    
    // Calculate staggered envelope offsets based on dot count
    this.updateEnvelopeOffsets(dots);
    
    // Restart sound if we're currently playing
    if (this.isPlaying) {
      this.stopAllSources();
      this.startAllSources();
    }
  }

  /**
   * Update envelope offsets to stagger them across the dots
   */
  private updateEnvelopeOffsets(dots: Set<string>): void {
    if (dots.size <= 1) return; // No need to stagger for a single dot
    
    const dotKeys = Array.from(dots);
    const totalDots = dotKeys.length;
    
    // Distribute offsets evenly across the envelope period
    dotKeys.forEach((dotKey, index) => {
      const nodes = this.audioNodes.get(dotKey);
      if (nodes) {
        // Calculate offset as a fraction of the envelope period
        nodes.envelopeOffset = (index / totalDots) * ENVELOPE_PERIOD;
      }
    });
    
    console.log(`🔊 Updated envelope offsets for ${totalDots} dots`);
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
    } else {
      this.stopAllSources();
    }
  }

  /**
   * Apply a repeating gain envelope to the node
   */
  private applyGainEnvelope(envelopeGain: GainNode, offset: number = 0): void {
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime;
    
    // Set initial gain
    envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now);
    
    // Schedule repeating envelope
    const scheduleEnvelope = (startTime: number) => {
      // Set minimum gain as the starting point
      envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, startTime);
      
      // Attack phase - VERY fast exponential rise for sharp transient
      // Using exponentialRampToValueAtTime for even sharper attack
      envelopeGain.gain.exponentialRampToValueAtTime(
        ENVELOPE_MAX_GAIN,
        startTime + ENVELOPE_ATTACK
      );
      
      // Sustain at max for a while
      const sustainTime = ENVELOPE_PERIOD - ENVELOPE_ATTACK - ENVELOPE_RELEASE;
      
      // Release phase - ramp down from max to min
      envelopeGain.gain.linearRampToValueAtTime(
        ENVELOPE_MIN_GAIN,
        startTime + ENVELOPE_ATTACK + sustainTime + ENVELOPE_RELEASE
      );
      
      // Schedule the next cycle
      const nextCycleTime = startTime + ENVELOPE_PERIOD;
      
      // Only schedule a few cycles ahead to avoid memory issues
      if (nextCycleTime < now + 10) {
        scheduleEnvelope(nextCycleTime);
      } else {
        // Schedule a callback to continue scheduling
        setTimeout(() => {
          if (this.isPlaying) {
            scheduleEnvelope(nextCycleTime);
          }
        }, (nextCycleTime - now - 5) * 1000);
      }
    };
    
    // Start the envelope with the specified offset
    scheduleEnvelope(now + offset);
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
    
    // Start each source
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        // Create a new source
        const source = ctx.createBufferSource();
        source.buffer = this.pinkNoiseBuffer;
        source.loop = true;
        
        // Connect the audio chain
        // source -> filter -> panner -> envelopeGain -> gain -> destination
        source.connect(nodes.filter);
        nodes.filter.connect(nodes.panner);
        nodes.panner.connect(nodes.envelopeGain);
        nodes.envelopeGain.connect(nodes.gain);
        nodes.gain.connect(ctx.destination);
        
        // Apply the gain envelope with the dot's offset
        this.applyGainEnvelope(nodes.envelopeGain, nodes.envelopeOffset);
        
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
    
    // Create audio nodes for this dot
    const ctx = audioContext.getAudioContext();
    
    // Create a gain node for volume
    const gain = ctx.createGain();
    gain.gain.value = 0.2; // Reduced to prevent distortion with multiple dots
    
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
    const minFreq = 100;
    const maxFreq = 10000;
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
      envelopeOffset: 0 // Default offset, will be updated when multiple dots are active
    });
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Grid size: ${this.gridSize} rows`);
    console.log(`   Pan: ${normalizedX.toFixed(2)}`);
    console.log(`   Position: ${normalizedY.toFixed(2)}`);
    console.log(`   Center frequency: ${centerFreq.toFixed(0)}Hz`);
    console.log(`   Bandwidth (Q): ${filter.Q.value.toFixed(2)}`);
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