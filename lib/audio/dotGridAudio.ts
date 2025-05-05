import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
// import { getAudioPlayer } from './audioPlayer';
import { useEQProfileStore } from '../stores';

// Constants
const COLUMNS = 5; // Default panning positions - match the value in dot-grid.tsx (odd number ensures a middle column)
const SIMULTANEOUS_STAGGER_DELAY = 0.015; // Stagger offset for simultaneous mode start

// Define Rhythmic Patterns (arrays of delays in seconds)
// Assuming 120 BPM (0.5s beat)
// Dotted 8th = 0.375s, 8th = 0.25s
// const SELECTED_RHYTHM = [0.375, 0.375, 0.25]; // Dotted 8th - Dotted 8th - 8th
const SELECTED_RHYTHM = [0.125, 0.125, 0.125]; // Faster: Straight 16th notes at 120 BPM
const UNSELECTED_RHYTHM = [0.5, 0.5, 0.5, 0.5]; // Steady 1/4 notes for unselected dots

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

// Volume pattern settings - REMOVED
// const VOLUME_PATTERN = [0, 0, 0, 0]

// Define the possible states for a dot - REMOVED 'quiet'
export type DotState = 'on' | 'off'; // Simplified state

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
    state: DotState; // Updated state type
    // Timing/Rhythm Info (needed for different modes)
    lastTriggerTime: number; 
    rhythmPattern: number[]; // Will be SELECTED_RHYTHM or UNSELECTED_RHYTHM based on state
    rhythmIndex: number;
    // Add frequency shift properties
    originalCenterFreq: number; // Original calculated frequency (added to type)
  }> = new Map();
  private gridSize: number = 3; // Default row count
  private columnCount: number = COLUMNS; // Default column count
  private preEQAnalyser: AnalyserNode | null = null; // Pre-EQ analyzer node
  private preEQGain: GainNode | null = null; // Gain node for connecting all sources to analyzer
  
  // Animation frame properties
  private animationFrameId: number | null = null;
  
  // Playback Mode - REMOVED
  // private playbackMode: 'sequential' | 'simultaneous_staggered' = 'sequential';

  // Volume pattern properties - REMOVED INDEX
  // private volumePatternIndex: number = 0; // Current position in volume pattern (Sequential Mode)
  
  // Volume Control - NEW PROPERTIES
  private selectedVolumeDb: number = 0; // Volume for 'on' dots
  private unselectedVolumeDb: number = 0; // Volume for 'off' dots

  // Add distortion gain property
  private distortionGain: number = 1.0;
  
  // Add frequency shift factor property
  private frequencyShiftFactor: number = 1.0; // 1.0 means no shift

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
    const oldGridSize = this.gridSize;
    const oldColumnCount = this.columnCount;

    this.gridSize = rows;
    if (columns !== undefined) {
      this.columnCount = columns;
    }

    // --- Rebuild Nodes if Grid Size Changed ---
    // More robust handling: remove old nodes, add all new potential nodes
    if (rows !== oldGridSize || (columns !== undefined && columns !== oldColumnCount)) {
        // Stop existing playback before rebuilding nodes
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
          this.setPlaying(false);
        }

        // Clear existing nodes
        this.audioNodes.forEach((nodes, key) => this.removeDotInternal(key, false)); // Internal remove without map deletion during iteration
        this.audioNodes.clear(); // Clear the map after stopping/disconnecting all

        // Add nodes for all positions in the new grid
        for (let y = 0; y < this.gridSize; y++) {
          for (let x = 0; x < this.columnCount; x++) {
            const dotKey = `${x},${y}`;
            // Add dots initially as 'off'
            this.addDotInternal(dotKey, 'off'); 
          }
        }
        
        // Restart playback if it was playing before
        if (wasPlaying) {
          this.setPlaying(true);
        } else {
          // Ensure sources are connected even if not playing immediately
          this.reconnectAllSources(); 
        }
    }
    // --- End Rebuild ---
    // Original panning update (still needed if only columns change without size rebuild)
    // else if (columns !== undefined && columns !== oldColumnCount) {
    //   this.updateAllDotPanning(); // Might be redundant if rebuild handled it
    // }
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
   * @param dots Map of dot coordinates to their state ('on' only, missing means 'off')
   * @param currentGridSize Optional grid size update
   * @param currentColumns Optional column count update
   */
  public updateDots(dots: Map<string, 'on'>, currentGridSize?: number, currentColumns?: number): void {
    // Update grid size if provided and changed - This will rebuild nodes
    if ((currentGridSize && currentGridSize !== this.gridSize) || (currentColumns && currentColumns !== this.columnCount)) {
      this.setGridSize(currentGridSize ?? this.gridSize, currentColumns ?? this.columnCount);
    }

    // Get current dots keys from the internal map
    const currentDotKeys = new Set(this.audioNodes.keys());

    // Iterate through all possible dots in the grid
    currentDotKeys.forEach(dotKey => {
      const nodes = this.audioNodes.get(dotKey);
      if (nodes) {
        const newState = dots.has(dotKey) ? 'on' : 'off';
        
        // Update state and rhythm pattern if it changed
        if (nodes.state !== newState) {
          nodes.state = newState;
          nodes.rhythmPattern = (newState === 'on') ? SELECTED_RHYTHM : UNSELECTED_RHYTHM;
          nodes.rhythmIndex = 0; // Reset rhythm index on state change
          
          // Optional: Immediately silence envelope if changing state while playing?
          // if (this.isPlaying) {
          //   nodes.envelopeGain.gain.cancelScheduledValues(audioContext.getAudioContext().currentTime);
          //   nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, audioContext.getAudioContext().currentTime);
          // }
        }
      }
    });

    // If playing, restart rhythm to apply new states immediately
    // Note: Restarting sources might cause clicks, consider just updating states
    // and letting the animation loop pick up the changes. Let's try without restart first.
    // if (this.isPlaying) {
    //   this.stopAllRhythms();
    //   // this.stopAllSources(); // Avoid stopping/starting sources if possible
    //   // this.startAllSources(); 
    //   this.startAllRhythms(); // Restart rhythm logic
    // }
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;

    console.log('🔊 Set playing state:', playing);
    
    if (playing) {
      // Ensure all sources are created and connected if not already
      if (this.audioNodes.size === 0 || !Array.from(this.audioNodes.values())[0]?.source?.buffer) {
         // Re-initialize nodes if needed (e.g., after dispose or initial load)
         this.rebuildAllNodesAndSources(); 
      } else {
        // Ensure all nodes have sources connected
        this.ensureAllSourcesConnected();
      }
      this.startAllRhythms();
    } else {
      this.silenceAllEnvelopes(); // Gently silence instead of hard stop
      // this.stopAllSources(); // Consider if immediate stop is needed
    }
  }

  // Helper to gently silence envelopes
  private silenceAllEnvelopes(): void {
    const now = audioContext.getAudioContext().currentTime;
    this.audioNodes.forEach(nodes => {
        nodes.envelopeGain.gain.cancelScheduledValues(now);
        // Ramp down quickly
        nodes.envelopeGain.gain.linearRampToValueAtTime(ENVELOPE_MIN_GAIN, now + 0.05); 
    });
  }

  // Helper to ensure all nodes have connected sources (used in setPlaying(true))
  private ensureAllSourcesConnected(): void {
    const ctx = audioContext.getAudioContext();
    if (!this.pinkNoiseBuffer) {
      console.warn("Pink noise buffer not ready in ensureAllSourcesConnected");
      this.generatePinkNoiseBuffer().then(() => this.ensureAllSourcesConnected()); // Retry after generation
      return;
    }
    
    const destinationNode = this.getDestinationNode();

    this.audioNodes.forEach((nodes, dotKey) => {
      // Check if source exists and is connected; if not, create and connect
      // Basic check: assumes if nodes.source exists, it's connected correctly
      // A more robust check might involve try/catch on connect or tracking connection state
      if (!nodes.source || !nodes.source.buffer) { 
        try {
          const source = ctx.createBufferSource();
          source.buffer = this.pinkNoiseBuffer;
          source.loop = true;

          source.connect(nodes.filter);
          nodes.filter.connect(nodes.panner);
          nodes.panner.connect(nodes.envelopeGain);
          nodes.envelopeGain.connect(nodes.gain);
          nodes.gain.connect(destinationNode);

          // Set initial gain based on distortion + master, envelope handles actual sounding
          nodes.gain.gain.value = MASTER_GAIN * this.distortionGain; 
          nodes.envelopeGain.gain.value = ENVELOPE_MIN_GAIN; // Start silent

          source.start();
          nodes.source = source;
        } catch (e) {
            console.error(`Error ensuring source connection for dot ${dotKey}:`, e);
            // Attempt to clean up partially created nodes?
            if (nodes.source) {
                try { nodes.source.disconnect(); } catch (_) {}
            }
        }
      }
    });
  }
  
  // Helper to rebuild all nodes and sources (e.g., after dispose)
  private rebuildAllNodesAndSources(): void {
    console.log("Rebuilding all nodes and sources...");
    this.audioNodes.clear();
    for (let y = 0; y < this.gridSize; y++) {
        for (let x = 0; x < this.columnCount; x++) {
            const dotKey = `${x},${y}`;
            this.addDotInternal(dotKey, 'off'); // Add as off initially
        }
    }
    this.ensureAllSourcesConnected(); // Create and connect sources
  }

  /**
   * Start the hybrid rhythm loop
   */
  private startAllRhythms(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId); // Ensure previous loop is stopped
    }
    
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime;

    // --- Initialize Rhythm State for 'on' dots (persists across frames) ---
    let onDotIndex = 0;
    let onDotLastTriggerTime = now; // Tracks the time the *sequence* last triggered
    let onDotRhythmIndex = 0; // Index within SELECTED_RHYTHM

    // --- Initialize 'off' dots (stagger is set once initially) ---
    // Scan nodes *once* here to set initial stagger times
    const initialOffDots: string[] = [];
    this.audioNodes.forEach((nodes, key) => {
        if (nodes.state === 'off') {
            initialOffDots.push(key);
        }
    });
    initialOffDots.sort((keyA, keyB) => { // Sort for consistent stagger
        const [xA, yA] = keyA.split(',').map(Number);
        const [xB, yB] = keyB.split(',').map(Number);
        if (yA !== yB) return yA - yB;
        return xA - xB;
    });
    initialOffDots.forEach((dotKey, index) => {
        const nodes = this.audioNodes.get(dotKey);
        if (nodes) {
            // Only set lastTriggerTime initially; rhythm logic will advance it
            nodes.lastTriggerTime = now + index * SIMULTANEOUS_STAGGER_DELAY;
            nodes.rhythmIndex = 0;
            nodes.rhythmPattern = UNSELECTED_RHYTHM;
        }
    });
    // Initialize 'on' dots (rhythm index needs reset)
    this.audioNodes.forEach((nodes, key) => {
        if (nodes.state === 'on') {
            nodes.rhythmIndex = 0;
            nodes.rhythmPattern = SELECTED_RHYTHM;
        }
    });

    // --- Animation Frame Loop ---
    const frameLoop = (timestamp: number) => {
      if (!this.isPlaying) {
          this.animationFrameId = null; // Ensure stopped
          return; 
      }
      
      const currentCtxTime = ctx.currentTime;
      
      // --- DYNAMICALLY Identify and Sort Dots ON EACH FRAME ---
      const currentOnDots: string[] = [];
      const currentOffDots: string[] = [];
      this.audioNodes.forEach((nodes, key) => {
        if (nodes.state === 'on') {
          currentOnDots.push(key);
        } else {
          currentOffDots.push(key);
        }
      });
      
      // Sort 'on' dots: top-to-bottom, then left-to-right
      currentOnDots.sort((keyA, keyB) => {
        const [xA, yA] = keyA.split(',').map(Number);
        const [xB, yB] = keyB.split(',').map(Number);
        if (yA !== yB) return yA - yB; // Sort by row first
        return xA - xB; // Then by column
      });
      
      // Sort 'off' dots for consistent stagger (optional, but good practice)
      currentOffDots.sort((keyA, keyB) => {
           const [xA, yA] = keyA.split(',').map(Number);
           const [xB, yB] = keyB.split(',').map(Number);
           if (yA !== yB) return yA - yB;
           return xA - xB;
       });
      // --- End Dynamic Identification ---
      
      // --- Process 'on' Dots (Sequential Rhythm) ---
      if (currentOnDots.length > 0) {
          // Get the delay from the rhythm pattern based on its current index
          const currentRhythmDelay = SELECTED_RHYTHM[onDotRhythmIndex];
          
          // Check if it's time for the next sequential trigger
          if (currentCtxTime >= onDotLastTriggerTime + currentRhythmDelay) {
              // Ensure onDotIndex is valid for the current list length
              if (onDotIndex >= currentOnDots.length) {
                  onDotIndex = 0; // Reset if index is out of bounds
              }
              const dotKeyToTrigger = currentOnDots[onDotIndex];
              
              // Trigger the current 'on' dot
              this.triggerDotEnvelope(dotKeyToTrigger, this.selectedVolumeDb); 
              
              // Update time for the *next* trigger in the sequence
              onDotLastTriggerTime += currentRhythmDelay; 
              
              // Move to the next dot in the sequence (wrap around)
              onDotIndex = (onDotIndex + 1) % currentOnDots.length;
              
              // Move to the next step in the rhythm pattern (wrap around)
              onDotRhythmIndex = (onDotRhythmIndex + 1) % SELECTED_RHYTHM.length;
              
              // Safety check for timing drift in the sequence
              if (onDotLastTriggerTime < currentCtxTime - currentRhythmDelay) {
                  console.warn("Selected dot sequence timing drift detected, resetting.");
                  onDotLastTriggerTime = currentCtxTime; 
              }
          }
      }

      // --- Process 'off' Dots (Staggered Steady Rhythm) ---
      currentOffDots.forEach(dotKey => {
          const nodes = this.audioNodes.get(dotKey);
          if (nodes) { 
              const pattern = UNSELECTED_RHYTHM; // Use the steady pattern
              const currentIndex = nodes.rhythmIndex;
              const currentDelay = pattern[currentIndex];
              
              if (currentCtxTime >= nodes.lastTriggerTime + currentDelay) {
                  // Trigger using unselected volume
                  this.triggerDotEnvelope(dotKey, this.unselectedVolumeDb); 
                  
                  // Update time and index for this dot
                  nodes.lastTriggerTime += currentDelay; 
                  nodes.rhythmIndex = (currentIndex + 1) % pattern.length;
                  
                  // Safety check for timing drift for this specific dot
                  if (nodes.lastTriggerTime < currentCtxTime - currentDelay) {
                      // console.warn(`Unselected dot ${dotKey} timing drift, resetting.`);
                      nodes.lastTriggerTime = currentCtxTime;
                  }
              }
          }
      });
      
      this.animationFrameId = requestAnimationFrame(frameLoop);
    };
    this.animationFrameId = requestAnimationFrame(frameLoop);
  }
  
  /**
   * Start all audio sources - REVISED: Ensure sources exist for all nodes
   */
  private startAllSources(): void {
      console.warn("startAllSources() called - this should likely be handled by ensureAllSourcesConnected() now.");
      // This method might become redundant or just call ensureAllSourcesConnected
      this.ensureAllSourcesConnected();
  }

  /**
   * Stop all audio sources - REVISED: Prefer gentle silence or disconnect
   */
  private stopAllSources(): void {
    console.log("Stopping all sources...");
    this.audioNodes.forEach((nodes, dotKey) => {
      try {
        if (nodes.source) {
          nodes.source.stop();
          nodes.source.disconnect(); // Disconnect everything associated with the source
          // Clear the reference to indicate it's stopped and disconnected
          // nodes.source = null; // Problematic if we need to restart later
        }
        // Also disconnect gain nodes to be safe
        if(nodes.gain) nodes.gain.disconnect();
        if(nodes.envelopeGain) nodes.envelopeGain.disconnect();
        if(nodes.panner) nodes.panner.disconnect();
        if(nodes.filter) nodes.filter.disconnect();
      } catch (e) {
        // Ignore errors often thrown if stop() was already called or node was disconnected
        // console.warn(`Warning stopping source for dot ${dotKey}:`, e);
      }
    });
     // Optionally clear the map if stopping means full cleanup
     // this.audioNodes.clear(); 
  }

  /**
   * Trigger the envelope for a specific dot with volume parameter
   * @param dotKey The dot to trigger
   * @param volumeDb Volume in dB for the group ('on' or 'off')
   */
  private triggerDotEnvelope(dotKey: string, volumeDb: number): void { // Removed default volumeDb = 0
    const nodes = this.audioNodes.get(dotKey);
    // Ensure node exists and has an envelopeGain node
    if (!nodes || !nodes.envelopeGain || !nodes.gain) return; 
    
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime;
    
    // Determine effective volume based on state - REMOVED 'quiet' logic
    let effectiveVolumeDb = volumeDb; 
    // if (nodes.state === 'quiet') { // Logic removed
    //   effectiveVolumeDb -= 18; 
    // }
    
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
    const gainRatio = Math.pow(10, effectiveVolumeDb / 20);
    
    // Apply to this node's gain (Master * Distortion * GroupVolumeRatio)
    // Ensure gain node exists before accessing property
    if (nodes.gain?.gain) { 
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain * gainRatio, now);
    } else {
        console.error(`Gain node or gain property missing for dot ${dotKey}`);
        return; // Exit if essential nodes are missing
    }
    
    // Reset envelope to minimum gain
    // Ensure envelopeGain node exists before accessing property
    if (nodes.envelopeGain?.gain) {
        nodes.envelopeGain.gain.cancelScheduledValues(now);
        nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now);
        
        // Attack
        nodes.envelopeGain.gain.linearRampToValueAtTime(
          ENVELOPE_MAX_GAIN, 
          now + ENVELOPE_ATTACK
        );
        
        // Release
        nodes.envelopeGain.gain.exponentialRampToValueAtTime(
          0.001, 
          now + ENVELOPE_ATTACK + releaseTime
        );
        
        // Final silence
        nodes.envelopeGain.gain.setValueAtTime(0, now + ENVELOPE_ATTACK + releaseTime + 0.001);
    } else {
         console.error(`EnvelopeGain node or gain property missing for dot ${dotKey}`);
    }
  }

  /**
   * Add a new dot to the audio system - INTERNAL HELPER
   * Creates nodes but doesn't connect source immediately.
   * @param dotKey The dot identifier string "x,y"
   * @param initialState The initial state ('on' or 'off')
   */
  private addDotInternal(dotKey: string, initialState: DotState): void {
    if (this.audioNodes.has(dotKey)) {
        // console.warn(`Dot ${dotKey} already exists in addDotInternal.`);
        return; // Avoid duplicate node creation
    }
    
    const [x, y] = dotKey.split(',').map(Number);
    const ctx = audioContext.getAudioContext();
    
    // Calculate frequency based on normalized Y
    const normalizedY = this.gridSize <= 1 ? 0.5 : 1 - (y / (this.gridSize - 1));
    const minFreq = 40;  // Lower minimum for better low-end
    const maxFreq = 15000; // Lower maximum to avoid harsh high-end
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Apply the frequency shift factor immediately
    const initialShiftedFreq = this.calculateShiftedFrequency(y, this.frequencyShiftFactor);
    
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN * this.distortionGain; // Initial gain includes distortion
    
    const panner = ctx.createStereoPanner();
    const panPosition = this.columnCount <= 1 ? 0 : (2 * (x / (this.columnCount - 1)) - 1);
    panner.pan.value = panPosition;
    
    const qValue = 1.0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = initialShiftedFreq; // Use the shifted frequency
    filter.Q.value = qValue;

    // Create a dummy source initially, will be replaced and connected on play
    const dummySource = ctx.createBufferSource(); 

    // Store the original calculated frequency before shift
    const originalCenterFreq = centerFreq / this.frequencyShiftFactor; // Store the pre-shift value

    // Store the nodes
    this.audioNodes.set(dotKey, {
      source: dummySource, // Start with dummy
      gain,
      envelopeGain: ctx.createGain(), // Envelope gain created here
      panner,
      filter,
      position: y * this.columnCount + x,
      state: initialState,
      // Store original frequency for recalculation on shift
      originalCenterFreq: originalCenterFreq, // Store the original frequency
      // Timing/Rhythm Info - Initialized properly in startAllRhythms
      lastTriggerTime: 0, 
      rhythmPattern: (initialState === 'on') ? SELECTED_RHYTHM : UNSELECTED_RHYTHM,
      rhythmIndex: 0, 
    });
  }
  
  /**
   * Remove a dot from the audio system - INTERNAL HELPER
   * Stops/disconnects nodes but doesn't remove from map immediately (if called during iteration).
   * @param dotKey The dot identifier string "x,y"
   * @param removeFromMap Whether to delete the entry from this.audioNodes map
   */
  private removeDotInternal(dotKey: string, removeFromMap: boolean = true): void {
    const nodes = this.audioNodes.get(dotKey);
    if (!nodes) return;
    
    // Stop and disconnect the source node
    if (nodes.source && nodes.source.buffer) { // Check if it's a real source
        try {
            nodes.source.stop();
        } catch (e) { /* Ignore error if already stopped */ }
        try {
            nodes.source.disconnect();
        } catch (e) { /* Ignore error if already disconnected */ }
    }
    
    // Disconnect other nodes in the chain
    try { nodes.gain.disconnect(); } catch (e) {}
    try { nodes.envelopeGain.disconnect(); } catch (e) {}
    try { nodes.panner.disconnect(); } catch (e) {}
    try { nodes.filter.disconnect(); } catch (e) {}

    // Remove from the map if requested
    if (removeFromMap) {
        this.audioNodes.delete(dotKey);
    }
  }

  /**
   * Public method to remove a dot (used by external logic if needed, though updateDots is primary)
   */
  public removeDot(dotKey: string): void {
    this.removeDotInternal(dotKey, true);
  }

  /**
   * Set the master volume in dB - RENAMED/REPLACED by specific volumes
   * @param dbLevel Volume level in dB (0dB = reference level)
   */
  // public setVolumeDb(dbLevel: number): void {
  //   this.baseDbLevel = dbLevel;
  // }
  
  /**
   * Set the volume for SELECTED ('on') dots in dB
   */
  public setSelectedVolumeDb(dbLevel: number): void {
    this.selectedVolumeDb = dbLevel;
    // No need to update gain nodes directly here, triggerDotEnvelope handles it
  }
  
  /**
   * Set the volume for UNSELECTED ('off') dots in dB
   */
  public setUnselectedVolumeDb(dbLevel: number): void {
    this.unselectedVolumeDb = dbLevel;
    // No need to update gain nodes directly here, triggerDotEnvelope handles it
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false); // Stops rhythms and silences envelopes
    this.stopAllSources(); // Full stop and disconnect of sources
    
    // Ensure animation frames are cancelled
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Clean up analyzer nodes
    if (this.preEQGain) {
      try { this.preEQGain.disconnect(); } catch(e) {}
      this.preEQGain = null;
    }
    if (this.preEQAnalyser) {
      try { this.preEQAnalyser.disconnect(); } catch(e) {}
      this.preEQAnalyser = null;
    }
    
    // Clear nodes map after stopping/disconnecting everything
    this.audioNodes.clear();
    this.pinkNoiseBuffer = null; // Release buffer reference
  }

  // Add method to handle distortion gain
  private setDistortionGain(gain: number): void {
    // Clamp gain between 0 and 1
    this.distortionGain = Math.max(0, Math.min(1, gain));
  }

  /**
   * Set the current playback mode. - REMOVED
   * Restarts rhythms if changed while playing.
   */
  // public setPlaybackMode(mode: 'sequential' | 'simultaneous_staggered'): void {
  // ... existing code ...
  // }
  
  // Helper to get the destination node (EQ input or Gain)
  private getDestinationNode(): AudioNode {
      // Ensure preEQGain exists if analyzer is present
      if (this.preEQAnalyser && !this.preEQGain) {
          const ctx = audioContext.getAudioContext();
          this.preEQGain = ctx.createGain();
          this.preEQGain.gain.value = 1.0;
          const eq = eqProcessor.getEQProcessor();
          
          // Connect Gain -> Analyzer (for visualization only)
          this.preEQGain.connect(this.preEQAnalyser); 
          // Connect Gain -> EQ Input (actual audio path)
          this.preEQGain.connect(eq.getInputNode()); 
      }
      
      return this.preEQGain || eqProcessor.getEQProcessor().getInputNode();
  }

  /**
   * Recalculate center frequency based on Y and shift factor, clamping result.
   * @param y The row index (0-based)
   * @param shiftFactor The current shift factor
   * @returns Clamped center frequency
   */
  private calculateShiftedFrequency(y: number, shiftFactor: number): number {
    const normalizedY = this.gridSize <= 1 ? 0.5 : 1 - (y / (this.gridSize - 1));
    const minFreq = 40;  // Lower minimum for better low-end
    const maxFreq = 15000; // Lower maximum to avoid harsh high-end
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    const baseFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Apply shift factor and clamp
    let shiftedFreq = baseFreq * shiftFactor;
    shiftedFreq = Math.max(minFreq, Math.min(maxFreq, shiftedFreq)); // Clamp within min/max
    
    return shiftedFreq;
  }

  /**
   * Update the frequencies of all existing dot filters based on the current shift factor.
   */
  private updateAllDotFrequencies(): void {
    const now = audioContext.getAudioContext().currentTime;
    this.audioNodes.forEach((nodes, dotKey) => {
      const y = parseInt(dotKey.split(',')[1], 10); // Get y coordinate from key
      const newFreq = this.calculateShiftedFrequency(y, this.frequencyShiftFactor);
      
      if (nodes.filter) {
        // Use setTargetAtTime for smoother transitions, though immediate might be fine too
        // nodes.filter.frequency.setTargetAtTime(newFreq, now, 0.01); 
        // Or set immediately:
        nodes.filter.frequency.setValueAtTime(newFreq, now);
      }
    });
  }

  /**
   * Set the frequency shift factor for all dots.
   * @param factor Multiplier for frequency (e.g., 1.0 = no shift, 2.0 = octave up, 0.5 = octave down)
   */
  public setFrequencyShiftFactor(factor: number): void {
      // Add reasonable clamping for the factor if desired, e.g., 0.1 to 10.0
      this.frequencyShiftFactor = Math.max(0.1, Math.min(10.0, factor)); 
      this.updateAllDotFrequencies(); // Update existing nodes
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