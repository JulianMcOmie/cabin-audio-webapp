import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants (copied from soundstageExplorerAudio.ts)
const BANDPASS_NOISE_SLOPE_DB_PER_OCT = -4.5;
const BANDPASS_BANDWIDTH_OCTAVES = 6.0;
const BANDPASS_NOISE_OUTPUT_GAIN_SCALAR = 0.25;
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0;
const NUM_BANDS = 20;
const SLOPE_REF_FREQUENCY = 800;
const MIN_AUDIBLE_FREQ = 20;
const MAX_AUDIBLE_FREQ = 20000;
const BAND_Q_VALUE = 1.5;
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1;
const SINE_TONE_OUTPUT_GAIN_SCALAR = 0.15;
const MASTER_GAIN = 6.0;

// Sound mode enum
enum SoundMode {
  SlopedNoise = 'sloped',
  BandpassedNoise = 'bandpassed',
  SineTone = 'sine'
}

// Generator classes (copied from soundstageExplorerAudio.ts)

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
  private isHighpassActive: boolean = true;
  private isLowpassActive: boolean = true;

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;
    this.inputGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = BANDPASS_NOISE_OUTPUT_GAIN_SCALAR;

    this.slopingFilter = new SlopedPinkNoiseGenerator(this.ctx);
    this.slopingFilter.setSlope(BANDPASS_NOISE_SLOPE_DB_PER_OCT);

    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.Q.value = 10;

    this.lowpassFilter = this.ctx.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.Q.value = 10;

    this.currentBandwidthOctaves = BANDPASS_BANDWIDTH_OCTAVES;
    this.currentCenterFrequency = 1000;

    this.inputGainNode.connect(this.slopingFilter.getInputNode());
    this.connectFilterChain(true, true);
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public getInputNode(): GainNode {
    return this.inputGainNode;
  }

  public getOutputNode(): GainNode {
    return this.outputGainNode;
  }

  private calculateQFromBandwidth(bandwidthOctaves: number): number {
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
      slopingOutput.connect(this.highpassFilter);
      this.highpassFilter.connect(this.lowpassFilter);
      this.lowpassFilter.connect(this.outputGainNode);
    } else if (useHighpass && !useLowpass) {
      slopingOutput.connect(this.highpassFilter);
      this.highpassFilter.connect(this.outputGainNode);
    } else if (!useHighpass && useLowpass) {
      slopingOutput.connect(this.lowpassFilter);
      this.lowpassFilter.connect(this.outputGainNode);
    } else {
      slopingOutput.connect(this.outputGainNode);
    }
  }

  private updateFilterChain(lowerEdge: number, upperEdge: number): void {
    const MIN_AUDIBLE = 20;
    const MAX_AUDIBLE = 20000;

    const needHighpass = lowerEdge >= MIN_AUDIBLE;
    const needLowpass = upperEdge <= MAX_AUDIBLE;

    if (needHighpass !== this.isHighpassActive || needLowpass !== this.isLowpassActive) {
      this.disconnectFilterChain();
      this.connectFilterChain(needHighpass, needLowpass);
      this.isHighpassActive = needHighpass;
      this.isLowpassActive = needLowpass;
    }
  }

  public setBandpassFrequency(frequency: number): void {
    this.currentCenterFrequency = frequency;

    const halfBandwidth = this.currentBandwidthOctaves / 2;
    const lowerEdge = frequency / Math.pow(2, halfBandwidth);
    const upperEdge = frequency * Math.pow(2, halfBandwidth);

    this.updateFilterChain(lowerEdge, upperEdge);

    this.highpassFilter.frequency.value = Math.max(20, Math.min(20000, lowerEdge));
    this.lowpassFilter.frequency.value = Math.max(20, Math.min(20000, upperEdge));

    const qValue = this.calculateQFromBandwidth(this.currentBandwidthOctaves);
    this.highpassFilter.Q.value = qValue;
    this.lowpassFilter.Q.value = qValue;
  }

  public setBandpassBandwidth(bandwidthOctaves: number): void {
    this.currentBandwidthOctaves = Math.max(0.1, Math.min(10, bandwidthOctaves));
    this.setBandpassFrequency(this.currentCenterFrequency);
  }

  public dispose(): void {
    this.slopingFilter.dispose();
    this.inputGainNode.disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
    this.outputGainNode.disconnect();
  }
}

// Interface for a single dot
interface DotAudioNodes {
  id: string;
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  depthGain: GainNode; // Controls volume based on depth (z-axis)
  panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator | null;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator | null;
  sineToneGenerator: SineToneGenerator | null;
  pinkNoiseBuffer: AudioBuffer;
  position: { x: number; y: number; z: number }; // z is depth (0 = far, 1 = close)
}

class MultiDot3DService {
  private ctx: AudioContext;
  private outputGain: GainNode;
  private currentSoundMode: SoundMode = SoundMode.BandpassedNoise;
  private currentBandwidth: number = BANDPASS_BANDWIDTH_OCTAVES;
  private dots: Map<string, DotAudioNodes> = new Map();
  private isPlaying: boolean = false;

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

  private calculateFrequencyFromPosition(normalizedY: number): number {
    // Map Y position to frequency (logarithmic scale)
    // normalizedY: 0 (top) = high frequency, 1 (bottom) = low frequency
    const minFreq = 20;
    const maxFreq = 20000;
    const logMin = Math.log2(minFreq);
    const logMax = Math.log2(maxFreq);

    // Invert Y so top = high frequency
    const invertedY = 1 - normalizedY;
    const logFreq = logMin + invertedY * (logMax - logMin);
    return Math.pow(2, logFreq);
  }

  private calculateDepthGain(z: number): number {
    // z ranges from 0 (far) to 1 (close)
    // Map to dB range: far = -40dB, close = 0dB
    const minDb = -40;
    const maxDb = 0;
    const dbValue = minDb + z * (maxDb - minDb);
    return Math.pow(10, dbValue / 20);
  }

  public addDot(id: string, x: number, y: number, z: number): void {
    if (this.dots.has(id)) {
      return; // Dot already exists
    }

    // Create pink noise buffer
    const pinkNoiseBuffer = this.generatePinkNoiseBuffer();

    // Create source
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;

    // Create gain nodes
    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const depthGain = this.ctx.createGain();
    depthGain.gain.value = this.calculateDepthGain(z);

    // Create panner
    const panner = this.ctx.createStereoPanner();
    const panPosition = x * 2 - 1;
    panner.pan.value = panPosition;

    // Create generators based on current sound mode
    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;

    // Calculate frequency from Y position
    const frequency = this.calculateFrequencyFromPosition(y);

    if (this.currentSoundMode === SoundMode.BandpassedNoise) {
      bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);
      bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      bandpassedNoiseGenerator.setBandpassFrequency(frequency);

      source.connect(bandpassedNoiseGenerator.getInputNode());
      bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SlopedNoise) {
      slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
      const slope = -10.5 + y * (1.5 - (-10.5));
      slopedNoiseGenerator.setSlope(slope);

      source.connect(slopedNoiseGenerator.getInputNode());
      slopedNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SineTone) {
      sineToneGenerator = new SineToneGenerator(this.ctx);
      sineToneGenerator.setFrequency(frequency);

      source.connect(mainGain);
      sineToneGenerator.getOutputNode().connect(mainGain);
    }

    // Connect the chain: mainGain -> depthGain -> panner -> output
    mainGain.connect(depthGain);
    depthGain.connect(panner);
    panner.connect(this.outputGain);

    // Start the source if playing
    if (this.isPlaying) {
      source.start();
    }

    const dotNodes: DotAudioNodes = {
      id,
      source,
      mainGain,
      depthGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      sineToneGenerator,
      pinkNoiseBuffer,
      position: { x, y, z }
    };

    this.dots.set(id, dotNodes);
  }

  public removeDot(id: string): void {
    const dot = this.dots.get(id);
    if (!dot) return;

    try {
      dot.source.stop();
    } catch {
      // Source might already be stopped
    }

    dot.source.disconnect();
    dot.mainGain.disconnect();
    dot.depthGain.disconnect();
    dot.panner.disconnect();

    if (dot.slopedNoiseGenerator) {
      dot.slopedNoiseGenerator.dispose();
    }
    if (dot.bandpassedNoiseGenerator) {
      dot.bandpassedNoiseGenerator.dispose();
    }
    if (dot.sineToneGenerator) {
      dot.sineToneGenerator.dispose();
    }

    this.dots.delete(id);
  }

  public updateDotPosition(id: string, x: number, y: number, z: number): void {
    const dot = this.dots.get(id);
    if (!dot) return;

    dot.position = { x, y, z };

    // Update pan position
    const panPosition = x * 2 - 1;
    dot.panner.pan.setValueAtTime(panPosition, this.ctx.currentTime);

    // Update frequency
    const frequency = this.calculateFrequencyFromPosition(y);

    if (dot.bandpassedNoiseGenerator) {
      dot.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
    } else if (dot.slopedNoiseGenerator) {
      const slope = -10.5 + y * (1.5 - (-10.5));
      dot.slopedNoiseGenerator.setSlope(slope);
    } else if (dot.sineToneGenerator) {
      dot.sineToneGenerator.setFrequency(frequency);
    }

    // Update depth gain
    const depthGain = this.calculateDepthGain(z);
    dot.depthGain.gain.setValueAtTime(depthGain, this.ctx.currentTime);
  }

  public startPlaying(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;

    // Start all dot sources
    this.dots.forEach(dot => {
      dot.source.start();
    });
  }

  public stopPlaying(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    // Stop and dispose all dots
    const dotIds = Array.from(this.dots.keys());
    dotIds.forEach(id => this.removeDot(id));
  }

  public getAllDots(): Map<string, { x: number; y: number; z: number }> {
    const result = new Map<string, { x: number; y: number; z: number }>();
    this.dots.forEach((dot, id) => {
      result.set(id, { ...dot.position });
    });
    return result;
  }

  public getOutputNode(): GainNode {
    return this.outputGain;
  }

  public setSoundMode(mode: SoundMode): void {
    // Changing sound mode requires recreating all dots
    const currentDots = Array.from(this.dots.entries()).map(([id, dot]) => ({
      id,
      position: { ...dot.position }
    }));

    // Remove all dots
    currentDots.forEach(({ id }) => this.removeDot(id));

    // Update mode
    this.currentSoundMode = mode;

    // Recreate dots with new mode
    currentDots.forEach(({ id, position }) => {
      this.addDot(id, position.x, position.y, position.z);
    });
  }

  public getSoundMode(): SoundMode {
    return this.currentSoundMode;
  }

  public setBandwidth(octaves: number): void {
    this.currentBandwidth = Math.max(0.1, Math.min(10, octaves));
    this.dots.forEach(dot => {
      if (dot.bandpassedNoiseGenerator) {
        dot.bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      }
    });
  }

  public getBandwidth(): number {
    return this.currentBandwidth;
  }

  public dispose(): void {
    this.stopPlaying();
    this.outputGain.disconnect();
  }
}

// Singleton instance
class MultiDot3DPlayer {
  private static instance: MultiDot3DPlayer | null = null;
  private service: MultiDot3DService;

  private constructor() {
    const ctx = audioContext.getAudioContext();
    this.service = new MultiDot3DService(ctx);

    // Connect to EQ processor
    const processor = eqProcessor.getEQProcessor();
    const eqInput = processor.getInputNode();
    if (eqInput) {
      this.service.getOutputNode().connect(eqInput);
    }
  }

  public static getInstance(): MultiDot3DPlayer {
    if (!MultiDot3DPlayer.instance) {
      MultiDot3DPlayer.instance = new MultiDot3DPlayer();
    }
    return MultiDot3DPlayer.instance;
  }

  public addDot(id: string, x: number, y: number, z: number): void {
    this.service.addDot(id, x, y, z);
  }

  public removeDot(id: string): void {
    this.service.removeDot(id);
  }

  public updateDotPosition(id: string, x: number, y: number, z: number): void {
    this.service.updateDotPosition(id, x, y, z);
  }

  public startPlaying(): void {
    this.service.startPlaying();
  }

  public stopPlaying(): void {
    this.service.stopPlaying();
  }

  public getAllDots(): Map<string, { x: number; y: number; z: number }> {
    return this.service.getAllDots();
  }

  public setSoundMode(mode: 'sloped' | 'bandpassed' | 'sine'): void {
    const soundMode = mode === 'sloped' ? SoundMode.SlopedNoise :
                     mode === 'bandpassed' ? SoundMode.BandpassedNoise :
                     SoundMode.SineTone;
    this.service.setSoundMode(soundMode);
  }

  public getSoundMode(): 'sloped' | 'bandpassed' | 'sine' {
    const mode = this.service.getSoundMode();
    return mode === SoundMode.SlopedNoise ? 'sloped' :
           mode === SoundMode.BandpassedNoise ? 'bandpassed' :
           'sine';
  }

  public setBandwidth(octaves: number): void {
    this.service.setBandwidth(octaves);
  }

  public getBandwidth(): number {
    return this.service.getBandwidth();
  }

  public dispose(): void {
    this.service.dispose();
    MultiDot3DPlayer.instance = null;
  }
}

// Exported functions
export function getMultiDot3DPlayer(): MultiDot3DPlayer {
  return MultiDot3DPlayer.getInstance();
}

export function cleanupMultiDot3DPlayer(): void {
  const player = MultiDot3DPlayer.getInstance();
  player.dispose();
}
