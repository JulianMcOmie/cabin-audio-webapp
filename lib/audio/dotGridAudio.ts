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
const BAND_Q_VALUE = 1.5; // Q value for the bandpass filters (reduced from 6.0)
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise

// Target overall slopes (mutable for tilt range control)
const LOW_SLOPE_DB_PER_OCT = -10.5; // For low y positions (darker sound)
const CENTER_SLOPE_DB_PER_OCT = -4.5; // For middle y positions
const HIGH_SLOPE_DB_PER_OCT = 1.5; // For high y positions (brighter sound)
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
const DEFAULT_GLOBAL_STAGGER_ATTACK_S = 0.5; // Attack duration (500ms) - gentle fade in
const DEFAULT_GLOBAL_STAGGER_SUSTAIN_S = 0.5; // Sustain/hold duration (500ms)
const DEFAULT_GLOBAL_STAGGER_RELEASE_S = 0.5; // Release duration (500ms) - gentle fade out
// const ALL_DOTS_STAGGER_INTERVAL_S = 0.5; // Stagger between each dot in the global sequence

// New constants for dot repetition
const DOT_REPETITION_INTERVAL_S = 0.5; // Interval between hits - 500ms per hit (4 hits = 2 seconds per dot)
const DEFAULT_REPEAT_COUNT = 4; // Default: 4 hits per dot
const DEFAULT_DB_INCREASE_PER_REPEAT = 12; // Default dB increase per repeat (was reduction, now increase)
const DEFAULT_HOLD_COUNT = 1; // Default: play each dot once before moving to next (one-by-one playback)
const DEFAULT_BASE_DB = -48; // Default starting dB level for first hit

// Constants for bandpassed noise generator
const BANDPASS_NOISE_SLOPE_DB_PER_OCT = -4.5; // Fixed slope for bandpassed noise
const BANDPASS_BANDWIDTH_OCTAVES = 6.0; // Default bandwidth: 6 octaves
const BANDPASS_NOISE_OUTPUT_GAIN_SCALAR = 0.25; // Much louder output for bandpassed noise

// Constants for sine tone generator
const SINE_TONE_OUTPUT_GAIN_SCALAR = 0.15; // Output gain for sine tones

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Volume pattern settings -- REMOVING
// const VOLUME_PATTERN = [0, -12, -6, -12]; // The fixed pattern in dB: 0dB, -12dB, -6dB, -12dB

// Enum for sound generation modes
enum SoundMode {
  SlopedNoise = 'sloped',
  BandpassedNoise = 'bandpassed',
  SineTone = 'sine'
}

// Interface for nodes managed by PositionedAudioService
interface PointAudioNodes {
    source: AudioBufferSourceNode;
  mainGain: GainNode;
    envelopeGain: GainNode;
    panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator | null;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator | null;
  sineToneGenerator: SineToneGenerator | null;
  pinkNoiseBuffer: AudioBuffer;
  normalizedYPos: number; // To recalculate slope without re-passing y, totalRows
  normalizedXPos: number; // For position-based volume control
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
  private subHitPlaybackEnabled: boolean = false; // New: Toggle for sub-hit mechanism - DEFAULT FALSE for continuous mode
  private currentSoundMode: SoundMode = SoundMode.BandpassedNoise; // Current sound generation mode - default to bandpassed
  private repeatCount: number = DEFAULT_REPEAT_COUNT; // Number of repeats for each dot
  private dbIncreasePerRepeat: number = DEFAULT_DB_INCREASE_PER_REPEAT; // dB increase per repeat (was reduction)
  private baseDb: number = DEFAULT_BASE_DB; // Starting dB level for first hit
  private holdCount: number = DEFAULT_HOLD_COUNT; // Number of times each dot plays at same volume
  private speed: number = 1.0; // Playback speed multiplier (1.0 = normal speed)
  private attackDuration: number = DEFAULT_GLOBAL_STAGGER_ATTACK_S; // Attack duration in seconds
  private sustainDuration: number = DEFAULT_GLOBAL_STAGGER_SUSTAIN_S; // Sustain/hold duration in seconds
  private releaseDuration: number = DEFAULT_GLOBAL_STAGGER_RELEASE_S; // Release duration in seconds
  private currentBandwidth: number = BANDPASS_BANDWIDTH_OCTAVES; // Current bandwidth in octaves for bandpassed noise
  private frequencyExtensionRange: number = 0; // How far beyond audible range to allow (0 = no extension, both filters always active)
  private readingDirection: 'horizontal' | 'vertical' = 'horizontal'; // Reading direction: horizontal (left-to-right) or vertical (top-to-bottom columns)

  // Independent rows mode settings
  private independentRowsEnabled: boolean = false; // Whether independent rows mode is enabled
  private rowSpeedVariances: Map<number, number> = new Map(); // Per-row speed multipliers
  private rowStartOffsetSeconds: number = 0.2; // Sequential offset between row starts (default: 200ms)
  private rowTempoVariance: number = 10; // Tempo variance percentage (default: ±10%)

  // Position-based volume mode settings
  private isPositionVolumeEnabled: boolean = false; // Whether position-based volume is enabled
  private positionVolumeAxis: 'horizontal' | 'vertical' = 'vertical'; // Which axis controls volume (vertical = up/down, horizontal = left/right)
  private positionVolumeReversed: boolean = false; // Whether to reverse the volume gradient (true = swap which side is full volume)
  private positionVolumeMinDb: number = -24; // Minimum volume in dB on the quieter side (default -24dB)

  // Always playing mode settings
  private alwaysPlayingEnabled: boolean = false; // Whether always playing mode is enabled
  private alwaysPlayingSpeed: number = 1 / 1.5; // Speed of oscillation in Hz (default: 1 cycle per 1.5 seconds)
  private alwaysPlayingStartTime: number = 0; // Start time for oscillation
  private alwaysPlayingAnimationFrameId: number | null = null; // Animation frame ID for oscillation loop
  private alwaysPlayingStaggerIntensity: number = 0; // Stagger intensity (0 = no stagger, 1 = max stagger)

  // Stopband mode settings (inverse sequential - all play except one)
  private stopbandModeEnabled: boolean = false; // Whether stopband mode is enabled
  private stopbandIterationTimeMs: number = 500; // Iteration time in milliseconds per flash (default: 500ms = 250ms silence + 250ms gap)
  private stopbandOffDurationMs: number = 250; // How long each dot stays silent per flash (default: 250ms)
  private stopbandFlashCount: number = 4; // How many times each dot flashes before moving to next (default: 4)
  private stopbandDbReductionPerFlash: number = 12; // dB reduction per flash (default: 12dB)
  private stopbandManualMode: boolean = false; // Whether to manually select flash target (true) or auto-cycle (false)
  private stopbandManualIndex: number = 0; // Manually selected dot index to flash

  // Loop sequencer mode settings
  private loopSequencerEnabled: boolean = false; // Whether loop sequencer mode is enabled
  private loopDuration: number = 4.0; // Total loop duration in seconds (default: 4 seconds)

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

  public setSoundMode(mode: SoundMode): void {
    this.currentSoundMode = mode;
  }

  public getSoundMode(): SoundMode {
    return this.currentSoundMode;
  }

  public setRepeatCount(count: number): void {
    this.repeatCount = Math.max(1, Math.floor(count)); // At least 1 repeat
  }

  public getRepeatCount(): number {
    return this.repeatCount;
  }

  public setDbIncreasePerRepeat(db: number): void {
    this.dbIncreasePerRepeat = Math.max(0, db); // At least 0 dB
  }

  public getDbIncreasePerRepeat(): number {
    return this.dbIncreasePerRepeat;
  }

  public setBaseDb(db: number): void {
    this.baseDb = Math.max(-60, Math.min(0, db)); // Clamp between -60dB and 0dB
  }

  public getBaseDb(): number {
    return this.baseDb;
  }

  public setAttackDuration(seconds: number): void {
    this.attackDuration = Math.max(0.001, Math.min(2, seconds)); // Clamp between 1ms and 2s
  }

  public getAttackDuration(): number {
    return this.attackDuration;
  }

  public setSustainDuration(seconds: number): void {
    this.sustainDuration = Math.max(0.001, Math.min(5, seconds)); // Clamp between 1ms and 5s
  }

  public getSustainDuration(): number {
    return this.sustainDuration;
  }

  public setReleaseDuration(seconds: number): void {
    this.releaseDuration = Math.max(0.001, Math.min(2, seconds)); // Clamp between 1ms and 2s
  }

  public getReleaseDuration(): number {
    return this.releaseDuration;
  }

  public setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(10, speed)); // Clamp between 0.1x and 10x
  }

  public getSpeed(): number {
    return this.speed;
  }

  public setReadingDirection(direction: 'horizontal' | 'vertical'): void {
    this.readingDirection = direction;
  }

  public getReadingDirection(): 'horizontal' | 'vertical' {
    return this.readingDirection;
  }

  public setHoldCount(count: number): void {
    this.holdCount = Math.max(1, Math.floor(count)); // At least 1 hold
  }

  public getHoldCount(): number {
    return this.holdCount;
  }

  public setPositionVolumeEnabled(enabled: boolean): void {
    this.isPositionVolumeEnabled = enabled;
  }

  public getPositionVolumeEnabled(): boolean {
    return this.isPositionVolumeEnabled;
  }

  public setPositionVolumeAxis(axis: 'horizontal' | 'vertical'): void {
    this.positionVolumeAxis = axis;
  }

  public getPositionVolumeAxis(): 'horizontal' | 'vertical' {
    return this.positionVolumeAxis;
  }

  public setPositionVolumeReversed(reversed: boolean): void {
    this.positionVolumeReversed = reversed;
  }

  public getPositionVolumeReversed(): boolean {
    return this.positionVolumeReversed;
  }

  public setPositionVolumeMinDb(minDb: number): void {
    this.positionVolumeMinDb = Math.max(-60, Math.min(0, minDb)); // Clamp between -60dB and 0dB
  }

  public getPositionVolumeMinDb(): number {
    return this.positionVolumeMinDb;
  }

  // Always playing mode methods
  public setAlwaysPlayingEnabled(enabled: boolean): void {
    this.alwaysPlayingEnabled = enabled;
  }

  public getAlwaysPlayingEnabled(): boolean {
    return this.alwaysPlayingEnabled;
  }

  public setAlwaysPlayingSpeed(speed: number): void {
    // Speed is in Hz (cycles per second)
    // Clamp between 0.1 Hz (1 cycle per 10 seconds) and 10 Hz (10 cycles per second)
    this.alwaysPlayingSpeed = Math.max(0.1, Math.min(10, speed));
  }

  public getAlwaysPlayingSpeed(): number {
    return this.alwaysPlayingSpeed;
  }

  public setAlwaysPlayingStaggerIntensity(intensity: number): void {
    // Clamp between 0 (no stagger) and 1 (max stagger)
    this.alwaysPlayingStaggerIntensity = Math.max(0, Math.min(1, intensity));
  }

  public getAlwaysPlayingStaggerIntensity(): number {
    return this.alwaysPlayingStaggerIntensity;
  }

  // Stopband mode methods
  public setStopbandModeEnabled(enabled: boolean): void {
    this.stopbandModeEnabled = enabled;
  }

  public getStopbandModeEnabled(): boolean {
    return this.stopbandModeEnabled;
  }

  public setStopbandIterationTime(timeMs: number): void {
    // Clamp between 100ms and 5000ms (5 seconds)
    this.stopbandIterationTimeMs = Math.max(100, Math.min(5000, timeMs));
  }

  public getStopbandIterationTime(): number {
    return this.stopbandIterationTimeMs;
  }

  public setStopbandOffDuration(durationMs: number): void {
    // Clamp between 50ms and 2000ms
    this.stopbandOffDurationMs = Math.max(50, Math.min(2000, durationMs));
  }

  public getStopbandOffDuration(): number {
    return this.stopbandOffDurationMs;
  }

  public setStopbandFlashCount(count: number): void {
    // Clamp between 1 and 10
    this.stopbandFlashCount = Math.max(1, Math.min(10, Math.floor(count)));
  }

  public getStopbandFlashCount(): number {
    return this.stopbandFlashCount;
  }

  public setStopbandDbReductionPerFlash(db: number): void {
    // Clamp between 0 and 24dB
    this.stopbandDbReductionPerFlash = Math.max(0, Math.min(24, db));
  }

  public getStopbandDbReductionPerFlash(): number {
    return this.stopbandDbReductionPerFlash;
  }

  public setStopbandManualMode(enabled: boolean): void {
    this.stopbandManualMode = enabled;
  }

  public getStopbandManualMode(): boolean {
    return this.stopbandManualMode;
  }

  public setStopbandManualIndex(index: number): void {
    this.stopbandManualIndex = Math.max(0, Math.floor(index));
  }

  public getStopbandManualIndex(): number {
    return this.stopbandManualIndex;
  }

  // Loop sequencer mode methods
  public setLoopSequencerEnabled(enabled: boolean): void {
    this.loopSequencerEnabled = enabled;
  }

  public getLoopSequencerEnabled(): boolean {
    return this.loopSequencerEnabled;
  }

  public setLoopDuration(seconds: number): void {
    this.loopDuration = Math.max(0.5, Math.min(60, seconds)); // Clamp 0.5-60 seconds
  }

  public getLoopDuration(): number {
    return this.loopDuration;
  }

  public startAlwaysPlayingOscillation(): void {
    if (this.alwaysPlayingAnimationFrameId !== null) {
      cancelAnimationFrame(this.alwaysPlayingAnimationFrameId);
    }

    // Ensure all audio points have their main gain and slope set
    this.audioPoints.forEach((point) => {
      this.setMainGainAndSlope(point);
    });

    this.alwaysPlayingStartTime = this.ctx.currentTime;
    this.oscillateAlwaysPlayingVolume();
  }

  public stopAlwaysPlayingOscillation(): void {
    if (this.alwaysPlayingAnimationFrameId !== null) {
      cancelAnimationFrame(this.alwaysPlayingAnimationFrameId);
      this.alwaysPlayingAnimationFrameId = null;
    }
  }

  public activatePointWithGain(id: string, gain: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    const currentTime = this.ctx.currentTime;
    point.envelopeGain.gain.setValueAtTime(gain, currentTime);
  }

  private oscillateAlwaysPlayingVolume(): void {
    if (!this.alwaysPlayingEnabled) {
      return;
    }

    const currentTime = this.ctx.currentTime;
    const elapsedTime = currentTime - this.alwaysPlayingStartTime;

    const MIN_DB = -60;

    if (this.stopbandModeEnabled) {
      // Stopband mode is now handled at DotGridAudioPlayer level
      // This just ensures gains are set properly for initial state
      this.audioPoints.forEach((point) => {
        // All dots start at full volume, player will manage which one is silent
        if (point.envelopeGain.gain.value < 0.01) {
          point.envelopeGain.gain.setValueAtTime(ENVELOPE_MAX_GAIN * 0.8, currentTime);
        }
      });
    } else {
      // Original always playing mode with volume oscillation
      // Apply volume to all active points
      this.audioPoints.forEach((point) => {
        // Calculate phase offset for this point based on its position
        // Use a combination of X and Y position to create unique phase offsets
        // This creates a diagonal wave pattern across the grid
        const positionOffset = (point.normalizedXPos + point.normalizedYPos) / 2;
        const phaseOffset = positionOffset * 2 * Math.PI * this.alwaysPlayingStaggerIntensity;

        // Calculate oscillation value using sine wave with phase offset
        const phase = 2 * Math.PI * this.alwaysPlayingSpeed * elapsedTime + phaseOffset;
        const t = (1 + Math.sin(phase)) / 2;

        // Use logarithmic (dB-based) scaling for perceptually linear volume changes
        // Map t (0 to 1) to a dB range (-60dB to 0dB), then convert to linear gain
        const dbValue = MIN_DB * (1 - t); // Goes from -60dB (when t=0) to 0dB (when t=1)
        const volumeMultiplier = Math.pow(10, dbValue / 20);

        // Set the envelope gain to the oscillating volume
        point.envelopeGain.gain.setValueAtTime(
          ENVELOPE_MAX_GAIN * 0.8 * volumeMultiplier,
          currentTime
        );
      });
    }

    // Schedule next update
    this.alwaysPlayingAnimationFrameId = requestAnimationFrame(() => {
      this.oscillateAlwaysPlayingVolume();
    });
  }

  // Independent rows mode methods
  public generateRowSpeedVariances(numRows: number): void {
    this.rowSpeedVariances.clear();
    const variance = this.rowTempoVariance / 100;

    for (let i = 0; i < numRows; i++) {
      const randomVariance = (Math.random() * 2 - 1) * variance;
      const speedMultiplier = 1 + randomVariance;
      this.rowSpeedVariances.set(i, speedMultiplier);
    }
  }

  public ensureRowSpeedVariances(gridSize: number, columnCount: number): void {
    const readingDirection = this.getReadingDirection();
    const numGroups = readingDirection === 'horizontal' ? gridSize : columnCount;

    if (this.rowSpeedVariances.size !== numGroups) {
      this.generateRowSpeedVariances(numGroups);
    }
  }

  public getRowSpeed(rowIndex: number): number {
    const variance = this.rowSpeedVariances.get(rowIndex) || 1.0;
    return this.speed * variance;
  }

  public setIndependentRowsEnabled(enabled: boolean): void {
    this.independentRowsEnabled = enabled;
    if (!enabled) {
      this.rowSpeedVariances.clear();
    }
  }

  public getIndependentRowsEnabled(): boolean {
    return this.independentRowsEnabled;
  }

  public setRowTempoVariance(variance: number): void {
    this.rowTempoVariance = Math.max(5, Math.min(20, variance));
  }

  public getRowTempoVariance(): number {
    return this.rowTempoVariance;
  }

  public setRowStartOffset(offsetSeconds: number): void {
    this.rowStartOffsetSeconds = Math.max(0.05, Math.min(0.5, offsetSeconds));
  }

  public getRowStartOffset(): number {
    return this.rowStartOffsetSeconds;
  }

  /**
   * Schedule an envelope trigger for a specific point (for loop sequencer)
   * Applies ADSR envelope without deactivating the point
   * Also sets frequency characteristics based on position
   */
  public schedulePointEnvelope(pointId: string, scheduledTime: number, gainMultiplier: number = 1.0): void {
    const point = this.audioPoints.get(pointId);
    if (point) {
      // Set frequency characteristics (slope/bandwidth) based on dot position
      this.setMainGainAndSlope(point);
      // Schedule the ADSR envelope
      this._schedulePointActivationSound(point, scheduledTime, gainMultiplier);
    }
  }

  // Legacy methods for backwards compatibility
  public setBandpassedNoiseMode(enabled: boolean): void {
    this.currentSoundMode = enabled ? SoundMode.BandpassedNoise : SoundMode.SlopedNoise;
  }

  public isBandpassedNoiseMode(): boolean {
    return this.currentSoundMode === SoundMode.BandpassedNoise;
  }

  private _schedulePointActivationSound(pointNode: PointAudioNodes, scheduledTime: number, gainMultiplier: number = 1.0): void {
    const gainParam = pointNode.envelopeGain.gain;
    gainParam.cancelScheduledValues(scheduledTime);

    if (this.subHitAdsrEnabled) {
      // Use full ADSR envelope: Attack -> Sustain -> Release
      gainParam.setValueAtTime(0.001, scheduledTime); // Start just above zero for exponential curves

      // Attack - fade in
      gainParam.exponentialRampToValueAtTime(
        ENVELOPE_MAX_GAIN * 0.8 * gainMultiplier, // Apply gain multiplier for volume
        scheduledTime + this.attackDuration
      );

      // Sustain - hold at full volume
      gainParam.setValueAtTime(
        ENVELOPE_MAX_GAIN * 0.8 * gainMultiplier,
        scheduledTime + this.attackDuration + this.sustainDuration
      );

      // Release - fade out
      gainParam.exponentialRampToValueAtTime(
        0.001, // Target for exponential ramp (close to zero)
        scheduledTime + this.attackDuration + this.sustainDuration + this.releaseDuration
      );

      // Ensure silence after release
      gainParam.setValueAtTime(ENVELOPE_MIN_GAIN, scheduledTime + this.attackDuration + this.sustainDuration + this.releaseDuration + 0.001);
    } else {
      // Use Attack-Sustain for the global staggered hit (no automatic release)
      gainParam.setValueAtTime(0.001, scheduledTime); // Start just above zero for exponential curves
      gainParam.exponentialRampToValueAtTime(
        ENVELOPE_MAX_GAIN * 0.8 * gainMultiplier, // Apply gain multiplier for volume
        scheduledTime + this.attackDuration
      );
      // Gain remains at reduced ENVELOPE_MAX_GAIN until deactivatePoint is called
    }
  }

  public addPoint(id: string, x: number, y: number, totalRows: number, totalCols: number): void {
    if (this.audioPoints.has(id)) {
      console.warn(`Audio point with id ${id} already exists.`);
      return;
    }

    const normalizedY = totalRows <= 1 ? 0.5 : 1 - (y / (totalRows - 1));
    const normalizedX = totalCols <= 1 ? 0.5 : (x / (totalCols - 1));
    const panPosition = totalCols <= 1 ? 0 : (2 * normalizedX - 1);

    const mainGain = this.ctx.createGain();
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = 0.001; // Start just above zero for exponential curves
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panPosition;

    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;
    const pinkNoiseBuffer: AudioBuffer = this._generateSinglePinkNoiseBuffer();

    // Always create a source and buffer for consistency (some modes might not use it)
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;

    if (this.currentSoundMode === SoundMode.BandpassedNoise) {
      // Use bandpassed noise generator
      source.loop = true;
      bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);

      // Apply current bandwidth setting to the new generator
      bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);

      // Connect chain: source -> bandpassedGen -> mainGain -> envelopeGain -> panner -> serviceOutput
      source.connect(bandpassedNoiseGenerator.getInputNode());
      bandpassedNoiseGenerator.getOutputNode().connect(mainGain);

      source.start(); // Start source immediately, loop, control with envelopeGain
    } else if (this.currentSoundMode === SoundMode.SineTone) {
      // Use sine tone generator
      sineToneGenerator = new SineToneGenerator(this.ctx);
      
      // Connect chain: sineGen -> mainGain -> envelopeGain -> panner -> serviceOutput
      sineToneGenerator.getOutputNode().connect(mainGain);
      
      // Don't start the buffer source for sine tone mode
    } else {
      // Use sloped pink noise generator (default)
      source.loop = true;
      slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
      
      // Connect chain: source -> slopedGen -> mainGain -> envelopeGain -> panner -> serviceOutput
      source.connect(slopedNoiseGenerator.getInputNode());
      slopedNoiseGenerator.getOutputNode().connect(mainGain);
      
      source.start(); // Start source immediately, loop, control with envelopeGain
    }

    mainGain.connect(envelopeGain);
    envelopeGain.connect(panner);
    panner.connect(this.outputGain);

    this.audioPoints.set(id, {
      source,
      mainGain,
      envelopeGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      sineToneGenerator,
      pinkNoiseBuffer,
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX,
      // Initialize new properties
      subHitCount: 0,
      subHitTimerId: null,
    });
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
    } catch {
      // Ignore stop errors
    }
    point.source.disconnect();
    
    // Dispose of the appropriate generator
    if (point.slopedNoiseGenerator) {
      point.slopedNoiseGenerator.dispose();
    }
    if (point.bandpassedNoiseGenerator) {
      point.bandpassedNoiseGenerator.dispose();
    }
    if (point.sineToneGenerator) {
      point.sineToneGenerator.dispose();
    }
    
    point.mainGain.disconnect();
    point.envelopeGain.disconnect();
    point.panner.disconnect();
    // point.pinkNoiseBuffer = null; // Buffer is managed by JS GC once source is gone

    this.audioPoints.delete(id);
  }

  public activatePoint(id: string, activationTime: number, gainMultiplier: number = 1.0): void { // Added gainMultiplier parameter
    const point = this.audioPoints.get(id);
    if (!point) return;

    this.setMainGainAndSlope(point); // Set timbre and base volume first

    if (!this.subHitPlaybackEnabled) {
      // CONTINUOUS SIMULTANEOUS MODE (subHitPlaybackEnabled is false)
      const now = this.ctx.currentTime; // For immediate activation
      point.envelopeGain.gain.cancelScheduledValues(now);
      point.envelopeGain.gain.setValueAtTime(ENVELOPE_MAX_GAIN * 0.8 * gainMultiplier, now); // Apply gain multiplier

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

      this._schedulePointActivationSound(point, activationTime, gainMultiplier);
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
    const currentGain = Math.max(0.001, point.envelopeGain.gain.value); // Ensure we're above zero for exponential
    point.envelopeGain.gain.setValueAtTime(currentGain, now); // Hold current value
    point.envelopeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.01); // Quick exponential ramp down (10ms)
  }
  
  public deactivateAllPoints(): void {
    this.audioPoints.forEach((_, id) => this.deactivatePoint(id));
  }

  public dispose(): void {
    this.stopAlwaysPlayingOscillation();
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
    let targetOverallSlopeDbPerOctave;
    if (point.normalizedYPos < 0.5) {
      const t = point.normalizedYPos * 2;
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      const t = (point.normalizedYPos - 0.5) * 2;
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }
    
    // Set slope on the appropriate generator (only for sloped noise, not bandpassed or sine)
    if (point.slopedNoiseGenerator) {
      point.slopedNoiseGenerator.setSlope(targetOverallSlopeDbPerOctave);
    }
    // Bandpassed noise uses fixed slope, bandpass position based on Y
    let bandpassCenterFreq = 0; // Used for volume compensation later
    if (point.bandpassedNoiseGenerator) {
      const bandwidthOctaves = this.currentBandwidth;
      const MIN_AUDIBLE = 20; // Hz
      const MAX_AUDIBLE = 20000; // Hz

      // Calculate edge frequencies based on extension range
      // With 0 extension: edges stay at audible boundaries (20-20000 Hz)
      // With higher extension: edges can extend beyond audible range
      const extensionMultiplier = Math.pow(2, this.frequencyExtensionRange);

      // Y=0 (bottom dot): lower edge at MIN_AUDIBLE / extensionMultiplier
      const bottomLowerEdge = MIN_AUDIBLE / extensionMultiplier;

      // Y=1 (top dot): upper edge at MAX_AUDIBLE * extensionMultiplier
      const topUpperEdge = MAX_AUDIBLE * extensionMultiplier;
      const topLowerEdge = topUpperEdge / Math.pow(2, bandwidthOctaves);

      // Logarithmically interpolate lower edge based on Y position
      const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, point.normalizedYPos);
      const upperEdge = lowerEdge * Math.pow(2, bandwidthOctaves);

      // Calculate center frequency (geometric mean) for filter positioning
      bandpassCenterFreq = Math.sqrt(lowerEdge * upperEdge);
      point.bandpassedNoiseGenerator.setBandpassFrequency(bandpassCenterFreq);
    }
    // Sine tone uses the same frequency mapping as bandpassed noise
    if (point.sineToneGenerator) {
      // Map Y position to sine frequency (higher Y = higher frequency)
      const minFreq = 50; // Hz
      const maxFreq = 14000; // Hz
      const logMinFreq = Math.log2(minFreq);
      const logMaxFreq = Math.log2(maxFreq);
      const targetFreq = Math.pow(2, logMinFreq + point.normalizedYPos * (logMaxFreq - logMinFreq));
      point.sineToneGenerator.setFrequency(targetFreq);
    }

    // Calculate volume compensation based on generator mode
    let finalVolumeDb: number;

    if (point.bandpassedNoiseGenerator && bandpassCenterFreq > 0) {
      // For bandpassed noise: simplified equal loudness compensation only
      // Since all dots have same slope and bandwidth, only compensate for human hearing
      const refFreq = 1000; // Hz, approximate equal loudness curve minimum
      let loudnessCompensationDb = 0;

      // Clamp center freq for compensation calculation ONLY
      const compensationFreq = Math.max(20, Math.min(20000, bandpassCenterFreq));

      if (compensationFreq < refFreq) {
        // Low frequencies: gentle boost for equal loudness
        const octavesBelow = Math.log2(refFreq / compensationFreq);
        loudnessCompensationDb = octavesBelow * 3; // 3dB/octave below 1kHz
      } else if (compensationFreq > 4000) {
        // High frequencies: slight boost
        const octavesAbove = Math.log2(compensationFreq / 4000);
        loudnessCompensationDb = octavesAbove * 2; // 2dB/octave above 4kHz
      }

      finalVolumeDb = this.currentBaseDbLevel + loudnessCompensationDb;
    } else {
      // For sloped noise and sine tones: use original slope-based compensation
      const slopeDeviationForAttenuation = Math.abs(targetOverallSlopeDbPerOctave - CENTER_SLOPE_DB_PER_OCT);
      const existingAttenuationDb = -slopeDeviationForAttenuation * ATTENUATION_PER_DB_OCT_DEVIATION_DB;

      // Additional boost calculation based on normalizedYPos extremity
      const MAX_ADDITIONAL_BOOST_DB = 9.0;
      const extremityFactor = Math.abs(point.normalizedYPos - 0.5) * 2;
      const curvedExtremityFactor = Math.sqrt(extremityFactor);
      const additionalSlopeBoostDb = curvedExtremityFactor * MAX_ADDITIONAL_BOOST_DB;

      finalVolumeDb = this.currentBaseDbLevel + existingAttenuationDb + additionalSlopeBoostDb;
    }

    // Apply position-based volume if enabled
    if (this.isPositionVolumeEnabled) {
      // Determine which position to use based on axis
      let positionForVolume = 0;
      if (this.positionVolumeAxis === 'vertical') {
        // Vertical: use normalizedYPos (0 = bottom, 1 = top)
        positionForVolume = point.normalizedYPos;
      } else {
        // Horizontal: use normalizedXPos (0 = left, 1 = right)
        positionForVolume = point.normalizedXPos;
      }

      // Reverse if needed
      if (this.positionVolumeReversed) {
        positionForVolume = 1 - positionForVolume;
      }

      // Calculate position-based attenuation
      // positionForVolume = 0: minimum volume (positionVolumeMinDb)
      // positionForVolume = 1: full volume (0dB attenuation)
      const positionAttenuationDb = this.positionVolumeMinDb * (1 - positionForVolume);

      // Apply the attenuation to the final volume
      finalVolumeDb += positionAttenuationDb;
    }

    const gainRatio = Math.pow(10, finalVolumeDb / 20);
    const effectiveMasterGain = MASTER_GAIN * this.currentDistortionGain * gainRatio;
    point.mainGain.gain.setValueAtTime(effectiveMasterGain, this.ctx.currentTime);
  }

  public setSubHitAdsrEnabled(enabled: boolean): void { // Renamed from setEnvelopeEnabled
    this.subHitAdsrEnabled = enabled;
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    // Store the current bandwidth setting
    this.currentBandwidth = bandwidthOctaves;

    // Update bandwidth for all active bandpassed noise generators
    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setBandpassBandwidth(bandwidthOctaves);
      }
    });
  }

  public setFrequencyExtensionRange(octaves: number): void {
    // Store the current extension range setting
    this.frequencyExtensionRange = Math.max(0, Math.min(5, octaves));

    // Recalculate bandpass frequencies for all active points with the new extension range
    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        // Recalculate frequency positioning by calling setMainGainAndSlope
        this.setMainGainAndSlope(point);
      }
    });
  }

  public getFrequencyExtensionRange(): number {
    return this.frequencyExtensionRange;
  }

  // Legacy method for backward compatibility
  public setBandpassQ(qValue: number): void {
    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setBandpassQ(qValue);
      }
    });
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
  private rowLoopTimeoutIds: Map<number, number> = new Map(); // For independent row timing loops

  private gridSize: number = 3;
  private columnCount: number = COLUMNS;
  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;

  // Stopband mode state
  private stopbandIntervalId: number | null = null; // For stopband cycling timer
  private stopbandCurrentIndex: number = 0; // Current index of silent dot
  private stopbandOnTimeoutId: number | null = null; // Timeout to turn the silent dot back on
  private stopbandCurrentFlash: number = 0; // Current flash number (0-based) for the current dot
  // private animationFrameId: number | null = null; // REMOVING, rAF not used for global stagger

  // Loop sequencer mode state
  private loopSequencerTimeoutId: number | null = null; // For loop sequencer iteration timeout

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
      if (this.isLoopSequencerMode()) {
        // NEW: Restart loop sequencer with new dots
        this.stopLoopSequencer();
        this.startLoopSequencer();
      } else if (this.isContinuousSimultaneousMode()) {
        addedKeys.forEach(key => this.audioService.activatePoint(key, audioContext.getAudioContext().currentTime));
        // Removed keys are handled by removePoint implicitly deactivating them
      } else {
      this.stopAllRhythms();
      this.startAllRhythms();
      }
    }
  }

  /**
   * Start stopband mode cycling
   */
  private startStopbandCycling(): void {
    this.stopStopbandCycling(); // Clear any existing interval

    // Get sorted dot keys in reading order
    const sortedDots = this.getSortedDotKeys();
    if (sortedDots.length === 0) return;

    // Check if manual mode is enabled
    const isManualMode = this.audioService.getStopbandManualMode();

    if (isManualMode) {
      // Manual mode: use the manually selected index
      this.stopbandCurrentIndex = this.audioService.getStopbandManualIndex() % sortedDots.length;
    } else {
      // Auto mode: start at the beginning
      this.stopbandCurrentIndex = 0;
    }

    this.stopbandCurrentFlash = 0;
    this.updateStopbandState(sortedDots);

    // Set up interval to cycle through flashes
    const iterationTime = this.audioService.getStopbandIterationTime();
    this.stopbandIntervalId = window.setInterval(() => {
      if (!this.isPlaying || !this.audioService.getStopbandModeEnabled()) {
        this.stopStopbandCycling();
        return;
      }

      const currentSortedDots = this.getSortedDotKeys();
      if (currentSortedDots.length === 0) {
        this.stopStopbandCycling();
        return;
      }

      const flashCount = this.audioService.getStopbandFlashCount();
      const manualMode = this.audioService.getStopbandManualMode();

      // Increment flash counter
      this.stopbandCurrentFlash++;

      // If we've completed all flashes for this dot
      if (this.stopbandCurrentFlash >= flashCount) {
        this.stopbandCurrentFlash = 0;

        if (manualMode) {
          // Manual mode: use the manually selected index, don't auto-advance
          this.stopbandCurrentIndex = this.audioService.getStopbandManualIndex() % currentSortedDots.length;
        } else {
          // Auto mode: move to next dot
          this.stopbandCurrentIndex = (this.stopbandCurrentIndex + 1) % currentSortedDots.length;
        }
      }

      this.updateStopbandState(currentSortedDots);
    }, iterationTime);
  }

  /**
   * Stop stopband mode cycling
   */
  private stopStopbandCycling(): void {
    if (this.stopbandIntervalId !== null) {
      clearInterval(this.stopbandIntervalId);
      this.stopbandIntervalId = null;
    }
    if (this.stopbandOnTimeoutId !== null) {
      clearTimeout(this.stopbandOnTimeoutId);
      this.stopbandOnTimeoutId = null;
    }
  }

  /**
   * Update which dot is silent in stopband mode
   */
  private updateStopbandState(sortedDots: string[]): void {
    // Clear any existing "turn on" timeout
    if (this.stopbandOnTimeoutId !== null) {
      clearTimeout(this.stopbandOnTimeoutId);
      this.stopbandOnTimeoutId = null;
    }

    const currentDotKey = sortedDots[this.stopbandCurrentIndex];

    // Calculate volume reduction based on flash number
    // Flash 0: 0dB (full volume)
    // Flash 1: -12dB
    // Flash 2: -24dB
    // Flash 3: -36dB
    const dbReductionPerFlash = this.audioService.getStopbandDbReductionPerFlash();
    const totalDbReduction = this.stopbandCurrentFlash * dbReductionPerFlash;
    const volumeMultiplier = Math.pow(10, -totalDbReduction / 20);
    const targetGain = volumeMultiplier < 0.01 ? 0.001 : 0.8 * volumeMultiplier;

    // Turn all dots on first at full volume
    sortedDots.forEach((dotKey) => {
      this.audioService.activatePointWithGain(dotKey, 0.8);
    });

    // Silence the current dot completely
    this.audioService.activatePointWithGain(currentDotKey, 0.001);

    // Schedule the dot to turn back on after the off duration at the reduced volume
    const offDuration = this.audioService.getStopbandOffDuration();
    this.stopbandOnTimeoutId = window.setTimeout(() => {
      // Turn the dot back on at the reduced volume (based on flash number)
      this.audioService.activatePointWithGain(currentDotKey, targetGain);
      this.stopbandOnTimeoutId = null;
    }, offDuration);
  }

  /**
   * Get sorted dot keys in reading order
   */
  private getSortedDotKeys(): string[] {
    const readingDirection = this.audioService.getReadingDirection();
    const parsedDots = Array.from(this.activeDotKeys).map(dotKey => {
      const [xStr, yStr] = dotKey.split(',');
      return {
        key: dotKey,
        x: parseInt(xStr, 10),
        y: parseInt(yStr, 10)
      };
    });

    let sortedDotKeys: string[];

    if (readingDirection === 'horizontal') {
      // Horizontal reading with snake pattern
      const rowGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!rowGroups.has(dot.y)) rowGroups.set(dot.y, []);
        rowGroups.get(dot.y)!.push(dot);
      });

      const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => a[0] - b[0]);
      sortedDotKeys = sortedRows.flatMap(([, dots], rowIndex) => {
        const sortedDots = dots.sort((a, b) => a.x - b.x);
        if (rowIndex % 2 === 1) sortedDots.reverse();
        return sortedDots.map(d => d.key);
      });
    } else {
      // Vertical reading with snake pattern
      const colGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!colGroups.has(dot.x)) colGroups.set(dot.x, []);
        colGroups.get(dot.x)!.push(dot);
      });

      const sortedCols = Array.from(colGroups.entries()).sort((a, b) => a[0] - b[0]);
      sortedDotKeys = sortedCols.flatMap(([, dots], colIndex) => {
        const sortedDots = dots.sort((a, b) => a.y - b.y);
        if (colIndex % 2 === 1) sortedDots.reverse();
        return sortedDots.map(d => d.key);
      });
    }

    return sortedDotKeys;
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;

    this.isPlaying = playing;
    console.log('🔊 Set playing state:', playing);

    if (playing) {
      // NEW: Check loop sequencer mode first
      if (this.isLoopSequencerMode()) {
        this.stopAllRhythmsInternalCleanup(); // Clear other modes
        this.audioService.stopAlwaysPlayingOscillation();
        this.stopStopbandCycling();
        this.startLoopSequencer();
      }
      // EXISTING: Continuous simultaneous mode
      else if (this.isContinuousSimultaneousMode()){
        this.stopLoopSequencerInternalCleanup(); // NEW - Clear loop sequencer
        this.stopAllRhythmsInternalCleanup(); // Clear any rAF/staggers from previous mode
        this.audioService.deactivateAllPoints(); // Fresh start

        // Check if always playing mode is enabled
        if (this.audioService.getAlwaysPlayingEnabled()) {
          // Check if stopband mode is enabled
          if (this.audioService.getStopbandModeEnabled()) {
            // Start stopband cycling
            this.startStopbandCycling();
          } else {
            // Start always playing oscillation
            this.audioService.startAlwaysPlayingOscillation();
          }
        } else {
          // Normal continuous mode - activate all dots
          this.activeDotKeys.forEach(dotKey => this.audioService.activatePoint(dotKey, audioContext.getAudioContext().currentTime));
        }
      }
      // EXISTING: Sequential sub-hit mode
      else {
        this.stopLoopSequencerInternalCleanup(); // NEW - Clear loop sequencer
        this.startAllRhythms();
      }
    } else {
      this.audioService.stopAlwaysPlayingOscillation();
      this.stopStopbandCycling();
      this.stopLoopSequencer(); // NEW
      this.stopAllRhythms();
    }
  }

  /**
   * Start loop sequencer mode - evenly spaced dots with envelope triggering
   */
  private startLoopSequencer(): void {
    this.stopLoopSequencerInternalCleanup();

    if (!this.isPlaying || this.activeDotKeys.size === 0) {
      return;
    }

    // Ensure all dots are silent before scheduling envelopes
    // This sets envelope gains to 0 without stopping the audio sources
    this.audioService.deactivateAllPoints();

    // Sort dots by reading order (horizontal/vertical snake pattern)
    const sortedDotKeys = this.sortDotsByReadingOrder();
    const loopDuration = this.audioService.getLoopDuration();
    const dotCount = sortedDotKeys.length;
    const dotInterval = loopDuration / dotCount; // Evenly space dots in time

    const currentTime = audioContext.getAudioContext().currentTime;

    // Schedule ADSR envelope triggers for all dots in this loop cycle
    // Each dot fades in (attack), holds (sustain), then fades out (release)
    // Starting from silence, staggered evenly throughout the loop
    sortedDotKeys.forEach((dotKey, index) => {
      const triggerTime = currentTime + (index * dotInterval);
      // Schedule envelope (attack -> sustain -> release) with full volume gain
      this.audioService.schedulePointEnvelope(dotKey, triggerTime, 1.0);
    });

    // Schedule next loop iteration
    const loopDelayMs = loopDuration * 1000;
    this.loopSequencerTimeoutId = window.setTimeout(() => {
      if (this.isPlaying && this.isLoopSequencerMode()) {
        this.startLoopSequencer(); // Recursive loop
      }
    }, loopDelayMs);
  }

  /**
   * Stop loop sequencer and clear timeout
   */
  private stopLoopSequencer(): void {
    this.stopLoopSequencerInternalCleanup();
    // Keep dots active in continuous mode (no deactivation)
  }

  /**
   * Internal cleanup for loop sequencer timeout
   */
  private stopLoopSequencerInternalCleanup(): void {
    if (this.loopSequencerTimeoutId !== null) {
      clearTimeout(this.loopSequencerTimeoutId);
      this.loopSequencerTimeoutId = null;
    }
  }

  /**
   * Sort dots by reading order (horizontal/vertical snake pattern)
   * Returns array of dot keys in play order
   */
  private sortDotsByReadingOrder(): string[] {
    const readingDirection = this.audioService.getReadingDirection();

    // Parse all dot keys
    const parsedDots = Array.from(this.activeDotKeys).map(dotKey => {
      const [xStr, yStr] = dotKey.split(',');
      return {
        key: dotKey,
        x: parseInt(xStr, 10),
        y: parseInt(yStr, 10)
      };
    });

    // Sort by reading direction (copy logic from startAllRhythms)
    if (readingDirection === 'horizontal') {
      // Horizontal reading: group by row, snake pattern (reverse every other row)
      parsedDots.sort((a, b) => {
        const rowDiff = a.y - b.y;
        if (rowDiff !== 0) return rowDiff;

        // Within same row: alternate direction (snake pattern)
        const shouldReverse = a.y % 2 === 1; // Reverse on odd rows
        return shouldReverse ? b.x - a.x : a.x - b.x;
      });
    } else {
      // Vertical reading: group by column, snake pattern (reverse every other column)
      parsedDots.sort((a, b) => {
        const colDiff = a.x - b.x;
        if (colDiff !== 0) return colDiff;

        // Within same column: alternate direction (snake pattern)
        const shouldReverse = a.x % 2 === 1; // Reverse on odd columns
        return shouldReverse ? b.y - a.y : a.y - b.y;
      });
    }

    return parsedDots.map(d => d.key);
  }

  /**
   * Start all rhythm timers - now plays dots simultaneously with staggered timing
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

    // Check if independent rows mode is enabled
    if (this.audioService.getIndependentRowsEnabled()) {
      this.startIndependentRowRhythms();
      return;
    }

    const readingDirection = this.audioService.getReadingDirection();

    // Parse all dot keys into structured data
    const parsedDots = Array.from(this.activeDotKeys).map(dotKey => {
      const [xStr, yStr] = dotKey.split(',');
      return {
        key: dotKey,
        x: parseInt(xStr, 10),
        y: parseInt(yStr, 10)
      };
    });

    let sortedDotKeys: string[];

    if (readingDirection === 'horizontal') {
      // Horizontal reading with snake pattern (alternating left-to-right and right-to-left)
      // Group dots by row
      const rowGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!rowGroups.has(dot.y)) {
          rowGroups.set(dot.y, []);
        }
        rowGroups.get(dot.y)!.push(dot);
      });

      // Sort rows by y coordinate (top to bottom)
      const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => a[0] - b[0]);

      // For each row, sort left-to-right or right-to-left based on row index
      sortedDotKeys = sortedRows.flatMap(([, dots], rowIndex) => {
        // Sort dots in this row by x coordinate
        const sortedDots = dots.sort((a, b) => a.x - b.x);

        // Reverse every other row to create snake pattern
        if (rowIndex % 2 === 1) {
          sortedDots.reverse();
        }

        return sortedDots.map(d => d.key);
      });
    } else {
      // Vertical reading with snake pattern (alternating top-to-bottom and bottom-to-top)
      // Group dots by column
      const colGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!colGroups.has(dot.x)) {
          colGroups.set(dot.x, []);
        }
        colGroups.get(dot.x)!.push(dot);
      });

      // Sort columns by x coordinate (left to right)
      const sortedCols = Array.from(colGroups.entries()).sort((a, b) => a[0] - b[0]);

      // For each column, sort top-to-bottom or bottom-to-top based on column index
      sortedDotKeys = sortedCols.flatMap(([, dots], colIndex) => {
        // Sort dots in this column by y coordinate
        const sortedDots = dots.sort((a, b) => a.y - b.y);

        // Reverse every other column to create snake pattern
        if (colIndex % 2 === 1) {
          sortedDots.reverse();
        }

        return sortedDots.map(d => d.key);
      });
    }

    const currentTime = audioContext.getAudioContext().currentTime;

    // Get repeat settings from the audio service
    const repeatCount = this.audioService.getRepeatCount();
    const dbIncreasePerRepeat = this.audioService.getDbIncreasePerRepeat();
    const baseDb = this.audioService.getBaseDb();
    const holdCount = this.audioService.getHoldCount();
    const speed = this.audioService.getSpeed();

    // Calculate speed-adjusted repetition interval (higher speed = shorter interval)
    const adjustedRepetitionInterval = DOT_REPETITION_INTERVAL_S / speed;

    // Get envelope durations to ensure dots don't overlap
    const attackDuration = this.audioService.getAttackDuration();
    const sustainDuration = this.audioService.getSustainDuration();
    const releaseDuration = this.audioService.getReleaseDuration();
    const envelopeDuration = attackDuration + sustainDuration + releaseDuration;

    // Calculate how long each dot needs to complete all its repetitions
    // Last hit starts at: (repeatCount * holdCount - 1) * interval
    // Last hit ends at: lastHitStart + envelopeDuration
    const dotCompletionTime = (holdCount * repeatCount - 1) * adjustedRepetitionInterval + envelopeDuration;

    // Schedule all dots to play sequentially (each starts after previous completes)
    sortedDotKeys.forEach((dotKey, dotIndex) => {
      // Each dot starts after all previous dots have completed their repetitions
      const staggerOffset = dotIndex * dotCompletionTime;

      // Schedule all repetitions for this dot with progressive volume increase
      for (let repetition = 0; repetition < repeatCount; repetition++) {
        // Calculate gain multiplier based on repeat number
        // Start at baseDb (e.g., -48dB) and increase by dbIncreasePerRepeat each time
        const dbIncrease = repetition * dbIncreasePerRepeat;
        const totalDb = baseDb + dbIncrease; // e.g., -48, -36, -24, -12
        const gainMultiplier = Math.pow(10, totalDb / 20); // Convert dB to linear gain

        // For each repeat, schedule holdCount activations at the same volume
        for (let hold = 0; hold < holdCount; hold++) {
          const activationTime = currentTime + staggerOffset + (repetition * holdCount + hold) * adjustedRepetitionInterval;
          this.audioService.activatePoint(dotKey, activationTime, gainMultiplier);
        }
      }
    });
    
    // Schedule the next iteration of the loop if there are dots
    if (sortedDotKeys.length > 0) {
      // Total time for one complete cycle = time for all dots to complete sequentially
      const totalSequenceTime = sortedDotKeys.length * dotCompletionTime;
      const loopDelayMs = totalSequenceTime * 1000;
      if (loopDelayMs > 0) { // Ensure positive delay
        this.loopTimeoutId = window.setTimeout(() => {
          // Check playback state again before re-triggering
          if (this.isPlaying && !this.isContinuousSimultaneousMode()) {
            this.startAllRhythms(); // This will handle deactivating/cleanup and rescheduling
          }
        }, loopDelayMs);
      }
    }
  }

  /**
   * Group dots by reading order (rows or columns) for independent playback
   */
  private groupDotsByReadingOrder(): Map<number, string[]> {
    const readingDirection = this.audioService.getReadingDirection();
    const parsedDots = Array.from(this.activeDotKeys).map(dotKey => {
      const [xStr, yStr] = dotKey.split(',');
      return { key: dotKey, x: parseInt(xStr, 10), y: parseInt(yStr, 10) };
    });

    const result = new Map<number, string[]>();

    if (readingDirection === 'horizontal') {
      // Group by row (y coordinate)
      const rowGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!rowGroups.has(dot.y)) rowGroups.set(dot.y, []);
        rowGroups.get(dot.y)!.push(dot);
      });

      // Sort and apply snake pattern
      const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => a[0] - b[0]);
      sortedRows.forEach(([, dots], rowIndex) => {
        const sortedDots = dots.sort((a, b) => a.x - b.x);
        if (rowIndex % 2 === 1) sortedDots.reverse();
        result.set(rowIndex, sortedDots.map(d => d.key));
      });
    } else {
      // Group by column (x coordinate)
      const colGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!colGroups.has(dot.x)) colGroups.set(dot.x, []);
        colGroups.get(dot.x)!.push(dot);
      });

      // Sort and apply snake pattern
      const sortedCols = Array.from(colGroups.entries()).sort((a, b) => a[0] - b[0]);
      sortedCols.forEach(([, dots], colIndex) => {
        const sortedDots = dots.sort((a, b) => a.y - b.y);
        if (colIndex % 2 === 1) sortedDots.reverse();
        result.set(colIndex, sortedDots.map(d => d.key));
      });
    }

    return result;
  }

  /**
   * Start independent row rhythms - each row plays with its own tempo
   */
  private startIndependentRowRhythms(): void {
    this.clearRowTimeouts();
    this.audioService.ensureRowSpeedVariances(this.gridSize, this.columnCount);

    const groupedDots = this.groupDotsByReadingOrder();
    const currentTime = audioContext.getAudioContext().currentTime;

    groupedDots.forEach((dots, groupIndex) => {
      const rowSpeed = this.audioService.getRowSpeed(groupIndex);
      const rowStartTime = currentTime + (groupIndex * this.audioService.getRowStartOffset());
      this.startSingleRowLoop(dots, groupIndex, rowSpeed, rowStartTime);
    });
  }

  /**
   * Start a single row's timing loop with independent tempo
   */
  private startSingleRowLoop(
    dots: string[],
    rowIndex: number,
    rowSpeed: number,
    startTime: number
  ): void {
    const adjustedInterval = DOT_REPETITION_INTERVAL_S / rowSpeed;

    // Get envelope durations to ensure dots don't overlap
    const attackDuration = this.audioService.getAttackDuration();
    const sustainDuration = this.audioService.getSustainDuration();
    const releaseDuration = this.audioService.getReleaseDuration();
    const envelopeDuration = attackDuration + sustainDuration + releaseDuration;

    // Calculate completion time accounting for the last hit's envelope
    const dotCompletionTime = (this.audioService.getHoldCount() * this.audioService.getRepeatCount() - 1) * adjustedInterval + envelopeDuration;

    // Schedule all dots in this row
    dots.forEach((dotKey, dotIndex) => {
      const staggerOffset = dotIndex * dotCompletionTime;

      for (let repetition = 0; repetition < this.audioService.getRepeatCount(); repetition++) {
        // Calculate gain multiplier with increasing volume (same as main rhythm)
        const baseDb = this.audioService.getBaseDb();
        const dbIncrease = repetition * this.audioService.getDbIncreasePerRepeat();
        const totalDb = baseDb + dbIncrease;
        const gainMultiplier = Math.pow(10, totalDb / 20);

        for (let hold = 0; hold < this.audioService.getHoldCount(); hold++) {
          const activationTime = startTime + staggerOffset +
            (repetition * this.audioService.getHoldCount() + hold) * adjustedInterval;
          this.audioService.activatePoint(dotKey, activationTime, gainMultiplier);
        }
      }
    });

    // Schedule next iteration for this row
    const rowCycleTime = dots.length * dotCompletionTime;
    const timeoutId = window.setTimeout(() => {
      if (this.isPlaying && this.audioService.getIndependentRowsEnabled()) {
        this.startSingleRowLoop(
          dots,
          rowIndex,
          rowSpeed,
          audioContext.getAudioContext().currentTime
        );
      }
    }, rowCycleTime * 1000);

    this.rowLoopTimeoutIds.set(rowIndex, timeoutId);
  }

  /**
   * Clear all independent row timeout loops
   */
  private clearRowTimeouts(): void {
    this.rowLoopTimeoutIds.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    this.rowLoopTimeoutIds.clear();
  }

  private stopAllRhythmsInternalCleanup(): void {
    // Clear loop sequencer timeout (NEW)
    this.stopLoopSequencerInternalCleanup();

    // Clear the main sequence loop timeout
    if (this.loopTimeoutId !== null) {
      clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = null;
    }

    // Clear all independent row timeouts
    this.clearRowTimeouts();

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

  public setSoundMode(mode: SoundMode): void {
    this.audioService.setSoundMode(mode);
    
    // If playing, need to recreate all audio points with new generator type
    if (this.isPlaying && this.activeDotKeys.size > 0) {
      const currentDots = new Set(this.activeDotKeys);
      this.updateDots(currentDots, this.gridSize, this.columnCount);
    }
  }

  public getSoundMode(): SoundMode {
    return this.audioService.getSoundMode();
  }

  // Legacy methods for backwards compatibility
  public setBandpassedNoiseMode(enabled: boolean): void {
    this.audioService.setBandpassedNoiseMode(enabled);
    
    // If playing, need to recreate all audio points with new generator type
    if (this.isPlaying && this.activeDotKeys.size > 0) {
      const currentDots = new Set(this.activeDotKeys);
      this.updateDots(currentDots, this.gridSize, this.columnCount);
    }
  }

  public isBandpassedNoiseMode(): boolean {
    return this.audioService.isBandpassedNoiseMode();
  }

  // Add method to handle distortion gain -- Now delegates to service
  private setDistortionGain(gain: number): void {
    this.audioService.setDistortion(gain); 
  }

  private isContinuousSimultaneousMode(): boolean {
    return !this.audioService.isSubHitPlaybackEnabled();
  }

  private isLoopSequencerMode(): boolean {
    return this.audioService.getLoopSequencerEnabled() &&
           !this.audioService.isSubHitPlaybackEnabled();
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    this.audioService.setBandpassBandwidth(bandwidthOctaves);
  }

  // Legacy method for backward compatibility
  public setBandpassQ(qValue: number): void {
    this.audioService.setBandpassQ(qValue);
  }

  public setRepeatCount(count: number): void {
    this.audioService.setRepeatCount(count);
  }

  public getRepeatCount(): number {
    return this.audioService.getRepeatCount();
  }

  public setDbIncreasePerRepeat(db: number): void {
    this.audioService.setDbIncreasePerRepeat(db);
  }

  public getDbIncreasePerRepeat(): number {
    return this.audioService.getDbIncreasePerRepeat();
  }

  public setBaseDb(db: number): void {
    this.audioService.setBaseDb(db);
  }

  public getBaseDb(): number {
    return this.audioService.getBaseDb();
  }

  public setAttackDuration(seconds: number): void {
    this.audioService.setAttackDuration(seconds);
  }

  public getAttackDuration(): number {
    return this.audioService.getAttackDuration();
  }

  public setSustainDuration(seconds: number): void {
    this.audioService.setSustainDuration(seconds);
  }

  public getSustainDuration(): number {
    return this.audioService.getSustainDuration();
  }

  public setReleaseDuration(seconds: number): void {
    this.audioService.setReleaseDuration(seconds);
  }

  public getReleaseDuration(): number {
    return this.audioService.getReleaseDuration();
  }

  public setSpeed(speed: number): void {
    this.audioService.setSpeed(speed);
  }

  public getSpeed(): number {
    return this.audioService.getSpeed();
  }

  public setReadingDirection(direction: 'horizontal' | 'vertical'): void {
    this.audioService.setReadingDirection(direction);

    // Restart playback with new reading order if currently playing
    if (this.isPlaying && this.activeDotKeys.size > 0) {
      this.stopAllRhythms();
      this.startAllRhythms();
    }
  }

  public getReadingDirection(): 'horizontal' | 'vertical' {
    return this.audioService.getReadingDirection();
  }

  public setHoldCount(count: number): void {
    this.audioService.setHoldCount(count);
  }

  public getHoldCount(): number {
    return this.audioService.getHoldCount();
  }

  public setPositionVolumeEnabled(enabled: boolean): void {
    this.audioService.setPositionVolumeEnabled(enabled);
  }

  public getPositionVolumeEnabled(): boolean {
    return this.audioService.getPositionVolumeEnabled();
  }

  public setPositionVolumeAxis(axis: 'horizontal' | 'vertical'): void {
    this.audioService.setPositionVolumeAxis(axis);
  }

  public getPositionVolumeAxis(): 'horizontal' | 'vertical' {
    return this.audioService.getPositionVolumeAxis();
  }

  public setPositionVolumeReversed(reversed: boolean): void {
    this.audioService.setPositionVolumeReversed(reversed);
  }

  public getPositionVolumeReversed(): boolean {
    return this.audioService.getPositionVolumeReversed();
  }

  public setPositionVolumeMinDb(minDb: number): void {
    this.audioService.setPositionVolumeMinDb(minDb);
  }

  public getPositionVolumeMinDb(): number {
    return this.audioService.getPositionVolumeMinDb();
  }

  public setIndependentRowsEnabled(enabled: boolean): void {
    this.audioService.setIndependentRowsEnabled(enabled);

    // Restart playback if currently playing
    if (this.isPlaying && !this.isContinuousSimultaneousMode()) {
      this.stopAllRhythms();
      this.startAllRhythms();
    }
  }

  public getIndependentRowsEnabled(): boolean {
    return this.audioService.getIndependentRowsEnabled();
  }

  public setRowTempoVariance(variance: number): void {
    this.audioService.setRowTempoVariance(variance);

    // Regenerate variances with new value if independent mode is enabled
    if (this.audioService.getIndependentRowsEnabled()) {
      const readingDirection = this.audioService.getReadingDirection();
      const numGroups = readingDirection === 'horizontal' ? this.gridSize : this.columnCount;
      this.audioService.generateRowSpeedVariances(numGroups);
    }
  }

  public getRowTempoVariance(): number {
    return this.audioService.getRowTempoVariance();
  }

  public setRowStartOffset(offsetMs: number): void {
    this.audioService.setRowStartOffset(offsetMs / 1000);
  }

  public getRowStartOffset(): number {
    return this.audioService.getRowStartOffset() * 1000;
  }

  public regenerateRowTempos(): void {
    if (this.audioService.getIndependentRowsEnabled()) {
      const readingDirection = this.audioService.getReadingDirection();
      const numGroups = readingDirection === 'horizontal' ? this.gridSize : this.columnCount;
      this.audioService.generateRowSpeedVariances(numGroups);

      // Restart if playing
      if (this.isPlaying && !this.isContinuousSimultaneousMode()) {
        this.stopAllRhythms();
        this.startAllRhythms();
      }
    }
  }

  public setFrequencyExtensionRange(octaves: number): void {
    this.audioService.setFrequencyExtensionRange(octaves);
  }

  public getFrequencyExtensionRange(): number {
    return this.audioService.getFrequencyExtensionRange();
  }

  public setAlwaysPlayingEnabled(enabled: boolean): void {
    this.audioService.setAlwaysPlayingEnabled(enabled);

    // Start or stop oscillation based on enabled state, playing state, and mode
    // Only start oscillation in continuous simultaneous mode
    if (this.isPlaying && enabled && this.isContinuousSimultaneousMode()) {
      this.audioService.startAlwaysPlayingOscillation();
    } else {
      this.audioService.stopAlwaysPlayingOscillation();
    }
  }

  public getAlwaysPlayingEnabled(): boolean {
    return this.audioService.getAlwaysPlayingEnabled();
  }

  public setAlwaysPlayingSpeed(speed: number): void {
    this.audioService.setAlwaysPlayingSpeed(speed);
  }

  public getAlwaysPlayingSpeed(): number {
    return this.audioService.getAlwaysPlayingSpeed();
  }

  public setAlwaysPlayingStaggerIntensity(intensity: number): void {
    this.audioService.setAlwaysPlayingStaggerIntensity(intensity);
  }

  public getAlwaysPlayingStaggerIntensity(): number {
    return this.audioService.getAlwaysPlayingStaggerIntensity();
  }

  public setStopbandModeEnabled(enabled: boolean): void {
    this.audioService.setStopbandModeEnabled(enabled);

    // Restart playback if currently in always playing mode
    if (this.isPlaying && this.audioService.getAlwaysPlayingEnabled() && this.isContinuousSimultaneousMode()) {
      if (enabled) {
        // Switch to stopband cycling
        this.audioService.stopAlwaysPlayingOscillation();
        this.startStopbandCycling();
      } else {
        // Switch to always playing oscillation
        this.stopStopbandCycling();
        this.audioService.startAlwaysPlayingOscillation();
      }
    }
  }

  public getStopbandModeEnabled(): boolean {
    return this.audioService.getStopbandModeEnabled();
  }

  public setStopbandIterationTime(timeMs: number): void {
    this.audioService.setStopbandIterationTime(timeMs);

    // Restart stopband cycling if currently active to apply new timing
    if (this.isPlaying && this.audioService.getAlwaysPlayingEnabled() &&
        this.audioService.getStopbandModeEnabled() && this.isContinuousSimultaneousMode()) {
      this.startStopbandCycling();
    }
  }

  public getStopbandIterationTime(): number {
    return this.audioService.getStopbandIterationTime();
  }

  public setStopbandOffDuration(durationMs: number): void {
    this.audioService.setStopbandOffDuration(durationMs);
  }

  public getStopbandOffDuration(): number {
    return this.audioService.getStopbandOffDuration();
  }

  public setStopbandFlashCount(count: number): void {
    this.audioService.setStopbandFlashCount(count);
  }

  public getStopbandFlashCount(): number {
    return this.audioService.getStopbandFlashCount();
  }

  public setStopbandDbReductionPerFlash(db: number): void {
    this.audioService.setStopbandDbReductionPerFlash(db);
  }

  public getStopbandDbReductionPerFlash(): number {
    return this.audioService.getStopbandDbReductionPerFlash();
  }

  public setStopbandManualMode(enabled: boolean): void {
    this.audioService.setStopbandManualMode(enabled);

    // Restart stopband cycling if currently active
    if (this.isPlaying && this.audioService.getAlwaysPlayingEnabled() &&
        this.audioService.getStopbandModeEnabled() && this.isContinuousSimultaneousMode()) {
      this.startStopbandCycling();
    }
  }

  public getStopbandManualMode(): boolean {
    return this.audioService.getStopbandManualMode();
  }

  public setStopbandManualIndex(index: number): void {
    this.audioService.setStopbandManualIndex(index);

    // Restart stopband cycling if currently active in manual mode
    if (this.isPlaying && this.audioService.getAlwaysPlayingEnabled() &&
        this.audioService.getStopbandModeEnabled() && this.audioService.getStopbandManualMode() &&
        this.isContinuousSimultaneousMode()) {
      this.startStopbandCycling();
    }
  }

  public getStopbandManualIndex(): number {
    return this.audioService.getStopbandManualIndex();
  }

  public setLoopSequencerEnabled(enabled: boolean): void {
    this.audioService.setLoopSequencerEnabled(enabled);
    // Restart playback if currently playing
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.setPlaying(true); // Re-trigger mode selection
    }
  }

  public getLoopSequencerEnabled(): boolean {
    return this.audioService.getLoopSequencerEnabled();
  }

  public setLoopDuration(seconds: number): void {
    this.audioService.setLoopDuration(seconds);
    // If playing in loop sequencer mode, restart to apply new timing
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getLoopDuration(): number {
    return this.audioService.getLoopDuration();
  }
}

class SineToneGenerator {
  private ctx: AudioContext;
  private outputGainNode: GainNode;
  private oscillator: OscillatorNode;

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = SINE_TONE_OUTPUT_GAIN_SCALAR;

    // Create oscillator
    this.oscillator = this.ctx.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.value = 440; // Default frequency

    // Connect oscillator to output
    this.oscillator.connect(this.outputGainNode);
    this.oscillator.start(); // Start the oscillator immediately
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setFrequency(frequency: number): void {
    this.oscillator.frequency.value = Math.max(20, Math.min(20000, frequency));
  }

  public dispose(): void {
    try {
      this.oscillator.stop();
    } catch {
      // Oscillator might already be stopped
    }
    this.oscillator.disconnect();
    this.outputGainNode.disconnect();
  }
}

class BandpassedNoiseGenerator {
  private ctx: AudioContext;
  private inputGainNode: GainNode;
  private outputGainNode: GainNode;
  private highpassFilter: BiquadFilterNode;
  private lowpassFilter: BiquadFilterNode;
  private slopingFilter: SlopedPinkNoiseGenerator;
  private currentBandwidthOctaves: number;
  private currentCenterFrequency: number;
  private isHighpassActive: boolean = true;
  private isLowpassActive: boolean = true;

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.inputGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = BANDPASS_NOISE_OUTPUT_GAIN_SCALAR;

    // Create sloping filter with fixed -4.5dB/oct slope
    this.slopingFilter = new SlopedPinkNoiseGenerator(this.ctx);
    this.slopingFilter.setSlope(BANDPASS_NOISE_SLOPE_DB_PER_OCT);

    // Create sharp highpass filter
    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.Q.value = 10; // Sharp filter
    
    // Create sharp lowpass filter
    this.lowpassFilter = this.ctx.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.Q.value = 10; // Sharp filter (will be recalculated based on bandwidth)

    // Initialize bandwidth and center frequency
    this.currentBandwidthOctaves = BANDPASS_BANDWIDTH_OCTAVES;
    this.currentCenterFrequency = 1000; // Default, will be updated based on Y position

    // Connect input to sloping filter
    this.inputGainNode.connect(this.slopingFilter.getInputNode());

    // Initial chain setup with both filters (isHighpassActive and isLowpassActive default to true)
    this.connectFilterChain(true, true);

    // Set initial frequency (which will call updateFilterChain if needed)
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public getInputNode(): GainNode {
    return this.inputGainNode;
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  private calculateQFromBandwidth(bandwidthOctaves: number): number {
    // For a highpass + lowpass combination to approximate a bandpass:
    // Q relates inversely to bandwidth
    const numerator = Math.sqrt(2);
    const denominator = Math.pow(2, bandwidthOctaves / 2) - Math.pow(2, -bandwidthOctaves / 2);
    return Math.max(0.1, Math.min(30, numerator / denominator));
  }

  private disconnectFilterChain(): void {
    this.slopingFilter.getOutputNode().disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
  }

  private connectFilterChain(useHighpass: boolean, useLowpass: boolean): void {
    const slopingOutput = this.slopingFilter.getOutputNode();

    if (useHighpass && useLowpass) {
      // Both: sloping -> highpass -> lowpass -> output
      slopingOutput.connect(this.highpassFilter);
      this.highpassFilter.connect(this.lowpassFilter);
      this.lowpassFilter.connect(this.outputGainNode);
    } else if (useHighpass && !useLowpass) {
      // Highpass only: sloping -> highpass -> output
      slopingOutput.connect(this.highpassFilter);
      this.highpassFilter.connect(this.outputGainNode);
    } else if (!useHighpass && useLowpass) {
      // Lowpass only: sloping -> lowpass -> output
      slopingOutput.connect(this.lowpassFilter);
      this.lowpassFilter.connect(this.outputGainNode);
    } else {
      // No filters: sloping -> output
      slopingOutput.connect(this.outputGainNode);
    }
  }

  private updateFilterChain(lowerEdge: number, upperEdge: number): void {
    const MIN_AUDIBLE = 20;
    const MAX_AUDIBLE = 20000;

    // Determine which filters are needed based on whether edges extend beyond audible range
    const needHighpass = lowerEdge >= MIN_AUDIBLE;
    const needLowpass = upperEdge <= MAX_AUDIBLE;

    // Only rewire if configuration changed
    if (needHighpass !== this.isHighpassActive || needLowpass !== this.isLowpassActive) {
      this.disconnectFilterChain();
      this.connectFilterChain(needHighpass, needLowpass);
      this.isHighpassActive = needHighpass;
      this.isLowpassActive = needLowpass;
    }
  }

  public setBandpassFrequency(frequency: number): void {
    // Store center frequency WITHOUT clamping (allow extended range)
    this.currentCenterFrequency = frequency;

    // Calculate edges WITHOUT clamping
    const halfBandwidth = this.currentBandwidthOctaves / 2;
    const lowerEdge = frequency / Math.pow(2, halfBandwidth);
    const upperEdge = frequency * Math.pow(2, halfBandwidth);

    // Update filter chain based on which filters are needed
    this.updateFilterChain(lowerEdge, upperEdge);

    // Set filter frequencies (clamped to safe Web Audio API values)
    this.highpassFilter.frequency.value = Math.max(20, Math.min(20000, lowerEdge));
    this.lowpassFilter.frequency.value = Math.max(20, Math.min(20000, upperEdge));

    // Calculate and set Q value based on desired bandwidth
    const qValue = this.calculateQFromBandwidth(this.currentBandwidthOctaves);
    this.highpassFilter.Q.value = qValue;
    this.lowpassFilter.Q.value = qValue;
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    // Store new bandwidth
    this.currentBandwidthOctaves = Math.max(0.1, Math.min(10, bandwidthOctaves));

    // Recalculate frequencies with new bandwidth
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public setBandpassQ(q: number): void {
    // Convert Q to approximate bandwidth for backward compatibility
    const qClamped = Math.max(0.1, Math.min(30, q));
    // Approximate inverse: bandwidth ≈ 2 * asinh(sqrt(2) / (2 * q)) / ln(2)
    const approximateBandwidth = 2 * Math.asinh(Math.sqrt(2) / (2 * qClamped)) / Math.log(2);
    this.setBandpassBandwidth(approximateBandwidth);
  }

  public dispose(): void {
    this.slopingFilter.dispose();
    this.inputGainNode.disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
    this.outputGainNode.disconnect();
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
    // Calculate shaping slope relative to the INHERENT PINK NOISE SLOPE.
    // This ensures the generator actively shapes the input pink noise (-3dB/oct)
    // to achieve the absolute targetOverallSlopeDbPerOctave.
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

/**
 * Set sound mode (sloped, bandpassed, or sine)
 */
export function setSoundMode(mode: SoundMode): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setSoundMode(mode);
}

/**
 * Get current sound mode
 */
export function getSoundMode(): SoundMode {
  const player = DotGridAudioPlayer.getInstance();
  return player.getSoundMode();
}

/**
 * Set bandpassed noise mode (true for bandpassed noise, false for sloped noise)
 * @deprecated Use setSoundMode instead
 */
export function setBandpassedNoiseMode(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setBandpassedNoiseMode(enabled);
}

/**
 * Check if bandpassed noise mode is enabled
 * @deprecated Use getSoundMode instead
 */
export function isBandpassedNoiseMode(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.isBandpassedNoiseMode();
}

/**
 * Set the bandwidth (in octaves) for bandpassed noise
 * @param bandwidthOctaves Bandwidth in octaves (default 5.0, range 0.1-10.0)
 */
export function setBandpassBandwidth(bandwidthOctaves: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setBandpassBandwidth(bandwidthOctaves);
}

/**
 * Set the bandwidth using Q value (legacy method)
 * @deprecated Use setBandpassBandwidth with octaves instead
 */
export function setBandpassQ(qValue: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setBandpassQ(qValue);
}

/**
 * Set the number of repeats for each dot
 * @param count Number of repeats (minimum 1)
 */
export function setRepeatCount(count: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setRepeatCount(count);
}

/**
 * Get the current repeat count
 */
export function getRepeatCount(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getRepeatCount();
}

/**
 * Set the dB increase per repeat
 * @param db dB increase per repeat (minimum 0)
 */
export function setDbIncreasePerRepeat(db: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setDbIncreasePerRepeat(db);
}

/**
 * Get the current dB increase per repeat
 */
export function getDbIncreasePerRepeat(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getDbIncreasePerRepeat();
}

/**
 * Set the base dB level (starting volume for first hit)
 * @param db Base dB level (clamped between -60dB and 0dB)
 */
export function setBaseDb(db: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setBaseDb(db);
}

/**
 * Get the current base dB level
 */
export function getBaseDb(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getBaseDb();
}

/**
 * Set the attack duration in seconds
 * @param seconds Attack duration (clamped between 0.001s and 2s)
 */
export function setAttackDuration(seconds: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setAttackDuration(seconds);
}

/**
 * Get the current attack duration
 */
export function getAttackDuration(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getAttackDuration();
}

/**
 * Set the sustain duration in seconds
 * @param seconds Sustain duration (clamped between 0.001s and 5s)
 */
export function setSustainDuration(seconds: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setSustainDuration(seconds);
}

/**
 * Get the current sustain duration
 */
export function getSustainDuration(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getSustainDuration();
}

/**
 * Set the release duration in seconds
 * @param seconds Release duration (clamped between 0.001s and 2s)
 */
export function setReleaseDuration(seconds: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setReleaseDuration(seconds);
}

/**
 * Get the current release duration
 */
export function getReleaseDuration(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getReleaseDuration();
}

/**
 * Set the playback speed
 * @param speed Speed multiplier (1.0 = normal, 2.0 = 2x speed, 0.5 = half speed)
 */
export function setSpeed(speed: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setSpeed(speed);
}

/**
 * Get the current playback speed
 */
export function getSpeed(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getSpeed();
}

/**
 * Set the reading direction for the dot grid
 * @param direction 'horizontal' for left-to-right reading, 'vertical' for top-to-bottom columns
 */
export function setReadingDirection(direction: 'horizontal' | 'vertical'): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setReadingDirection(direction);
}

/**
 * Get the current reading direction
 */
export function getReadingDirection(): 'horizontal' | 'vertical' {
  const player = DotGridAudioPlayer.getInstance();
  return player.getReadingDirection();
}

/**
 * Set the hold count (number of times each dot plays at same volume)
 * @param count Hold count (minimum 1)
 */
export function setHoldCount(count: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setHoldCount(count);
}

/**
 * Get the current hold count
 */
export function getHoldCount(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getHoldCount();
}

/**
 * Enable or disable position-based volume mode
 * @param enabled Whether position-based volume is enabled
 */
export function setPositionVolumeEnabled(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setPositionVolumeEnabled(enabled);
}

/**
 * Get whether position-based volume mode is enabled
 */
export function getPositionVolumeEnabled(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getPositionVolumeEnabled();
}

/**
 * Set which axis controls the volume in position-based volume mode
 * @param axis 'vertical' for up/down volume gradient, 'horizontal' for left/right
 */
export function setPositionVolumeAxis(axis: 'horizontal' | 'vertical'): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setPositionVolumeAxis(axis);
}

/**
 * Get the current position volume axis
 */
export function getPositionVolumeAxis(): 'horizontal' | 'vertical' {
  const player = DotGridAudioPlayer.getInstance();
  return player.getPositionVolumeAxis();
}

/**
 * Set whether to reverse the volume gradient direction
 * @param reversed If true, swaps which side has full volume
 */
export function setPositionVolumeReversed(reversed: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setPositionVolumeReversed(reversed);
}

/**
 * Get whether the volume gradient is reversed
 */
export function getPositionVolumeReversed(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getPositionVolumeReversed();
}

/**
 * Set the minimum volume in dB on the quieter side
 * @param minDb Minimum volume in dB (range: -60 to 0)
 */
export function setPositionVolumeMinDb(minDb: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setPositionVolumeMinDb(minDb);
}

/**
 * Get the current minimum volume in dB
 */
export function getPositionVolumeMinDb(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getPositionVolumeMinDb();
}

/**
 * Enable or disable independent rows mode
 * @param enabled Whether independent rows mode is enabled
 */
export function setIndependentRowsEnabled(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setIndependentRowsEnabled(enabled);
}

/**
 * Get whether independent rows mode is enabled
 */
export function getIndependentRowsEnabled(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getIndependentRowsEnabled();
}

/**
 * Set the tempo variance percentage for independent rows
 * @param variance Tempo variance percentage (range: 5-20, default: 10)
 */
export function setRowTempoVariance(variance: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setRowTempoVariance(variance);
}

/**
 * Get the current tempo variance percentage
 */
export function getRowTempoVariance(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getRowTempoVariance();
}

/**
 * Set the row start offset in milliseconds
 * @param offsetMs Sequential offset between row starts in milliseconds (range: 50-500, default: 200)
 */
export function setRowStartOffset(offsetMs: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setRowStartOffset(offsetMs);
}

/**
 * Get the current row start offset in milliseconds
 */
export function getRowStartOffset(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getRowStartOffset();
}

/**
 * Regenerate random tempo variances for all rows
 */
export function regenerateRowTempos(): void {
  const player = DotGridAudioPlayer.getInstance();
  player.regenerateRowTempos();
}

/**
 * Set how far beyond the audible range the bandpass can extend before filters are disabled
 * @param octaves Extension range in octaves (0 = no extension, both filters always active; higher = allow more extension)
 */
export function setFrequencyExtensionRange(octaves: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setFrequencyExtensionRange(octaves);
}

/**
 * Get the current frequency extension range in octaves
 */
export function getFrequencyExtensionRange(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getFrequencyExtensionRange();
}

/**
 * Enable or disable always playing mode
 * @param enabled Whether always playing mode is enabled
 */
export function setAlwaysPlayingEnabled(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setAlwaysPlayingEnabled(enabled);
}

/**
 * Get whether always playing mode is enabled
 */
export function getAlwaysPlayingEnabled(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getAlwaysPlayingEnabled();
}

/**
 * Set the speed of the always playing oscillation
 * @param speed Speed in Hz (cycles per second), range 0.1 to 10
 */
export function setAlwaysPlayingSpeed(speed: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setAlwaysPlayingSpeed(speed);
}

/**
 * Get the current always playing speed in Hz
 */
export function getAlwaysPlayingSpeed(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getAlwaysPlayingSpeed();
}

/**
 * Set the stagger intensity for always playing mode
 * @param intensity Stagger intensity (0 = no stagger, 1 = max stagger)
 */
export function setAlwaysPlayingStaggerIntensity(intensity: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setAlwaysPlayingStaggerIntensity(intensity);
}

/**
 * Get the current always playing stagger intensity
 */
export function getAlwaysPlayingStaggerIntensity(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getAlwaysPlayingStaggerIntensity();
}

/**
 * Enable or disable stopband mode (inverse sequential - all play except one)
 * @param enabled Whether stopband mode is enabled
 */
export function setStopbandModeEnabled(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandModeEnabled(enabled);
}

/**
 * Get whether stopband mode is enabled
 */
export function getStopbandModeEnabled(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandModeEnabled();
}

/**
 * Set the iteration time for stopband mode (how long each dot is silent)
 * @param timeMs Iteration time in milliseconds (range: 100-5000, default: 750)
 */
export function setStopbandIterationTime(timeMs: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandIterationTime(timeMs);
}

/**
 * Get the current stopband iteration time in milliseconds
 */
export function getStopbandIterationTime(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandIterationTime();
}

/**
 * Set the off duration for stopband mode (how long each dot is silent)
 * @param durationMs Off duration in milliseconds (range: 50-2000, default: 500)
 */
export function setStopbandOffDuration(durationMs: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandOffDuration(durationMs);
}

/**
 * Get the current stopband off duration in milliseconds
 */
export function getStopbandOffDuration(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandOffDuration();
}

/**
 * Set the number of flashes per dot in stopband mode
 * @param count Number of flashes (range: 1-10, default: 4)
 */
export function setStopbandFlashCount(count: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandFlashCount(count);
}

/**
 * Get the current stopband flash count
 */
export function getStopbandFlashCount(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandFlashCount();
}

/**
 * Set the dB reduction per flash in stopband mode
 * @param db dB reduction per flash (range: 0-24, default: 12)
 */
export function setStopbandDbReductionPerFlash(db: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandDbReductionPerFlash(db);
}

/**
 * Get the current stopband dB reduction per flash
 */
export function getStopbandDbReductionPerFlash(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandDbReductionPerFlash();
}

/**
 * Enable or disable manual mode for stopband (true = manually select dot, false = auto-cycle)
 * @param enabled Whether manual mode is enabled
 */
export function setStopbandManualMode(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandManualMode(enabled);
}

/**
 * Get whether stopband manual mode is enabled
 */
export function getStopbandManualMode(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandManualMode();
}

/**
 * Set the manually selected dot index for stopband mode
 * @param index 0-based index of the dot to flash (will be clamped to valid range)
 */
export function setStopbandManualIndex(index: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setStopbandManualIndex(index);
}

/**
 * Get the current manually selected dot index
 */
export function getStopbandManualIndex(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getStopbandManualIndex();
}

/**
 * Enable or disable loop sequencer mode
 * @param enabled Whether loop sequencer mode is enabled
 */
export function setLoopSequencerEnabled(enabled: boolean): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setLoopSequencerEnabled(enabled);
}

/**
 * Get whether loop sequencer mode is enabled
 */
export function getLoopSequencerEnabled(): boolean {
  const player = DotGridAudioPlayer.getInstance();
  return player.getLoopSequencerEnabled();
}

/**
 * Set the loop duration for loop sequencer mode
 * @param seconds Total loop duration in seconds (range: 0.5-60, default: 4)
 */
export function setLoopDuration(seconds: number): void {
  const player = DotGridAudioPlayer.getInstance();
  player.setLoopDuration(seconds);
}

/**
 * Get the current loop duration in seconds
 */
export function getLoopDuration(): number {
  const player = DotGridAudioPlayer.getInstance();
  return player.getLoopDuration();
}

// Export the SoundMode enum for use in UI
export { SoundMode }; 