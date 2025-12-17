import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Import generator classes from dotGridAudio - we'll reuse them
// Since they're not exported, we'll create our own instances here
// Following the same pattern as dotGridAudio.ts

// Constants (copied from dotGridAudio.ts)
const BANDPASS_NOISE_SLOPE_DB_PER_OCT = -4.5;
const BANDPASS_BANDWIDTH_OCTAVES = 6.0; // Default to 6 octaves as requested
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

// Generator classes (copied from dotGridAudio.ts to reuse the same core sound generation)

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

// Audio nodes for the soundstage explorer
interface ExplorerAudioNodes {
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  volumeGain: GainNode; // For oscillating volume
  panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator | null;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator | null;
  sineToneGenerator: SineToneGenerator | null;
  pinkNoiseBuffer: AudioBuffer;
}

class SoundstageExplorerService {
  private ctx: AudioContext;
  private audioNodes: ExplorerAudioNodes | null = null;
  private outputGain: GainNode;
  private currentSoundMode: SoundMode = SoundMode.BandpassedNoise;
  private currentBandwidth: number = BANDPASS_BANDWIDTH_OCTAVES;

  // Always playing oscillation settings
  private oscillationSpeed: number = 1.5; // Default: 1.5 oscillations per second
  private oscillationStartTime: number = 0;
  private oscillationAnimationFrameId: number | null = null;
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

  private updateVolumeOscillation = (): void => {
    if (!this.isPlaying || !this.audioNodes) {
      return;
    }

    const currentTime = this.ctx.currentTime;
    const elapsed = currentTime - this.oscillationStartTime;

    // Calculate oscillating gain using sine wave
    // oscillationSpeed is in Hz (oscillations per second)
    const phase = elapsed * this.oscillationSpeed * 2 * Math.PI;

    // Map sine wave [-1, 1] to dB range and then to linear gain
    // Use a range from -12dB to 0dB for perceptually smooth oscillation
    const minDb = -12;
    const maxDb = 0;
    const normalizedSine = (Math.sin(phase) + 1) / 2; // Map to [0, 1]
    const currentDb = minDb + normalizedSine * (maxDb - minDb);
    const linearGain = Math.pow(10, currentDb / 20);

    this.audioNodes.volumeGain.gain.setValueAtTime(linearGain, currentTime);

    this.oscillationAnimationFrameId = requestAnimationFrame(this.updateVolumeOscillation);
  };

  public startPlaying(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;

    // Create audio nodes if they don't exist
    if (!this.audioNodes) {
      this.createAudioNodes(0.5, 0.5); // Start at center
    }

    // Start volume oscillation
    this.oscillationStartTime = this.ctx.currentTime;
    this.updateVolumeOscillation();
  }

  public stopPlaying(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    // Stop volume oscillation
    if (this.oscillationAnimationFrameId !== null) {
      cancelAnimationFrame(this.oscillationAnimationFrameId);
      this.oscillationAnimationFrameId = null;
    }

    // Dispose audio nodes
    if (this.audioNodes) {
      this.disposeAudioNodes();
      this.audioNodes = null;
    }
  }

  private createAudioNodes(normalizedX: number, normalizedY: number): void {
    // Create pink noise buffer
    const pinkNoiseBuffer = this.generatePinkNoiseBuffer();

    // Create source
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;

    // Create gain nodes
    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const volumeGain = this.ctx.createGain();
    volumeGain.gain.value = 1.0;

    // Create panner
    const panner = this.ctx.createStereoPanner();

    // Calculate pan position (-1 to 1)
    const panPosition = normalizedX * 2 - 1;
    panner.pan.value = panPosition;

    // Create generators based on current sound mode
    let slopedNoiseGenerator: SlopedPinkNoiseGenerator | null = null;
    let bandpassedNoiseGenerator: BandpassedNoiseGenerator | null = null;
    let sineToneGenerator: SineToneGenerator | null = null;

    // Calculate frequency from Y position
    const frequency = this.calculateFrequencyFromPosition(normalizedY);

    if (this.currentSoundMode === SoundMode.BandpassedNoise) {
      bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);
      bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      bandpassedNoiseGenerator.setBandpassFrequency(frequency);

      source.connect(bandpassedNoiseGenerator.getInputNode());
      bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SlopedNoise) {
      slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
      // Calculate slope based on Y position
      const slope = -10.5 + normalizedY * (1.5 - (-10.5));
      slopedNoiseGenerator.setSlope(slope);

      source.connect(slopedNoiseGenerator.getInputNode());
      slopedNoiseGenerator.getOutputNode().connect(mainGain);
    } else if (this.currentSoundMode === SoundMode.SineTone) {
      sineToneGenerator = new SineToneGenerator(this.ctx);
      sineToneGenerator.setFrequency(frequency);

      source.connect(mainGain);
      sineToneGenerator.getOutputNode().connect(mainGain);
    }

    // Connect the chain: mainGain -> volumeGain -> panner -> output
    mainGain.connect(volumeGain);
    volumeGain.connect(panner);
    panner.connect(this.outputGain);

    // Start the source
    source.start();

    this.audioNodes = {
      source,
      mainGain,
      volumeGain,
      panner,
      slopedNoiseGenerator,
      bandpassedNoiseGenerator,
      sineToneGenerator,
      pinkNoiseBuffer
    };
  }

  private disposeAudioNodes(): void {
    if (!this.audioNodes) return;

    try {
      this.audioNodes.source.stop();
    } catch {
      // Source might already be stopped
    }

    this.audioNodes.source.disconnect();
    this.audioNodes.mainGain.disconnect();
    this.audioNodes.volumeGain.disconnect();
    this.audioNodes.panner.disconnect();

    if (this.audioNodes.slopedNoiseGenerator) {
      this.audioNodes.slopedNoiseGenerator.dispose();
    }
    if (this.audioNodes.bandpassedNoiseGenerator) {
      this.audioNodes.bandpassedNoiseGenerator.dispose();
    }
    if (this.audioNodes.sineToneGenerator) {
      this.audioNodes.sineToneGenerator.dispose();
    }
  }

  public updatePosition(normalizedX: number, normalizedY: number): void {
    if (!this.audioNodes) return;

    // Update pan position
    const panPosition = normalizedX * 2 - 1;
    this.audioNodes.panner.pan.setValueAtTime(panPosition, this.ctx.currentTime);

    // Update frequency
    const frequency = this.calculateFrequencyFromPosition(normalizedY);

    if (this.audioNodes.bandpassedNoiseGenerator) {
      this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
    } else if (this.audioNodes.slopedNoiseGenerator) {
      const slope = -10.5 + normalizedY * (1.5 - (-10.5));
      this.audioNodes.slopedNoiseGenerator.setSlope(slope);
    } else if (this.audioNodes.sineToneGenerator) {
      this.audioNodes.sineToneGenerator.setFrequency(frequency);
    }
  }

  public getOutputNode(): GainNode {
    return this.outputGain;
  }

  public setSoundMode(mode: SoundMode): void {
    const wasPlaying = this.isPlaying;
    const currentX = this.audioNodes ? 0.5 : 0.5;
    const currentY = this.audioNodes ? 0.5 : 0.5;

    if (wasPlaying) {
      this.stopPlaying();
    }

    this.currentSoundMode = mode;

    if (wasPlaying) {
      this.startPlaying();
      this.updatePosition(currentX, currentY);
    }
  }

  public getSoundMode(): SoundMode {
    return this.currentSoundMode;
  }

  public setBandwidth(octaves: number): void {
    this.currentBandwidth = Math.max(0.1, Math.min(10, octaves));
    if (this.audioNodes?.bandpassedNoiseGenerator) {
      this.audioNodes.bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
    }
  }

  public getBandwidth(): number {
    return this.currentBandwidth;
  }

  public setOscillationSpeed(speed: number): void {
    this.oscillationSpeed = Math.max(0.1, Math.min(10, speed));
  }

  public getOscillationSpeed(): number {
    return this.oscillationSpeed;
  }

  public dispose(): void {
    this.stopPlaying();
    this.outputGain.disconnect();
  }
}

// Singleton instance
class SoundstageExplorerPlayer {
  private static instance: SoundstageExplorerPlayer | null = null;
  private service: SoundstageExplorerService;

  private constructor() {
    const ctx = audioContext.getAudioContext();
    this.service = new SoundstageExplorerService(ctx);

    // Connect to EQ processor
    const processor = eqProcessor.getEQProcessor();
    const eqInput = processor.getInputNode();
    if (eqInput) {
      this.service.getOutputNode().connect(eqInput);
    }
  }

  public static getInstance(): SoundstageExplorerPlayer {
    if (!SoundstageExplorerPlayer.instance) {
      SoundstageExplorerPlayer.instance = new SoundstageExplorerPlayer();
    }
    return SoundstageExplorerPlayer.instance;
  }

  public startPlaying(): void {
    this.service.startPlaying();
  }

  public stopPlaying(): void {
    this.service.stopPlaying();
  }

  public updatePosition(normalizedX: number, normalizedY: number): void {
    this.service.updatePosition(normalizedX, normalizedY);
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

  public setOscillationSpeed(speed: number): void {
    this.service.setOscillationSpeed(speed);
  }

  public getOscillationSpeed(): number {
    return this.service.getOscillationSpeed();
  }

  public dispose(): void {
    this.service.dispose();
    SoundstageExplorerPlayer.instance = null;
  }
}

// Exported functions
export function getSoundstageExplorerPlayer(): SoundstageExplorerPlayer {
  return SoundstageExplorerPlayer.getInstance();
}

export function cleanupSoundstageExplorerPlayer(): void {
  const player = SoundstageExplorerPlayer.getInstance();
  player.dispose();
}
