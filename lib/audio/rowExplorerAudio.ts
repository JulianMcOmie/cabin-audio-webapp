import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
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
const MASTER_GAIN = 6.0;

// Generator classes (reused from soundstageExplorerAudio.ts)

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

// Audio nodes for the row explorer
interface RowExplorerAudioNodes {
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  volumeGain: GainNode;
  panner: StereoPannerNode;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator;
  pinkNoiseBuffer: AudioBuffer;
}

class RowExplorerService {
  private ctx: AudioContext;
  private audioNodes: RowExplorerAudioNodes | null = null;
  private outputGain: GainNode;
  private currentBandwidth: number = BANDPASS_BANDWIDTH_OCTAVES;
  private isPlaying: boolean = false;

  // Mode: 'row' = horizontal line selects frequency, 'column' = vertical line selects pan, 'diagonal' = angled line, 'split' = two independent rows
  private mode: 'row' | 'column' | 'diagonal' | 'split' = 'row';

  // Diagonal tilt angle in degrees (-90 to 90, where 0 = 45° diagonal)
  private tiltAngle: number = 0;

  // Current audio parameters
  private currentFrequencyY: number = 0.5; // Normalized Y position (0-1) for frequency
  private currentPan: number = 0; // -1 to 1
  private currentVolume: number = 1; // 0 to 1 linear

  // Split mode parameters
  private leftFrequencyY: number = 0.3; // Left half frequency
  private rightFrequencyY: number = 0.7; // Right half frequency
  private leftMuted: boolean = false;
  private rightMuted: boolean = false;
  private splitAudioNodes: {
    leftSource: AudioBufferSourceNode;
    rightSource: AudioBufferSourceNode;
    leftGain: GainNode;
    rightGain: GainNode;
    leftPanner: StereoPannerNode;
    rightPanner: StereoPannerNode;
    leftBandpass: BandpassedNoiseGenerator;
    rightBandpass: BandpassedNoiseGenerator;
    pinkNoiseBuffer: AudioBuffer;
  } | null = null;

  // Sweep settings (pan sweep in row mode, frequency sweep in column mode, both in diagonal)
  private sweepEnabled: boolean = false;
  private sweepSpeed: number = 1.0; // Oscillations per second
  private sweepStartTime: number = 0;
  private sweepAnimationFrameId: number | null = null;

  // Flicker settings (rapid on/off modulation)
  private flickerEnabled: boolean = false;
  private flickerSpeed: number = 8.0; // Flickers per second
  private flickerStartTime: number = 0;
  private flickerAnimationFrameId: number | null = null;

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
    const minFreq = 20;
    const maxFreq = 20000;

    const halfBandwidth = this.currentBandwidth / 2;
    const constrainedMaxFreq = maxFreq / Math.pow(2, halfBandwidth);
    const constrainedMinFreq = minFreq * Math.pow(2, halfBandwidth);

    const logMin = Math.log2(constrainedMinFreq);
    const logMax = Math.log2(constrainedMaxFreq);

    // Invert Y so top = high frequency
    const invertedY = 1 - normalizedY;
    const logFreq = logMin + invertedY * (logMax - logMin);
    return Math.pow(2, logFreq);
  }

  private updateSweep = (): void => {
    if (!this.isPlaying || !this.sweepEnabled) {
      return;
    }

    const currentTime = this.ctx.currentTime;
    const elapsed = currentTime - this.sweepStartTime;

    // Triangle wave for sweep
    const cycleProgress = (elapsed * this.sweepSpeed) % 1;
    const t = cycleProgress < 0.5
      ? cycleProgress * 2
      : 2 - cycleProgress * 2;

    if (this.mode === 'split' && this.splitAudioNodes) {
      // Split mode: both halves sweep from left to right of their segment simultaneously
      // Left half: pan sweeps from -1 to 0
      // Right half: pan sweeps from 0 to 1
      const leftPan = -1 + t; // -1 to 0
      const rightPan = t; // 0 to 1

      this.splitAudioNodes.leftPanner.pan.setValueAtTime(leftPan, currentTime);
      this.splitAudioNodes.rightPanner.pan.setValueAtTime(rightPan, currentTime);
    } else if (this.audioNodes) {
      if (this.mode === 'row') {
        // Row mode: sweep pan
        const pan = t * 2 - 1;
        this.audioNodes.panner.pan.setValueAtTime(pan, currentTime);
      } else if (this.mode === 'column') {
        // Column mode: sweep frequency
        const frequency = this.calculateFrequencyFromPosition(t);
        this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
      } else if (this.mode === 'diagonal') {
        // Diagonal mode: sweep both frequency and pan based on tilt angle
        const tiltRad = (this.tiltAngle * Math.PI) / 180;
        const freqWeight = Math.cos(tiltRad - Math.PI / 4);
        const panWeight = Math.sin(tiltRad - Math.PI / 4);

        const freqT = 0.5 + (t - 0.5) * Math.abs(freqWeight);
        const panT = 0.5 + (t - 0.5) * Math.abs(panWeight);

        const frequency = this.calculateFrequencyFromPosition(freqT);
        const pan = panT * 2 - 1;

        this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
        this.audioNodes.panner.pan.setValueAtTime(pan, currentTime);
      }
    }

    this.sweepAnimationFrameId = requestAnimationFrame(this.updateSweep);
  };

  private updateFlicker = (): void => {
    if (!this.isPlaying || !this.flickerEnabled) {
      return;
    }

    const currentTime = this.ctx.currentTime;
    const elapsed = currentTime - this.flickerStartTime;

    // Square wave for on/off flicker
    const cycleProgress = (elapsed * this.flickerSpeed) % 1;
    const isOn = cycleProgress < 0.5;
    const flickerGain = isOn ? 1.0 : 0.0;

    if (this.mode === 'split' && this.splitAudioNodes) {
      // Apply flicker to split mode, respecting mute state
      const leftGain = this.leftMuted ? 0 : this.currentVolume * flickerGain;
      const rightGain = this.rightMuted ? 0 : this.currentVolume * flickerGain;
      this.splitAudioNodes.leftGain.gain.setValueAtTime(leftGain, currentTime);
      this.splitAudioNodes.rightGain.gain.setValueAtTime(rightGain, currentTime);
    } else if (this.audioNodes) {
      this.audioNodes.volumeGain.gain.setValueAtTime(this.currentVolume * flickerGain, currentTime);
    }

    this.flickerAnimationFrameId = requestAnimationFrame(this.updateFlicker);
  };

  public startPlaying(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;

    if (this.mode === 'split') {
      if (!this.splitAudioNodes) {
        this.createSplitAudioNodes();
      }
    } else {
      if (!this.audioNodes) {
        this.createAudioNodes();
      }
    }

    // Start sweep if enabled
    if (this.sweepEnabled) {
      this.sweepStartTime = this.ctx.currentTime;
      this.updateSweep();
    }

    // Start flicker if enabled
    if (this.flickerEnabled) {
      this.flickerStartTime = this.ctx.currentTime;
      this.updateFlicker();
    }
  }

  public stopPlaying(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    // Stop sweep
    if (this.sweepAnimationFrameId !== null) {
      cancelAnimationFrame(this.sweepAnimationFrameId);
      this.sweepAnimationFrameId = null;
    }

    // Stop flicker
    if (this.flickerAnimationFrameId !== null) {
      cancelAnimationFrame(this.flickerAnimationFrameId);
      this.flickerAnimationFrameId = null;
    }

    // Dispose audio nodes
    if (this.audioNodes) {
      this.disposeAudioNodes();
      this.audioNodes = null;
    }

    // Dispose split audio nodes
    if (this.splitAudioNodes) {
      this.disposeSplitAudioNodes();
      this.splitAudioNodes = null;
    }
  }

  private createAudioNodes(): void {
    const pinkNoiseBuffer = this.generatePinkNoiseBuffer();

    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;

    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const volumeGain = this.ctx.createGain();
    volumeGain.gain.value = this.currentVolume;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = this.sweepEnabled && this.mode === 'row' ? 0 : this.currentPan;

    const bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);
    bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
    const frequency = this.calculateFrequencyFromPosition(this.currentFrequencyY);
    bandpassedNoiseGenerator.setBandpassFrequency(frequency);

    source.connect(bandpassedNoiseGenerator.getInputNode());
    bandpassedNoiseGenerator.getOutputNode().connect(mainGain);
    mainGain.connect(volumeGain);
    volumeGain.connect(panner);
    panner.connect(this.outputGain);

    source.start();

    this.audioNodes = {
      source,
      mainGain,
      volumeGain,
      panner,
      bandpassedNoiseGenerator,
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
    this.audioNodes.bandpassedNoiseGenerator.dispose();
  }

  private createSplitAudioNodes(): void {
    const pinkNoiseBuffer = this.generatePinkNoiseBuffer();

    // Create left channel
    const leftSource = this.ctx.createBufferSource();
    leftSource.buffer = pinkNoiseBuffer;
    leftSource.loop = true;

    const leftGain = this.ctx.createGain();
    leftGain.gain.value = this.leftMuted ? 0 : this.currentVolume;

    const leftPanner = this.ctx.createStereoPanner();
    leftPanner.pan.value = this.sweepEnabled ? -1 : -0.5; // Start at left

    const leftBandpass = new BandpassedNoiseGenerator(this.ctx);
    leftBandpass.setBandpassBandwidth(this.currentBandwidth);
    const leftFrequency = this.calculateFrequencyFromPosition(this.leftFrequencyY);
    leftBandpass.setBandpassFrequency(leftFrequency);

    leftSource.connect(leftBandpass.getInputNode());
    leftBandpass.getOutputNode().connect(leftGain);
    leftGain.connect(leftPanner);
    leftPanner.connect(this.outputGain);

    leftSource.start();

    // Create right channel
    const rightSource = this.ctx.createBufferSource();
    rightSource.buffer = pinkNoiseBuffer;
    rightSource.loop = true;

    const rightGain = this.ctx.createGain();
    rightGain.gain.value = this.rightMuted ? 0 : this.currentVolume;

    const rightPanner = this.ctx.createStereoPanner();
    rightPanner.pan.value = this.sweepEnabled ? 0 : 0.5; // Start at center

    const rightBandpass = new BandpassedNoiseGenerator(this.ctx);
    rightBandpass.setBandpassBandwidth(this.currentBandwidth);
    const rightFrequency = this.calculateFrequencyFromPosition(this.rightFrequencyY);
    rightBandpass.setBandpassFrequency(rightFrequency);

    rightSource.connect(rightBandpass.getInputNode());
    rightBandpass.getOutputNode().connect(rightGain);
    rightGain.connect(rightPanner);
    rightPanner.connect(this.outputGain);

    rightSource.start();

    this.splitAudioNodes = {
      leftSource,
      rightSource,
      leftGain,
      rightGain,
      leftPanner,
      rightPanner,
      leftBandpass,
      rightBandpass,
      pinkNoiseBuffer
    };
  }

  private disposeSplitAudioNodes(): void {
    if (!this.splitAudioNodes) return;

    try {
      this.splitAudioNodes.leftSource.stop();
      this.splitAudioNodes.rightSource.stop();
    } catch {
      // Sources might already be stopped
    }

    this.splitAudioNodes.leftSource.disconnect();
    this.splitAudioNodes.rightSource.disconnect();
    this.splitAudioNodes.leftGain.disconnect();
    this.splitAudioNodes.rightGain.disconnect();
    this.splitAudioNodes.leftPanner.disconnect();
    this.splitAudioNodes.rightPanner.disconnect();
    this.splitAudioNodes.leftBandpass.dispose();
    this.splitAudioNodes.rightBandpass.dispose();
  }

  public setFrequencyY(normalizedY: number): void {
    this.currentFrequencyY = Math.max(0, Math.min(1, normalizedY));
    if (this.audioNodes) {
      const frequency = this.calculateFrequencyFromPosition(this.currentFrequencyY);
      this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
    }
  }

  public getFrequencyY(): number {
    return this.currentFrequencyY;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.audioNodes) {
      this.audioNodes.volumeGain.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
    }
    if (this.splitAudioNodes) {
      const leftGain = this.leftMuted ? 0 : this.currentVolume;
      const rightGain = this.rightMuted ? 0 : this.currentVolume;
      this.splitAudioNodes.leftGain.gain.setValueAtTime(leftGain, this.ctx.currentTime);
      this.splitAudioNodes.rightGain.gain.setValueAtTime(rightGain, this.ctx.currentTime);
    }
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public setLeftFrequencyY(normalizedY: number): void {
    this.leftFrequencyY = Math.max(0, Math.min(1, normalizedY));
    if (this.splitAudioNodes) {
      const frequency = this.calculateFrequencyFromPosition(this.leftFrequencyY);
      this.splitAudioNodes.leftBandpass.setBandpassFrequency(frequency);
    }
  }

  public getLeftFrequencyY(): number {
    return this.leftFrequencyY;
  }

  public setRightFrequencyY(normalizedY: number): void {
    this.rightFrequencyY = Math.max(0, Math.min(1, normalizedY));
    if (this.splitAudioNodes) {
      const frequency = this.calculateFrequencyFromPosition(this.rightFrequencyY);
      this.splitAudioNodes.rightBandpass.setBandpassFrequency(frequency);
    }
  }

  public getRightFrequencyY(): number {
    return this.rightFrequencyY;
  }

  public setLeftMuted(muted: boolean): void {
    this.leftMuted = muted;
    if (this.splitAudioNodes) {
      const targetGain = muted ? 0 : this.currentVolume;
      this.splitAudioNodes.leftGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
    }
  }

  public getLeftMuted(): boolean {
    return this.leftMuted;
  }

  public setRightMuted(muted: boolean): void {
    this.rightMuted = muted;
    if (this.splitAudioNodes) {
      const targetGain = muted ? 0 : this.currentVolume;
      this.splitAudioNodes.rightGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
    }
  }

  public getRightMuted(): boolean {
    return this.rightMuted;
  }

  public setPan(pan: number): void {
    this.currentPan = Math.max(-1, Math.min(1, pan));
    // Only update pan if sweep is disabled OR we're in column mode (where sweep affects frequency, not pan)
    if (this.audioNodes && (!this.sweepEnabled || this.mode === 'column')) {
      this.audioNodes.panner.pan.setValueAtTime(this.currentPan, this.ctx.currentTime);
    }
  }

  public getPan(): number {
    return this.currentPan;
  }

  public setBandwidth(octaves: number): void {
    this.currentBandwidth = Math.max(0.1, Math.min(10, octaves));
    if (this.audioNodes) {
      this.audioNodes.bandpassedNoiseGenerator.setBandpassBandwidth(this.currentBandwidth);
      // Also update frequency since bandwidth affects the constrained range
      const frequency = this.calculateFrequencyFromPosition(this.currentFrequencyY);
      this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
    }
    if (this.splitAudioNodes) {
      this.splitAudioNodes.leftBandpass.setBandpassBandwidth(this.currentBandwidth);
      this.splitAudioNodes.rightBandpass.setBandpassBandwidth(this.currentBandwidth);
      const leftFreq = this.calculateFrequencyFromPosition(this.leftFrequencyY);
      const rightFreq = this.calculateFrequencyFromPosition(this.rightFrequencyY);
      this.splitAudioNodes.leftBandpass.setBandpassFrequency(leftFreq);
      this.splitAudioNodes.rightBandpass.setBandpassFrequency(rightFreq);
    }
  }

  public getBandwidth(): number {
    return this.currentBandwidth;
  }

  public setMode(mode: 'row' | 'column' | 'diagonal' | 'split'): void {
    const wasPlaying = this.isPlaying;

    // If switching modes while playing, stop and restart with new mode
    if (wasPlaying && this.mode !== mode) {
      this.stopPlaying();
      this.mode = mode;
      this.startPlaying();
    } else {
      this.mode = mode;
    }
  }

  public getMode(): 'row' | 'column' | 'diagonal' | 'split' {
    return this.mode;
  }

  public setTiltAngle(angle: number): void {
    this.tiltAngle = Math.max(-90, Math.min(90, angle));
  }

  public getTiltAngle(): number {
    return this.tiltAngle;
  }

  public setSweepEnabled(enabled: boolean): void {
    const wasEnabled = this.sweepEnabled;
    this.sweepEnabled = enabled;

    if (this.isPlaying) {
      if (enabled && !wasEnabled) {
        // Start sweep
        this.sweepStartTime = this.ctx.currentTime;
        this.updateSweep();
      } else if (!enabled && wasEnabled) {
        // Stop sweep and restore manual values
        if (this.sweepAnimationFrameId !== null) {
          cancelAnimationFrame(this.sweepAnimationFrameId);
          this.sweepAnimationFrameId = null;
        }

        if (this.mode === 'split' && this.splitAudioNodes) {
          // Restore split mode panners to center of their halves
          this.splitAudioNodes.leftPanner.pan.setValueAtTime(-0.5, this.ctx.currentTime);
          this.splitAudioNodes.rightPanner.pan.setValueAtTime(0.5, this.ctx.currentTime);
        } else if (this.audioNodes) {
          if (this.mode === 'row') {
            this.audioNodes.panner.pan.setValueAtTime(this.currentPan, this.ctx.currentTime);
          } else if (this.mode === 'column') {
            const frequency = this.calculateFrequencyFromPosition(this.currentFrequencyY);
            this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
          } else if (this.mode === 'diagonal') {
            // Diagonal mode: restore both
            this.audioNodes.panner.pan.setValueAtTime(this.currentPan, this.ctx.currentTime);
            const frequency = this.calculateFrequencyFromPosition(this.currentFrequencyY);
            this.audioNodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);
          }
        }
      }
    }
  }

  public getSweepEnabled(): boolean {
    return this.sweepEnabled;
  }

  public setSweepSpeed(speed: number): void {
    this.sweepSpeed = Math.max(0.1, Math.min(10, speed));
  }

  public getSweepSpeed(): number {
    return this.sweepSpeed;
  }

  public setFlickerEnabled(enabled: boolean): void {
    const wasEnabled = this.flickerEnabled;
    this.flickerEnabled = enabled;

    if (this.isPlaying) {
      if (enabled && !wasEnabled) {
        // Start flicker
        this.flickerStartTime = this.ctx.currentTime;
        this.updateFlicker();
      } else if (!enabled && wasEnabled) {
        // Stop flicker and restore normal volume
        if (this.flickerAnimationFrameId !== null) {
          cancelAnimationFrame(this.flickerAnimationFrameId);
          this.flickerAnimationFrameId = null;
        }

        // Restore volume
        if (this.mode === 'split' && this.splitAudioNodes) {
          const leftGain = this.leftMuted ? 0 : this.currentVolume;
          const rightGain = this.rightMuted ? 0 : this.currentVolume;
          this.splitAudioNodes.leftGain.gain.setValueAtTime(leftGain, this.ctx.currentTime);
          this.splitAudioNodes.rightGain.gain.setValueAtTime(rightGain, this.ctx.currentTime);
        } else if (this.audioNodes) {
          this.audioNodes.volumeGain.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
        }
      }
    }
  }

  public getFlickerEnabled(): boolean {
    return this.flickerEnabled;
  }

  public setFlickerSpeed(speed: number): void {
    this.flickerSpeed = Math.max(1, Math.min(30, speed));
  }

  public getFlickerSpeed(): number {
    return this.flickerSpeed;
  }

  public getOutputNode(): GainNode {
    return this.outputGain;
  }

  public dispose(): void {
    this.stopPlaying();
    this.outputGain.disconnect();
  }
}

// Singleton instance
class RowExplorerPlayer {
  private static instance: RowExplorerPlayer | null = null;
  private service: RowExplorerService;

  private constructor() {
    const ctx = audioContext.getAudioContext();
    this.service = new RowExplorerService(ctx);

    // Connect to EQ processor
    const processor = eqProcessor.getEQProcessor();
    const eqInput = processor.getInputNode();
    if (eqInput) {
      this.service.getOutputNode().connect(eqInput);
    }
  }

  public static getInstance(): RowExplorerPlayer {
    if (!RowExplorerPlayer.instance) {
      RowExplorerPlayer.instance = new RowExplorerPlayer();
    }
    return RowExplorerPlayer.instance;
  }

  public startPlaying(): void {
    this.service.startPlaying();
  }

  public stopPlaying(): void {
    this.service.stopPlaying();
  }

  public setFrequencyY(normalizedY: number): void {
    this.service.setFrequencyY(normalizedY);
  }

  public getFrequencyY(): number {
    return this.service.getFrequencyY();
  }

  public setLeftFrequencyY(normalizedY: number): void {
    this.service.setLeftFrequencyY(normalizedY);
  }

  public getLeftFrequencyY(): number {
    return this.service.getLeftFrequencyY();
  }

  public setRightFrequencyY(normalizedY: number): void {
    this.service.setRightFrequencyY(normalizedY);
  }

  public getRightFrequencyY(): number {
    return this.service.getRightFrequencyY();
  }

  public setLeftMuted(muted: boolean): void {
    this.service.setLeftMuted(muted);
  }

  public getLeftMuted(): boolean {
    return this.service.getLeftMuted();
  }

  public setRightMuted(muted: boolean): void {
    this.service.setRightMuted(muted);
  }

  public getRightMuted(): boolean {
    return this.service.getRightMuted();
  }

  public setVolume(volume: number): void {
    this.service.setVolume(volume);
  }

  public getVolume(): number {
    return this.service.getVolume();
  }

  public setPan(pan: number): void {
    this.service.setPan(pan);
  }

  public getPan(): number {
    return this.service.getPan();
  }

  public setBandwidth(octaves: number): void {
    this.service.setBandwidth(octaves);
  }

  public getBandwidth(): number {
    return this.service.getBandwidth();
  }

  public setMode(mode: 'row' | 'column' | 'diagonal' | 'split'): void {
    this.service.setMode(mode);
  }

  public getMode(): 'row' | 'column' | 'diagonal' | 'split' {
    return this.service.getMode();
  }

  public setTiltAngle(angle: number): void {
    this.service.setTiltAngle(angle);
  }

  public getTiltAngle(): number {
    return this.service.getTiltAngle();
  }

  public setSweepEnabled(enabled: boolean): void {
    this.service.setSweepEnabled(enabled);
  }

  public getSweepEnabled(): boolean {
    return this.service.getSweepEnabled();
  }

  public setSweepSpeed(speed: number): void {
    this.service.setSweepSpeed(speed);
  }

  public getSweepSpeed(): number {
    return this.service.getSweepSpeed();
  }

  public setFlickerEnabled(enabled: boolean): void {
    this.service.setFlickerEnabled(enabled);
  }

  public getFlickerEnabled(): boolean {
    return this.service.getFlickerEnabled();
  }

  public setFlickerSpeed(speed: number): void {
    this.service.setFlickerSpeed(speed);
  }

  public getFlickerSpeed(): number {
    return this.service.getFlickerSpeed();
  }

  public dispose(): void {
    this.service.dispose();
    RowExplorerPlayer.instance = null;
  }
}

// Exported functions
export function getRowExplorerPlayer(): RowExplorerPlayer {
  return RowExplorerPlayer.getInstance();
}

export function cleanupRowExplorerPlayer(): void {
  const player = RowExplorerPlayer.getInstance();
  player.dispose();
}
