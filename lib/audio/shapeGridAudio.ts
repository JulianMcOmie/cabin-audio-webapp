import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import {
  calculateCircleDots,
  calculateTriangleDots,
  calculateFiveGlyphDots,
  getTriangleVertices,
  type DotPosition
} from '../utils/shapeMath';

// Constants (matching dotGridAudio.ts patterns)
const GLOBAL_STAGGER_ATTACK_S = 0.01; // 10ms attack
const GLOBAL_STAGGER_RELEASE_S = 0.1; // 100ms release
const DOT_REPETITION_INTERVAL_S = 0.35; // Interval between repetitions
const DEFAULT_REPEAT_COUNT = 1;
const DEFAULT_DB_REDUCTION_PER_REPEAT = 12;
const DEFAULT_HOLD_COUNT = 1; // Simpler: each dot plays once per cycle
const MASTER_GAIN = 6.0;
const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

// Sloped noise constants
const NUM_BANDS = 20; // Number of frequency bands for shaping
const SLOPE_REF_FREQUENCY = 800; // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20; // Hz
const MAX_AUDIBLE_FREQ = 20000; // Hz
const BAND_Q_VALUE = 1.5; // Q value for the bandpass filters
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise
const TARGET_SLOPE_DB_PER_OCT = -4.5; // Target slope for all shapes
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1; // Output gain reduction

// Bandpass constants
const BANDPASS_BANDWIDTH_OCTAVES = 5.0; // Default bandwidth: 5 octaves (matching dot grid)
const BANDPASS_NOISE_OUTPUT_GAIN_SCALAR = 0.25; // Output gain for bandpassed noise

// Shape data interface
export interface ShapeData {
  id: string;
  type: 'circle' | 'triangle' | 'five';
  position: { x: number; y: number }; // -1 to 1 normalized space
  size: number; // Radius/characteristic dimension
  numDots: number; // 4-32
  rotation?: number; // Radians
}

// Audio nodes for a single dot
interface DotAudioNodes {
  source: AudioBufferSourceNode;
  bandpassedNoiseGenerator: BandpassedNoiseGenerator;
  mainGain: GainNode;
  envelopeGain: GainNode;
  panner: StereoPannerNode;
  normalizedYPos: number; // 0=bottom, 1=top
  normalizedXPos: number; // 0=left, 1=right
  rotationGain: GainNode; // Controls loudness based on rotation
}

// Playback state for each shape
interface ShapePlaybackState {
  currentDotIndex: number;
  loopTimeoutId: number | null;
  // Continuous mode state
  continuousProgress: number; // 0-1 position along perimeter
  continuousAnimationId: number | null;
}

/**
 * Sloped pink noise generator using multi-band filtering
 * Shapes pink noise to achieve a target overall slope (e.g., -4.5dB/oct)
 */
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

    // Set the target slope
    this.setSlope(TARGET_SLOPE_DB_PER_OCT);
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

/**
 * Bandpassed noise generator
 * Combines sloped pink noise with highpass/lowpass filters to create a narrow frequency band
 */
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

    // Create sharp highpass filter
    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.Q.value = 10;

    // Create sharp lowpass filter
    this.lowpassFilter = this.ctx.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.Q.value = 10;

    // Initialize bandwidth and center frequency
    this.currentBandwidthOctaves = BANDPASS_BANDWIDTH_OCTAVES;
    this.currentCenterFrequency = 1000; // Default

    // Connect input to sloping filter
    this.inputGainNode.connect(this.slopingFilter.getInputNode());

    // Initial chain setup
    this.connectFilterChain(true, true);

    // Set initial frequency
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

/**
 * Main audio player for shapes
 */
class ShapeGridAudioPlayer {
  private ctx: AudioContext;
  private shapes: Map<string, ShapeData> = new Map();
  private audioPoints: Map<string, DotAudioNodes> = new Map(); // key: "shapeId-dotIndex"
  private shapePlaybackStates: Map<string, ShapePlaybackState> = new Map();
  private outputGain: GainNode;
  private pinkNoiseBuffer: AudioBuffer | null = null;

  // Settings
  private isPlaying: boolean = false;
  private speed: number = 4.0; // Faster default speed
  private repeatCount: number = DEFAULT_REPEAT_COUNT;
  private dbReductionPerRepeat: number = DEFAULT_DB_REDUCTION_PER_REPEAT;
  private holdCount: number = DEFAULT_HOLD_COUNT;
  private isContinuousMode: boolean = false; // Toggle between discrete dots and continuous sweep

  // Continuous mode audio points (one per shape)
  private continuousAudioPoints: Map<string, DotAudioNodes> = new Map(); // key: shapeId

  constructor(audioContextInstance: AudioContext) {
    this.ctx = audioContextInstance;
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = MASTER_GAIN;

    // Generate pink noise buffer
    this.pinkNoiseBuffer = this.generatePinkNoiseBuffer();
  }

  private generatePinkNoiseBuffer(): AudioBuffer {
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Voss-McCartney algorithm for pink noise
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

  public addShape(shape: ShapeData): void {
    this.shapes.set(shape.id, shape);
    this.updateShapeAudioPoints(shape);
  }

  public removeShape(shapeId: string): void {
    // Stop playback for this shape
    this.stopShapePlayback(shapeId);

    // Remove all audio points for this shape
    const shape = this.shapes.get(shapeId);
    if (shape) {
      for (let i = 0; i < shape.numDots; i++) {
        const pointId = `${shapeId}-${i}`;
        this.removeAudioPoint(pointId);
      }
    }

    this.shapes.delete(shapeId);
    this.shapePlaybackStates.delete(shapeId);
  }

  public updateShape(shape: ShapeData): void {
    const existingShape = this.shapes.get(shape.id);

    // If shape exists and numDots changed, we need to recreate audio points
    if (existingShape && existingShape.numDots !== shape.numDots) {
      this.removeShape(shape.id);
      this.addShape(shape);
      if (this.isPlaying) {
        this.startShapePlayback(shape.id);
      }
    } else {
      // Just update positions
      this.shapes.set(shape.id, shape);
      this.updateShapeAudioPoints(shape);
    }
  }

  private updateShapeAudioPoints(shape: ShapeData): void {
    // Calculate dot positions
    const dots = this.calculateShapeDots(shape);

    // Remove old audio points if they exist
    for (let i = 0; i < shape.numDots; i++) {
      const pointId = `${shape.id}-${i}`;
      if (this.audioPoints.has(pointId)) {
        this.removeAudioPoint(pointId);
      }
    }

    // Create new audio points with z-depth
    dots.forEach((dot, index) => {
      const pointId = `${shape.id}-${index}`;
      this.createAudioPoint(pointId, dot.x, dot.y, dot.z);
    });
  }

  private calculateShapeDots(shape: ShapeData): DotPosition[] {
    const rotationY = shape.rotation || 0;

    switch (shape.type) {
      case 'circle':
        // Use aspect ratio of 1 for audio (not visual)
        // The visual stretch is handled in the UI component
        return calculateCircleDots(shape.position, shape.size, shape.numDots, 1.0, rotationY);

      case 'triangle':
        const vertices = getTriangleVertices(
          shape.position,
          shape.size,
          0 // No 2D rotation for triangle, only 3D rotation
        );
        return calculateTriangleDots(vertices, shape.numDots, rotationY, shape.position);

      case 'five':
        return calculateFiveGlyphDots(
          shape.position,
          shape.size,
          0, // No 2D rotation for "5", only 3D rotation
          shape.numDots,
          rotationY
        );

      default:
        return [];
    }
  }

  private createAudioPoint(pointId: string, x: number, y: number, z: number = 0): void {
    if (!this.pinkNoiseBuffer) return;

    // Normalize coordinates from -1 to 1 space to 0-1 space
    const normalizedX = (x + 1) / 2;
    const normalizedY = (y + 1) / 2;

    // Create audio nodes
    const source = this.ctx.createBufferSource();
    source.buffer = this.pinkNoiseBuffer;
    source.loop = true;
    source.start();

    // Bandpassed noise generator (includes -4.5dB/oct sloped noise + bandpass filtering)
    const bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);

    // Calculate frequency from Y position (bottom=20Hz, top=20kHz, logarithmic)
    const logMinFreq = Math.log2(MIN_AUDIBLE_FREQ);
    const logMaxFreq = Math.log2(MAX_AUDIBLE_FREQ);
    const frequency = Math.pow(2, logMinFreq + normalizedY * (logMaxFreq - logMinFreq));
    bandpassedNoiseGenerator.setBandpassFrequency(frequency);

    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = 0; // Start silent

    // Depth gain controls loudness based on Z-depth (from 3D rotation)
    // z = 0 (at screen) → loud, z < 0 (away from viewer) → quieter
    const depthGain = this.ctx.createGain();
    const depthFactor = this.calculateDepthGain(z);
    depthGain.gain.value = depthFactor;

    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const panner = this.ctx.createStereoPanner();
    // Map X position to panning: -1 (left) to 1 (right)
    panner.pan.value = 2 * normalizedX - 1;

    // Connect nodes: source → bandpassedNoise → depthGain → envelopeGain → mainGain → panner → output
    source.connect(bandpassedNoiseGenerator.getInputNode());
    bandpassedNoiseGenerator.getOutputNode().connect(depthGain);
    depthGain.connect(envelopeGain);
    envelopeGain.connect(mainGain);
    mainGain.connect(panner);
    panner.connect(this.outputGain);

    // Store nodes
    this.audioPoints.set(pointId, {
      source,
      bandpassedNoiseGenerator,
      mainGain,
      envelopeGain,
      panner,
      rotationGain: depthGain, // Rename later: this is now depth gain
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX
    });
  }

  /**
   * Calculate gain based on Z-depth
   * z = 0 (at screen) → full volume
   * z = -1 (away from viewer) → quieter
   * z = 1 (towards viewer) → louder
   */
  private calculateDepthGain(z: number): number {
    // Map z-depth to gain
    // For depth range around -1 to 1, map to gain 0.2 to 1.0
    // Closer points (z > 0) are louder, farther points (z < 0) are quieter
    const minGain = 0.2;
    const maxGain = 1.0;

    // Simple linear mapping: z=1 → maxGain, z=-1 → minGain, z=0 → midpoint
    const normalizedZ = Math.max(-1, Math.min(1, z)); // Clamp to [-1, 1]
    const gain = minGain + (maxGain - minGain) * (normalizedZ + 1) / 2;

    return gain;
  }

  public updateShapeRotation(shapeId: string, rotation: number): void {
    const shape = this.shapes.get(shapeId);
    if (!shape) return;

    // Update shape rotation
    shape.rotation = rotation;

    // Recalculate all dot positions with new rotation
    const dots = this.calculateShapeDots(shape);

    // Update depth gain for each dot based on new z-depth
    dots.forEach((dot, index) => {
      const pointId = `${shapeId}-${index}`;
      const nodes = this.audioPoints.get(pointId);
      if (nodes) {
        const depthFactor = this.calculateDepthGain(dot.z);
        nodes.rotationGain.gain.value = depthFactor; // rotationGain is actually depthGain now
      }
    });
  }

  private removeAudioPoint(pointId: string): void {
    const nodes = this.audioPoints.get(pointId);
    if (nodes) {
      nodes.source.stop();
      nodes.source.disconnect();
      nodes.bandpassedNoiseGenerator.dispose();
      nodes.rotationGain.disconnect();
      nodes.envelopeGain.disconnect();
      nodes.mainGain.disconnect();
      nodes.panner.disconnect();
      this.audioPoints.delete(pointId);
    }
  }

  private activatePoint(pointId: string, startTime: number, gainMultiplier: number = 1.0): void {
    const nodes = this.audioPoints.get(pointId);
    if (!nodes) return;

    const envelopeGain = nodes.envelopeGain;
    const targetGain = gainMultiplier;

    // Cancel any scheduled changes
    envelopeGain.gain.cancelScheduledValues(startTime);

    // ADSR envelope
    envelopeGain.gain.setValueAtTime(0, startTime);
    envelopeGain.gain.exponentialRampToValueAtTime(
      0.8 * targetGain,
      startTime + GLOBAL_STAGGER_ATTACK_S
    );
    envelopeGain.gain.exponentialRampToValueAtTime(
      0.001,
      startTime + GLOBAL_STAGGER_ATTACK_S + GLOBAL_STAGGER_RELEASE_S
    );
  }

  public async setPlaying(playing: boolean): Promise<void> {
    if (playing && !this.isPlaying) {
      // Resume audio context if suspended
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
        console.log('🔊 Audio context resumed');
      }
      this.isPlaying = true;
      this.startPlayback();
    } else if (!playing && this.isPlaying) {
      this.isPlaying = false;
      this.stopPlayback();
    }
  }

  private startPlayback(): void {
    this.shapes.forEach((shape, shapeId) => {
      this.startShapePlayback(shapeId);
    });
  }

  private stopPlayback(): void {
    this.shapes.forEach((shape, shapeId) => {
      this.stopShapePlayback(shapeId);
    });
  }

  private startShapePlayback(shapeId: string): void {
    const shape = this.shapes.get(shapeId);
    if (!shape) return;

    if (this.isContinuousMode) {
      this.startContinuousPlayback(shapeId);
    } else {
      const state: ShapePlaybackState = {
        currentDotIndex: 0,
        loopTimeoutId: null,
        continuousProgress: 0,
        continuousAnimationId: null
      };
      this.shapePlaybackStates.set(shapeId, state);

      this.playNextDot(shapeId);
    }
  }

  private stopShapePlayback(shapeId: string): void {
    const state = this.shapePlaybackStates.get(shapeId);

    // Stop discrete mode playback
    if (state && state.loopTimeoutId !== null) {
      clearTimeout(state.loopTimeoutId);
      state.loopTimeoutId = null;
    }

    // Stop continuous mode playback
    if (this.isContinuousMode) {
      this.stopContinuousPlayback(shapeId);
    }
  }

  private playNextDot(shapeId: string): void {
    const shape = this.shapes.get(shapeId);
    const state = this.shapePlaybackStates.get(shapeId);
    if (!shape || !state || !this.isPlaying) return;

    const dotIndex = state.currentDotIndex;
    const pointId = `${shapeId}-${dotIndex}`;

    const currentTime = this.ctx.currentTime;
    const adjustedInterval = DOT_REPETITION_INTERVAL_S / this.speed;

    // Schedule all repetitions for this dot
    for (let rep = 0; rep < this.repeatCount; rep++) {
      const dbReduction = rep * this.dbReductionPerRepeat;
      const gainMultiplier = Math.pow(10, -dbReduction / 20);

      for (let hold = 0; hold < this.holdCount; hold++) {
        const activationTime = currentTime + (rep * this.holdCount + hold) * adjustedInterval;
        this.activatePoint(pointId, activationTime, gainMultiplier);
      }
    }

    // Schedule next dot
    const dotCompletionTime = this.holdCount * this.repeatCount * adjustedInterval;
    state.loopTimeoutId = window.setTimeout(() => {
      // Move to next dot
      state.currentDotIndex = (state.currentDotIndex + 1) % shape.numDots;
      this.playNextDot(shapeId);
    }, dotCompletionTime * 1000);
  }

  // Getter for current playback position (for UI animation)
  public getCurrentDotIndex(shapeId: string): number {
    const state = this.shapePlaybackStates.get(shapeId);
    return state ? state.currentDotIndex : 0;
  }

  public getContinuousProgress(shapeId: string): number {
    const state = this.shapePlaybackStates.get(shapeId);
    return state ? state.continuousProgress : 0;
  }

  // Continuous mode methods
  public setContinuousMode(enabled: boolean): void {
    if (this.isContinuousMode === enabled) return;

    this.isContinuousMode = enabled;

    // If playing, restart with new mode
    if (this.isPlaying) {
      this.stopPlayback();
      this.startPlayback();
    }
  }

  public getContinuousMode(): boolean {
    return this.isContinuousMode;
  }

  private startContinuousPlayback(shapeId: string): void {
    const shape = this.shapes.get(shapeId);
    if (!shape) return;

    // Initialize state
    if (!this.shapePlaybackStates.has(shapeId)) {
      this.shapePlaybackStates.set(shapeId, {
        currentDotIndex: 0,
        loopTimeoutId: null,
        continuousProgress: 0,
        continuousAnimationId: null
      });
    }

    // Create single continuous audio point for this shape
    this.createContinuousAudioPoint(shapeId, shape);

    // Start animation loop
    this.updateContinuousPosition(shapeId);
  }

  private createContinuousAudioPoint(shapeId: string, shape: ShapeData): void {
    // Remove existing continuous point if any
    if (this.continuousAudioPoints.has(shapeId)) {
      const nodes = this.continuousAudioPoints.get(shapeId)!;
      nodes.source.stop();
      nodes.source.disconnect();
      nodes.bandpassedNoiseGenerator.dispose();
      nodes.rotationGain.disconnect();
      nodes.envelopeGain.disconnect();
      nodes.mainGain.disconnect();
      nodes.panner.disconnect();
      this.continuousAudioPoints.delete(shapeId);
    }

    if (!this.pinkNoiseBuffer) return;

    // Create audio nodes
    const source = this.ctx.createBufferSource();
    source.buffer = this.pinkNoiseBuffer;
    source.loop = true;
    source.start();

    const bandpassedNoiseGenerator = new BandpassedNoiseGenerator(this.ctx);

    // Start at position 0
    const startPos = this.getPositionAlongPerimeter(shape, 0);
    const normalizedX = (startPos.x + 1) / 2;
    const normalizedY = (startPos.y + 1) / 2;

    // Set initial frequency
    const logMinFreq = Math.log2(MIN_AUDIBLE_FREQ);
    const logMaxFreq = Math.log2(MAX_AUDIBLE_FREQ);
    const frequency = Math.pow(2, logMinFreq + normalizedY * (logMaxFreq - logMinFreq));
    bandpassedNoiseGenerator.setBandpassFrequency(frequency);

    // No envelope gain for continuous mode - use mainGain directly
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = 1.0; // Constant volume

    const depthGain = this.ctx.createGain();
    const depthFactor = this.calculateDepthGain(startPos.z);
    depthGain.gain.value = depthFactor;

    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 2 * normalizedX - 1;

    // Connect: source → bandpassedNoise → depthGain → envelopeGain → mainGain → panner → output
    source.connect(bandpassedNoiseGenerator.getInputNode());
    bandpassedNoiseGenerator.getOutputNode().connect(depthGain);
    depthGain.connect(envelopeGain);
    envelopeGain.connect(mainGain);
    mainGain.connect(panner);
    panner.connect(this.outputGain);

    // Store nodes
    this.continuousAudioPoints.set(shapeId, {
      source,
      bandpassedNoiseGenerator,
      mainGain,
      envelopeGain,
      panner,
      rotationGain: depthGain,
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX
    });
  }

  private getPositionAlongPerimeter(shape: ShapeData, progress: number): { x: number; y: number; z: number } {
    // Calculate all dots for this shape
    const dots = this.calculateShapeDots(shape);
    if (dots.length === 0) return { x: 0, y: 0, z: 0 };

    // Interpolate between dots based on progress (0-1)
    const exactIndex = progress * dots.length;
    const index0 = Math.floor(exactIndex) % dots.length;
    const index1 = (index0 + 1) % dots.length;
    const t = exactIndex - Math.floor(exactIndex);

    const dot0 = dots[index0];
    const dot1 = dots[index1];

    // Linear interpolation
    return {
      x: dot0.x + (dot1.x - dot0.x) * t,
      y: dot0.y + (dot1.y - dot0.y) * t,
      z: dot0.z + (dot1.z - dot0.z) * t
    };
  }

  private updateContinuousPosition(shapeId: string): void {
    const state = this.shapePlaybackStates.get(shapeId);
    const shape = this.shapes.get(shapeId);
    const nodes = this.continuousAudioPoints.get(shapeId);

    if (!state || !shape || !nodes || !this.isPlaying) return;

    // Update progress (0-1 around perimeter)
    const progressDelta = (this.speed * 0.016) / 2; // ~60fps, divided by 2 for reasonable speed
    state.continuousProgress = (state.continuousProgress + progressDelta) % 1.0;

    // Get current position
    const pos = this.getPositionAlongPerimeter(shape, state.continuousProgress);
    const normalizedX = (pos.x + 1) / 2;
    const normalizedY = (pos.y + 1) / 2;

    // Update frequency
    const logMinFreq = Math.log2(MIN_AUDIBLE_FREQ);
    const logMaxFreq = Math.log2(MAX_AUDIBLE_FREQ);
    const frequency = Math.pow(2, logMinFreq + normalizedY * (logMaxFreq - logMinFreq));
    nodes.bandpassedNoiseGenerator.setBandpassFrequency(frequency);

    // Update panning
    nodes.panner.pan.value = 2 * normalizedX - 1;

    // Update depth gain
    const depthFactor = this.calculateDepthGain(pos.z);
    nodes.rotationGain.gain.value = depthFactor;

    // Schedule next update
    state.continuousAnimationId = window.requestAnimationFrame(() => {
      this.updateContinuousPosition(shapeId);
    });
  }

  private stopContinuousPlayback(shapeId: string): void {
    const state = this.shapePlaybackStates.get(shapeId);
    if (state && state.continuousAnimationId !== null) {
      window.cancelAnimationFrame(state.continuousAnimationId!);
      state.continuousAnimationId = null;
    }

    // Remove continuous audio point
    const nodes = this.continuousAudioPoints.get(shapeId);
    if (nodes) {
      nodes.source.stop();
      nodes.source.disconnect();
      nodes.bandpassedNoiseGenerator.dispose();
      nodes.rotationGain.disconnect();
      nodes.envelopeGain.disconnect();
      nodes.mainGain.disconnect();
      nodes.panner.disconnect();
      this.continuousAudioPoints.delete(shapeId);
    }
  }

  // Settings
  public setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(4.0, speed));
  }

  public setRepeatCount(count: number): void {
    this.repeatCount = Math.max(1, Math.min(10, count));
  }

  public setDbReductionPerRepeat(db: number): void {
    this.dbReductionPerRepeat = Math.max(0, Math.min(60, db));
  }

  public setHoldCount(count: number): void {
    this.holdCount = Math.max(1, Math.min(10, count));
  }

  public createPreEQAnalyser(): AnalyserNode {
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;

    // Connect output to analyzer and EQ
    this.outputGain.disconnect();
    this.outputGain.connect(analyser);
    const eq = eqProcessor.getEQProcessor();
    analyser.connect(eq.getInputNode());

    return analyser;
  }

  public cleanup(): void {
    this.stopPlayback();
    this.shapes.forEach((shape, shapeId) => {
      this.removeShape(shapeId);
    });
    this.outputGain.disconnect();
  }
}

// Singleton instance
let shapeGridAudioPlayer: ShapeGridAudioPlayer | null = null;

export function getShapeGridAudioPlayer(): ShapeGridAudioPlayer {
  if (!shapeGridAudioPlayer) {
    shapeGridAudioPlayer = new ShapeGridAudioPlayer(audioContext.getAudioContext());
    // Connect to EQ processor
    const eq = eqProcessor.getEQProcessor();
    shapeGridAudioPlayer.getOutputNode().connect(eq.getInputNode());
  }
  return shapeGridAudioPlayer;
}

export function cleanupShapeGridAudioPlayer(): void {
  if (shapeGridAudioPlayer) {
    shapeGridAudioPlayer.cleanup();
    shapeGridAudioPlayer = null;
  }
}

export function setSpeed(speed: number): void {
  getShapeGridAudioPlayer().setSpeed(speed);
}

export function setRepeatCount(count: number): void {
  getShapeGridAudioPlayer().setRepeatCount(count);
}

export function setDbReductionPerRepeat(db: number): void {
  getShapeGridAudioPlayer().setDbReductionPerRepeat(db);
}

export function setHoldCount(count: number): void {
  getShapeGridAudioPlayer().setHoldCount(count);
}

export function updateShapeRotation(shapeId: string, rotation: number): void {
  getShapeGridAudioPlayer().updateShapeRotation(shapeId, rotation);
}
