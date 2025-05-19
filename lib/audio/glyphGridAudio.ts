import { getAudioContext } from '@/lib/audio/audioContext'
import * as eqProcessor from '@/lib/audio/eqProcessor'
import { useEQProfileStore } from '@/lib/stores'

// --- Constants for SlopedPinkNoiseGenerator ---
const NUM_BANDS = 20; // Number of frequency bands for shaping
const SLOPE_REF_FREQUENCY = 800; // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20; // Hz
const MAX_AUDIBLE_FREQ = 20000; // Hz
const BAND_Q_VALUE = 1.5; // Q value for the bandpass filters
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise

// Target overall slopes for glyphs (aligned with dotGridAudio)
const LOW_SLOPE_DB_PER_OCT = -9.0; // For low y positions (darker sound)
const CENTER_SLOPE_DB_PER_OCT = -3.0; // For middle y positions
const HIGH_SLOPE_DB_PER_OCT = 3.0; // For high y positions (brighter sound)
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1; // Scalar to reduce output of SlopedPinkNoiseGenerator

// New constants for Flicker Effect
const FLICKER_RATE_HZ = 8; // Flickers per second
const FLICKER_MIN_GAIN_SCALAR = 0.2; // Gain drops to 20% of currentCalculatedGain
const FLICKER_MAX_GAIN_SCALAR = 1.0; // Gain up to 100% of currentCalculatedGain

// New constants from dotGridAudio.ts for gain calculation
const ATTENUATION_PER_DB_OCT_DEVIATION_DB = 3.8; // dB reduction per dB/octave deviation
const MAX_ADDITIONAL_BOOST_DB = 9.0; // Max boost for y-extremity

// --- End Constants for SlopedPinkNoiseGenerator ---

// Default values
const DEFAULT_FREQ_MULTIPLIER = 1.0
const DEFAULT_SWEEP_DURATION = 8.0 // 8 seconds per cycle
const MASTER_GAIN = 6.0; // Aligned with dotGridAudio
const DEFAULT_SPEED = 1.0 // Default movement speed

// Add constants for hit detection
const DEFAULT_HIT_INTERVAL = 0.2 // Default interval between hits (20% of path)

export enum PlaybackMode {
  PATH = 'path', // Follow the path continuously back and forth
  OSCILLATE = 'oscillate', // Oscillate through the path at varying speeds
  SWEEP = 'sweep',    // Smoothly sweep through the path
  ALTERNATE = 'alternate'  // Alternate between start and end points
}

// --- SlopedPinkNoiseGenerator Class Definition ---
// (Copied from dotGridAudio.ts - ensure imports like MIN_AUDIBLE_FREQ etc. are available in this scope)
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

      const gainNode = this.ctx.createGain(); // Renamed from gain to gainNode to avoid conflict
      this.bandGains.push(gainNode);

      this.inputGainNode.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.outputGainNode);
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
// --- End SlopedPinkNoiseGenerator Class Definition ---

// Simple glyph representation
export interface GlyphData {
  id: string;
  type: 'line' | 'triangle' | 'zigzag'; // Allow zigzag type
  position: { x: number, y: number }; // Center position
  size: { width: number, height: number }; // Size of the glyph
  angle?: number; // Optional rotation angle
}

class GlyphGridAudioPlayer {
  private static instance: GlyphGridAudioPlayer
  private pinkNoiseBuffer: AudioBuffer | null = null
  private isPlaying: boolean = false
  private audioNodes: {
    source: AudioBufferSourceNode | null;
    gain: GainNode | null;
    panner: StereoPannerNode | null;
    slopedNoiseGenerator: SlopedPinkNoiseGenerator | null;
  } = {
    source: null,
    gain: null,
    panner: null,
    slopedNoiseGenerator: null,
  }
  
  // Path related properties
  private pathPosition: number = 0 // Position along the path (0 to 1)
  private pathDirection: number = 1 // Direction of movement (1 = forward, -1 = backward)
  private animationFrameId: number | null = null
  private audioContextRef: AudioContext | null = null; // Added for flicker time reference
  
  // Frequency and sweep settings
  private freqMultiplier: number = DEFAULT_FREQ_MULTIPLIER
  private isSweeping: boolean = false
  private sweepDuration: number = DEFAULT_SWEEP_DURATION
  private sweepTimeoutId: number | null = null
  
  // Current glyph data
  private currentGlyph: GlyphData | null = null
  
  // Add these properties to the class
  private isManualControl: boolean = false
  private manualPosition: number = 0
  private currentBaseDbLevel: number = 0; // Added for gain calculation alignment
  private currentCalculatedGain: number = MASTER_GAIN; // Added for base gain storage
  
  // Add preEQAnalyser property
  private preEQAnalyser: AnalyserNode | null = null
  private preEQGain: GainNode | null = null
  
  // Add these new properties after the existing ones
  private subsectionStart: number = 0 // Default to full range (0-1)
  private subsectionEnd: number = 1
  private useSubsection: boolean = false
  
  // Add speed property
  private speed: number = DEFAULT_SPEED
  
  private playbackMode: PlaybackMode = PlaybackMode.SWEEP;
  
  // Add a counter for alternating mode
  private _alternateCounter: number = 0;
  
  // Add new properties to the class
  private hitPoints: number[] = [] // Points along the path where "hits" occur
  private lastHitIndex: number = -1 // Track the last hit point we passed
  private discreteFrequency: boolean = true // Whether to use discrete or continuous frequency
  
  // Add distortion gain property
  private distortionGain: number = 1.0;
  
  // Add flicker enabled property
  private isFlickerEnabled: boolean = false;
  
  private constructor() {
    this.generatePinkNoiseBuffer()
    
    // Apply initial distortion gain from store
    const distortionGain = useEQProfileStore.getState().distortionGain;
    this.setDistortionGain(distortionGain);
    
    // Subscribe to distortion gain changes from the store
    useEQProfileStore.subscribe(
      (state) => {
        this.setDistortionGain(state.distortionGain);
      }
    );
  }
  
  public static getInstance(): GlyphGridAudioPlayer {
    if (!GlyphGridAudioPlayer.instance) {
      GlyphGridAudioPlayer.instance = new GlyphGridAudioPlayer()
    }
    return GlyphGridAudioPlayer.instance
  }
  
  private async generatePinkNoiseBuffer(): Promise<void> {
    const ctx = getAudioContext()
    
    // Buffer size (2 seconds of audio at sample rate)
    const bufferSize = 2 * ctx.sampleRate
    
    // Create buffer
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    
    // Get channel data
    const channelData = noiseBuffer.getChannelData(0)
    
    // Generate pink noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    
    for (let i = 0; i < bufferSize; i++) {
      // White noise
      const white = Math.random() * 2 - 1
      
      // Pink noise calculation (Paul Kellet's refined method)
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.96900 * b2 + white * 0.1538520
      b3 = 0.86650 * b3 + white * 0.3104856
      b4 = 0.55000 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.0168980
      b6 = white * 0.5362
      
      // Mix pink noise components
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
      
      // Scale to stay within -1.0 to 1.0
      channelData[i] = pink * 0.11
    }
    
    this.pinkNoiseBuffer = noiseBuffer
    
    console.log('🔊 Generated pink noise buffer for glyph grid audio')
  }
  
  public setGlyph(glyph: GlyphData): void {
    this.currentGlyph = glyph
    
    // if (this.isPlaying) {
    //   this.stopSound()
    //   this.startSound()
    // }
  }
  
  private updateAudioNodesFromGlyph(): void {
    if (!this.currentGlyph) return
    
    // Calculate the current path position based on the glyph
    this.updatePathPosition()
  }
  
  private updatePathPosition(): void {
    if (!this.currentGlyph) return
    
    // If in manual control mode, use the manually set position
    if (this.isManualControl) {
      const position = this.manualPosition
      // In manual mode, always update parameters (for responsive UI)
      this.updateAudioParametersFromPosition(position)
      return
    }
    
    // Store previous position to detect hit crossing
    const previousPosition = this.pathPosition
    
    // Calculate new position based on playback mode
    if (this.playbackMode === PlaybackMode.SWEEP) {
      const prevPathPosition = this.pathPosition;
      this.pathPosition += 0.005 * this.pathDirection * this.speed;
      
      let looped = false;

      if (this.useSubsection) {
        const startPoint = this.subsectionStart;
        const endPoint = this.subsectionEnd;

        if (this.pathDirection === 1) { // Moving from startPoint towards endPoint
          if (this.pathPosition >= endPoint) {
            this.pathPosition = startPoint;
            looped = true;
          }
          // Clamp position to be within [startPoint, endPoint]
          this.pathPosition = Math.max(startPoint, Math.min(this.pathPosition, endPoint));
        } else { // pathDirection === -1, Moving from startPoint towards endPoint (e.g. 0.8 down to 0.2)
          if (this.pathPosition <= endPoint) {
            this.pathPosition = startPoint;
            looped = true;
          }
          // Clamp position to be within [endPoint, startPoint]
          this.pathPosition = Math.max(endPoint, Math.min(this.pathPosition, startPoint));
        }
      } else { // Full range (0 to 1), pathDirection is assumed to be 1
        if (this.pathPosition >= 1.0) {
          this.pathPosition = 0.0;
          looped = true;
        } else if (this.pathPosition < 0.0) { 
          // This case should ideally not be hit if speed is positive and direction is 1.
          this.pathPosition = 0.0; 
        }
      }

      if (looped) {
        this.updateAudioParametersFromPosition(this.pathPosition); // Update audio at the loop point
        } else if (this.discreteFrequency) {
        const hitInterval = DEFAULT_HIT_INTERVAL; // e.g., 0.2 for 20% steps
        let currentIntervalNum: number;
        let previousIntervalNum: number;

        if (this.useSubsection) {
            const subLength = Math.abs(this.subsectionEnd - this.subsectionStart);
            if (subLength === 0) {
                currentIntervalNum = 0;
                previousIntervalNum = 0;
        } else {
                // Distance travelled from the subsection's logical start, normalized by pathDirection
                const currentDistFromSubStart = (this.pathPosition - this.subsectionStart) * this.pathDirection;
                const previousDistFromSubStart = (prevPathPosition - this.subsectionStart) * this.pathDirection;
                
                // Number of "hitInterval steps" (scaled by subLength) into the subsection
                currentIntervalNum = Math.floor(currentDistFromSubStart / (hitInterval * subLength));
                previousIntervalNum = Math.floor(previousDistFromSubStart / (hitInterval * subLength));
            }
        } else { // Full range
            currentIntervalNum = Math.floor(this.pathPosition / hitInterval);
            previousIntervalNum = Math.floor(prevPathPosition / hitInterval);
        }
        
        if (currentIntervalNum !== previousIntervalNum) {
          this.updateAudioParametersFromPosition(this.pathPosition);
        }
      } else { // Continuous mode - always update unless looped (already updated)
        this.updateAudioParametersFromPosition(this.pathPosition);
      }
    } else if (this.playbackMode === PlaybackMode.ALTERNATE) {
      // Alternate mode: jump between start and end points
      const stayDuration = 30 / this.speed // Number of frames to stay at each point
      
      // Increment a counter to track when to alternate
      this._alternateCounter = (this._alternateCounter || 0) + 1
      
      if (this._alternateCounter >= stayDuration) {
        this._alternateCounter = 0
        
        // Switch between start and end
        if (this.pathDirection === 1) {
          // We're at start point, move to end
          this.pathPosition = this.useSubsection ? this.subsectionEnd : 1
          this.pathDirection = -1
        } else {
          // We're at end point, move to start
          this.pathPosition = this.useSubsection ? this.subsectionStart : 0
          this.pathDirection = 1
        }
        
        // Update audio parameters at each alternation point
        this.updateAudioParametersFromPosition(this.pathPosition)
      }
    }
  }
  
  // New method to update audio parameters from a position
  private updateAudioParametersFromPosition(position: number): void {
    if (!this.currentGlyph || !this.audioNodes.slopedNoiseGenerator || !this.audioNodes.gain || !this.audioNodes.panner) return;
    
    // Get the glyph's position and size
    const { type: glyphType, position: glyphPos, size: glyphSize } = this.currentGlyph
    
    // Calculate the actual x and y in normalized space (-1 to 1) for the BOUNDING BOX
    const startX_bb = glyphPos.x - glyphSize.width / 2
    const startY_bb = glyphPos.y - glyphSize.height / 2
    const endX_bb = glyphPos.x + glyphSize.width / 2
    const endY_bb = glyphPos.y + glyphSize.height / 2
    
    let x: number;
    let y: number;

    if (glyphType === 'triangle') {
      // Original vertices based on bounding box
      const v1_unrotated = { x: (startX_bb + endX_bb) / 2, y: endY_bb }; // Apex
      const v2_unrotated = { x: startX_bb, y: startY_bb };               // Base-left
      const v3_unrotated = { x: endX_bb, y: startY_bb };               // Base-right

      let v1 = { ...v1_unrotated };
      let v2 = { ...v2_unrotated };
      let v3 = { ...v3_unrotated };

      const angle = this.currentGlyph.angle; // Angle in radians from glyph data

      if (angle && angle !== 0) {
        const centerX = glyphPos.x; // Center of rotation is the glyph's center
        const centerY = glyphPos.y;
        const cosTheta = Math.cos(angle);
        const sinTheta = Math.sin(angle);

        const rotatePoint = (point: {x: number, y: number}) => {
          const tempX = point.x - centerX;
          const tempY = point.y - centerY;
          const rotatedX = tempX * cosTheta - tempY * sinTheta;
          const rotatedY = tempX * sinTheta + tempY * cosTheta;
          return { x: rotatedX + centerX, y: rotatedY + centerY };
        };

        v1 = rotatePoint(v1_unrotated);
        v2 = rotatePoint(v2_unrotated);
        v3 = rotatePoint(v3_unrotated);
      }

      // Perimeter calculation and path interpolation using v1, v2, v3 (which are now rotated if angle was present)
      const dist = (p1: {x:number,y:number}, p2: {x:number,y:number}) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

      const len12 = dist(v1, v2);
      const len23 = dist(v2, v3);
      const len31 = dist(v3, v1);
      const totalPerimeter = len12 + len23 + len31;

      if (totalPerimeter === 0) { 
        x = v1.x;
        y = v1.y;
      } else {
        let currentPerimeterPos = position * totalPerimeter;
        if (currentPerimeterPos <= len12) {
          const segmentPos = currentPerimeterPos / len12;
          x = v1.x + segmentPos * (v2.x - v1.x);
          y = v1.y + segmentPos * (v2.y - v1.y);
        } else if (currentPerimeterPos <= len12 + len23) {
          const segmentPos = (currentPerimeterPos - len12) / len23;
          x = v2.x + segmentPos * (v3.x - v2.x);
          y = v2.y + segmentPos * (v3.y - v2.y);
        } else {
          const segmentPos = (currentPerimeterPos - len12 - len23) / len31;
          x = v3.x + segmentPos * (v1.x - v3.x);
          y = v3.y + segmentPos * (v1.y - v3.y);
        }
      }
    } else if (glyphType === 'zigzag') {
      const width_bb = endX_bb - startX_bb;
      const height_bb = endY_bb - startY_bb;

      // Define 5 points for the zig-zag (unrotated, in normalized coordinates)
      const p1_unrotated_norm = { x: startX_bb, y: startY_bb };
      const p2_unrotated_norm = { x: startX_bb + width_bb * 0.25, y: startY_bb + height_bb * 0.4 };
      const p3_unrotated_norm = { x: startX_bb + width_bb * 0.5, y: startY_bb + height_bb * 0.1 };
      const p4_unrotated_norm = { x: startX_bb + width_bb * 0.75, y: startY_bb + height_bb * 0.6 };
      const p5_unrotated_norm = { x: endX_bb, y: endY_bb };
      const points_unrotated_norm = [p1_unrotated_norm, p2_unrotated_norm, p3_unrotated_norm, p4_unrotated_norm, p5_unrotated_norm];

      let points_for_path = points_unrotated_norm;
      const angle = this.currentGlyph.angle;

      if (angle && angle !== 0) {
        const centerX = glyphPos.x;
        const centerY = glyphPos.y;
        const cosTheta = Math.cos(angle);
        const sinTheta = Math.sin(angle);
        const rotatePoint = (point: {x: number, y: number}) => {
          const tempX = point.x - centerX;
          const tempY = point.y - centerY;
          const rotatedX = tempX * cosTheta - tempY * sinTheta;
          const rotatedY = tempX * sinTheta + tempY * cosTheta;
          return { x: rotatedX + centerX, y: rotatedY + centerY };
        };
        points_for_path = points_unrotated_norm.map(rotatePoint);
      }

      const dist = (p1: {x:number,y:number}, p2: {x:number,y:number}) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      const segmentLengths = [];
      for (let i = 0; i < points_for_path.length - 1; i++) {
        segmentLengths.push(dist(points_for_path[i], points_for_path[i+1]));
      }
      const totalPathLength = segmentLengths.reduce((sum, len) => sum + len, 0);

      if (totalPathLength === 0) {
        x = points_for_path[0].x;
        y = points_for_path[0].y;
      } else {
        let currentPathPos = position * totalPathLength;
        let accumulatedLength = 0;
        x = points_for_path[0].x; // Default x assignment
        y = points_for_path[0].y; // Default y assignment
        for (let i = 0; i < segmentLengths.length; i++) {
          if (currentPathPos <= accumulatedLength + segmentLengths[i] || i === segmentLengths.length - 1) {
            const segmentPos = segmentLengths[i] === 0 ? 0 : (currentPathPos - accumulatedLength) / segmentLengths[i];
            x = points_for_path[i].x + segmentPos * (points_for_path[i+1].x - points_for_path[i].x);
            y = points_for_path[i].y + segmentPos * (points_for_path[i+1].y - points_for_path[i].y);
            break;
          }
          accumulatedLength += segmentLengths[i];
        }
      }
    } else { // Default to line (diagonal of bounding box) or any other unrecognized types
      x = startX_bb + position * (endX_bb - startX_bb);
      y = startY_bb + position * (endY_bb - startY_bb);
    }
    
    // Properly normalize y from glyph space to full 0-1 range
    const normalizedY = Math.max(0, Math.min(1, (y + 1) / 2))
    
    // Map x to pan position (-1 to 1)
    const panPosition = x;
    
    // Calculate target slope
    let targetOverallSlopeDbPerOctave;
    if (normalizedY < 0.5) {
      const t = normalizedY * 2;
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      const t = (normalizedY - 0.5) * 2;
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }
    this.audioNodes.slopedNoiseGenerator.setSlope(targetOverallSlopeDbPerOctave);
    
    // Calculate main gain based on dotGridAudio.ts logic
    const slopeDeviationForAttenuation = Math.abs(targetOverallSlopeDbPerOctave - CENTER_SLOPE_DB_PER_OCT);
    const existingAttenuationDb = -slopeDeviationForAttenuation * ATTENUATION_PER_DB_OCT_DEVIATION_DB;

    const extremityFactor = Math.abs(normalizedY - 0.5) * 2;
    const curvedExtremityFactor = Math.sqrt(extremityFactor);
    const additionalSlopeBoostDb = curvedExtremityFactor * MAX_ADDITIONAL_BOOST_DB;

    const finalVolumeDb = this.currentBaseDbLevel + existingAttenuationDb + additionalSlopeBoostDb;
    
    const gainRatio = Math.pow(10, finalVolumeDb / 20);
    const effectiveMasterGain = MASTER_GAIN * this.distortionGain * gainRatio;
    
    // Store the calculated gain; the animation loop will apply it (with flicker if enabled)
    this.currentCalculatedGain = effectiveMasterGain;

    // const ctx = getAudioContext(); // Ensure context is available for currentTime -- No longer directly setting gain here
    // this.audioNodes.gain.gain.setValueAtTime(effectiveMasterGain, ctx.currentTime); 
    
    // Update panner
      this.audioNodes.panner.pan.value = panPosition
  }
  
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return
    
    this.isPlaying = playing
    
    if (playing) {
      this.startSound()
    } else {
      this.stopSound()
    }
  }
  
  private startSound(): void {
    if (!this.pinkNoiseBuffer) {
      console.warn('🔊 Tried to start sound but pink noise buffer is not ready')
      return
    }
    
    const ctx = getAudioContext()
    
    // Create new audio nodes
    const source = ctx.createBufferSource()
    source.buffer = this.pinkNoiseBuffer
    source.loop = true
    
    // Create gain node for volume - apply distortion gain
    const gain = ctx.createGain()
    // Initial gain setting - updateAudioParametersFromPosition will provide more detailed adjustments
    gain.gain.value = MASTER_GAIN * this.distortionGain;
    
    // Create panner node
    const panner = ctx.createStereoPanner()
    panner.pan.value = 0 // Start centered
    
    // Create SlopedNoiseGenerator
    const slopedNoiseGenerator = new SlopedPinkNoiseGenerator(ctx);
    
    // Connect the audio chain
    source.connect(slopedNoiseGenerator.getInputNode());
    slopedNoiseGenerator.getOutputNode().connect(gain);
    gain.connect(panner);
    
    // If we have an analyzer, connect through it
    if (this.preEQAnalyser && this.preEQGain) {
      panner.connect(this.preEQGain)
      // preEQGain is already connected to destination and analyzer
    } else {
      // Connect to EQ processor directly
      const eq = eqProcessor.getEQProcessor()
      panner.connect(eq.getInputNode())
    }
    
    // Store the nodes
    this.audioNodes = {
      source,
      gain,
      panner,
      slopedNoiseGenerator,
    }

    this.audioContextRef = ctx; // Store audio context reference
    this.currentCalculatedGain = gain.gain.value; // Initialize currentCalculatedGain
    
    // Start the source
    source.start()
    
    // Start the animation loop to update path position
    this.startAnimationLoop()
  }
  
  private startAnimationLoop(): void {
    const animate = () => {
      this.updateAudioNodesFromGlyph() // This might update this.currentCalculatedGain via updateAudioParametersFromPosition

      if (this.isPlaying && this.audioNodes.gain && this.audioContextRef) {
        let finalGain = this.currentCalculatedGain;
        if (this.isFlickerEnabled) {
          const flickerTime = this.audioContextRef.currentTime;
          // Sine wave from -1 to 1, then (value + 1) / 2 to map to 0 to 1 range
          const flickerModulation = (Math.sin(flickerTime * FLICKER_RATE_HZ * 2 * Math.PI) + 1) / 2;
          const flickerScalar = FLICKER_MIN_GAIN_SCALAR + flickerModulation * (FLICKER_MAX_GAIN_SCALAR - FLICKER_MIN_GAIN_SCALAR);
          finalGain *= flickerScalar;
        }
        
        finalGain = Math.max(0, finalGain); // Ensure gain is not negative

        this.audioNodes.gain.gain.setValueAtTime(finalGain, this.audioContextRef.currentTime);
      }

      this.animationFrameId = requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  private stopSound(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    
    // Clean up the analyzer nodes
    if (this.preEQAnalyser) {
      if (this.preEQGain) {
        this.preEQGain.disconnect()
        this.preEQGain = null
      }
      this.preEQAnalyser = null
    }
    
    if (this.audioNodes.source) {
      this.audioNodes.source.stop()
      this.audioNodes.source.disconnect()
    }
    
    if (this.audioNodes.gain) {
      this.audioNodes.gain.disconnect()
    }
    
    if (this.audioNodes.slopedNoiseGenerator) {
      this.audioNodes.slopedNoiseGenerator.dispose();
    }
    
    if (this.audioNodes.panner) {
      this.audioNodes.panner.disconnect()
    }
    
    // Reset audio nodes
    this.audioNodes = {
      source: null,
      gain: null,
      panner: null,
      slopedNoiseGenerator: null,
    }
  }
  
  public setFrequencyMultiplier(multiplier: number): void {
    this.freqMultiplier = multiplier
  }
  
  public getFrequencyMultiplier(): number {
    return this.freqMultiplier
  }
  
  public setSweeping(enabled: boolean): void {
    this.isSweeping = enabled
    
    if (enabled) {
      this.startSweep()
    } else {
      this.stopSweep()
    }
  }
  
  public isSweepEnabled(): boolean {
    return this.isSweeping
  }
  
  public setSweepDuration(duration: number): void {
    this.sweepDuration = duration
    
    // If we're already sweeping, restart with new duration
    if (this.isSweeping) {
      this.stopSweep()
      this.startSweep()
    }
  }
  
  private startSweep(): void {
    if (this.sweepTimeoutId !== null) {
      clearTimeout(this.sweepTimeoutId)
    }
    
    const startTime = Date.now()
    
    const updateSweep = () => {
      const elapsed = (Date.now() - startTime) / 1000 // seconds
      const sweepProgress = (elapsed % this.sweepDuration) / this.sweepDuration
      
      // Sine wave oscillation between 0.5 and 2.0
      this.freqMultiplier = 0.5 + 1.5 * (Math.sin(sweepProgress * Math.PI * 2) * 0.5 + 0.5)
      
      // Schedule next update
      this.sweepTimeoutId = window.setTimeout(updateSweep, 50) // 20 updates per second
    }
    
    updateSweep()
  }
  
  private stopSweep(): void {
    if (this.sweepTimeoutId !== null) {
      clearTimeout(this.sweepTimeoutId)
      this.sweepTimeoutId = null
    }
  }
  
  public dispose(): void {
    this.setPlaying(false)
    this.stopSweep()
  }
  
  // Add this new public method to expose the current path position
  public getPathPosition(): number {
    return this.pathPosition;
  }
  
  // New method to set manual position control
  public setManualPosition(position: number): void {
    this.isManualControl = true
    this.manualPosition = Math.max(0, Math.min(1, position))
  }
  
  // New method to turn off manual control
  public setManualControl(enabled: boolean): void {
    this.isManualControl = enabled
    if (!enabled) {
      // Reset to the current path position when turning off manual control
      this.pathPosition = this.manualPosition
    }
  }
  
  // New method to resume automatic movement from a specific position
  public resumeFromPosition(position: number): void {
    this.pathPosition = Math.max(0, Math.min(1, position))
    this.isManualControl = false
  }
  
  // Add method to create and return an analyzer
  public createPreEQAnalyser(): AnalyserNode {
    const ctx = getAudioContext()
    
    // If we already have one, return it
    if (this.preEQAnalyser) {
      return this.preEQAnalyser
    }
    
    // Create analyzer node
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.85
    
    // Create gain node for analyzer connection
    const preEQGain = ctx.createGain()
    preEQGain.gain.value = 1.0
    
    // Connect if we're playing and have a source
    if (this.isPlaying && this.audioNodes.panner) {
      // Disconnect the panner from its current destination
      this.audioNodes.panner.disconnect()
      
      // Connect panner -> preEQGain -> analyser and preEQGain -> EQ input
      this.audioNodes.panner.connect(preEQGain)
      preEQGain.connect(analyser)
      
      // Connect directly to EQ processor
      const eq = eqProcessor.getEQProcessor()
      preEQGain.connect(eq.getInputNode())
    }
    
    // Store for later access
    this.preEQAnalyser = analyser
    this.preEQGain = preEQGain
    
    return analyser
  }
  
  // Add method to get the current analyzer
  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser
  }
  
  // Add method to get current audio parameters
  public getAudioParameters(): { frequency: number, panning: number } {
    // Default values
    const frequency = 0;
    let panning = 0;
    
    // Get values from audio nodes if available
    if (this.audioNodes.panner) {
      panning = this.audioNodes.panner.pan.value;
    }
    
    return { frequency, panning };
  }
  
  // Add method to set subsection bounds
  public setSubsection(start: number, end: number, enabled: boolean = true): void {
    // Clamp values between 0 and 1 but don't enforce start <= end
    this.subsectionStart = Math.max(0, Math.min(1, start));
    this.subsectionEnd = Math.max(0, Math.min(1, end));
    this.useSubsection = enabled;
    
    // Update the path position logic to handle reversed ranges
    this._updatePathPositionForSubsection();
  }
  
  // Add helper method to update path position for subsection changes
  private _updatePathPositionForSubsection(): void {
    // If the path position is outside the current range (considering both orderings),
    // reset to appropriate value
    const min = Math.min(this.subsectionStart, this.subsectionEnd);
    const max = Math.max(this.subsectionStart, this.subsectionEnd);
    
    if (this.pathPosition < min || this.pathPosition > max) {
      // Reset to the range start (which might be subsectionEnd if subsectionStart > subsectionEnd)
      this.pathPosition = this.subsectionStart;
      
      // Set initial direction based on subsection ordering
      this.pathDirection = this.subsectionStart <= this.subsectionEnd ? 1 : -1;
    }
  }
  
  // Get subsection info
  public getSubsection(): { start: number, end: number, enabled: boolean } {
    return {
      start: this.subsectionStart,
      end: this.subsectionEnd,
      enabled: this.useSubsection
    };
  }
  
  // Disable subsection (return to full range)
  public disableSubsection(): void {
    this.useSubsection = false;
    // Reset path position and direction for full range playback
    this.pathPosition = 0;
    this.pathDirection = 1;
  }
  
  // Add getter and setter for speed
  public setSpeed(speed: number): void {
    // Ensure speed is positive and reasonable (between 0.25x and 4x)
    this.speed = Math.max(0.25, Math.min(4.0, speed))
  }
  
  public getSpeed(): number {
    return this.speed
  }
  
  // Add method to set playback mode
  public setPlaybackMode(mode: PlaybackMode): void {
    this.playbackMode = mode;
    this._alternateCounter = 0; // Reset counter when changing modes
  }
  
  // Add method to get current playback mode
  public getPlaybackMode(): PlaybackMode {
    return this.playbackMode;
  }
  
  // Add public method to toggle between continuous and discrete frequency updates
  public setDiscreteFrequency(useDiscrete: boolean): void {
    this.discreteFrequency = useDiscrete
  }
  
  // Add getter for current frequency update mode
  public isDiscreteFrequency(): boolean {
    return this.discreteFrequency
  }
  
  // Add method to handle distortion gain
  private setDistortionGain(gain: number): void {
    // Clamp gain between 0 and 1
    this.distortionGain = Math.max(0, Math.min(1, gain));
    
    // If playing, the animation loop calling updateAudioParametersFromPosition
    // will pick up the new distortionGain. No direct gain update needed here
    // to avoid partial/incomplete gain settings.
    // if (this.isPlaying && this.audioNodes.gain) {
    //   this.audioNodes.gain.gain.value = MASTER_GAIN * this.distortionGain;
    // }
      console.log(`🔊 Glyph Grid distortion gain set to ${this.distortionGain.toFixed(2)}`);
    }

  // Add a setter for base volume, similar to DotGridAudioPlayer
  public setVolumeDb(dbLevel: number): void {
    this.currentBaseDbLevel = dbLevel;
    // If playing, the change will be picked up by updateAudioParametersFromPosition in the animation loop
  }

  // Add methods to control flicker
  public setFlickerEnabled(enabled: boolean): void {
    this.isFlickerEnabled = enabled;
    // If playing and flicker is turned off, we might want to immediately set gain to currentCalculatedGain
    // The animation loop will handle this on its next frame, which should be fine.
  }

  public getFlickerEnabled(): boolean { // Renamed from isFlickerEnabled to avoid conflict with property
    return this.isFlickerEnabled;
  }
}

/**
 * Get the glyph grid audio player singleton
 */
export function getGlyphGridAudioPlayer(): GlyphGridAudioPlayer {
  return GlyphGridAudioPlayer.getInstance()
}

/**
 * Clean up the glyph grid audio player
 */
export function cleanupGlyphGridAudioPlayer(): void {
  const player = GlyphGridAudioPlayer.getInstance()
  player.dispose()
} 