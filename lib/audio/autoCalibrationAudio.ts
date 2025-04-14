import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores/eqProfileStore';
import { NoiseSourceConfig } from '../calibration/AutoCalibration';

// Master gain specifically for calibration noise
const MASTER_GAIN = 0.5; // Relatively quiet constant noise

interface ActiveNoiseSource {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

class AutoCalibrationAudioPlayer {
  private static instance: AutoCalibrationAudioPlayer;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private activeNodes: ActiveNoiseSource[] = [];
  private distortionGain: number = 1.0;

  private constructor() {
    this.generatePinkNoiseBuffer();

    // Apply initial distortion gain from store
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.setDistortionGain(initialDistortionGain);

    // Subscribe to distortion gain changes
    useEQProfileStore.subscribe(
      (state) => {
        this.setDistortionGain(state.distortionGain);
      }
    );
  }

  public static getInstance(): AutoCalibrationAudioPlayer {
    if (!AutoCalibrationAudioPlayer.instance) {
      AutoCalibrationAudioPlayer.instance = new AutoCalibrationAudioPlayer();
    }
    return AutoCalibrationAudioPlayer.instance;
  }

  private async generatePinkNoiseBuffer(): Promise<void> {
    // Reusing the pink noise generation logic (consider extracting to a common utility)
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
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
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6) * 0.11;
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

    this.pinkNoiseBuffer = buffer;
    console.log("Pink noise buffer generated for auto-calibration.");
  }

  public startNoiseSources(sources: NoiseSourceConfig[]): void {
    if (this.isPlaying) {
      this.stopNoiseSources(); // Stop existing sources before starting new ones
    }
    if (!this.pinkNoiseBuffer) {
      console.error("Pink noise buffer not ready for calibration audio.");
      return;
    }

    const ctx = audioContext.getAudioContext();
    const eqInput = eqProcessor.getEQProcessor().getInputNode();

    this.activeNodes = sources.map(config => {
      const source = ctx.createBufferSource();
      source.buffer = this.pinkNoiseBuffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = config.centerFrequency;
      filter.Q.value = config.bandwidth; // Assuming bandwidth directly maps to Q

      const panner = ctx.createStereoPanner();
      panner.pan.value = config.position;

      const gain = ctx.createGain();
      // Apply master gain and distortion gain
      gain.gain.value = MASTER_GAIN * this.distortionGain;

      // Connect chain: Source -> Filter -> Panner -> Gain -> EQ Input
      source.connect(filter);
      filter.connect(panner);
      panner.connect(gain);
      gain.connect(eqInput);

      source.start();

      return { source, filter, panner, gain };
    });

    this.isPlaying = true;
    console.log(`Auto-calibration started ${this.activeNodes.length} noise sources.`);
  }

  public stopNoiseSources(): void {
    if (!this.isPlaying) return;

    this.activeNodes.forEach(nodes => {
      try {
        nodes.source.stop();
        nodes.source.disconnect();
        nodes.filter.disconnect();
        nodes.panner.disconnect();
        nodes.gain.disconnect();
      } catch (e) {
        console.warn("Error stopping calibration noise source:", e);
      }
    });

    this.activeNodes = [];
    this.isPlaying = false;
    console.log("Auto-calibration stopped noise sources.");
  }

  public setDistortionGain(gainValue: number): void {
    this.distortionGain = Math.max(0, Math.min(1, gainValue));
    // Update gain of active nodes if playing
    if (this.isPlaying) {
      const now = audioContext.getAudioContext().currentTime;
      this.activeNodes.forEach(nodes => {
        nodes.gain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain, now);
      });
    }
  }

  public dispose(): void {
    this.stopNoiseSources();
    this.pinkNoiseBuffer = null;
    // Unsubscribe? Currently no mechanism in store for specific unsub
    console.log("AutoCalibrationAudioPlayer disposed.");
  }
}

/**
 * Get the singleton instance of the AutoCalibrationAudioPlayer
 */
export function getAutoCalibrationAudioPlayer(): AutoCalibrationAudioPlayer {
  return AutoCalibrationAudioPlayer.getInstance();
}

/**
 * Clean up the auto calibration audio player
 */
export function cleanupAutoCalibrationAudioPlayer(): void {
  const player = AutoCalibrationAudioPlayer.getInstance();
  player.dispose();
} 