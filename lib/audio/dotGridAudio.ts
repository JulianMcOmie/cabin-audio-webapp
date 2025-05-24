import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
// import { getAudioPlayer } from './audioPlayer';
import { useEQProfileStore } from '../stores';

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx (odd number ensures a middle column)

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const MASTER_GAIN = 6.0; // Much louder master gain for calibration

// New constants for Sloped Pink Noise
const NUM_BANDS = 20; // Number of frequency bands for shaping
const SLOPE_REF_FREQUENCY = 800; // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20; // Hz
const MAX_AUDIBLE_FREQ = 20000; // Hz
// const BAND_Q_VALUE = 1.5; // Q value for the bandpass filters (reduced from 6.0) - No longer used for HP/LP pairs
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise

// Target overall slopes
const LOW_SLOPE_DB_PER_OCT = -12.5; // For low y positions (darker sound)
const CENTER_SLOPE_DB_PER_OCT = -4.5; // For middle y positions
const HIGH_SLOPE_DB_PER_OCT = 3.5; // For high y positions (brighter sound)
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1; // Scalar to reduce output of SlopedPinkNoiseGenerator (approx -12dB)

// New constant for attenuation based on slope deviation from pink noise
const ATTENUATION_PER_DB_OCT_DEVIATION_DB = 3.8; // dB reduction per dB/octave deviation from -3dB/oct

// Constants for sequential playback with click prevention
// const DOT_DURATION_S = 1.0; // Each dot plays for this duration - REMOVING, duration now controlled by GLOBAL_STAGGER_RELEASE_S
// const CLICK_PREVENTION_ENVELOPE_TIME = 0.005; // REMOVING - Replaced by ADSR for sub-hits

// Constants for sub-hit ADSR playback - REMOVING, replaced by global stagger
// const NUM_SUB_HITS = 4;
// const SUB_HIT_INTERVAL_S = DOT_DURATION_S / NUM_SUB_HITS; // Approx 0.125s if DOT_DURATION_S is 0.5s

// New constants for Global Staggered Mode (when subHitPlaybackEnabled is true)
const GLOBAL_STAGGER_ATTACK_S = 0.05; // Longer attack
const GLOBAL_STAGGER_RELEASE_S = 0.4; // Longer release
const ALL_DOTS_STAGGER_INTERVAL_S = 0.1; // Stagger between each dot in the global sequence
// const NUM_HITS_PER_DOT_SEQUENCE = 4; // No longer used for dot iteration in startAllRhythms

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
  // New properties for sub-hit sequencing
  subHitCount: number;
  subHitTimerId: number | null;
  // isPlaying: boolean; // Source starts on creation and loops, envelopeGain controls sound
}

class PositionedAudioService {
  private ctx: AudioContext;
  private audioPoints: Map<string, PointAudioNodes> = new Map();
  private outputGain: GainNode;
  private currentDistortionGain: number = 1.0;
  private currentBaseDbLevel: number = 0;
  private subHitAdsrEnabled: boolean = true; // Renamed from envelopeEnabled
  private subHitPlaybackEnabled: boolean = true; // New: Toggle for sub-hit mechanism

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

  public setSubHitAdsrMode(enabled: boolean): void { // Renamed from setEnvelopeMode
    this.subHitAdsrEnabled = enabled;
  }

  public setSubHitPlaybackMode(enabled: boolean): void { // New method
    this.subHitPlaybackEnabled = enabled;
  }

  public isSubHitPlaybackEnabled(): boolean { // New getter
    return this.subHitPlaybackEnabled;
  }

  private _schedulePointActivationSound(pointNode: PointAudioNodes, scheduledTime: number): void {
    const gainParam = pointNode.envelopeGain.gain;
    gainParam.cancelScheduledValues(scheduledTime);

    if (this.subHitAdsrEnabled) {
      // Use ADSR for the global staggered hit
      gainParam.setValueAtTime(ENVELOPE_MIN_GAIN, scheduledTime);
      // Attack
      gainParam.linearRampToValueAtTime(
        ENVELOPE_MAX_GAIN, 
        scheduledTime + GLOBAL_STAGGER_ATTACK_S
      );
      // Release
      gainParam.exponentialRampToValueAtTime(
        0.001, // Target for exponential ramp (close to zero)
        scheduledTime + GLOBAL_STAGGER_ATTACK_S + GLOBAL_STAGGER_RELEASE_S
      );
      // Ensure silence after release
      gainParam.setValueAtTime(ENVELOPE_MIN_GAIN, scheduledTime + GLOBAL_STAGGER_ATTACK_S + GLOBAL_STAGGER_RELEASE_S + 0.001);
    } else {
      // Use Attack-Sustain for the global staggered hit
      gainParam.setValueAtTime(ENVELOPE_MIN_GAIN, scheduledTime); // Ensure it starts from silence or current value if retriggered
      gainParam.linearRampToValueAtTime(
        ENVELOPE_MAX_GAIN, 
        scheduledTime + GLOBAL_STAGGER_ATTACK_S
      );
      // Gain remains at ENVELOPE_MAX_GAIN until deactivatePoint is called
    }
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
      // Initialize new properties
      subHitCount: 0,
      subHitTimerId: null,
    });

    source.start(); // Start source immediately, loop, control with envelopeGain
  }

  public removePoint(id: string): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    // Stop any pending sub-hit sequence for this point if it's being removed
    if (point.subHitTimerId !== null) {
      clearTimeout(point.subHitTimerId);
      point.subHitTimerId = null;
    }

    point.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, this.ctx.currentTime);
    try {
      point.source.stop();
    } catch (e) { 
      console.log(`Error stopping source for point ${id}:`, e);
    }
    point.source.disconnect();
    point.slopedNoiseGenerator.dispose();
    point.mainGain.disconnect();
    point.envelopeGain.disconnect();
    point.panner.disconnect();
    // point.pinkNoiseBuffer = null; // Buffer is managed by JS GC once source is gone

    this.audioPoints.delete(id);
  }

  public activatePoint(id: string, activationTime: number): void { // Added activationTime parameter
    const point = this.audioPoints.get(id);
    if (!point) return;

    this.setMainGainAndSlope(point); // Set timbre and base volume first

    if (!this.subHitPlaybackEnabled) {
      // CONTINUOUS SIMULTANEOUS MODE (subHitPlaybackEnabled is false)
      const now = this.ctx.currentTime; // For immediate activation
      point.envelopeGain.gain.cancelScheduledValues(now);
      point.envelopeGain.gain.setValueAtTime(ENVELOPE_MAX_GAIN, now);
      
      if (point.subHitTimerId !== null) { // Clear any old timers if mode switched
          clearTimeout(point.subHitTimerId);
          point.subHitTimerId = null;
      }
    } else {
      // NEW GLOBAL STAGGERED MODE (subHitPlaybackEnabled is true)
      // Clear any pending sub-hit timer from a previous type of activation if any.
      // This timer is not strictly used by _schedulePointActivationSound in the same way,
      // but clearing it is good practice if modes change.
      if (point.subHitTimerId !== null) {
        clearTimeout(point.subHitTimerId);
        point.subHitTimerId = null;
      }
      // point.subHitCount = 0; // No longer relevant for this mode

      this._schedulePointActivationSound(point, activationTime);
    }
  }

  public deactivatePoint(id: string): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    // Stop any pending sub-hit sequence timer for this point
    if (point.subHitTimerId !== null) {
      clearTimeout(point.subHitTimerId);
      point.subHitTimerId = null; // Explicitly mark timer as cleared
    }

    // Deactivate by ramping envelopeGain down quickly, regardless of previous state
    const now = this.ctx.currentTime;
    point.envelopeGain.gain.cancelScheduledValues(now);
    point.envelopeGain.gain.setValueAtTime(point.envelopeGain.gain.value, now); // Hold current value
    point.envelopeGain.gain.linearRampToValueAtTime(ENVELOPE_MIN_GAIN, now + 0.005); // Quick ramp down (5ms)
  }
  
  public deactivateAllPoints(): void {
    this.audioPoints.forEach((_, id) => this.deactivatePoint(id));
  }

  public dispose(): void {
    this.audioPoints.forEach((point, id) => { // Iterate over point object too
        if (point.subHitTimerId !== null) {
            clearTimeout(point.subHitTimerId);
            // point.subHitTimerId = null; // removePoint will handle the map deletion
        }
        this.removePoint(id);
    });
    // this.audioPoints.forEach((_, id) => this.removePoint(id)); // Original line
    this.outputGain.disconnect();
  }

  // Helper method to set main gain and slope (used in activatePoint)
  private setMainGainAndSlope(point: PointAudioNodes): void {
    // The targetOverallSlopeDbPerOctave calculation is kept as per user's file structure,
    // but it will not be used to calculate existingAttenuationDb for finalVolumeDb.
    let targetOverallSlopeDbPerOctave;
    if (point.normalizedYPos < 0.5) {
      const t = point.normalizedYPos * 2;
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      const t = (point.normalizedYPos - 0.5) * 2;
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }

    // Call to setBandGainsBasedOnY, which now handles all Y-dependent timbre shaping.
    point.slopedNoiseGenerator.setBandGainsBasedOnY(point.normalizedYPos, CENTER_SLOPE_DB_PER_OCT, SLOPE_REF_FREQUENCY, PINK_NOISE_SLOPE_DB_PER_OCT);

    // Final volume is now only the base level. All Y-dependent changes come from setBandGainsBasedOnY.
    const finalVolumeDb = this.currentBaseDbLevel;
    
    const gainRatio = Math.pow(10, finalVolumeDb / 20);
    const effectiveMasterGain = MASTER_GAIN * this.currentDistortionGain * gainRatio;
    point.mainGain.gain.setValueAtTime(effectiveMasterGain, this.ctx.currentTime);
  }

  public setSubHitAdsrEnabled(enabled: boolean): void { // Renamed from setEnvelopeEnabled
    this.subHitAdsrEnabled = enabled;
  }

  // Add method to handle distortion gain -- Now delegates to service
  private setDistortionGain(gain: number): void {
    this.currentDistortionGain = Math.max(0, Math.min(1, gain));
  }
}

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private isPlaying: boolean = false;
  private activeDotKeys: Set<string> = new Set();
  private audioService: PositionedAudioService;

  // Properties for sequential playback (now row-by-row) - REMOVING
  // private orderedRowsToPlay: Array<{ rowIndex: number, dotKeys: string[] }> = [];
  // private currentRowIndex: number = 0;
  // private lastSwitchTime: number = 0;
  // private currentRowStaggerTimeouts: number[] = [];
  private loopTimeoutId: number | null = null; // New: For the main sequence loop

  private gridSize: number = 3;
  private columnCount: number = COLUMNS;
  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;
  // private animationFrameId: number | null = null; // REMOVING, rAF not used for global stagger
  
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
      // this.updateAllDotPanning(); // updateAllDotPanning relies on dot re-addition
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

    // Disconnect preEQGain from its current source(s)
    this.preEQGain.disconnect(); 
    
    // The audioService.outputGain is the single source for preEQGain now.
    this.audioService.getOutputNode().connect(this.preEQGain);

    if (this.preEQAnalyser) {
        this.preEQGain.connect(this.preEQAnalyser);
    }
    // Connect preEQGain to the EQ input
    const eqInput = eqProcessor.getEQProcessor().getInputNode();
    this.preEQGain.connect(eqInput);                                                       
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
    
    const addedKeys: string[] = [];
    // const removedKeys: string[] = []; // Not strictly needed for this logic path if removePoint deactivates
    
    // Remove dots that are no longer selected
    oldDotKeys.forEach(dotKey => {
      if (!this.activeDotKeys.has(dotKey)) {
        this.audioService.removePoint(dotKey); // removePoint also handles deactivation
        // removedKeys.push(dotKey);
      }
    });
    
    // Add new dots
    this.activeDotKeys.forEach(dotKey => {
      if (!oldDotKeys.has(dotKey)) {
        const [xStr, yStr] = dotKey.split(',');
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);
        if (!isNaN(x) && !isNaN(y)) {
            this.audioService.addPoint(dotKey, x, y, this.gridSize, this.columnCount);
            addedKeys.push(dotKey);
        }
      }
    });
    
    if (this.isPlaying) {
      if (this.isContinuousSimultaneousMode()) {
        addedKeys.forEach(key => this.audioService.activatePoint(key, audioContext.getAudioContext().currentTime));
        // Removed keys are handled by removePoint implicitly deactivating them
      } else {
      this.stopAllRhythms();
      this.startAllRhythms();
      }
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
      if (this.isContinuousSimultaneousMode()){
        this.stopAllRhythmsInternalCleanup(); // Clear any rAF/staggers from previous mode
        this.audioService.deactivateAllPoints(); // Fresh start
        this.activeDotKeys.forEach(dotKey => this.audioService.activatePoint(dotKey, audioContext.getAudioContext().currentTime));
      } else {
      this.startAllRhythms();
      }
    } else {
      this.stopAllRhythms();
    }
  }

  /**
   * Start all rhythm timers - using requestAnimationFrame
   */
  private startAllRhythms(): void {
    if (this.isContinuousSimultaneousMode()) {
      this.stopAllRhythmsInternalCleanup(); // Ensure cleanup if called in wrong mode
      return;
    }

    this.stopAllRhythmsInternalCleanup(); // Clear any previous timeouts/loop
    
    if (!this.isPlaying || this.activeDotKeys.size === 0) {
        return;
    }
    
    // Deactivate all points before starting new sequence to ensure clean state for envelopes
    // especially if looping and sounds might overlap slightly if not fully released.
    this.audioService.deactivateAllPoints(); 

    const sortedDotKeys = Array.from(this.activeDotKeys).sort((keyA, keyB) => {
      const [xAStr, yAStr] = keyA.split(',');
      const [xBStr, yBStr] = keyB.split(',');
      const yA = parseInt(yAStr, 10);
      const yB = parseInt(yBStr, 10);
      if (yA !== yB) return yA - yB; // Sort by row first (top to bottom)
      const xA = parseInt(xAStr, 10);
      const xB = parseInt(xBStr, 10);
      return xA - xB; // Then by column (left to right)
    });

    const currentTime = audioContext.getAudioContext().currentTime;

    // const SUB_HIT_INTERVAL_S = ALL_DOTS_STAGGER_INTERVAL_S; // Interval between hits for the same dot
    // const DOT_BURST_GROUP_INTERVAL_S = NUM_HITS_PER_DOT_SEQUENCE * ALL_DOTS_STAGGER_INTERVAL_S; // No longer used here

    sortedDotKeys.forEach((dotKey, dotIndex) => {
      // Each dot plays once in the sequence, staggered by ALL_DOTS_STAGGER_INTERVAL_S
      const activationTime = currentTime + dotIndex * ALL_DOTS_STAGGER_INTERVAL_S;
      this.audioService.activatePoint(dotKey, activationTime);
    });
    
    // Schedule the next iteration of the loop if there are dots
    if (sortedDotKeys.length > 0) {
      // Loop duration is the total time for one pass through all selected dots
      const loopDurationS = sortedDotKeys.length * ALL_DOTS_STAGGER_INTERVAL_S;
      const loopDelayMs = loopDurationS * 1000;

      if (loopDelayMs > 0) { // Ensure positive delay
        this.loopTimeoutId = window.setTimeout(() => {
          // Check playback state again before re-triggering
          if (this.isPlaying && !this.isContinuousSimultaneousMode()) {
            this.startAllRhythms(); // This will handle deactivating/cleanup and rescheduling
          }
        }, loopDelayMs);
      }
    }
    // No rAF loop needed. The sounds are scheduled with the Web Audio API.
    // The main loop is handled by setTimeout scheduling startAllRhythms again.
  }
  
  private stopAllRhythmsInternalCleanup(): void {
    // Clear the main sequence loop timeout
    if (this.loopTimeoutId !== null) {
      clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = null;
    }

    // if (this.animationFrameId !== null) { // REMOVING rAF
    //   cancelAnimationFrame(this.animationFrameId);
    //   this.animationFrameId = null;
    // }
    // this.clearCurrentRowStaggerTimeouts(); // REMOVING row-based staggers
    
    // For the new global stagger, if activatePoint uses setTimeout for non-WebAudio things that need clearing,
    // we would manage those timeouts (e.g., in this.globalStaggerTimeouts) and clear them here.
    // However, _schedulePointActivationSound uses Web Audio's native scheduling which is managed via GainNode.cancelScheduledValues().
    // DeactivateAllPoints should implicitly cancel these when it ramps gains down.
    // If we were using setTimeout to trigger activatePoint itself, we'd clear them:
    // this.globalStaggerTimeouts.forEach(clearTimeout); // REMOVING this array
    // this.globalStaggerTimeouts = []; // REMOVING this array
  }
  
  /**
   * Stop all rhythm timers
   */
  private stopAllRhythms(): void {
    this.stopAllRhythmsInternalCleanup();
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
    
    // Ensure animation frames are cancelled - REMOVING rAF
    // if (this.animationFrameId !== null) {
    //   cancelAnimationFrame(this.animationFrameId);
    //   this.animationFrameId = null;
    // }
    
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

  public setSubHitAdsrEnabled(enabled: boolean): void { 
    this.audioService.setSubHitAdsrMode(enabled);
  }

  public setSubHitPlaybackEnabled(enabled: boolean): void { 
    this.audioService.setSubHitPlaybackMode(enabled);
    if (this.isPlaying) {
      this.stopAllRhythms(); // Stop current playback & deactivate all points
      // Restart playback according to the new mode
      if (this.isContinuousSimultaneousMode()) {
        // No need to deactivate again, stopAllRhythms did it.
        this.activeDotKeys.forEach(dotKey => this.audioService.activatePoint(dotKey, audioContext.getAudioContext().currentTime));
      } else {
        this.startAllRhythms(); 
      }
    }
  }

  // Add method to handle distortion gain -- Now delegates to service
  private setDistortionGain(gain: number): void {
    this.audioService.setDistortion(gain); 
  }

  private isContinuousSimultaneousMode(): boolean {
    return !this.audioService.isSubHitPlaybackEnabled();
  }
}

class SlopedPinkNoiseGenerator {
  private ctx: AudioContext;
  private inputGainNode: GainNode;
  private outputGainNode: GainNode;
  private bandFilters: BiquadFilterNode[] = []; // Will store all HP and LP filters
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
    const filterQ = 1.0 / Math.sqrt(2); // Q for Butterworth-like response for HP/LP filters

    for (let i = 0; i < NUM_BANDS; i++) {
      // Center frequency for gain calculation (same as before)
      const centerFreq = Math.pow(2, logMinFreq + (i + 1) * step);
      this.centerFrequencies.push(centerFreq);

      // Calculate cutoff frequencies for the HP/LP pair
      const lowerCutoff = Math.pow(2, logMinFreq + (i + 0.5) * step);
      const upperCutoff = Math.pow(2, logMinFreq + (i + 1 + 0.5) * step);

      const hpFilter = this.ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = lowerCutoff;
      hpFilter.Q.value = filterQ;
      this.bandFilters.push(hpFilter);

      const lpFilter = this.ctx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = upperCutoff;
      lpFilter.Q.value = filterQ;
      this.bandFilters.push(lpFilter);

      const gainNode = this.ctx.createGain(); // Renamed from gain to gainNode to avoid conflict
      this.bandGains.push(gainNode);

      // Connect input -> hpFilter -> lpFilter -> gainNode -> output
      this.inputGainNode.connect(hpFilter);
      hpFilter.connect(lpFilter);
      lpFilter.connect(gainNode);
      gainNode.connect(this.outputGainNode);
    }
  }

  public getInputNode(): GainNode {
    return this.inputGainNode;
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setBandGainsBasedOnY(normalizedYPos: number, centerSlopeDbOct: number, slopeRefFreq: number, inherentPinkNoiseSlopeDbOct: number): void {
    const baselineLinearGains = new Array(NUM_BANDS);
    const shapingSlopeForBaseline = centerSlopeDbOct - inherentPinkNoiseSlopeDbOct;
    for (let i = 0; i < NUM_BANDS; i++) {
      const fc = this.centerFrequencies[i];
      const gainDb = shapingSlopeForBaseline * Math.log2(fc / slopeRefFreq);
      baselineLinearGains[i] = Math.pow(10, gainDb / 20);
    }

    const BOTTOM_IDX = 0;
    const MID_IDX = Math.floor(NUM_BANDS / 2);
    const TOP_IDX = NUM_BANDS - 1;

    // Helper to create a scale profile with linear interpolation
    const createProfile = (points: {idx: number, scale: number}[]) => {
      const profile = new Array(NUM_BANDS).fill(0.0);
      points.sort((a, b) => a.idx - b.idx);
      for(let i = 0; i < points.length; ++i) {
          profile[points[i].idx] = points[i].scale;
      }
      for (let i = 0; i < points.length - 1; ++i) {
        const p1 = points[i];
        const p2 = points[i+1];
        if (p2.idx > p1.idx + 1) { // If there's a gap to interpolate
          for (let j = p1.idx + 1; j < p2.idx; ++j) {
            const t = (j - p1.idx) / (p2.idx - p1.idx);
            profile[j] = (1 - t) * p1.scale + t * p2.scale;
          }
        }
      }
      return profile;
    };

    const scales_Y_0_0 = createProfile([{idx: BOTTOM_IDX, scale: 1.0}, {idx: TOP_IDX, scale: 0.0}]);
    if(NUM_BANDS > 1) scales_Y_0_0[TOP_IDX]=0.0; // Ensure top is 0 if not bottom
    for(let i=BOTTOM_IDX+1; i<NUM_BANDS; ++i) if(i !== TOP_IDX) scales_Y_0_0[i]=0.0; // Explicitly zero others
    scales_Y_0_0[BOTTOM_IDX] = 1.0; // Re-assert bottom is 1.0

    const scales_Y_0_25 = createProfile([
      {idx: BOTTOM_IDX, scale: 1.0},
      {idx: MID_IDX, scale: 0.5},
      {idx: TOP_IDX, scale: 0.0}
    ]);

    const scales_Y_0_50 = createProfile([{idx: BOTTOM_IDX, scale: 1.0}, {idx: TOP_IDX, scale: 1.0}]);
    for(let i=0; i<NUM_BANDS; ++i) scales_Y_0_50[i]=1.0; // All 1.0 for middle

    const scales_Y_0_75 = createProfile([
      {idx: BOTTOM_IDX, scale: 0.0},
      {idx: MID_IDX, scale: 0.5},
      {idx: TOP_IDX, scale: 1.0}
    ]);

    const scales_Y_1_0 = createProfile([{idx: TOP_IDX, scale: 1.0}, {idx: BOTTOM_IDX, scale: 0.0}]);
    if(NUM_BANDS > 1) scales_Y_1_0[BOTTOM_IDX]=0.0; // Ensure bottom is 0 if not top
    for(let i=0; i<TOP_IDX; ++i) if(i !== BOTTOM_IDX) scales_Y_1_0[i]=0.0; // Explicitly zero others
    scales_Y_1_0[TOP_IDX] = 1.0; // Re-assert top is 1.0
    
    let t = 0;
    let profile1_scales: number[];
    let profile2_scales: number[];

    if (normalizedYPos <= 0.25) {
      profile1_scales = scales_Y_0_0;
      profile2_scales = scales_Y_0_25;
      t = normalizedYPos / 0.25;
    } else if (normalizedYPos <= 0.50) {
      profile1_scales = scales_Y_0_25;
      profile2_scales = scales_Y_0_50;
      t = (normalizedYPos - 0.25) / 0.25;
    } else if (normalizedYPos <= 0.75) {
      profile1_scales = scales_Y_0_50;
      profile2_scales = scales_Y_0_75;
      t = (normalizedYPos - 0.50) / 0.25;
    } else { // normalizedYPos <= 1.00
      profile1_scales = scales_Y_0_75;
      profile2_scales = scales_Y_1_0;
      t = (normalizedYPos - 0.75) / 0.25;
    }

    const finalLinearGains = new Array(NUM_BANDS);
    for (let i = 0; i < NUM_BANDS; i++) {
      const currentScale = (1 - t) * profile1_scales[i] + t * profile2_scales[i];
      finalLinearGains[i] = currentScale * baselineLinearGains[i];
      this.bandGains[i].gain.value = finalLinearGains[i];
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