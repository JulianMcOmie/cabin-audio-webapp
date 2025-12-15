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
  slopedNoiseGenerator: SlopedPinkNoiseGenerator;
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

    // Create new audio points with rotation
    dots.forEach((dot, index) => {
      const pointId = `${shape.id}-${index}`;
      this.createAudioPoint(pointId, dot.x, dot.y, shape.rotation || 0);
    });
  }

  private calculateShapeDots(shape: ShapeData): DotPosition[] {
    switch (shape.type) {
      case 'circle':
        // Use aspect ratio of 1 for audio (not visual)
        // The visual stretch is handled in the UI component
        return calculateCircleDots(shape.position, shape.size, shape.numDots, 1.0);

      case 'triangle':
        const vertices = getTriangleVertices(
          shape.position,
          shape.size,
          shape.rotation || 0
        );
        return calculateTriangleDots(vertices, shape.numDots);

      case 'five':
        return calculateFiveGlyphDots(
          shape.position,
          shape.size,
          shape.rotation || 0,
          shape.numDots
        );

      default:
        return [];
    }
  }

  private createAudioPoint(pointId: string, x: number, y: number, rotation: number = 0): void {
    if (!this.pinkNoiseBuffer) return;

    // Normalize coordinates from -1 to 1 space to 0-1 space
    const normalizedX = (x + 1) / 2;
    const normalizedY = (y + 1) / 2;

    // Create audio nodes
    const source = this.ctx.createBufferSource();
    source.buffer = this.pinkNoiseBuffer;
    source.loop = true;
    source.start();

    // Sloped noise generator (-4.5dB/oct)
    const slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);

    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = 0; // Start silent

    // Rotation gain controls loudness based on rotation
    const rotationGain = this.ctx.createGain();
    // Map rotation from -π to π to gain from 0 to 1
    // rotation = 0 (front) → loud, rotation = ±π (back) → quiet
    const rotationFactor = (Math.cos(rotation) + 1) / 2; // 0 to 1
    rotationGain.gain.value = rotationFactor;

    const mainGain = this.ctx.createGain();
    mainGain.gain.value = 1.0;

    const panner = this.ctx.createStereoPanner();
    // Map X position to panning: -1 (left) to 1 (right)
    panner.pan.value = 2 * normalizedX - 1;

    // Connect nodes: source → slopedNoise → rotationGain → envelopeGain → mainGain → panner → output
    source.connect(slopedNoiseGenerator.getInputNode());
    slopedNoiseGenerator.getOutputNode().connect(rotationGain);
    rotationGain.connect(envelopeGain);
    envelopeGain.connect(mainGain);
    mainGain.connect(panner);
    panner.connect(this.outputGain);

    // Store nodes
    this.audioPoints.set(pointId, {
      source,
      slopedNoiseGenerator,
      mainGain,
      envelopeGain,
      panner,
      rotationGain,
      normalizedYPos: normalizedY,
      normalizedXPos: normalizedX
    });
  }

  public updateShapeRotation(shapeId: string, rotation: number): void {
    const shape = this.shapes.get(shapeId);
    if (!shape) return;

    // Update all dots for this shape with new rotation gain
    for (let i = 0; i < shape.numDots; i++) {
      const pointId = `${shapeId}-${i}`;
      const nodes = this.audioPoints.get(pointId);
      if (nodes) {
        // Map rotation from -π to π to gain from 0 to 1
        const rotationFactor = (Math.cos(rotation) + 1) / 2;
        nodes.rotationGain.gain.value = rotationFactor;
      }
    }
  }

  private removeAudioPoint(pointId: string): void {
    const nodes = this.audioPoints.get(pointId);
    if (nodes) {
      nodes.source.stop();
      nodes.source.disconnect();
      nodes.slopedNoiseGenerator.dispose();
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

    const state: ShapePlaybackState = {
      currentDotIndex: 0,
      loopTimeoutId: null
    };
    this.shapePlaybackStates.set(shapeId, state);

    this.playNextDot(shapeId);
  }

  private stopShapePlayback(shapeId: string): void {
    const state = this.shapePlaybackStates.get(shapeId);
    if (state && state.loopTimeoutId !== null) {
      clearTimeout(state.loopTimeoutId);
      state.loopTimeoutId = null;
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
