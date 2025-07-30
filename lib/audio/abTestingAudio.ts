import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import * as audioRouting from './audioRouting';
import { useEQProfileStore } from '../stores';
import { EQBand } from '../models/EQBand';

// Constants based on dotGridAudio values but separate for A/B testing
const AB_ATTACK_S = 0.3; // Twice as slow as original 0.15s
const AB_RELEASE_S = 0.5; // Based on GLOBAL_STAGGER_RELEASE_S  
const AB_REPETITION_INTERVAL_S = 1.0; // Longer than envelope duration (0.3 + 0.5 = 0.8s)
const AB_REPETITIONS = 4; // Number of times each sound repeats
const AB_OVERLAP_S = 0.0; // No overlap between A and B transitions

// Volume and gain settings
const AB_MASTER_GAIN = 3.0; // Master gain for A/B testing
const AB_ENVELOPE_MIN_GAIN = 0.0;
const AB_ENVELOPE_MAX_GAIN = 1.0;

// A/B EQ settings
const AB_EQ_FREQUENCY = 6000; // 6kHz
const AB_EQ_Q = 10; // Sharp Q for noticeable difference
const AB_EQ_GAIN_A = 8; // +8dB boost for Sound A
const AB_EQ_GAIN_B = -8; // -8dB cut for Sound B
const AB_EQ_BAND_ID = 'ab-test-6khz';

interface ABSoundNodes {
  source: AudioBufferSourceNode;
  mainGain: GainNode;
  envelopeGain: GainNode;
  pinkNoiseBuffer: AudioBuffer;
}

class ABTestingAudioPlayer {
  private static instance: ABTestingAudioPlayer;
  private ctx: AudioContext;
  private outputGain: GainNode;
  private isPlaying: boolean = false;
  private currentDistortionGain: number = 1.0;
  
  // Audio nodes for sounds A and B
  private soundA: ABSoundNodes | null = null;
  private soundB: ABSoundNodes | null = null;
  
  // Playback state
  private currentCycle: 'A' | 'B' = 'A';
  private currentRepetition: number = 0;
  private cycleTimeoutId: number | null = null;
  private isInitialized: boolean = false;

  private constructor() {
    console.log('🎵 [AB Test] Creating AB Testing Audio Player...');
    this.ctx = audioContext.getAudioContext();
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1.0;
    console.log('🎵 [AB Test] Created output gain node with gain: 1.0');
    
    // Connect to EQ processor for full processing chain and analyzer access
    const eq = eqProcessor.getEQProcessor();
    const eqInput = eq.getInputNode();
    this.outputGain.connect(eqInput);
    console.log('🎵 [AB Test] Connected output gain to EQ processor input');
    console.log('🎵 [AB Test] Full chain: AB Test Output -> EQ Input -> EQ Output -> Analyser -> Speakers');
    
    // Subscribe to distortion changes
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.currentDistortionGain = initialDistortionGain;
    console.log(`🎵 [AB Test] Initial distortion gain: ${initialDistortionGain}`);
    
    useEQProfileStore.subscribe((state) => {
      this.currentDistortionGain = state.distortionGain;
      console.log(`🎵 [AB Test] Distortion gain updated: ${state.distortionGain}`);
    });
  }

  public static getInstance(): ABTestingAudioPlayer {
    if (!ABTestingAudioPlayer.instance) {
      ABTestingAudioPlayer.instance = new ABTestingAudioPlayer();
    }
    return ABTestingAudioPlayer.instance;
  }

  private generatePinkNoiseBuffer(): AudioBuffer {
    console.log('🎵 [AB Test] Generating pink noise buffer...');
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Pink noise generation using Paul Kellet's refined method (from dotGridAudio)
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
    
    console.log(`🎵 [AB Test] Pink noise buffer generated: ${bufferSize} samples, peak: ${peak.toFixed(4)}, normalization: ${normalizationFactor.toFixed(4)}`);
    return buffer;
  }

  private createSoundNodes(): ABSoundNodes {
    console.log('🎵 [AB Test] Creating sound nodes...');
    const mainGain = this.ctx.createGain();
    const envelopeGain = this.ctx.createGain();
    envelopeGain.gain.value = AB_ENVELOPE_MIN_GAIN;
    
    const pinkNoiseBuffer = this.generatePinkNoiseBuffer();
    const source = this.ctx.createBufferSource();
    source.buffer = pinkNoiseBuffer;
    source.loop = true;
    
    // Connect: source -> mainGain -> envelopeGain -> outputGain
    source.connect(mainGain);
    mainGain.connect(envelopeGain);
    envelopeGain.connect(this.outputGain);
    
    // Set main gain
    const effectiveGain = AB_MASTER_GAIN * this.currentDistortionGain;
    mainGain.gain.setValueAtTime(effectiveGain, this.ctx.currentTime);
    
    console.log(`🎵 [AB Test] Sound nodes created - Main gain: ${effectiveGain.toFixed(3)}, Envelope gain: ${AB_ENVELOPE_MIN_GAIN}`);
    console.log('🎵 [AB Test] Connection chain: source -> mainGain -> envelopeGain -> outputGain -> EQ');
    
    source.start();
    console.log('🎵 [AB Test] Source started');
    
    // DEBUGGING: Test connection through full EQ chain
    const testGain = this.ctx.createGain();
    testGain.gain.value = 0.1; // Low volume for safety
    const eq = eqProcessor.getEQProcessor();
    const analyser = audioRouting.getAudioRouting().getAnalyserNode();
    if (analyser) {
      this.outputGain.connect(eq.getInputNode());
      eq.getOutputNode().connect(testGain);
      testGain.connect(analyser);
      // Analyser is already connected to destination via audioRouting
      console.log('🎵 [AB Test] DEBUGGING: Connected through full EQ chain to analyser to speakers at low volume');
    } else {
      this.outputGain.connect(eq.getInputNode());
      eq.getOutputNode().connect(testGain);
      testGain.connect(this.ctx.destination);
      console.log('🎵 [AB Test] DEBUGGING: Connected through full EQ chain directly to speakers at low volume (no analyser)');
    }
    
    return {
      source,
      mainGain,
      envelopeGain,
      pinkNoiseBuffer
    };
  }

  public initialize(): void {
    console.log('🎵 [AB Test] Initializing AB Testing Audio Player...');
    if (this.isInitialized) {
      console.log('🎵 [AB Test] Already initialized, cleaning up first');
      this.cleanup();
    }
    
    console.log('🎵 [AB Test] Creating sound A nodes...');
    this.soundA = this.createSoundNodes();
    console.log('🎵 [AB Test] Creating sound B nodes...');
    this.soundB = this.createSoundNodes();
    this.isInitialized = true;
    console.log('🎵 [AB Test] Initialization complete');
  }

  private scheduleEnvelope(nodes: ABSoundNodes, scheduledTime: number): void {
    const gainParam = nodes.envelopeGain.gain;
    gainParam.cancelScheduledValues(scheduledTime);
    
    // Start just above zero for exponential curves
    gainParam.setValueAtTime(0.001, scheduledTime);
    
    // Attack
    const peakGain = AB_ENVELOPE_MAX_GAIN * 0.8;
    gainParam.exponentialRampToValueAtTime(
      peakGain,
      scheduledTime + AB_ATTACK_S
    );
    
    // Release
    gainParam.exponentialRampToValueAtTime(
      0.001,
      scheduledTime + AB_ATTACK_S + AB_RELEASE_S
    );
    
    // Ensure silence after release
    gainParam.setValueAtTime(
      AB_ENVELOPE_MIN_GAIN, 
      scheduledTime + AB_ATTACK_S + AB_RELEASE_S + 0.001
    );
    
    console.log(`🎵 [AB Test] Envelope scheduled: time=${scheduledTime.toFixed(3)}, peak=${peakGain.toFixed(3)}, attack=${AB_ATTACK_S}s, release=${AB_RELEASE_S}s`);
  }

  private scheduleNextPlayback(): void {
    if (!this.isPlaying || !this.soundA || !this.soundB) {
      console.log('🎵 [AB Test] Cannot schedule playback - not playing or nodes missing');
      return;
    }

    const currentTime = this.ctx.currentTime;
    const currentNodes = this.currentCycle === 'A' ? this.soundA : this.soundB;
    
    console.log(`🎵 [AB Test] Scheduling ${this.currentCycle} repetition ${this.currentRepetition + 1}/${AB_REPETITIONS}`);
    
    // Update EQ for current sound
    this.updateEQForCurrentSound();
    
    // Schedule this repetition
    this.scheduleEnvelope(currentNodes, currentTime);
    
    this.currentRepetition++;
    
    if (this.currentRepetition >= AB_REPETITIONS) {
      // Switch to other sound after brief overlap
      this.currentCycle = this.currentCycle === 'A' ? 'B' : 'A';
      this.currentRepetition = 0;
      
      console.log(`🎵 [AB Test] Switching to sound ${this.currentCycle} after ${AB_REPETITIONS} repetitions`);
      
      // Schedule next cycle with overlap
      const nextCycleDelay = (AB_REPETITION_INTERVAL_S - AB_OVERLAP_S) * 1000;
      this.cycleTimeoutId = window.setTimeout(() => {
        this.scheduleNextPlayback();
      }, nextCycleDelay);
    } else {
      // Continue with same sound
      const nextRepetitionDelay = AB_REPETITION_INTERVAL_S * 1000;
      this.cycleTimeoutId = window.setTimeout(() => {
        this.scheduleNextPlayback();
      }, nextRepetitionDelay);
    }
  }

  public async setPlaying(playing: boolean): Promise<void> {
    console.log(`🎵 [AB Test] setPlaying(${playing}) - current state: ${this.isPlaying}`);
    console.log(`🎵 [AB Test] AudioContext state: ${this.ctx.state}`);
    
    if (playing === this.isPlaying) return;
    
    // CRITICAL: Resume audio context if suspended (browser policy)
    if (this.ctx.state === 'suspended') {
      console.log('🎵 [AB Test] AudioContext is suspended, resuming...');
      try {
        await this.ctx.resume();
        console.log(`🎵 [AB Test] AudioContext resumed, new state: ${this.ctx.state}`);
      } catch (error) {
        console.error('🎵 [AB Test] Failed to resume AudioContext:', error);
        return;
      }
    }
    
    if (!this.isInitialized) {
      console.log('🎵 [AB Test] Not initialized, calling initialize()');
      this.initialize();
    }
    
    this.isPlaying = playing;
    
    if (playing) {
      console.log('🎵 [AB Test] Starting playback - resetting to sound A');
      this.currentCycle = 'A';
      this.currentRepetition = 0;
      this.scheduleNextPlayback();
    } else {
      console.log('🎵 [AB Test] Stopping playback');
      if (this.cycleTimeoutId !== null) {
        clearTimeout(this.cycleTimeoutId);
        this.cycleTimeoutId = null;
      }
      
      // Remove A/B EQ band when stopping
      this.removeABEQBand();
      
      // Fade out current sounds
      if (this.soundA) {
        const gainParam = this.soundA.envelopeGain.gain;
        const currentTime = this.ctx.currentTime;
        gainParam.cancelScheduledValues(currentTime);
        const currentGain = Math.max(0.001, gainParam.value);
        gainParam.setValueAtTime(currentGain, currentTime);
        gainParam.exponentialRampToValueAtTime(0.001, currentTime + 0.01);
        console.log('🎵 [AB Test] Fading out sound A');
      }
      
      if (this.soundB) {
        const gainParam = this.soundB.envelopeGain.gain;
        const currentTime = this.ctx.currentTime;
        gainParam.cancelScheduledValues(currentTime);
        const currentGain = Math.max(0.001, gainParam.value);
        gainParam.setValueAtTime(currentGain, currentTime);
        gainParam.exponentialRampToValueAtTime(0.001, currentTime + 0.01);
        console.log('🎵 [AB Test] Fading out sound B');
      }
    }
  }

  public getCurrentlyPlaying(): 'A' | 'B' | 'none' {
    if (!this.isPlaying) return 'none';
    return this.currentCycle;
  }

  public getAnalyzerNode(): AnalyserNode | null {
    const routing = audioRouting.getAudioRouting();
    return routing.getAnalyserNode();
  }

  private updateEQForCurrentSound(): void {
    const eq = eqProcessor.getEQProcessor();
    const gain = this.currentCycle === 'A' ? AB_EQ_GAIN_A : AB_EQ_GAIN_B;
    
    const eqBand: EQBand = {
      id: AB_EQ_BAND_ID,
      frequency: AB_EQ_FREQUENCY,
      gain: gain,
      q: AB_EQ_Q,
      type: 'peaking'
    };
    
    console.log(`🎛️ [AB Test] Setting EQ for Sound ${this.currentCycle}: ${gain > 0 ? '+' : ''}${gain}dB at ${AB_EQ_FREQUENCY}Hz, Q=${AB_EQ_Q}`);
    
    // Update the EQ band using the existing API
    eq.updateBand(eqBand);
  }

  private removeABEQBand(): void {
    const eq = eqProcessor.getEQProcessor();
    console.log(`🎛️ [AB Test] Removing A/B EQ band at ${AB_EQ_FREQUENCY}Hz`);
    eq.removeBandByFrequency(AB_EQ_FREQUENCY);
  }

  private cleanup(): void {
    if (this.cycleTimeoutId !== null) {
      clearTimeout(this.cycleTimeoutId);
      this.cycleTimeoutId = null;
    }
    
    if (this.soundA) {
      try { this.soundA.source.stop(); } catch {}
      this.soundA.source.disconnect();
      this.soundA.mainGain.disconnect();
      this.soundA.envelopeGain.disconnect();
      this.soundA = null;
    }
    
    if (this.soundB) {
      try { this.soundB.source.stop(); } catch {}
      this.soundB.source.disconnect();
      this.soundB.mainGain.disconnect();
      this.soundB.envelopeGain.disconnect();
      this.soundB = null;
    }
    
    this.isInitialized = false;
  }

  public dispose(): void {
    this.setPlaying(false);
    this.cleanup();
    this.outputGain.disconnect();
  }
}

export function getABTestingAudioPlayer(): ABTestingAudioPlayer {
  return ABTestingAudioPlayer.getInstance();
}

export function cleanupABTestingAudioPlayer(): void {
  const player = ABTestingAudioPlayer.getInstance();
  player.dispose();
}