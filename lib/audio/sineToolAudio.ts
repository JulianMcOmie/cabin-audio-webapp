import { getAudioContext } from '@/lib/audio/audioContext';
import * as eqProcessor from '@/lib/audio/eqProcessor';
import { useEQProfileStore } from '@/lib/stores';

// --- Constants for SlopedPinkNoiseGenerator (adapted from dotGridAudio.ts and glyphGridAudio.ts) ---
const NUM_DOTS = 2; // Number of dots in the SineTool visualization
const NUM_BANDS = 20; // Number of frequency bands for shaping
const SLOPE_REF_FREQUENCY = 800; // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20; // Hz
const MAX_AUDIBLE_FREQ = 20000; // Hz
const BAND_Q_VALUE = 1.5; // Q value for the bandpass filters
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise

// Target overall slopes for y-position mapping
const LOW_SLOPE_DB_PER_OCT = -9.0; // For low y positions (darker sound)
const CENTER_SLOPE_DB_PER_OCT = -3.0; // For middle y positions (neutral pink noise)
const HIGH_SLOPE_DB_PER_OCT = 3.0; // For high y positions (brighter sound)
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 0.1; // Scalar to reduce output of SlopedPinkNoiseGenerator

// Constants for gain calculation (aligned with dotGridAudio.ts)
const MASTER_GAIN = 6.0; // Master gain level for calibration tools
const ATTENUATION_PER_DB_OCT_DEVIATION_DB = 3.8; // dB reduction per dB/octave deviation from center slope
const MAX_ADDITIONAL_BOOST_DB = 9.0; // Max boost for y-extremity to compensate for attenuation

// Analyzer settings (if we add one later, similar to other players)
const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

// --- SlopedPinkNoiseGenerator Class Definition (copied from dotGridAudio.ts / glyphGridAudio.ts) ---
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

      const gainNode = this.ctx.createGain();
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

// Interface for the audio nodes associated with each dot
interface AudioDotNodes {
  id: string;
  source: AudioBufferSourceNode;
  mainGain: GainNode; // For calculated volume based on y-pos and distortion
  envelopeGain: GainNode; // For on/off or ADSR control
  panner: StereoPannerNode;
  slopedNoiseGenerator: SlopedPinkNoiseGenerator;
  pinkNoiseBuffer: AudioBuffer; // Added for individual buffers
  currentYNormal: number; // Cache for recalculations
  currentXNormal: number; // Cache for recalculations
}

class SineToolAudioPlayer {
  private static instance: SineToolAudioPlayer;
  private ctx: AudioContext;
  private audioDots: (AudioDotNodes | null)[] = new Array(NUM_DOTS).fill(null);
  private isPlaying: boolean = false;
  private outputGain: GainNode; // Master output for this player

  private preEQAnalyser: AnalyserNode | null = null;
  private preEQGain: GainNode | null = null;

  private currentDistortionGain: number = 1.0;
  private currentBaseDbLevel: number = 0; // Default volume

  private constructor() {
    this.ctx = getAudioContext();
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1.0; // Start with full volume for this stage

    // No need to pre-generate shared buffer here anymore
    // Buffers will be generated on demand by ensureDotAudioNodes

    // Subscribe to distortion gain changes from the store
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.setDistortionGain(initialDistortionGain); // Apply initial value

    useEQProfileStore.subscribe(
      (state) => {
        this.setDistortionGain(state.distortionGain);
      }
    );
    console.log("🌊 SineToolAudioPlayer initialized");
  }

  public static getInstance(): SineToolAudioPlayer {
    if (!SineToolAudioPlayer.instance) {
      SineToolAudioPlayer.instance = new SineToolAudioPlayer();
    }
    return SineToolAudioPlayer.instance;
  }

  private _generateSinglePinkNoiseBuffer(): AudioBuffer { // Added method to generate one buffer
    const bufferSize = 2 * this.ctx.sampleRate; // 2 seconds of noise
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const channelData = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980; 
      b6 = white * 0.11000; 
      channelData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      if (Math.abs(channelData[i]) > 1.0) channelData[i] = Math.sign(channelData[i]);
    }
    // console.log('🌊 Generated a pink noise buffer'); // Log per buffer if needed
    return noiseBuffer;
  }

  private ensureDotAudioNodes(index: number, initialXNormal: number, initialYNormal: number): AudioDotNodes | null {
    // if (!this.sharedPinkNoiseBuffer) { // Removed check for shared buffer
    //     console.warn("Attempted to ensure dot audio nodes before shared buffer was ready.");
    //     return null; 
    // }

    if (!this.audioDots[index]) {
      const individualPinkNoiseBuffer = this._generateSinglePinkNoiseBuffer(); // Generate buffer here

      const source = this.ctx.createBufferSource();
      source.buffer = individualPinkNoiseBuffer; // Use individual buffer
      source.loop = true;

      const slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
      const mainGain = this.ctx.createGain();
      const envelopeGain = this.ctx.createGain();
      envelopeGain.gain.value = 0.0; // Start silent

      const panner = this.ctx.createStereoPanner();
      panner.pan.value = (initialXNormal * 2) - 1; // Map 0-1 to -1 to 1

      // Connections: source -> slopedGen -> mainGain -> envelopeGain -> panner -> playerOutputGain
      source.connect(slopedNoiseGenerator.getInputNode());
      slopedNoiseGenerator.getOutputNode().connect(mainGain);
      mainGain.connect(envelopeGain);
      envelopeGain.connect(panner);
      panner.connect(this.outputGain);
      
      try {
        source.start();
      } catch (e) {
        // If context is not running or source already started
        console.warn(`Could not start source for dot ${index}:`, e);
      }


      this.audioDots[index] = {
        id: 'dot-' + index, // Changed from template literal
        source,
        mainGain,
        envelopeGain,
        panner,
        slopedNoiseGenerator,
        pinkNoiseBuffer: individualPinkNoiseBuffer, // Store individual buffer
        currentXNormal: initialXNormal,
        currentYNormal: initialYNormal,
      };
      // Set initial audio parameters for the new dot
      this.updateAudioForDot(index, initialYNormal, initialXNormal, true);
    }
    return this.audioDots[index] as AudioDotNodes;
  }
  
  private applyPlayingState(): void {
    // if (!this.sharedPinkNoiseBuffer) return; // Removed check for shared buffer

    this.audioDots.forEach((dotNodes, index) => {
      if (dotNodes) {
        const targetGain = this.isPlaying ? 1.0 : 0.0;
        // For continuous play, just set envelopeGain
        dotNodes.envelopeGain.gain.cancelScheduledValues(this.ctx.currentTime);
        dotNodes.envelopeGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
      }
    });
  }

  public setPlaying(playing: boolean): void {
    // if (this.isPlaying === playing && this.sharedPinkNoiseBuffer) return; // Removed shared buffer check
    if (this.isPlaying === playing) return; // Simpler check
    this.isPlaying = playing;

    // if (!this.sharedPinkNoiseBuffer) { // Removed block for shared buffer not ready
    //   console.log("🌊 SineToolAudioPlayer: setPlaying called, but buffer not ready. Will apply when ready.");
    //   return; 
    // }
    
    // Ensure all dot nodes are created before trying to play/stop them
    this.audioDots.forEach((_, index) => {
        if(!this.audioDots[index]) {
            const xNormal = (index + 0.5) / NUM_DOTS;
            const yNormal = 0.5; // Default y
            // Call ensures nodes are created, result can be ignored if not immediately needed
            this.ensureDotAudioNodes(index, xNormal, yNormal);
        }
    });

    this.applyPlayingState();
    console.log(`🌊 SineToolAudioPlayer: setPlaying to ${this.isPlaying}`); // Ensure 'this.isPlaying' is used if 'playing' is not in scope
  }

  // Called by SineTool.tsx to update individual dot's sound properties
  public updateAudioForDot(index: number, yNormal: number, xNormal: number, isInitialSetup: boolean = false): void {
    if (index < 0 || index >= NUM_DOTS) return;
    
    // Ensure nodes exist, especially if update is called before play
    const dotNodes = this.ensureDotAudioNodes(index, xNormal, yNormal);
    if (!dotNodes) return; // Still couldn't create nodes (e.g. buffer issue)

    dotNodes.currentYNormal = yNormal;
    dotNodes.currentXNormal = xNormal;

    // 1. Update Panning
    dotNodes.panner.pan.value = (xNormal * 2) - 1;

    // 2. Update Slope
    const effectiveYNormalForSlope = 1 - yNormal; // Invert yNormal for intuitive slope mapping (top = brighter)
    let targetOverallSlopeDbPerOctave;
    if (effectiveYNormalForSlope < 0.5) {
      const t = effectiveYNormalForSlope * 2; // 0 to 1 for the lower half (now visually upper half)
      targetOverallSlopeDbPerOctave = LOW_SLOPE_DB_PER_OCT + t * (CENTER_SLOPE_DB_PER_OCT - LOW_SLOPE_DB_PER_OCT);
    } else {
      const t = (effectiveYNormalForSlope - 0.5) * 2; // 0 to 1 for the upper half (now visually lower half)
      targetOverallSlopeDbPerOctave = CENTER_SLOPE_DB_PER_OCT + t * (HIGH_SLOPE_DB_PER_OCT - CENTER_SLOPE_DB_PER_OCT);
    }
    dotNodes.slopedNoiseGenerator.setSlope(targetOverallSlopeDbPerOctave);

    // 3. Update Main Gain (incorporating base volume, distortion, and y-position based adjustments)
    const slopeDeviationForAttenuation = Math.abs(targetOverallSlopeDbPerOctave - CENTER_SLOPE_DB_PER_OCT);
    const existingAttenuationDb = -slopeDeviationForAttenuation * ATTENUATION_PER_DB_OCT_DEVIATION_DB;

    const extremityFactor = Math.abs(yNormal - 0.5) * 2; // 0 at center, 1 at extremes
    const curvedExtremityFactor = Math.sqrt(extremityFactor);
    const additionalSlopeBoostDb = curvedExtremityFactor * MAX_ADDITIONAL_BOOST_DB;

    const finalVolumeDb = this.currentBaseDbLevel + existingAttenuationDb + additionalSlopeBoostDb;
    const gainRatio = Math.pow(10, finalVolumeDb / 20);
    const effectiveMasterGain = MASTER_GAIN * this.currentDistortionGain * gainRatio;
    
    // Use setValueAtTime for smoother transitions, though for continuous it might not be critical
    dotNodes.mainGain.gain.setValueAtTime(effectiveMasterGain, this.ctx.currentTime);

    // If it's not initial setup and not playing, don't log too much
    if (!isInitialSetup && this.isPlaying) {
        // console.log(`🌊 Dot ${index}: yN=${yNormal.toFixed(2)}, xN=${xNormal.toFixed(2)}, slope=${targetOverallSlopeDbPerOctave.toFixed(1)}, gain=${effectiveMasterGain.toFixed(2)}`);
    }
  }
  
  public setVolumeDb(dbLevel: number): void {
    this.currentBaseDbLevel = dbLevel;
    // Re-calculate gain for all active dots if playing
    if (this.isPlaying) {
      this.audioDots.forEach((dotNodes, index) => {
        if (dotNodes) {
          this.updateAudioForDot(index, dotNodes.currentYNormal, dotNodes.currentXNormal);
        }
      });
    }
  }

  public setDistortionGain(gain: number): void {
    this.currentDistortionGain = Math.max(0, Math.min(1, gain));
    // Re-calculate gain for all active dots if playing
    if (this.isPlaying) {
      this.audioDots.forEach((dotNodes, index) => {
        if (dotNodes) {
          this.updateAudioForDot(index, dotNodes.currentYNormal, dotNodes.currentXNormal);
        }
      });
    }
    // console.log(`🌊 SineTool distortion gain set to ${this.currentDistortionGain.toFixed(2)}`);
  }
  
  // --- Analyzer Methods (standard pattern) ---
  public createPreEQAnalyser(): AnalyserNode {
    if (!this.preEQAnalyser) {
      this.preEQGain = this.ctx.createGain();
      this.preEQGain.gain.value = 1.0;

      this.preEQAnalyser = this.ctx.createAnalyser();
      this.preEQAnalyser.fftSize = FFT_SIZE;
      this.preEQAnalyser.smoothingTimeConstant = SMOOTHING;

      this.outputGain.connect(this.preEQGain); // Connect player's output to preEQGain
      this.preEQGain.connect(this.preEQAnalyser);
      
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode()); // Also connect to main EQ processor
    }
    return this.preEQAnalyser;
  }

  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser;
  }
  
  public getOutputNode(): GainNode {
      // This is the node that EQView would connect to its preEQGain/Analyzer setup
      // For SineTool, it's the outputGain of the SineToolAudioPlayer itself,
      // which already combines all dot sounds.
      return this.outputGain;
  }

  public dispose(): void {
    this.setPlaying(false); // Stop sounds and clear flags

    this.audioDots.forEach(dotNodes => {
      if (dotNodes) {
        try {
          dotNodes.source.stop();
        } catch(e) {/* ignore if already stopped */}
        dotNodes.source.disconnect();
        dotNodes.slopedNoiseGenerator.dispose();
        dotNodes.mainGain.disconnect();
        dotNodes.envelopeGain.disconnect();
        dotNodes.panner.disconnect();
      }
    });
    this.audioDots.fill(null); // Clear the array

    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
    }
    if (this.preEQAnalyser) {
      this.preEQAnalyser.disconnect(); // Analyser itself doesn't need disconnect from sources, but gain does
      this.preEQAnalyser = null;
    }
    this.outputGain.disconnect();
    // this.sharedPinkNoiseBuffer = null; // JS GC will handle
    
    console.log("🌊 SineToolAudioPlayer disposed");
    // Unsubscribe from store? If instance can be recreated, maybe not.
    // If it's a true singleton for app lifetime, subscription is fine.
  }
}

// Export a function to get the singleton instance
export function getSineToolAudioPlayer(): SineToolAudioPlayer {
  return SineToolAudioPlayer.getInstance();
}

// Export a cleanup function
export function cleanupSineToolAudioPlayer(): void {
  const player = SineToolAudioPlayer.getInstance();
  // Check if instance exists, as it might not if never accessed
  if (player && typeof player.dispose === 'function') {
    player.dispose();
    // @ts-ignore // Optional: allow re-creation by clearing static instance
    // SineToolAudioPlayer.instance = null; 
  }
}
