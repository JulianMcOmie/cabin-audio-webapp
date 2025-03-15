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
const ENVELOPE_RELEASE = 0.3; // Shorter release time in seconds
const MASTER_GAIN = 3.0; // Much louder master gain for calibration

// Rhythm settings - base rhythm timing in seconds
const BASE_RHYTHM = 0.4; // Base rhythm in seconds
const MIN_RHYTHM = 0.2;  // Minimum timing for fastest rhythms
const MAX_RHYTHM = 0.8;  // Maximum timing for slowest rhythms

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
    rhythmTimer: number | null; // Individual rhythm timer for this dot
    rhythmInterval: number; // Rhythm interval in milliseconds
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
    
    // If playing, restart rhythm timers for all dots
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.stopAllSources();
      this.startAllSources();
      this.startAllRhythms();
    }
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
      this.startAllRhythms();
    } else {
      this.stopAllRhythms();
      this.stopAllSources();
    }
  }

  /**
   * Start rhythm timers for all dots
   */
  private startAllRhythms(): void {
    console.log(`🔊 Starting rhythms for all dots`);
    
    this.audioNodes.forEach((nodes, dotKey) => {
      this.startDotRhythm(dotKey, nodes);
    });
  }
  
  /**
   * Stop rhythm timers for all dots
   */
  private stopAllRhythms(): void {
    console.log(`🔊 Stopping rhythms for all dots`);
    
    this.audioNodes.forEach((nodes, dotKey) => {
      if (nodes.rhythmTimer !== null) {
        window.clearInterval(nodes.rhythmTimer);
        nodes.rhythmTimer = null;
      }
    });
  }
  
  /**
   * Start a rhythm timer for a specific dot
   */
  private startDotRhythm(dotKey: string, nodes: any): void {
    // Clear any existing timer
    if (nodes.rhythmTimer !== null) {
      window.clearInterval(nodes.rhythmTimer);
    }
    
    // Set up rhythm interval based on dot position
    nodes.rhythmTimer = window.setInterval(() => {
      if (this.isPlaying) {
        this.triggerDotEnvelope(dotKey);
      }
    }, nodes.rhythmInterval);
    
    // Trigger immediately for immediate feedback
    this.triggerDotEnvelope(dotKey);
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
    const minFreq = 40;
    const maxFreq = 12000;
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Create a gain node for volume with -3dB/octave slope compensation
    const gain = ctx.createGain();
    
    // Simple -3dB/octave slope compensation
    // Calculate how many octaves we are above minFreq
    const octavesAboveMin = Math.log2(centerFreq / minFreq);
    
    // Each octave lower needs +3dB of gain (which is a factor of ~1.414)
    // So going up one octave means 0.707x gain, going down one octave means 1.414x gain
    // We calculate this by using 2^(-octaves * 0.5)
    // The 0.5 gives us the -3dB/octave slope (because 10*log10(2^0.5) ≈ 3dB)
    const frequencyGainFactor = Math.pow(2, -octavesAboveMin * 0.5);
    
    // Apply gain with frequency compensation
    gain.gain.value = MASTER_GAIN * frequencyGainFactor * 5.0;
    
    // Create an envelope gain node for modulation
    const envelopeGain = ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MIN_GAIN;
    
    // Create a panner node for stereo positioning
    const panner = ctx.createStereoPanner();
    const normalizedX = (x / (COLUMNS - 1)) * 2 - 1; // Convert to range -1 to 1
    panner.pan.value = normalizedX;
    
    // Create a bandpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerFreq;
    
    // Calculate Q (bandwidth)
    const distFromCenter = Math.abs(normalizedY - 0.5) * 2;
    
    // Frequency-dependent Q adjustment - lower Q (wider bandwidth) for low frequencies
    const baseQ = centerFreq < 300 ? 0.3 : centerFreq < 1000 ? 0.5 : 0.8;
    const minQ = baseQ * 3.0;  // Wide bandwidth at extremes
    const maxQ = (baseQ + 0.7) * 3.0;  // Narrower in the middle, but still reasonably wide
    
    filter.Q.value = maxQ - distFromCenter * (maxQ - minQ);
    
    // Calculate rhythm interval based on position
    // Use X and Y to create a unique rhythm for each position
    const yRhythm = MIN_RHYTHM + (1 - normalizedY) * (MAX_RHYTHM - MIN_RHYTHM);
    const xOffset = [1.0, 1.11, 1.0, 0.91, 0.83][x]; // Prime-based ratios
    const rhythmInterval = Math.round(yRhythm * xOffset * 1000);
    
    // Store the nodes
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      envelopeGain,
      panner,
      filter,
      position: -1, // Not used with rhythmic approach
      rhythmTimer: null,
      rhythmInterval: rhythmInterval
    });
    
    // dB representation for logging
    const gainDB = 20 * Math.log10(frequencyGainFactor);
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Pan: ${normalizedX.toFixed(2)}`);
    console.log(`   Position: ${normalizedY.toFixed(2)}`);
    console.log(`   Center frequency: ${centerFreq.toFixed(0)}Hz`);
    console.log(`   Octaves above min: ${octavesAboveMin.toFixed(2)}`);
    console.log(`   Slope compensation: -3dB/octave`);
    console.log(`   Frequency gain: ${frequencyGainFactor.toFixed(3)}x (${gainDB.toFixed(1)}dB)`);
    console.log(`   Final gain: ${(MASTER_GAIN * frequencyGainFactor).toFixed(2)}`);
    console.log(`   Bandwidth (Q): ${filter.Q.value.toFixed(2)}`);
    console.log(`   Rhythm interval: ${rhythmInterval}ms`);
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
    
    // Clear the rhythm timer
    if (nodes.rhythmTimer !== null) {
      window.clearInterval(nodes.rhythmTimer);
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
    this.stopAllSources();
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