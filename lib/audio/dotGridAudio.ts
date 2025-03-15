import * as audioContext from './audioContext';

type DotPosition = {
  x: number;
  y: number;
};

class DotGridAudioPlayer {
  private audioNodes: Map<string, {
    source: AudioBufferSourceNode;
    gain: GainNode;
    panner: StereoPannerNode;
    lowpass: BiquadFilterNode;
    highpass: BiquadFilterNode;
  }> = new Map();
  
  private isPlaying: boolean = false;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  
  constructor() {
    console.log('🔊 DotGridAudioPlayer: initializing');
    this.generatePinkNoiseBuffer();
  }
  
  /**
   * Generates a pink noise buffer for use with all dots
   */
  private async generatePinkNoiseBuffer(): Promise<void> {
    console.log('🔊 Generating pink noise buffer');
    
    const sampleRate = audioContext.getAudioContext().sampleRate;
    const bufferSize = 2 * sampleRate; // 2 seconds of audio
    
    // Create buffer with random values (white noise)
    const buffer = audioContext.getAudioContext().createBuffer(
      1, // mono
      bufferSize,
      sampleRate
    );
    
    // Get buffer data
    const data = buffer.getChannelData(0);
    
    // Generate white noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    // Apply pink noise filter (1/f spectrum)
    // This is a simple approximation of pink noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
      const white = data[i];
      
      // Pink noise filter - cascade of first-order filters
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      
      // Mix output and store back in the buffer
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      
      // Scale down to prevent clipping (empirically derived value)
      data[i] *= 0.11;
    }
    
    this.pinkNoiseBuffer = buffer;
    console.log('🔊 Pink noise buffer generated');
  }
  
  /**
   * Updates the playing state of all dots
   */
  public setPlaying(playing: boolean): void {
    console.log(`🔊 DotGridAudioPlayer: setting playing state to ${playing}`);
    
    if (this.isPlaying === playing) {
      return; // No change
    }
    
    this.isPlaying = playing;
    
    if (playing) {
      // Start all audio sources
      this.startAllSources();
    } else {
      // Stop all audio sources
      this.stopAllSources();
    }
  }
  
  /**
   * Start playback for all dots
   */
  private startAllSources(): void {
    console.log('🔊 Starting all audio sources');
    
    if (!this.pinkNoiseBuffer) {
      console.warn('🔊 Cannot start sources: Pink noise buffer not ready');
      return;
    }
    
    // Start each audio node
    for (const [dotKey, nodes] of this.audioNodes.entries()) {
      // Disconnect old source if it exists
      if (nodes.source) {
        try {
          nodes.source.disconnect();
        } catch (e) {
          // Ignore disconnection errors
        }
      }
      
      // Create a new source
      const source = audioContext.getAudioContext().createBufferSource();
      source.buffer = this.pinkNoiseBuffer;
      source.loop = true;
      
      // Connect source -> lowpass -> highpass -> panner -> gain -> destination
      source.connect(nodes.lowpass);
      nodes.lowpass.connect(nodes.highpass);
      nodes.highpass.connect(nodes.panner);
      nodes.panner.connect(nodes.gain);
      nodes.gain.connect(audioContext.getAudioContext().destination);
      
      // Start the source
      source.start();
      
      // Update the source reference
      nodes.source = source;
      
      console.log(`🔊 Started source for dot ${dotKey}`);
    }
  }
  
  /**
   * Stop playback for all dots
   */
  private stopAllSources(): void {
    console.log('🔊 Stopping all audio sources');
    
    for (const [dotKey, nodes] of this.audioNodes.entries()) {
      if (nodes.source) {
        try {
          nodes.source.stop();
          nodes.source.disconnect();
        } catch (e) {
          // Ignore errors when stopping
        }
      }
      
      console.log(`🔊 Stopped source for dot ${dotKey}`);
    }
  }
  
  /**
   * Update the set of active dots
   */
  public updateDots(dots: Set<string>): void {
    console.log(`🔊 Updating dots: ${dots.size} dots active`);
    
    // Create a set of current keys for comparison
    const currentKeys = new Set(this.audioNodes.keys());
    
    // Add new dots
    for (const dotKey of dots) {
      if (!currentKeys.has(dotKey)) {
        this.addDot(dotKey);
      }
    }
    
    // Remove dots that are no longer active
    for (const dotKey of currentKeys) {
      if (!dots.has(dotKey)) {
        this.removeDot(dotKey);
      }
    }
    
    // If we're playing, make sure all new nodes are started
    if (this.isPlaying) {
      this.startAllSources();
    }
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
    
    // Create a panner node for stereo positioning
    // x value determines pan position (-1 to 1)
    const panner = ctx.createStereoPanner();
    const normalizedX = (x / 2) * 2 - 1; // Convert to range -1 to 1
    panner.pan.value = normalizedX;
    
    // Create lowpass and highpass filters for frequency shaping
    // y value determines filter frequencies (higher y = higher frequency)
    const lowpass = ctx.createBiquadFilter();
    const highpass = ctx.createBiquadFilter();
    
    lowpass.type = 'lowpass';
    highpass.type = 'highpass';
    
    // Define frequency range in logarithmic space
    const minFreq = 100;   // Lowest frequency
    const maxFreq = 20000; // Highest frequency
    const midFreq = Math.sqrt(minFreq * maxFreq); // Geometric mean for logarithmic center
    
    // Normalize y to 0-1 range (0 = bottom, 1 = top)
    const normalizedY = 1 - (y / 2); // Flip so higher y = higher position
    
    // Calculate center frequency and bandwidth based on y position
    // Use logarithmic scaling for better perceptual spacing
    let centerFreq, lowpassFreq, highpassFreq, lowpassQ, highpassQ;
    
    if (normalizedY < 0.5) {
      // Bottom half of the grid (bass-focused)
      const relativePos = normalizedY * 2; // 0-1 within bottom half
      
      centerFreq = minFreq * Math.pow(midFreq/minFreq, relativePos);
      
      // For lower frequencies, sharp highpass but broad lowpass
      highpassFreq = centerFreq * (0.7 + 0.3 * relativePos);
      lowpassFreq = centerFreq * (3 + 4 * (1 - relativePos));
      
      // Q values (resonance/sharpness)
      highpassQ = 0.7 + 0.6 * relativePos; // Sharper as we move up
      lowpassQ = 0.1 + 0.2 * relativePos; // Broader at bottom
    } else {
      // Top half of the grid (treble-focused)
      const relativePos = (normalizedY - 0.5) * 2; // 0-1 within top half
      
      centerFreq = midFreq * Math.pow(maxFreq/midFreq, relativePos);
      
      // For higher frequencies, sharp lowpass but broad highpass
      lowpassFreq = centerFreq * (1.3 - 0.3 * relativePos);
      highpassFreq = centerFreq * (0.3 + 0.3 * relativePos);
      
      // Q values (resonance/sharpness)
      lowpassQ = 0.7 + 0.6 * relativePos; // Sharper as we move up
      highpassQ = 0.1 + 0.3 * relativePos; // Broader at top
    }
    
    // Apply filter settings
    lowpass.frequency.value = lowpassFreq;
    lowpass.Q.value = lowpassQ;
    
    highpass.frequency.value = highpassFreq;
    highpass.Q.value = highpassQ;
    
    // Store the nodes
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      panner,
      lowpass,
      highpass
    });
    
    console.log(`🔊 Added dot ${dotKey} at position (${x},${y})`);
    console.log(`   Pan: ${normalizedX.toFixed(2)}`);
    console.log(`   Center freq: ${centerFreq.toFixed(0)}Hz`);
    console.log(`   Lowpass: ${lowpassFreq.toFixed(0)}Hz (Q=${lowpassQ.toFixed(2)})`);
    console.log(`   Highpass: ${highpassFreq.toFixed(0)}Hz (Q=${highpassQ.toFixed(2)})`);
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

// Singleton instance
let dotGridAudioPlayerInstance: DotGridAudioPlayer | null = null;

/**
 * Get or create the dot grid audio player instance
 */
export const getDotGridAudioPlayer = (): DotGridAudioPlayer => {
  if (!dotGridAudioPlayerInstance) {
    dotGridAudioPlayerInstance = new DotGridAudioPlayer();
  }
  
  return dotGridAudioPlayerInstance;
};

/**
 * Clean up the dot grid audio player
 */
export const cleanupDotGridAudioPlayer = (): void => {
  if (dotGridAudioPlayerInstance) {
    dotGridAudioPlayerInstance.dispose();
    dotGridAudioPlayerInstance = null;
  }
}; 