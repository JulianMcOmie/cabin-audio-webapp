import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
// import { getAudioPlayer } from './audioPlayer';
import { useEQProfileStore } from '../stores';

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx (odd number ensures a middle column)
const SEQUENTIAL_TRIGGER_DELAY = 0.1; // Delay between sequential dot triggers

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const ENVELOPE_ATTACK = 0.002; // Faster attack time in seconds - for very punchy transients
const ENVELOPE_RELEASE_LOW_FREQ = 0.2; // Release time for lowest frequencies (seconds)
const ENVELOPE_RELEASE_HIGH_FREQ = 0.02; // Release time for highest frequencies (seconds)
const MASTER_GAIN = 6.0; // Much louder master gain for calibration

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Volume pattern settings
const VOLUME_PATTERN = [0, 0, 0, 0]

// Define the possible states for a dot
export type DotState = 'on' | 'quiet' | 'off';

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
    state: 'on' | 'quiet'; // Add state to track 'on' or 'quiet'
  }> = new Map();
  private gridSize: number = 3; // Default row count
  private columnCount: number = COLUMNS; // Default column count
  private preEQAnalyser: AnalyserNode | null = null; // Pre-EQ analyzer node
  private preEQGain: GainNode | null = null; // Gain node for connecting all sources to analyzer
  
  // Animation frame properties
  private animationFrameId: number | null = null;
  private lastTriggerTime: number = 0; // REINTRODUCED global trigger time
  
  // Volume pattern properties - REINTRODUCING INDEX
  private volumePatternIndex: number = 0; // Current position in volume pattern
  private baseDbLevel: number = 0; // Base volume level in dB (0dB = reference level)
  
  // Add distortion gain property
  private distortionGain: number = 1.0;
  
  private constructor() {
    // Initialize pink noise buffer
    this.generatePinkNoiseBuffer();
    
    // Apply initial distortion gain from store
    const distortionGain = useEQProfileStore.getState().distortionGain;
    this.setDistortionGain(distortionGain);
    
    // Subscribe to distortion gain changes from the store
    useEQProfileStore.subscribe(
      (state) => {
        this.setDistortionGain(state.distortionGain);
      }
    );
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
  public setGridSize(rows: number, columns?: number): void {
    this.gridSize = rows;

    if (columns !== undefined) {
      this.columnCount = columns;
      this.updateAllDotPanning();
    }
    
    // Update playback if playing
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.startAllRhythms();
    }
  }

  /**
   * Update panning for all dots based on current column count
   */
  private updateAllDotPanning(): void {
    this.audioNodes.forEach((nodes, dotKey) => {
      const x = dotKey.split(',').map(Number)[0];
      
      // Recalculate panning based on new column count
      // Simple panning calculation that evenly distributes columns from -1 to 1
      // First column (x=0) will be -1 (full left), last column will be 1 (full right)
      const panPosition = this.columnCount <= 1 ? 0 : (2 * (x / (this.columnCount - 1)) - 1);
      
      // Update panner value
      nodes.panner.pan.value = panPosition;
    });
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
      
      // Connect the gain to the analyzer - analyzer is just for visualization
      this.preEQGain.connect(this.preEQAnalyser);
      
      // Simply connect to EQ processor directly
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
   * Connect to an existing external analyzer
   * @param analyser The analyzer node to connect to
   */
  public connectToAnalyser(analyser: AnalyserNode): void {
    const ctx = audioContext.getAudioContext();
    
    // Clean up any existing connections first
    if (this.preEQGain) {
      this.preEQGain.disconnect();
    }
    
    // Create a gain node if needed to connect to the analyzer
    if (!this.preEQGain) {
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
    }
    
    // Store the analyzer reference
    this.preEQAnalyser = analyser;
    
    // Connect gain to analyzer and to EQ processor
    const eq = eqProcessor.getEQProcessor();
    this.preEQGain.connect(this.preEQAnalyser);
    this.preEQGain.connect(eq.getInputNode());
    
    // Reconnect all sources to include analyzer in the signal chain
    this.reconnectAllSources();
  }
  
  /**
   * Disconnect from the external analyzer
   */
  public disconnectFromAnalyser(): void {
    // Clear the analyzer reference
    this.preEQAnalyser = null;
    
    // Reconnect all sources directly to destination
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
      
      // Reconnect without the analyzer
      this.reconnectAllSources();
    }
  }
  
  /**
   * Reconnect all sources to include the analyzer in the signal chain
   */
  private reconnectAllSources(): void {
    // Skip if no audio nodes
    if (this.audioNodes.size === 0) return;
    
    // Simplify: always use preEQGain if available, otherwise connect directly to EQ
    const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();
    
    // Reconnect all sources to our single determined destination
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        // Disconnect gain from its current destination
        nodes.gain.disconnect();
        
        // Connect to the appropriate destination
        nodes.gain.connect(destinationNode);
      } catch (e) {
        console.error(`Error reconnecting source for dot ${dotKey}:`, e);
      }
    });
  }

  /**
   * Update the set of active dots and their states
   * @param dots Map of dot coordinates to their state ('on' or 'quiet')
   * @param currentGridSize Optional grid size update
   * @param currentColumns Optional column count update
   */
  public updateDots(dots: Map<string, 'on' | 'quiet'>, currentGridSize?: number, currentColumns?: number): void {
    // Update grid size if provided and changed
    if (currentGridSize && currentGridSize !== this.gridSize) {
      this.setGridSize(currentGridSize, currentColumns);
    }
    // Also update column count if only it changed but grid size didn't
    else if (currentColumns && currentColumns !== this.columnCount) {
      this.setGridSize(this.gridSize, currentColumns);
    }
    
    // Get current dots (dots that are not 'off')
    const currentDots = new Set(this.audioNodes.keys());
    const newDotsMap = new Map(dots); // Create a mutable map

    // Remove dots that are now 'off' (not in the new dots map)
    currentDots.forEach(dotKey => {
      if (!newDotsMap.has(dotKey)) {
        this.removeDot(dotKey);
      }
    });
    
    // Add new dots or update state of existing dots
    newDotsMap.forEach((state, dotKey) => {
      if (!this.audioNodes.has(dotKey)) {
        // Add new dot with its state
        this.addDot(dotKey, state);
      } else {
        // Update the state of an existing dot
        const nodes = this.audioNodes.get(dotKey);
        if (nodes) {
          nodes.state = state;
        }
      }
    });
    
    // If playing, restart rhythm
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.stopAllSources(); // Stop sources before restarting
      this.startAllSources(); // Start sources with updated nodes
      this.startAllRhythms(); // Restart rhythm
    }
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;

    console.log('🔊 Set playing state:', playing);
    
    if (playing) {
      this.startAllSources();
      this.startAllRhythms();
      
      // Reset volume pattern index - REINTRODUCED
      this.volumePatternIndex = 0;
    } else {
      this.stopAllRhythms();
      this.stopAllSources();
    }
  }

  /**
   * Start all rhythm timers - using requestAnimationFrame
   */
  private startAllRhythms(): void {
    // Initialize animation frame properties
    this.animationFrameId = null;
    
    // Get dots ordered left-to-right, top-to-bottom (like reading English text)
    const orderedDots = Array.from(this.audioNodes.entries())
      .sort(([keyA], [keyB]) => {
        const [xA, yA] = keyA.split(',').map(Number);
        const [xB, yB] = keyB.split(',').map(Number);
        
        // Compare row (y) first, then column (x)
        if (yA !== yB) return yA - yB;
        return xA - xB;
      })
      .map(([key]) => key);
    
    if (orderedDots.length === 0) return; // Use ordered list length
    
    // State tracking for sequential dot playback
    let currentDotIndex = 0;
    
    // Start the animation frame loop for independent dot rhythms
    const frameLoop = (timestamp: number) => {
      if (!this.isPlaying) return;
      
      const ctx = audioContext.getAudioContext();
      const now = ctx.currentTime; // Use precise audio context time
      
      // Check if it's time for the next sequential trigger
      if (now - this.lastTriggerTime >= SEQUENTIAL_TRIGGER_DELAY) {
        // Get the current dot to trigger
        const dotKey = orderedDots[currentDotIndex];
        
        // Trigger this specific dot if it exists
        if (this.audioNodes.has(dotKey)) {
          // Calculate volume using pattern
          const volumeOffset = VOLUME_PATTERN[this.volumePatternIndex];
          const effectiveVolumeDb = this.baseDbLevel + volumeOffset;
          
          this.triggerDotEnvelope(dotKey, effectiveVolumeDb); // Use effective volume
        }
        
        // Update global last trigger time
        this.lastTriggerTime = now;
        
        // Advance to the next dot index
        currentDotIndex = (currentDotIndex + 1) % orderedDots.length;
        
        // Advance volume pattern index
        this.volumePatternIndex = (this.volumePatternIndex + 1) % VOLUME_PATTERN.length;
      }
      
      // Schedule next frame
      this.animationFrameId = requestAnimationFrame(frameLoop);
    };
    
    this.animationFrameId = requestAnimationFrame(frameLoop);
  }
  
  /**
   * Stop all rhythm timers
   */
  private stopAllRhythms(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Start all audio sources
   */
  private startAllSources(): void {
    const ctx = audioContext.getAudioContext();
    
    // Make sure we have pink noise buffer
    if (!this.pinkNoiseBuffer) {
      this.generatePinkNoiseBuffer();
      return;
    }
    
    // Simplify: use preEQGain if available, otherwise connect directly to EQ
    const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();
    
    // If we need to create a preEQGain for analyzer but don't have one yet
    if (this.preEQAnalyser && !this.preEQGain) {
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
      this.preEQGain.connect(this.preEQAnalyser);
      
      // Connect directly to EQ input
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode());
    }
    
    // Start each source with the determined destination
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        // Create a new source
        const source = ctx.createBufferSource();
        source.buffer = this.pinkNoiseBuffer;
        source.loop = true;
        
        // Connect the audio chain - simple bandpass approach
        // source -> filter -> panner -> envelopeGain -> gain -> destinationNode
        source.connect(nodes.filter);
        nodes.filter.connect(nodes.panner);
        nodes.panner.connect(nodes.envelopeGain);
        nodes.envelopeGain.connect(nodes.gain);
        
        // Apply the distortion gain to each individual node's gain
        // Initial gain value - will be modified by volumeDb in triggerDotEnvelope
        nodes.gain.gain.value = MASTER_GAIN * this.distortionGain;
        
        // Connect to the single determined destination point
        nodes.gain.connect(destinationNode);
        
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
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        if (nodes.source) {
          // Add a property to track if the source has been started
          nodes.source.stop();
          nodes.source.disconnect();
        }
      } catch (e) {
        console.error(`Error stopping source for dot ${dotKey}:`, e);
      }
    });
  }

  /**
   * Trigger the envelope for a specific dot with volume parameter
   * @param dotKey The dot to trigger
   * @param volumeDb Volume in dB to apply (base level)
   */
  private triggerDotEnvelope(dotKey: string, volumeDb: number = 0): void {
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime; // Always use current time now
    
    // Determine effective volume based on state
    let effectiveVolumeDb = volumeDb;
    if (nodes.state === 'quiet') {
      effectiveVolumeDb -= 18; // Reduce volume by 18dB for quiet state
    }
    
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
    
    // Apply volume in dB to gain
    // Convert dB to gain ratio (0dB = 1.0)
    const gainRatio = Math.pow(10, effectiveVolumeDb / 20); // Use effectiveVolumeDb
    
    // Apply to this node's gain
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain * gainRatio, now);
    
    // Reset envelope to minimum gain
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
  }

  /**
   * Add a new dot to the audio system
   * @param dotKey The dot identifier string "x,y"
   * @param state The initial state ('on' or 'quiet')
   */
  private addDot(dotKey: string, state: 'on' | 'quiet'): void {
    const [x, y] = dotKey.split(',').map(Number);
    
    // Create audio nodes for this dot
    const ctx = audioContext.getAudioContext();
    
    // Normalize y to 0-1 range (0 = bottom, 1 = top)
    const normalizedY = this.gridSize <= 1 ? 0.5 : 1 - (y / (this.gridSize - 1)); // Handle single row case
    
    // Calculate the frequency for this position
    const minFreq = 40;  // Lower minimum for better low-end
    const maxFreq = 15000; // Lower maximum to avoid harsh high-end
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
    
    // Set Q value
    const qValue = 1.0;
    
    // Create filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerFreq;
    filter.Q.value = qValue;
    
    // Store the nodes with simplified structure and initial state
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      envelopeGain: ctx.createGain(),
      panner,
      filter,
      position: y * this.columnCount + x, // Store position for sorting
      state: state, // Store the initial state
    });
  }
  
  /**
   * Remove a dot from the audio system
   */
  private removeDot(dotKey: string): void {
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    // Stop and disconnect the source if it's playing
    if (this.isPlaying && nodes.source) {
      try {
        nodes.source.stop();
        nodes.source.disconnect();
      } catch (e) {
        // Ignore errors when stopping
        console.warn(`Warning when stopping source for dot ${dotKey}:`, e);
      }
    }
    
    // Remove from the map
    this.audioNodes.delete(dotKey);
  }

  /**
   * Set the master volume in dB
   * @param dbLevel Volume level in dB (0dB = reference level)
   */
  public setVolumeDb(dbLevel: number): void {
    this.baseDbLevel = dbLevel;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    this.stopAllRhythms();
    this.stopAllSources();
    
    // Ensure animation frames are cancelled
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
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

  // Add method to handle distortion gain
  private setDistortionGain(gain: number): void {
    // Clamp gain between 0 and 1
    this.distortionGain = Math.max(0, Math.min(1, gain));
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