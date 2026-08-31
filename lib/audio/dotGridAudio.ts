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
const CONTINUOUS_SEQUENCE_RAMP_SECONDS = 0.008;
const DRAG_NOISE_RAMP_SECONDS = 0.012;
const DRAG_NOISE_ID_PREFIX = '__drag_noise__:';

// New constants for dot repetition
const DOT_REPETITION_INTERVAL_S = 0.5; // Interval between hits - 500ms per hit (4 hits = 2 seconds per dot)
const DEFAULT_REPEAT_COUNT = 4; // Default: 4 hits per dot
const DEFAULT_DB_INCREASE_PER_REPEAT = 12; // Default dB increase per repeat (was reduction, now increase)
const DEFAULT_HOLD_COUNT = 1; // Default: play each dot once before moving to next (one-by-one playback)
const DEFAULT_BASE_DB = -48; // Default starting dB level for first hit

// Constants for bandpassed noise generator
const BANDPASS_NOISE_SLOPE_DB_PER_OCT = -4.5; // Fixed slope for bandpassed noise
const BANDPASS_BANDWIDTH_OCTAVES = 6.0; // Default bandwidth: 6 octaves
const BANDPASS_BOTTOM_LOWER_EDGE_HZ = 30; // Lift the lowest dot so the floor does not feel subterranean
const BANDPASS_NOISE_OUTPUT_GAIN_SCALAR = 0.25; // Much louder output for bandpassed noise
const INVERSE_DOT_NOISE_OUTPUT_GAIN_SCALAR = 0.16;
const INVERSE_DOT_MIN_ATTACK_S = 0.05;
// Inverse-dot noise is now full-spectrum noise carved by one parametric-EQ dip
// per dot. At rest each dip sits at a deep cut (the "not-dot" hole); on a hit the
// dip rises via ADSR toward the dot-boost gain, momentarily restoring/emphasizing
// that band. Dots sharing a column live as a series of dips on one noise source,
// so every hole coexists and all dips pulse together.
const INVERSE_DOT_NOTCH_REST_DB = -40;
const INVERSE_DOT_MIN_DIP_WIDTH_OCTAVES = 0.15;
const INVERSE_DOT_MAX_DIP_WIDTH_OCTAVES = 10;
// The dip is a thin, Q-based notch, so it doesn't need the bandpass edge-capping
// that compresses band centers toward the middle. Place it at the pure row
// frequency: bottom row = 30 Hz, top row = 15 kHz (log-mapped over normalized Y).
const INVERSE_DOT_MIN_FREQ_HZ = 30;
const INVERSE_DOT_MAX_FREQ_HZ = 15000;

function getInverseDotDipFrequencyForNormalizedY(normalizedYPos: number): number {
  return INVERSE_DOT_MIN_FREQ_HZ * Math.pow(
    INVERSE_DOT_MAX_FREQ_HZ / INVERSE_DOT_MIN_FREQ_HZ,
    clamp(normalizedYPos, 0, 1)
  );
}

// Convert a target notch/peak width in octaves into a biquad peaking-filter Q.
// Standard audio-EQ relation: BW(oct) = (2 / ln2) * asinh(1 / (2Q)).
function octavesToPeakingQ(bandwidthOctaves: number): number {
  const width = clamp(bandwidthOctaves, INVERSE_DOT_MIN_DIP_WIDTH_OCTAVES, INVERSE_DOT_MAX_DIP_WIDTH_OCTAVES);
  return 1 / (2 * Math.sinh((Math.LN2 / 2) * width));
}
export const DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES = 0.35;
export const MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES = 0;
export const MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES = 10;
export const DEFAULT_INVERSE_DOT_BAND_BOOST_DB = 6;
export const MIN_INVERSE_DOT_BAND_BOOST_DB = -12;
export const MAX_INVERSE_DOT_BAND_BOOST_DB = 24;
const BANDPASS_FILTER_Q = 0.707; // Butterworth-style edge; avoids resonant edge lobes
const NARROW_BANDPASS_FILTER_Q = 0.707;
const MIN_BANDPASS_BANDWIDTH_OCTAVES = 0.25;
const MAX_BANDPASS_BANDWIDTH_OCTAVES = 10;
const LOUD_QUIET_MIN_BANDWIDTH_OCTAVES = 0.75;
export type BandwidthFilterMode = 'wide-tight' | 'narrow-gentle';
export const DEFAULT_BANDWIDTH_FILTER_MODE: BandwidthFilterMode = 'wide-tight';
export const DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT = 6;
export const MIN_GENTLE_EDGE_FALLOFF_DB_PER_OCT = 0;
export const MAX_GENTLE_EDGE_FALLOFF_DB_PER_OCT = 36;
const GENTLE_EDGE_MAX_ATTENUATION_DB = 48;
const HARD_PASSBAND_ATTENUATION_DB = 96;
type PassbandMode = 'off' | 'gentle' | 'hard';
export const DEFAULT_SNARE_SCOOP_DEPTH_DB = 16;
export const MAX_SNARE_SCOOP_DEPTH_DB = 36;
export type SnareScoopMode = 'single' | 'double' | 'triple';
export const DEFAULT_SNARE_SCOOP_MODE: SnareScoopMode = 'single';
export const DEFAULT_SNARE_SCOOP_DEPTH_DB_BY_MODE: Record<SnareScoopMode, number> = {
  single: 16,
  double: 12,
  triple: 10,
};
export const MIN_SNARE_SCOOP_BANDWIDTH_OCTAVES = 0.25;
export const MAX_SNARE_SCOOP_BANDWIDTH_OCTAVES = 6;
export const DEFAULT_SNARE_SCOOP_BANDWIDTH_OCTAVES_BY_MODE: Record<SnareScoopMode, number> = {
  single: 3.1,
  double: 0.9,
  triple: 0.5,
};
const SNARE_WAVE_FILTER_COUNT_BY_MODE: Record<SnareScoopMode, number> = {
  single: 2,
  double: 4,
  triple: 6,
};
const MAX_SNARE_WAVE_FILTERS = 6;
const DEFAULT_TILT_OSCILLATION_AMOUNT = 1.5;
const MAX_TILT_OSCILLATION_AMOUNT = 8;
const ADDITIVE_PARTIAL_COUNT = 96;
const ADDITIVE_PARTIAL_OUTPUT_GAIN_SCALAR = 0.08;
const CLICK_TRAIN_DEFAULT_BOOST_DB = 10;
const CLICK_TRAIN_OUTPUT_GAIN_SCALAR = 0.45 * dbToGain(CLICK_TRAIN_DEFAULT_BOOST_DB);
const CLICK_TRAIN_RATE_HZ = 140;
export const CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT = 1.5;

type PatternAccentEvery = 2 | 4 | 8;
type HalfBandPatternStep = 'bottom' | 'full' | 'top';
type RowAlternationPatternStep = 'top' | 'full' | 'bottom';
const RHYTHM_PATTERN_BEAT_OFFSETS = [
  [0, 2],
  [0, 1, 2, 3],
  [0, 1.5, 3],
] as const;
const RHYTHM_PATTERN_BEAT_COUNT = 4;
const DEFAULT_SHARED_BANDPASS_NOISE_ID = 'default';
const HALF_BAND_PATTERN_SEQUENCE: HalfBandPatternStep[] = ['bottom', 'full', 'top', 'full'];
const ROW_ALTERNATION_PATTERN_SEQUENCE: RowAlternationPatternStep[] = ['top', 'full', 'bottom', 'full'];

function normalizePatternAccentEvery(value: number): PatternAccentEvery {
  return value === 2 || value === 4 || value === 8 ? value : 8;
}

function snareScoopBandwidthToQ(bandwidthOctaves: number): number {
  const bandwidth = clamp(bandwidthOctaves, MIN_SNARE_SCOOP_BANDWIDTH_OCTAVES, MAX_SNARE_SCOOP_BANDWIDTH_OCTAVES);
  const octaveRatio = Math.pow(2, bandwidth);
  return clamp(Math.sqrt(octaveRatio) / (octaveRatio - 1), 0.08, 12);
}

export function getEffectiveBandpassBandwidth(
  bandwidthOctaves: number,
  _filterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE
): number {
  void _filterMode;
  return clamp(bandwidthOctaves, MIN_BANDPASS_BANDWIDTH_OCTAVES, MAX_BANDPASS_BANDWIDTH_OCTAVES);
}

export interface BandpassRange {
  lowerEdge: number;
  upperEdge: number;
  centerFrequency: number;
}

export interface NormalizedAudioPoint {
  normalizedX: number;
  normalizedY: number;
}

export interface NormalizedBandpassRange extends BandpassRange {
  lowerNormalized: number;
  upperNormalized: number;
  bandwidthOctaves: number;
  audioNormalizedY: number;
}

export function getBandpassRangeForNormalizedY(
  normalizedYPos: number,
  bandwidthOctaves: number,
  filterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE,
  frequencyExtensionRange = 0
): BandpassRange {
  const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(bandwidthOctaves, filterMode);
  const extensionMultiplier = Math.pow(2, clamp(frequencyExtensionRange, 0, 5));
  const bottomLowerEdge = BANDPASS_BOTTOM_LOWER_EDGE_HZ / extensionMultiplier;
  const topUpperEdge = MAX_AUDIBLE_FREQ * extensionMultiplier;
  const topLowerEdge = topUpperEdge / Math.pow(2, effectiveBandwidthOctaves);
  const lowerEdge = bottomLowerEdge * Math.pow(topLowerEdge / bottomLowerEdge, clamp(normalizedYPos, 0, 1));
  const upperEdge = lowerEdge * Math.pow(2, effectiveBandwidthOctaves);

  return {
    lowerEdge,
    upperEdge,
    centerFrequency: Math.sqrt(lowerEdge * upperEdge),
  };
}

export function getBandpassRangeForNormalizedBand(
  lowerNormalized: number,
  upperNormalized: number,
  filterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE
): NormalizedBandpassRange {
  const fullRangeOctaves = Math.log2(MAX_AUDIBLE_FREQ / BANDPASS_BOTTOM_LOWER_EDGE_HZ);
  const minHeight = MIN_BANDPASS_BANDWIDTH_OCTAVES / fullRangeOctaves;
  const lower = clamp(Math.min(lowerNormalized, upperNormalized), 0, 1 - minHeight);
  const requestedUpper = clamp(Math.max(lowerNormalized, upperNormalized), lower + minHeight, 1);
  const rawBandwidthOctaves = (requestedUpper - lower) * fullRangeOctaves;
  const bandwidthOctaves = getEffectiveBandpassBandwidth(rawBandwidthOctaves, filterMode);
  const effectiveHeight = bandwidthOctaves / fullRangeOctaves;
  const upper = clamp(lower + effectiveHeight, lower + minHeight, 1);
  const normalizedYDenominator = Math.max(0.000001, 1 - effectiveHeight);
  const audioNormalizedY = clamp(lower / normalizedYDenominator, 0, 1);
  const range = getBandpassRangeForNormalizedY(audioNormalizedY, bandwidthOctaves, filterMode);

  return {
    ...range,
    lowerNormalized: lower,
    upperNormalized: upper,
    bandwidthOctaves,
    audioNormalizedY,
  };
}

function bandpassBandwidthToQ(
  bandwidthOctaves: number,
  filterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE
): number {
  if (filterMode === 'narrow-gentle') {
    return BANDPASS_FILTER_Q;
  }

  const narrowStartOctaves = 2;
  const bandwidth = clamp(bandwidthOctaves, MIN_BANDPASS_BANDWIDTH_OCTAVES, MAX_BANDPASS_BANDWIDTH_OCTAVES);
  const t = clamp(
    (narrowStartOctaves - bandwidth) / (narrowStartOctaves - MIN_BANDPASS_BANDWIDTH_OCTAVES),
    0,
    1
  );
  const eased = t * t * (3 - 2 * t);
  return BANDPASS_FILTER_Q + (NARROW_BANDPASS_FILTER_Q - BANDPASS_FILTER_Q) * eased;
}

function clampGentleEdgeFalloffDbPerOct(dbPerOct: number): number {
  return clamp(
    Number.isFinite(dbPerOct) ? dbPerOct : DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT,
    MIN_GENTLE_EDGE_FALLOFF_DB_PER_OCT,
    MAX_GENTLE_EDGE_FALLOFF_DB_PER_OCT
  );
}

// Constants for sine tone generator
const SINE_TONE_OUTPUT_GAIN_SCALAR = 0.15; // Output gain for sine tones
export const DEFAULT_SINE_BURST_DENSITY = 10;
export const MIN_SINE_BURST_DENSITY = 1;
export const MAX_SINE_BURST_DENSITY = 48;
const SINE_BURST_OUTPUT_GAIN_SCALAR = 0.28;
export const DEFAULT_NOISE_OSCILLATION_RATE_HZ = 2;
export const DEFAULT_NOISE_OSCILLATION_MIN_DB = -48;
export const DEFAULT_NOISE_OSCILLATION_MAX_DB = 0;
export type VolumeOscillationShape = 'sine' | 'hold';
export const DEFAULT_VOLUME_OSCILLATION_SHAPE: VolumeOscillationShape = 'sine';
const VOLUME_OSCILLATION_HOLD_TRANSITION_FRACTION = 0.12;

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Enum for sound generation modes
enum SoundMode {
  SlopedNoise = 'sloped',
  BandpassedNoise = 'bandpassed',
  AdditivePartials = 'additive-partials',
  ClickTrain = 'click-train',
  InverseDotNoise = 'inverse-dot-noise',
  SineTone = 'sine',
  SineBurst = 'sine-burst',
  OscillatingNoise = 'oscillating-noise'
}

// Voice for polyphonic playback - allows overlapping hits with independent envelopes
interface Voice {
  envelopeGain: GainNode;
  releaseEndTime: number; // When this voice will be free (after release completes)
}

interface DelayedCloneOutput {
  delay: DelayNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

// Number of voices per dot for polyphonic playback
const VOICE_POOL_SIZE = 32; // Allow up to 32 overlapping sounds per dot (supports up to 32x hits)

// Default number of discrete volume levels per dot (quiet to loud progression)
const DEFAULT_VOLUME_STEPS = 1; // 1 volume level (single hit at full volume)
const CONSTANT_DOT_ID_PREFIX = '__constant__:';
const SINGLE_LOCATION_TWO_DOT_ID_PREFIX = '__single_location_two_dot__:';
const LINE_CALIBRATION_ID_PREFIX = '__line_calibration__:';
const LINE_PATH_AUDIO_ID = `${LINE_CALIBRATION_ID_PREFIX}path`;
const LINE_CALIBRATION_COPY_DELAY_SECONDS = 0.026;
const LINE_INVERSE_DOT_HIT_INTERVAL_SECONDS = 0.28;
const LINE_INVERSE_DOT_HIT_ATTACK_SECONDS = 0.075;
const LINE_INVERSE_DOT_HIT_RELEASE_SECONDS = 0.06;

// Interface for nodes managed by PositionedAudioService
interface PointAudioNodes {
    source: AudioBufferSourceNode;
  mainGain: GainNode;
  volumeLevelGain: GainNode; // Controls volume based on dot's on/off state
  noiseOscillationGain: GainNode; // Dedicated sustained-noise volume LFO
    envelopeGain: GainNode; // Legacy single envelope (used for continuous mode)
    panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator | null;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator | null;
  inverseDotNoiseGenerator: InverseDotNoiseGenerator | null;
  additivePartialGenerator: AdditivePartialGenerator | null;
  clickTrainGenerator: ClickTrainGenerator | null;
  sineToneGenerator: SineToneGenerator | null;
  sineBurstGenerator: SineBurstGenerator | null;
  pinkNoiseBuffer: AudioBuffer;
  normalizedYPos: number; // To recalculate slope without re-passing y, totalRows
  normalizedXPos: number; // For position-based volume control
  bandwidthOctavesOverride: number | null;
  // New properties for sub-hit sequencing
  subHitCount: number;
  subHitTimerId: number | null;
  volumeLevel: number; // 0 = off, 1+ = on
  volumeDbOffset: number;
  // Voice pool for polyphonic playback (allows overlapping hits)
  voicePool: Voice[];
  delayedCloneOutputs: Map<string, DelayedCloneOutput>;
  // isPlaying: boolean; // Source starts on creation and loops, envelopeGain controls sound
}

interface SharedBandpassNoiseNodes {
  source: AudioBufferSourceNode;
  generator: BandpassedNoiseGenerator;
  gain: GainNode;
  panner: StereoPannerNode;
}

class PositionedAudioService {
  private ctx: AudioContext;
  private audioPoints: Map<string, PointAudioNodes> = new Map();
  private sharedBandpassNoises: Map<string, SharedBandpassNoiseNodes> = new Map();
  private outputGain: GainNode;
  private currentDistortionGain: number = 1.0;
  private currentBaseDbLevel: number = 0;
  private subHitAdsrEnabled: boolean = true; // Renamed from envelopeEnabled
  private subHitPlaybackEnabled: boolean = false; // New: Toggle for sub-hit mechanism - DEFAULT FALSE for continuous mode
  private currentSoundMode: SoundMode = SoundMode.BandpassedNoise; // Current sound generation mode - bandpassed noise by default
  private repeatCount: number = DEFAULT_REPEAT_COUNT; // Number of repeats for each dot
  private dbIncreasePerRepeat: number = DEFAULT_DB_INCREASE_PER_REPEAT; // dB increase per repeat (was reduction)
  private baseDb: number = DEFAULT_BASE_DB; // Starting dB level for first hit
  private holdCount: number = DEFAULT_HOLD_COUNT; // Number of times each dot plays at same volume
  private speed: number = 1.0; // Playback speed multiplier (1.0 = normal speed)
  private attackDuration: number = DEFAULT_GLOBAL_STAGGER_ATTACK_S; // Attack duration in seconds
  private sustainDuration: number = DEFAULT_GLOBAL_STAGGER_SUSTAIN_S; // Sustain/hold duration in seconds
  private releaseDuration: number = DEFAULT_GLOBAL_STAGGER_RELEASE_S; // Release duration in seconds
  private currentBandwidth: number = BANDPASS_BANDWIDTH_OCTAVES; // Current bandwidth in octaves for bandpassed noise
  private currentBandwidthFilterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE;
  private currentGentleEdgeFalloffDbPerOct: number = DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT;
  private currentInverseDotOutsideGapOctaves: number = DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES;
  private currentInverseDotBandBoostDb: number = DEFAULT_INVERSE_DOT_BAND_BOOST_DB;
  private currentBandpassSlope: number = BANDPASS_NOISE_SLOPE_DB_PER_OCT; // dB/oct slope for bandpassed noise
  private currentClickTrainGainMultiplier: number = 5;
  private clickTrainDurationGateEnabled: boolean = false;
  private currentSineBurstDensity: number = DEFAULT_SINE_BURST_DENSITY;
  private noiseOscillationRateHz: number = DEFAULT_NOISE_OSCILLATION_RATE_HZ;
  private noiseOscillationMinDb: number = DEFAULT_NOISE_OSCILLATION_MIN_DB;
  private noiseOscillationMaxDb: number = DEFAULT_NOISE_OSCILLATION_MAX_DB;
  private noiseOscillationStartTime: number = 0;
  private noiseOscillationAnimationFrameId: number | null = null;
  private snareScoopEnabled: boolean = false;
  private snareScoopDepthDb: number = DEFAULT_SNARE_SCOOP_DEPTH_DB;
  private snareScoopMode: SnareScoopMode = DEFAULT_SNARE_SCOOP_MODE;
  private snareScoopBandwidthOctaves: number = DEFAULT_SNARE_SCOOP_BANDWIDTH_OCTAVES_BY_MODE[DEFAULT_SNARE_SCOOP_MODE];
  private bandwidthOscillationEnabled: boolean = false;
  private bandwidthOscillationStepIndex: number = 0;
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
  private positionVolumeLeftDb: number = 0;
  private positionVolumeRightDb: number = 0;

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
  private hitModeRate: number = 24; // Hits per second — controls wave rate (how often each wave of hits happens)
  private hitModeStagger: number = 0.01; // Stagger between dots within a wave in seconds (default: 10ms)
  private hitModeAttack: number = 0.010; // Attack time in seconds (default: 10ms - quick but smooth attack)
  private hitModeRelease: number = 0.1; // Release time in seconds (default: 100ms)
  private numberOfHits: number = 16; // Hits per volume level (default: 16) - valid values: 1, 2, 4, 8, 16, 32
  private hitDecayDb: number = 40; // Decay in dB from first to last hit (default: 40dB)
  private volumeLevelRangeDb: number = 12; // Range in dB between volume levels (default: 12dB)
  private interleavedHits: boolean = true; // If true, cycle through all dots at each volume level instead of completing one dot first
  private volumeSteps: number = DEFAULT_VOLUME_STEPS; // Number of volume levels (default: 4)
  private hiHatModeEnabled: boolean = false; // One-dot accent pattern: loud-quiet-quiet-quiet-quiet-quiet-quiet-quiet

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
    if (this.currentSoundMode === SoundMode.OscillatingNoise && mode !== SoundMode.OscillatingNoise) {
      this.stopNoiseOscillation();
    }
    if (this.currentSoundMode !== mode && mode === SoundMode.OscillatingNoise) {
      this.noiseOscillationStartTime = this.ctx.currentTime;
    }
    this.currentSoundMode = mode;
  }

  public getSoundMode(): SoundMode {
    return this.currentSoundMode;
  }

  public setNoiseOscillationRateHz(rateHz: number): void {
    const now = this.ctx.currentTime;
    const elapsed = Math.max(0, now - this.noiseOscillationStartTime);
    const currentCycles = elapsed * this.noiseOscillationRateHz;
    const nextRate = clamp(rateHz, 0.01, 60);
    this.noiseOscillationRateHz = nextRate;
    this.noiseOscillationStartTime = now - currentCycles / nextRate;
  }

  public setNoiseOscillationBoundsDb(minDb: number, maxDb: number): void {
    const low = Math.min(minDb, maxDb);
    const high = Math.max(minDb, maxDb);
    this.noiseOscillationMinDb = clamp(low, -120, 12);
    this.noiseOscillationMaxDb = clamp(high, -120, 12);
  }

  public getNoiseOscillationMultiplier(scheduledTime: number): number {
    if (this.currentSoundMode !== SoundMode.OscillatingNoise) return 1;
    const elapsed = Math.max(0, scheduledTime - this.noiseOscillationStartTime);
    const phase = elapsed * this.noiseOscillationRateHz * Math.PI * 2 - Math.PI / 2;
    const normalized = 0.5 + 0.5 * Math.sin(phase);
    const db = this.noiseOscillationMinDb + normalized * (this.noiseOscillationMaxDb - this.noiseOscillationMinDb);
    return dbToGain(db);
  }

  public startNoiseOscillation(): void {
    if (this.currentSoundMode !== SoundMode.OscillatingNoise) return;
    this.stopNoiseOscillation();

    const now = this.ctx.currentTime;
    this.noiseOscillationStartTime = now;
    this.audioPoints.forEach((point) => {
      this.setMainGainAndSlope(point);
      point.envelopeGain.gain.cancelScheduledValues(now);
      point.envelopeGain.gain.setValueAtTime(ENVELOPE_MAX_GAIN * 0.8, now);
      point.noiseOscillationGain.gain.cancelScheduledValues(now);
      point.noiseOscillationGain.gain.setValueAtTime(this.getNoiseOscillationMultiplier(now), now);
      point.voicePool.forEach((voice) => {
        voice.envelopeGain.gain.cancelScheduledValues(now);
        voice.envelopeGain.gain.setValueAtTime(0, now);
        voice.releaseEndTime = 0;
      });
    });

    this.oscillateNoiseVolume();
  }

  public stopNoiseOscillation(): void {
    if (this.noiseOscillationAnimationFrameId !== null) {
      cancelAnimationFrame(this.noiseOscillationAnimationFrameId);
      this.noiseOscillationAnimationFrameId = null;
    }
    const now = this.ctx.currentTime;
    this.audioPoints.forEach((point) => {
      point.noiseOscillationGain.gain.cancelScheduledValues(now);
      point.noiseOscillationGain.gain.setValueAtTime(1, now);
    });
  }

  private oscillateNoiseVolume(): void {
    if (this.currentSoundMode !== SoundMode.OscillatingNoise) {
      this.noiseOscillationAnimationFrameId = null;
      return;
    }

    const currentTime = this.ctx.currentTime;
    const targetGain = this.getNoiseOscillationMultiplier(currentTime);
    this.audioPoints.forEach((point) => {
      if (point.volumeLevel <= 0) return;
      point.noiseOscillationGain.gain.cancelScheduledValues(currentTime);
      point.noiseOscillationGain.gain.setValueAtTime(targetGain, currentTime);
    });

    this.noiseOscillationAnimationFrameId = requestAnimationFrame(() => {
      this.oscillateNoiseVolume();
    });
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
    this.refreshAllPointGains();
  }

  public getPositionVolumeEnabled(): boolean {
    return this.isPositionVolumeEnabled;
  }

  public setPositionVolumeAxis(axis: 'horizontal' | 'vertical'): void {
    this.positionVolumeAxis = axis;
    this.refreshAllPointGains();
  }

  public getPositionVolumeAxis(): 'horizontal' | 'vertical' {
    return this.positionVolumeAxis;
  }

  public setPositionVolumeReversed(reversed: boolean): void {
    this.positionVolumeReversed = reversed;
    this.refreshAllPointGains();
  }

  public getPositionVolumeReversed(): boolean {
    return this.positionVolumeReversed;
  }

  public setPositionVolumeMinDb(minDb: number): void {
    this.positionVolumeMinDb = clamp(minDb, -60, 0); // Clamp between -60dB and 0dB
    if (this.positionVolumeReversed) {
      this.positionVolumeLeftDb = 0;
      this.positionVolumeRightDb = this.positionVolumeMinDb;
    } else {
      this.positionVolumeLeftDb = this.positionVolumeMinDb;
      this.positionVolumeRightDb = 0;
    }
    this.refreshAllPointGains();
  }

  public getPositionVolumeMinDb(): number {
    return this.positionVolumeMinDb;
  }

  public setPositionVolumeLeftDb(db: number): void {
    this.positionVolumeLeftDb = clamp(db, -60, 24);
    this.refreshAllPointGains();
  }

  public getPositionVolumeLeftDb(): number {
    return this.positionVolumeLeftDb;
  }

  public setPositionVolumeRightDb(db: number): void {
    this.positionVolumeRightDb = clamp(db, -60, 24);
    this.refreshAllPointGains();
  }

  public getPositionVolumeRightDb(): number {
    return this.positionVolumeRightDb;
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

  public setHitModeStagger(stagger: number): void {
    this.hitModeStagger = Number.isFinite(stagger) ? Math.max(0.001, stagger) : 0.001;
  }

  public getHitModeStagger(): number {
    return this.hitModeStagger;
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
    this.hitDecayDb = clamp(decayDb, 0, 960); // Allow extreme depth-layer separation.
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

  public setHiHatModeEnabled(enabled: boolean): void {
    this.hiHatModeEnabled = enabled;
  }

  public getHiHatModeEnabled(): boolean {
    return this.hiHatModeEnabled;
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
        const finalGain = this.calculatePointVolumeLevelGain(point, volumeMultiplier);
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

  private calculatePointVolumeLevelGain(point: PointAudioNodes, extraGain: number = 1): number {
    return this.calculateVolumeLevelGain(point.volumeLevel) * dbToGain(point.volumeDbOffset) * extraGain;
  }

  public updatePointVolumeLevel(id: string, volumeLevel: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.volumeLevel = volumeLevel;
    const gain = this.calculatePointVolumeLevelGain(point);
    point.volumeLevelGain.gain.setValueAtTime(gain, this.ctx.currentTime);
  }

  public updatePointVolumeDb(id: string, volumeDbOffset: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.volumeDbOffset = clamp(volumeDbOffset, -60, 24);
    point.volumeLevelGain.gain.setValueAtTime(this.calculatePointVolumeLevelGain(point), this.ctx.currentTime);
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

  public activatePointWithGain(
    id: string,
    gain: number,
    rampSeconds: number = 0,
    bandwidthOctaves?: number | null,
    preserveBandpassCenterFrequency = false
  ): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    const currentTime = this.ctx.currentTime;
    if (bandwidthOctaves !== undefined && bandwidthOctaves !== null) {
      this.setMainGainAndSlope(
        point,
        bandwidthOctaves,
        currentTime,
        undefined,
        undefined,
        undefined,
        preserveBandpassCenterFrequency
      );
    }
    point.envelopeGain.gain.cancelScheduledValues(currentTime);

    if (rampSeconds <= 0) {
      point.envelopeGain.gain.setValueAtTime(gain, currentTime);
      return;
    }

    const currentGain = Math.max(0.0001, point.envelopeGain.gain.value);
    point.envelopeGain.gain.setValueAtTime(currentGain, currentTime);
    point.envelopeGain.gain.linearRampToValueAtTime(Math.max(0.0001, gain), currentTime + rampSeconds);
  }

  public schedulePointGain(
    pointId: string,
    scheduledTime: number,
    gain: number,
    bandwidthOctaves?: number | null,
    slopeOffsetDbPerOct?: number | null,
    snareWaveEnabledOverride?: boolean | null,
    snareWavePhaseIndex?: number | null,
    preserveBandpassCenterFrequency = false,
    bandpassRangeOverride?: BandpassRange | null
  ): void {
    const point = this.audioPoints.get(pointId);
    if (!point) return;

    point.panner.pan.setValueAtTime(2 * point.normalizedXPos - 1, scheduledTime);
    this.setMainGainAndSlope(
      point,
      bandwidthOctaves,
      scheduledTime,
      slopeOffsetDbPerOct,
      snareWaveEnabledOverride,
      snareWavePhaseIndex,
      preserveBandpassCenterFrequency,
      bandpassRangeOverride
    );

    point.envelopeGain.gain.cancelScheduledValues(scheduledTime);
    point.envelopeGain.gain.setValueAtTime(Math.max(0, gain), scheduledTime);
  }

  public schedulePointGainOnly(pointId: string, scheduledTime: number, gain: number): void {
    const point = this.audioPoints.get(pointId);
    if (!point) return;

    point.envelopeGain.gain.cancelScheduledValues(scheduledTime);
    point.envelopeGain.gain.setValueAtTime(Math.max(0, gain), scheduledTime);
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
  public schedulePointHit(
    pointId: string,
    scheduledTime: number,
    attackTime: number,
    releaseTime: number,
    peakVolume: number,
    bandwidthOctaves?: number | null,
    slopeOffsetDbPerOct?: number | null,
    snareWaveEnabledOverride?: boolean | null,
    snareWavePhaseIndex?: number | null,
    preserveBandpassCenterFrequency = false,
    bandpassRangeOverride?: BandpassRange | null,
    inverseDotColumnBands?: BandpassRange[] | null
  ): void {
    const point = this.audioPoints.get(pointId);
    if (!point) return;

    // Set frequency characteristics based on dot position. Bandwidth-sequenced
    // hits schedule the matching filter edges on the same audio-clock time.
    point.panner.pan.setValueAtTime(2 * point.normalizedXPos - 1, scheduledTime);
    this.setMainGainAndSlope(
      point,
      bandwidthOctaves,
      scheduledTime,
      slopeOffsetDbPerOct,
      snareWaveEnabledOverride,
      snareWavePhaseIndex,
      preserveBandpassCenterFrequency,
      bandpassRangeOverride,
      inverseDotColumnBands
    );

    if (point.inverseDotNoiseGenerator) {
      // Volume is applied to the fullband as a whole: envelopeGain gates the full
      // noise + every dip together, so the loud/quiet cycle just scales overall
      // level. The dips ride their own (volume-independent) ADSR, so all of this
      // lead's column dots carve/fill the same notches together on each hit.
      const pointGate = point.envelopeGain.gain;
      const sharedPeakGain = ENVELOPE_MAX_GAIN * 0.8 * Math.max(0, peakVolume);
      pointGate.cancelScheduledValues(scheduledTime);
      pointGate.setValueAtTime(sharedPeakGain, scheduledTime);
      point.inverseDotNoiseGenerator.scheduleDotBandHit(scheduledTime, attackTime, releaseTime);
      return;
    }

    // Find an available voice from the pool (or steal the oldest one)
    const voice = this.allocateVoice(point.voicePool, scheduledTime);
    const gainParam = voice.envelopeGain.gain;

    // Cancel any previous scheduled values and start fresh
    gainParam.cancelScheduledValues(scheduledTime);

    if (point.clickTrainGenerator && this.clickTrainDurationGateEnabled) {
      const duration = Math.max(0.001, attackTime + releaseTime);
      gainParam.setValueAtTime(peakVolume, scheduledTime);
      gainParam.setValueAtTime(peakVolume, scheduledTime + duration);
      gainParam.setValueAtTime(0, scheduledTime + duration + 0.0001);
      voice.releaseEndTime = scheduledTime + duration + 0.0001;
      return;
    }

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
    const noiseOscillationGain = this.ctx.createGain();
    noiseOscillationGain.gain.value = 1;
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MAX_GAIN * 0.8; // Start at full volume for continuous play
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panPosition;

    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let inverseDotNoiseGenerator: InverseDotNoiseGenerator | null = null;
    let additivePartialGenerator: AdditivePartialGenerator | null = null;
    let clickTrainGenerator: ClickTrainGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;
    let sineBurstGenerator: SineBurstGenerator | null = null;
    const pinkNoiseBuffer: AudioBuffer = this._generateSinglePinkNoiseBuffer();

    // Always create a source and buffer for consistency (some modes might not use it)
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;

    if (
      this.currentSoundMode === SoundMode.BandpassedNoise ||
      this.currentSoundMode === SoundMode.AdditivePartials ||
      this.currentSoundMode === SoundMode.ClickTrain ||
      this.currentSoundMode === SoundMode.OscillatingNoise
    ) {
      // Use bandpassed noise generator
      bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);

      // Apply current bandwidth and slope settings to the new generator
      bandpassedNoiseGenerator.setBandwidthFilterMode(this.currentBandwidthFilterMode);
      bandpassedNoiseGenerator.setGentleEdgeFalloffDbPerOct(this.currentGentleEdgeFalloffDbPerOct);
      bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      bandpassedNoiseGenerator.setBandpassSlope(this.currentBandpassSlope);
      bandpassedNoiseGenerator.setSnareScoopDepthDb(this.snareScoopDepthDb);
      bandpassedNoiseGenerator.setSnareScoopBandwidthOctaves(this.snareScoopBandwidthOctaves);
      bandpassedNoiseGenerator.setSnareScoopMode(this.snareScoopMode);
      bandpassedNoiseGenerator.setSnareScoopEnabled(this.snareScoopEnabled);

      if (this.currentSoundMode === SoundMode.AdditivePartials) {
        bandpassedNoiseGenerator.setInputSlope(0);
        additivePartialGenerator = new AdditivePartialGenerator(this.ctx);
        additivePartialGenerator.getOutputNode().connect(bandpassedNoiseGenerator.getInputNode());
      } else if (this.currentSoundMode === SoundMode.ClickTrain) {
        bandpassedNoiseGenerator.setInputSlope(CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT);
        clickTrainGenerator = new ClickTrainGenerator(this.ctx, this.currentClickTrainGainMultiplier);
        clickTrainGenerator.getOutputNode().connect(bandpassedNoiseGenerator.getInputNode());
      } else {
        bandpassedNoiseGenerator.setInputSlope(PINK_NOISE_SLOPE_DB_PER_OCT);
        bandpassedNoiseGenerator.setIndependentBandNoiseEnabled(true);
      }

      // Connect chain: source -> bandpassedGen -> mainGain -> envelopeGain -> panner -> serviceOutput
      bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.InverseDotNoise) {
      envelopeGain.gain.value = 0;
      inverseDotNoiseGenerator = new InverseDotNoiseGenerator(this.ctx);
      inverseDotNoiseGenerator.setBandwidthFilterMode(this.currentBandwidthFilterMode);
      inverseDotNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      inverseDotNoiseGenerator.setOutsideGapOctaves(this.currentInverseDotOutsideGapOctaves);
      inverseDotNoiseGenerator.setDotBandBoostDb(this.currentInverseDotBandBoostDb);
      inverseDotNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SineTone) {
      // Use sine tone generator
      sineToneGenerator = new SineToneGenerator(this.ctx);

      // Connect chain: sineGen -> mainGain -> envelopeGain -> panner -> serviceOutput
      sineToneGenerator.getOutputNode().connect(mainGain);

      // Don't start the buffer source for sine tone mode
    } else if (this.currentSoundMode === SoundMode.SineBurst) {
      sineBurstGenerator = new SineBurstGenerator(this.ctx, this.currentSineBurstDensity);
      sineBurstGenerator.getOutputNode().connect(mainGain);
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
    volumeLevelGain.connect(noiseOscillationGain);

    // Create voice pool for polyphonic playback (overlapping hits)
    const voicePool: Voice[] = [];
    for (let i = 0; i < VOICE_POOL_SIZE; i++) {
      const voiceEnvelope = this.ctx.createGain();
      voiceEnvelope.gain.value = 0; // Start silent
      noiseOscillationGain.connect(voiceEnvelope);
      voiceEnvelope.connect(panner);
      voicePool.push({
        envelopeGain: voiceEnvelope,
        releaseEndTime: 0 // Available immediately
      });
    }

    // Legacy envelope for continuous mode (connected in parallel with voice pool)
    noiseOscillationGain.connect(envelopeGain);
    envelopeGain.connect(panner);
    panner.connect(this.outputGain);

    this.audioPoints.set(id, {
      source,
      mainGain,
      volumeLevelGain,
      noiseOscillationGain,
      envelopeGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      inverseDotNoiseGenerator,
      additivePartialGenerator,
      clickTrainGenerator,
      sineToneGenerator,
      sineBurstGenerator,
      pinkNoiseBuffer,
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX,
      bandwidthOctavesOverride: null,
      // Initialize new properties
      subHitCount: 0,
      subHitTimerId: null,
      volumeLevel,
      volumeDbOffset: 0,
      voicePool,
      delayedCloneOutputs: new Map(),
    });

    const point = this.audioPoints.get(id);
    if (point) {
      this.setMainGainAndSlope(point);
    }
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
    const noiseOscillationGain = this.ctx.createGain();
    noiseOscillationGain.gain.value = 1;
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MAX_GAIN * 0.8;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panPosition;

    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let inverseDotNoiseGenerator: InverseDotNoiseGenerator | null = null;
    let additivePartialGenerator: AdditivePartialGenerator | null = null;
    let clickTrainGenerator: ClickTrainGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;
    let sineBurstGenerator: SineBurstGenerator | null = null;
    const pinkNoiseBuffer: AudioBuffer = this._generateSinglePinkNoiseBuffer();

    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;

    if (
      this.currentSoundMode === SoundMode.BandpassedNoise ||
      this.currentSoundMode === SoundMode.AdditivePartials ||
      this.currentSoundMode === SoundMode.ClickTrain ||
      this.currentSoundMode === SoundMode.OscillatingNoise
    ) {
      bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);
      bandpassedNoiseGenerator.setBandwidthFilterMode(this.currentBandwidthFilterMode);
      bandpassedNoiseGenerator.setGentleEdgeFalloffDbPerOct(this.currentGentleEdgeFalloffDbPerOct);
      bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      bandpassedNoiseGenerator.setBandpassSlope(this.currentBandpassSlope);
      bandpassedNoiseGenerator.setSnareScoopDepthDb(this.snareScoopDepthDb);
      bandpassedNoiseGenerator.setSnareScoopBandwidthOctaves(this.snareScoopBandwidthOctaves);
      bandpassedNoiseGenerator.setSnareScoopMode(this.snareScoopMode);
      bandpassedNoiseGenerator.setSnareScoopEnabled(this.snareScoopEnabled);
      if (this.currentSoundMode === SoundMode.AdditivePartials) {
        bandpassedNoiseGenerator.setInputSlope(0);
        additivePartialGenerator = new AdditivePartialGenerator(this.ctx);
        additivePartialGenerator.getOutputNode().connect(bandpassedNoiseGenerator.getInputNode());
      } else if (this.currentSoundMode === SoundMode.ClickTrain) {
        bandpassedNoiseGenerator.setInputSlope(CLICK_TRAIN_INPUT_SLOPE_DB_PER_OCT);
        clickTrainGenerator = new ClickTrainGenerator(this.ctx, this.currentClickTrainGainMultiplier);
        clickTrainGenerator.getOutputNode().connect(bandpassedNoiseGenerator.getInputNode());
      } else {
        bandpassedNoiseGenerator.setInputSlope(PINK_NOISE_SLOPE_DB_PER_OCT);
        bandpassedNoiseGenerator.setIndependentBandNoiseEnabled(true);
      }
      bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.InverseDotNoise) {
      envelopeGain.gain.value = 0;
      inverseDotNoiseGenerator = new InverseDotNoiseGenerator(this.ctx);
      inverseDotNoiseGenerator.setBandwidthFilterMode(this.currentBandwidthFilterMode);
      inverseDotNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      inverseDotNoiseGenerator.setOutsideGapOctaves(this.currentInverseDotOutsideGapOctaves);
      inverseDotNoiseGenerator.setDotBandBoostDb(this.currentInverseDotBandBoostDb);
      inverseDotNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SineTone) {
      sineToneGenerator = new SineToneGenerator(this.ctx);
      sineToneGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SineBurst) {
      sineBurstGenerator = new SineBurstGenerator(this.ctx, this.currentSineBurstDensity);
      sineBurstGenerator.getOutputNode().connect(mainGain);
    } else {
      source.loop = true;
      slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
      source.connect(slopedNoiseGenerator.getInputNode());
      slopedNoiseGenerator.getOutputNode().connect(mainGain);
      source.start();
    }

    mainGain.connect(volumeLevelGain);
    volumeLevelGain.connect(noiseOscillationGain);

    const voicePool: Voice[] = [];
    for (let i = 0; i < VOICE_POOL_SIZE; i++) {
      const voiceEnvelope = this.ctx.createGain();
      voiceEnvelope.gain.value = 0;
      noiseOscillationGain.connect(voiceEnvelope);
      voiceEnvelope.connect(panner);
      voicePool.push({
        envelopeGain: voiceEnvelope,
        releaseEndTime: 0
      });
    }

    noiseOscillationGain.connect(envelopeGain);
    envelopeGain.connect(panner);
    panner.connect(this.outputGain);

    this.audioPoints.set(id, {
      source,
      mainGain,
      volumeLevelGain,
      noiseOscillationGain,
      envelopeGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      inverseDotNoiseGenerator,
      additivePartialGenerator,
      clickTrainGenerator,
      sineToneGenerator,
      sineBurstGenerator,
      pinkNoiseBuffer,
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX,
      bandwidthOctavesOverride: null,
      subHitCount: 0,
      subHitTimerId: null,
      volumeLevel,
      volumeDbOffset: 0,
      voicePool,
      delayedCloneOutputs: new Map(),
    });

    const point = this.audioPoints.get(id);
    if (point) {
      this.setMainGainAndSlope(point);
    }
  }

  public hasPoint(id: string): boolean {
    return this.audioPoints.has(id);
  }

  public updatePointPosition(id: string, normalizedX: number, normalizedY: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.normalizedXPos = normalizedX;
    point.normalizedYPos = normalizedY;
    point.panner.pan.setValueAtTime(2 * normalizedX - 1, this.ctx.currentTime);
    this.setMainGainAndSlope(point);
  }

  public setPointBandpassBandwidth(id: string, bandwidthOctaves: number | null): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.bandwidthOctavesOverride = bandwidthOctaves === null
      ? null
      : getEffectiveBandpassBandwidth(bandwidthOctaves, this.currentBandwidthFilterMode);

    if (point.bandpassedNoiseGenerator || point.inverseDotNoiseGenerator || point.sineBurstGenerator) {
      this.setMainGainAndSlope(point);
    }
  }

  public addOrUpdateDelayedCloneOutput(
    sourceId: string,
    cloneId: string,
    normalizedX: number,
    delaySeconds: number,
    gain: number = 1
  ): void {
    const point = this.audioPoints.get(sourceId);
    if (!point) return;

    const currentTime = this.ctx.currentTime;
    const safeDelay = clamp(delaySeconds, 0, 0.25);
    const panPosition = 2 * clamp(normalizedX, 0, 1) - 1;
    let clone = point.delayedCloneOutputs.get(cloneId);

    if (!clone) {
      const delay = this.ctx.createDelay(0.5);
      const cloneGain = this.ctx.createGain();
      const panner = this.ctx.createStereoPanner();
      delay.delayTime.value = safeDelay;
      cloneGain.gain.value = gain;
      panner.pan.value = panPosition;
      point.envelopeGain.connect(delay);
      delay.connect(cloneGain);
      cloneGain.connect(panner);
      panner.connect(this.outputGain);
      clone = { delay, gain: cloneGain, panner };
      point.delayedCloneOutputs.set(cloneId, clone);
      return;
    }

    clone.delay.delayTime.setValueAtTime(safeDelay, currentTime);
    clone.panner.pan.setValueAtTime(panPosition, currentTime);
    clone.gain.gain.setValueAtTime(gain, currentTime);
  }

  public removeDelayedCloneOutput(sourceId: string, cloneId: string, fadeSeconds: number = 0): void {
    const point = this.audioPoints.get(sourceId);
    const clone = point?.delayedCloneOutputs.get(cloneId);
    if (!point || !clone) return;

    const disconnect = () => {
      try {
        clone.delay.disconnect();
        clone.gain.disconnect();
        clone.panner.disconnect();
      } catch {
        // Clone outputs may already be disconnected if their source point was removed.
      }
      point.delayedCloneOutputs.delete(cloneId);
    };

    if (fadeSeconds <= 0) {
      disconnect();
      return;
    }

    const currentTime = this.ctx.currentTime;
    clone.gain.gain.cancelScheduledValues(currentTime);
    clone.gain.gain.setValueAtTime(Math.max(0.0001, clone.gain.gain.value), currentTime);
    clone.gain.gain.linearRampToValueAtTime(0.0001, currentTime + fadeSeconds);
    window.setTimeout(disconnect, Math.ceil((fadeSeconds + 0.02) * 1000));
  }

  public removeDelayedCloneOutputsForPoint(sourceId: string): void {
    const point = this.audioPoints.get(sourceId);
    if (!point) return;

    point.delayedCloneOutputs.forEach((clone) => {
      clone.delay.disconnect();
      clone.gain.disconnect();
      clone.panner.disconnect();
    });
    point.delayedCloneOutputs.clear();
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
    if (point.inverseDotNoiseGenerator) {
      point.inverseDotNoiseGenerator.dispose();
    }
    if (point.additivePartialGenerator) {
      point.additivePartialGenerator.dispose();
    }
    if (point.clickTrainGenerator) {
      point.clickTrainGenerator.dispose();
    }
    if (point.sineToneGenerator) {
      point.sineToneGenerator.dispose();
    }
    if (point.sineBurstGenerator) {
      point.sineBurstGenerator.dispose();
    }

    point.mainGain.disconnect();
    point.volumeLevelGain.disconnect();
    point.noiseOscillationGain.disconnect();
    point.envelopeGain.disconnect();
    this.removeDelayedCloneOutputsForPoint(id);

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

  public deactivateAllPoints(includeConstantPoints: boolean = false): void {
    this.audioPoints.forEach((_, id) => {
      if (!includeConstantPoints && id.startsWith(CONSTANT_DOT_ID_PREFIX)) return;
      this.deactivatePoint(id);
    });
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
    this.stopNoiseOscillation();
    this.disposeSharedBandpassNoise();
    this.audioPoints.forEach((point, id) => {
        if (point.subHitTimerId !== null) {
            clearTimeout(point.subHitTimerId);
        }
        this.removePoint(id);
    });
    this.outputGain.disconnect();
  }

  private getBandpassRange(normalizedYPos: number, bandwidthOctaves: number): { lowerEdge: number; upperEdge: number; centerFrequency: number } {
    return getBandpassRangeForNormalizedY(
      normalizedYPos,
      bandwidthOctaves,
      this.currentBandwidthFilterMode,
      this.frequencyExtensionRange
    );
  }

  private getBandpassCenterFrequency(normalizedYPos: number, bandwidthOctaves: number): number {
    return this.getBandpassRange(normalizedYPos, bandwidthOctaves).centerFrequency;
  }

  private getBandpassRangeAroundCenter(centerFrequency: number, bandwidthOctaves: number): { lowerEdge: number; upperEdge: number; centerFrequency: number } {
    const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(bandwidthOctaves, this.currentBandwidthFilterMode);
    const halfBandwidth = effectiveBandwidthOctaves / 2;
    return {
      lowerEdge: centerFrequency / Math.pow(2, halfBandwidth),
      upperEdge: centerFrequency * Math.pow(2, halfBandwidth),
      centerFrequency,
    };
  }

  public getPointBandpassRange(pointId: string): BandpassRange | null {
    const point = this.audioPoints.get(pointId);
    if (!point) return null;

    const bandwidthOctaves = point.bandwidthOctavesOverride ?? this.currentBandwidth;
    return this.getBandpassRange(point.normalizedYPos, bandwidthOctaves);
  }

  // The inverse-dot dip sits at the dot's pure row frequency (30 Hz .. 15 kHz),
  // independent of the bandpass bandwidth that compresses band centers inward.
  public getInverseDotDipBand(pointId: string): BandpassRange | null {
    const point = this.audioPoints.get(pointId);
    if (!point) return null;
    const centerFrequency = getInverseDotDipFrequencyForNormalizedY(point.normalizedYPos);
    return { lowerEdge: centerFrequency, upperEdge: centerFrequency, centerFrequency };
  }

  // Turn an inverse-dot point into flat, full-spectrum constant noise (no dip).
  public setInverseDotFlatNoise(pointId: string): void {
    const point = this.audioPoints.get(pointId);
    point?.inverseDotNoiseGenerator?.clearDips();
  }

  // Give an inverse-dot lead point the full set of dips for the dots sharing its
  // column, so the resting bed already excludes every one of those bands.
  public setInverseDotColumnBands(pointId: string, bands: BandpassRange[]): void {
    const point = this.audioPoints.get(pointId);
    if (point?.inverseDotNoiseGenerator && bands.length > 0) {
      point.inverseDotNoiseGenerator.setBands(bands);
    }
  }

  private getBandpassLoudnessCompensationDb(centerFrequency: number): number {
    const refFreq = 1000;
    const compensationFreq = clamp(centerFrequency, 20, 20000);

    if (compensationFreq < refFreq) {
      return Math.log2(refFreq / compensationFreq) * 3;
    }

    if (compensationFreq > 4000) {
      return Math.log2(compensationFreq / 4000) * 2;
    }

    return 0;
  }

  private getOrCreateSharedBandpassNoise(noiseId: string = DEFAULT_SHARED_BANDPASS_NOISE_ID): SharedBandpassNoiseNodes {
    const existing = this.sharedBandpassNoises.get(noiseId);
    if (existing) return existing;

    const source = this.ctx.createBufferSource();
    source.buffer = this._generateSinglePinkNoiseBuffer();
    source.loop = true;

    const generator = new BandpassedNoiseGenerator(this.ctx);
    generator.setBandwidthFilterMode(this.currentBandwidthFilterMode);
    generator.setGentleEdgeFalloffDbPerOct(this.currentGentleEdgeFalloffDbPerOct);
    generator.setBandpassBandwidth(this.currentBandwidth);
    generator.setBandpassSlope(this.currentBandpassSlope);
    generator.setInputSlope(PINK_NOISE_SLOPE_DB_PER_OCT);
    generator.setIndependentBandNoiseEnabled(false);
    generator.setSnareScoopEnabled(false);

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;

    source.connect(generator.getInputNode());
    generator.getOutputNode().connect(gain);
    gain.connect(panner);
    panner.connect(this.outputGain);
    source.start();

    const nodes = { source, generator, gain, panner };
    this.sharedBandpassNoises.set(noiseId, nodes);
    return nodes;
  }

  public getPointPanValue(pointId: string): number | null {
    const point = this.audioPoints.get(pointId);
    if (!point) return null;

    return 2 * point.normalizedXPos - 1;
  }

  public scheduleSharedBandpassNoise(
    range: BandpassRange,
    scheduledTime: number,
    gainMultiplier: number = 0.8,
    noiseId: string = DEFAULT_SHARED_BANDPASS_NOISE_ID,
    panValue: number = 0
  ): void {
    const nodes = this.getOrCreateSharedBandpassNoise(noiseId);
    nodes.panner.pan.setValueAtTime(clamp(panValue, -1, 1), scheduledTime);
    nodes.generator.scheduleBandpassRange(
      range.lowerEdge,
      range.upperEdge,
      range.centerFrequency,
      scheduledTime
    );

    const targetGain = Math.max(
      0,
      gainMultiplier * dbToGain(this.currentBaseDbLevel + this.getBandpassLoudnessCompensationDb(range.centerFrequency))
    );
    nodes.gain.gain.cancelScheduledValues(scheduledTime);
    nodes.gain.gain.setValueAtTime(targetGain, scheduledTime);
  }

  public scheduleSharedBandpassGain(
    scheduledTime: number,
    gain: number,
    noiseId: string = DEFAULT_SHARED_BANDPASS_NOISE_ID
  ): void {
    const nodes = this.sharedBandpassNoises.get(noiseId);
    if (!nodes) return;

    nodes.gain.gain.cancelScheduledValues(scheduledTime);
    nodes.gain.gain.setValueAtTime(Math.max(0, gain), scheduledTime);
  }

  public stopSharedBandpassNoise(scheduledTime: number = this.ctx.currentTime, noiseId?: string): void {
    if (noiseId) {
      this.scheduleSharedBandpassGain(scheduledTime, 0, noiseId);
      return;
    }

    this.sharedBandpassNoises.forEach((_, id) => {
      this.scheduleSharedBandpassGain(scheduledTime, 0, id);
    });
  }

  private disposeSharedBandpassNoise(): void {
    this.sharedBandpassNoises.forEach((nodes) => {
      try {
        nodes.source.stop();
      } catch {
        // The source may already be stopped.
      }
      nodes.source.disconnect();
      nodes.generator.dispose();
      nodes.gain.disconnect();
      nodes.panner.disconnect();
    });
    this.sharedBandpassNoises.clear();
  }

  // Helper method to set main gain and slope (used in activatePoint)
  private setMainGainAndSlope(
    point: PointAudioNodes,
    scheduledBandwidthOctaves?: number | null,
    scheduledTime?: number,
    slopeOffsetDbPerOct?: number | null,
    snareWaveEnabledOverride?: boolean | null,
    snareWavePhaseIndex?: number | null,
    preserveBandpassCenterFrequency = false,
    bandpassRangeOverride?: BandpassRange | null,
    inverseDotColumnBands?: BandpassRange[] | null
  ): void {
    const slopeOffset = slopeOffsetDbPerOct ?? 0;
    const effectiveNormalizedX = point.normalizedXPos;
    const effectiveNormalizedY = point.normalizedYPos;
    const baseBandwidthOctaves = point.bandwidthOctavesOverride ?? this.currentBandwidth;
    let targetOverallSlopeDbPerOctave;
    if (effectiveNormalizedY < 0.5) {
      const t = effectiveNormalizedY * 2;
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      const t = (effectiveNormalizedY - 0.5) * 2;
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }

    targetOverallSlopeDbPerOctave += slopeOffset;

    // Set slope on the appropriate generator (only for sloped noise, not bandpassed or sine)
    if (point.slopedNoiseGenerator) {
      if (scheduledTime !== undefined) {
        point.slopedNoiseGenerator.scheduleSlope(targetOverallSlopeDbPerOctave, scheduledTime);
      } else {
        point.slopedNoiseGenerator.setSlope(targetOverallSlopeDbPerOctave);
      }
    }
    // Bandpassed noise uses fixed slope, bandpass position based on Y
    let bandpassCenterFreq = 0; // Used for volume compensation later
    if (point.bandpassedNoiseGenerator) {
      if (bandpassRangeOverride) {
        bandpassCenterFreq = bandpassRangeOverride.centerFrequency;
      } else {
        const bandwidthOctaves = scheduledBandwidthOctaves ?? baseBandwidthOctaves;
        const centerBandwidthOctaves = preserveBandpassCenterFrequency ? baseBandwidthOctaves : bandwidthOctaves;
        bandpassCenterFreq = this.getBandpassCenterFrequency(effectiveNormalizedY, centerBandwidthOctaves);
      }
      if (scheduledTime !== undefined) {
        point.bandpassedNoiseGenerator.scheduleBandpassSlope(this.currentBandpassSlope + slopeOffset, scheduledTime);
      }
      if (bandpassRangeOverride && scheduledTime !== undefined) {
        point.bandpassedNoiseGenerator.scheduleBandpassRange(
          bandpassRangeOverride.lowerEdge,
          bandpassRangeOverride.upperEdge,
          bandpassRangeOverride.centerFrequency,
          scheduledTime
        );
      } else if (bandpassRangeOverride) {
        point.bandpassedNoiseGenerator.setBandpassRange(
          bandpassRangeOverride.lowerEdge,
          bandpassRangeOverride.upperEdge,
          bandpassRangeOverride.centerFrequency
        );
      } else if (scheduledBandwidthOctaves !== undefined && scheduledBandwidthOctaves !== null && scheduledTime !== undefined) {
        const bandwidthOctaves = scheduledBandwidthOctaves;
        point.bandpassedNoiseGenerator.scheduleBandpassFrequencyAndBandwidth(
          bandpassCenterFreq,
          bandwidthOctaves,
          scheduledTime
        );
      } else {
        const bandwidthOctaves = scheduledBandwidthOctaves ?? baseBandwidthOctaves;
        point.bandpassedNoiseGenerator.setBandpassBandwidth(bandwidthOctaves);
        point.bandpassedNoiseGenerator.setBandpassFrequency(bandpassCenterFreq);
      }
      if (scheduledTime !== undefined) {
        if (snareWaveEnabledOverride !== undefined && snareWaveEnabledOverride !== null) {
          point.bandpassedNoiseGenerator.scheduleSnareScoopEnabled(snareWaveEnabledOverride, scheduledTime, snareWavePhaseIndex ?? 0);
        } else {
          point.bandpassedNoiseGenerator.scheduleSnareScoopShape(scheduledTime);
        }
      } else {
        point.bandpassedNoiseGenerator.setBandpassSlope(this.currentBandpassSlope);
        if (snareWaveEnabledOverride !== undefined && snareWaveEnabledOverride !== null) {
          point.bandpassedNoiseGenerator.setSnareScoopEnabled(snareWaveEnabledOverride);
        }
      }
    }
    if (point.inverseDotNoiseGenerator) {
      // The dip sits at the dot's row frequency (30 Hz .. 15 kHz), not the
      // bandwidth-compressed bandpass center. A lead standing in for a whole
      // column carries one dip per dot (all holes coexist and pulse together); a
      // lone dot is just a single dip at its own row frequency.
      if (inverseDotColumnBands && inverseDotColumnBands.length > 0) {
        point.inverseDotNoiseGenerator.setBands(inverseDotColumnBands);
        bandpassCenterFreq = inverseDotColumnBands[0].centerFrequency;
      } else {
        const dipFrequency = getInverseDotDipFrequencyForNormalizedY(effectiveNormalizedY);
        point.inverseDotNoiseGenerator.setBandpassFrequency(dipFrequency);
        bandpassCenterFreq = dipFrequency;
      }
    }
    // Sine tone uses the same frequency mapping as bandpassed noise
    if (point.sineToneGenerator) {
      // Map Y position to sine frequency (higher Y = higher frequency)
      const minFreq = 50; // Hz
      const maxFreq = 14000; // Hz
      const logMinFreq = Math.log2(minFreq);
      const logMaxFreq = Math.log2(maxFreq);
      const targetFreq = Math.pow(2, logMinFreq + effectiveNormalizedY * (logMaxFreq - logMinFreq));
      point.sineToneGenerator.setFrequency(targetFreq);
    }
    if (point.sineBurstGenerator) {
      const bandwidthOctaves = scheduledBandwidthOctaves ?? baseBandwidthOctaves;
      const bandpassCenter = this.getBandpassCenterFrequency(effectiveNormalizedY, baseBandwidthOctaves);
      const bandpassRange = preserveBandpassCenterFrequency
        ? this.getBandpassRangeAroundCenter(bandpassCenter, bandwidthOctaves)
        : this.getBandpassRange(effectiveNormalizedY, bandwidthOctaves);
      bandpassCenterFreq = bandpassRange.centerFrequency;
      const targetSlope = this.currentBandpassSlope + slopeOffset;
      if (scheduledTime !== undefined) {
        point.sineBurstGenerator.scheduleBand(
          bandpassRange.lowerEdge,
          bandpassRange.upperEdge,
          targetSlope,
          scheduledTime
        );
      } else {
        point.sineBurstGenerator.setBand(
          bandpassRange.lowerEdge,
          bandpassRange.upperEdge,
          targetSlope
        );
      }
    }

    // Calculate volume compensation based on generator mode
    let finalVolumeDb: number;

    if (point.inverseDotNoiseGenerator) {
      finalVolumeDb = this.currentBaseDbLevel;
    } else if ((point.bandpassedNoiseGenerator || point.sineBurstGenerator) && bandpassCenterFreq > 0) {
      // Band-shaped generators share the same center-based loudness compensation.
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
      const extremityFactor = Math.abs(effectiveNormalizedY - 0.5) * 2;
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
        positionForVolume = effectiveNormalizedY;
      } else {
        // Horizontal: use normalizedXPos (0 = left, 1 = right)
        positionForVolume = effectiveNormalizedX;
      }

      const gradientPosition = this.positionVolumeReversed ? 1 - positionForVolume : positionForVolume;
      const positionAttenuationDb =
        this.positionVolumeLeftDb +
        (this.positionVolumeRightDb - this.positionVolumeLeftDb) * gradientPosition;

      // Apply the attenuation to the final volume
      finalVolumeDb += positionAttenuationDb;
    }

    const gainRatio = dbToGain(finalVolumeDb);
    const effectiveMasterGain = MASTER_GAIN * this.currentDistortionGain * gainRatio;
    point.mainGain.gain.setValueAtTime(effectiveMasterGain, scheduledTime ?? this.ctx.currentTime);
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
      if (point.bandpassedNoiseGenerator || point.inverseDotNoiseGenerator || point.sineBurstGenerator) {
        this.setMainGainAndSlope(point);
      }
    });
  }

  public getBandpassBandwidth(): number {
    return this.currentBandwidth;
  }

  public setBandwidthFilterMode(filterMode: BandwidthFilterMode): void {
    this.currentBandwidthFilterMode = filterMode;

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setBandwidthFilterMode(filterMode);
      }
      if (point.inverseDotNoiseGenerator) {
        point.inverseDotNoiseGenerator.setBandwidthFilterMode(filterMode);
      }
      if (point.bandpassedNoiseGenerator || point.inverseDotNoiseGenerator || point.sineBurstGenerator) {
        this.setMainGainAndSlope(point);
      }
    });
  }

  public setInverseDotOutsideGapOctaves(gapOctaves: number): void {
    this.currentInverseDotOutsideGapOctaves = clamp(
      Number.isFinite(gapOctaves) ? gapOctaves : DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
      MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
      MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES
    );

    this.audioPoints.forEach((point) => {
      if (point.inverseDotNoiseGenerator) {
        point.inverseDotNoiseGenerator.setOutsideGapOctaves(this.currentInverseDotOutsideGapOctaves);
        this.setMainGainAndSlope(point);
      }
    });
  }

  public setInverseDotBandBoostDb(boostDb: number): void {
    this.currentInverseDotBandBoostDb = clamp(
      Number.isFinite(boostDb) ? boostDb : DEFAULT_INVERSE_DOT_BAND_BOOST_DB,
      MIN_INVERSE_DOT_BAND_BOOST_DB,
      MAX_INVERSE_DOT_BAND_BOOST_DB
    );

    this.audioPoints.forEach((point) => {
      if (point.inverseDotNoiseGenerator) {
        point.inverseDotNoiseGenerator.setDotBandBoostDb(this.currentInverseDotBandBoostDb);
      }
    });
  }

  public setGentleEdgeFalloffDbPerOct(dbPerOct: number): void {
    this.currentGentleEdgeFalloffDbPerOct = clampGentleEdgeFalloffDbPerOct(dbPerOct);

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setGentleEdgeFalloffDbPerOct(this.currentGentleEdgeFalloffDbPerOct);
      }
    });
  }

  public setBandwidthOscillationEnabled(enabled: boolean): void {
    this.bandwidthOscillationEnabled = enabled;
    if (enabled) {
      this.resetBandwidthOscillationSequence();
      this.setBandpassBandwidth(6);
    }
  }

  public getBandwidthOscillationEnabled(): boolean {
    return this.bandwidthOscillationEnabled;
  }

  public setBandwidthOscillationStep(stepOctaves: number): void {
    // Kept for compatibility with the existing UI contract; this mode now uses
    // fixed 2/4/6-octave steps so the hi-hat-style pattern stays discrete.
    void stepOctaves;
  }

  public getBandwidthOscillationStep(): number {
    return 2;
  }

  public resetBandwidthOscillationSequence(): void {
    this.bandwidthOscillationStepIndex = 0;
  }

  public getNextBandwidthOscillationValue(): number | null {
    if (!this.bandwidthOscillationEnabled) return null;
    const hiHatBandwidthPattern = [6, 2, 2, 2, 4, 2, 2, 2];
    const bandwidth = hiHatBandwidthPattern[this.bandwidthOscillationStepIndex % hiHatBandwidthPattern.length] ?? 2;
    this.bandwidthOscillationStepIndex++;
    return bandwidth;
  }

  public setBandpassSlope(slopeDbPerOct: number): void {
    this.currentBandpassSlope = slopeDbPerOct;

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setBandpassSlope(slopeDbPerOct);
      }
      if (point.sineBurstGenerator) {
        this.setMainGainAndSlope(point);
      }
    });
  }

  public setSineBurstDensity(density: number): void {
    this.currentSineBurstDensity = Math.round(clamp(density, MIN_SINE_BURST_DENSITY, MAX_SINE_BURST_DENSITY));

    this.audioPoints.forEach((point) => {
      if (point.sineBurstGenerator) {
        point.sineBurstGenerator.setDensity(this.currentSineBurstDensity);
        this.setMainGainAndSlope(point);
      }
    });
  }

  public setSnareScoopEnabled(enabled: boolean): void {
    this.snareScoopEnabled = enabled;

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setSnareScoopEnabled(enabled);
      }
    });
  }

  public setSnareScoopDepthDb(depthDb: number): void {
    this.snareScoopDepthDb = clamp(depthDb, 0, MAX_SNARE_SCOOP_DEPTH_DB);

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setSnareScoopDepthDb(this.snareScoopDepthDb);
      }
    });
  }

  public setSnareScoopBandwidthOctaves(bandwidthOctaves: number): void {
    this.snareScoopBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_SNARE_SCOOP_BANDWIDTH_OCTAVES,
      MAX_SNARE_SCOOP_BANDWIDTH_OCTAVES
    );

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setSnareScoopBandwidthOctaves(this.snareScoopBandwidthOctaves);
      }
    });
  }

  public setSnareScoopMode(mode: SnareScoopMode): void {
    this.snareScoopMode = mode;

    this.audioPoints.forEach((point) => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setSnareScoopMode(mode);
      }
    });
  }

  public setClickTrainGainPercent(percent: number): void {
    this.currentClickTrainGainMultiplier = clamp(percent, 0, 8000) / 100;

    this.audioPoints.forEach((point) => {
      if (point.clickTrainGenerator) {
        point.clickTrainGenerator.setGainMultiplier(this.currentClickTrainGainMultiplier);
      }
    });
  }

  public setClickTrainDurationGateEnabled(enabled: boolean): void {
    this.clickTrainDurationGateEnabled = enabled;
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
  // Inverse-dot dots that have been right-clicked to play flat constant noise
  // instead of acting as a dot (no notch, no pulse, excluded from the sequence).
  private inverseConstantNoiseDotKeys: Set<string> = new Set();
  private selectionOrderByDotKey: Map<string, number> = new Map();
  private selectionVolumeStepDb: number = 0;
  private dotVolumeLevels: Map<string, number> = new Map(); // Volume level for each dot (0 = off, 1+ = on)
  private dotVolumeDbOffsets: Map<string, number> = new Map();
  private dotNormalizedPositions: Map<string, NormalizedAudioPoint> = new Map();
  private dotBandpassBandwidths: Map<string, number> = new Map();
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
  private loopSequencerVisualHitDotKeys: string[] | null = null;
  private loopSequencerVisualHitOffsets: number[] | null = null;
  private referenceDotKey: string | null = null;
  private referenceVolumeBalance: number = 1;
  private referenceVolumeOffsetDb: number = 0;
  private referenceVolumeOscillationEnabled: boolean = false;
  private referenceVolumeOscillationCurrentDb: number = -10;
  private referenceVolumeOscillationDirection: 1 | -1 = 1;
  private allVolumeOscillationEnabled: boolean = false;
  private allVolumeOscillationRateHz: number = 0.5;
  private allVolumeOscillationShape: VolumeOscillationShape = DEFAULT_VOLUME_OSCILLATION_SHAPE;
  private allVolumeOscillationWaveEnabled: boolean = false;
  private allVolumeOscillationWavePhaseShift: number = 0.125;
  private allVolumeOscillationStartTime: number = 0;
  private referenceVolumeMultiplyCount: number = 1;
  private hiHatQuietDropDb: number = 20;
  private hiHatLoudReleaseBoostMs: number = 200;
  private patternModeEnabled: boolean = false;
  private patternAccentEvery: PatternAccentEvery = 8;
  private patternVolumeDiffDb: number = 0;
  private fourFourHitModeEnabled: boolean = false;
  private sequencerPingPongEnabled: boolean = false;
  private fourFourVolumeBlockSize: number = 4;
  private fourFourVolumePerDot: boolean = false;
  private fourFourThreeLevelVolumeEnabled: boolean = false;
  private fourFourSidePolarityEnabled: boolean = false;
  private loudQuietBandwidthModeEnabled: boolean = false;
  private fourFourHalfBandPatternEnabled: boolean = false;
  private fourFourRowAlternationEnabled: boolean = false;
  private rhythmPatternEnabled: boolean = false;
  private fourFourStraightNoiseEnabled: boolean = false;
  private continuousLoudQuietStepSeconds: number = 0.5;
  private continuousLoudQuietRatio: number = 0.5;
  private continuousLoudQuietStartTime: number = 0;
  private continuousLoudQuietAnimationFrameId: number | null = null;
  private continuousLoudQuietLastStateKey: string | null = null;
  private continuousLoudQuietTargetsOnly: boolean = false;
  private continuousLoudQuietTargetDotKeys: Set<string> = new Set();
  private continuousTargetsSequentialHoldEnabled: boolean = false;
  private continuousTwoDotAlternateEnabled: boolean = false;
  private singleLocationTwoDotEnabled: boolean = false;
  private singleLocationTwoDotSourceKey: string | null = null;
  private singleLocationTwoDotAudioId: string | null = null;
  private continuousLeftRightLoudQuietEnabled: boolean = false;
  private continuousSequentialEnabled: boolean = false;
  private continuousSequentialRowsEnabled: boolean = false;
  private rowCompareEnabled: boolean = false;
  private rowCompareRowAKeys: string[] = [];
  private rowCompareRowBKeys: string[] = [];
  private rowCompareRepeats: number = 8;
  private rowCompareVolumeADb: number = 0;
  private rowCompareVolumeBDb: number = 0;
  private loopWaveWaitSeconds: number = 0;
  private experimentalModeEnabled: boolean = false;
  private snareScoopEnabled: boolean = false;
  private snareScoopDepthDb: number = DEFAULT_SNARE_SCOOP_DEPTH_DB;
  private snareScoopMode: SnareScoopMode = DEFAULT_SNARE_SCOOP_MODE;
  private snareScoopBandwidthOctaves: number = DEFAULT_SNARE_SCOOP_BANDWIDTH_OCTAVES_BY_MODE[DEFAULT_SNARE_SCOOP_MODE];
  private tiltOscillationEnabled: boolean = false;
  private tiltOscillationAmount: number = DEFAULT_TILT_OSCILLATION_AMOUNT;
  private reverbModeEnabled: boolean = false;
  private reverbVolumeSpreadDb: number = 12;
  private reverbQuietOscillationIndex: number = 0;
  private constantDotKeys: Set<string> = new Set();
  private dragNoisePointIds: Set<string> = new Set();
  private dragNoiseRemoveTimeoutIds: Map<string, number> = new Map();
  private lineCalibrationPointIds: [string, string] = [
    `${LINE_CALIBRATION_ID_PREFIX}0`,
    `${LINE_CALIBRATION_ID_PREFIX}1`,
  ];
  private lineCalibrationCopyIds: [string, string] = [
    `${LINE_CALIBRATION_ID_PREFIX}copy:0`,
    `${LINE_CALIBRATION_ID_PREFIX}copy:1`,
  ];
  private lineCalibrationActive: boolean = false;
  private lineCalibrationCopyActive: boolean = false;
  private linePathActive: boolean = false;
  private linePathPointSoundMode: SoundMode | null = null;
  private linePathInverseDotNextHitTime: number = 0;
  private lineCalibrationEndpointGainMultipliers: [number, number] = [1, 1];
  private lineCalibrationAnimationFrameId: number | null = null;
  private lineCalibrationRemoveTimeoutIds: Map<string, number> = new Map();

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

    this.syncSingleLocationTwoDotPoint();

    // Update playback if playing
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.startAllRhythms();
    }
  }

  public setDotNormalizedPositions(positions: Map<string, NormalizedAudioPoint>): void {
    this.dotNormalizedPositions = new Map(positions);

    this.activeDotKeys.forEach((dotKey) => {
      const position = this.dotNormalizedPositions.get(dotKey);
      if (!position || !this.audioService.hasPoint(dotKey)) return;

      this.audioService.updatePointPosition(
        dotKey,
        clamp(position.normalizedX, 0, 1),
        clamp(position.normalizedY, 0, 1)
      );
    });
  }

  public clearDotNormalizedPositions(): void {
    this.dotNormalizedPositions.clear();
  }

  public setDotBandpassBandwidths(bandwidths: Map<string, number>): void {
    this.dotBandpassBandwidths = new Map(bandwidths);
    this.syncDotBandpassBandwidths();
  }

  public clearDotBandpassBandwidths(): void {
    this.dotBandpassBandwidths.clear();
    this.activeDotKeys.forEach((dotKey) => {
      this.audioService.setPointBandpassBandwidth(dotKey, null);
    });
  }

  private syncDotBandpassBandwidths(): void {
    this.activeDotKeys.forEach((dotKey) => {
      this.audioService.setPointBandpassBandwidth(dotKey, this.dotBandpassBandwidths.get(dotKey) ?? null);
    });
  }

  private syncDotVolumeDbOffsets(): void {
    this.activeDotKeys.forEach((dotKey) => {
      this.audioService.updatePointVolumeDb(dotKey, this.dotVolumeDbOffsets.get(dotKey) ?? 0);
    });
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
    let clampedStep = 0;
    if (this.loopSequencerVisualHitOffsets && this.loopSequencerVisualHitOffsets.length > 0) {
      const offsets = this.loopSequencerVisualHitOffsets;
      let low = 0;
      let high = Math.min(offsets.length, this.loopSequencerVisualCycleHits) - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if ((offsets[mid] ?? 0) <= elapsed) {
          clampedStep = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
    } else {
      const rawStep = Math.floor(elapsed / this.loopSequencerVisualHitInterval);
      clampedStep = Math.min(this.loopSequencerVisualCycleHits - 1, rawStep);
    }
    const beatIndex = this.loopSequencerVisualBeatBase + clampedStep;

    let playingDotKey: string | null = null;
    if (this.loopSequencerVisualHitDotKeys) {
      playingDotKey = this.loopSequencerVisualHitDotKeys[clampedStep] ?? null;
    } else if (this.loopSequencerVisualPlayTogether || this.loopSequencerVisualInterleaved) {
      const dotIndex = clampedStep % this.loopSequencerVisualDotKeys.length;
      playingDotKey = this.loopSequencerVisualDotKeys[dotIndex] ?? null;
    } else {
      const dotIndex = Math.min(
        this.loopSequencerVisualDotKeys.length - 1,
        Math.floor(clampedStep / this.loopSequencerVisualTotalHitsPerDot)
      );
      playingDotKey = this.loopSequencerVisualDotKeys[dotIndex] ?? null;
    }

    return {
      playingDotKey,
      beatIndex,
    };
  }

  private getReferenceInterleavedHitSequence(sortedDotKeys: string[]): string[] | null {
    if (!this.referenceDotKey || !sortedDotKeys.includes(this.referenceDotKey)) return null;

    const otherDotKeys = sortedDotKeys.filter(dotKey => dotKey !== this.referenceDotKey && this.shouldRedDotPlay(dotKey));
    if (otherDotKeys.length === 0) return [this.referenceDotKey];

    const sequence: string[] = [];
    otherDotKeys.forEach((dotKey) => {
      sequence.push(dotKey, this.referenceDotKey!);
    });
    return sequence;
  }

  private getReferenceHiHatHitSequence(sortedDotKeys: string[]): string[] | null {
    if (!this.audioService.getHiHatModeEnabled()) return null;
    if (!this.referenceDotKey || !sortedDotKeys.includes(this.referenceDotKey)) return null;

    const otherDotKeys = sortedDotKeys.filter(dotKey => dotKey !== this.referenceDotKey && this.shouldRedDotPlay(dotKey));
    if (otherDotKeys.length === 0) {
      return [this.referenceDotKey, this.referenceDotKey, this.referenceDotKey];
    }

    const sequence: string[] = [];
    otherDotKeys.forEach((dotKey) => {
      sequence.push(dotKey, this.referenceDotKey!, this.referenceDotKey!, this.referenceDotKey!);
    });
    return sequence;
  }

  private getReferenceBalancedVolumeSequence(sortedDotKeys: string[]): Array<{ dotKey: string; balanceSign: -1 | 0 | 1 }> | null {
    if (!this.referenceDotKey || !sortedDotKeys.includes(this.referenceDotKey)) return null;
    if (sortedDotKeys.length !== 3) return null;

    const otherDotKeys = sortedDotKeys.filter(dotKey => dotKey !== this.referenceDotKey && this.shouldRedDotPlay(dotKey));
    if (otherDotKeys.length !== 2) return null;

    return [
      { dotKey: otherDotKeys[0], balanceSign: -1 },
      { dotKey: this.referenceDotKey, balanceSign: 0 },
      { dotKey: otherDotKeys[1], balanceSign: 1 },
      { dotKey: this.referenceDotKey, balanceSign: 0 },
    ];
  }

  private getReferenceMultipliedVolumeSequence(sortedDotKeys: string[]): string[] | null {
    const repeatCount = Math.max(1, Math.round(this.referenceVolumeMultiplyCount));
    if (repeatCount <= 1 || !this.referenceDotKey || !sortedDotKeys.includes(this.referenceDotKey)) return null;

    const otherDotKeys = sortedDotKeys.filter(dotKey => dotKey !== this.referenceDotKey && this.shouldRedDotPlay(dotKey));
    if (otherDotKeys.length === 0) return null;

    const sequence: string[] = [];
    otherDotKeys.forEach((dotKey) => {
      for (let repeat = 0; repeat < repeatCount; repeat++) {
        sequence.push(dotKey, this.referenceDotKey!);
      }
    });
    return sequence;
  }

  public setReferenceDotKey(dotKey: string | null): void {
    this.referenceDotKey = dotKey;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getReferenceDotKey(): string | null {
    return this.referenceDotKey;
  }

  public setReferenceVolumeBalance(balance: number): void {
    this.referenceVolumeBalance = clamp(balance, -1, 1);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getReferenceVolumeBalance(): number {
    return this.referenceVolumeBalance;
  }

  public setReferenceVolumeOffsetDb(offsetDb: number): void {
    this.referenceVolumeOffsetDb = clamp(offsetDb, -24, 24);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getReferenceVolumeOffsetDb(): number {
    return this.referenceVolumeOffsetDb;
  }

  public setReferenceVolumeOscillationEnabled(enabled: boolean): void {
    this.referenceVolumeOscillationEnabled = enabled;
    this.resetReferenceVolumeOscillation();
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getReferenceVolumeOscillationEnabled(): boolean {
    return this.referenceVolumeOscillationEnabled;
  }

  public setAllVolumeOscillationEnabled(enabled: boolean): void {
    this.allVolumeOscillationEnabled = enabled;
    this.resetAllVolumeOscillation();
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getAllVolumeOscillationEnabled(): boolean {
    return this.allVolumeOscillationEnabled;
  }

  public setAllVolumeOscillationRateHz(rateHz: number): void {
    const next = Number.isFinite(rateHz) ? clamp(rateHz, 0.01, 20) : 0.5;
    if (this.allVolumeOscillationRateHz === next) return;

    const now = audioContext.getAudioContext().currentTime;
    const elapsed = Math.max(0, now - this.allVolumeOscillationStartTime);
    const currentPhaseCycles = elapsed * this.allVolumeOscillationRateHz;
    this.allVolumeOscillationRateHz = next;
    this.allVolumeOscillationStartTime = now - currentPhaseCycles / next;

    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode() && this.hasContinuousVolumeMotion()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && (this.allVolumeOscillationEnabled || this.hasSelectionVolumeOscillation())) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getAllVolumeOscillationRateHz(): number {
    return this.allVolumeOscillationRateHz;
  }

  public setAllVolumeOscillationShape(shape: VolumeOscillationShape): void {
    if (this.allVolumeOscillationShape === shape) return;

    this.allVolumeOscillationShape = shape;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode() && this.hasContinuousVolumeMotion()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && (this.allVolumeOscillationEnabled || this.hasSelectionVolumeOscillation())) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getAllVolumeOscillationShape(): VolumeOscillationShape {
    return this.allVolumeOscillationShape;
  }

  public setAllVolumeOscillationWaveEnabled(enabled: boolean): void {
    if (this.allVolumeOscillationWaveEnabled === enabled) return;

    this.allVolumeOscillationWaveEnabled = enabled;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode() && this.hasContinuousVolumeMotion()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && (this.allVolumeOscillationEnabled || this.hasSelectionVolumeOscillation())) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getAllVolumeOscillationWaveEnabled(): boolean {
    return this.allVolumeOscillationWaveEnabled;
  }

  public setAllVolumeOscillationWavePhaseShift(phaseShift: number): void {
    const next = Number.isFinite(phaseShift) ? clamp(phaseShift, 0, 1) : 0.125;
    if (this.allVolumeOscillationWavePhaseShift === next) return;

    this.allVolumeOscillationWavePhaseShift = next;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode() && this.hasContinuousVolumeMotion()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && (this.allVolumeOscillationEnabled || this.hasSelectionVolumeOscillation())) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getAllVolumeOscillationWavePhaseShift(): number {
    return this.allVolumeOscillationWavePhaseShift;
  }

  public setSelectionVolumeStepDb(stepDb: number): void {
    const next = Number.isFinite(stepDb) ? clamp(stepDb, 0, 48) : 0;
    if (this.selectionVolumeStepDb === next) return;
    this.selectionVolumeStepDb = next;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getSelectionVolumeStepDb(): number {
    return this.selectionVolumeStepDb;
  }

  public setReferenceVolumeMultiplyCount(count: number): void {
    this.referenceVolumeMultiplyCount = clamp(Math.round(count), 1, 4);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getReferenceVolumeMultiplyCount(): number {
    return this.referenceVolumeMultiplyCount;
  }

  public setHiHatQuietDropDb(quietDropDb: number): void {
    this.hiHatQuietDropDb = clamp(quietDropDb, 0, 120);
    this.applyContinuousLoudQuietGain(audioContext.getAudioContext().currentTime, true);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setHiHatLoudReleaseBoostMs(boostMs: number): void {
    this.hiHatLoudReleaseBoostMs = clamp(boostMs, 0, 2000);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setPatternModeEnabled(enabled: boolean): void {
    this.patternModeEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setPatternAccentEvery(value: number): void {
    const next = normalizePatternAccentEvery(value);
    if (this.patternAccentEvery === next) return;
    this.patternAccentEvery = next;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setPatternVolumeDiffDb(diffDb: number): void {
    this.patternVolumeDiffDb = clamp(diffDb, -24, 24);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourHitModeEnabled(enabled: boolean): void {
    this.fourFourHitModeEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  // Ping-pong dot order: sweep A→B→C→B→A→B… instead of looping one way.
  public setSequencerPingPongEnabled(enabled: boolean): void {
    if (this.sequencerPingPongEnabled === enabled) return;
    this.sequencerPingPongEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourVolumeBlockSize(size: number): void {
    const next = clamp(Math.round(size), 1, 8);
    if (this.fourFourVolumeBlockSize === next) return;
    this.fourFourVolumeBlockSize = next;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourVolumePerDot(enabled: boolean): void {
    if (this.fourFourVolumePerDot === enabled) return;
    this.fourFourVolumePerDot = enabled;
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourThreeLevelVolumeEnabled(enabled: boolean): void {
    if (this.fourFourThreeLevelVolumeEnabled === enabled) return;
    this.fourFourThreeLevelVolumeEnabled = enabled;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourSidePolarityEnabled(enabled: boolean): void {
    if (this.fourFourSidePolarityEnabled === enabled) return;
    this.fourFourSidePolarityEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setLoudQuietBandwidthModeEnabled(enabled: boolean): void {
    if (this.loudQuietBandwidthModeEnabled === enabled) return;
    this.loudQuietBandwidthModeEnabled = enabled;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getLoudQuietBandwidthModeEnabled(): boolean {
    return this.loudQuietBandwidthModeEnabled;
  }

  public setFourFourHalfBandPatternEnabled(enabled: boolean): void {
    if (this.fourFourHalfBandPatternEnabled === enabled) return;
    this.fourFourHalfBandPatternEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourRowAlternationEnabled(enabled: boolean): void {
    if (this.fourFourRowAlternationEnabled === enabled) return;
    this.fourFourRowAlternationEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setRhythmPatternEnabled(enabled: boolean): void {
    if (this.rhythmPatternEnabled === enabled) return;
    this.rhythmPatternEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setFourFourStraightNoiseEnabled(enabled: boolean): void {
    if (this.fourFourStraightNoiseEnabled === enabled) return;
    this.fourFourStraightNoiseEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setContinuousLoudQuietStepSeconds(seconds: number): void {
    const next = Number.isFinite(seconds) ? clamp(seconds, 0.01, 30) : 0.5;
    if (this.continuousLoudQuietStepSeconds === next) return;
    this.continuousLoudQuietStepSeconds = next;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
  }

  public setContinuousLoudQuietRatio(ratio: number): void {
    const next = Number.isFinite(ratio) ? clamp(ratio, 0.01, 0.99) : 0.25;
    if (this.continuousLoudQuietRatio === next) return;
    this.continuousLoudQuietRatio = next;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setContinuousLoudQuietTargetsOnly(enabled: boolean): void {
    if (this.continuousLoudQuietTargetsOnly === enabled) return;
    this.continuousLoudQuietTargetsOnly = enabled;
    this.applyContinuousLoudQuietGain(audioContext.getAudioContext().currentTime, true);
  }

  public setContinuousLoudQuietTargetDotKeys(dotKeys: Set<string>): void {
    const next = new Set(dotKeys);
    let changed = next.size !== this.continuousLoudQuietTargetDotKeys.size;
    if (!changed) {
      for (const dotKey of next) {
        if (!this.continuousLoudQuietTargetDotKeys.has(dotKey)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    this.continuousLoudQuietTargetDotKeys = next;
    this.applyContinuousLoudQuietGain(audioContext.getAudioContext().currentTime, true);
    if (this.isPlaying && this.isLoopSequencerMode() && this.continuousTargetsSequentialHoldEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setContinuousTargetsSequentialHoldEnabled(enabled: boolean): void {
    if (this.continuousTargetsSequentialHoldEnabled === enabled) return;
    this.continuousTargetsSequentialHoldEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setContinuousTwoDotAlternateEnabled(enabled: boolean): void {
    if (this.continuousTwoDotAlternateEnabled === enabled) return;
    this.continuousTwoDotAlternateEnabled = enabled;
    this.syncSingleLocationTwoDotPoint();
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
  }

  public setSingleLocationTwoDotEnabled(enabled: boolean): void {
    if (this.singleLocationTwoDotEnabled === enabled) return;
    this.singleLocationTwoDotEnabled = enabled;
    this.syncSingleLocationTwoDotPoint();
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
  }

  public setContinuousLeftRightLoudQuietEnabled(enabled: boolean): void {
    if (this.continuousLeftRightLoudQuietEnabled === enabled) return;
    this.continuousLeftRightLoudQuietEnabled = enabled;
    this.syncSingleLocationTwoDotPoint();
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
  }

  public setContinuousSequentialEnabled(enabled: boolean): void {
    if (this.continuousSequentialEnabled === enabled) return;
    this.continuousSequentialEnabled = enabled;
    this.syncSingleLocationTwoDotPoint();
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
  }

  public setContinuousSequentialRowsEnabled(enabled: boolean): void {
    if (this.continuousSequentialRowsEnabled === enabled) return;
    this.continuousSequentialRowsEnabled = enabled;
    if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
      this.startContinuousLoudQuietCycle();
    }
  }

  private parseDotKey(dotKey: string): { x: number; y: number } | null {
    const [xStr, yStr] = dotKey.split(',');
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  private getSingleLocationTwoDotAudioId(dotKey: string): string {
    return `${SINGLE_LOCATION_TWO_DOT_ID_PREFIX}${dotKey}`;
  }

  private getSingleLocationTwoDotSourceKey(): string | null {
    if (
      !this.singleLocationTwoDotEnabled ||
      !this.continuousTwoDotAlternateEnabled ||
      this.continuousLeftRightLoudQuietEnabled ||
      this.continuousSequentialEnabled ||
      this.activeDotKeys.size !== 1
    ) {
      return null;
    }

    return Array.from(this.activeDotKeys)[0] ?? null;
  }

  private syncSingleLocationTwoDotPoint(): void {
    const sourceKey = this.getSingleLocationTwoDotSourceKey();
    const nextAudioId = sourceKey === null ? null : this.getSingleLocationTwoDotAudioId(sourceKey);

    if (this.singleLocationTwoDotAudioId !== null && this.singleLocationTwoDotAudioId !== nextAudioId) {
      this.audioService.removePoint(this.singleLocationTwoDotAudioId);
    }

    this.singleLocationTwoDotSourceKey = sourceKey;
    this.singleLocationTwoDotAudioId = nextAudioId;

    if (sourceKey === null || nextAudioId === null) return;

    const coordinates = this.parseDotKey(sourceKey);
    if (!coordinates) return;

    if (!this.audioService.hasPoint(nextAudioId)) {
      this.audioService.addPoint(nextAudioId, coordinates.x, coordinates.y, this.gridSize, this.columnCount, 3);
      if (this.isPlaying && this.isTimeBasedContinuousLoudQuietMode()) {
        this.audioService.activatePointWithGain(nextAudioId, 0.001, CONTINUOUS_SEQUENCE_RAMP_SECONDS);
      }
    } else {
      const normalizedX = this.columnCount <= 1 ? 0.5 : coordinates.x / (this.columnCount - 1);
      const normalizedY = this.gridSize <= 1 ? 0.5 : coordinates.y / (this.gridSize - 1);
      this.audioService.updatePointPosition(nextAudioId, normalizedX, normalizedY);
    }
  }

  private getSingleLocationTwoDotKeys(): [string, string] | null {
    if (this.singleLocationTwoDotSourceKey === null || this.singleLocationTwoDotAudioId === null) return null;
    return [this.singleLocationTwoDotSourceKey, this.singleLocationTwoDotAudioId];
  }

  private getContinuousVolumeSelectionIndex(dotKey?: string): number {
    if (dotKey !== undefined) {
      const lineIndex = this.lineCalibrationPointIds.indexOf(dotKey);
      if (lineIndex >= 0) return lineIndex;
      if (dotKey === this.singleLocationTwoDotAudioId) {
        return 1;
      }
    }
    return dotKey === undefined ? 0 : this.selectionOrderByDotKey.get(dotKey) ?? 0;
  }

  private getContinuousVolumeSelectionCount(): number {
    if (this.lineCalibrationActive) return 2;
    return this.singleLocationTwoDotAudioId !== null && this.activeDotKeys.size === 1
      ? 2
      : this.activeDotKeys.size;
  }

  private normalizeRowCompareKeys(dotKeys: string[]): string[] {
    const seen = new Set<string>();
    const parsed = dotKeys.flatMap((dotKey) => {
      if (seen.has(dotKey)) return [];
      const coordinates = this.parseDotKey(dotKey);
      if (!coordinates) return [];
      seen.add(dotKey);
      return [{ key: dotKey, ...coordinates }];
    });

    parsed.sort((a, b) => {
      const rowDiff = b.y - a.y;
      if (rowDiff !== 0) return rowDiff;
      return a.x - b.x;
    });

    return parsed.map(({ key }) => key);
  }

  private areDotKeyListsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((dotKey, index) => dotKey === b[index]);
  }

  public setRowCompareEnabled(enabled: boolean): void {
    if (this.rowCompareEnabled === enabled) return;
    this.rowCompareEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setRowCompareRows(rowAKeys: string[], rowBKeys: string[]): void {
    const nextA = this.normalizeRowCompareKeys(rowAKeys);
    const nextB = this.normalizeRowCompareKeys(rowBKeys);
    const changed =
      !this.areDotKeyListsEqual(this.rowCompareRowAKeys, nextA) ||
      !this.areDotKeyListsEqual(this.rowCompareRowBKeys, nextB);

    if (!changed) return;
    this.rowCompareRowAKeys = nextA;
    this.rowCompareRowBKeys = nextB;
    if (this.isPlaying && this.isLoopSequencerMode() && this.rowCompareEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setRowCompareRepeats(repeats: number): void {
    const next = clamp(Math.round(repeats), 1, 32);
    if (this.rowCompareRepeats === next) return;
    this.rowCompareRepeats = next;
    if (this.isPlaying && this.isLoopSequencerMode() && this.rowCompareEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setRowCompareVolumesDb(rowAVolumeDb: number, rowBVolumeDb: number): void {
    const nextA = Number.isFinite(rowAVolumeDb) ? clamp(rowAVolumeDb, -60, 36) : 0;
    const nextB = Number.isFinite(rowBVolumeDb) ? clamp(rowBVolumeDb, -60, 36) : 0;
    if (this.rowCompareVolumeADb === nextA && this.rowCompareVolumeBDb === nextB) return;
    this.rowCompareVolumeADb = nextA;
    this.rowCompareVolumeBDb = nextB;
    if (this.isPlaying && this.isLoopSequencerMode() && this.rowCompareEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setLoopWaveWaitSeconds(seconds: number): void {
    const next = Number.isFinite(seconds) ? clamp(seconds, 0, 10) : 0;
    if (this.loopWaveWaitSeconds === next) return;
    this.loopWaveWaitSeconds = next;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setExperimentalModeEnabled(enabled: boolean): void {
    this.experimentalModeEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setSnareScoopEnabled(enabled: boolean): void {
    if (this.snareScoopEnabled === enabled) return;
    this.snareScoopEnabled = enabled;
    this.audioService.setSnareScoopEnabled(enabled);
    if (this.isPlaying && this.isLoopSequencerMode() && this.fourFourHitModeEnabled) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setSnareScoopDepthDb(depthDb: number): void {
    const next = clamp(depthDb, 0, MAX_SNARE_SCOOP_DEPTH_DB);
    if (this.snareScoopDepthDb === next) return;
    this.snareScoopDepthDb = next;
    this.audioService.setSnareScoopDepthDb(next);
  }

  public setSnareScoopBandwidthOctaves(bandwidthOctaves: number): void {
    const next = clamp(
      bandwidthOctaves,
      MIN_SNARE_SCOOP_BANDWIDTH_OCTAVES,
      MAX_SNARE_SCOOP_BANDWIDTH_OCTAVES
    );
    if (this.snareScoopBandwidthOctaves === next) return;
    this.snareScoopBandwidthOctaves = next;
    this.audioService.setSnareScoopBandwidthOctaves(next);
  }

  public setSnareScoopMode(mode: SnareScoopMode): void {
    if (this.snareScoopMode === mode) return;
    this.snareScoopMode = mode;
    this.audioService.setSnareScoopMode(mode);
  }

  public setTiltOscillationEnabled(enabled: boolean): void {
    if (this.tiltOscillationEnabled === enabled) return;
    this.tiltOscillationEnabled = enabled;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setTiltOscillationAmount(amount: number): void {
    const next = clamp(amount, 0, MAX_TILT_OSCILLATION_AMOUNT);
    if (this.tiltOscillationAmount === next) return;
    this.tiltOscillationAmount = next;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setReverbModeEnabled(enabled: boolean): void {
    this.reverbModeEnabled = enabled;
    this.reverbQuietOscillationIndex = 0;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setReverbVolumeSpreadDb(spreadDb: number): void {
    this.reverbVolumeSpreadDb = clamp(spreadDb, 0, 40);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  private resetReferenceVolumeOscillation(): void {
    this.referenceVolumeOscillationCurrentDb = -10;
    this.referenceVolumeOscillationDirection = 1;
  }

  private getNextReferenceVolumeOscillationDb(): number {
    const db = this.referenceVolumeOscillationCurrentDb;
    if (this.referenceVolumeOscillationDirection === 1 && this.referenceVolumeOscillationCurrentDb >= 10) {
      this.referenceVolumeOscillationDirection = -1;
    } else if (this.referenceVolumeOscillationDirection === -1 && this.referenceVolumeOscillationCurrentDb <= -10) {
      this.referenceVolumeOscillationDirection = 1;
    }
    this.referenceVolumeOscillationCurrentDb += this.referenceVolumeOscillationDirection * 2;
    return db;
  }

  private resetAllVolumeOscillation(): void {
    const now = audioContext.getAudioContext().currentTime;
    this.allVolumeOscillationStartTime = now;
  }

  private getVolumeOscillationNormalized(
    scheduledTime: number = audioContext.getAudioContext().currentTime,
    rateHz: number = this.allVolumeOscillationRateHz,
    startTime: number = this.allVolumeOscillationStartTime,
    phaseLagCycles: number = 0
  ): number {
    const elapsed = Math.max(0, scheduledTime - startTime);
    const phaseCycles = elapsed * Math.max(0.01, rateHz) - phaseLagCycles;

    if (this.allVolumeOscillationShape === 'hold') {
      const phase = phaseCycles - Math.floor(phaseCycles);
      const transition = VOLUME_OSCILLATION_HOLD_TRANSITION_FRACTION;
      const hold = (1 - transition * 2) / 2;
      const loudStart = hold + transition;
      const loudEnd = loudStart + hold;
      const smoothstep = (value: number) => value * value * (3 - 2 * value);

      if (phase < hold) return 0;
      if (phase < loudStart) return smoothstep((phase - hold) / transition);
      if (phase < loudEnd) return 1;
      return 1 - smoothstep((phase - loudEnd) / transition);
    }

    const phase = phaseCycles * 2 * Math.PI - Math.PI / 2;
    return (Math.sin(phase) + 1) / 2;
  }

  private getEnglishReadingOrderWaveIndex(dotKey?: string): number {
    if (!this.allVolumeOscillationWaveEnabled || dotKey === undefined || !this.activeDotKeys.has(dotKey)) return 0;
    const sortedGridDots = Array.from(this.activeDotKeys)
      .map((key) => {
        const coordinates = this.parseDotKey(key);
        return coordinates === null ? null : { key, ...coordinates };
      })
      .filter((dot): dot is { key: string; x: number; y: number } => dot !== null)
      .sort((a, b) => {
        const rowDiff = b.y - a.y;
        if (rowDiff !== 0) return rowDiff;
        return a.x - b.x;
      });
    const index = sortedGridDots.findIndex((dot) => dot.key === dotKey);
    return index < 0 ? 0 : index;
  }

  private getAllVolumeOscillationDb(
    scheduledTime: number = audioContext.getAudioContext().currentTime,
    dotKey?: string
  ): number {
    if (!this.allVolumeOscillationEnabled) return 0;
    const phaseLagCycles = this.getEnglishReadingOrderWaveIndex(dotKey) * this.allVolumeOscillationWavePhaseShift;
    const normalized = this.getVolumeOscillationNormalized(
      scheduledTime,
      this.allVolumeOscillationRateHz,
      this.allVolumeOscillationStartTime,
      phaseLagCycles
    );
    if (this.allVolumeOscillationShape === 'hold') {
      return -this.hiHatQuietDropDb * (1 - normalized);
    }
    return normalized <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(normalized);
  }

  private hasSelectionVolumeOscillation(): boolean {
    return this.selectionVolumeStepDb > 0 && this.getContinuousVolumeSelectionCount() >= 2;
  }

  private hasContinuousVolumeMotion(): boolean {
    return this.allVolumeOscillationEnabled || this.hasSelectionVolumeOscillation();
  }

  private getSelectionVolumeDb(
    dotKey: string,
    scheduledTime: number = audioContext.getAudioContext().currentTime
  ): number {
    const selectionIndex = this.getContinuousVolumeSelectionIndex(dotKey);
    if (selectionIndex !== 1 || this.selectionVolumeStepDb <= 0) return 0;

    const normalized = this.getVolumeOscillationNormalized(scheduledTime);
    return -this.selectionVolumeStepDb * (1 - normalized);
  }

  private getSharedSelectionVolumeDb(
    scheduledTime: number = audioContext.getAudioContext().currentTime
  ): number {
    if (this.selectionVolumeStepDb <= 0) return 0;

    const normalized = this.getVolumeOscillationNormalized(scheduledTime);
    return -this.selectionVolumeStepDb * (1 - normalized);
  }

  private isTimeBasedContinuousLoudQuietMode(): boolean {
    return !this.audioService.getLoopSequencerEnabled() &&
      !this.audioService.isSubHitPlaybackEnabled() &&
      this.audioService.getSoundMode() === SoundMode.BandpassedNoise;
  }

  private getContinuousVolumeLevelAtTime(currentTime: number): number {
    const stepSeconds = Math.max(0.01, this.continuousLoudQuietStepSeconds);
    const elapsed = Math.max(0, currentTime - this.continuousLoudQuietStartTime);

    if (this.fourFourThreeLevelVolumeEnabled) {
      const sequence = [0, 1, 2, 1];
      const index = Math.floor(elapsed / stepSeconds) % sequence.length;
      return sequence[index] ?? 2;
    }

    const blockSize = Math.max(1, this.fourFourVolumeBlockSize);
    const cycleSeconds = stepSeconds * blockSize;
    const loudSeconds = cycleSeconds * this.continuousLoudQuietRatio;
    const cyclePosition = elapsed % cycleSeconds;
    return cyclePosition < loudSeconds ? 2 : 0;
  }

  private getContinuousLoudQuietGain(
    volumeLevel: number,
    currentTime: number,
    includeVolumeOscillation = true,
    dotKey?: string,
    includeSelectionOffset = true
  ): number {
    const dropDb = volumeLevel >= 2 ? 0 : volumeLevel === 1 ? this.hiHatQuietDropDb / 2 : this.hiHatQuietDropDb;
    const oscillationDb = includeVolumeOscillation ? this.getAllVolumeOscillationDb(currentTime, dotKey) : 0;
    const selectionDb = includeSelectionOffset && dotKey !== undefined
      ? this.getSelectionVolumeDb(dotKey, currentTime)
      : 0;
    return 0.8 * dbToGain(-dropDb + oscillationDb + selectionDb);
  }

  private getLoudQuietBandwidthForLevel(volumeLevel: number): number {
    const wideBandwidth = clamp(
      this.audioService.getBandpassBandwidth(),
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );
    const narrowBandwidth = Math.min(wideBandwidth, LOUD_QUIET_MIN_BANDWIDTH_OCTAVES);
    if (volumeLevel >= 2) return wideBandwidth;
    if (volumeLevel <= 0) return narrowBandwidth;
    return narrowBandwidth + (wideBandwidth - narrowBandwidth) / 2;
  }

  private getLoudQuietBandwidthOverride(volumeLevel: number, shouldModulate = true): number | null {
    if (!this.loudQuietBandwidthModeEnabled) return null;
    if (!shouldModulate) {
      return clamp(
        this.audioService.getBandpassBandwidth(),
        MIN_BANDPASS_BANDWIDTH_OCTAVES,
        MAX_BANDPASS_BANDWIDTH_OCTAVES
      );
    }
    return this.getLoudQuietBandwidthForLevel(volumeLevel);
  }

  private getHalfBandPatternRange(fullRange: BandpassRange, step: HalfBandPatternStep): BandpassRange {
    if (step === 'full') return fullRange;
    if (step === 'bottom') {
      return {
        lowerEdge: fullRange.lowerEdge,
        upperEdge: fullRange.centerFrequency,
        centerFrequency: Math.sqrt(fullRange.lowerEdge * fullRange.centerFrequency),
      };
    }

    return {
      lowerEdge: fullRange.centerFrequency,
      upperEdge: fullRange.upperEdge,
      centerFrequency: Math.sqrt(fullRange.centerFrequency * fullRange.upperEdge),
    };
  }

  private getCombinedHalfBandPatternRange(dotKeys: string[]): BandpassRange | null {
    const ranges = dotKeys
      .map((dotKey) => this.audioService.getPointBandpassRange(dotKey))
      .filter((range): range is BandpassRange => range !== null);
    if (ranges.length === 0) return null;

    const lowerEdge = Math.min(...ranges.map((range) => range.lowerEdge));
    const upperEdge = Math.max(...ranges.map((range) => range.upperEdge));
    return {
      lowerEdge,
      upperEdge,
      centerFrequency: Math.sqrt(lowerEdge * upperEdge),
    };
  }

  private getContinuousLeftRightVolumeLevel(dotKey: string): number {
    const coordinates = this.parseDotKey(dotKey);
    if (!coordinates || this.columnCount <= 1) return 1;

    const centerCol = (this.columnCount - 1) / 2;
    if (coordinates.x < centerCol) return 2;
    if (coordinates.x > centerCol) return 0;
    return 1;
  }

  private getContinuousTwoDotAlternateState(currentTime: number): { dotKeys: string[]; levels: [number, number]; stateKey: string } | null {
    if (!this.continuousTwoDotAlternateEnabled) return null;

    const singleLocationKeys = this.activeDotKeys.size === 1 ? this.getSingleLocationTwoDotKeys() : null;
    const dotKeys = singleLocationKeys ?? Array.from(this.activeDotKeys).sort((a, b) => {
      return (this.selectionOrderByDotKey.get(a) ?? 0) - (this.selectionOrderByDotKey.get(b) ?? 0);
    });
    if (dotKeys.length !== 2) return null;

    const stepSeconds = Math.max(0.01, this.continuousLoudQuietStepSeconds);
    const blockSeconds = stepSeconds * Math.max(1, this.fourFourVolumeBlockSize);
    const elapsed = Math.max(0, currentTime - this.continuousLoudQuietStartTime);
    const stateIndex = Math.floor(elapsed / blockSeconds) % 4;
    const levelSequence: Array<[number, number]> = [
      [2, 2],
      [2, 0],
      [0, 0],
      [0, 2],
    ];
    const levels = levelSequence[stateIndex] ?? [2, 2];

    return {
      dotKeys,
      levels,
      stateKey: `two:${singleLocationKeys ? "single" : "real"}:${dotKeys.join("|")}:${stateIndex}`,
    };
  }

  private getContinuousSequentialState(currentTime: number): {
    dotKeys: string[];
    activeDotKeys: Set<string>;
    volumeLevel: number | null;
    stateKey: string;
  } | null {
    if (!this.continuousSequentialEnabled || this.activeDotKeys.size < 2) return null;

    const dotKeys = Array.from(this.activeDotKeys).sort((a, b) => {
      return (this.selectionOrderByDotKey.get(a) ?? 0) - (this.selectionOrderByDotKey.get(b) ?? 0);
    });
    if (dotKeys.length < 2) return null;

    const stepSeconds = Math.max(0.01, this.continuousLoudQuietStepSeconds);
    const elapsed = Math.max(0, currentTime - this.continuousLoudQuietStartTime);

    if (this.continuousSequentialRowsEnabled) {
      const rows = Array.from(dotKeys.reduce((rowMap, dotKey) => {
        const coordinates = this.parseDotKey(dotKey);
        if (!coordinates) return rowMap;

        const rowDots = rowMap.get(coordinates.y) ?? [];
        rowDots.push(dotKey);
        rowMap.set(coordinates.y, rowDots);
        return rowMap;
      }, new Map<number, string[]>())).sort(([rowA], [rowB]) => rowA - rowB);

      if (rows.length < 1) return null;

      const currentStepIndex = Math.floor(elapsed / stepSeconds);
      const threeLevelSequence = [0, 1, 2, 1];
      const rowCycleLength = this.fourFourThreeLevelVolumeEnabled ? threeLevelSequence.length : 8;
      const rowCycleStep = currentStepIndex % rowCycleLength;
      const currentRowIndex = Math.floor(currentStepIndex / rowCycleLength) % rows.length;
      const rowVolumeLevel = this.fourFourThreeLevelVolumeEnabled
        ? threeLevelSequence[rowCycleStep] ?? 1
        : rowCycleStep % 2 === 0 ? 2 : 0;
      const [currentRow, currentRowDots = []] = rows[currentRowIndex] ?? rows[0] ?? [0, []];
      const sortedRowDots = currentRowDots.sort((a, b) => {
        const aX = this.parseDotKey(a)?.x ?? 0;
        const bX = this.parseDotKey(b)?.x ?? 0;
        return aX - bX;
      });

      return {
        dotKeys,
        activeDotKeys: new Set(sortedRowDots),
        volumeLevel: rowVolumeLevel,
        stateKey: `seqRows:${dotKeys.join("|")}:${currentRow}:${rowCycleStep}:${rowVolumeLevel}:${sortedRowDots.join(",")}`,
      };
    }

    const currentStepIndex = Math.floor(elapsed / stepSeconds);
    let volumeLevel: number | null = null;
    let currentIndex = currentStepIndex % dotKeys.length;
    let stateKeySuffix = `${currentIndex}`;

    if (this.fourFourThreeLevelVolumeEnabled) {
      const sequence = [0, 1, 2, 1];
      const sequenceIndex = currentStepIndex % sequence.length;
      volumeLevel = sequence[sequenceIndex] ?? 1;
      currentIndex = Math.floor(currentStepIndex / sequence.length) % dotKeys.length;
      stateKeySuffix = `${currentIndex}:${sequenceIndex}:${volumeLevel}`;
    }

    const currentDotKey = dotKeys[currentIndex];
    if (!currentDotKey) return null;

    return {
      dotKeys,
      activeDotKeys: new Set([currentDotKey]),
      volumeLevel,
      stateKey: `seq:${dotKeys.join("|")}:${stateKeySuffix}`,
    };
  }

  private applyContinuousLoudQuietGain(currentTime: number = audioContext.getAudioContext().currentTime, force = false): void {
    if (!this.isTimeBasedContinuousLoudQuietMode()) return;
    const canSkipUnchangedState = !this.hasContinuousVolumeMotion();

    const sequentialState = this.getContinuousSequentialState(currentTime);
    if (sequentialState) {
      const volumeLevel = sequentialState.volumeLevel ?? this.getContinuousVolumeLevelAtTime(currentTime);
      const stateKey = `${sequentialState.stateKey}:${volumeLevel}:${this.continuousLoudQuietTargetsOnly ? "targets" : "all"}`;
      if (canSkipUnchangedState && !force && this.continuousLoudQuietLastStateKey === stateKey) return;

      this.continuousLoudQuietLastStateKey = stateKey;
      sequentialState.dotKeys.forEach((dotKey) => {
        const isCurrentDot = sequentialState.activeDotKeys.has(dotKey);
        const shouldModulate =
          !this.continuousLoudQuietTargetsOnly ||
          this.continuousLoudQuietTargetDotKeys.has(dotKey);
        const activeLevel = shouldModulate ? volumeLevel : 1;
        const gainLevel = this.loudQuietBandwidthModeEnabled ? 2 : activeLevel;
        const targetGain = isCurrentDot
          ? this.getContinuousLoudQuietGain(gainLevel, currentTime, true, dotKey)
          : 0.001;
        this.audioService.activatePointWithGain(
          dotKey,
          targetGain,
          CONTINUOUS_SEQUENCE_RAMP_SECONDS,
          this.getLoudQuietBandwidthOverride(activeLevel, shouldModulate),
          this.loudQuietBandwidthModeEnabled
        );
      });
      return;
    }

    if (this.continuousLeftRightLoudQuietEnabled) {
      const stateKey = `lr:${this.columnCount}:${Array.from(this.activeDotKeys).sort().join("|")}`;
      if (canSkipUnchangedState && !force && this.continuousLoudQuietLastStateKey === stateKey) return;

      this.continuousLoudQuietLastStateKey = stateKey;
      this.activeDotKeys.forEach((dotKey) => {
        const volumeLevel = this.getContinuousLeftRightVolumeLevel(dotKey);
        this.audioService.activatePointWithGain(
          dotKey,
          this.getContinuousLoudQuietGain(this.loudQuietBandwidthModeEnabled ? 2 : volumeLevel, currentTime, true, dotKey),
          0,
          this.getLoudQuietBandwidthOverride(volumeLevel),
          this.loudQuietBandwidthModeEnabled
        );
      });
      return;
    }

    const twoDotState = this.getContinuousTwoDotAlternateState(currentTime);
    if (twoDotState) {
      if (canSkipUnchangedState && !force && this.continuousLoudQuietLastStateKey === twoDotState.stateKey) return;

      this.continuousLoudQuietLastStateKey = twoDotState.stateKey;
      twoDotState.dotKeys.forEach((dotKey, index) => {
        const volumeLevel = twoDotState.levels[index] ?? 2;
        this.audioService.activatePointWithGain(
          dotKey,
          this.getContinuousLoudQuietGain(this.loudQuietBandwidthModeEnabled ? 2 : volumeLevel, currentTime, true, dotKey),
          0,
          this.getLoudQuietBandwidthOverride(volumeLevel),
          this.loudQuietBandwidthModeEnabled
        );
      });
      return;
    }

    const volumeLevel = this.getContinuousVolumeLevelAtTime(currentTime);
    const stateKey = `all:${volumeLevel}:${this.continuousLoudQuietTargetsOnly ? "targets" : "all"}`;
    if (canSkipUnchangedState && !force && this.continuousLoudQuietLastStateKey === stateKey) return;

    this.continuousLoudQuietLastStateKey = stateKey;
    this.activeDotKeys.forEach((dotKey) => {
      const shouldModulate =
        !this.continuousLoudQuietTargetsOnly ||
        this.continuousLoudQuietTargetDotKeys.has(dotKey);
      const gainLevel = this.loudQuietBandwidthModeEnabled ? 2 : volumeLevel;
      const gain = this.getContinuousLoudQuietGain(gainLevel, currentTime, true, dotKey);
      const middleGain = this.getContinuousLoudQuietGain(1, currentTime, false, dotKey);
      this.audioService.activatePointWithGain(
        dotKey,
        shouldModulate || this.loudQuietBandwidthModeEnabled ? gain : middleGain,
        0,
        this.getLoudQuietBandwidthOverride(volumeLevel, shouldModulate),
        this.loudQuietBandwidthModeEnabled
      );
    });
  }

  private startContinuousLoudQuietCycle(): void {
    this.stopContinuousLoudQuietCycle(false);
    if (!this.isTimeBasedContinuousLoudQuietMode() || this.activeDotKeys.size === 0) return;

    this.continuousLoudQuietStartTime = audioContext.getAudioContext().currentTime;
    this.continuousLoudQuietLastStateKey = null;

    if (this.continuousLeftRightLoudQuietEnabled && !this.continuousSequentialEnabled && !this.hasContinuousVolumeMotion()) {
      this.applyContinuousLoudQuietGain(this.continuousLoudQuietStartTime, true);
      return;
    }

    const tick = () => {
      if (!this.isPlaying || !this.isTimeBasedContinuousLoudQuietMode() || this.activeDotKeys.size === 0) {
        this.continuousLoudQuietAnimationFrameId = null;
        return;
      }

      this.applyContinuousLoudQuietGain();
      this.continuousLoudQuietAnimationFrameId = requestAnimationFrame(tick);
    };

    tick();
  }

  private stopContinuousLoudQuietCycle(resetGain = true): void {
    if (this.continuousLoudQuietAnimationFrameId !== null) {
      cancelAnimationFrame(this.continuousLoudQuietAnimationFrameId);
      this.continuousLoudQuietAnimationFrameId = null;
    }

    if (resetGain && this.activeDotKeys.size > 0) {
      this.activeDotKeys.forEach((dotKey) => {
        this.audioService.activatePointWithGain(dotKey, 0.8);
      });
    }
    if (this.singleLocationTwoDotAudioId !== null) {
      this.audioService.activatePointWithGain(this.singleLocationTwoDotAudioId, 0.001);
    }
    this.continuousLoudQuietLastStateKey = null;
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
    this.loopSequencerVisualHitDotKeys = null;
    this.loopSequencerVisualHitOffsets = null;
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
    this.selectionOrderByDotKey = new Map();
    Array.from(this.activeDotKeys).forEach((dotKey, index) => {
      this.selectionOrderByDotKey.set(dotKey, index);
    });

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
        const customPosition = this.dotNormalizedPositions.get(dotKey);
        const [xStr, yStr] = dotKey.split(',');
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);
        if (customPosition) {
            const volumeLevel = this.dotVolumeLevels.get(dotKey) ?? 3; // Default to full volume
            this.audioService.addPointNormalized(
              dotKey,
              clamp(customPosition.normalizedX, 0, 1),
              clamp(customPosition.normalizedY, 0, 1),
              volumeLevel
            );
            addedKeys.push(dotKey);
        } else if (!isNaN(x) && !isNaN(y)) {
            const volumeLevel = this.dotVolumeLevels.get(dotKey) ?? 3; // Default to full volume
            this.audioService.addPoint(dotKey, x, y, this.gridSize, this.columnCount, volumeLevel);
            addedKeys.push(dotKey);
        }
      }
    });

    this.activeDotKeys.forEach((dotKey) => {
      const customPosition = this.dotNormalizedPositions.get(dotKey);
      if (!customPosition || !this.audioService.hasPoint(dotKey)) return;

      this.audioService.updatePointPosition(
        dotKey,
        clamp(customPosition.normalizedX, 0, 1),
        clamp(customPosition.normalizedY, 0, 1)
      );
    });
    this.syncDotBandpassBandwidths();
    this.syncDotVolumeDbOffsets();

    this.syncSingleLocationTwoDotPoint();

    if (this.isPlaying) {
      if (this.isLoopSequencerMode()) {
        // NEW: Restart loop sequencer with new dots
        this.stopLoopSequencer();
        this.startLoopSequencer();
      } else if (this.isContinuousNoiseMode()) {
        this.audioService.startNoiseOscillation();
      } else if (this.isContinuousSimultaneousMode()) {
        if (this.continuousSequentialEnabled && this.activeDotKeys.size > 1) {
          addedKeys.forEach(key => this.audioService.activatePointWithGain(key, 0.001));
        } else {
          addedKeys.forEach(key => this.audioService.activatePoint(key, audioContext.getAudioContext().currentTime));
        }
        this.applyContinuousLoudQuietGain(audioContext.getAudioContext().currentTime, true);
        // Removed keys are handled by removePoint implicitly deactivating them
      } else {
      this.stopAllRhythms();
      this.startAllRhythms();
      }
    }
  }

  private getConstantDotAudioId(dotKey: string): string {
    return `${CONSTANT_DOT_ID_PREFIX}${dotKey}`;
  }

  // Replace the set of inverse-dot "constant noise" dots (right-clicked). These
  // play steady flat full-spectrum noise and are excluded from the pulse sequence.
  public setInverseConstantNoiseDots(dotKeys: Set<string>): void {
    const next = new Set(dotKeys);
    const changed =
      next.size !== this.inverseConstantNoiseDotKeys.size ||
      Array.from(next).some((key) => !this.inverseConstantNoiseDotKeys.has(key));
    this.inverseConstantNoiseDotKeys = next;
    if (!changed) return;
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public setConstantDotPlaying(dotKey: string, playing: boolean, currentGridSize?: number, currentColumns?: number): void {
    if (currentGridSize && currentGridSize !== this.gridSize) {
      this.gridSize = currentGridSize;
    }
    if (currentColumns && currentColumns !== this.columnCount) {
      this.columnCount = currentColumns;
    }

    const audioId = this.getConstantDotAudioId(dotKey);
    if (!playing) {
      this.constantDotKeys.delete(dotKey);
      this.audioService.removePoint(audioId);
      return;
    }

    if (this.constantDotKeys.has(dotKey)) return;

    const [xStr, yStr] = dotKey.split(',');
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    if (isNaN(x) || isNaN(y)) return;

    this.constantDotKeys.add(dotKey);
    this.audioService.addPoint(audioId, x, y, this.gridSize, this.columnCount, 3);
    this.audioService.activatePoint(audioId, audioContext.getAudioContext().currentTime, 1.0);
  }

  public clearConstantDots(): void {
    this.constantDotKeys.forEach((dotKey) => {
      this.audioService.removePoint(this.getConstantDotAudioId(dotKey));
    });
    this.constantDotKeys.clear();
  }

  private getDragNoiseAudioId(index: number): string {
    return `${DRAG_NOISE_ID_PREFIX}${index}`;
  }

  private cancelDragNoiseRemoval(audioId: string): void {
    const timeoutId = this.dragNoiseRemoveTimeoutIds.get(audioId);
    if (timeoutId === undefined) return;

    clearTimeout(timeoutId);
    this.dragNoiseRemoveTimeoutIds.delete(audioId);
  }

  private releaseDragNoisePoint(audioId: string): void {
    this.cancelDragNoiseRemoval(audioId);
    if (!this.audioService.hasPoint(audioId)) return;

    this.audioService.activatePointWithGain(audioId, 0.001, DRAG_NOISE_RAMP_SECONDS);
    const timeoutId = window.setTimeout(() => {
      this.audioService.removePoint(audioId);
      this.dragNoiseRemoveTimeoutIds.delete(audioId);
    }, Math.ceil((DRAG_NOISE_RAMP_SECONDS + 0.02) * 1000));
    this.dragNoiseRemoveTimeoutIds.set(audioId, timeoutId);
  }

  public updateDragNoiseFormation(points: Array<{ normalizedX: number; normalizedY: number }>): void {
    const activePoints = points.slice(0, 12);
    const nextAudioIds = new Set(activePoints.map((_, index) => this.getDragNoiseAudioId(index)));

    this.dragNoisePointIds.forEach((audioId) => {
      if (!nextAudioIds.has(audioId)) {
        this.releaseDragNoisePoint(audioId);
      }
    });

    const gain = 0.8 / Math.sqrt(Math.max(1, activePoints.length));
    activePoints.forEach((point, index) => {
      const audioId = this.getDragNoiseAudioId(index);
      const normalizedX = clamp(point.normalizedX, 0, 1);
      const normalizedY = clamp(point.normalizedY, 0, 1);
      this.cancelDragNoiseRemoval(audioId);

      if (!this.audioService.hasPoint(audioId)) {
        this.audioService.addPointNormalized(audioId, normalizedX, normalizedY, 3);
      } else {
        this.audioService.updatePointPosition(audioId, normalizedX, normalizedY);
      }
      this.audioService.activatePointWithGain(audioId, gain, DRAG_NOISE_RAMP_SECONDS);
    });

    this.dragNoisePointIds = nextAudioIds;
  }

  public stopDragNoiseFormation(): void {
    this.dragNoisePointIds.forEach((audioId) => {
      this.releaseDragNoisePoint(audioId);
    });
    this.dragNoisePointIds.clear();
  }

  private cancelLineCalibrationRemoval(audioId: string): void {
    const timeoutId = this.lineCalibrationRemoveTimeoutIds.get(audioId);
    if (timeoutId === undefined) return;

    clearTimeout(timeoutId);
    this.lineCalibrationRemoveTimeoutIds.delete(audioId);
  }

  private releaseLineCalibrationPoint(audioId: string): void {
    this.cancelLineCalibrationRemoval(audioId);
    if (!this.audioService.hasPoint(audioId)) return;

    if (audioId === LINE_PATH_AUDIO_ID) {
      this.linePathPointSoundMode = null;
      this.linePathInverseDotNextHitTime = 0;
    }

    this.audioService.activatePointWithGain(audioId, 0.001, DRAG_NOISE_RAMP_SECONDS);
    const timeoutId = window.setTimeout(() => {
      this.audioService.removePoint(audioId);
      this.lineCalibrationRemoveTimeoutIds.delete(audioId);
    }, Math.ceil((DRAG_NOISE_RAMP_SECONDS + 0.02) * 1000));
    this.lineCalibrationRemoveTimeoutIds.set(audioId, timeoutId);
  }

  private applyLineCalibrationGain(): void {
    if (!this.lineCalibrationActive || !this.isTimeBasedContinuousLoudQuietMode()) return;

    const currentTime = audioContext.getAudioContext().currentTime;
    this.lineCalibrationPointIds.forEach((audioId, index) => {
      if (!this.audioService.hasPoint(audioId)) return;
      this.audioService.activatePointWithGain(
        audioId,
        this.getContinuousLoudQuietGain(2, currentTime, true, audioId, false) *
          (this.lineCalibrationEndpointGainMultipliers[index] ?? 1),
        CONTINUOUS_SEQUENCE_RAMP_SECONDS
      );
    });
  }

  private startLineCalibrationGainLoop(): void {
    if (this.lineCalibrationAnimationFrameId !== null) return;

    const tick = () => {
      if (!this.lineCalibrationActive) {
        this.lineCalibrationAnimationFrameId = null;
        return;
      }

      this.applyLineCalibrationGain();
      this.lineCalibrationAnimationFrameId = requestAnimationFrame(tick);
    };

    tick();
  }

  private clearLineCalibrationCopyOutputs(fadeSeconds: number = 0): void {
    this.lineCalibrationPointIds.forEach((sourceId, index) => {
      const cloneId = this.lineCalibrationCopyIds[index];
      this.audioService.removeDelayedCloneOutput(sourceId, cloneId, fadeSeconds);
    });
    this.lineCalibrationCopyActive = false;
  }

  public updateLineCalibration(points: [
    { normalizedX: number; normalizedY: number },
    { normalizedX: number; normalizedY: number }
  ], copyPoints: [
    { normalizedX: number; normalizedY: number },
    { normalizedX: number; normalizedY: number }
  ] | null = null, endpointGainMultipliers: [number, number] = [1, 1]): void {
    this.lineCalibrationActive = true;
    this.lineCalibrationEndpointGainMultipliers = [
      Math.max(0, endpointGainMultipliers[0] ?? 1),
      Math.max(0, endpointGainMultipliers[1] ?? 1),
    ];

    points.forEach((point, index) => {
      const audioId = this.lineCalibrationPointIds[index];
      const normalizedX = clamp(point.normalizedX, 0, 1);
      const normalizedY = clamp(point.normalizedY, 0, 1);
      this.cancelLineCalibrationRemoval(audioId);

      if (!this.audioService.hasPoint(audioId)) {
        this.audioService.addPointNormalized(audioId, normalizedX, normalizedY, 3);
      } else {
        this.audioService.updatePointPosition(audioId, normalizedX, normalizedY);
      }

      if (!this.isTimeBasedContinuousLoudQuietMode()) {
        this.audioService.activatePointWithGain(
          audioId,
          0.8 * (this.lineCalibrationEndpointGainMultipliers[index] ?? 1),
          DRAG_NOISE_RAMP_SECONDS
        );
      }
    });

    if (copyPoints) {
      this.lineCalibrationCopyActive = true;
      copyPoints.forEach((point, index) => {
        this.audioService.addOrUpdateDelayedCloneOutput(
          this.lineCalibrationPointIds[index],
          this.lineCalibrationCopyIds[index],
          point.normalizedX,
          LINE_CALIBRATION_COPY_DELAY_SECONDS
        );
      });
    } else if (this.lineCalibrationCopyActive) {
      this.clearLineCalibrationCopyOutputs();
    }

    this.startLineCalibrationGainLoop();
    this.applyLineCalibrationGain();
  }

  private scheduleLinePathInverseDotHit(gain: number): void {
    if (this.audioService.getSoundMode() !== SoundMode.InverseDotNoise) {
      this.linePathInverseDotNextHitTime = 0;
      return;
    }

    const currentTime = audioContext.getAudioContext().currentTime;
    if (this.linePathInverseDotNextHitTime <= 0 || currentTime >= this.linePathInverseDotNextHitTime) {
      this.audioService.schedulePointHit(
        LINE_PATH_AUDIO_ID,
        currentTime,
        LINE_INVERSE_DOT_HIT_ATTACK_SECONDS,
        LINE_INVERSE_DOT_HIT_RELEASE_SECONDS,
        Math.max(0, gain / 0.8)
      );
      this.linePathInverseDotNextHitTime = currentTime + LINE_INVERSE_DOT_HIT_INTERVAL_SECONDS;
    }
  }

  public updateLinePathPoint(
    point: { normalizedX: number; normalizedY: number },
    gain: number = 0.8,
    inverseDotPulseEnabled: boolean = false
  ): void {
    const normalizedX = clamp(point.normalizedX, 0, 1);
    const normalizedY = clamp(point.normalizedY, 0, 1);
    const currentSoundMode = this.audioService.getSoundMode();

    this.linePathActive = true;
    this.cancelLineCalibrationRemoval(LINE_PATH_AUDIO_ID);

    if (this.audioService.hasPoint(LINE_PATH_AUDIO_ID) && this.linePathPointSoundMode !== currentSoundMode) {
      this.audioService.removePoint(LINE_PATH_AUDIO_ID);
      this.linePathInverseDotNextHitTime = 0;
    }

    if (!this.audioService.hasPoint(LINE_PATH_AUDIO_ID)) {
      this.audioService.addPointNormalized(LINE_PATH_AUDIO_ID, normalizedX, normalizedY, 3);
      this.linePathPointSoundMode = currentSoundMode;
    } else {
      this.audioService.updatePointPosition(LINE_PATH_AUDIO_ID, normalizedX, normalizedY);
    }

    this.audioService.activatePointWithGain(LINE_PATH_AUDIO_ID, gain, DRAG_NOISE_RAMP_SECONDS);
    if (inverseDotPulseEnabled) {
      this.scheduleLinePathInverseDotHit(gain);
    } else {
      this.linePathInverseDotNextHitTime = 0;
    }
  }

  public stopLinePathPoint(): void {
    if (!this.linePathActive && !this.audioService.hasPoint(LINE_PATH_AUDIO_ID)) return;

    this.linePathActive = false;
    this.releaseLineCalibrationPoint(LINE_PATH_AUDIO_ID);
  }

  public stopLineCalibration(): void {
    this.lineCalibrationActive = false;
    this.lineCalibrationCopyActive = false;

    if (this.lineCalibrationAnimationFrameId !== null) {
      cancelAnimationFrame(this.lineCalibrationAnimationFrameId);
      this.lineCalibrationAnimationFrameId = null;
    }

    this.lineCalibrationPointIds.forEach((audioId) => {
      this.releaseLineCalibrationPoint(audioId);
    });
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

  public setDotVolumeDbOffsets(offsets: Map<string, number>): void {
    this.dotVolumeDbOffsets = new Map(offsets);
    this.syncDotVolumeDbOffsets();
  }

  public updateDotVolumeDb(dotKey: string, volumeDbOffset: number): void {
    const clampedDbOffset = clamp(volumeDbOffset, -60, 24);
    if (Math.abs(clampedDbOffset) < 0.001) {
      this.dotVolumeDbOffsets.delete(dotKey);
    } else {
      this.dotVolumeDbOffsets.set(dotKey, clampedDbOffset);
    }
    this.audioService.updatePointVolumeDb(dotKey, clampedDbOffset);
  }

  public getDotVolumeDb(dotKey: string): number {
    return this.dotVolumeDbOffsets.get(dotKey) ?? 0;
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
      this.resetReferenceVolumeOscillation();
      this.resetAllVolumeOscillation();

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

        if (this.isContinuousNoiseMode()) {
          this.audioService.startNoiseOscillation();
        } else if (this.audioService.getAlwaysPlayingEnabled()) {
          // Check if always playing mode is enabled
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
          if (this.continuousSequentialEnabled && this.activeDotKeys.size > 1) {
            this.activeDotKeys.forEach(dotKey => this.audioService.activatePointWithGain(dotKey, 0.001));
          } else {
            this.activeDotKeys.forEach(dotKey => this.audioService.activatePoint(dotKey, audioContext.getAudioContext().currentTime));
          }
          this.startContinuousLoudQuietCycle();
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
      this.audioService.stopNoiseOscillation();
      this.stopContinuousLoudQuietCycle(false);
      this.audioService.stopAutoVolumeCycle();
      this.stopStopbandCycling();
      this.stopLoopSequencer(); // NEW
      this.stopAllRhythms();
      this.resetLoopSequencerVisualState();
    }
  }

  /**
   * Start loop sequencer mode - evenly spaced dots with envelope triggering.
   * @param scheduledStartTime If provided, use this as the start time for
   *   scheduling hits (for seamless looping). Otherwise use currentTime.
   */
  private startLoopSequencer(scheduledStartTime?: number): void {
    this.stopLoopSequencerInternalCleanup();

    if (!this.isPlaying || this.activeDotKeys.size === 0) {
      this.resetLoopSequencerVisualState();
      return;
    }

    // Only deactivate on the initial start — skip when seamlessly looping
    // so the last dot's release tail isn't cut off.
    if (scheduledStartTime === undefined) {
      this.audioService.deactivateAllPoints();
      this.audioService.resetBandwidthOscillationSequence();
      this.reverbQuietOscillationIndex = 0;
    }

    // Sort dots by reading order
    const sortedDotKeys = this.sortDotsByReadingOrder();
    const heldSequentialTargetDotKeys = this.continuousTargetsSequentialHoldEnabled
      ? sortedDotKeys.filter((dotKey) => this.continuousLoudQuietTargetDotKeys.has(dotKey))
      : [];
    const heldSequentialTargetSet = new Set(heldSequentialTargetDotKeys);
    const inverseDotMode = this.audioService.getSoundMode() === SoundMode.InverseDotNoise;

    // Right-clicked inverse-dot dots play flat constant noise: they're pulled out
    // of the pulse sequence entirely and just held on as steady full-band noise.
    const inverseConstantNoiseDots = inverseDotMode
      ? sortedDotKeys.filter((dotKey) => this.inverseConstantNoiseDotKeys.has(dotKey))
      : [];
    const inverseConstantNoiseSet = new Set(inverseConstantNoiseDots);

    // In inverse-dot mode every column is voiced by a single "lead" point: full-
    // spectrum noise carrying one parametric dip per dot in the column, so all the
    // holes coexist and every dot in the column pulses together on each hit. The
    // other dots become silent peers and are dropped from the sequence, so a
    // multi-dot column behaves like one event everywhere downstream.
    const rawSequencerDotKeys = sortedDotKeys.filter(
      (dotKey) => !heldSequentialTargetSet.has(dotKey) && !inverseConstantNoiseSet.has(dotKey)
    );

    const inverseDotColumnBandsByLead = new Map<string, BandpassRange[]>();
    const inverseDotNonLeadPeers = new Set<string>();
    if (inverseDotMode) {
      const columns = new Map<number, string[]>();
      rawSequencerDotKeys.forEach((dotKey) => {
        const coordinates = this.parseDotKey(dotKey);
        if (!coordinates) return;
        if (!columns.has(coordinates.x)) columns.set(coordinates.x, []);
        columns.get(coordinates.x)!.push(dotKey);
      });
      columns.forEach((dotKeys) => {
        const leadDotKey = dotKeys[0];
        if (!leadDotKey) return;
        const bands = dotKeys
          .map((dotKey) => this.audioService.getInverseDotDipBand(dotKey))
          .filter((band): band is BandpassRange => band !== null)
          .sort((a, b) => a.centerFrequency - b.centerFrequency);
        inverseDotColumnBandsByLead.set(leadDotKey, bands);
        for (let index = 1; index < dotKeys.length; index += 1) {
          inverseDotNonLeadPeers.add(dotKeys[index]!);
        }
      });
      // TEMP DEBUG: inspect column grouping + resolved dip bands.
      console.log('[INV] columns=', Array.from(columns.entries()).map(([x, keys]) => `x${x}:[${keys.join(' | ')}]`),
        'leadBands=', Array.from(inverseDotColumnBandsByLead.entries()).map(([lead, bands]) => `${lead}->[${bands.map((b) => Math.round(b.centerFrequency)).join(',')}]`),
        'mutedPeers=', Array.from(inverseDotNonLeadPeers));
    }

    const sequencerDotKeys = inverseDotNonLeadPeers.size > 0
      ? rawSequencerDotKeys.filter((dotKey) => !inverseDotNonLeadPeers.has(dotKey))
      : rawSequencerDotKeys;
    const dotCount = sequencerDotKeys.length;
    const playableDots = sequencerDotKeys.filter(dotKey => this.shouldRedDotPlay(dotKey));
    const inverseHeldTargetsFollowHitVolume = inverseDotMode && heldSequentialTargetDotKeys.length > 0;
    const referenceHiHatHitSequence = this.getReferenceHiHatHitSequence(sequencerDotKeys);
    const referenceHitSequence = referenceHiHatHitSequence ? null : this.getReferenceInterleavedHitSequence(sequencerDotKeys);

    if (!inverseHeldTargetsFollowHitVolume || playableDots.length === 0) {
      heldSequentialTargetDotKeys.forEach((dotKey) => {
        this.audioService.activatePointWithGain(dotKey, 0.8);
      });
    }

    if (scheduledStartTime === undefined && inverseDotMode) {
      // Silence the peers folded into a lead, and prime each lead with its whole
      // column of dips so the resting bed already excludes every dot's band.
      inverseDotNonLeadPeers.forEach((dotKey) => {
        this.audioService.activatePointWithGain(dotKey, 0);
      });
      inverseDotColumnBandsByLead.forEach((bands, leadDotKey) => {
        this.audioService.setInverseDotColumnBands(leadDotKey, bands);
        this.audioService.activatePointWithGain(leadDotKey, 0.8);
      });
      // Constant-noise dots: flat full-band noise, held on, no dip, no pulse.
      inverseConstantNoiseDots.forEach((dotKey) => {
        this.audioService.setInverseDotFlatNoise(dotKey);
        this.audioService.activatePointWithGain(dotKey, 0.8);
      });
    }

    // Get hit mode parameters
    const hitRate = this.audioService.getHitModeRate(); // hits per second
    const attackTime = this.audioService.getHitModeAttack();
    const releaseTime = this.audioService.getHitModeRelease();
    const hitsPerVolumeLevel = this.audioService.getNumberOfHits(); // Number of hits at EACH volume level
    const hitDecayDb = this.audioService.getHitDecay(); // Total dB range from quietest to loudest
    const volumeSteps = this.audioService.getVolumeSteps(); // Number of volume levels
    const referenceMultipliedVolumeSequence = referenceHiHatHitSequence ? null : this.getReferenceMultipliedVolumeSequence(sequencerDotKeys);
    const referenceBalancedVolumeSequence =
      !referenceHiHatHitSequence && !referenceMultipliedVolumeSequence && volumeSteps === 3 ? this.getReferenceBalancedVolumeSequence(sequencerDotKeys) : null;
    const rowCompareGroups: Array<{ dotKeys: string[]; volumeDb: number }> | null =
      !referenceHiHatHitSequence && !referenceHitSequence && !referenceMultipliedVolumeSequence && !referenceBalancedVolumeSequence && this.rowCompareEnabled
        ? (() => {
            const rowAKeys = this.normalizeRowCompareKeys(
              this.rowCompareRowAKeys.filter((dotKey) => this.activeDotKeys.has(dotKey) && !heldSequentialTargetSet.has(dotKey) && this.shouldRedDotPlay(dotKey))
            );
            const rowBKeys = this.normalizeRowCompareKeys(
              this.rowCompareRowBKeys.filter((dotKey) => this.activeDotKeys.has(dotKey) && !heldSequentialTargetSet.has(dotKey) && this.shouldRedDotPlay(dotKey))
            );
            if (rowAKeys.length === 0 || rowBKeys.length === 0) return null;
            return [
              { dotKeys: rowAKeys, volumeDb: this.rowCompareVolumeADb },
              { dotKeys: rowBKeys, volumeDb: this.rowCompareVolumeBDb },
            ];
          })()
        : null;
    const rowCompareActive = rowCompareGroups !== null;
    const patternAccentEvery = this.patternAccentEvery;
    const hiHatAccentDepthSequence = Array.from({ length: patternAccentEvery }, (_, index) => index === 0 ? 2 : 0);
    const patternVolumeDepthSequence = [2, 0, 0, 0];
    const experimentalClusterMode =
      !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence &&
      !rowCompareActive && playableDots.length > 1 && this.experimentalModeEnabled && !this.reverbModeEnabled;
    const experimentalDepthSequence = experimentalClusterMode
      ? [0, Math.max(0, volumeSteps - 1), 0, Math.max(0, volumeSteps - 1)]
      : null;
    const patternDepthSequence =
      !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence &&
      !rowCompareActive && !experimentalClusterMode && playableDots.length > 0 && this.patternModeEnabled && !this.reverbModeEnabled
        ? patternVolumeDepthSequence
        : null;
    const hiHatDepthSequence =
      !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence &&
      !rowCompareActive && !patternDepthSequence && playableDots.length > 0 && this.audioService.getHiHatModeEnabled() && !this.reverbModeEnabled
        ? hiHatAccentDepthSequence
        : null;
    const reverbDepthSequence =
      !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence &&
      !rowCompareActive && playableDots.length > 0 && this.reverbModeEnabled
        ? [2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
        : null;
    const rhythmPatternDotKeys =
      !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence &&
      !rowCompareActive && !experimentalClusterMode && !patternDepthSequence && !hiHatDepthSequence && !reverbDepthSequence &&
      this.rhythmPatternEnabled && playableDots.length > 0
        ? playableDots.slice(0, RHYTHM_PATTERN_BEAT_OFFSETS.length)
        : [];
    const rhythmPatternActive = rhythmPatternDotKeys.length > 0;
    const fourFourHitModeActive =
      !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence &&
      !rowCompareActive && !experimentalClusterMode && !patternDepthSequence && !hiHatDepthSequence && !reverbDepthSequence && !rhythmPatternActive &&
      playableDots.length > 0 && this.fourFourHitModeEnabled;
    const fourFourStraightNoiseActive =
      fourFourHitModeActive &&
      this.fourFourStraightNoiseEnabled &&
      !this.fourFourHalfBandPatternEnabled &&
      !this.fourFourRowAlternationEnabled &&
      !this.fourFourThreeLevelVolumeEnabled &&
      this.audioService.getSoundMode() === SoundMode.BandpassedNoise;
    const fourFourRowAlternationActive =
      fourFourHitModeActive &&
      !fourFourStraightNoiseActive &&
      this.fourFourRowAlternationEnabled &&
      !this.snareScoopEnabled &&
      this.audioService.getSoundMode() === SoundMode.BandpassedNoise;
    const fourFourHalfBandPatternSequence =
      fourFourHitModeActive &&
      !fourFourStraightNoiseActive &&
      !fourFourRowAlternationActive &&
      this.fourFourHalfBandPatternEnabled &&
      !this.snareScoopEnabled &&
      this.audioService.getSoundMode() === SoundMode.BandpassedNoise
        ? HALF_BAND_PATTERN_SEQUENCE
        : null;
    const fourFourSnareWavePhaseSequence =
      fourFourHitModeActive && !fourFourStraightNoiseActive && !fourFourRowAlternationActive && !fourFourHalfBandPatternSequence && this.snareScoopEnabled
        ? [0, 1, 2, 3, null, null, null, null]
        : null;
    const fourFourRatioBlockSize = Math.max(1, this.fourFourVolumeBlockSize);
    const fourFourLoudBlockCount = clamp(
      Math.round(fourFourRatioBlockSize * this.continuousLoudQuietRatio),
      1,
      fourFourRatioBlockSize
    );
    const fourFourQuietBlockCount = Math.max(0, fourFourRatioBlockSize - fourFourLoudBlockCount);
    const fourFourVolumeLevelSequence =
      fourFourHitModeActive && !fourFourStraightNoiseActive && !fourFourRowAlternationActive && !fourFourHalfBandPatternSequence && !this.snareScoopEnabled
        ? this.fourFourThreeLevelVolumeEnabled
          ? [0, 1, 2, 1]
          : [
              ...Array.from({ length: fourFourLoudBlockCount }, () => 2),
              ...Array.from({ length: fourFourQuietBlockCount }, () => 0),
            ]
        : null;
    const fourFourSidePolarityActive =
      fourFourHitModeActive &&
      !this.snareScoopEnabled &&
      !this.fourFourThreeLevelVolumeEnabled &&
      this.fourFourSidePolarityEnabled;
    const singleDotMiddleDepthSequence =
      !rowCompareActive && !patternDepthSequence && !hiHatDepthSequence && !reverbDepthSequence && !fourFourHitModeActive && !referenceHitSequence && !referenceBalancedVolumeSequence && !referenceMultipliedVolumeSequence && playableDots.length === 1 && volumeSteps === 3
        ? [0, 1, 2, 1]
        : null;
    const inverseClusteredVolumeSequenceActive =
      inverseDotMode && playableDots.length > 1 && fourFourVolumeLevelSequence !== null;

    // Get per-cycle volume multiplier (advances after this cycle completes)
    const perCycleVolumeMultiplier = this.audioService.getCurrentPerCycleVolumeMultiplier();
    const perCycleVolumeRedDotsOnly = this.audioService.getPerCycleVolumeRedDotsOnly();

    // Wave-based scheduling:
    // - waveInterval (from speed/hitRate) controls how often each wave of hits happens
    // - stagger controls the short delay between dots within each wave
    const waveInterval = 1 / hitRate; // seconds between waves
    const stagger = this.audioService.getHitModeStagger(); // seconds between dots within a wave
    const now = audioContext.getAudioContext().currentTime;
    const currentTime = (scheduledStartTime !== undefined && scheduledStartTime > now) ? scheduledStartTime : now;

    if (heldSequentialTargetDotKeys.length > 0 && playableDots.length === 0) {
      this.resetLoopSequencerVisualState();
      return;
    }

    // Check if per-dot volume wave is enabled
    const perDotWaveEnabled = this.audioService.isPerDotVolumeWaveEnabled();
    const tiltSingleDotKey = this.tiltOscillationEnabled && playableDots.length === 1 ? playableDots[0] : null;
    let tiltHitIndex = 0;
    let scheduledWaitGroupCount = 0;
    const scheduledVisualHitDotKeys: string[] = [];
    const scheduledVisualHitOffsets: number[] = [];
    let straightNoiseLoopDuration: number | null = null;

    const scheduleSequencerHit = (
      dotKey: string,
      hitTime: number,
      peakVolume: number,
      releaseOverride?: number,
      snareWaveEnabledOverride?: boolean | null,
      snareWavePhaseIndex?: number | null,
      bandwidthOverride?: number | null,
      bandpassRangeOverride?: BandpassRange | null
    ) => {
      scheduledVisualHitDotKeys.push(dotKey);
      scheduledVisualHitOffsets.push(Math.max(0, hitTime - currentTime));

      const hasBandwidthOverride = bandwidthOverride !== undefined && bandwidthOverride !== null;
      const bandwidth = hasBandwidthOverride ? bandwidthOverride : this.audioService.getNextBandwidthOscillationValue();
      let slopeOffsetDbPerOct: number | null = null;

      if (tiltSingleDotKey && dotKey === tiltSingleDotKey) {
        const sign = tiltHitIndex % 2 === 0 ? -1 : 1;
        tiltHitIndex++;
        slopeOffsetDbPerOct = sign * this.tiltOscillationAmount;
      }

      // A lead dot carries every dip for the dots sharing its column, so its bed
      // excludes all their bands and all of them pulse together on this hit.
      const inverseColumnBands = inverseDotColumnBandsByLead.get(dotKey) ?? null;

      this.audioService.schedulePointHit(
        dotKey,
        hitTime,
        attackTime,
        releaseOverride ?? releaseTime,
        peakVolume,
        bandwidth,
        slopeOffsetDbPerOct,
        snareWaveEnabledOverride,
        snareWavePhaseIndex,
        hasBandwidthOverride,
        bandpassRangeOverride,
        inverseColumnBands
      );
    };

    const scheduleStraightNoiseGain = (
      dotKey: string,
      hitTime: number,
      gain: number,
      includeVisualHit: boolean = true,
      bandwidthOverride?: number | null,
      bandpassRangeOverride?: BandpassRange | null
    ) => {
      if (includeVisualHit) {
        scheduledVisualHitDotKeys.push(dotKey);
        scheduledVisualHitOffsets.push(Math.max(0, hitTime - currentTime));
      }

      const hasBandwidthOverride = bandwidthOverride !== undefined && bandwidthOverride !== null;
      const bandwidth = hasBandwidthOverride ? bandwidthOverride : this.audioService.getNextBandwidthOscillationValue();
      let slopeOffsetDbPerOct: number | null = null;

      if (tiltSingleDotKey && dotKey === tiltSingleDotKey) {
        const sign = tiltHitIndex % 2 === 0 ? -1 : 1;
        tiltHitIndex++;
        slopeOffsetDbPerOct = sign * this.tiltOscillationAmount;
      }

      this.audioService.schedulePointGain(
        dotKey,
        hitTime,
        gain,
        bandwidth,
        slopeOffsetDbPerOct,
        null,
        null,
        hasBandwidthOverride,
        bandpassRangeOverride
      );
    };

    const volumeCycleSteps = volumeSteps <= 1
      ? [0]
      : [
          ...Array.from({ length: volumeSteps }, (_, index) => index),
          ...Array.from({ length: Math.max(0, volumeSteps - 2) }, (_, index) => volumeSteps - 2 - index),
        ];

    // Total waves = ping-pong volume cycle × hitsPerVolumeLevel
    // Each wave fires all dots (with stagger between them)
    const totalWaves = volumeCycleSteps.length * hitsPerVolumeLevel;

    if (!fourFourHalfBandPatternSequence) {
      this.audioService.stopSharedBandpassNoise(currentTime);
    }

    // Helper function to calculate volume for a specific volume step
    // volumeStep 0 = quietest (-hitDecayDb), volumeStep volumeSteps-1 = loudest (0dB)
    const calculateStepVolume = (baseVolume: number, volumeStep: number, stepCount = volumeSteps): number => {
      if (stepCount <= 1) {
        return baseVolume; // Single step at full volume
      }
      // Linear interpolation in dB: first step at -hitDecayDb, last step at 0
      const stepVolumeDb = -hitDecayDb * (1 - volumeStep / (stepCount - 1));
      const stepVolumeMultiplier = dbToGain(stepVolumeDb);
      return baseVolume * stepVolumeMultiplier;
    };

    const calculateMiddleAnchoredVolume = (baseVolume: number, balanceSign: -1 | 0 | 1): number => {
      const middleVolume = baseVolume * dbToGain(-hitDecayDb / 2);
      return middleVolume * dbToGain(balanceSign * this.referenceVolumeBalance * (hitDecayDb / 2));
    };

    const applyReferenceVolumeOffset = (dotKey: string, volume: number): number => {
      if (dotKey !== this.referenceDotKey) return volume;
      const oscillationDb = this.referenceVolumeOscillationEnabled
        ? this.getNextReferenceVolumeOscillationDb()
        : 0;
      return volume * dbToGain(this.referenceVolumeOffsetDb + oscillationDb);
    };

    // Helper to get volume info for a dot
    const getDotVolume = (
      dotKey: string,
      dotIndex: number,
      dotTotal: number,
      volumeStep: number,
      stepCount = volumeSteps,
      scheduledTime = currentTime
    ): number => {
      const isRedDot = this.redDots.has(dotKey);
      const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
      const allVolumeOscillationDb = this.getAllVolumeOscillationDb(scheduledTime, dotKey);
      const basePeakVolume = effectivePerCycleMultiplier * dbToGain(allVolumeOscillationDb + this.getSelectionVolumeDb(dotKey, scheduledTime));
      const perDotMultiplier = perDotWaveEnabled
        ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotTotal)
        : 1.0;
      return applyReferenceVolumeOffset(dotKey, calculateStepVolume(basePeakVolume * perDotMultiplier, volumeStep, stepCount));
    };

    const getHiHatDotVolume = (
      dotKey: string,
      dotIndex: number,
      dotTotal: number,
      volumeStep: number,
      scheduledTime = currentTime
    ): number => {
      const isRedDot = this.redDots.has(dotKey);
      const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
      const allVolumeOscillationDb = this.getAllVolumeOscillationDb(scheduledTime, dotKey);
      const basePeakVolume = effectivePerCycleMultiplier * dbToGain(allVolumeOscillationDb + this.getSelectionVolumeDb(dotKey, scheduledTime));
      const perDotMultiplier = perDotWaveEnabled
        ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotTotal)
        : 1.0;
      const dropDb = volumeStep >= 2 ? 0 : this.hiHatQuietDropDb;
      return applyReferenceVolumeOffset(dotKey, basePeakVolume * perDotMultiplier * dbToGain(-dropDb));
    };

    const getHiHatRelease = (volumeStep: number): number => {
      return volumeStep >= 2 ? releaseTime + this.hiHatLoudReleaseBoostMs / 1000 : releaseTime;
    };

    const getReverbDotVolume = (
      dotKey: string,
      dotIndex: number,
      dotTotal: number,
      volumeStep: number,
      scheduledTime = currentTime
    ): number => {
      if (volumeStep >= 2) return getHiHatDotVolume(dotKey, dotIndex, dotTotal, 2, scheduledTime);
      const isRedDot = this.redDots.has(dotKey);
      const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
      const allVolumeOscillationDb = this.getAllVolumeOscillationDb(scheduledTime, dotKey);
      const basePeakVolume = effectivePerCycleMultiplier * dbToGain(allVolumeOscillationDb + this.getSelectionVolumeDb(dotKey, scheduledTime));
      const perDotMultiplier = perDotWaveEnabled
        ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotTotal)
        : 1.0;
      const dropDb = volumeStep === 1 ? this.reverbVolumeSpreadDb : this.reverbVolumeSpreadDb * 2;
      return applyReferenceVolumeOffset(dotKey, basePeakVolume * perDotMultiplier * dbToGain(-dropDb));
    };

    const getPatternDepthDotVolume = (
      dotKey: string,
      dotIndex: number,
      dotTotal: number,
      volumeStep: number,
      scheduledTime = currentTime
    ): number => {
      const isRedDot = this.redDots.has(dotKey);
      const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
      const allVolumeOscillationDb = this.getAllVolumeOscillationDb(scheduledTime, dotKey);
      const basePeakVolume = effectivePerCycleMultiplier * dbToGain(allVolumeOscillationDb + this.getSelectionVolumeDb(dotKey, scheduledTime));
      const perDotMultiplier = perDotWaveEnabled
        ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotTotal)
        : 1.0;
      const quietDropDb = Math.max(0, (this.hiHatQuietDropDb - this.patternVolumeDiffDb) * 1.5);
      const dropDb = volumeStep >= 2 ? 0 : volumeStep === 1 ? quietDropDb / 2 : quietDropDb;
      return applyReferenceVolumeOffset(dotKey, basePeakVolume * perDotMultiplier * dbToGain(-dropDb));
    };

    const getFourFourDotVolume = (
      dotKey: string,
      dotIndex: number,
      dotTotal: number,
      volumeLevel: number,
      scheduledTime = currentTime
    ): number => {
      const isRedDot = this.redDots.has(dotKey);
      const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
      const allVolumeOscillationDb = this.getAllVolumeOscillationDb(scheduledTime, dotKey);
      const selectionVolumeDb = fourFourStraightNoiseActive
        ? this.getSharedSelectionVolumeDb(scheduledTime)
        : this.getSelectionVolumeDb(dotKey, scheduledTime);
      const basePeakVolume = effectivePerCycleMultiplier * dbToGain(allVolumeOscillationDb + selectionVolumeDb);
      const perDotMultiplier = perDotWaveEnabled
        ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotTotal)
        : 1.0;
      const gainVolumeLevel = this.loudQuietBandwidthModeEnabled ? 2 : volumeLevel;
      return applyReferenceVolumeOffset(
        dotKey,
        basePeakVolume * perDotMultiplier * dbToGain(
          gainVolumeLevel >= 2 ? 0 : gainVolumeLevel === 1 ? -this.hiHatQuietDropDb / 2 : -this.hiHatQuietDropDb
        )
      );
    };

    const getSidePolarityVolumeLevel = (dotKey: string, volumeLevel: number): number => {
      if (!fourFourSidePolarityActive) return volumeLevel;
      const coordinates = this.parseDotKey(dotKey);
      if (!coordinates || this.columnCount <= 1) return volumeLevel;

      const centerCol = (this.columnCount - 1) / 2;
      if (coordinates.x === centerCol) return volumeLevel;
      const isRightSide = coordinates.x > centerCol;

      if (!isRightSide) return volumeLevel;
      return volumeLevel >= 2 ? 0 : 2;
    };

    const scheduleHeldTargetGains = (
      activeDotKey: string,
      hitTime: number,
      volumeLevel: number
    ): void => {
      if (heldSequentialTargetDotKeys.length === 0) return;

      const activeColumn = inverseDotMode ? this.parseDotKey(activeDotKey)?.x ?? null : null;
      heldSequentialTargetDotKeys.forEach((heldDotKey, heldIndex) => {
        const heldColumn = this.parseDotKey(heldDotKey)?.x ?? null;
        if (inverseDotMode && activeColumn !== null && heldColumn === activeColumn) return;

        const effectiveVolumeLevel = getSidePolarityVolumeLevel(heldDotKey, volumeLevel);
        const gain = 0.8 * getFourFourDotVolume(
          heldDotKey,
          heldIndex,
          heldSequentialTargetDotKeys.length,
          effectiveVolumeLevel,
          hitTime
        );
        this.audioService.schedulePointGain(
          heldDotKey,
          hitTime,
          gain,
          this.getLoudQuietBandwidthOverride(effectiveVolumeLevel),
          null,
          null,
          null,
          this.loudQuietBandwidthModeEnabled
        );
      });
    };

    const getRowCompareDotVolume = (
      dotKey: string,
      dotIndex: number,
      dotTotal: number,
      rowVolumeDb: number,
      scheduledTime = currentTime
    ): number => {
      const isRedDot = this.redDots.has(dotKey);
      const effectivePerCycleMultiplier = (perCycleVolumeRedDotsOnly && !isRedDot) ? 1.0 : perCycleVolumeMultiplier;
      const allVolumeOscillationDb = this.getAllVolumeOscillationDb(scheduledTime, dotKey);
      const basePeakVolume = effectivePerCycleMultiplier * dbToGain(allVolumeOscillationDb + rowVolumeDb);
      const perDotMultiplier = perDotWaveEnabled
        ? this.audioService.getPerDotVolumeWaveMultiplier(dotIndex, dotTotal)
        : 1.0;
      return applyReferenceVolumeOffset(dotKey, basePeakVolume * perDotMultiplier);
    };

    const getRowAlternationGroups = (): {
      top: string[];
      full: string[];
      bottom: string[];
    } | null => {
      const rowGroups = new Map<number, string[]>();

      playableDots.forEach((dotKey) => {
        const coordinates = this.parseDotKey(dotKey);
        if (!coordinates) return;
        if (!rowGroups.has(coordinates.y)) rowGroups.set(coordinates.y, []);
        rowGroups.get(coordinates.y)!.push(dotKey);
      });

      const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => b[0] - a[0]);
      if (sortedRows.length === 0) return null;

      sortedRows.forEach(([, dotKeys]) => {
        dotKeys.sort((a, b) => (this.parseDotKey(a)?.x ?? 0) - (this.parseDotKey(b)?.x ?? 0));
      });

      const top = sortedRows[0]?.[1] ?? [];
      const bottom = sortedRows[sortedRows.length - 1]?.[1] ?? top;
      const full = sortedRows.flatMap(([, dotKeys]) => dotKeys);

      return full.length > 0 ? { top, full, bottom } : null;
    };

    // Schedule hits for all dots in this loop cycle
    // In all modes, each wave fires all playable dots with stagger, and waves are spaced by waveInterval
    if (this.audioService.getLoopSequencerPlayTogether()) {
      // Play all dots together mode: all dots in each wave, staggered
      volumeCycleSteps.forEach((volumeStep, cycleStepIndex) => {
        for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
          const waveIndex = cycleStepIndex * hitsPerVolumeLevel + hit;
          const waveTime = currentTime + waveIndex * waveInterval;
          let playableIndex = 0;
          sequencerDotKeys.forEach((dotKey) => {
            if (!this.shouldRedDotPlay(dotKey)) return;
            const hitTime = waveTime + playableIndex * stagger;
            const peakVolume = getDotVolume(dotKey, playableIndex, playableDots.length, volumeStep, volumeSteps, hitTime);
            scheduleSequencerHit(dotKey, hitTime, peakVolume);
            playableIndex++;
          });
        }
      });
    } else if (this.audioService.getInterleavedHits()) {
      // Interleaved mode: each wave fires all dots with stagger
      const playableDotCount = playableDots.length;

      if (playableDotCount > 0) {
        volumeCycleSteps.forEach((volumeStep, cycleStepIndex) => {
          for (let hitCycle = 0; hitCycle < hitsPerVolumeLevel; hitCycle++) {
            const waveIndex = cycleStepIndex * hitsPerVolumeLevel + hitCycle;
            const waveTime = currentTime + waveIndex * waveInterval;
            playableDots.forEach((dotKey, dotIndex) => {
              const hitTime = waveTime + dotIndex * stagger;
              const peakVolume = getDotVolume(dotKey, dotIndex, playableDotCount, volumeStep, volumeSteps, hitTime);
              scheduleSequencerHit(dotKey, hitTime, peakVolume);
            });
          }
        });
      }
    } else if (referenceMultipliedVolumeSequence) {
      // Reference multiply mode: each non-gold dot repeats against gold
      // without changing volume, so the comparison stays purely positional.
      let hitIndex = 0;

      referenceMultipliedVolumeSequence.forEach((dotKey) => {
        const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
        for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
          const hitTime = currentTime + hitIndex * stagger;
          const peakVolume = getDotVolume(dotKey, dotIndex, dotCount, Math.max(0, volumeSteps - 1), volumeSteps, hitTime);
          scheduleSequencerHit(dotKey, hitTime, peakVolume);
          hitIndex++;
        }
      });
    } else if (referenceBalancedVolumeSequence) {
      // Three-dot reference-volume mode: the gold dot stays at middle depth,
      // while the two other positions tilt quieter/louder around it.
      let hitIndex = 0;

      referenceBalancedVolumeSequence.forEach(({ dotKey, balanceSign }) => {
        const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
        for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
          const hitTime = currentTime + hitIndex * stagger;
          const baseVolume = getDotVolume(dotKey, dotIndex, dotCount, 2, volumeSteps, hitTime);
          const peakVolume = calculateMiddleAnchoredVolume(baseVolume, balanceSign);
          scheduleSequencerHit(dotKey, hitTime, peakVolume);
          hitIndex++;
        }
      });
    } else if (referenceHiHatHitSequence) {
      // Gold hi-hat mode: play each non-gold once, then the reference dot
      // three times. Gold-specific volume effects still run in getDotVolume.
      let hitIndex = 0;

      referenceHiHatHitSequence.forEach((dotKey) => {
        const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
        const loudStep = Math.max(0, volumeSteps - 1);
        const hitTime = currentTime + hitIndex * stagger;
        const peakVolume = getDotVolume(dotKey, dotIndex, dotCount, loudStep, volumeSteps, hitTime);
        const releaseForGoldHatHit = dotKey === this.referenceDotKey ? releaseTime : getHiHatRelease(2);
        scheduleSequencerHit(dotKey, hitTime, peakVolume, releaseForGoldHatHit);
        hitIndex++;
      });
    } else if (referenceHitSequence) {
      // Reference-dot mode: each ordinary hit is immediately followed by the
      // marked reference dot, so the ear always compares against the same place.
      let hitIndex = 0;

      volumeCycleSteps.forEach((volumeStep) => {
        referenceHitSequence.forEach((dotKey) => {
          const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const hitTime = currentTime + hitIndex * stagger;
            const peakVolume = getDotVolume(dotKey, dotIndex, dotCount, volumeStep, volumeSteps, hitTime);
            scheduleSequencerHit(dotKey, hitTime, peakVolume);
            hitIndex++;
          }
        });
      });
    } else if (rowCompareGroups) {
      // Row compare: play row A as full row passes, repeat, then row B.
      // Each row gets its own volume offset while sharing the same synthesis path.
      let hitIndex = 0;
      let passIndex = 0;
      scheduledWaitGroupCount = rowCompareGroups.length * this.rowCompareRepeats;

      rowCompareGroups.forEach(({ dotKeys, volumeDb }) => {
        for (let repeat = 0; repeat < this.rowCompareRepeats; repeat++) {
          const waitOffset = passIndex * this.loopWaveWaitSeconds;
          dotKeys.forEach((dotKey, dotIndex) => {
            for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
              const hitTime = currentTime + hitIndex * stagger + waitOffset;
              const peakVolume = getRowCompareDotVolume(dotKey, dotIndex, dotKeys.length, volumeDb, hitTime);
              scheduleSequencerHit(dotKey, hitTime, peakVolume);
              hitIndex++;
            }
          });
          passIndex++;
        }
      });
    } else if (experimentalClusterMode) {
      // Experimental: fire every selected dot as a tight cluster, alternating
      // quiet/loud from the depth range for two cycles.
      const clusterWindow = Math.max(0.02, Math.min(0.08, stagger * 0.35));
      const shortStagger = Math.min(0.025, clusterWindow / Math.max(1, playableDots.length - 1));
      const releaseBoost = Math.min(0.35, Math.max(0.08, stagger * 0.4));
      const experimentalRelease = releaseTime + releaseBoost;

      experimentalDepthSequence?.forEach((volumeStep, waveIndex) => {
        const waveTime = currentTime + waveIndex * stagger;

        playableDots.forEach((dotKey, dotIndex) => {
          const hitTime = waveTime + dotIndex * shortStagger;
          const peakVolume = getDotVolume(dotKey, dotIndex, playableDots.length, volumeStep, volumeSteps, hitTime);
          scheduleSequencerHit(dotKey, hitTime, peakVolume, experimentalRelease);
        });
      });
    } else if (rhythmPatternActive) {
      // Rhythm pattern: the first three selected dots run concurrent rhythms
      // on one quarter-note clock: half notes, quarter notes, then clave.
      const beatSeconds = Math.max(0.01, this.continuousLoudQuietStepSeconds);
      const loudStep = Math.max(0, volumeSteps - 1);
      const rhythmEvents = rhythmPatternDotKeys.flatMap((dotKey, dotIndex) => (
        (RHYTHM_PATTERN_BEAT_OFFSETS[dotIndex] ?? []).map((beatOffset) => ({
          dotKey,
          dotIndex,
          beatOffset,
        }))
      )).sort((a, b) => a.beatOffset - b.beatOffset || a.dotIndex - b.dotIndex);

      rhythmEvents.forEach(({ dotKey, dotIndex, beatOffset }) => {
        const hitTime = currentTime + beatOffset * beatSeconds;
        const peakVolume = getDotVolume(
          dotKey,
          dotIndex,
          rhythmPatternDotKeys.length,
          loudStep,
          volumeSteps,
          hitTime
        );
        scheduleSequencerHit(dotKey, hitTime, peakVolume);
      });

      straightNoiseLoopDuration = RHYTHM_PATTERN_BEAT_COUNT * beatSeconds;
    } else if (fourFourStraightNoiseActive) {
      const stepSeconds = Math.max(0.01, this.continuousLoudQuietStepSeconds);
      const hitRepeats = Math.max(1, hitsPerVolumeLevel);
      const blockSize = Math.max(1, this.fourFourVolumeBlockSize);
      const cycleSeconds = Math.max(0.02, stepSeconds * blockSize * hitRepeats);
      const loudSeconds = Math.max(0.001, cycleSeconds * this.continuousLoudQuietRatio);
      const quietStartOffset = Math.min(cycleSeconds - 0.001, loudSeconds);

      const scheduleHeldCycle = (
        dotKey: string,
        dotIndex: number,
        dotTotal: number,
        startTime: number
      ) => {
        const firstVolumeLevel = getSidePolarityVolumeLevel(dotKey, 2);
        const secondVolumeLevel = getSidePolarityVolumeLevel(dotKey, 0);
        const firstGain = getFourFourDotVolume(dotKey, dotIndex, dotTotal, firstVolumeLevel, startTime);
        const secondGain = getFourFourDotVolume(dotKey, dotIndex, dotTotal, secondVolumeLevel, startTime + quietStartOffset);

        scheduleStraightNoiseGain(
          dotKey,
          startTime,
          firstGain,
          true,
          this.getLoudQuietBandwidthOverride(firstVolumeLevel)
        );
        scheduleStraightNoiseGain(
          dotKey,
          startTime + quietStartOffset,
          secondGain,
          true,
          this.getLoudQuietBandwidthOverride(secondVolumeLevel)
        );
        this.audioService.schedulePointGain(dotKey, startTime + cycleSeconds, 0);
      };

      if (this.fourFourVolumePerDot) {
        const groupDuration = cycleSeconds + this.loopWaveWaitSeconds;
        scheduledWaitGroupCount = playableDots.length;
        playableDots.forEach((dotKey, dotIndex) => {
          scheduleHeldCycle(dotKey, dotIndex, playableDots.length, currentTime + dotIndex * groupDuration);
        });
        straightNoiseLoopDuration = Math.max(cycleSeconds, playableDots.length * groupDuration);
      } else {
        scheduledWaitGroupCount = 1;
        playableDots.forEach((dotKey, dotIndex) => {
          scheduleHeldCycle(dotKey, dotIndex, playableDots.length, currentTime);
        });
        straightNoiseLoopDuration =
          cycleSeconds +
          this.loopWaveWaitSeconds;
      }
    } else if (fourFourRowAlternationActive) {
      // Row alternation: gate the actual continuous dot sources using the
      // half-band step shape: top row, all rows, bottom row, all rows.
      const rowGroups = getRowAlternationGroups();
      const stepSeconds = Math.max(0.01, this.continuousLoudQuietStepSeconds);
      const stepHoldSeconds = Math.max(0.01, stepSeconds * Math.max(1, hitsPerVolumeLevel));

      if (rowGroups) {
        const patternGroups: Record<RowAlternationPatternStep, string[]> = {
          top: rowGroups.top,
          full: rowGroups.full,
          bottom: rowGroups.bottom,
        };
        const dotOrderIndex = new Map(rowGroups.full.map((dotKey, index) => [dotKey, index]));
        const sequenceSeconds =
          ROW_ALTERNATION_PATTERN_SEQUENCE.length * stepHoldSeconds +
          ROW_ALTERNATION_PATTERN_SEQUENCE.length * this.loopWaveWaitSeconds;

        scheduledWaitGroupCount = ROW_ALTERNATION_PATTERN_SEQUENCE.length;
        ROW_ALTERNATION_PATTERN_SEQUENCE.forEach((rowStep, stepIndex) => {
          const stepDotKeys = patternGroups[rowStep];
          const stepDotSet = new Set(stepDotKeys);
          const stepStartTime =
            currentTime +
            stepIndex * stepHoldSeconds +
            stepIndex * this.loopWaveWaitSeconds;
          const stepEndTime = stepStartTime + stepHoldSeconds;
          const visualDotKey = stepDotKeys[0] ?? rowGroups.full[0];

          if (visualDotKey) {
            scheduledVisualHitDotKeys.push(visualDotKey);
            scheduledVisualHitOffsets.push(Math.max(0, stepStartTime - currentTime));
          }

          rowGroups.full.forEach((dotKey) => {
            const dotIndex = dotOrderIndex.get(dotKey) ?? 0;
            const gain = stepDotSet.has(dotKey)
              ? getFourFourDotVolume(dotKey, dotIndex, rowGroups.full.length, 2, stepStartTime)
              : 0;

            if (gain > 0) {
              scheduleStraightNoiseGain(
                dotKey,
                stepStartTime,
                gain,
                false,
                this.getLoudQuietBandwidthOverride(2)
              );
            } else {
              this.audioService.schedulePointGain(dotKey, stepStartTime, 0);
            }

            this.audioService.schedulePointGain(dotKey, stepEndTime, 0);
          });
        });

        straightNoiseLoopDuration = sequenceSeconds;
      }
    } else if (fourFourHalfBandPatternSequence) {
      // Band-split held-noise mode: one shared noise source through one
      // highpass/lowpass pair, stepped on one clock.
      const fourFourHitInterval = Math.max(0.01, this.continuousLoudQuietStepSeconds);
      const halfBandStepCount = fourFourHalfBandPatternSequence.length * hitsPerVolumeLevel;
      const halfBandSequenceSeconds =
        halfBandStepCount * fourFourHitInterval +
        fourFourHalfBandPatternSequence.length * this.loopWaveWaitSeconds;
      const fullRange = this.getCombinedHalfBandPatternRange(playableDots);

      if (fullRange) {
        let visualStepIndex = 0;
        scheduledWaitGroupCount = fourFourHalfBandPatternSequence.length;
        fourFourHalfBandPatternSequence.forEach((bandStep, waveIndex) => {
          const stepStartTime =
            currentTime +
            waveIndex * hitsPerVolumeLevel * fourFourHitInterval +
            waveIndex * this.loopWaveWaitSeconds;
          const range = this.getHalfBandPatternRange(fullRange, bandStep);
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const hitTime = stepStartTime + hit * fourFourHitInterval;
            const gainMultiplier = 0.8 * dbToGain(
              this.getAllVolumeOscillationDb(hitTime) +
              this.getSharedSelectionVolumeDb(hitTime)
            );
            const visualDotKey = playableDots[visualStepIndex % playableDots.length]!;
            const panValue = this.audioService.getPointPanValue(visualDotKey) ?? 0;
            this.audioService.scheduleSharedBandpassNoise(
              range,
              hitTime,
              gainMultiplier,
              DEFAULT_SHARED_BANDPASS_NOISE_ID,
              panValue
            );
            scheduledVisualHitDotKeys.push(visualDotKey);
            scheduledVisualHitOffsets.push(Math.max(0, hitTime - currentTime));
            visualStepIndex++;
          }
        });
        this.audioService.scheduleSharedBandpassGain(currentTime + halfBandSequenceSeconds, 0);
        straightNoiseLoopDuration = halfBandSequenceSeconds;
      }
    } else if (fourFourSnareWavePhaseSequence) {
      // Normal-hit block mode: four phase-shifted wave passes, then four flat passes.
      let hitIndex = 0;
      const loudStep = Math.max(0, volumeSteps - 1);
      scheduledWaitGroupCount = fourFourSnareWavePhaseSequence.length;

      fourFourSnareWavePhaseSequence.forEach((snareWavePhaseIndex, waveIndex) => {
        const snareWaveEnabled = snareWavePhaseIndex !== null;
        const waitOffset = waveIndex * this.loopWaveWaitSeconds;
        playableDots.forEach((dotKey, dotIndex) => {
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const hitTime = currentTime + hitIndex * stagger + waitOffset;
            const peakVolume = getDotVolume(dotKey, dotIndex, playableDots.length, loudStep, volumeSteps, hitTime);
            scheduleSequencerHit(
              dotKey,
              hitTime,
              peakVolume,
              undefined,
              snareWaveEnabled,
              snareWavePhaseIndex
            );
            hitIndex++;
          }
        });
      });
    } else if (fourFourVolumeLevelSequence) {
      // Normal-hit block mode without the wave: either each pass visits all dots,
      // inverse-dot clusters all dots inside a shared volume step, or each dot
      // gets the whole loud/quiet block before advancing.
      let hitIndex = 0;
      const fourFourHitInterval = this.loudQuietBandwidthModeEnabled
        ? Math.max(0.01, this.continuousLoudQuietStepSeconds)
        : stagger;
      const inverseClusterStagger = Math.min(
        Math.max(0.001, stagger),
        Math.max(0.001, fourFourHitInterval * 0.12),
        0.025
      );
      const playFullVolumeSequencePerDot =
        !inverseClusteredVolumeSequenceActive && (this.fourFourVolumePerDot || this.fourFourThreeLevelVolumeEnabled);

      if (inverseClusteredVolumeSequenceActive) {
        scheduledWaitGroupCount = fourFourVolumeLevelSequence.length;
        let clusterIndex = 0;
        fourFourVolumeLevelSequence.forEach((volumeLevel, waveIndex) => {
          const waitOffset = waveIndex * this.loopWaveWaitSeconds;
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const clusterStartTime = currentTime + clusterIndex * fourFourHitInterval + waitOffset;
            playableDots.forEach((dotKey, dotIndex) => {
              const hitTime = clusterStartTime + dotIndex * inverseClusterStagger;
              const effectiveVolumeLevel = getSidePolarityVolumeLevel(dotKey, volumeLevel);
              const peakVolume = getFourFourDotVolume(dotKey, dotIndex, playableDots.length, effectiveVolumeLevel, hitTime);
              scheduleSequencerHit(
                dotKey,
                hitTime,
                peakVolume,
                undefined,
                undefined,
                undefined,
                this.getLoudQuietBandwidthOverride(effectiveVolumeLevel)
              );
              scheduleHeldTargetGains(dotKey, hitTime, effectiveVolumeLevel);
            });
            clusterIndex++;
          }
        });
      } else if (playFullVolumeSequencePerDot) {
        scheduledWaitGroupCount = playableDots.length;
        playableDots.forEach((dotKey, dotIndex) => {
          const waitOffset = dotIndex * this.loopWaveWaitSeconds;
          fourFourVolumeLevelSequence.forEach((volumeLevel) => {
            for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
              const hitTime = currentTime + hitIndex * fourFourHitInterval + waitOffset;
              const effectiveVolumeLevel = getSidePolarityVolumeLevel(dotKey, volumeLevel);
              const peakVolume = getFourFourDotVolume(dotKey, dotIndex, playableDots.length, effectiveVolumeLevel, hitTime);
              scheduleSequencerHit(
                dotKey,
                hitTime,
                peakVolume,
                undefined,
                undefined,
                undefined,
                this.getLoudQuietBandwidthOverride(effectiveVolumeLevel)
              );
              scheduleHeldTargetGains(dotKey, hitTime, effectiveVolumeLevel);
              hitIndex++;
            }
          });
        });
      } else {
        scheduledWaitGroupCount = fourFourVolumeLevelSequence.length;
        fourFourVolumeLevelSequence.forEach((volumeLevel, waveIndex) => {
          const waitOffset = waveIndex * this.loopWaveWaitSeconds;
          playableDots.forEach((dotKey, dotIndex) => {
            for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
              const hitTime = currentTime + hitIndex * fourFourHitInterval + waitOffset;
              const effectiveVolumeLevel = getSidePolarityVolumeLevel(dotKey, volumeLevel);
              const peakVolume = getFourFourDotVolume(dotKey, dotIndex, playableDots.length, effectiveVolumeLevel, hitTime);
              scheduleSequencerHit(
                dotKey,
                hitTime,
                peakVolume,
                undefined,
                undefined,
                undefined,
                this.getLoudQuietBandwidthOverride(effectiveVolumeLevel)
              );
              scheduleHeldTargetGains(dotKey, hitTime, effectiveVolumeLevel);
              hitIndex++;
            }
          });
        });
      }
    } else if (patternDepthSequence) {
      // Pattern mode: every selected dot walks through loud / quiet / quiet / quiet,
      // with dots interleaved at each pattern step.
      let hitIndex = 0;

      patternDepthSequence.forEach((volumeStep) => {
        playableDots.forEach((dotKey) => {
          const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const hitTime = currentTime + hitIndex * stagger;
            const peakVolume = getPatternDepthDotVolume(dotKey, dotIndex, dotCount, volumeStep, hitTime);
            scheduleSequencerHit(dotKey, hitTime, peakVolume, getHiHatRelease(volumeStep));
            hitIndex++;
          }
        });
      });
    } else if (hiHatDepthSequence) {
      // Hi-hat mode: each playable dot walks through the chosen accent
      // cycle, interleaved one dot per hit. With two dots, the second dot's
      // accent cycle is offset by two hits so the loud accents answer each
      // other instead of landing together.
      let hitIndex = 0;

      if (playableDots.length === 2) {
        const totalHits = hiHatDepthSequence.length * playableDots.length * hitsPerVolumeLevel;
        for (let sequenceHit = 0; sequenceHit < totalHits; sequenceHit++) {
          const dotOrderIndex = sequenceHit % playableDots.length;
          const dotKey = playableDots[dotOrderIndex];
          const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
          const dotHitIndex = Math.floor(sequenceHit / playableDots.length);
          const shiftedHitIndex = (dotHitIndex - dotOrderIndex * 2 + hiHatDepthSequence.length) % hiHatDepthSequence.length;
          const volumeStep = hiHatDepthSequence[shiftedHitIndex] ?? 0;
          const hitTime = currentTime + hitIndex * stagger;
          const peakVolume = getHiHatDotVolume(dotKey, dotIndex, dotCount, volumeStep, hitTime);
          scheduleSequencerHit(dotKey, hitTime, peakVolume, getHiHatRelease(volumeStep));
          hitIndex++;
        }
      } else {
        hiHatDepthSequence.forEach((volumeStep) => {
          playableDots.forEach((dotKey) => {
            const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
            for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
              const hitTime = currentTime + hitIndex * stagger;
              const peakVolume = getHiHatDotVolume(dotKey, dotIndex, dotCount, volumeStep, hitTime);
              scheduleSequencerHit(dotKey, hitTime, peakVolume, getHiHatRelease(volumeStep));
              hitIndex++;
            }
          });
        });
      }
    } else if (reverbDepthSequence) {
      // Reverb mode: loud every 16 hits, medium every 4 hits, quiet between.
      let hitIndex = 0;

      reverbDepthSequence.forEach((volumeStep) => {
        playableDots.forEach((dotKey) => {
          const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const hitTime = currentTime + hitIndex * stagger;
            const peakVolume = getReverbDotVolume(dotKey, dotIndex, dotCount, volumeStep, hitTime);
            scheduleSequencerHit(dotKey, hitTime, peakVolume, getHiHatRelease(volumeStep));
            hitIndex++;
          }
        });
      });
    } else if (singleDotMiddleDepthSequence) {
      // One-dot 3x-depth mode: use the middle volume as the anchor, mirroring
      // the reference-dot A/B pattern without needing a second spatial dot.
      const dotKey = playableDots[0];
      const dotIndex = Math.max(0, sequencerDotKeys.indexOf(dotKey));
      let hitIndex = 0;

      singleDotMiddleDepthSequence.forEach((volumeStep) => {
        for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
          const hitTime = currentTime + hitIndex * stagger;
          const peakVolume = getDotVolume(dotKey, dotIndex, dotCount, volumeStep, volumeSteps, hitTime);
          scheduleSequencerHit(dotKey, hitTime, peakVolume);
          hitIndex++;
        }
      });
    } else {
      // Non-interleaved mode: walk the ping-pong depth layer as a wave:
      // every selected dot plays at layer 1, then every dot at layer 2, etc.
      let hitIndex = 0;

      // Optional back-and-forth dot order: A B C B (then loop) instead of
      // A B C. The endpoints are not doubled so the sweep stays even.
      const sequenceDots = this.sequencerPingPongEnabled && playableDots.length > 2
        ? [...playableDots, ...playableDots.slice(1, -1).reverse()]
        : playableDots;

      volumeCycleSteps.forEach((volumeStep) => {
        sequenceDots.forEach((dotKey) => {
          const dotIndex = Math.max(0, playableDots.indexOf(dotKey));
          for (let hit = 0; hit < hitsPerVolumeLevel; hit++) {
            const hitTime = currentTime + hitIndex * stagger;
            const peakVolume = getDotVolume(dotKey, dotIndex, playableDots.length, volumeStep, volumeSteps, hitTime);
            scheduleSequencerHit(dotKey, hitTime, peakVolume);
            hitIndex++;
          }
        });
      });
    }

    // Advance per-cycle volume for the next cycle
    this.audioService.advancePerCycleVolume();

    // Advance per-dot volume wave phase for the "moving wave" effect
    this.audioService.advancePerDotVolumeWavePhase();

    // Advance cycle counter for red dot scheduling
    this.advanceCycleCounter();

    // Loop duration depends on mode:
    // - play-together / interleaved: totalWaves * waveInterval
    // - non-interleaved (sequential): packed hits plus the last release tail
    const isSequentialMode = !this.audioService.getLoopSequencerPlayTogether() && !this.audioService.getInterleavedHits();
    const hitsPerDot = volumeCycleSteps.length * hitsPerVolumeLevel;
    const playableDotCount = playableDots.length;
    const referenceHiHatHits = referenceHiHatHitSequence
      ? referenceHiHatHitSequence.length
      : 0;
    const referenceSequentialHits = referenceHitSequence
      ? referenceHitSequence.length * volumeCycleSteps.length * hitsPerVolumeLevel
      : 0;
    const referenceMultipliedVolumeHits = referenceMultipliedVolumeSequence
      ? referenceMultipliedVolumeSequence.length * hitsPerVolumeLevel
      : 0;
    const referenceBalancedVolumeHits = referenceBalancedVolumeSequence
      ? referenceBalancedVolumeSequence.length * hitsPerVolumeLevel
      : 0;
    const rowCompareHits = rowCompareGroups
      ? rowCompareGroups.reduce((total, group) => total + group.dotKeys.length * this.rowCompareRepeats * hitsPerVolumeLevel, 0)
      : 0;
    const experimentalClusterWaves = experimentalDepthSequence ? experimentalDepthSequence.length : 0;
    const fourFourStraightNoiseHits = fourFourStraightNoiseActive
      ? scheduledVisualHitDotKeys.length
      : 0;
    const fourFourRowAlternationHits = fourFourRowAlternationActive
      ? scheduledVisualHitDotKeys.length
      : 0;
    const fourFourHitModeSequence = fourFourSnareWavePhaseSequence ?? fourFourHalfBandPatternSequence ?? fourFourVolumeLevelSequence;
    const fourFourHitModeHits = fourFourHitModeSequence
      ? fourFourHalfBandPatternSequence || (fourFourVolumeLevelSequence !== null && inverseClusteredVolumeSequenceActive)
        ? fourFourHitModeSequence.length * hitsPerVolumeLevel
        : fourFourHitModeSequence.length * playableDotCount * hitsPerVolumeLevel
      : 0;
    const rhythmPatternHits = rhythmPatternActive
      ? scheduledVisualHitDotKeys.length
      : 0;
    const patternDepthHits = patternDepthSequence
      ? patternDepthSequence.length * playableDotCount * hitsPerVolumeLevel
      : 0;
    const hiHatDepthHits = hiHatDepthSequence
      ? hiHatDepthSequence.length * playableDotCount * hitsPerVolumeLevel
      : 0;
    const reverbDepthHits = reverbDepthSequence
      ? reverbDepthSequence.length * playableDotCount * hitsPerVolumeLevel
      : 0;
    const singleDotMiddleDepthHits = singleDotMiddleDepthSequence
      ? singleDotMiddleDepthSequence.length * hitsPerVolumeLevel
      : 0;
    const totalSequentialHits = referenceMultipliedVolumeSequence
      ? referenceMultipliedVolumeHits
      : referenceBalancedVolumeSequence
      ? referenceBalancedVolumeHits
      : referenceHiHatHitSequence
      ? referenceHiHatHits
      : referenceHitSequence
      ? referenceSequentialHits
      : rowCompareGroups
      ? rowCompareHits
      : experimentalClusterMode
      ? experimentalClusterWaves
      : fourFourStraightNoiseActive
      ? fourFourStraightNoiseHits
      : fourFourRowAlternationActive
      ? fourFourRowAlternationHits
      : fourFourHitModeSequence
      ? fourFourHitModeHits
      : rhythmPatternActive
      ? rhythmPatternHits
      : patternDepthSequence
      ? patternDepthHits
      : hiHatDepthSequence
      ? hiHatDepthHits
      : reverbDepthSequence
      ? reverbDepthHits
      : singleDotMiddleDepthSequence
        ? singleDotMiddleDepthHits
        : (this.sequencerPingPongEnabled && playableDotCount > 2
            ? playableDotCount * 2 - 2
            : playableDotCount) * hitsPerDot;
    const effectiveSequentialMode = isSequentialMode || rowCompareActive || fourFourHitModeActive || rhythmPatternActive;
    const effectiveSequentialHitInterval = rhythmPatternActive
      ? Math.max(0.01, this.continuousLoudQuietStepSeconds)
      : (this.loudQuietBandwidthModeEnabled && fourFourVolumeLevelSequence) || fourFourHalfBandPatternSequence || fourFourRowAlternationActive
      ? Math.max(0.01, this.continuousLoudQuietStepSeconds)
      : stagger;
    const inverseClusterTailDuration = inverseClusteredVolumeSequenceActive
      ? Math.max(0, playableDotCount - 1) * Math.min(
          Math.max(0.001, stagger),
          Math.max(0.001, effectiveSequentialHitInterval * 0.12),
          0.025
        )
      : 0;
    // Loop period is a strict hit grid (hits x interval), independent of the
    // envelope, so long releases overlap the next cycle instead of inserting
    // a gap between loops.
    const sequentialLoopDuration = totalSequentialHits <= 0
      ? 0
      : totalSequentialHits * effectiveSequentialHitInterval + inverseClusterTailDuration;
    const waitDuration = this.loopWaveWaitSeconds * Math.max(1, scheduledWaitGroupCount);
    const loopDuration = straightNoiseLoopDuration !== null
      ? straightNoiseLoopDuration
      : effectiveSequentialMode
      ? sequentialLoopDuration + waitDuration
      : totalWaves * waveInterval + this.loopWaveWaitSeconds;

    const loopDelayMs = loopDuration * 1000;
    const sequentialVisualHitDotKeys = effectiveSequentialMode && scheduledVisualHitDotKeys.length > 0
      ? scheduledVisualHitDotKeys
      : null;
    this.loopSequencerVisualDotKeys = referenceMultipliedVolumeSequence ?? referenceBalancedVolumeSequence?.map(({ dotKey }) => dotKey) ?? referenceHiHatHitSequence ?? referenceHitSequence ?? rowCompareGroups?.flatMap(({ dotKeys }) => dotKeys) ?? (rhythmPatternActive ? rhythmPatternDotKeys : playableDots);
    this.loopSequencerVisualCycleStartTime = currentTime;
    this.loopSequencerVisualHitInterval = effectiveSequentialMode ? effectiveSequentialHitInterval : waveInterval;
    this.loopSequencerVisualTotalHitsPerDot = hitsPerDot;
    this.loopSequencerVisualCycleHits = Math.max(1, sequentialVisualHitDotKeys ? sequentialVisualHitDotKeys.length : effectiveSequentialMode ? totalSequentialHits : totalWaves);
    this.loopSequencerVisualBeatBase = this.loopSequencerVisualNextBeatBase;
    this.loopSequencerVisualNextBeatBase = this.loopSequencerVisualBeatBase + this.loopSequencerVisualCycleHits;
    this.loopSequencerVisualInterleaved = effectiveSequentialMode ? false : this.audioService.getInterleavedHits();
    this.loopSequencerVisualPlayTogether = effectiveSequentialMode ? false : this.audioService.getLoopSequencerPlayTogether();
    this.loopSequencerVisualHitOffsets = sequentialVisualHitDotKeys ? scheduledVisualHitOffsets : null;
    this.loopSequencerVisualHitDotKeys = sequentialVisualHitDotKeys
      ?? (isSequentialMode && referenceMultipliedVolumeSequence
      ? referenceMultipliedVolumeSequence.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
      : isSequentialMode && referenceBalancedVolumeSequence
      ? referenceBalancedVolumeSequence.flatMap(({ dotKey }) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
      : isSequentialMode && referenceHiHatHitSequence
      ? referenceHiHatHitSequence
      : isSequentialMode && referenceHitSequence
      ? volumeCycleSteps.flatMap(() =>
          referenceHitSequence.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
        )
      : isSequentialMode && experimentalClusterMode
        ? Array.from({ length: experimentalClusterWaves }, (_, index) => playableDots[index % playableDots.length]!)
      : effectiveSequentialMode && fourFourVolumeLevelSequence && this.fourFourVolumePerDot
        ? playableDots.flatMap((dotKey) =>
            fourFourVolumeLevelSequence.flatMap(() => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
          )
      : effectiveSequentialMode && fourFourHitModeSequence
        ? fourFourHitModeSequence.flatMap(() =>
            playableDots.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
          )
      : isSequentialMode && patternDepthSequence
        ? patternDepthSequence.flatMap(() =>
            playableDots.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
          )
      : isSequentialMode && hiHatDepthSequence
        ? hiHatDepthSequence.flatMap(() =>
            playableDots.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
          )
      : isSequentialMode && reverbDepthSequence
        ? reverbDepthSequence.flatMap(() =>
            playableDots.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
          )
      : isSequentialMode && singleDotMiddleDepthSequence
        ? Array.from({ length: singleDotMiddleDepthHits }, () => playableDots[0])
      : isSequentialMode
        ? volumeCycleSteps.flatMap(() =>
            playableDots.flatMap((dotKey) => Array.from({ length: hitsPerVolumeLevel }, () => dotKey))
          )
      : null);

    const nextStartTime = currentTime + loopDuration;
    // Fire the timeout slightly early so we can pre-schedule the next batch
    // using the exact nextStartTime for seamless looping.
    const earlyMs = Math.min(100, loopDelayMs * 0.25);
    this.loopSequencerTimeoutId = window.setTimeout(() => {
      if (this.isPlaying && this.isLoopSequencerMode()) {
        this.startLoopSequencer(nextStartTime); // Recursive loop with precise timing
      }
    }, Math.max(0, loopDelayMs - earlyMs));
  }

  /**
   * Stop loop sequencer and clear timeout
   */
  private stopLoopSequencer(): void {
    this.stopLoopSequencerInternalCleanup();
    this.audioService.stopSharedBandpassNoise();
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
    this.audioService.stopNoiseOscillation();
    this.stopContinuousLoudQuietCycle(false);
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
    this.stopDragNoiseFormation();

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
    if (this.audioService.getSoundMode() === mode) return;

    const currentDots = new Set(this.activeDotKeys);
    if (currentDots.size > 0) {
      this.stopAllRhythmsInternalCleanup();
      this.audioService.stopNoiseOscillation();
      this.audioService.deactivateAllPoints();
      currentDots.forEach(dotKey => this.audioService.removePoint(dotKey));
      this.activeDotKeys = new Set();
    }

    this.audioService.setSoundMode(mode);

    // Recreate all audio points with the new generator type.
    if (currentDots.size > 0) {
      this.updateDots(currentDots, this.gridSize, this.columnCount);
    }
  }

  public getSoundMode(): SoundMode {
    return this.audioService.getSoundMode();
  }

  public setContinuousNoiseModeEnabled(
    enabled: boolean,
    loopNoiseMode: boolean = false,
    loopSoundMode: SoundMode = SoundMode.BandpassedNoise,
    continuousSoundMode: SoundMode = SoundMode.BandpassedNoise
  ): void {
    const targetMode = enabled
      ? continuousSoundMode
      : loopNoiseMode
        ? loopSoundMode
        : SoundMode.BandpassedNoise;
    const targetLoopSequencerEnabled = loopNoiseMode || !enabled;
    const wasPlaying = this.isPlaying;

    if (
      this.audioService.getSoundMode() === targetMode &&
      this.audioService.getLoopSequencerEnabled() === targetLoopSequencerEnabled &&
      !this.audioService.isSubHitPlaybackEnabled()
    ) {
      return;
    }

    if (wasPlaying) {
      this.setPlaying(false);
    }

    this.audioService.setSubHitPlaybackMode(false);
    this.audioService.setLoopSequencerEnabled(targetLoopSequencerEnabled);
    this.setSoundMode(targetMode);

    if (wasPlaying && this.activeDotKeys.size > 0) {
      this.setPlaying(true);
    }
  }

  // Add method to handle distortion gain -- Now delegates to service
  private setDistortionGain(gain: number): void {
    this.audioService.setDistortion(gain);
  }

  private isContinuousSimultaneousMode(): boolean {
    return !this.audioService.isSubHitPlaybackEnabled();
  }

  private isContinuousNoiseMode(): boolean {
    return this.audioService.getSoundMode() === SoundMode.OscillatingNoise;
  }

  private isLoopSequencerMode(): boolean {
    return this.audioService.getLoopSequencerEnabled() &&
           !this.audioService.isSubHitPlaybackEnabled() &&
           !this.isContinuousNoiseMode();
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    this.audioService.setBandpassBandwidth(bandwidthOctaves);
  }

  public setBandwidthFilterMode(filterMode: BandwidthFilterMode): void {
    this.audioService.setBandwidthFilterMode(filterMode);
  }

  public setGentleEdgeFalloffDbPerOct(dbPerOct: number): void {
    this.audioService.setGentleEdgeFalloffDbPerOct(dbPerOct);
  }

  public setInverseDotOutsideGapOctaves(gapOctaves: number): void {
    this.audioService.setInverseDotOutsideGapOctaves(gapOctaves);
  }

  public setInverseDotBandBoostDb(boostDb: number): void {
    this.audioService.setInverseDotBandBoostDb(boostDb);
  }

  public setBandwidthOscillationEnabled(enabled: boolean): void {
    this.audioService.setBandwidthOscillationEnabled(enabled);
  }

  public getBandwidthOscillationEnabled(): boolean {
    return this.audioService.getBandwidthOscillationEnabled();
  }

  public setBandwidthOscillationStep(stepOctaves: number): void {
    this.audioService.setBandwidthOscillationStep(stepOctaves);
  }

  public getBandwidthOscillationStep(): number {
    return this.audioService.getBandwidthOscillationStep();
  }

  public setBandpassSlope(slopeDbPerOct: number): void {
    this.audioService.setBandpassSlope(slopeDbPerOct);
  }

  public setClickTrainGainPercent(percent: number): void {
    this.audioService.setClickTrainGainPercent(percent);
  }

  public setClickTrainDurationGateEnabled(enabled: boolean): void {
    this.audioService.setClickTrainDurationGateEnabled(enabled);
  }

  public setSineBurstDensity(density: number): void {
    this.audioService.setSineBurstDensity(density);
  }

  public setNoiseOscillationRateHz(rateHz: number): void {
    this.audioService.setNoiseOscillationRateHz(rateHz);
  }

  public setNoiseOscillationBoundsDb(minDb: number, maxDb: number): void {
    this.audioService.setNoiseOscillationBoundsDb(minDb, maxDb);
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

  public setPositionVolumeLeftDb(db: number): void {
    this.audioService.setPositionVolumeLeftDb(db);
  }

  public getPositionVolumeLeftDb(): number {
    return this.audioService.getPositionVolumeLeftDb();
  }

  public setPositionVolumeRightDb(db: number): void {
    this.audioService.setPositionVolumeRightDb(db);
  }

  public getPositionVolumeRightDb(): number {
    return this.audioService.getPositionVolumeRightDb();
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

  public setHitModeStagger(stagger: number): void {
    this.audioService.setHitModeStagger(stagger);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.stopLoopSequencer();
      this.startLoopSequencer();
    }
  }

  public getHitModeStagger(): number {
    return this.audioService.getHitModeStagger();
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
    const previous = this.audioService.getNumberOfHits();
    this.audioService.setNumberOfHits(count);
    if (this.isPlaying && this.isLoopSequencerMode() && this.audioService.getNumberOfHits() !== previous) {
      this.startLoopSequencer();
    }
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

  public setHiHatModeEnabled(enabled: boolean): void {
    this.audioService.setHiHatModeEnabled(enabled);
    if (this.isPlaying && this.isLoopSequencerMode()) {
      this.startLoopSequencer();
    }
  }

  public getHiHatModeEnabled(): boolean {
    return this.audioService.getHiHatModeEnabled();
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

class SineBurstGenerator {
  private ctx: AudioContext;
  private outputGainNode: GainNode;
  private partials: Array<{ oscillator: OscillatorNode; gain: GainNode; normalizedPosition: number }> = [];
  private density: number;
  private lowerFrequency: number = MIN_AUDIBLE_FREQ;
  private upperFrequency: number = MAX_AUDIBLE_FREQ;
  private slopeDbPerOct: number = BANDPASS_NOISE_SLOPE_DB_PER_OCT;

  constructor(audioCtx: AudioContext, density: number = DEFAULT_SINE_BURST_DENSITY) {
    this.ctx = audioCtx;
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = SINE_BURST_OUTPUT_GAIN_SCALAR;
    this.density = Math.round(clamp(density, MIN_SINE_BURST_DENSITY, MAX_SINE_BURST_DENSITY));
    this.rebuildPartials();
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setDensity(density: number): void {
    const nextDensity = Math.round(clamp(density, MIN_SINE_BURST_DENSITY, MAX_SINE_BURST_DENSITY));
    if (nextDensity === this.density && this.partials.length === nextDensity) return;
    this.density = nextDensity;
    this.rebuildPartials();
  }

  public setBand(lowerFrequency: number, upperFrequency: number, slopeDbPerOct: number): void {
    this.lowerFrequency = clamp(lowerFrequency, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ);
    this.upperFrequency = clamp(upperFrequency, this.lowerFrequency, MAX_AUDIBLE_FREQ);
    this.slopeDbPerOct = slopeDbPerOct;
    this.updatePartialShape();
  }

  public scheduleBand(
    lowerFrequency: number,
    upperFrequency: number,
    slopeDbPerOct: number,
    scheduledTime: number
  ): void {
    this.lowerFrequency = clamp(lowerFrequency, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ);
    this.upperFrequency = clamp(upperFrequency, this.lowerFrequency, MAX_AUDIBLE_FREQ);
    this.slopeDbPerOct = slopeDbPerOct;
    this.updatePartialShape(scheduledTime);
  }

  private rebuildPartials(): void {
    this.disposePartials();

    for (let index = 0; index < this.density; index++) {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const phase = Math.random() * Math.PI * 2;
      const real = new Float32Array(2);
      const imag = new Float32Array(2);
      real[1] = Math.sin(phase);
      imag[1] = Math.cos(phase);
      oscillator.setPeriodicWave(this.ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
      oscillator.connect(gain);
      gain.connect(this.outputGainNode);
      oscillator.start(this.ctx.currentTime);
      this.partials.push({
        oscillator,
        gain,
        normalizedPosition: this.density <= 1 ? 0.5 : index / (this.density - 1),
      });
    }

    this.updatePartialShape();
  }

  private getFrequencies(): number[] {
    if (this.partials.length === 0) return [];
    const logLower = Math.log2(Math.max(MIN_AUDIBLE_FREQ, this.lowerFrequency));
    const logUpper = Math.log2(Math.max(this.lowerFrequency, this.upperFrequency));
    return this.partials.map(({ normalizedPosition }) => {
      return Math.pow(2, logLower + normalizedPosition * (logUpper - logLower));
    });
  }

  private updatePartialShape(scheduledTime?: number): void {
    const frequencies = this.getFrequencies();
    if (frequencies.length === 0) return;

    const rawGains = frequencies.map((frequency) => {
      const gainDb = this.slopeDbPerOct * Math.log2(frequency / SLOPE_REF_FREQUENCY);
      return dbToGain(gainDb);
    });
    const rmsGain = Math.sqrt(rawGains.reduce((sum, gain) => sum + gain * gain, 0) / rawGains.length) || 1;
    const densityGain = 1 / Math.sqrt(rawGains.length);

    this.partials.forEach(({ oscillator, gain }, index) => {
      const frequency = frequencies[index] ?? SLOPE_REF_FREQUENCY;
      const partialGain = (rawGains[index] ?? 1) / rmsGain * densityGain;
      if (scheduledTime !== undefined) {
        oscillator.frequency.setValueAtTime(clamp(frequency, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ), scheduledTime);
        gain.gain.setValueAtTime(partialGain, scheduledTime);
      } else {
        oscillator.frequency.value = clamp(frequency, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ);
        gain.gain.value = partialGain;
      }
    });
  }

  private disposePartials(): void {
    this.partials.forEach(({ oscillator, gain }) => {
      try {
        oscillator.stop();
      } catch {
        // Oscillator might already be stopped
      }
      oscillator.disconnect();
      gain.disconnect();
    });
    this.partials = [];
  }

  public dispose(): void {
    this.disposePartials();
    this.outputGainNode.disconnect();
  }
}

class AdditivePartialGenerator {
  private ctx: AudioContext;
  private outputGainNode: GainNode;
  private partials: Array<{ oscillator: OscillatorNode; gain: GainNode }> = [];

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = ADDITIVE_PARTIAL_OUTPUT_GAIN_SCALAR;

    const logMin = Math.log2(MIN_AUDIBLE_FREQ);
    const logMax = Math.log2(MAX_AUDIBLE_FREQ);
    const partialGain = 1 / Math.sqrt(ADDITIVE_PARTIAL_COUNT);

    for (let index = 0; index < ADDITIVE_PARTIAL_COUNT; index++) {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const centeredJitter = (Math.random() - 0.5) / ADDITIVE_PARTIAL_COUNT;
      const normalized = (index + Math.random()) / ADDITIVE_PARTIAL_COUNT + centeredJitter;
      const clampedNormalized = clamp(normalized, 0, 1);
      oscillator.type = 'sine';
      oscillator.frequency.value = Math.pow(2, logMin + clampedNormalized * (logMax - logMin));
      gain.gain.value = partialGain * (0.65 + Math.random() * 0.7);
      oscillator.connect(gain);
      gain.connect(this.outputGainNode);
      oscillator.start(this.ctx.currentTime + Math.random() * 0.02);
      this.partials.push({ oscillator, gain });
    }
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public dispose(): void {
    this.partials.forEach(({ oscillator, gain }) => {
      try {
        oscillator.stop();
      } catch {
        // Oscillator might already be stopped
      }
      oscillator.disconnect();
      gain.disconnect();
    });
    this.outputGainNode.disconnect();
    this.partials = [];
  }
}

export class ClickTrainGenerator {
  private ctx: AudioContext;
  private outputGainNode: GainNode;
  private source: AudioBufferSourceNode;

  constructor(audioCtx: AudioContext, gainMultiplier: number = 1) {
    this.ctx = audioCtx;
    this.outputGainNode = this.ctx.createGain();
    this.setGainMultiplier(gainMultiplier);

    const buffer = this.createImpulseTrainBuffer();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.connect(this.outputGainNode);
    this.source.start();
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setGainMultiplier(gainMultiplier: number): void {
    this.outputGainNode.gain.value = CLICK_TRAIN_OUTPUT_GAIN_SCALAR * clamp(gainMultiplier, 0, 80);
  }

  private createImpulseTrainBuffer(): AudioBuffer {
    const sampleRate = this.ctx.sampleRate;
    const bufferLength = sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferLength, sampleRate);
    const channel = buffer.getChannelData(0);
    const baseSpacing = sampleRate / CLICK_TRAIN_RATE_HZ;
    let sampleIndex = Math.floor(Math.random() * baseSpacing);

    while (sampleIndex < bufferLength - 4) {
      const amplitude = (Math.random() < 0.5 ? -1 : 1) * (0.65 + Math.random() * 0.35);
      channel[sampleIndex] += amplitude;
      channel[sampleIndex + 1] -= amplitude * 0.45;
      channel[sampleIndex + 2] += amplitude * 0.15;
      const jitter = (Math.random() - 0.5) * baseSpacing * 0.15;
      sampleIndex += Math.max(8, Math.round(baseSpacing + jitter));
    }

    return buffer;
  }

  public dispose(): void {
    try {
      this.source.stop();
    } catch {
      // Source might already be stopped
    }
    this.source.disconnect();
    this.outputGainNode.disconnect();
  }
}

class InverseDotNoiseGenerator {
  private ctx: AudioContext;
  private slopingNoiseGenerator: SlopedPinkNoiseGenerator;
  private outputGainNode: GainNode;
  // One peaking-EQ dip per dot in the column, chained in series on the shared
  // noise. Each dip is a notch at rest and rises to the dot-boost gain on a hit.
  private dipFilters: BiquadFilterNode[] = [];
  private bands: BandpassRange[] = [];
  private currentBandwidthOctaves: number = BANDPASS_BANDWIDTH_OCTAVES;
  private currentCenterFrequency: number = 1000;
  private outsideGapOctaves: number = DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES;
  private dotBandBoostDb: number = DEFAULT_INVERSE_DOT_BAND_BOOST_DB;
  private bandwidthFilterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE;

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.slopingNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
    this.slopingNoiseGenerator.setInputSlope(PINK_NOISE_SLOPE_DB_PER_OCT);
    this.slopingNoiseGenerator.setSlope(BANDPASS_NOISE_SLOPE_DB_PER_OCT);
    this.slopingNoiseGenerator.setIndependentBandNoiseEnabled(true);

    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = INVERSE_DOT_NOISE_OUTPUT_GAIN_SCALAR;

    // Start with a single dip at the default frequency.
    this.setBands([this.getBandpassRange(this.currentCenterFrequency, this.currentBandwidthOctaves)]);
  }

  private getBandpassRange(frequency: number, bandwidthOctaves: number): BandpassRange {
    const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(bandwidthOctaves, this.bandwidthFilterMode);
    const halfBandwidth = effectiveBandwidthOctaves / 2;

    return {
      lowerEdge: frequency / Math.pow(2, halfBandwidth),
      upperEdge: frequency * Math.pow(2, halfBandwidth),
      centerFrequency: frequency,
    };
  }

  private normalizeBandpassRange(lowerEdge: number, upperEdge: number, centerFrequency?: number): BandpassRange {
    const lower = Math.max(0.001, Math.min(lowerEdge, upperEdge));
    const upper = Math.max(lower * 1.0001, Math.max(lowerEdge, upperEdge));
    return {
      lowerEdge: lower,
      upperEdge: upper,
      centerFrequency: Number.isFinite(centerFrequency) ? Math.max(0.001, centerFrequency ?? Math.sqrt(lower * upper)) : Math.sqrt(lower * upper),
    };
  }

  // The dot-gap control now sets how wide each parametric dip is (a relatively
  // thin, adjustable notch) rather than a spectral gap around a split band.
  private getDipQ(): number {
    return octavesToPeakingQ(Math.max(INVERSE_DOT_MIN_DIP_WIDTH_OCTAVES, this.outsideGapOctaves));
  }

  private rebuildChain(): void {
    this.slopingNoiseGenerator.getOutputNode().disconnect();
    this.dipFilters.forEach((filter) => filter.disconnect());

    let node: AudioNode = this.slopingNoiseGenerator.getOutputNode();
    for (const filter of this.dipFilters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(this.outputGainNode);
  }

  // Configure the column's dips: one peaking filter per band, resting at the deep
  // notch depth. Filter count only changes when dots are added/removed from the
  // column, so an in-flight ADSR on an existing dip is never stomped mid-pulse.
  public setBands(bands: BandpassRange[]): void {
    const safeBands = bands.length > 0
      ? bands
      : [this.getBandpassRange(this.currentCenterFrequency, this.currentBandwidthOctaves)];
    this.bands = safeBands;

    if (this.dipFilters.length !== safeBands.length) {
      while (this.dipFilters.length < safeBands.length) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.gain.value = INVERSE_DOT_NOTCH_REST_DB;
        this.dipFilters.push(filter);
      }
      while (this.dipFilters.length > safeBands.length) {
        const filter = this.dipFilters.pop();
        filter?.disconnect();
      }
      this.rebuildChain();
    }

    const dipQ = this.getDipQ();
    safeBands.forEach((band, index) => {
      const filter = this.dipFilters[index];
      if (!filter) return;
      filter.frequency.value = clamp(band.centerFrequency, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ);
      filter.Q.value = dipQ;
    });
    this.currentCenterFrequency = safeBands[0]?.centerFrequency ?? this.currentCenterFrequency;
  }

  // Remove every dip so the generator emits flat, full-spectrum noise with no
  // notch — used for a right-clicked "constant noise" dot that doesn't act as a
  // dot (no hole, no pulse, just steady noise).
  public clearDips(): void {
    while (this.dipFilters.length > 0) {
      this.dipFilters.pop()?.disconnect();
    }
    this.bands = [];
    this.rebuildChain();
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setBandwidthFilterMode(filterMode: BandwidthFilterMode): void {
    this.bandwidthFilterMode = filterMode;
    this.setBands(this.bands);
  }

  public setOutsideGapOctaves(gapOctaves: number): void {
    this.outsideGapOctaves = clamp(
      Number.isFinite(gapOctaves) ? gapOctaves : DEFAULT_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
      MIN_INVERSE_DOT_OUTSIDE_GAP_OCTAVES,
      MAX_INVERSE_DOT_OUTSIDE_GAP_OCTAVES
    );
    this.setBands(this.bands);
  }

  public setDotBandBoostDb(boostDb: number): void {
    this.dotBandBoostDb = clamp(
      Number.isFinite(boostDb) ? boostDb : DEFAULT_INVERSE_DOT_BAND_BOOST_DB,
      MIN_INVERSE_DOT_BAND_BOOST_DB,
      MAX_INVERSE_DOT_BAND_BOOST_DB
    );
  }

  public setBandpassFrequency(frequency: number): void {
    this.currentCenterFrequency = frequency;
    this.setBands([this.getBandpassRange(frequency, this.currentBandwidthOctaves)]);
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    this.currentBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );
    this.setBands([this.getBandpassRange(this.currentCenterFrequency, this.currentBandwidthOctaves)]);
  }

  public setBandpassRange(lowerEdge: number, upperEdge: number, centerFrequency?: number): void {
    const range = this.normalizeBandpassRange(lowerEdge, upperEdge, centerFrequency);
    this.currentCenterFrequency = range.centerFrequency;
    this.currentBandwidthOctaves = clamp(
      Math.log2(range.upperEdge / range.lowerEdge),
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );
    this.setBands([range]);
  }

  // The notch position is static per selection, so scheduled variants just apply
  // the band immediately; the scheduledTime only matters for the pulse envelope.
  public scheduleBandpassFrequencyAndBandwidth(
    frequency: number,
    bandwidthOctaves: number,
    _scheduledTime: number
  ): void {
    void _scheduledTime;
    const safeBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );
    this.currentBandwidthOctaves = safeBandwidthOctaves;
    this.currentCenterFrequency = frequency;
    this.setBands([this.getBandpassRange(frequency, safeBandwidthOctaves)]);
  }

  public scheduleBandpassRange(
    lowerEdge: number,
    upperEdge: number,
    centerFrequency: number,
    _scheduledTime: number
  ): void {
    void _scheduledTime;
    this.setBandpassRange(lowerEdge, upperEdge, centerFrequency);
  }

  // Pulse every dip in the column together: each peaking gain rides the same ADSR
  // from the resting notch depth up to the dot-boost peak and back. The EQ shape is
  // volume-independent — hit loudness is handled entirely by the fullband gate
  // (envelopeGain), so every hit carves/fills the same notch regardless of level.
  public scheduleDotBandHit(
    scheduledTime: number,
    attackTime: number,
    releaseTime: number
  ): void {
    const totalEnvelopeTime = Math.max(0.001, attackTime + releaseTime);
    const safeAttackTime = Math.min(
      totalEnvelopeTime - 0.0001,
      Math.max(0, attackTime, INVERSE_DOT_MIN_ATTACK_S)
    );
    const safeReleaseTime = Math.max(0.0001, totalEnvelopeTime - safeAttackTime);
    const attackEndTime = scheduledTime + safeAttackTime;
    const releaseEndTime = attackEndTime + safeReleaseTime;
    const peakDb = this.dotBandBoostDb;

    // TEMP DEBUG: sample how many dips this generator actually pulses at hit time.
    if (Math.random() < 0.03) {
      console.log('[INV pulse] dips=', this.dipFilters.length, 'freqs=', this.dipFilters.map((f) => Math.round(f.frequency.value)));
    }

    this.dipFilters.forEach((filter) => {
      const gainParam = filter.gain;
      gainParam.cancelScheduledValues(scheduledTime);
      gainParam.setValueAtTime(INVERSE_DOT_NOTCH_REST_DB, scheduledTime);
      if (safeAttackTime <= 0) {
        gainParam.setValueAtTime(peakDb, scheduledTime);
      } else {
        gainParam.linearRampToValueAtTime(peakDb, attackEndTime);
      }
      gainParam.linearRampToValueAtTime(INVERSE_DOT_NOTCH_REST_DB, releaseEndTime);
    });
  }

  public dispose(): void {
    this.slopingNoiseGenerator.dispose();
    this.dipFilters.forEach((filter) => filter.disconnect());
    this.dipFilters = [];
    this.outputGainNode.disconnect();
  }
}

export class BandpassedNoiseGenerator {
  private ctx: AudioContext;
  private inputGainNode: GainNode;
  private outputGainNode: GainNode;
  private highpassFilter: BiquadFilterNode;
  private lowpassFilter: BiquadFilterNode;
  private snareScoopFilters: BiquadFilterNode[] = [];
  private slopingFilter: SlopedPinkNoiseGenerator;
  private currentBandwidthOctaves: number;
  private currentCenterFrequency: number;
  private currentFilterQ: number;
  private currentSlopeDbPerOct: number = BANDPASS_NOISE_SLOPE_DB_PER_OCT;
  private bandwidthFilterMode: BandwidthFilterMode = DEFAULT_BANDWIDTH_FILTER_MODE;
  private gentleEdgeFalloffDbPerOct: number = DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT;
  private isHighpassActive: boolean = true;
  private isLowpassActive: boolean = true;
  private snareScoopEnabled: boolean = false;
  private snareScoopDepthDb: number = DEFAULT_SNARE_SCOOP_DEPTH_DB;
  private snareScoopMode: SnareScoopMode = DEFAULT_SNARE_SCOOP_MODE;
  private snareScoopBandwidthOctaves: number = DEFAULT_SNARE_SCOOP_BANDWIDTH_OCTAVES_BY_MODE[DEFAULT_SNARE_SCOOP_MODE];
  private snareScoopPhaseIndex: number = 0;
  private isSnareScoopRouted: boolean = false;

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.inputGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = BANDPASS_NOISE_OUTPUT_GAIN_SCALAR;

    // The lobe bank is the noise source; the selected band is cut after that
    // source with the highpass/lowpass pair.
    this.slopingFilter = new SlopedPinkNoiseGenerator(this.ctx);
    this.slopingFilter.setSlope(BANDPASS_NOISE_SLOPE_DB_PER_OCT);

    // Create sharp highpass filter
    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.Q.value = BANDPASS_FILTER_Q;

    // Create sharp lowpass filter
    this.lowpassFilter = this.ctx.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.Q.value = BANDPASS_FILTER_Q;

    for (let index = 0; index < MAX_SNARE_WAVE_FILTERS; index++) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 1000;
      filter.Q.value = snareScoopBandwidthToQ(this.snareScoopBandwidthOctaves);
      filter.gain.value = 0;
      this.snareScoopFilters.push(filter);
    }

    // Initialize bandwidth and center frequency
    this.currentBandwidthOctaves = BANDPASS_BANDWIDTH_OCTAVES;
    this.currentCenterFrequency = 1000; // Default, will be updated based on Y position
    this.currentFilterQ = bandpassBandwidthToQ(this.currentBandwidthOctaves, this.bandwidthFilterMode);

    this.inputGainNode.connect(this.slopingFilter.getInputNode());
    this.snareScoopFilters.forEach((filter, index) => {
      const nextFilter = this.snareScoopFilters[index + 1];
      filter.connect(nextFilter ?? this.outputGainNode);
    });

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

  private disconnectFilterChain(): void {
    this.slopingFilter.getOutputNode().disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
  }

  private reconnectFilterChain(): void {
    this.disconnectFilterChain();
    this.connectFilterChain(this.isHighpassActive, this.isLowpassActive);
  }

  private getSnareScoopFrequencies(centerFrequency: number, phaseIndex: number = this.snareScoopPhaseIndex): number[] {
    const center = clamp(centerFrequency, 20, 20000);
    const activeFilterCount = SNARE_WAVE_FILTER_COUNT_BY_MODE[this.snareScoopMode];
    const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(this.currentBandwidthOctaves, this.bandwidthFilterMode);
    const halfSpanOctaves = Math.min(4, Math.max(0.2, effectiveBandwidthOctaves * 0.42));
    const spanOctaves = halfSpanOctaves * 2;
    const phaseFraction = ((phaseIndex % 4) + 4) % 4 / 4;

    return this.snareScoopFilters.map((_, index) => {
      if (index >= activeFilterCount) return center;
      const phasePosition = (index + 0.5 + phaseFraction) / activeFilterCount;
      const rawOffsetOctaves = -halfSpanOctaves + phasePosition * spanOctaves;
      const offsetOctaves = rawOffsetOctaves > halfSpanOctaves
        ? rawOffsetOctaves - spanOctaves
        : rawOffsetOctaves;
      return clamp(center * Math.pow(2, offsetOctaves), 20, 20000);
    });
  }

  private updateSnareScoopFrequencies(centerFrequency: number): void {
    const frequencies = this.getSnareScoopFrequencies(centerFrequency);
    this.snareScoopFilters.forEach((filter, index) => {
      filter.frequency.value = frequencies[index] ?? clamp(centerFrequency, 20, 20000);
    });
  }

  private scheduleSnareScoopFrequencies(centerFrequency: number, scheduledTime: number, phaseIndex: number = this.snareScoopPhaseIndex): void {
    const frequencies = this.getSnareScoopFrequencies(centerFrequency, phaseIndex);
    this.snareScoopFilters.forEach((filter, index) => {
      filter.frequency.setValueAtTime(frequencies[index] ?? clamp(centerFrequency, 20, 20000), scheduledTime);
    });
  }

  private applySnareScoopShape(scheduledTime?: number, enabledOverride?: boolean): void {
    const scoopQ = snareScoopBandwidthToQ(this.snareScoopBandwidthOctaves);
    const activeFilterCount = SNARE_WAVE_FILTER_COUNT_BY_MODE[this.snareScoopMode];
    const enabled = enabledOverride ?? this.snareScoopEnabled;

    this.snareScoopFilters.forEach((filter, index) => {
      filter.Q.value = scoopQ;
      const gainDb = enabled && index < activeFilterCount
        ? (index % 2 === 0 ? this.snareScoopDepthDb : -this.snareScoopDepthDb)
        : 0;

      if (scheduledTime !== undefined) {
        filter.gain.setValueAtTime(gainDb, scheduledTime);
      } else {
        filter.gain.value = gainDb;
      }
    });
  }

  private clearSnareScoopAutomation(): void {
    const now = this.ctx.currentTime;

    this.snareScoopFilters.forEach((filter) => {
      filter.gain.cancelScheduledValues(now);
      filter.gain.setValueAtTime(0, now);
    });
  }

  private applyEdgeFalloffShape(lowerEdge: number, upperEdge: number, scheduledTime?: number): void {
    void lowerEdge;
    void upperEdge;

    // Bandwidth is handled by the post-generation highpass/lowpass filters.
    // Keep the internal lobe bank unmasked so the filters receive the whole
    // generated noise shape instead of a center-frequency-gated subset.
    if (scheduledTime !== undefined) {
      this.slopingFilter.cancelScheduledShapeValues(scheduledTime);
      this.slopingFilter.schedulePassband(MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ, 'off', scheduledTime);
    } else {
      this.slopingFilter.setPassband(MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ, 'off');
    }
  }

  private cancelScheduledCutoffValues(scheduledTime: number): void {
    this.highpassFilter.frequency.cancelScheduledValues(scheduledTime);
    this.lowpassFilter.frequency.cancelScheduledValues(scheduledTime);
    this.highpassFilter.Q.cancelScheduledValues(scheduledTime);
    this.lowpassFilter.Q.cancelScheduledValues(scheduledTime);
    this.snareScoopFilters.forEach((filter) => {
      filter.frequency.cancelScheduledValues(scheduledTime);
    });
  }

  private connectFilterChain(useHighpass: boolean, useLowpass: boolean): void {
    const slopingOutput = this.slopingFilter.getOutputNode();
    const filterOutput = this.snareScoopEnabled
      ? this.snareScoopFilters[0] ?? this.outputGainNode
      : this.outputGainNode;

    if (useHighpass) {
      slopingOutput.connect(this.highpassFilter);
      if (useLowpass) {
        this.highpassFilter.connect(this.lowpassFilter);
        this.lowpassFilter.connect(filterOutput);
      } else {
        this.highpassFilter.connect(filterOutput);
      }
    } else if (useLowpass) {
      slopingOutput.connect(this.lowpassFilter);
      this.lowpassFilter.connect(filterOutput);
    } else {
      slopingOutput.connect(filterOutput);
    }
    this.isSnareScoopRouted = this.snareScoopEnabled;
  }

  private updateFilterChain(lowerEdge: number, upperEdge: number): void {
    void lowerEdge;
    void upperEdge;

    const needHighpass = true;
    const needLowpass = true;

    // Only rewire if configuration changed
    if (needHighpass !== this.isHighpassActive || needLowpass !== this.isLowpassActive) {
      this.disconnectFilterChain();
      this.connectFilterChain(needHighpass, needLowpass);
      this.isHighpassActive = needHighpass;
      this.isLowpassActive = needLowpass;
    }
  }

  private normalizeBandpassRange(lowerEdge: number, upperEdge: number, centerFrequency?: number): BandpassRange {
    const lower = Math.max(0.001, Math.min(lowerEdge, upperEdge));
    const upper = Math.max(lower * 1.0001, Math.max(lowerEdge, upperEdge));
    const center = Number.isFinite(centerFrequency)
      ? Math.max(0.001, centerFrequency ?? Math.sqrt(lower * upper))
      : Math.sqrt(lower * upper);

    return {
      lowerEdge: lower,
      upperEdge: upper,
      centerFrequency: center,
    };
  }

  public setBandpassFrequency(frequency: number): void {
    // Store center frequency WITHOUT clamping (allow extended range)
    this.currentCenterFrequency = frequency;

    // Calculate edges WITHOUT clamping
    const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(this.currentBandwidthOctaves, this.bandwidthFilterMode);
    const halfBandwidth = effectiveBandwidthOctaves / 2;
    const lowerEdge = frequency / Math.pow(2, halfBandwidth);
    const upperEdge = frequency * Math.pow(2, halfBandwidth);

    // Update filter chain based on which filters are needed
    this.updateFilterChain(lowerEdge, upperEdge);
    this.applyEdgeFalloffShape(lowerEdge, upperEdge);

    // Set filter frequencies (clamped to safe Web Audio API values)
    this.highpassFilter.frequency.value = clamp(lowerEdge, 20, 20000);
    this.lowpassFilter.frequency.value = clamp(upperEdge, 20, 20000);
    this.updateSnareScoopFrequencies(frequency);

    this.currentFilterQ = bandpassBandwidthToQ(this.currentBandwidthOctaves, this.bandwidthFilterMode);
    this.highpassFilter.Q.value = this.currentFilterQ;
    this.lowpassFilter.Q.value = this.currentFilterQ;
  }

  public setBandpassRange(lowerEdge: number, upperEdge: number, centerFrequency?: number): void {
    const range = this.normalizeBandpassRange(lowerEdge, upperEdge, centerFrequency);
    this.currentCenterFrequency = range.centerFrequency;

    this.updateFilterChain(range.lowerEdge, range.upperEdge);
    this.applyEdgeFalloffShape(range.lowerEdge, range.upperEdge);

    this.highpassFilter.frequency.value = clamp(range.lowerEdge, 20, 20000);
    this.lowpassFilter.frequency.value = clamp(range.upperEdge, 20, 20000);
    this.updateSnareScoopFrequencies(range.centerFrequency);

    const bandwidthOctaves = Math.log2(range.upperEdge / range.lowerEdge);
    this.currentFilterQ = bandpassBandwidthToQ(bandwidthOctaves, this.bandwidthFilterMode);
    this.highpassFilter.Q.value = this.currentFilterQ;
    this.lowpassFilter.Q.value = this.currentFilterQ;
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    // Store new bandwidth
    this.currentBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );

    // Recalculate frequencies with new bandwidth
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public setBandwidthFilterMode(filterMode: BandwidthFilterMode): void {
    this.bandwidthFilterMode = filterMode;
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public setGentleEdgeFalloffDbPerOct(dbPerOct: number): void {
    this.gentleEdgeFalloffDbPerOct = clampGentleEdgeFalloffDbPerOct(dbPerOct);
    this.slopingFilter.setEdgeFalloffSharpness(this.gentleEdgeFalloffDbPerOct);
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public setIndependentBandNoiseEnabled(enabled: boolean): void {
    this.slopingFilter.setIndependentBandNoiseEnabled(enabled);
  }

  public scheduleBandpassBandwidth(bandwidthOctaves: number, scheduledTime: number): void {
    const scheduledBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );

    const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(scheduledBandwidthOctaves, this.bandwidthFilterMode);
    const halfBandwidth = effectiveBandwidthOctaves / 2;
    const lowerEdge = this.currentCenterFrequency / Math.pow(2, halfBandwidth);
    const upperEdge = this.currentCenterFrequency * Math.pow(2, halfBandwidth);
    const filterQ = bandpassBandwidthToQ(scheduledBandwidthOctaves, this.bandwidthFilterMode);

    this.cancelScheduledCutoffValues(scheduledTime);
    this.applyEdgeFalloffShape(lowerEdge, upperEdge, scheduledTime);
    this.highpassFilter.frequency.setValueAtTime(clamp(lowerEdge, 20, 20000), scheduledTime);
    this.lowpassFilter.frequency.setValueAtTime(clamp(upperEdge, 20, 20000), scheduledTime);
    this.highpassFilter.Q.setValueAtTime(filterQ, scheduledTime);
    this.lowpassFilter.Q.setValueAtTime(filterQ, scheduledTime);
    this.scheduleSnareScoopFrequencies(this.currentCenterFrequency, scheduledTime);
  }

  public scheduleBandpassFrequencyAndBandwidth(
    frequency: number,
    bandwidthOctaves: number,
    scheduledTime: number
  ): void {
    const scheduledBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_BANDPASS_BANDWIDTH_OCTAVES,
      MAX_BANDPASS_BANDWIDTH_OCTAVES
    );

    const effectiveBandwidthOctaves = getEffectiveBandpassBandwidth(scheduledBandwidthOctaves, this.bandwidthFilterMode);
    const halfBandwidth = effectiveBandwidthOctaves / 2;
    const lowerEdge = frequency / Math.pow(2, halfBandwidth);
    const upperEdge = frequency * Math.pow(2, halfBandwidth);
    const filterQ = bandpassBandwidthToQ(scheduledBandwidthOctaves, this.bandwidthFilterMode);

    this.cancelScheduledCutoffValues(scheduledTime);
    this.applyEdgeFalloffShape(lowerEdge, upperEdge, scheduledTime);
    this.highpassFilter.frequency.setValueAtTime(clamp(lowerEdge, 20, 20000), scheduledTime);
    this.lowpassFilter.frequency.setValueAtTime(clamp(upperEdge, 20, 20000), scheduledTime);
    this.highpassFilter.Q.setValueAtTime(filterQ, scheduledTime);
    this.lowpassFilter.Q.setValueAtTime(filterQ, scheduledTime);
    this.scheduleSnareScoopFrequencies(frequency, scheduledTime);
  }

  public scheduleBandpassRange(
    lowerEdge: number,
    upperEdge: number,
    centerFrequency: number,
    scheduledTime: number
  ): void {
    const range = this.normalizeBandpassRange(lowerEdge, upperEdge, centerFrequency);
    const bandwidthOctaves = Math.log2(range.upperEdge / range.lowerEdge);
    const filterQ = bandpassBandwidthToQ(bandwidthOctaves, this.bandwidthFilterMode);

    this.cancelScheduledCutoffValues(scheduledTime);
    this.applyEdgeFalloffShape(range.lowerEdge, range.upperEdge, scheduledTime);
    this.highpassFilter.frequency.setValueAtTime(clamp(range.lowerEdge, 20, 20000), scheduledTime);
    this.lowpassFilter.frequency.setValueAtTime(clamp(range.upperEdge, 20, 20000), scheduledTime);
    this.highpassFilter.Q.setValueAtTime(filterQ, scheduledTime);
    this.lowpassFilter.Q.setValueAtTime(filterQ, scheduledTime);
    this.scheduleSnareScoopFrequencies(range.centerFrequency, scheduledTime);
  }

  public setSnareScoopEnabled(enabled: boolean): void {
    const shouldReconnect = this.snareScoopEnabled !== enabled || this.isSnareScoopRouted !== enabled;
    this.snareScoopEnabled = enabled;

    if (shouldReconnect) {
      this.clearSnareScoopAutomation();
    }
    if (shouldReconnect) {
      this.reconnectFilterChain();
    }

    this.applySnareScoopShape();
    this.updateSnareScoopFrequencies(this.currentCenterFrequency);
  }

  public scheduleSnareScoopEnabled(enabled: boolean, scheduledTime: number, phaseIndex: number = 0): void {
    this.applySnareScoopShape(scheduledTime, enabled);
    this.scheduleSnareScoopFrequencies(this.currentCenterFrequency, scheduledTime, phaseIndex);
  }

  public scheduleSnareScoopShape(scheduledTime: number): void {
    this.applySnareScoopShape(scheduledTime);
  }

  public setSnareScoopDepthDb(depthDb: number): void {
    this.snareScoopDepthDb = clamp(depthDb, 0, MAX_SNARE_SCOOP_DEPTH_DB);
    this.applySnareScoopShape();
  }

  public setSnareScoopBandwidthOctaves(bandwidthOctaves: number): void {
    this.snareScoopBandwidthOctaves = clamp(
      bandwidthOctaves,
      MIN_SNARE_SCOOP_BANDWIDTH_OCTAVES,
      MAX_SNARE_SCOOP_BANDWIDTH_OCTAVES
    );
    this.applySnareScoopShape();
  }

  public setSnareScoopMode(mode: SnareScoopMode): void {
    this.snareScoopMode = mode;
    this.applySnareScoopShape();
    this.updateSnareScoopFrequencies(this.currentCenterFrequency);
  }

  public setBandpassSlope(slopeDbPerOct: number): void {
    this.currentSlopeDbPerOct = slopeDbPerOct;
    this.slopingFilter.setSlope(slopeDbPerOct);
  }

  public scheduleBandpassSlope(slopeDbPerOct: number, scheduledTime: number): void {
    this.slopingFilter.scheduleSlope(slopeDbPerOct, scheduledTime);
  }

  public setInputSlope(inputSlopeDbPerOct: number): void {
    this.slopingFilter.setInputSlope(inputSlopeDbPerOct);
    this.slopingFilter.setSlope(this.currentSlopeDbPerOct);
  }

  public setBandpassQ(q: number): void {
    this.currentFilterQ = clamp(q, 0.1, 100);
    this.highpassFilter.Q.value = this.currentFilterQ;
    this.lowpassFilter.Q.value = this.currentFilterQ;
  }

  public dispose(): void {
    this.slopingFilter.dispose();
    this.inputGainNode.disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
    this.snareScoopFilters.forEach((filter) => filter.disconnect());
    this.outputGainNode.disconnect();
  }
}

export class SlopedPinkNoiseGenerator {
  private ctx: BaseAudioContext;
  private inputGainNode: GainNode;
  private outputGainNode: GainNode;
  private bandFilters: BiquadFilterNode[] = [];
  private bandGains: GainNode[] = [];
  private centerFrequencies: number[] = [];
  private independentBandNoiseSources: AudioBufferSourceNode[] = [];
  private independentBandNoiseEnabled: boolean = false;
  private inputSlopeDbPerOctave: number = PINK_NOISE_SLOPE_DB_PER_OCT;
  private targetOverallSlopeDbPerOctave: number = PINK_NOISE_SLOPE_DB_PER_OCT;
  private edgeFalloffEnabled: boolean = false;
  private edgeFalloffHard: boolean = false;
  private edgeFalloffLowerEdge: number = MIN_AUDIBLE_FREQ;
  private edgeFalloffUpperEdge: number = MAX_AUDIBLE_FREQ;
  private edgeFalloffDbPerOct: number = DEFAULT_GENTLE_EDGE_FALLOFF_DB_PER_OCT;

  constructor(audioCtx: BaseAudioContext) {
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

  private createIndependentPinkNoiseBuffer(): AudioBuffer {
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * 2));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      b6 = white * 0.5362;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11;
    }

    let peak = 0;
    for (let i = 0; i < bufferSize; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1;
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor;
    }

    return buffer;
  }

  private disconnectSharedInput(): void {
    try {
      this.inputGainNode.disconnect();
    } catch {
      // The shared input may already be disconnected.
    }
  }

  private stopIndependentBandNoiseSources(): void {
    this.independentBandNoiseSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
      source.disconnect();
    });
    this.independentBandNoiseSources = [];
  }

  private connectSharedInput(): void {
    this.disconnectSharedInput();
    this.bandFilters.forEach((filter) => {
      this.inputGainNode.connect(filter);
    });
  }

  private startIndependentBandNoiseSources(): void {
    this.stopIndependentBandNoiseSources();
    this.disconnectSharedInput();

    this.bandFilters.forEach((filter) => {
      const source = this.ctx.createBufferSource();
      source.buffer = this.createIndependentPinkNoiseBuffer();
      source.loop = true;
      source.connect(filter);
      source.start();
      this.independentBandNoiseSources.push(source);
    });
  }

  public getInputNode(): GainNode {
    return this.inputGainNode;
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setInputSlope(inputSlopeDbPerOctave: number): void {
    this.inputSlopeDbPerOctave = inputSlopeDbPerOctave;
  }

  public setIndependentBandNoiseEnabled(enabled: boolean): void {
    if (this.independentBandNoiseEnabled === enabled) return;

    this.independentBandNoiseEnabled = enabled;
    if (enabled) {
      this.startIndependentBandNoiseSources();
    } else {
      this.stopIndependentBandNoiseSources();
      this.connectSharedInput();
    }
  }

  private getEdgeFalloffGainDbFor(
    centerFrequency: number,
    lowerEdge: number,
    upperEdge: number,
    enabled: boolean,
    hard: boolean = false
  ): number {
    if (!enabled) return 0;

    if (centerFrequency < lowerEdge) {
      if (hard) return -HARD_PASSBAND_ATTENUATION_DB;
      const octavesOutside = Math.log2(lowerEdge / centerFrequency);
      return -Math.min(GENTLE_EDGE_MAX_ATTENUATION_DB, octavesOutside * this.edgeFalloffDbPerOct);
    }

    if (centerFrequency > upperEdge) {
      if (hard) return -HARD_PASSBAND_ATTENUATION_DB;
      const octavesOutside = Math.log2(centerFrequency / upperEdge);
      return -Math.min(GENTLE_EDGE_MAX_ATTENUATION_DB, octavesOutside * this.edgeFalloffDbPerOct);
    }

    return 0;
  }

  private getEdgeFalloffGainDb(centerFrequency: number): number {
    return this.getEdgeFalloffGainDbFor(
      centerFrequency,
      this.edgeFalloffLowerEdge,
      this.edgeFalloffUpperEdge,
      this.edgeFalloffEnabled,
      this.edgeFalloffHard
    );
  }

  private getBandGain(centerFrequency: number): number {
    // Shape relative to the source's measured/inherent slope. Pink noise enters
    // near -3 dB/oct; click train gets a small positive compensation so the
    // 20-band shaper lands closer to the requested overall tilt.
    const shapingSlope = this.targetOverallSlopeDbPerOctave - this.inputSlopeDbPerOctave;
    const gainDb =
      shapingSlope * Math.log2(centerFrequency / SLOPE_REF_FREQUENCY) +
      this.getEdgeFalloffGainDb(centerFrequency);
    return dbToGain(gainDb);
  }

  private getBandGainForEdgeFalloff(
    centerFrequency: number,
    lowerEdge: number,
    upperEdge: number,
    enabled: boolean,
    hard: boolean
  ): number {
    const shapingSlope = this.targetOverallSlopeDbPerOctave - this.inputSlopeDbPerOctave;
    const gainDb =
      shapingSlope * Math.log2(centerFrequency / SLOPE_REF_FREQUENCY) +
      this.getEdgeFalloffGainDbFor(centerFrequency, lowerEdge, upperEdge, enabled, hard);
    return dbToGain(gainDb);
  }

  private applyShape(scheduledTime?: number): void {
    for (let i = 0; i < NUM_BANDS; i++) {
      const fc = this.centerFrequencies[i];
      const gain = this.getBandGain(fc);
      if (scheduledTime !== undefined) {
        this.bandGains[i].gain.setValueAtTime(gain, scheduledTime);
      } else {
        this.bandGains[i].gain.value = gain;
      }
    }
  }

  private applyScheduledEdgeFalloffShape(
    lowerEdge: number,
    upperEdge: number,
    enabled: boolean,
    hard: boolean,
    scheduledTime: number
  ): void {
    for (let i = 0; i < NUM_BANDS; i++) {
      const fc = this.centerFrequencies[i];
      const gain = this.getBandGainForEdgeFalloff(fc, lowerEdge, upperEdge, enabled, hard);
      this.bandGains[i].gain.setValueAtTime(gain, scheduledTime);
    }
  }

  public cancelScheduledShapeValues(scheduledTime: number): void {
    this.bandGains.forEach((gain) => {
      gain.gain.cancelScheduledValues(scheduledTime);
    });
  }

  public setSlope(targetOverallSlopeDbPerOctave: number): void {
    this.targetOverallSlopeDbPerOctave = targetOverallSlopeDbPerOctave;
    this.applyShape();
  }

  public scheduleSlope(targetOverallSlopeDbPerOctave: number, scheduledTime: number): void {
    this.targetOverallSlopeDbPerOctave = targetOverallSlopeDbPerOctave;
    this.applyShape(scheduledTime);
  }

  public setEdgeFalloff(lowerEdge: number, upperEdge: number, enabled: boolean): void {
    this.setPassband(lowerEdge, upperEdge, enabled ? 'gentle' : 'off');
  }

  public setEdgeFalloffSharpness(dbPerOct: number): void {
    this.edgeFalloffDbPerOct = clampGentleEdgeFalloffDbPerOct(dbPerOct);
    this.applyShape();
  }

  public scheduleEdgeFalloff(lowerEdge: number, upperEdge: number, enabled: boolean, scheduledTime: number): void {
    this.schedulePassband(lowerEdge, upperEdge, enabled ? 'gentle' : 'off', scheduledTime);
  }

  public setPassband(lowerEdge: number, upperEdge: number, mode: PassbandMode): void {
    this.edgeFalloffLowerEdge = clamp(lowerEdge, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ);
    this.edgeFalloffUpperEdge = clamp(upperEdge, this.edgeFalloffLowerEdge, MAX_AUDIBLE_FREQ);
    this.edgeFalloffEnabled = mode !== 'off';
    this.edgeFalloffHard = mode === 'hard';
    this.applyShape();
  }

  public schedulePassband(lowerEdge: number, upperEdge: number, mode: PassbandMode, scheduledTime: number): void {
    const scheduledLowerEdge = clamp(lowerEdge, MIN_AUDIBLE_FREQ, MAX_AUDIBLE_FREQ);
    const scheduledUpperEdge = clamp(upperEdge, scheduledLowerEdge, MAX_AUDIBLE_FREQ);
    this.applyScheduledEdgeFalloffShape(
      scheduledLowerEdge,
      scheduledUpperEdge,
      mode !== 'off',
      mode === 'hard',
      scheduledTime
    );
  }

  public dispose(): void {
    this.stopIndependentBandNoiseSources();
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
