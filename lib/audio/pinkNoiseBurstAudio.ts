import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import * as audioRouting from './audioRouting';
import { useEQProfileStore } from '../stores';

// Constants for burst pattern
const BURST_DURATION_S = 0.5; // Duration of each pink noise burst
const BURST_INTERVAL_S = 1.5; // Time between burst starts (includes silence)
const ATTACK_S = 0.05; // Quick attack for burst start
const RELEASE_S = 0.1; // Quick release for burst end

// Volume and gain settings
const MASTER_GAIN = 2.0; // Master gain for pink noise bursts
const ENVELOPE_MIN_GAIN = 0.0;
const ENVELOPE_MAX_GAIN = 1.0;

// Peak filter settings
const PEAK_FILTER_Q = 3.0; // Q = 3.0 as specified
const PEAK_FILTER_GAIN = -18; // -18dB magnitude as specified
const MIN_FILTER_FREQ = 1000; // 1kHz minimum
const MAX_FILTER_FREQ = 20000; // 20kHz maximum

interface PinkNoiseBurstNodes {
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  envelopeGain: GainNode;
  filter1: BiquadFilterNode;
  filter2: BiquadFilterNode;
  pinkNoiseBuffer: AudioBuffer;
}

class PinkNoiseBurstAudioPlayer {
  private static instance: PinkNoiseBurstAudioPlayer;
  private ctx: AudioContext;
  private outputGain: GainNode;
  private isPlaying: boolean = false;
  private currentDistortionGain: number = 1.0;
  
  // Filter frequency settings
  private filter1Frequency: number = 2000; // Default 2kHz
  private filter2Frequency: number = 8000; // Default 8kHz
  
  // Audio nodes
  private audioNodes: PinkNoiseBurstNodes | null = null;
  
  // Burst timing
  private burstTimeoutId: number | null = null;
  private isInitialized: boolean = false;

  private constructor() {
    console.log('🎵 [Pink Burst] Creating Pink Noise Burst Audio Player...');
    this.ctx = audioContext.getAudioContext();
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1.0;
    console.log('🎵 [Pink Burst] Created output gain node with gain: 1.0');
    
    // Connect to EQ processor for full processing chain and analyzer access
    const eq = eqProcessor.getEQProcessor();
    const eqInput = eq.getInputNode();
    this.outputGain.connect(eqInput);
    console.log('🎵 [Pink Burst] Connected output gain to EQ processor input');
    
    // Subscribe to distortion changes
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.currentDistortionGain = initialDistortionGain;
    console.log(`🎵 [Pink Burst] Initial distortion gain: ${initialDistortionGain}`);
    
    useEQProfileStore.subscribe((state) => {
      this.currentDistortionGain = state.distortionGain;
      console.log(`🎵 [Pink Burst] Distortion gain updated: ${state.distortionGain}`);
    });
  }

  public static getInstance(): PinkNoiseBurstAudioPlayer {
    if (!PinkNoiseBurstAudioPlayer.instance) {
      PinkNoiseBurstAudioPlayer.instance = new PinkNoiseBurstAudioPlayer();
    }
    return PinkNoiseBurstAudioPlayer.instance;
  }

  private generatePinkNoiseBuffer(): AudioBuffer {
    console.log('🎵 [Pink Burst] Generating pink noise buffer...');
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Pink noise generation using Paul Kellet's refined method
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

    // Normalize to prevent clipping
    let peak = 0;
    for (let i = 0; i < bufferSize; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor;
    }
    
    console.log(`🎵 [Pink Burst] Pink noise buffer generated: ${bufferSize} samples, peak: ${peak.toFixed(4)}, normalization: ${normalizationFactor.toFixed(4)}`);
    return buffer;
  }

  private createAudioNodes(): PinkNoiseBurstNodes {
    console.log('🎵 [Pink Burst] Creating audio nodes...');
    const mainGain = this.ctx.createGain();
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MIN_GAIN;
    
    // Create peak filters
    const filter1 = this.ctx.createBiquadFilter();
    filter1.type = 'peaking';
    filter1.frequency.value = this.filter1Frequency;
    filter1.Q.value = PEAK_FILTER_Q;
    filter1.gain.value = PEAK_FILTER_GAIN;
    
    const filter2 = this.ctx.createBiquadFilter();
    filter2.type = 'peaking';
    filter2.frequency.value = this.filter2Frequency;
    filter2.Q.value = PEAK_FILTER_Q;
    filter2.gain.value = PEAK_FILTER_GAIN;
    
    const pinkNoiseBuffer = this.generatePinkNoiseBuffer();
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;
    
    // Connect: source -> mainGain -> envelopeGain -> filter1 -> filter2 -> outputGain
    source.connect(mainGain);
    mainGain.connect(envelopeGain);
    envelopeGain.connect(filter1);
    filter1.connect(filter2);
    filter2.connect(this.outputGain);
    
    // Set main gain
    const effectiveGain = MASTER_GAIN * this.currentDistortionGain;
    mainGain.gain.setValueAtTime(effectiveGain, this.ctx.currentTime);
    
    console.log(`🎵 [Pink Burst] Audio nodes created - Main gain: ${effectiveGain.toFixed(3)}, Filter1: ${this.filter1Frequency}Hz, Filter2: ${this.filter2Frequency}Hz`);
    console.log('🎵 [Pink Burst] Connection chain: source -> mainGain -> envelopeGain -> filter1 -> filter2 -> outputGain -> EQ');
    
    source.start();
    console.log('🎵 [Pink Burst] Source started');
    
    return {
      source,
      mainGain,
      envelopeGain,
      filter1,
      filter2,
      pinkNoiseBuffer
    };
  }

  public initialize(): void {
    console.log('🎵 [Pink Burst] Initializing Pink Noise Burst Audio Player...');
    if (this.isInitialized) {
      console.log('🎵 [Pink Burst] Already initialized, cleaning up first');
      this.cleanup();
    }
    
    console.log('🎵 [Pink Burst] Creating audio nodes...');
    this.audioNodes = this.createAudioNodes();
    this.isInitialized = true;
    console.log('🎵 [Pink Burst] Initialization complete');
  }

  private scheduleBurstEnvelope(scheduledTime: number): void {
    if (!this.audioNodes) return;
    
    const gainParam = this.audioNodes.envelopeGain.gain;
    gainParam.cancelScheduledValues(scheduledTime);
    
    // Start just above zero for exponential curves
    gainParam.setValueAtTime(0.001, scheduledTime);
    
    // Attack
    const peakGain = ENVELOPE_MAX_GAIN * 0.8;
    gainParam.exponentialRampToValueAtTime(
      peakGain,
      scheduledTime + ATTACK_S
    );
    
    // Sustain for burst duration
    gainParam.setValueAtTime(
      peakGain,
      scheduledTime + BURST_DURATION_S - RELEASE_S
    );
    
    // Release
    gainParam.exponentialRampToValueAtTime(
      0.001,
      scheduledTime + BURST_DURATION_S
    );
    
    // Ensure silence after release
    gainParam.setValueAtTime(
      ENVELOPE_MIN_GAIN, 
      scheduledTime + BURST_DURATION_S + 0.001
    );
    
    console.log(`🎵 [Pink Burst] Burst envelope scheduled: time=${scheduledTime.toFixed(3)}, duration=${BURST_DURATION_S}s, peak=${peakGain.toFixed(3)}`);
  }

  private scheduleNextBurst(): void {
    if (!this.isPlaying || !this.audioNodes) {
      console.log('🎵 [Pink Burst] Cannot schedule burst - not playing or nodes missing');
      return;
    }

    const currentTime = this.ctx.currentTime;
    
    console.log(`🎵 [Pink Burst] Scheduling burst at time ${currentTime.toFixed(3)}`);
    
    // Schedule this burst
    this.scheduleBurstEnvelope(currentTime);
    
    // Schedule the next burst
    this.burstTimeoutId = window.setTimeout(() => {
      this.scheduleNextBurst();
    }, BURST_INTERVAL_S * 1000);
  }

  public async setPlaying(playing: boolean): Promise<void> {
    console.log(`🎵 [Pink Burst] setPlaying(${playing}) - current state: ${this.isPlaying}`);
    console.log(`🎵 [Pink Burst] AudioContext state: ${this.ctx.state}`);
    
    if (playing === this.isPlaying) return;
    
    // Resume audio context if suspended
    if (this.ctx.state === 'suspended') {
      console.log('🎵 [Pink Burst] AudioContext is suspended, resuming...');
      try {
        await this.ctx.resume();
        console.log(`🎵 [Pink Burst] AudioContext resumed, new state: ${this.ctx.state}`);
      } catch (error) {
        console.error('🎵 [Pink Burst] Failed to resume AudioContext:', error);
        return;
      }
    }
    
    if (!this.isInitialized) {
      console.log('🎵 [Pink Burst] Not initialized, calling initialize()');
      this.initialize();
    }
    
    this.isPlaying = playing;
    
    if (playing) {
      console.log('🎵 [Pink Burst] Starting burst playback');
      this.scheduleNextBurst();
    } else {
      console.log('🎵 [Pink Burst] Stopping burst playback');
      if (this.burstTimeoutId !== null) {
        clearTimeout(this.burstTimeoutId);
        this.burstTimeoutId = null;
      }
      
      // Fade out current burst
      if (this.audioNodes) {
        const gainParam = this.audioNodes.envelopeGain.gain;
        const currentTime = this.ctx.currentTime;
        gainParam.cancelScheduledValues(currentTime);
        const currentGain = Math.max(0.001, gainParam.value);
        gainParam.setValueAtTime(currentGain, currentTime);
        gainParam.exponentialRampToValueAtTime(0.001, currentTime + 0.01);
        console.log('🎵 [Pink Burst] Fading out current burst');
      }
    }
  }

  public getAnalyzerNode(): AnalyserNode | null {
    const routing = audioRouting.getAudioRouting();
    return routing.getAnalyserNode();
  }

  public setFilterFrequencies(filter1Freq: number, filter2Freq: number): void {
    this.filter1Frequency = Math.max(MIN_FILTER_FREQ, Math.min(MAX_FILTER_FREQ, filter1Freq));
    this.filter2Frequency = Math.max(MIN_FILTER_FREQ, Math.min(MAX_FILTER_FREQ, filter2Freq));
    
    console.log(`🎛️ [Pink Burst] Updated filter frequencies - Filter1: ${this.filter1Frequency}Hz, Filter2: ${this.filter2Frequency}Hz`);
    
    // Update filter frequencies if audio nodes exist
    if (this.audioNodes) {
      this.audioNodes.filter1.frequency.setValueAtTime(this.filter1Frequency, this.ctx.currentTime);
      this.audioNodes.filter2.frequency.setValueAtTime(this.filter2Frequency, this.ctx.currentTime);
    }
  }

  public getFilterFrequencies(): { filter1: number; filter2: number } {
    return {
      filter1: this.filter1Frequency,
      filter2: this.filter2Frequency
    };
  }

  private cleanup(): void {
    if (this.burstTimeoutId !== null) {
      clearTimeout(this.burstTimeoutId);
      this.burstTimeoutId = null;
    }
    
    if (this.audioNodes) {
      try { this.audioNodes.source.stop(); } catch {}
      this.audioNodes.source.disconnect();
      this.audioNodes.mainGain.disconnect();
      this.audioNodes.envelopeGain.disconnect();
      this.audioNodes.filter1.disconnect();
      this.audioNodes.filter2.disconnect();
      this.audioNodes = null;
    }
    
    this.isInitialized = false;
  }

  public dispose(): void {
    this.setPlaying(false);
    this.cleanup();
    this.outputGain.disconnect();
  }
}

export function getPinkNoiseBurstAudioPlayer(): PinkNoiseBurstAudioPlayer {
  return PinkNoiseBurstAudioPlayer.getInstance();
}

export function cleanupPinkNoiseBurstAudioPlayer(): void {
  const player = PinkNoiseBurstAudioPlayer.getInstance();
  player.dispose();
}