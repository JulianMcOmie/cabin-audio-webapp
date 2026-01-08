import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
const NOISE_SLOPE_DB_PER_OCT = -4.5;
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0;
const NUM_BANDS = 20;
const SLOPE_REF_FREQUENCY = 800;
const MIN_AUDIBLE_FREQ = 20;
const MAX_AUDIBLE_FREQ = 20000;
const BAND_Q_VALUE = 1.5;
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1;
const MASTER_GAIN = 0.8;
const FILTER_Q = 0.707; // Butterworth

const DEFAULT_NUM_POSITIONS = 5;
const MIN_POSITIONS = 3;
const MAX_POSITIONS = 15;
const STOPBAND_DURATION_MS = 250; // Fixed 250ms with notch
const DEFAULT_FILLIN_DURATION_MS = 1000; // Adjustable fill-in time
const DEFAULT_BANDWIDTH_OCTAVES = 1.0;

// SlopedPinkNoiseGenerator - creates noise with specified spectral slope
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

// Single noise generator with movable pan and toggleable fill-in
class StopbandNoiseGenerator {
  private ctx: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private slopedNoise: SlopedPinkNoiseGenerator;

  // Three filter paths
  private lowBandFilter: BiquadFilterNode;
  private highBandFilter: BiquadFilterNode;
  private midBandHighpass: BiquadFilterNode;
  private midBandLowpass: BiquadFilterNode;

  // Output chain
  private volumeGain: GainNode;
  private panner: StereoPannerNode;

  // State
  private isFillinConnected: boolean = false;
  private currentCenterFrequency: number = 1000;
  private currentBandwidthOctaves: number = DEFAULT_BANDWIDTH_OCTAVES;

  constructor(audioCtx: AudioContext, noiseBuffer: AudioBuffer) {
    this.ctx = audioCtx;

    // Create sloped noise generator
    this.slopedNoise = new SlopedPinkNoiseGenerator(audioCtx);
    this.slopedNoise.setSlope(NOISE_SLOPE_DB_PER_OCT);

    // Low band: lowpass filter
    this.lowBandFilter = this.ctx.createBiquadFilter();
    this.lowBandFilter.type = 'lowpass';
    this.lowBandFilter.Q.value = FILTER_Q;

    // High band: highpass filter
    this.highBandFilter = this.ctx.createBiquadFilter();
    this.highBandFilter.type = 'highpass';
    this.highBandFilter.Q.value = FILTER_Q;

    // Mid band (fill-in): highpass → lowpass chain
    this.midBandHighpass = this.ctx.createBiquadFilter();
    this.midBandHighpass.type = 'highpass';
    this.midBandHighpass.Q.value = FILTER_Q;

    this.midBandLowpass = this.ctx.createBiquadFilter();
    this.midBandLowpass.type = 'lowpass';
    this.midBandLowpass.Q.value = FILTER_Q;

    // Output chain
    this.volumeGain = this.ctx.createGain();
    this.volumeGain.gain.value = 1.0;

    this.panner = this.ctx.createStereoPanner();
    this.panner.pan.value = 0;

    // Connect sloped noise output to filter paths
    const slopedOutput = this.slopedNoise.getOutputNode();

    // Low band path (always connected)
    slopedOutput.connect(this.lowBandFilter);
    this.lowBandFilter.connect(this.volumeGain);

    // High band path (always connected)
    slopedOutput.connect(this.highBandFilter);
    this.highBandFilter.connect(this.volumeGain);

    // Mid band path (toggled)
    slopedOutput.connect(this.midBandHighpass);
    this.midBandHighpass.connect(this.midBandLowpass);
    // midBandLowpass NOT connected initially

    // Output
    this.volumeGain.connect(this.panner);

    // Create and start noise source
    this.source = this.ctx.createBufferSource();
    this.source.buffer = noiseBuffer;
    this.source.loop = true;
    this.source.connect(this.slopedNoise.getInputNode());
    this.source.start();

    this.updateFilterFrequencies();
  }

  private updateFilterFrequencies(): void {
    const halfBandwidth = this.currentBandwidthOctaves / 2;
    const lowEdge = this.currentCenterFrequency / Math.pow(2, halfBandwidth);
    const highEdge = this.currentCenterFrequency * Math.pow(2, halfBandwidth);

    const clampedLowEdge = Math.max(MIN_AUDIBLE_FREQ, Math.min(MAX_AUDIBLE_FREQ, lowEdge));
    const clampedHighEdge = Math.max(MIN_AUDIBLE_FREQ, Math.min(MAX_AUDIBLE_FREQ, highEdge));

    this.lowBandFilter.frequency.value = clampedLowEdge;
    this.highBandFilter.frequency.value = clampedHighEdge;
    this.midBandHighpass.frequency.value = clampedLowEdge;
    this.midBandLowpass.frequency.value = clampedHighEdge;
  }

  public setFrequency(frequency: number): void {
    this.currentCenterFrequency = Math.max(MIN_AUDIBLE_FREQ, Math.min(MAX_AUDIBLE_FREQ, frequency));
    this.updateFilterFrequencies();
  }

  public setBandwidth(octaves: number): void {
    this.currentBandwidthOctaves = Math.max(0.1, Math.min(6, octaves));
    this.updateFilterFrequencies();
  }

  public setFillinActive(active: boolean): void {
    if (active && !this.isFillinConnected) {
      this.midBandLowpass.connect(this.volumeGain);
      this.isFillinConnected = true;
    } else if (!active && this.isFillinConnected) {
      this.midBandLowpass.disconnect(this.volumeGain);
      this.isFillinConnected = false;
    }
  }

  public setPan(pan: number): void {
    this.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), this.ctx.currentTime);
  }

  public setVolume(volume: number): void {
    this.volumeGain.gain.setValueAtTime(volume, this.ctx.currentTime);
  }

  public getOutputNode(): StereoPannerNode {
    return this.panner;
  }

  public dispose(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Source might already be stopped
      }
      this.source.disconnect();
    }

    this.slopedNoise.dispose();
    this.lowBandFilter.disconnect();
    this.highBandFilter.disconnect();
    this.midBandHighpass.disconnect();
    this.midBandLowpass.disconnect();
    this.volumeGain.disconnect();
    this.panner.disconnect();
  }
}

// Service - manages single generator cycling through positions
class StopbandExplorerService {
  private ctx: AudioContext;
  private generator: StopbandNoiseGenerator | null = null;
  private outputGain: GainNode;
  private sharedNoiseBuffer: AudioBuffer | null = null;

  // Settings
  private numPositions: number = DEFAULT_NUM_POSITIONS;
  private fillinDurationMs: number = DEFAULT_FILLIN_DURATION_MS;
  private bandwidthOctaves: number = DEFAULT_BANDWIDTH_OCTAVES;
  private currentVolume: number = 1.0;
  private frequencyY: number = 0.5;

  // Cycling state
  private isPlaying: boolean = false;
  private currentPositionIndex: number = 0;
  private isInFillinPhase: boolean = false;
  private phaseStartTime: number = 0;
  private animationFrameId: number | null = null;

  constructor(audioContextInstance: AudioContext) {
    this.ctx = audioContextInstance;
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = MASTER_GAIN;
  }

  private generatePinkNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2;
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

  private getNoiseBuffer(): AudioBuffer {
    if (!this.sharedNoiseBuffer) {
      this.sharedNoiseBuffer = this.generatePinkNoiseBuffer();
    }
    return this.sharedNoiseBuffer;
  }

  private calculateFrequencyFromPosition(normalizedY: number): number {
    const halfBandwidth = this.bandwidthOctaves / 2;
    const constrainedMaxFreq = MAX_AUDIBLE_FREQ / Math.pow(2, halfBandwidth);
    const constrainedMinFreq = MIN_AUDIBLE_FREQ * Math.pow(2, halfBandwidth);

    const logMin = Math.log2(constrainedMinFreq);
    const logMax = Math.log2(constrainedMaxFreq);

    // Invert Y so top = high frequency
    const invertedY = 1 - normalizedY;
    const logFreq = logMin + invertedY * (logMax - logMin);
    return Math.pow(2, logFreq);
  }

  private getPanForPosition(index: number): number {
    if (this.numPositions === 1) return 0;
    return (index / (this.numPositions - 1)) * 2 - 1;
  }

  private createGenerator(): void {
    this.disposeGenerator();

    const noiseBuffer = this.getNoiseBuffer();
    const frequency = this.calculateFrequencyFromPosition(this.frequencyY);

    this.generator = new StopbandNoiseGenerator(this.ctx, noiseBuffer);
    this.generator.setFrequency(frequency);
    this.generator.setBandwidth(this.bandwidthOctaves);
    this.generator.setVolume(this.currentVolume);
    this.generator.setPan(this.getPanForPosition(0));
    this.generator.getOutputNode().connect(this.outputGain);
  }

  private disposeGenerator(): void {
    if (this.generator) {
      this.generator.dispose();
      this.generator = null;
    }
  }

  private updateCycle = (): void => {
    if (!this.isPlaying || !this.generator) return;

    const now = performance.now();
    const elapsed = now - this.phaseStartTime;

    if (!this.isInFillinPhase) {
      // Stopband phase (notch only, no fill-in)
      if (elapsed >= STOPBAND_DURATION_MS) {
        // Switch to fill-in phase
        this.isInFillinPhase = true;
        this.phaseStartTime = now;
        this.generator.setFillinActive(true);
      }
    } else {
      // Fill-in phase
      if (elapsed >= this.fillinDurationMs) {
        // Move to next position
        this.currentPositionIndex = (this.currentPositionIndex + 1) % this.numPositions;
        this.generator.setPan(this.getPanForPosition(this.currentPositionIndex));

        // Switch back to stopband phase
        this.isInFillinPhase = false;
        this.phaseStartTime = now;
        this.generator.setFillinActive(false);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.updateCycle);
  };

  public startPlaying(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.createGenerator();

    // Start at position 0, stopband phase
    this.currentPositionIndex = 0;
    this.isInFillinPhase = false;
    this.phaseStartTime = performance.now();
    if (this.generator) {
      this.generator.setFillinActive(false);
      this.generator.setPan(this.getPanForPosition(0));
    }

    this.updateCycle();
  }

  public stopPlaying(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.disposeGenerator();
  }

  public setNumPositions(n: number): void {
    this.numPositions = Math.max(MIN_POSITIONS, Math.min(MAX_POSITIONS, n));
    // Reset to position 0 if current position is out of range
    if (this.currentPositionIndex >= this.numPositions) {
      this.currentPositionIndex = 0;
      if (this.generator) {
        this.generator.setPan(this.getPanForPosition(0));
      }
    }
  }

  public getNumPositions(): number {
    return this.numPositions;
  }

  public setFillinDuration(ms: number): void {
    this.fillinDurationMs = Math.max(100, Math.min(5000, ms));
  }

  public getFillinDuration(): number {
    return this.fillinDurationMs;
  }

  public setFrequencyY(y: number): void {
    this.frequencyY = Math.max(0, Math.min(1, y));
    const frequency = this.calculateFrequencyFromPosition(this.frequencyY);
    if (this.generator) {
      this.generator.setFrequency(frequency);
    }
  }

  public getFrequencyY(): number {
    return this.frequencyY;
  }

  public setBandwidth(octaves: number): void {
    this.bandwidthOctaves = Math.max(0.1, Math.min(6, octaves));
    if (this.generator) {
      this.generator.setBandwidth(this.bandwidthOctaves);
    }
  }

  public getBandwidth(): number {
    return this.bandwidthOctaves;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.generator) {
      this.generator.setVolume(this.currentVolume);
    }
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public getOutputNode(): GainNode {
    return this.outputGain;
  }

  public getCurrentPositionIndex(): number {
    return this.currentPositionIndex;
  }

  public getIsInFillinPhase(): boolean {
    return this.isInFillinPhase;
  }

  public dispose(): void {
    this.stopPlaying();
    this.outputGain.disconnect();
    this.sharedNoiseBuffer = null;
  }
}

// Singleton Player
class StopbandExplorerPlayer {
  private static instance: StopbandExplorerPlayer | null = null;
  private service: StopbandExplorerService;

  private constructor() {
    const ctx = audioContext.getAudioContext();
    this.service = new StopbandExplorerService(ctx);

    const processor = eqProcessor.getEQProcessor();
    const eqInput = processor.getInputNode();
    if (eqInput) {
      this.service.getOutputNode().connect(eqInput);
    }
  }

  public static getInstance(): StopbandExplorerPlayer {
    if (!StopbandExplorerPlayer.instance) {
      StopbandExplorerPlayer.instance = new StopbandExplorerPlayer();
    }
    return StopbandExplorerPlayer.instance;
  }

  public startPlaying(): void {
    this.service.startPlaying();
  }

  public stopPlaying(): void {
    this.service.stopPlaying();
  }

  public setNumGenerators(n: number): void {
    this.service.setNumPositions(n);
  }

  public getNumGenerators(): number {
    return this.service.getNumPositions();
  }

  public setFillinDuration(ms: number): void {
    this.service.setFillinDuration(ms);
  }

  public getFillinDuration(): number {
    return this.service.getFillinDuration();
  }

  public setFrequencyY(y: number): void {
    this.service.setFrequencyY(y);
  }

  public getFrequencyY(): number {
    return this.service.getFrequencyY();
  }

  public setBandwidth(octaves: number): void {
    this.service.setBandwidth(octaves);
  }

  public getBandwidth(): number {
    return this.service.getBandwidth();
  }

  public setVolume(volume: number): void {
    this.service.setVolume(volume);
  }

  public getVolume(): number {
    return this.service.getVolume();
  }

  public getCurrentActiveIndex(): number {
    return this.service.getCurrentPositionIndex();
  }

  public getIsInFillinPhase(): boolean {
    return this.service.getIsInFillinPhase();
  }

  public dispose(): void {
    this.service.dispose();
    StopbandExplorerPlayer.instance = null;
  }
}

// Exported functions
export function getStopbandExplorerPlayer(): StopbandExplorerPlayer {
  return StopbandExplorerPlayer.getInstance();
}

export function cleanupStopbandExplorerPlayer(): void {
  const player = StopbandExplorerPlayer.getInstance();
  player.dispose();
}
