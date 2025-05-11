import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
// import { getAudioPlayer } from './audioPlayer';
import { useEQProfileStore } from '../stores';

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx (odd number ensures a middle column)

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const ENVELOPE_ATTACK = 0.002; // Faster attack time in seconds - for very punchy transients
const ENVELOPE_RELEASE_LOW_FREQ = 0.2; // Release time for lowest frequencies (seconds)
const ENVELOPE_RELEASE_HIGH_FREQ = 0.02; // Release time for highest frequencies (seconds)
const MASTER_GAIN = 6.0; // Much louder master gain for calibration

// New constants for Sloped Pink Noise
const NUM_BANDS = 12; // Number of frequency bands for shaping
const SLOPE_REF_FREQUENCY = 600; // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20; // Hz
const MAX_AUDIBLE_FREQ = 20000; // Hz
const BAND_Q_VALUE = 1.5; // Q value for the bandpass filters (reduced from 6.0)
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise

// Target overall slopes
const LOW_SLOPE_DB_PER_OCT = -9.0; // For low y positions (darker sound)
const CENTER_SLOPE_DB_PER_OCT = -3.0; // For middle y positions
const HIGH_SLOPE_DB_PER_OCT = 3.0; // For high y positions (brighter sound)
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1; // Scalar to reduce output of SlopedPinkNoiseGenerator (approx -12dB)

// New constant for attenuation based on slope deviation from pink noise
const ATTENUATION_PER_DB_OCT_DEVIATION_DB = 0.0; // dB reduction per dB/octave deviation from -3dB/oct

// New constant for sequential dot playback
const DOT_ACTIVE_DURATION_S = 0.5; // Seconds each dot stays active in sequence
const DOT_STAGGER_INTERVAL_S = 0.1; // Seconds between triggering each dot in the sequence for overlap

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Volume pattern settings -- REMOVING
// const VOLUME_PATTERN = [0, -12, -6, -12]; // The fixed pattern in dB: 0dB, -12dB, -6dB, -12dB

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private audioNodes: Map<string, {
    source: AudioBufferSourceNode;
    gain: GainNode; // Overall gain for the dot
    envelopeGain: GainNode; // For ADSR envelope
    panner: StereoPannerNode;
    // filter: BiquadFilterNode; // Will be replaced
    slopedNoiseGenerator: SlopedPinkNoiseGenerator; // New generator
    position: number; // Position for sorting
    normalizedY: number; // Store normalized Y (0 to 1, 0=bottom)
  }> = new Map();
  private gridSize: number = 3; // Default row count
  private columnCount: number = COLUMNS; // Default column count
  private preEQAnalyser: AnalyserNode | null = null; // Pre-EQ analyzer node
  private preEQGain: GainNode | null = null; // Gain node for connecting all sources to analyzer
  
  // Animation frame properties
  private animationFrameId: number | null = null;
  
  // Properties for sequential dot playback
  private currentDotIndex: number = 0;
  private lastSwitchTime: number = 0;
  
  // Volume pattern properties -- REMOVING
  // private volumePatternIndex: number = 0; // Current position in volume pattern
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
   * Update the set of active dots
   * @param dots Set of dot coordinates
   * @param currentGridSize Optional grid size update
   * @param currentColumns Optional column count update
   */
  public updateDots(dots: Set<string>, currentGridSize?: number, currentColumns?: number): void {
    // Update grid size if provided and changed
    if (currentGridSize && currentGridSize !== this.gridSize) {
      this.setGridSize(currentGridSize, currentColumns);
    }
    // Also update column count if only it changed but grid size didn't
    else if (currentColumns && currentColumns !== this.columnCount) {
      this.setGridSize(this.gridSize, currentColumns);
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
    
    // If playing, restart rhythm
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
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;

    console.log('🔊 Set playing state:', playing);
    
    if (playing) {
      this.startAllSources();
      this.startAllRhythms();
      
      // Reset volume pattern index -- REMOVING
      // this.volumePatternIndex = 0;
      
      // Immediately trigger all dots once for instant feedback
      // if (this.audioNodes.size > 0) {
      //   const dotKeys = Array.from(this.audioNodes.keys());
      //   const volumeDb = this.baseDbLevel;
      //   if (dotKeys.length > 0) {
      //     // This was an attempt to trigger only the first, startAllRhythms handles all now
      //   }
      // }
    } else {
      this.stopAllRhythms();
      this.stopAllSources();
    }
  }

  /**
   * Start all rhythm timers - using requestAnimationFrame
   */
  private startAllRhythms(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Get initial volume from pattern -- REMOVING (use baseDbLevel)
    // const initialVolumeDb = this.baseDbLevel + VOLUME_PATTERN[this.volumePatternIndex];
    const initialVolumeDb = this.baseDbLevel;
    
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
    
    if (orderedDots.length === 0) return;
    
    // New logic: Apply sound parameters to all active dots once. -- REPLACING WITH SEQUENCER
    // if (!this.isPlaying) return;
    // orderedDots.forEach(dotKey => {
    //   if (this.audioNodes.has(dotKey)) {
    //     this.applyDotSoundParameters(dotKey, initialVolumeDb); // initialVolumeDb is now this.baseDbLevel
    //   }
    // });

    if (!this.isPlaying) return;

    // Ensure all dots are initially silent (their envelopeGain is min)
    const nowCtxTime = audioContext.getAudioContext().currentTime;
    this.audioNodes.forEach(nodes => {
      nodes.envelopeGain.gain.cancelScheduledValues(nowCtxTime);
      nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, nowCtxTime);
    });

    this.currentDotIndex = 0;
    this.lastSwitchTime = performance.now() / 1000; // Use performance.now for timing animation frames

    // Activate the first dot immediately
    if (orderedDots.length > 0 && this.audioNodes.has(orderedDots[this.currentDotIndex])) {
      this.applyDotSoundParameters(orderedDots[this.currentDotIndex], initialVolumeDb);
      // Prepare for the loop: advance index for the *next* trigger in the frame loop
      this.currentDotIndex = (this.currentDotIndex + 1) % orderedDots.length; 
    }

    const frameLoop = (timestamp: number) => {
      if (!this.isPlaying) return;

      const now = timestamp / 1000;
      // Check if it's time to trigger the NEXT dot in the sequence
      if (now - this.lastSwitchTime >= DOT_STAGGER_INTERVAL_S) {
        // const currentCtxTime = audioContext.getAudioContext().currentTime; // Not needed here

        // Silence the previous dot -- REMOVING THIS. Each dot plays its full envelope.
        // const prevDotKey = orderedDots[this.currentDotIndex]; // This logic is now incorrect for currentDotIndex
        // const prevNodes = this.audioNodes.get(prevDotKey);
        // if (prevNodes) {
        //   prevNodes.envelopeGain.gain.cancelScheduledValues(currentCtxTime);
        //   prevNodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, currentCtxTime);
        // }

        // Activate the current dot in the sequence
        if (orderedDots.length > 0) { // Check if still dots, e.g. if all were removed mid-sequence
          const dotToTriggerKey = orderedDots[this.currentDotIndex];
          if (this.audioNodes.has(dotToTriggerKey)) {
            this.applyDotSoundParameters(dotToTriggerKey, initialVolumeDb);
          }
          // Advance index for the next trigger
          this.currentDotIndex = (this.currentDotIndex + 1) % orderedDots.length;
        }
        
        this.lastSwitchTime = now; // Or this.lastSwitchTime += DOT_STAGGER_INTERVAL_S for precision
      }
      
      this.animationFrameId = requestAnimationFrame(frameLoop);
    };

    // Start the loop only if there are dots to play
    if (orderedDots.length > 0) {
      this.animationFrameId = requestAnimationFrame(frameLoop);
    } else {
      // If no dots, ensure any lingering animation frame is cancelled
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }
  }
  
  /**
   * Stop all rhythm timers
   */
  private stopAllRhythms(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Optionally, explicitly silence envelopeGains, though stopAllSources should also lead to silence.
    // This provides a more immediate stop to the perceived sound if sources take a moment to fully stop.
    this.audioNodes.forEach(nodes => {
      if (nodes.envelopeGain) {
        const now = audioContext.getAudioContext().currentTime;
        nodes.envelopeGain.gain.cancelScheduledValues(now);
        nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now);
      }
    });
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
        
        // Connect the audio chain using SlopedPinkNoiseGenerator
        // source -> slopedNoiseGenerator.input -> slopedNoiseGenerator.output -> panner -> envelopeGain -> gain -> destinationNode
        source.connect(nodes.slopedNoiseGenerator.getInputNode());
        nodes.slopedNoiseGenerator.getOutputNode().connect(nodes.panner);
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
   * @param volumeDb Volume in dB to apply
   */
  // private triggerDotEnvelope(dotKey: string, volumeDb: number = 0): void { // RENAMING
  private applyDotSoundParameters(dotKey: string, volumeDb: number = 0): void {
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime;
    const { slopedNoiseGenerator, normalizedY, gain: dotMainGain, envelopeGain: dotEnvelopeGain } = nodes;

    // 1. Calculate and set the spectral slope
    let targetOverallSlopeDbPerOctave;
    if (normalizedY < 0.5) {
      // Interpolate between LOW_SLOPE and CENTER_SLOPE
      // normalizedY from 0 to 0.499... corresponds to t from 0 to 0.999...
      const t = normalizedY * 2;
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      // Interpolate between CENTER_SLOPE and HIGH_SLOPE
      // normalizedY from 0.5 to 1.0 corresponds to t from 0 to 1.0
      const t = (normalizedY - 0.5) * 2;
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }
    slopedNoiseGenerator.setSlope(targetOverallSlopeDbPerOctave);
    
    // 2. Calculate release time based on normalizedY (which correlates with slope) -- REMOVING
    // Low Y (darker slope, e.g. LOW_SLOPE_DB_PER_OCT) = longer release
    // High Y (brighter slope, e.g. HIGH_SLOPE_DB_PER_OCT) = shorter release
    // normalizedY: 0 (bottom, darkest) -> 1 (top, brightest)
    // const releaseTime = ENVELOPE_RELEASE_LOW_FREQ + 
    //   normalizedY * (ENVELOPE_RELEASE_HIGH_FREQ - ENVELOPE_RELEASE_LOW_FREQ);

    // (The old frequency-dependent release calculation is removed)
    // ... (omitting removed commented out code for brevity)
    
    // 3. Apply volume in dB to the dot's main gain node
    // Calculate deviation from pink noise slope for additional attenuation
    const slopeDeviation = Math.abs(targetOverallSlopeDbPerOctave - PINK_NOISE_SLOPE_DB_PER_OCT);
    const additionalAttenuationDb = slopeDeviation * ATTENUATION_PER_DB_OCT_DEVIATION_DB;
    const finalVolumeDb = volumeDb + additionalAttenuationDb;

    const gainRatio = Math.pow(10, finalVolumeDb / 20);
    dotMainGain.gain.cancelScheduledValues(now);
    dotMainGain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain * gainRatio, now);
    
    // 4. ADSR Envelope on the envelopeGain node
    dotEnvelopeGain.gain.cancelScheduledValues(now);
    dotEnvelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now); // Start at min
    
    // Calculate release time based on normalizedY (which correlates with slope)
    // Low Y (darker slope) = longer release, High Y (brighter slope) = shorter release
    const releaseTime = ENVELOPE_RELEASE_LOW_FREQ + 
      normalizedY * (ENVELOPE_RELEASE_HIGH_FREQ - ENVELOPE_RELEASE_LOW_FREQ);
    
    // Attack
    dotEnvelopeGain.gain.linearRampToValueAtTime(
      ENVELOPE_MAX_GAIN, 
      now + ENVELOPE_ATTACK
    );
    
    // Release - Ensure release doesn't go beyond the dot's active duration too much, 
    // though the hard cut-off in startAllRhythms will truncate it if it's longer.
    // For a 0.5s slot, a long release might be mostly cut off.
    const effectiveReleaseTime = releaseTime; // For now, use full calculated release

    dotEnvelopeGain.gain.exponentialRampToValueAtTime(
      0.001, // Can't go to zero with exponentialRamp, use very small value
      now + ENVELOPE_ATTACK + effectiveReleaseTime
    );
    
    // Finally set to zero after the exponential ramp
    dotEnvelopeGain.gain.setValueAtTime(0, now + ENVELOPE_ATTACK + effectiveReleaseTime + 0.001);
  }

  /**
   * Add a new dot to the audio system
   */
  private addDot(dotKey: string): void {
    const [x, y] = dotKey.split(',').map(Number);
    
    // Create audio nodes for this dot
    const ctx = audioContext.getAudioContext();
    
    // Normalize y to 0-1 range (0 = bottom, 1 = top)
    const normalizedY = this.gridSize <= 1 ? 0.5 : 1 - (y / (this.gridSize - 1)); // Flip so higher y = higher position, handle single row case
    
    // Calculate the frequency for this position -- (This section is no longer needed as frequency is handled by SlopedPinkNoiseGenerator)
    // const minFreq = 40;  // Lower minimum for better low-end
    // const maxFreq = 15000; // Lower maximum to avoid harsh high-end
    // const logMinFreq = Math.log2(minFreq);
    // const logMaxFreq = Math.log2(maxFreq);
    // const logFreqRange = logMaxFreq - logMinFreq;
    // const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Create a gain node for volume
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN;
    
    // Create a panner node for stereo positioning
    const panner = ctx.createStereoPanner();
    
    // Simple panning calculation that evenly distributes columns from -1 to 1
    // First column (x=0) will be -1 (full left), last column will be 1 (full right)
    const panPosition = this.columnCount <= 1 ? 0 : (2 * (x / (this.columnCount - 1)) - 1);
    
    panner.pan.value = panPosition;
    
    // Set Q value -- (No longer needed here, Q is fixed in SlopedPinkNoiseGenerator)
    // const qValue = 6.0;
    
    // Create filter -- (No longer needed here, filters are in SlopedPinkNoiseGenerator)
    // const filter = ctx.createBiquadFilter();
    // filter.type = 'bandpass';
    // filter.frequency.value = centerFreq;
    // filter.Q.value = qValue;

    // Create the sloped noise generator for this dot
    const slopedNoiseGenerator = new SlopedPinkNoiseGenerator(ctx);
    
    // Store the nodes with simplified structure
    this.audioNodes.set(dotKey, {
      source: ctx.createBufferSource(), // Dummy source (will be replaced when playing)
      gain,
      envelopeGain: ctx.createGain(),
      panner,
      slopedNoiseGenerator, // Store the new generator instance
      position: y * this.columnCount + x, // Store position for sorting
      normalizedY, // Store normalized Y
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

    // Dispose the sloped noise generator
    if (nodes.slopedNoiseGenerator) {
      nodes.slopedNoiseGenerator.dispose();
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
    
    // Dispose SlopedPinkNoiseGenerator for each dot
    this.audioNodes.forEach(node => {
      if (node.slopedNoiseGenerator) {
        node.slopedNoiseGenerator.dispose();
      }
    });
    
    this.audioNodes.clear();
    this.pinkNoiseBuffer = null;
  }

  // Add method to handle distortion gain
  private setDistortionGain(gain: number): void {
    // Clamp gain between 0 and 1
    this.distortionGain = Math.max(0, Math.min(1, gain));
  }
}

class SlopedPinkNoiseGenerator {
  private ctx: AudioContext;
  private inputGainNode: GainNode;
  private outputGainNode: GainNode;
  private bandFilters: BiquadFilterNode[] = [];
  private bandGains: GainNode[] = [];
  private centerFrequencies: number[] = [];

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.inputGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = SLOPED_NOISE_OUTPUT_GAIN_SCALAR; // Apply output gain reduction

    const logMinFreq = Math.log2(MIN_AUDIBLE_FREQ);
    const logMaxFreq = Math.log2(MAX_AUDIBLE_FREQ);
    const step = (logMaxFreq - logMinFreq) / (NUM_BANDS + 1);

    for (let i = 0; i < NUM_BANDS; i++) {
      const centerFreq = Math.pow(2, logMinFreq + (i + 1) * step);
      this.centerFrequencies.push(centerFreq);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = centerFreq;
      filter.Q.value = BAND_Q_VALUE;
      this.bandFilters.push(filter);

      const gain = this.ctx.createGain();
      this.bandGains.push(gain);

      // Connect input to filter, filter to bandGain, bandGain to output
      this.inputGainNode.connect(filter);
      filter.connect(gain);
      gain.connect(this.outputGainNode);
    }
  }

  public getInputNode(): GainNode {
    return this.inputGainNode;
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setSlope(targetOverallSlopeDbPerOctave: number): void {
    const shapingSlope = targetOverallSlopeDbPerOctave - PINK_NOISE_SLOPE_DB_PER_OCT;

    for (let i = 0; i < NUM_BANDS; i++) {
      const fc = this.centerFrequencies[i];
      const gainDb = shapingSlope * Math.log2(fc / SLOPE_REF_FREQUENCY);
      const linearGain = Math.pow(10, gainDb / 20);
      this.bandGains[i].gain.value = linearGain;
    }
  }

  public dispose(): void {
    this.inputGainNode.disconnect();
    this.outputGainNode.disconnect();
    this.bandFilters.forEach(filter => filter.disconnect());
    this.bandGains.forEach(gain => gain.disconnect());
    // Nullify references if needed, though JS garbage collection should handle it
    // once these nodes are no longer referenced elsewhere.
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