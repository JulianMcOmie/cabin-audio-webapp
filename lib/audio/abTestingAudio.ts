import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores';

// Constants based on dotGridAudio values but separate for A/B testing
const AB_ATTACK_S = 0.15; // Based on GLOBAL_STAGGER_ATTACK_S
const AB_RELEASE_S = 0.5; // Based on GLOBAL_STAGGER_RELEASE_S  
const AB_REPETITION_INTERVAL_S = 0.2; // Based on DOT_REPETITION_INTERVAL_S
const AB_REPETITIONS = 4; // Number of times each sound repeats
const AB_OVERLAP_S = 0.1; // Brief overlap between A and B transitions

// Volume and gain settings
const AB_MASTER_GAIN = 3.0; // Master gain for A/B testing
const AB_ENVELOPE_MIN_GAIN = 0.0;
const AB_ENVELOPE_MAX_GAIN = 1.0;

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
    this.ctx = audioContext.getAudioContext();
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1.0;
    
    // Connect to EQ processor
    const eq = eqProcessor.getEQProcessor();
    this.outputGain.connect(eq.getInputNode());
    
    // Subscribe to distortion changes
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.currentDistortionGain = initialDistortionGain;
    
    useEQProfileStore.subscribe((state) => {
      this.currentDistortionGain = state.distortionGain;
    });
  }

  public static getInstance(): ABTestingAudioPlayer {
    if (!ABTestingAudioPlayer.instance) {
      ABTestingAudioPlayer.instance = new ABTestingAudioPlayer();
    }
    return ABTestingAudioPlayer.instance;
  }

  private generatePinkNoiseBuffer(): AudioBuffer {
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
    
    return buffer;
  }

  private createSoundNodes(): ABSoundNodes {
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
    
    source.start();
    
    return {
      source,
      mainGain,
      envelopeGain,
      pinkNoiseBuffer
    };
  }

  public initialize(): void {
    if (this.isInitialized) {
      this.cleanup();
    }
    
    this.soundA = this.createSoundNodes();
    this.soundB = this.createSoundNodes();
    this.isInitialized = true;
  }

  private scheduleEnvelope(nodes: ABSoundNodes, scheduledTime: number): void {
    const gainParam = nodes.envelopeGain.gain;
    gainParam.cancelScheduledValues(scheduledTime);
    
    // Start just above zero for exponential curves
    gainParam.setValueAtTime(0.001, scheduledTime);
    
    // Attack
    gainParam.exponentialRampToValueAtTime(
      AB_ENVELOPE_MAX_GAIN * 0.8,
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
  }

  private scheduleNextPlayback(): void {
    if (!this.isPlaying || !this.soundA || !this.soundB) {
      return;
    }

    const currentTime = this.ctx.currentTime;
    const currentNodes = this.currentCycle === 'A' ? this.soundA : this.soundB;
    
    // Schedule this repetition
    this.scheduleEnvelope(currentNodes, currentTime);
    
    this.currentRepetition++;
    
    if (this.currentRepetition >= AB_REPETITIONS) {
      // Switch to other sound after brief overlap
      this.currentCycle = this.currentCycle === 'A' ? 'B' : 'A';
      this.currentRepetition = 0;
      
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

  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    if (!this.isInitialized) {
      this.initialize();
    }
    
    this.isPlaying = playing;
    
    if (playing) {
      this.currentCycle = 'A';
      this.currentRepetition = 0;
      this.scheduleNextPlayback();
    } else {
      if (this.cycleTimeoutId !== null) {
        clearTimeout(this.cycleTimeoutId);
        this.cycleTimeoutId = null;
      }
      
      // Fade out current sounds
      if (this.soundA) {
        const gainParam = this.soundA.envelopeGain.gain;
        const currentTime = this.ctx.currentTime;
        gainParam.cancelScheduledValues(currentTime);
        const currentGain = Math.max(0.001, gainParam.value);
        gainParam.setValueAtTime(currentGain, currentTime);
        gainParam.exponentialRampToValueAtTime(0.001, currentTime + 0.01);
      }
      
      if (this.soundB) {
        const gainParam = this.soundB.envelopeGain.gain;
        const currentTime = this.ctx.currentTime;
        gainParam.cancelScheduledValues(currentTime);
        const currentGain = Math.max(0.001, gainParam.value);
        gainParam.setValueAtTime(currentGain, currentTime);
        gainParam.exponentialRampToValueAtTime(0.001, currentTime + 0.01);
      }
    }
  }

  public getCurrentlyPlaying(): 'A' | 'B' | 'none' {
    if (!this.isPlaying) return 'none';
    return this.currentCycle;
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