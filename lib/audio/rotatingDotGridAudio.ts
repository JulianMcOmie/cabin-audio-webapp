import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
const COLUMNS = 5; // Always 5 panning positions

// Sloped Pink Noise constants
const NUM_BANDS = 20;
const SLOPE_REF_FREQUENCY = 800;
const MIN_AUDIBLE_FREQ = 20;
const MAX_AUDIBLE_FREQ = 20000;
const BAND_Q_VALUE = 1.5;
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0;
const LOW_SLOPE_DB_PER_OCT = -10.5;
const HIGH_SLOPE_DB_PER_OCT = 1.5;
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1;

// Bandpassed noise constants
const BANDPASS_NOISE_SLOPE_DB_PER_OCT = -4.5;
const BANDPASS_BANDWIDTH_OCTAVES = 6.0;
const BANDPASS_NOISE_OUTPUT_GAIN_SCALAR = 0.25;

// Sine tone constants
const SINE_TONE_OUTPUT_GAIN_SCALAR = 0.15;

// Z-axis volume mapping constants
const Z_RANGE = { min: -5, max: 5 };  // Grid units
const DB_RANGE = { min: -40, max: 0 }; // Decibels

// Sound mode enum
enum SoundMode {
  SlopedNoise = 'sloped',
  BandpassedNoise = 'bandpassed',
  SineTone = 'sine'
}

// Interface for audio nodes per dot
interface PointAudioNodes {
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  volumeLevelGain: GainNode; // Controls volume based on dot's volume level (0-3)
  depthGain: GainNode; // Controls volume based on Z-axis
  panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator | null;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator | null;
  sineToneGenerator: SineToneGenerator | null;
  pinkNoiseBuffer: AudioBuffer;
  normalizedYPos: number;
  normalizedXPos: number;
  position: { x: number; y: number; z: number }; // 3D position
  volumeLevel: number; // 0 = off, 1 = -36dB, 2 = -18dB, 3 = 0dB
}

class SineToneGenerator {
  private ctx: AudioContext;
  private outputGainNode: GainNode;
  private oscillator: OscillatorNode;

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = SINE_TONE_OUTPUT_GAIN_SCALAR;

    this.oscillator = this.ctx.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.value = 440;

    this.oscillator.connect(this.outputGainNode);
    this.oscillator.start();
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
    this.outputGainNode.gain.value = SLOPED_NOISE_OUTPUT_GAIN_SCALAR;

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

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.inputGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = BANDPASS_NOISE_OUTPUT_GAIN_SCALAR;

    this.slopingFilter = new SlopedPinkNoiseGenerator(this.ctx);
    this.slopingFilter.setSlope(BANDPASS_NOISE_SLOPE_DB_PER_OCT);

    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = 100;

    this.lowpassFilter = this.ctx.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.value = 10000;

    // Chain: input -> sloping filter -> highpass -> lowpass -> output
    this.inputGainNode.connect(this.slopingFilter.getInputNode());
    this.slopingFilter.getOutputNode().connect(this.highpassFilter);
    this.highpassFilter.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.outputGainNode);

    this.currentBandwidthOctaves = BANDPASS_BANDWIDTH_OCTAVES;
    this.currentCenterFrequency = 1000;
  }

  public getInputNode(): GainNode {
    return this.inputGainNode;
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  public setBandpassFrequency(centerFreq: number): void {
    this.currentCenterFrequency = centerFreq;

    const halfBandwidth = this.currentBandwidthOctaves / 2;
    const lowFreq = centerFreq / Math.pow(2, halfBandwidth);
    const highFreq = centerFreq * Math.pow(2, halfBandwidth);

    this.highpassFilter.frequency.value = Math.max(MIN_AUDIBLE_FREQ, lowFreq);
    this.lowpassFilter.frequency.value = Math.min(MAX_AUDIBLE_FREQ, highFreq);
  }

  public setBandwidth(bandwidthOctaves: number): void {
    this.currentBandwidthOctaves = bandwidthOctaves;
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public dispose(): void {
    this.inputGainNode.disconnect();
    this.outputGainNode.disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
    this.slopingFilter.dispose();
  }
}

class RotatingDotAudioService {
  private ctx: AudioContext;
  private audioPoints: Map<string, PointAudioNodes> = new Map();
  private outputGain: GainNode;
  private currentSoundMode: SoundMode = SoundMode.BandpassedNoise;
  private currentBandwidth: number = BANDPASS_BANDWIDTH_OCTAVES;
  private currentBaseDbLevel: number = 0;

  constructor(audioContextInstance: AudioContext) {
    this.ctx = audioContextInstance;
    this.outputGain = this.ctx.createGain();
    // Start with -12dB (default volume)
    this.outputGain.gain.value = Math.pow(10, -12 / 20);
  }

  private _generateSinglePinkNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
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
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11;
    }

    // Normalize
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

  public setSoundMode(mode: SoundMode): void {
    this.currentSoundMode = mode;
  }

  public getSoundMode(): SoundMode {
    return this.currentSoundMode;
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    this.currentBandwidth = bandwidthOctaves;
    this.audioPoints.forEach(point => {
      if (point.bandpassedNoiseGenerator) {
        point.bandpassedNoiseGenerator.setBandwidth(bandwidthOctaves);
      }
    });
  }

  public setBaseVolumeDb(db: number): void {
    this.currentBaseDbLevel = db;
    // Convert dB to linear gain and apply to output
    const linearGain = Math.pow(10, db / 20);
    this.outputGain.gain.setValueAtTime(linearGain, this.ctx.currentTime);
  }

  private calculateFrequencyFromY(normalizedY: number): number {
    const minFreq = 50;
    const maxFreq = 14000;
    const logMin = Math.log2(minFreq);
    const logMax = Math.log2(maxFreq);

    // Invert Y so top = high frequency
    const invertedY = 1 - normalizedY;
    const logFreq = logMin + invertedY * (logMax - logMin);
    return Math.pow(2, logFreq);
  }

  private calculateSlopeFromY(normalizedY: number): number {
    // Invert Y so top = bright (positive slope), bottom = dark (negative slope)
    const invertedY = 1 - normalizedY;
    return LOW_SLOPE_DB_PER_OCT + invertedY * (HIGH_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
  }

  private calculateDepthGain(z: number): number {
    // Map Z from [-5, 5] to [0, 1]
    const normalizedZ = (z - Z_RANGE.min) / (Z_RANGE.max - Z_RANGE.min);

    // Map to dB range: -40dB to 0dB
    const dbValue = DB_RANGE.min + normalizedZ * (DB_RANGE.max - DB_RANGE.min);

    // Convert dB to linear gain
    return Math.pow(10, dbValue / 20);
  }

  private calculateVolumeLevelGain(level: number): number {
    // Level 0: off (silent)
    // Level 1: -36dB
    // Level 2: -18dB
    // Level 3: 0dB (full volume)
    if (level === 0) return 0;
    const dbValue = (level - 3) * 18; // -36, -18, or 0
    return Math.pow(10, dbValue / 20);
  }

  public addPoint(id: string, x: number, y: number, z: number = 0, volumeLevel: number = 3): void {
    if (this.audioPoints.has(id)) {
      this.removePoint(id);
    }

    const pinkNoiseBuffer = this._generateSinglePinkNoiseBuffer();

    // Create source
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;

    // Create gain nodes
    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const volumeLevelGain = this.ctx.createGain();
    volumeLevelGain.gain.value = this.calculateVolumeLevelGain(volumeLevel);

    const depthGain = this.ctx.createGain();
    depthGain.gain.value = this.calculateDepthGain(z);

    // Create panner
    const panner = this.ctx.createStereoPanner();
    const panPosition = x * 2 - 1; // Map [0,1] to [-1,1]
    panner.pan.value = panPosition;

    // Create generators based on sound mode
    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;

    switch (this.currentSoundMode) {
      case SoundMode.SlopedNoise:
        slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
        const slope = this.calculateSlopeFromY(y);
        slopedNoiseGenerator.setSlope(slope);
        source.connect(slopedNoiseGenerator.getInputNode());
        slopedNoiseGenerator.getOutputNode().connect(mainGain);
        break;

      case SoundMode.BandpassedNoise:
        bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);
        bandpassedNoiseGenerator.setBandwidth(this.currentBandwidth);
        const frequency = this.calculateFrequencyFromY(y);
        bandpassedNoiseGenerator.setBandpassFrequency(frequency);
        source.connect(bandpassedNoiseGenerator.getInputNode());
        bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
        break;

      case SoundMode.SineTone:
        sineToneGenerator = new SineToneGenerator(this.ctx);
        const sineFreq = this.calculateFrequencyFromY(y);
        sineToneGenerator.setFrequency(sineFreq);
        sineToneGenerator.getOutputNode().connect(mainGain);
        break;
    }

    // Connect the chain: mainGain -> volumeLevelGain -> depthGain -> panner -> output
    mainGain.connect(volumeLevelGain);
    volumeLevelGain.connect(depthGain);
    depthGain.connect(panner);
    panner.connect(this.outputGain);

    // Store audio nodes
    this.audioPoints.set(id, {
      source,
      mainGain,
      volumeLevelGain,
      depthGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      sineToneGenerator,
      pinkNoiseBuffer,
      normalizedYPos: y,
      normalizedXPos: x,
      position: { x, y, z },
      volumeLevel
    });

    // Start playing immediately
    source.start();
  }

  public removePoint(id: string): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    // Stop and disconnect
    try {
      point.source.stop();
    } catch {
      // Source might already be stopped
    }

    point.source.disconnect();
    point.mainGain.disconnect();
    point.volumeLevelGain.disconnect();
    point.depthGain.disconnect();
    point.panner.disconnect();

    if (point.slopedNoiseGenerator) {
      point.slopedNoiseGenerator.dispose();
    }
    if (point.bandpassedNoiseGenerator) {
      point.bandpassedNoiseGenerator.dispose();
    }
    if (point.sineToneGenerator) {
      point.sineToneGenerator.dispose();
    }

    this.audioPoints.delete(id);
  }

  public updatePointVolumeLevel(id: string, volumeLevel: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    point.volumeLevel = volumeLevel;
    const gain = this.calculateVolumeLevelGain(volumeLevel);
    point.volumeLevelGain.gain.setValueAtTime(gain, this.ctx.currentTime);
  }

  public updatePointPosition(id: string, x: number, y: number, z: number): void {
    const point = this.audioPoints.get(id);
    if (!point) return;

    // Clamp normalized coordinates to valid ranges
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    const clampedZ = Math.max(Z_RANGE.min, Math.min(Z_RANGE.max, z));

    // Update position
    point.position = { x: clampedX, y: clampedY, z: clampedZ };
    point.normalizedXPos = clampedX;
    point.normalizedYPos = clampedY;

    // Update panning (map [0, 1] to [-1, 1])
    const panPosition = clampedX * 2 - 1;
    point.panner.pan.setValueAtTime(panPosition, this.ctx.currentTime);

    // Update frequency/slope based on Y position
    const frequency = this.calculateFrequencyFromY(clampedY);

    if (point.bandpassedNoiseGenerator) {
      point.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
    } else if (point.slopedNoiseGenerator) {
      const slope = this.calculateSlopeFromY(clampedY);
      point.slopedNoiseGenerator.setSlope(slope);
    } else if (point.sineToneGenerator) {
      point.sineToneGenerator.setFrequency(frequency);
    }

    // Update depth gain (volume from Z)
    const depthGain = this.calculateDepthGain(clampedZ);
    point.depthGain.gain.setValueAtTime(depthGain, this.ctx.currentTime);
  }

  public dispose(): void {
    // Remove all points
    const pointIds = Array.from(this.audioPoints.keys());
    pointIds.forEach(id => this.removePoint(id));

    this.outputGain.disconnect();
  }
}

// Singleton player class
export class RotatingDotGridPlayer {
  private static instance: RotatingDotGridPlayer | null = null;
  private audioService: RotatingDotAudioService;
  private isPlaying: boolean = false;
  private activeDotKeys: Set<string> = new Set();
  private dotVolumeLevels: Map<string, number> = new Map(); // Volume level for each dot (0-3)
  private gridSize: number = 3;
  private columnCount: number = COLUMNS;

  private constructor() {
    this.audioService = new RotatingDotAudioService(audioContext.getAudioContext());

    // Connect to EQ processor
    const processor = eqProcessor.getEQProcessor();
    const eqInput = processor.getInputNode();
    this.audioService.getOutputNode().connect(eqInput);
  }

  public static getInstance(): RotatingDotGridPlayer {
    if (!RotatingDotGridPlayer.instance) {
      RotatingDotGridPlayer.instance = new RotatingDotGridPlayer();
    }
    return RotatingDotGridPlayer.instance;
  }

  public updateDots(dots: Set<string>, gridSize: number, columnCount: number): void {
    this.gridSize = gridSize;
    this.columnCount = columnCount;

    // Remove dots that are no longer in the grid
    this.activeDotKeys.forEach(dotKey => {
      if (!dots.has(dotKey)) {
        this.audioService.removePoint(dotKey);
        this.activeDotKeys.delete(dotKey);
        this.dotVolumeLevels.delete(dotKey);
      }
    });

    // Add newly added dots
    dots.forEach(dotKey => {
      if (!this.activeDotKeys.has(dotKey)) {
        const [xStr, yStr] = dotKey.split(',');
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);

        // Normalize coordinates to [0, 1]
        const normalizedX = x / (columnCount - 1);
        const normalizedY = y / (gridSize - 1);

        // Initialize at full volume (level 3)
        const volumeLevel = this.dotVolumeLevels.get(dotKey) ?? 3;
        this.dotVolumeLevels.set(dotKey, volumeLevel);

        // Add point with z=0 initially (on XY plane)
        this.audioService.addPoint(dotKey, normalizedX, normalizedY, 0, volumeLevel);
        this.activeDotKeys.add(dotKey);
      }
    });
  }

  public updateDotVolumeLevel(dotKey: string, volumeLevel: number): void {
    this.dotVolumeLevels.set(dotKey, volumeLevel);
    this.audioService.updatePointVolumeLevel(dotKey, volumeLevel);
  }

  public getDotVolumeLevel(dotKey: string): number {
    return this.dotVolumeLevels.get(dotKey) ?? 3;
  }

  public updateDotPosition(dotKey: string, x: number, y: number, z: number): void {
    if (!this.activeDotKeys.has(dotKey)) return;

    // Normalize x and y to [0, 1]
    const normalizedX = x / (this.columnCount - 1);
    const normalizedY = y / (this.gridSize - 1);

    this.audioService.updatePointPosition(dotKey, normalizedX, normalizedY, z);
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    // In continuous mode, sound is always on, so this mainly tracks state
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  public setSoundMode(mode: SoundMode): void {
    this.audioService.setSoundMode(mode);

    // Recreate all audio points with new generator type
    if (this.isPlaying && this.activeDotKeys.size > 0) {
      const currentDots = new Set(this.activeDotKeys);
      this.updateDots(currentDots, this.gridSize, this.columnCount);
    }
  }

  public getSoundMode(): SoundMode {
    return this.audioService.getSoundMode();
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    this.audioService.setBandpassBandwidth(bandwidthOctaves);
  }

  public setVolumeDb(dbLevel: number): void {
    this.audioService.setBaseVolumeDb(dbLevel);
  }

  public dispose(): void {
    this.setPlaying(false);
    this.audioService.dispose();
  }
}

// Export singleton instance
export const rotatingDotGridPlayer = RotatingDotGridPlayer.getInstance();

// Export SoundMode enum
export { SoundMode };
