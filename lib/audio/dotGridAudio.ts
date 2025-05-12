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
const LOW_SLOPE_DB_PER_OCT = -6.0; // For low y positions (darker sound)
const CENTER_SLOPE_DB_PER_OCT = -3.0; // For middle y positions
const HIGH_SLOPE_DB_PER_OCT = 0.0; // For high y positions (brighter sound)
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1; // Scalar to reduce output of SlopedPinkNoiseGenerator (approx -12dB)

// New constant for attenuation based on slope deviation from pink noise
const ATTENUATION_PER_DB_OCT_DEVIATION_DB = 0.0; // dB reduction per dB/octave deviation from -3dB/oct

// Constants for sequential playback with click prevention
const DOT_DURATION_S = 0.5; // Each dot plays for this duration
const CLICK_PREVENTION_ENVELOPE_TIME = 0.005; // Short attack/release to prevent clicks

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Volume pattern settings -- REMOVING
// const VOLUME_PATTERN = [0, -12, -6, -12]; // The fixed pattern in dB: 0dB, -12dB, -6dB, -12dB

// Interface for nodes managed by PositionedAudioService
interface PointAudioNodes {
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  envelopeGain: GainNode;
  panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator;
  pinkNoiseBuffer: AudioBuffer;
  normalizedYPos: number; // To recalculate slope without re-passing y, totalRows
  // isPlaying: boolean; // Source starts on creation and loops, envelopeGain controls sound
}

class PositionedAudioService {
  private ctx: AudioContext;
  private audioPoints: Map<string, PointAudioNodes> = new Map();
  private outputGain: GainNode;
  private currentDistortionGain: number = 1.0;
  private currentBaseDbLevel: number = 0;

  constructor(audioContextInstance: AudioContext) {
    this.ctx = audioContextInstance;
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1.0; // Master output for this service
  }

  // Moved from DotGridAudioPlayer
  private _generateSinglePinkNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      b6 = white * 0.5362;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11; // Adjusted last term slightly
    }

    let peak = 0;
    for (let i = 0; i < bufferSize; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor;
    }
    return buffer;
  }

  public getOutputNode(): GainNode {
    return this.outputGain;
  }

  // More methods (addPoint, removePoint, activatePoint, etc.) will be added here later
  public setDistortion(gain: number): void {
    this.currentDistortionGain = Math.max(0, Math.min(1, gain));
  }

  public setBaseVolumeDb(db: number): void {
    this.currentBaseDbLevel = db;
  }

  public addPoint(id: string, x: number, y: number, totalRows: number, totalCols: number): void {
    if (this.audioPoints.has(id)) {
      console.warn(`Audio point with id ${id} already exists.`);
      return;
    }

    const normalizedY = totalRows <= 1 ? 0.5 : 1 - (y / (totalRows - 1));
    const panPosition = totalCols <= 1 ? 0 : (2 * (x / (totalCols - 1)) - 1);

    const pinkNoiseBuffer = this._generateSinglePinkNoiseBuffer();
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;

    const slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
    const mainGain = this.ctx.createGain();
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MIN_GAIN; // Start silent
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panPosition;

    // Connect chain: source -> slopedGen -> mainGain -> envelopeGain -> panner -> serviceOutput
    source.connect(slopedNoiseGenerator.getInputNode());
    slopedNoiseGenerator.getOutputNode().connect(mainGain);
    mainGain.connect(envelopeGain);
    envelopeGain.connect(panner);
    panner.connect(this.outputGain);

    this.audioPoints.set(id, {
      source,
      mainGain,
      envelopeGain,
      panner,
      slopedNoiseGenerator,
      pinkNoiseBuffer,
      normalizedYPos: normalizedY,
    });

    source.start(); // Start source immediately, loop, control with envelopeGain
  }

  public removePoint(id: string): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, this.ctx.currentTime);
    try {
      point.source.stop();
    } catch (e) { /* ignore if already stopped */ }
    point.source.disconnect();
    point.slopedNoiseGenerator.dispose();
    point.mainGain.disconnect();
    point.envelopeGain.disconnect();
    point.panner.disconnect();
    // point.pinkNoiseBuffer = null; // Buffer is managed by JS GC once source is gone

    this.audioPoints.delete(id);
  }

  public activatePoint(id: string): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    // Set slope
    let targetOverallSlopeDbPerOctave;
    if (point.normalizedYPos < 0.5) {
      const t = point.normalizedYPos * 2;
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      const t = (point.normalizedYPos - 0.5) * 2;
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }
    point.slopedNoiseGenerator.setSlope(targetOverallSlopeDbPerOctave);

    // Set main gain
    const gainRatio = Math.pow(10, this.currentBaseDbLevel / 20);
    // Apply MASTER_GAIN, distortion, and base level to mainGain
    const effectiveMasterGain = MASTER_GAIN * this.currentDistortionGain * gainRatio;
    point.mainGain.gain.setValueAtTime(effectiveMasterGain, this.ctx.currentTime);

    // Activate sound with a very short attack to prevent clicks
    point.envelopeGain.gain.cancelScheduledValues(this.ctx.currentTime);
    point.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, this.ctx.currentTime);
    point.envelopeGain.gain.linearRampToValueAtTime(ENVELOPE_MAX_GAIN, this.ctx.currentTime + CLICK_PREVENTION_ENVELOPE_TIME);
  }

  public deactivatePoint(id: string): void {
    const point = this.audioPoints.get(id);
    if (!point) return;
    // Deactivate with a very short release to prevent clicks
    point.envelopeGain.gain.cancelScheduledValues(this.ctx.currentTime);
    point.envelopeGain.gain.setValueAtTime(point.envelopeGain.gain.value, this.ctx.currentTime); // Hold current value before ramping
    point.envelopeGain.gain.linearRampToValueAtTime(ENVELOPE_MIN_GAIN, this.ctx.currentTime + CLICK_PREVENTION_ENVELOPE_TIME);
  }
  
  public deactivateAllPoints(): void {
    this.audioPoints.forEach((_, id) => this.deactivatePoint(id));
  }

  public dispose(): void {
    this.audioPoints.forEach((_, id) => this.removePoint(id));
    this.outputGain.disconnect();
  }
}

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private isPlaying: boolean = false;
  // private audioNodes: Map<string, ...> // REMOVED - Will manage keys/state, not nodes directly
  private activeDotKeys: Set<string> = new Set(); // To track which dots are selected
  private audioService: PositionedAudioService;

  // Properties for sequential playback
  private currentDotIndex: number = 0;
  private lastSwitchTime: number = 0;

  private gridSize: number = 3;
  private columnCount: number = COLUMNS;
  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;
  private animationFrameId: number | null = null; // Keep for now if any other visual might use it
  
  private constructor() {
    this.audioService = new PositionedAudioService(audioContext.getAudioContext());
    
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.audioService.setDistortion(initialDistortionGain);
    
    useEQProfileStore.subscribe(
      (state) => {
        this.audioService.setDistortion(state.distortionGain);
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
    // This method is tricky with the new service model.
    // Panning is set when a point is added to PositionedAudioService.
    // If columnCount changes, existing points in the service won't automatically update their pan.
    // The current setGridSize -> updateDots flow (which removes/re-adds points) handles this.
    // Thus, this specific method might be redundant or needs to trigger a re-add of all points.
    // For now, let's rely on the setGridSize -> updateDots flow.
    // If direct pan updates are needed without re-adding, PositionedAudioService would need a method like:
    // updatePointPanning(id: string, newPanPosition: number)
    // and DotGridAudioPlayer would iterate its activeDotKeys and call it.

    // Old logic that accessed service internals (incorrect):
    // this.audioService.audioPoints.forEach((nodes, dotKey) => {
    //   const x = dotKey.split(',').map(Number)[0];
    //   const panPosition = this.columnCount <= 1 ? 0 : (2 * (x / (this.columnCount - 1)) - 1);
    //   if (nodes.panner) {
    //      nodes.panner.pan.value = panPosition;
    //   }
    // });
    console.warn("updateAllDotPanning called; panning updates now primarily occur when dots are re-added via updateDots after grid size change.")
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
    // Skip if no audio nodes -- This logic needs to adapt or be removed if preEQGain connects to service output
    // if (this.audioNodes.size === 0) return;
    if (!this.preEQGain) return; // If no preEQGain, nothing to reconnect to it

    // Disconnect preEQGain from its current source (which should be audioService.getOutputNode() or EQ processor)
    this.preEQGain.disconnect();
    
    // Reconnect preEQGain to the audioService output, then to analyzer and EQ
    const eqInput = eqProcessor.getEQProcessor().getInputNode();
    this.preEQGain.connect(this.audioService.getOutputNode()); // This seems wrong. preEQGain *receives* from audioService
                                                               // And then preEQGain outputs to analyzer AND eqInput.
                                                               // Correct connection order should be:
                                                               // audioService.output -> preEQGain
                                                               // preEQGain -> preEQAnalyser (if exists)
                                                               // preEQGain -> eqInput

    // Let's try to simplify the connection logic for preEQGain
    // The audioService.outputGain is the single source for preEQGain now.
    this.preEQGain.disconnect(); // Ensure clean state
    this.audioService.getOutputNode().connect(this.preEQGain);

    if (this.preEQAnalyser) {
        this.preEQGain.connect(this.preEQAnalyser);
    }
    this.preEQGain.connect(eqInput);                                                       

    // The old logic iterated sources to connect to preEQGain. 
    // Now, preEQGain has a single input from audioService.getOutputNode().
    // This method might be entirely rethought or simplified.
    // For now, the key is that audioService.getOutputNode() should feed into preEQGain.
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
      this.setGridSize(currentGridSize, currentColumns); // This will update internal gridSize/columnCount
    } else if (currentColumns && currentColumns !== this.columnCount) {
      this.setGridSize(this.gridSize, currentColumns);
    }
    
    const oldDotKeys = new Set(this.activeDotKeys);
    this.activeDotKeys = new Set(dots);
    
    // Remove dots that are no longer selected
    oldDotKeys.forEach(dotKey => {
      if (!this.activeDotKeys.has(dotKey)) {
        this.audioService.removePoint(dotKey);
      }
    });
    
    // Add new dots
    this.activeDotKeys.forEach(dotKey => {
      if (!oldDotKeys.has(dotKey)) {
        // x, y are part of dotKey string "x,y"
        const [xStr, yStr] = dotKey.split(',');
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);
        if (!isNaN(x) && !isNaN(y)) {
            this.audioService.addPoint(dotKey, x, y, this.gridSize, this.columnCount);
        }
      }
    });
    
    if (this.isPlaying) {
      // Deactivate all points first, then activate only the current ones -- REVISING THIS BLOCK
      // this.audioService.deactivateAllPoints(); 
      // this.activeDotKeys.forEach(dotKey => {
      //   this.audioService.activatePoint(dotKey);
      // });
      this.stopAllRhythms();  // This will call audioService.deactivateAllPoints()
      this.startAllRhythms(); // This will restart the sequence with the new activeDotKeys
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
      this.startAllRhythms(); // This will activate current dots
    } else {
      this.stopAllRhythms(); // This will deactivate current dots
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
    
    if (!this.isPlaying) return;

    const orderedDots = Array.from(this.activeDotKeys).sort((keyA, keyB) => {
        const [xA, yA] = keyA.split(',').map(Number);
        const [xB, yB] = keyB.split(',').map(Number);
        if (yA !== yB) return yA - yB;
        return xA - xB;
    });

    if (orderedDots.length === 0) {
      // Ensure any lingering animation frame is cancelled if no dots to play
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      return;
    }
    
    // Deactivate all points before starting sequence to ensure clean state
    // This is important if startAllRhythms is called while some points might still be active from a previous state.
    this.audioService.deactivateAllPoints();

    this.currentDotIndex = 0;
    this.lastSwitchTime = performance.now() / 1000;

    // Activate the first dot immediately
    if (this.audioService.activatePoint) { // Check if method exists, good practice
        this.audioService.activatePoint(orderedDots[this.currentDotIndex]);
    }

    const frameLoop = (timestamp: number) => {
      if (!this.isPlaying || orderedDots.length === 0) {
        // If playback stopped or no dots, ensure any lingering frame is cancelled
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        return;
      }
      
      const now = timestamp / 1000;
      const elapsedSinceSwitch = now - this.lastSwitchTime;

      if (elapsedSinceSwitch >= DOT_DURATION_S) {
        // Deactivate the previous dot
        if (this.audioService.deactivatePoint) {
            this.audioService.deactivatePoint(orderedDots[this.currentDotIndex]);
        }

        // Move to the next dot
        this.currentDotIndex = (this.currentDotIndex + 1) % orderedDots.length;
        
        // Activate the new current dot
        if (this.audioService.activatePoint) {
            this.audioService.activatePoint(orderedDots[this.currentDotIndex]);
        }
        
        this.lastSwitchTime = now;
      }
      
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
    // Deactivate all points using the click-prevention envelope
    this.audioService.deactivateAllPoints();
  }

  /**
   * Set the master volume in dB
   * @param dbLevel Volume level in dB (0dB = reference level)
   */
  public setVolumeDb(dbLevel: number): void {
    this.audioService.setBaseVolumeDb(dbLevel);
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    this.stopAllRhythms();
    
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
    
    this.activeDotKeys.clear();
    this.audioService.dispose(); // This correctly disposes all points within the service
  }

  // Add method to handle distortion gain -- Now delegates to service
  private setDistortionGain(gain: number): void {
    this.audioService.setDistortion(gain); 
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