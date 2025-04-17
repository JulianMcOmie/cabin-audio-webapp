import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores/eqProfileStore';
import { NoiseSourceConfig } from '../calibration/AutoCalibration';

// Master gain specifically for calibration noise
const MASTER_GAIN = 0.5; // Relatively quiet constant noise

// Pulsing parameters (adjust as needed)
const PULSE_INTERVAL = 1.0; // seconds (total cycle time) - Default if not specified
const PULSE_ON_DURATION = 0.3; // seconds (how long the sound is at full volume, relative to period)
const PULSE_ATTACK_TIME = 0.05; // seconds (relative to period)
const PULSE_RELEASE_TIME = 0.1; // seconds (relative to period)

interface ActiveNoiseSource {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  mainGain: GainNode; // Renamed from gain
  pulseGain?: GainNode; // For the pulse envelope
  lfo?: OscillatorNode; // LFO for pulsing
  lfoShaper?: WaveShaperNode; // To shape LFO output into envelope
  lfoOffset?: ConstantSourceNode; // To make envelope 0-1
  group?: 'A' | 'B'; // Identifier for checkerboard group
}

class AutoCalibrationAudioPlayer {
  private static instance: AutoCalibrationAudioPlayer;
  private isPlaying: boolean = false;
  private activeNodes: ActiveNoiseSource[] = [];
  private distortionGain: number = 1.0;
  private groupFilter: 'A' | 'B' | 'All' = 'All'; // State for filtering

  private constructor() {
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

  public startNoiseSources(sources: NoiseSourceConfig[]): void {
    if (this.isPlaying) {
      this.stopNoiseSources();
    }

    const ctx = audioContext.getAudioContext();
    const eqInput = eqProcessor.getEQProcessor().getInputNode();
    const now = ctx.currentTime;

    this.activeNodes = sources.map(config => {
      // Generate a unique buffer for each source
      const bufferSize = ctx.sampleRate * 2; // 2 seconds (can adjust duration)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      // Pink noise generation logic (moved inside the loop)
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
      // Normalize the buffer (optional but good practice)
      let peak = 0;
      for (let i = 0; i < bufferSize; i++) {
          const abs = Math.abs(data[i]);
          if (abs > peak) peak = abs;
      }
      const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0; // Avoid clipping but don't boost too much
      for (let i = 0; i < bufferSize; i++) {
          data[i] *= normalizationFactor;
      }

      const source = ctx.createBufferSource();
      // Assign the newly generated unique buffer
      source.buffer = buffer;
      source.loop = true; // Loop this unique buffer

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = config.centerFrequency;
      filter.Q.value = config.bandwidth;

      const panner = ctx.createStereoPanner();
      panner.pan.value = config.position;

      // Main gain for overall level and distortion control
      const mainGain = ctx.createGain();
      mainGain.gain.value = MASTER_GAIN * this.distortionGain;

      const isPulsing = config.pulsing ?? false;
      const pulseDelay = config.pulseDelay ?? 0;
      const startTime = now + pulseDelay;

      let activeNode: ActiveNoiseSource = { source, filter, panner, mainGain };

      // --- Determine and store group based on pulse period --- 
      // Infer group based on the periods defined in AutoCalibration.ts
      // This assumes Group A = 1.0s, Group B = 0.5s
      const periodForGroupCheck = config.pulsePeriod ?? PULSE_INTERVAL; // Use default if undefined
      if (Math.abs(periodForGroupCheck - 1.0) < 0.01) { // Check for Group A period
         activeNode.group = 'A';
      } else if (Math.abs(periodForGroupCheck - 0.5) < 0.01) { // Check for Group B period
        activeNode.group = 'B';
      } else {
        // Optional: handle unexpected periods if necessary
        // console.warn(`Source with period ${periodForGroupCheck}s doesn't match standard group A/B periods.`);
      }
      // --- End Group Determination ---

      if (isPulsing) {
        // --- Pulsing Setup ---
        const pulseGain = ctx.createGain();
        pulseGain.gain.value = 0; // Start silent

        // Determine the period for this specific source
        const period = config.pulsePeriod ?? PULSE_INTERVAL;

        // LFO generates a sawtooth wave (-1 to 1) to control the timing
        const lfo = ctx.createOscillator();
        lfo.type = 'sawtooth';
        lfo.frequency.value = 1 / period; // Use the source-specific period

        // Use WaveShaper to create the envelope shape from the LFO
        const pulseCurve = new Float32Array(256);
        // Calculate durations relative to the source's specific period
        let attackSamples = Math.floor(pulseCurve.length * (PULSE_ATTACK_TIME / period));
        let onSamples = Math.floor(pulseCurve.length * (PULSE_ON_DURATION / period));
        let releaseSamples = Math.floor(pulseCurve.length * (PULSE_RELEASE_TIME / period));

        // Ensure total duration doesn't exceed the period length in samples
        const totalDurationSamples = attackSamples + onSamples + releaseSamples;
        if (totalDurationSamples > pulseCurve.length) {
          console.warn(`Pulse duration (${PULSE_ATTACK_TIME + PULSE_ON_DURATION + PULSE_RELEASE_TIME}s) exceeds period (${period}s) for source ${config.centerFrequency}Hz@${config.position}. Clamping envelope.`);
          // Simple clamping strategy: reduce 'on' time first
          const excess = totalDurationSamples - pulseCurve.length;
          onSamples = Math.max(0, onSamples - excess);
          // If still too long, might need more sophisticated scaling
        }

        for (let i = 0; i < pulseCurve.length; i++) {
            if (i < attackSamples) {
                // Attack ramp (linear)
                pulseCurve[i] = i / attackSamples;
            } else if (i < attackSamples + onSamples) {
                // Hold phase
                pulseCurve[i] = 1;
            } else if (i < attackSamples + onSamples + releaseSamples) {
                 // Release ramp (linear)
                pulseCurve[i] = 1 - ( (i - (attackSamples + onSamples)) / releaseSamples );
            } else {
                // Off phase
                pulseCurve[i] = 0;
            }
        }

        const lfoShaper = ctx.createWaveShaper();
        lfoShaper.curve = pulseCurve;
        lfoShaper.oversample = 'none'; // Or '2x'/'4x' if needed

        // Connect LFO -> Shaper -> pulseGain.gain Param
        lfo.connect(lfoShaper);
        lfoShaper.connect(pulseGain.gain);

        // Connect audio path: Source -> Filter -> Panner -> pulseGain -> mainGain -> EQ
        source.connect(filter);
        filter.connect(panner);
        panner.connect(pulseGain);
        pulseGain.connect(mainGain);
        mainGain.connect(eqInput);

        lfo.start(startTime); // Start LFO with the specified delay
        source.start(startTime); // Start audio source at the same time

        activeNode = { ...activeNode, pulseGain, lfo, lfoShaper };
        // --- End Pulsing Setup ---

      } else {
        // Non-pulsing: Connect directly to mainGain
        source.connect(filter);
        filter.connect(panner);
        panner.connect(mainGain);
        mainGain.connect(eqInput);
        source.start(now); // Start immediately if not pulsing (no delay needed)
      }

      return activeNode;
    });

    this.isPlaying = true;
    this.applyGroupFilter(); // Apply filter immediately after creating nodes
    console.log(`Auto-calibration started ${this.activeNodes.length} noise sources.`);
  }

  public stopNoiseSources(): void {
    if (!this.isPlaying) return;

    this.groupFilter = 'All'; // Reset filter on stop
    const now = audioContext.getAudioContext().currentTime;
    this.activeNodes.forEach(nodes => {
      try {
        nodes.source.stop(now + 0.1); // Stop smoothly
        nodes.source.disconnect();
        nodes.filter.disconnect();
        nodes.panner.disconnect();
        nodes.mainGain.disconnect(); // Disconnect mainGain

        // Stop and disconnect pulsing nodes if they exist
        if (nodes.lfo) {
          nodes.lfo.stop(now + 0.1);
          nodes.lfo.disconnect();
        }
        if (nodes.lfoShaper) {
            nodes.lfoShaper.disconnect();
        }
        if (nodes.pulseGain) {
          nodes.pulseGain.disconnect();
        }

      } catch (e) {
        // Ignore errors often caused by stopping already stopped nodes
        // console.warn("Error stopping calibration noise source:", e);
      }
    });

    this.activeNodes = [];
    this.isPlaying = false;
    console.log("Auto-calibration stopped noise sources.", "filter reset to 'All'.");
  }

  public setDistortionGain(gainValue: number): void {
    this.distortionGain = Math.max(0, Math.min(1, gainValue));
    if (this.isPlaying) {
      const now = audioContext.getAudioContext().currentTime;
      this.activeNodes.forEach(nodes => {
        // Only adjust the mainGain, not the pulseGain
        nodes.mainGain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain, now);
        // Re-apply filter immediately after distortion change
        this.applyGroupFilter();
      });
    }
  }

  public setGroupFilter(filter: 'A' | 'B' | 'All'): void {
    this.groupFilter = filter;
    if (this.isPlaying) {
      this.applyGroupFilter();
    }
    console.log(`Audio group filter set to: ${filter}`);
  }

  private applyGroupFilter(): void {
    if (!this.isPlaying) return;

    const now = audioContext.getAudioContext().currentTime;
    const rampTime = 0.05; // Short ramp to avoid clicks

    this.activeNodes.forEach(node => {
      const targetGain = MASTER_GAIN * this.distortionGain;
      let shouldBeAudible = true;

      if (this.groupFilter !== 'All') {
        if (node.group !== this.groupFilter) {
          shouldBeAudible = false;
        }
      }

      const finalGain = shouldBeAudible ? targetGain : 0.0001; // Use near-zero gain instead of 0
      node.mainGain.gain.linearRampToValueAtTime(finalGain, now + rampTime);
    });
  }

  public dispose(): void {
    this.stopNoiseSources();
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