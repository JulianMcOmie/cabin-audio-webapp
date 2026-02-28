import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
// import { getAudioPlayer } from './audioPlayer';
import { useEQProfileStore } from '../stores';
import { dbToGain, clamp } from '../utils/audioMath';

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

// Constants for Global Staggered Mode (when subHitPlaybackEnabled is true)
const DEFAULT_GLOBAL_STAGGER_ATTACK_S = 0.5; // Attack duration (500ms) - gentle fade in
const DEFAULT_GLOBAL_STAGGER_SUSTAIN_S = 0.5; // Sustain/hold duration (500ms)
const DEFAULT_GLOBAL_STAGGER_RELEASE_S = 0.5; // Release duration (500ms) - gentle fade out

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

// Enum for sound generation modes
enum SoundMode {
  SlopedNoise = 'sloped',
  BandpassedNoise = 'bandpassed',
  SineTone = 'sine'
}

// Voice for polyphonic playback - allows overlapping hits with independent envelopes
interface Voice {
  envelopeGain: GainNode;
  releaseEndTime: number; // When this voice will be free (after release completes)
}

// Number of voices per dot for polyphonic playback
const VOICE_POOL_SIZE = 32; // Allow up to 32 overlapping sounds per dot (supports up to 32x hits)

// Default number of discrete volume levels per dot (quiet to loud progression)
const DEFAULT_VOLUME_STEPS = 4; // 4 volume levels: e.g., -36dB, -24dB, -12dB, 0dB

// Interface for nodes managed by PositionedAudioService
interface PointAudioNodes {
    source: AudioBufferSourceNode;
  mainGain: GainNode;
  volumeLevelGain: GainNode; // Controls volume based on dot's on/off state
    envelopeGain: GainNode; // Legacy single envelope (used for continuous mode)
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
  volumeLevel: number; // 0 = off, 1+ = on
  // Voice pool for polyphonic playback (allows overlapping hits)
  voicePool: Voice[];
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
  private loopSequencerEnabled: boolean = true; // Whether loop sequencer mode is enabled (DEFAULT: ON)
  private loopDuration: number = 4.0; // Total loop duration in seconds (default: 4 seconds)
  private loopSequencerPlayTogether: boolean = false; // Whether all dots play together (true) or cycle through dots (false)

  // Hit mode settings for loop sequencer
  private hitModeRate: number = 24; // Hits per second (default: 24/sec)
  private hitModeAttack: number = 0.010; // Attack time in seconds (default: 10ms - quick but smooth attack)
  private hitModeRelease: number = 0.1; // Release time in seconds (default: 100ms)
  private numberOfHits: number = 16; // Hits per volume level (default: 16) - valid values: 1, 2, 4, 8, 16, 32
  private hitDecayDb: number = 40; // Decay in dB from first to last hit (default: 40dB)
  private volumeLevelRangeDb: number = 12; // Range in dB between volume levels (default: 12dB)
  private interleavedHits: boolean = true; // If true, cycle through all dots at each volume level instead of completing one dot first
  private volumeSteps: number = DEFAULT_VOLUME_STEPS; // Number of volume levels (default: 4)

  // Auto volume cycle settings
  private autoVolumeCycleEnabled: boolean = false; // Whether auto volume cycle is enabled
  private autoVolumeCycleSpeed: number = 2.0; // Cycle duration in seconds (default: 2 seconds)
  private autoVolumeCycleMinDb: number = -36; // Minimum volume in dB (default: -36dB)
  private autoVolumeCycleMaxDb: number = 0; // Maximum volume in dB (default: 0dB)
  private autoVolumeCycleSteps: number = 3; // Number of discrete steps (default: 3)
  private autoVolumeCycleStartTime: number = 0; // Start time for cycling
  private autoVolumeCycleAnimationFrameId: number | null = null; // Animation frame ID for cycling loop

  // Per-cycle volume oscillation settings (changes volume each time all dots have played)
  private perCycleVolumeEnabled: boolean = false; // Whether per-cycle volume oscillation is enabled
  private perCycleVolumeSteps: number = 4; // Number of steps to go from min to max (default: 4 cycles to reach max)
  private perCycleVolumeMinDb: number = -48; // Minimum volume in dB (default: -48dB, near silence)
  private perCycleVolumeMaxDb: number = 0; // Maximum volume in dB (default: 0dB)
  private perCycleVolumeCurrentStep: number = 0; // Current step in the oscillation (0 to steps*2-1 for full oscillation)
  private perCycleVolumeDirection: 1 | -1 = 1; // Direction of oscillation: 1 = ascending, -1 = descending
  private perCycleVolumeRedDotsOnly: boolean = false; // Whether to apply per-cycle volume only to red dots

  // Per-dot volume wave settings (volume oscillates based on dot reading order position)
  private perDotVolumeWaveEnabled: boolean = true; // Default: enabled (replaces per-cycle as primary mode)
  private perDotVolumeWaveCycles: number = 1.0; // Number of volume cycles per full image traversal
  private perDotVolumeWaveMinDb: number = -24; // Minimum volume in dB
  private perDotVolumeWaveMaxDb: number = 0; // Maximum volume in dB
  private perDotVolumeWavePhaseOffset: number = 0; // Current phase offset (radians), advances each cycle
  private perDotVolumeWavePhaseShift: number = 0.25; // Phase shift per cycle (fraction of full cycle, 0-1)

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
    this.currentDistortionGain = clamp(gain, 0, 1);
    this.refreshAllPointGains();
  }

  public setBaseVolumeDb(db: number): void {
    this.currentBaseDbLevel = db;
    this.refreshAllPointGains();
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
    this.baseDb = clamp(db, -60, 0); // Clamp between -60dB and 0dB
  }

  public getBaseDb(): number {
    return this.baseDb;
  }

  public setAttackDuration(seconds: number): void {
    this.attackDuration = clamp(seconds, 0.001, 2); // Clamp between 1ms and 2s
  }

  public getAttackDuration(): number {
    return this.attackDuration;
  }

  public setSustainDuration(seconds: number): void {
    this.sustainDuration = clamp(seconds, 0.001, 5); // Clamp between 1ms and 5s
  }

  public getSustainDuration(): number {
    return this.sustainDuration;
  }

  public setReleaseDuration(seconds: number): void {
    this.releaseDuration = clamp(seconds, 0.001, 2); // Clamp between 1ms and 2s
  }

  public getReleaseDuration(): number {
    return this.releaseDuration;
  }

  public setSpeed(speed: number): void {
    this.speed = clamp(speed, 0.1, 10); // Clamp between 0.1x and 10x
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
    this.positionVolumeMinDb = clamp(minDb, -60, 0); // Clamp between -60dB and 0dB
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
    this.alwaysPlayingSpeed = clamp(speed, 0.1, 10);
  }

  public getAlwaysPlayingSpeed(): number {
    return this.alwaysPlayingSpeed;
  }

  public setAlwaysPlayingStaggerIntensity(intensity: number): void {
    // Clamp between 0 (no stagger) and 1 (max stagger)
    this.alwaysPlayingStaggerIntensity = clamp(intensity, 0, 1);
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
    this.stopbandIterationTimeMs = clamp(timeMs, 100, 5000);
  }

  public getStopbandIterationTime(): number {
    return this.stopbandIterationTimeMs;
  }

  public setStopbandOffDuration(durationMs: number): void {
    // Clamp between 50ms and 2000ms
    this.stopbandOffDurationMs = clamp(durationMs, 50, 2000);
  }

  public getStopbandOffDuration(): number {
    return this.stopbandOffDurationMs;
  }

  public setStopbandFlashCount(count: number): void {
    // Clamp between 1 and 10
    this.stopbandFlashCount = clamp(Math.floor(count), 1, 10);
  }

  public getStopbandFlashCount(): number {
    return this.stopbandFlashCount;
  }

  public setStopbandDbReductionPerFlash(db: number): void {
    // Clamp between 0 and 24dB
    this.stopbandDbReductionPerFlash = clamp(db, 0, 24);
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
    this.loopDuration = clamp(seconds, 0.5, 60); // Clamp 0.5-60 seconds
  }

  public getLoopDuration(): number {
    return this.loopDuration;
  }

  public setLoopSequencerPlayTogether(playTogether: boolean): void {
    this.loopSequencerPlayTogether = playTogether;
  }

  public getLoopSequencerPlayTogether(): boolean {
    return this.loopSequencerPlayTogether;
  }

  // Hit mode methods for loop sequencer
  public setHitModeRate(rate: number): void {
    this.hitModeRate = clamp(rate, 0.1, 200); // Clamp 0.1-200 hits/sec
  }

  public getHitModeRate(): number {
    return this.hitModeRate;
  }

  public setHitModeAttack(time: number): void {
    this.hitModeAttack = clamp(time, 0.001, 2); // Clamp 1ms-2s
  }

  public getHitModeAttack(): number {
    return this.hitModeAttack;
  }

  public setHitModeRelease(time: number): void {
    this.hitModeRelease = clamp(time, 0.001, 5); // Clamp 1ms-5s
  }

  public getHitModeRelease(): number {
    return this.hitModeRelease;
  }

  public setNumberOfHits(count: number): void {
    this.numberOfHits = clamp(Math.round(count), 1, 32); // Clamp 1-32
  }

  public getNumberOfHits(): number {
    return this.numberOfHits;
  }

  public setHitDecay(decayDb: number): void {
    this.hitDecayDb = clamp(decayDb, 0, 80); // Clamp 0-80 dB
  }

  public getHitDecay(): number {
    return this.hitDecayDb;
  }

  public setVolumeLevelRangeDb(rangeDb: number): void {
    this.volumeLevelRangeDb = clamp(rangeDb, 1, 48); // Clamp 1-48 dB
  }

  public getVolumeLevelRangeDb(): number {
    return this.volumeLevelRangeDb;
  }

  public setVolumeSteps(steps: number): void {
    this.volumeSteps = clamp(steps, 1, 8); // Clamp 1-8 steps
  }

  public getVolumeSteps(): number {
    return this.volumeSteps;
  }

  public setInterleavedHits(enabled: boolean): void {
    this.interleavedHits = enabled;
  }

  public getInterleavedHits(): boolean {
    return this.interleavedHits;
  }

  // Auto volume cycle methods
  public setAutoVolumeCycleEnabled(enabled: boolean): void {
    this.autoVolumeCycleEnabled = enabled;
  }

  public getAutoVolumeCycleEnabled(): boolean {
    return this.autoVolumeCycleEnabled;
  }

  public setAutoVolumeCycleSpeed(speed: number): void {
    this.autoVolumeCycleSpeed = clamp(speed, 0.5, 10); // Clamp 0.5-10 seconds
  }

  public getAutoVolumeCycleSpeed(): number {
    return this.autoVolumeCycleSpeed;
  }

  public setAutoVolumeCycleMinDb(db: number): void {
    this.autoVolumeCycleMinDb = clamp(db, -60, 0); // Clamp -60 to 0 dB
  }

  public getAutoVolumeCycleMinDb(): number {
    return this.autoVolumeCycleMinDb;
  }

  public setAutoVolumeCycleMaxDb(db: number): void {
    this.autoVolumeCycleMaxDb = clamp(db, -60, 0); // Clamp -60 to 0 dB
  }

  public getAutoVolumeCycleMaxDb(): number {
    return this.autoVolumeCycleMaxDb;
  }

  public setAutoVolumeCycleSteps(steps: number): void {
    this.autoVolumeCycleSteps = clamp(Math.floor(steps), 2, 10); // Clamp 2-10 steps
  }

  public getAutoVolumeCycleSteps(): number {
    return this.autoVolumeCycleSteps;
  }

  // Per-cycle volume oscillation methods
  public setPerCycleVolumeEnabled(enabled: boolean): void {
    this.perCycleVolumeEnabled = enabled;
    if (enabled) {
      // Reset to starting state when enabled
      this.perCycleVolumeCurrentStep = 0;
      this.perCycleVolumeDirection = 1;
    }
  }

  public getPerCycleVolumeEnabled(): boolean {
    return this.perCycleVolumeEnabled;
  }

  public setPerCycleVolumeSteps(steps: number): void {
    this.perCycleVolumeSteps = clamp(Math.floor(steps), 2, 20); // Clamp 2-20 steps
  }

  public getPerCycleVolumeSteps(): number {
    return this.perCycleVolumeSteps;
  }

  public setPerCycleVolumeMinDb(db: number): void {
    this.perCycleVolumeMinDb = clamp(db, -60, 0); // Clamp -60 to 0 dB
  }

  public getPerCycleVolumeMinDb(): number {
    return this.perCycleVolumeMinDb;
  }

  public setPerCycleVolumeMaxDb(db: number): void {
    this.perCycleVolumeMaxDb = clamp(db, -60, 0); // Clamp -60 to 0 dB
  }

  public getPerCycleVolumeMaxDb(): number {
    return this.perCycleVolumeMaxDb;
  }

  public resetPerCycleVolume(): void {
    this.perCycleVolumeCurrentStep = 0;
    this.perCycleVolumeDirection = 1;
  }

  public setPerCycleVolumeRedDotsOnly(redDotsOnly: boolean): void {
    this.perCycleVolumeRedDotsOnly = redDotsOnly;
  }

  public getPerCycleVolumeRedDotsOnly(): boolean {
    return this.perCycleVolumeRedDotsOnly;
  }

  // Per-dot volume wave methods (volume oscillates based on dot reading order position)
  public setPerDotVolumeWaveEnabled(enabled: boolean): void {
    this.perDotVolumeWaveEnabled = enabled;
  }

  public getPerDotVolumeWaveEnabled(): boolean {
    return this.perDotVolumeWaveEnabled;
  }

  public setPerDotVolumeWaveCycles(cycles: number): void {
    this.perDotVolumeWaveCycles = clamp(cycles, 0.1, 10); // Clamp 0.1-10 cycles
  }

  public getPerDotVolumeWaveCycles(): number {
    return this.perDotVolumeWaveCycles;
  }

  public setPerDotVolumeWaveMinDb(db: number): void {
    this.perDotVolumeWaveMinDb = clamp(db, -60, 0); // Clamp -60 to 0 dB
  }

  public getPerDotVolumeWaveMinDb(): number {
    return this.perDotVolumeWaveMinDb;
  }

  public setPerDotVolumeWaveMaxDb(db: number): void {
    this.perDotVolumeWaveMaxDb = clamp(db, -60, 0); // Clamp -60 to 0 dB
  }

  public getPerDotVolumeWaveMaxDb(): number {
    return this.perDotVolumeWaveMaxDb;
  }

  /**
   * Advance to the next volume step in the per-cycle oscillation.
   * Called once each time all dots have completed a cycle.
   * Returns the current volume multiplier (linear gain).
   */
  public advancePerCycleVolume(): number {
    if (!this.perCycleVolumeEnabled) {
      return 1.0; // No modulation when disabled
    }

    // Calculate the current dB value based on current step
    const minDb = this.perCycleVolumeMinDb;
    const maxDb = this.perCycleVolumeMaxDb;
    const dbRange = maxDb - minDb;
    const stepSize = this.perCycleVolumeSteps > 1 ? dbRange / (this.perCycleVolumeSteps - 1) : 0;
    const currentDb = minDb + (this.perCycleVolumeCurrentStep * stepSize);

    // Convert dB to linear gain
    const volumeMultiplier = dbToGain(currentDb);

    // Advance to next step with direction change at boundaries
    this.perCycleVolumeCurrentStep += this.perCycleVolumeDirection;

    // Check boundaries and reverse direction if needed
    if (this.perCycleVolumeCurrentStep >= this.perCycleVolumeSteps - 1) {
      this.perCycleVolumeCurrentStep = this.perCycleVolumeSteps - 1;
      this.perCycleVolumeDirection = -1;
    } else if (this.perCycleVolumeCurrentStep <= 0) {
      this.perCycleVolumeCurrentStep = 0;
      this.perCycleVolumeDirection = 1;
    }

    return volumeMultiplier;
  }

  /**
   * Get the current per-cycle volume multiplier without advancing.
   * Used when scheduling hits to get the current volume level.
   */
  public getCurrentPerCycleVolumeMultiplier(): number {
    if (!this.perCycleVolumeEnabled) {
      return 1.0;
    }

    const minDb = this.perCycleVolumeMinDb;
    const maxDb = this.perCycleVolumeMaxDb;
    const dbRange = maxDb - minDb;
    const stepSize = this.perCycleVolumeSteps > 1 ? dbRange / (this.perCycleVolumeSteps - 1) : 0;
    const currentDb = minDb + (this.perCycleVolumeCurrentStep * stepSize);

    return dbToGain(currentDb);
  }

  /**
   * Calculate the per-dot volume multiplier based on dot position in reading order.
   * Creates a wave effect where volume oscillates based on position.
   * @param dotIndex The index of the dot in reading order (0-based)
   * @param totalDots Total number of dots being played
   * @returns Linear gain multiplier for this dot
   */
  public getPerDotVolumeWaveMultiplier(dotIndex: number, totalDots: number): number {
    if (!this.perDotVolumeWaveEnabled || totalDots <= 0) {
      return 1.0;
    }

    // Calculate phase based on position in reading order
    // Phase goes from 0 to (cycles * 2π) across all dots, plus the moving phase offset
    const normalizedPosition = dotIndex / totalDots;
    const phase = normalizedPosition * this.perDotVolumeWaveCycles * 2 * Math.PI + this.perDotVolumeWavePhaseOffset;

    // Use cosine for smooth oscillation (starts at max when phase = 0)
    // Map from [-1, 1] to [0, 1]
    const oscillation = (Math.cos(phase) + 1) / 2;

    // Map oscillation to dB range and convert to linear gain
    const minDb = this.perDotVolumeWaveMinDb;
    const maxDb = this.perDotVolumeWaveMaxDb;
    const currentDb = minDb + oscillation * (maxDb - minDb);

    return dbToGain(currentDb);
  }

  /**
   * Advance the phase offset for the per-dot volume wave.
   * Called after each cycle completes to create the "moving wave" effect.
   */
  public advancePerDotVolumeWavePhase(): void {
    // Advance phase by the shift amount (converted to radians)
    this.perDotVolumeWavePhaseOffset += this.perDotVolumeWavePhaseShift * 2 * Math.PI;
    // Keep phase in reasonable range to avoid floating point issues
    if (this.perDotVolumeWavePhaseOffset > 2 * Math.PI) {
      this.perDotVolumeWavePhaseOffset -= 2 * Math.PI;
    }
  }

  public resetPerDotVolumeWavePhase(): void {
    this.perDotVolumeWavePhaseOffset = 0;
  }

  public setPerDotVolumeWavePhaseShift(shift: number): void {
    this.perDotVolumeWavePhaseShift = clamp(shift, 0, 1); // Clamp 0-1
  }

  public getPerDotVolumeWavePhaseShift(): number {
    return this.perDotVolumeWavePhaseShift;
  }

  public isPerDotVolumeWaveEnabled(): boolean {
    return this.perDotVolumeWaveEnabled;
  }

  public startAutoVolumeCycle(): void {
    if (this.autoVolumeCycleAnimationFrameId !== null) {
      cancelAnimationFrame(this.autoVolumeCycleAnimationFrameId);
    }

    this.autoVolumeCycleStartTime = this.ctx.currentTime;
    this.oscillateAutoVolumeCycle();
  }

  public stopAutoVolumeCycle(): void {
    if (this.autoVolumeCycleAnimationFrameId !== null) {
      cancelAnimationFrame(this.autoVolumeCycleAnimationFrameId);
      this.autoVolumeCycleAnimationFrameId = null;
    }
  }

  private oscillateAutoVolumeCycle(): void {
    if (!this.autoVolumeCycleEnabled) {
      return;
    }

    const currentTime = this.ctx.currentTime;
    const elapsedTime = currentTime - this.autoVolumeCycleStartTime;

    // Calculate which step we're on based on elapsed time
    const cycleDuration = this.autoVolumeCycleSpeed; // in seconds
    const progress = (elapsedTime % cycleDuration) / cycleDuration; // 0 to 1
    const currentStep = Math.floor(progress * this.autoVolumeCycleSteps);

    // Calculate the dB value for the current step
    const minDb = this.autoVolumeCycleMinDb;
    const maxDb = this.autoVolumeCycleMaxDb;
    const dbRange = maxDb - minDb;
    const stepSize = this.autoVolumeCycleSteps > 1 ? dbRange / (this.autoVolumeCycleSteps - 1) : 0;
    const currentDb = minDb + (currentStep * stepSize);

    // Convert dB to linear gain
    const volumeMultiplier = dbToGain(currentDb);

    // Apply volume to all active points via their volumeLevelGain node
    this.audioPoints.forEach((point) => {
      // Only modulate dots that are active (volume level > 0)
      if (point.volumeLevel > 0) {
        // Calculate the base gain for the current volume level
        const baseLevelGain = this.calculateVolumeLevelGain(point.volumeLevel);
        // Modulate it by the cycle multiplier
        const finalGain = baseLevelGain * volumeMultiplier;
        point.volumeLevelGain.gain.setValueAtTime(finalGain, currentTime);
      }
    });

    // Schedule next update
    this.autoVolumeCycleAnimationFrameId = requestAnimationFrame(() => {
      this.oscillateAutoVolumeCycle();
    });
  }

  private calculateVolumeLevelGain(level: number): number {
    // 4 volume levels: 0 = off, 1-3 = dB-based gain spread across volumeLevelRangeDb
    if (level <= 0) return 0;
    // Level 3 = 0dB (gain 1.0), Level 1 = -volumeLevelRangeDb dB
    // Spread levels 1, 2, 3 evenly across the range
    const dbFromMax = -this.volumeLevelRangeDb * (3 - level) / 2;
    return dbToGain(dbFromMax);
  }

  public updatePointVolumeLevel(id: string, volumeLevel: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.volumeLevel = volumeLevel;
    const gain = this.calculateVolumeLevelGain(volumeLevel);
    point.volumeLevelGain.gain.setValueAtTime(gain, this.ctx.currentTime);
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
        const volumeMultiplier = dbToGain(dbValue);

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
    this.rowTempoVariance = clamp(variance, 5, 20);
  }

  public getRowTempoVariance(): number {
    return this.rowTempoVariance;
  }

  public setRowStartOffset(offsetSeconds: number): void {
    this.rowStartOffsetSeconds = clamp(offsetSeconds, 0.05, 0.5);
  }

  public getRowStartOffset(): number {
    return this.rowStartOffsetSeconds;
  }

  /**
   * Schedule an envelope trigger for a specific point (for loop sequencer)
   * Applies ADSR envelope without deactivating the point
   * Also sets frequency characteristics based on position
   */
  public schedulePointEnvelope(pointId: string, scheduledTime: number, gainMultiplier: number = 1.0, smoothTransition: boolean = false): void {
    const point = this.audioPoints.get(pointId);
    if (point) {
      // Set frequency characteristics (slope/bandwidth) based on dot position
      this.setMainGainAndSlope(point);
      // Schedule the ADSR envelope
      this._schedulePointActivationSound(point, scheduledTime, gainMultiplier, smoothTransition);
    }
  }

  /**
   * Schedule a simple hit with custom attack/release times
   * Uses voice pool for polyphonic playback - allows overlapping sounds
   */
  public schedulePointHit(pointId: string, scheduledTime: number, attackTime: number, releaseTime: number, peakVolume: number): void {
    const point = this.audioPoints.get(pointId);
    if (!point) return;

    // Set frequency characteristics based on dot position
    this.setMainGainAndSlope(point);

    // Find an available voice from the pool (or steal the oldest one)
    const voice = this.allocateVoice(point.voicePool, scheduledTime);
    const gainParam = voice.envelopeGain.gain;

    // Cancel any previous scheduled values and start fresh
    gainParam.cancelScheduledValues(scheduledTime);

    // Start from silence
    gainParam.setValueAtTime(0, scheduledTime);

    // Attack - fade in
    gainParam.linearRampToValueAtTime(peakVolume, scheduledTime + attackTime);

    // Release - fade out
    gainParam.linearRampToValueAtTime(0, scheduledTime + attackTime + releaseTime);

    // Mark when this voice will be free
    voice.releaseEndTime = scheduledTime + attackTime + releaseTime;
  }

  /**
   * Allocate a voice from the pool for a new hit
   * Returns the first available voice, or steals the oldest one if all are busy
   */
  private allocateVoice(voicePool: Voice[], scheduledTime: number): Voice {
    // First, try to find a voice that's already finished (releaseEndTime < scheduledTime)
    const availableVoice = voicePool.find(v => v.releaseEndTime <= scheduledTime);

    if (availableVoice) {
      return availableVoice;
    }

    // No available voice - steal the one that will finish soonest (oldest)
    let oldestVoice = voicePool[0];
    for (const voice of voicePool) {
      if (voice.releaseEndTime < oldestVoice.releaseEndTime) {
        oldestVoice = voice;
      }
    }
    return oldestVoice;
  }

  private _schedulePointActivationSound(pointNode: PointAudioNodes, scheduledTime: number, gainMultiplier: number = 1.0, smoothTransition: boolean = false): void {
    const gainParam = pointNode.envelopeGain.gain;
    gainParam.cancelScheduledValues(scheduledTime);

    if (this.subHitAdsrEnabled) {
      // Use full ADSR envelope: Attack -> Sustain -> Release
      if (smoothTransition) {
        // Smooth transition mode: smooth volume changes without resetting to silence
        const targetGain = ENVELOPE_MAX_GAIN * 0.8 * gainMultiplier;
        const timeConstant = 0.02; // 20ms time constant for smooth exponential approach

        // Use setTargetAtTime for smooth transition from current value
        gainParam.setTargetAtTime(targetGain, scheduledTime, timeConstant);

        // After sustain duration, lock in the final value
        gainParam.setValueAtTime(targetGain, scheduledTime + this.sustainDuration);
      } else {
        // Normal mode: start from silence
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
      }
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

  public addPoint(id: string, x: number, y: number, totalRows: number, totalCols: number, volumeLevel: number = 3): void {
    if (this.audioPoints.has(id)) {
      console.warn(`Audio point with id ${id} already exists.`);
      return;
    }

    const normalizedY = totalRows <= 1 ? 0.5 : (y / (totalRows - 1));
    const normalizedX = totalCols <= 1 ? 0.5 : (x / (totalCols - 1));
    const panPosition = totalCols <= 1 ? 0 : (2 * normalizedX - 1);

    const mainGain = this.ctx.createGain();
    const volumeLevelGain = this.ctx.createGain();
    volumeLevelGain.gain.value = this.calculateVolumeLevelGain(volumeLevel);
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MAX_GAIN * 0.8; // Start at full volume for continuous play
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

    mainGain.connect(volumeLevelGain);

    // Create voice pool for polyphonic playback (overlapping hits)
    const voicePool: Voice[] = [];
    for (let i = 0; i < VOICE_POOL_SIZE; i++) {
      const voiceEnvelope = this.ctx.createGain();
      voiceEnvelope.gain.value = 0; // Start silent
      volumeLevelGain.connect(voiceEnvelope);
      voiceEnvelope.connect(panner);
      voicePool.push({
        envelopeGain: voiceEnvelope,
        releaseEndTime: 0 // Available immediately
      });
    }

    // Legacy envelope for continuous mode (connected in parallel with voice pool)
    volumeLevelGain.connect(envelopeGain);
    envelopeGain.connect(panner);
    panner.connect(this.outputGain);

    this.audioPoints.set(id, {
      source,
      mainGain,
      volumeLevelGain,
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
      volumeLevel,
      voicePool,
    });
  }

  public addPointNormalized(id: string, normalizedX: number, normalizedY: number, volumeLevel: number = 3): void {
    if (this.audioPoints.has(id)) {
      console.warn(`Audio point with id ${id} already exists.`);
      return;
    }

    const panPosition = 2 * normalizedX - 1;

    const mainGain = this.ctx.createGain();
    const volumeLevelGain = this.ctx.createGain();
    volumeLevelGain.gain.value = this.calculateVolumeLevelGain(volumeLevel);
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MAX_GAIN * 0.8;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panPosition;

    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;
    const pinkNoiseBuffer: AudioBuffer = this._generateSinglePinkNoiseBuffer();

    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;

    if (this.currentSoundMode === SoundMode.BandpassedNoise) {
      source.loop = true;
      bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);
      bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      source.connect(bandpassedNoiseGenerator.getInputNode());
      bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
      source.start();
    } else if (this.currentSoundMode === SoundMode.SineTone) {
      sineToneGenerator = new SineToneGenerator(this.ctx);
      sineToneGenerator.getOutputNode().connect(mainGain);
    } else {
      source.loop = true;
      slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
      source.connect(slopedNoiseGenerator.getInputNode());
      slopedNoiseGenerator.getOutputNode().connect(mainGain);
      source.start();
    }

    mainGain.connect(volumeLevelGain);

    const voicePool: Voice[] = [];
    for (let i = 0; i < VOICE_POOL_SIZE; i++) {
      const voiceEnvelope = this.ctx.createGain();
      voiceEnvelope.gain.value = 0;
      volumeLevelGain.connect(voiceEnvelope);
      voiceEnvelope.connect(panner);
      voicePool.push({
        envelopeGain: voiceEnvelope,
        releaseEndTime: 0
      });
    }

    volumeLevelGain.connect(envelopeGain);
    envelopeGain.connect(panner);
    panner.connect(this.outputGain);

    this.audioPoints.set(id, {
      source,
      mainGain,
      volumeLevelGain,
      envelopeGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      sineToneGenerator,
      pinkNoiseBuffer,
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX,
      subHitCount: 0,
      subHitTimerId: null,
      volumeLevel,
      voicePool,
    });
  }

  public updatePointPosition(id: string, normalizedX: number, normalizedY: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.normalizedXPos = normalizedX;
    point.normalizedYPos = normalizedY;
    point.panner.pan.setValueAtTime(2 * normalizedX - 1, this.ctx.currentTime);
    this.setMainGainAndSlope(point);
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
    point.volumeLevelGain.disconnect();
    point.envelopeGain.disconnect();

    // Disconnect all voice pool envelopes
    for (const voice of point.voicePool) {
      voice.envelopeGain.disconnect();
    }

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

    const now = this.ctx.currentTime;

    // Deactivate legacy envelope by ramping down quickly
    point.envelopeGain.gain.cancelScheduledValues(now);
    const currentGain = Math.max(0.001, point.envelopeGain.gain.value); // Ensure we're above zero for exponential
    point.envelopeGain.gain.setValueAtTime(currentGain, now); // Hold current value
    point.envelopeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.01); // Quick exponential ramp down (10ms)

    // Also silence all voices in the voice pool
    for (const voice of point.voicePool) {
      voice.envelopeGain.gain.cancelScheduledValues(now);
      voice.envelopeGain.gain.setValueAtTime(0, now);
      voice.releaseEndTime = 0; // Mark as available
    }
  }
  
  public deactivateAllPoints(): void {
    this.audioPoints.forEach((_, id) => this.deactivatePoint(id));
  }

  /**
   * Silence only the legacy envelopes without affecting voice pool releases.
   * Used when starting loop sequencer to allow voice pool to control envelope
   * while not cutting off ongoing release tails.
   */
  public silenceLegacyEnvelopes(): void {
    const now = this.ctx.currentTime;
    this.audioPoints.forEach((point) => {
      // Only silence the legacy envelope, leave voice pool envelopes alone
      point.envelopeGain.gain.cancelScheduledValues(now);
      point.envelopeGain.gain.setValueAtTime(0, now);
    });
  }

  public dispose(): void {
    this.stopAlwaysPlayingOscillation();
    this.audioPoints.forEach((point, id) => {
        if (point.subHitTimerId !== null) {
            clearTimeout(point.subHitTimerId);
        }
        this.removePoint(id);
    });
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
      const compensationFreq = clamp(bandpassCenterFreq, 20, 20000);

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

    const gainRatio = dbToGain(finalVolumeDb);
    const effectiveMasterGain = MASTER_GAIN * this.currentDistortionGain * gainRatio;
    point.mainGain.gain.setValueAtTime(effectiveMasterGain, this.ctx.currentTime);
  }

  /**
   * Recompute and apply gain/slope for all active points.
   * This makes volume/distortion changes react immediately instead of waiting
   * for the next dot trigger event.
   */
  private refreshAllPointGains(): void {
    this.audioPoints.forEach((point) => {
      this.setMainGainAndSlope(point);
    });
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
    this.frequencyExtensionRange = clamp(octaves, 0, 5);

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

  // Add method to handle distortion gain -- Now delegates to service
  private setDistortionGain(gain: number): void {
    this.currentDistortionGain = clamp(gain, 0, 1);
  }
}

class DotGridAudioPlayer {
  private static instance: DotGridAudioPlayer;
  private isPlaying: boolean = false;
  private activeDotKeys: Set<string> = new Set();
  private dotVolumeLevels: Map<string, number> = new Map(); // Volume level for each dot (0 = off, 1+ = on)
  private audioService: PositionedAudioService;

  // Red dots state: dots that play less frequently (N of M cycles)
  private redDots: Map<string, { playN: number, ofM: number }> = new Map();
  private currentCycleNumber: number = 0; // Tracks which cycle we're on (0-indexed)

  private loopTimeoutId: number | null = null; // For the main sequence loop
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

  // Cursor play state
  private cursorPlayActive: boolean = false;
  private cursorPlayPointId: string = '__cursor__';
  private cursorPlayTimeoutId: number | null = null;
  private wasPlayingBeforeCursor: boolean = false;

  // Loop sequencer mode state
  private loopSequencerTimeoutId: number | null = null; // For loop sequencer iteration timeout
  private loopSequencerVisualDotKeys: string[] = [];
  private loopSequencerVisualCycleStartTime: number = 0;
  private loopSequencerVisualHitInterval: number = 0;
  private loopSequencerVisualTotalHitsPerDot: number = 1;
  private loopSequencerVisualCycleHits: number = 0;
  private loopSequencerVisualBeatBase: number = 0;
  private loopSequencerVisualNextBeatBase: number = 0;
  private loopSequencerVisualInterleaved: boolean = true;
  private loopSequencerVisualPlayTogether: boolean = false;

  private constructor() {
    this.audioService = new PositionedAudioService(audioContext.getAudioContext());
    
    const { distortionGain: initialDistortionGain, isEQEnabled: initialEQEnabled } = useEQProfileStore.getState();
    this.audioService.setDistortion(initialEQEnabled ? initialDistortionGain : 1.0);

    useEQProfileStore.subscribe(
      (state) => {
        this.audioService.setDistortion(state.isEQEnabled ? state.distortionGain : 1.0);
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
    }
    
    // Update playback if playing
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.startAllRhythms();
    }
  }

  /**
   * Update panning for all dots based on current column count
   * Note: Panning updates now occur when dots are re-added via updateDots after grid size change.
   */
  private updateAllDotPanning(): void {
    // Panning is set when a point is added to PositionedAudioService.
    // The setGridSize -> updateDots flow (which removes/re-adds points) handles panning updates.
  }

  public getLoopSequencerVisualState(): { playingDotKey: string | null; beatIndex: number } {
    if (!this.isPlaying || !this.isLoopSequencerMode() || this.loopSequencerVisualDotKeys.length === 0) {
      return { playingDotKey: null, beatIndex: 0 };
    }

    if (this.loopSequencerVisualHitInterval <= 0 || this.loopSequencerVisualCycleHits <= 0) {
      return { playingDotKey: null, beatIndex: 0 };
    }

    const now = audioContext.getAudioContext().currentTime;
    const elapsed = Math.max(0, now - this.loopSequencerVisualCycleStartTime);
    const rawStep = Math.floor(elapsed / this.loopSequencerVisualHitInterval);
    const clampedStep = Math.min(this.loopSequencerVisualCycleHits - 1, rawStep);
    const beatIndex = this.loopSequencerVisualBeatBase + clampedStep;

    let dotIndex = 0;
    if (this.loopSequencerVisualPlayTogether || this.loopSequencerVisualInterleaved) {
      dotIndex = clampedStep % this.loopSequencerVisualDotKeys.length;
    } else {
      dotIndex = Math.min(
        this.loopSequencerVisualDotKeys.length - 1,
        Math.floor(clampedStep / this.loopSequencerVisualTotalHitsPerDot)
      );
    }

    return {
      playingDotKey: this.loopSequencerVisualDotKeys[dotIndex] ?? null,
      beatIndex,
    };
  }

  private resetLoopSequencerVisualState(): void {
    this.loopSequencerVisualDotKeys = [];
    this.loopSequencerVisualCycleStartTime = 0;
    this.loopSequencerVisualHitInterval = 0;
    this.loopSequencerVisualTotalHitsPerDot = 1;
    this.loopSequencerVisualCycleHits = 0;
    this.loopSequencerVisualBeatBase = 0;
    this.loopSequencerVisualNextBeatBase = 0;
    this.loopSequencerVisualInterleaved = true;
    this.loopSequencerVisualPlayTogether = false;
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
            const volumeLevel = this.dotVolumeLevels.get(dotKey) ?? 3; // Default to full volume
            this.audioService.addPoint(dotKey, x, y, this.gridSize, this.columnCount, volumeLevel);
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
   * Update volume level for a specific dot
   * @param dotKey The dot key (e.g., "2,3")
   * @param volumeLevel The volume level: 0 = off, 1+ = on
   */
  public updateDotVolumeLevel(dotKey: string, volumeLevel: number): void {
    this.dotVolumeLevels.set(dotKey, volumeLevel);
    this.audioService.updatePointVolumeLevel(dotKey, volumeLevel);
  }

  /**
   * Get volume level for a specific dot
   * @param dotKey The dot key (e.g., "2,3")
   * @returns The volume level (0 = off, 1+ = on)
   */
  public getDotVolumeLevel(dotKey: string): number {
    return this.dotVolumeLevels.get(dotKey) ?? 1;
  }

  /**
   * Update red dots configuration
   * @param redDots Map of dot keys to their play frequency settings
   */
  public updateRedDots(redDots: Map<string, { playN: number, ofM: number }>): void {
    this.redDots = new Map(redDots);
  }

  /**
   * Check if a red dot should play on the current cycle
   * @param dotKey The dot key to check
   * @returns true if the dot should play, false if it should be skipped
   */
  public shouldRedDotPlay(dotKey: string): boolean {
    const redDotConfig = this.redDots.get(dotKey);
    if (!redDotConfig) {
      // Not a red dot, always plays
      return true;
    }

    const { playN, ofM } = redDotConfig;
    // Play on cycles 0, 1, ..., (playN-1) out of every ofM cycles
    const cycleInPeriod = this.currentCycleNumber % ofM;
    return cycleInPeriod < playN;
  }

  /**
   * Advance the cycle counter (called after each full cycle completes)
   */
  public advanceCycleCounter(): void {
    this.currentCycleNumber++;
  }

  /**
   * Reset the cycle counter (called when playback stops/starts)
   */
  public resetCycleCounter(): void {
    this.currentCycleNumber = 0;
  }

  /**
   * Get current cycle number
   */
  public getCurrentCycleNumber(): number {
    return this.currentCycleNumber;
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
    const volumeMultiplier = dbToGain(-totalDbReduction);
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
      // Horizontal reading order: left-to-right, top-to-bottom (row 0 = bottom, so descending)
      const rowGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!rowGroups.has(dot.y)) rowGroups.set(dot.y, []);
        rowGroups.get(dot.y)!.push(dot);
      });

      const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => b[0] - a[0]);
      sortedDotKeys = sortedRows.flatMap(([, dots]) => {
        const sortedDots = dots.sort((a, b) => a.x - b.x);
        return sortedDots.map(d => d.key);
      });
    } else {
      // Vertical reading order: top-to-bottom, left-to-right (descending Y within each column)
      const colGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!colGroups.has(dot.x)) colGroups.set(dot.x, []);
        colGroups.get(dot.x)!.push(dot);
      });

      const sortedCols = Array.from(colGroups.entries()).sort((a, b) => a[0] - b[0]);
      sortedDotKeys = sortedCols.flatMap(([, dots]) => {
        const sortedDots = dots.sort((a, b) => b.y - a.y);
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
      // Reset cycle counter when starting playback
      this.resetCycleCounter();
      this.resetLoopSequencerVisualState();

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

        // Start auto volume cycle if enabled
        if (this.audioService.getAutoVolumeCycleEnabled()) {
          this.audioService.startAutoVolumeCycle();
        }
      }
      // EXISTING: Sequential sub-hit mode
      else {
        this.stopLoopSequencerInternalCleanup(); // NEW - Clear loop sequencer
        this.startAllRhythms();
      }
    } else {
      this.audioService.stopAlwaysPlayingOscillation();
      this.audioService.stopAutoVolumeCycle();
      this.stopStopbandCycling();
      this.stopLoopSequencer(); // NEW
      this.stopAllRhythms();
      this.resetLoopSequencerVisualState();
    }
  }

  /**
   * Start loop sequencer mode - evenly spaced dots with envelope triggering
   */
  private startLoopSequencer(): void {
    this.stopLoopSequencerInternalCleanup();

    if (!this.isPlaying || this.activeDotKeys.size === 0) {
      this.resetLoopSequencerVisualState();
      return;
    }

    // Deactivate all points before scheduling new envelopes
    this.audioService.deactivateAllPoints();

    // Sort dots by reading order
    const sortedDotKeys = this.sortDotsByReadingOrder();
    const dotCount = sortedDotKeys.length;
    const playableDots = sortedDotKeys.filter(dotKey => this.shouldRedDotPlay(dotKey));

    // Get hit mode parameters
    const hitRate = this.audioService.getHitModeRate(); // hits per second
    const attackTime = this.audioService.getHitModeAttack();
    const releaseTime = this.audioService.getHitModeRelease();
    const hitsPerVolumeLevel = this.audioService.getNumberOfHits(); // Number of hits at EACH volume level
    const hitDecayDb = this.audioService.getHitDecay(); // Total dB range from quietest to loudest
    const volumeSteps = this.audioService.getVolumeSteps(); // Number of volume levels

    // Get per-cycle volume multiplier (advances after this cycle completes)
    const perCycleVolumeMultiplier = this.audioService.getCurrentPerCycleVolumeMultiplier();
    const perCycleVolumeRedDotsOnly = this.audioService.getPerCycleVolumeRedDotsOnly();

    // Calculate time between hits
    const hitInterval = 1 / hitRate; // seconds between hits
    const currentTime = audioContext.getAudioContext().currentTime;

    // Check if per-dot volume wave is enabled
    const perDotWaveEnabled = this.audioService.isPerDotVolumeWaveEnabled();

    // Total hits per dot = volumeSteps × hitsPerVolumeLevel
    const totalHitsPerDot = volumeSteps * hitsPerVolumeLevel;

    // Helper function to calculate volume for a specific volume step
    // volumeStep 0 = quietest (-hitDecayDb), volumeStep volumeSteps-1 = loudest (0dB)
    const calculateStepVolume = (baseVolume: number, volumeStep: number): number => {
      if (volumeSteps <= 1) {
        return baseVolume; // Single step at full volume
      }
      // Linear interpolation in dB: first step at -hitDecayDb, last step at 0
      const stepVolumeDb = -hitDecayDb * (1 - volumeStep / (volumeSteps - 1));
      const stepVolumeMultiplier = dbToGain(stepVolumeDb);
      return baseVolume * stepVolumeMultiplier;
    };

    // Schedule hits for all dots in this loop cycle
    if (this.audioService.getLoopSequencerPlayTogether()) {
      // Play all dots together mode: all dots hit simultaneously at each volume level
      // For each volume step, hit all dots hitsPerVolumeLevel times
      for (let volumeStep = 0; volumeStep < volumeSteps; volumeStep++) {
        for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
          sortedDotKeys.forEach((dotKey, index) => {
            // Skip red dots that shouldn't play on this cycle
            if (!this.shouldRedDotPlay(dotKey)) {
              return;
            }
            // Check if this dot is red
            const isRedDot = this.redDots.has(dotKey);
            // Apply per-cycle volume only to red dots if that option is enabled
            const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
            const basePeakVolume = effectivePerCycleMultiplier;
            // Apply per-dot volume wave if enabled
            const perDotMultiplier = perDotWaveEnabled
              ? this.audioService.getPerDotVolumeWaveMultiplier(index, dotCount)
              : 1.0;
            const peakVolume = calculateStepVolume(basePeakVolume * perDotMultiplier, volumeStep);
            const hitTime = currentTime + (volumeStep * hitsPerVolumeLevel + hit) * hitInterval;
            this.audioService.schedulePointHit(dotKey, hitTime, attackTime, releaseTime, peakVolume);
          });
        }
      }
    } else if (this.audioService.getInterleavedHits()) {
      // Interleaved mode: at each volume level, alternate between dots on each hit
      // Pattern: D1@V1, D2@V1, D1@V1, D2@V1... (hitsPerVolumeLevel cycles), then V2, etc.
      const playableDotCount = playableDots.length;

      if (playableDotCount > 0) {
        for (let volumeStep = 0; volumeStep < volumeSteps; volumeStep++) {
          for (let hitCycle = 0; hitCycle < hitsPerVolumeLevel; hitCycle++) {
            playableDots.forEach((dotKey, dotIndex) => {
              // Check if this dot is red
              const isRedDot = this.redDots.has(dotKey);
              // Apply per-cycle volume only to red dots if that option is enabled
              const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
              const basePeakVolume = effectivePerCycleMultiplier;
              // Apply per-dot volume wave if enabled
              const perDotMultiplier = perDotWaveEnabled
                ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, playableDotCount)
                : 1.0;
              const peakVolume = calculateStepVolume(basePeakVolume * perDotMultiplier, volumeStep);
              // Position: volumeStep * (hitsPerVolumeLevel * dotCount) + hitCycle * dotCount + dotIndex
              const hitTime = currentTime + (volumeStep * hitsPerVolumeLevel * playableDotCount + hitCycle * playableDotCount + dotIndex) * hitInterval;
              this.audioService.schedulePointHit(dotKey, hitTime, attackTime, releaseTime, peakVolume);
            });
          }
        }
      }
    } else {
      // Non-interleaved mode: each dot completes ALL its hits before moving to the next dot
      sortedDotKeys.forEach((dotKey, dotIndex) => {
        // Skip red dots that shouldn't play on this cycle
        if (!this.shouldRedDotPlay(dotKey)) {
          return;
        }
        // Check if this dot is red
        const isRedDot = this.redDots.has(dotKey);
        // Apply per-cycle volume only to red dots if that option is enabled
        const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
        const basePeakVolume = effectivePerCycleMultiplier;
        // Apply per-dot volume wave if enabled
        const perDotMultiplier = perDotWaveEnabled
          ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotCount)
          : 1.0;

        // Schedule all hits for this dot: for each volume step, hit hitsPerVolumeLevel times
        for (let volumeStep = 0; volumeStep < volumeSteps; volumeStep++) {
          const peakVolume = calculateStepVolume(basePeakVolume * perDotMultiplier, volumeStep);
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            // Position in sequence: dotIndex * totalHitsPerDot + volumeStep * hitsPerVolumeLevel + hit
            const hitTime = currentTime + (dotIndex * totalHitsPerDot + volumeStep * hitsPerVolumeLevel + hit) * hitInterval;
            this.audioService.schedulePointHit(dotKey, hitTime, attackTime, releaseTime, peakVolume);
          }
        }
      });
    }

    // Advance per-cycle volume for the next cycle
    this.audioService.advancePerCycleVolume();

    // Advance per-dot volume wave phase for the "moving wave" effect
    this.audioService.advancePerDotVolumeWavePhase();

    // Advance cycle counter for red dot scheduling
    this.advanceCycleCounter();

    // Calculate loop duration based on hit rate, dot count, and total hits per dot
    // For interleaved mode, we need to count playable dots
    const playableDotCount = sortedDotKeys.filter(dotKey => this.shouldRedDotPlay(dotKey)).length;
    const effectiveDotCount = playableDotCount > 0 ? playableDotCount : 1;

    let loopDuration: number;
    if (this.audioService.getLoopSequencerPlayTogether()) {
      loopDuration = hitInterval * totalHitsPerDot; // All dots together
    } else if (this.audioService.getInterleavedHits()) {
      // Interleaved: totalHitsPerDot * dotCount total hits (dots cycle within each volume level)
      loopDuration = totalHitsPerDot * effectiveDotCount * hitInterval;
    } else {
      // Non-interleaved: same total, but organized differently
      loopDuration = effectiveDotCount * totalHitsPerDot * hitInterval;
    }

    const loopDelayMs = loopDuration * 1000;
    this.loopSequencerVisualDotKeys = playableDots;
    this.loopSequencerVisualCycleStartTime = currentTime;
    this.loopSequencerVisualHitInterval = hitInterval;
    this.loopSequencerVisualTotalHitsPerDot = totalHitsPerDot;
    this.loopSequencerVisualCycleHits = Math.max(1, Math.round(loopDuration / hitInterval));
    this.loopSequencerVisualBeatBase = this.loopSequencerVisualNextBeatBase;
    this.loopSequencerVisualNextBeatBase = this.loopSequencerVisualBeatBase + this.loopSequencerVisualCycleHits;
    this.loopSequencerVisualInterleaved = this.audioService.getInterleavedHits();
    this.loopSequencerVisualPlayTogether = this.audioService.getLoopSequencerPlayTogether();

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
    this.resetLoopSequencerVisualState();
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
   * Start cursor play mode — creates an audio point at the cursor position
   * and begins a hit loop. Pauses normal sequencer playback.
   */
  public startCursorPlay(normalizedX: number, normalizedY: number): void {
    if (this.cursorPlayActive) return;

    this.wasPlayingBeforeCursor = this.isPlaying;

    // Pause normal sequencer without deactivating — we just stop scheduling new hits
    this.stopLoopSequencerInternalCleanup();
    this.audioService.deactivateAllPoints();

    // Create cursor audio point
    this.audioService.addPointNormalized(this.cursorPlayPointId, normalizedX, normalizedY);
    this.cursorPlayActive = true;

    // Start the cursor hit loop
    this.scheduleCursorHit();
  }

  /**
   * Update cursor position during cursor play
   */
  public updateCursorPosition(normalizedX: number, normalizedY: number): void {
    if (!this.cursorPlayActive) return;
    this.audioService.updatePointPosition(this.cursorPlayPointId, normalizedX, normalizedY);
  }

  /**
   * Stop cursor play mode — removes cursor audio point and resumes normal playback
   */
  public stopCursorPlay(): void {
    if (!this.cursorPlayActive) return;

    // Clear cursor hit timeout
    if (this.cursorPlayTimeoutId !== null) {
      clearTimeout(this.cursorPlayTimeoutId);
      this.cursorPlayTimeoutId = null;
    }

    this.cursorPlayActive = false;

    // Remove cursor audio point
    this.audioService.removePoint(this.cursorPlayPointId);

    // Resume normal playback if it was playing before and there are active dots
    if (this.wasPlayingBeforeCursor && this.activeDotKeys.size > 0 && this.isLoopSequencerMode()) {
      this.startLoopSequencer();
    }
  }

  /**
   * Schedule a single cursor hit and recurse
   */
  private scheduleCursorHit(): void {
    if (!this.cursorPlayActive) return;

    const hitRate = this.audioService.getHitModeRate();
    const attackTime = this.audioService.getHitModeAttack();
    const releaseTime = this.audioService.getHitModeRelease();
    const hitInterval = 1 / hitRate;

    const currentTime = audioContext.getAudioContext().currentTime;
    this.audioService.schedulePointHit(this.cursorPlayPointId, currentTime, attackTime, releaseTime, 1.0);

    this.cursorPlayTimeoutId = window.setTimeout(() => {
      this.scheduleCursorHit();
    }, hitInterval * 1000);
  }

  /**
   * Sort dots by reading order
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

    // Sort by reading direction (row 0 = bottom of grid, so descending Y = top-to-bottom)
    if (readingDirection === 'horizontal') {
      // Horizontal reading order: left-to-right, top-to-bottom
      parsedDots.sort((a, b) => {
        const rowDiff = b.y - a.y;
        if (rowDiff !== 0) return rowDiff;
        return a.x - b.x;
      });
    } else {
      // Vertical reading order: top-to-bottom, left-to-right
      parsedDots.sort((a, b) => {
        const colDiff = a.x - b.x;
        if (colDiff !== 0) return colDiff;
        return b.y - a.y;
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

    const sortedDotKeys = this.sortDotsByReadingOrder();

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
        const gainMultiplier = dbToGain(totalDb); // Convert dB to linear gain

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

      // Sort rows top-to-bottom (descending Y), dots left-to-right within each row
      const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => b[0] - a[0]);
      sortedRows.forEach(([, dots], rowIndex) => {
        const sortedDots = dots.sort((a, b) => a.x - b.x);
        result.set(rowIndex, sortedDots.map(d => d.key));
      });
    } else {
      // Group by column (x coordinate)
      const colGroups = new Map<number, typeof parsedDots>();
      parsedDots.forEach(dot => {
        if (!colGroups.has(dot.x)) colGroups.set(dot.x, []);
        colGroups.get(dot.x)!.push(dot);
      });

      // Sort columns left-to-right, dots top-to-bottom (descending Y) within each column
      const sortedCols = Array.from(colGroups.entries()).sort((a, b) => a[0] - b[0]);
      sortedCols.forEach(([, dots], colIndex) => {
        const sortedDots = dots.sort((a, b) => b.y - a.y);
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
        const gainMultiplier = dbToGain(totalDb);

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

  public setLoopSequencerPlayTogether(playTogether: boolean): void {
    this.audioService.setLoopSequencerPlayTogether(playTogether);
    // If playing in loop sequencer mode, restart to apply new mode
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getLoopSequencerPlayTogether(): boolean {
    return this.audioService.getLoopSequencerPlayTogether();
  }

  // Hit mode methods for loop sequencer
  public setHitModeRate(rate: number): void {
    this.audioService.setHitModeRate(rate);
    // If playing in loop sequencer mode, restart to apply new timing
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getHitModeRate(): number {
    return this.audioService.getHitModeRate();
  }

  public setHitModeAttack(time: number): void {
    this.audioService.setHitModeAttack(time);
  }

  public getHitModeAttack(): number {
    return this.audioService.getHitModeAttack();
  }

  public setHitModeRelease(time: number): void {
    this.audioService.setHitModeRelease(time);
  }

  public getHitModeRelease(): number {
    return this.audioService.getHitModeRelease();
  }

  public setNumberOfHits(count: number): void {
    this.audioService.setNumberOfHits(count);
  }

  public getNumberOfHits(): number {
    return this.audioService.getNumberOfHits();
  }

  public setHitDecay(decayDb: number): void {
    this.audioService.setHitDecay(decayDb);
  }

  public getHitDecay(): number {
    return this.audioService.getHitDecay();
  }

  public setVolumeLevelRangeDb(rangeDb: number): void {
    this.audioService.setVolumeLevelRangeDb(rangeDb);
  }

  public getVolumeLevelRangeDb(): number {
    return this.audioService.getVolumeLevelRangeDb();
  }

  public setVolumeSteps(steps: number): void {
    this.audioService.setVolumeSteps(steps);
    // Restart loop sequencer if playing to apply new setting
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.startLoopSequencer();
    }
  }

  public getVolumeSteps(): number {
    return this.audioService.getVolumeSteps();
  }

  public setInterleavedHits(enabled: boolean): void {
    this.audioService.setInterleavedHits(enabled);
    // Restart loop sequencer if playing to apply new setting
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.startLoopSequencer();
    }
  }

  public getInterleavedHits(): boolean {
    return this.audioService.getInterleavedHits();
  }

  // Auto volume cycle methods
  public setAutoVolumeCycleEnabled(enabled: boolean): void {
    this.audioService.setAutoVolumeCycleEnabled(enabled);

    // Start or stop auto volume cycling based on enabled state and playing state
    if (this.isPlaying && enabled && this.isContinuousSimultaneousMode()) {
      this.audioService.startAutoVolumeCycle();
    } else {
      this.audioService.stopAutoVolumeCycle();
    }
  }

  public getAutoVolumeCycleEnabled(): boolean {
    return this.audioService.getAutoVolumeCycleEnabled();
  }

  public setAutoVolumeCycleSpeed(speed: number): void {
    this.audioService.setAutoVolumeCycleSpeed(speed);
  }

  public getAutoVolumeCycleSpeed(): number {
    return this.audioService.getAutoVolumeCycleSpeed();
  }

  public setAutoVolumeCycleMinDb(db: number): void {
    this.audioService.setAutoVolumeCycleMinDb(db);
  }

  public getAutoVolumeCycleMinDb(): number {
    return this.audioService.getAutoVolumeCycleMinDb();
  }

  public setAutoVolumeCycleMaxDb(db: number): void {
    this.audioService.setAutoVolumeCycleMaxDb(db);
  }

  public getAutoVolumeCycleMaxDb(): number {
    return this.audioService.getAutoVolumeCycleMaxDb();
  }

  public setAutoVolumeCycleSteps(steps: number): void {
    this.audioService.setAutoVolumeCycleSteps(steps);
  }

  public getAutoVolumeCycleSteps(): number {
    return this.audioService.getAutoVolumeCycleSteps();
  }

  // Per-cycle volume oscillation methods
  public setPerCycleVolumeEnabled(enabled: boolean): void {
    this.audioService.setPerCycleVolumeEnabled(enabled);
  }

  public getPerCycleVolumeEnabled(): boolean {
    return this.audioService.getPerCycleVolumeEnabled();
  }

  public setPerCycleVolumeSteps(steps: number): void {
    this.audioService.setPerCycleVolumeSteps(steps);
  }

  public getPerCycleVolumeSteps(): number {
    return this.audioService.getPerCycleVolumeSteps();
  }

  public setPerCycleVolumeMinDb(db: number): void {
    this.audioService.setPerCycleVolumeMinDb(db);
  }

  public getPerCycleVolumeMinDb(): number {
    return this.audioService.getPerCycleVolumeMinDb();
  }

  public setPerCycleVolumeMaxDb(db: number): void {
    this.audioService.setPerCycleVolumeMaxDb(db);
  }

  public getPerCycleVolumeMaxDb(): number {
    return this.audioService.getPerCycleVolumeMaxDb();
  }

  public resetPerCycleVolume(): void {
    this.audioService.resetPerCycleVolume();
  }

  public setPerCycleVolumeRedDotsOnly(redDotsOnly: boolean): void {
    this.audioService.setPerCycleVolumeRedDotsOnly(redDotsOnly);
  }

  public getPerCycleVolumeRedDotsOnly(): boolean {
    return this.audioService.getPerCycleVolumeRedDotsOnly();
  }

  // Per-dot volume wave methods (volume oscillates based on dot reading order position)
  public setPerDotVolumeWaveEnabled(enabled: boolean): void {
    this.audioService.setPerDotVolumeWaveEnabled(enabled);
  }

  public getPerDotVolumeWaveEnabled(): boolean {
    return this.audioService.getPerDotVolumeWaveEnabled();
  }

  public setPerDotVolumeWaveCycles(cycles: number): void {
    this.audioService.setPerDotVolumeWaveCycles(cycles);
  }

  public getPerDotVolumeWaveCycles(): number {
    return this.audioService.getPerDotVolumeWaveCycles();
  }

  public setPerDotVolumeWaveMinDb(db: number): void {
    this.audioService.setPerDotVolumeWaveMinDb(db);
  }

  public getPerDotVolumeWaveMinDb(): number {
    return this.audioService.getPerDotVolumeWaveMinDb();
  }

  public setPerDotVolumeWaveMaxDb(db: number): void {
    this.audioService.setPerDotVolumeWaveMaxDb(db);
  }

  public getPerDotVolumeWaveMaxDb(): number {
    return this.audioService.getPerDotVolumeWaveMaxDb();
  }

  public setPerDotVolumeWavePhaseShift(shift: number): void {
    this.audioService.setPerDotVolumeWavePhaseShift(shift);
  }

  public getPerDotVolumeWavePhaseShift(): number {
    return this.audioService.getPerDotVolumeWavePhaseShift();
  }

  public resetPerDotVolumeWavePhase(): void {
    this.audioService.resetPerDotVolumeWavePhase();
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
    this.oscillator.frequency.value = clamp(frequency, 20, 20000);
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
    const baseQ = numerator / denominator;

    // Multiply by 15 to make filters much sharper (steeper rolloff)
    // This keeps filters from extending too far outside the intended passband
    const sharperQ = baseQ * 15;

    return clamp(sharperQ, 0.7, 100);
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
    this.highpassFilter.frequency.value = clamp(lowerEdge, 20, 20000);
    this.lowpassFilter.frequency.value = clamp(upperEdge, 20, 20000);

    // Calculate and set Q value based on desired bandwidth
    const qValue = this.calculateQFromBandwidth(this.currentBandwidthOctaves);
    this.highpassFilter.Q.value = qValue;
    this.lowpassFilter.Q.value = qValue;
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    // Store new bandwidth
    this.currentBandwidthOctaves = clamp(bandwidthOctaves, 0.1, 10);

    // Recalculate frequencies with new bandwidth
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public setBandpassQ(q: number): void {
    // Convert Q to approximate bandwidth for backward compatibility
    const qClamped = clamp(q, 0.1, 30);
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
      const linearGain = dbToGain(gainDb);
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

// Export the SoundMode enum for use in UI
export { SoundMode }; 
