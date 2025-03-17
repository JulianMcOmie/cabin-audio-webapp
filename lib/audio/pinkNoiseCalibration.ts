import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Constants
const MASTER_GAIN = 0.5; // Default gain level
const DEFAULT_PAN = 0; // Default pan position (center)
const DEFAULT_MIN_FREQ = 20; // Default minimum frequency for sweep (Hz)
const DEFAULT_MAX_FREQ = 20000; // Default maximum frequency for sweep (Hz)
const DEFAULT_PEAK_GAIN = 6; // Default peak filter gain in dB
const DEFAULT_PEAK_Q = 1.0; // Default peak filter Q factor
const MIN_PEAK_Q = 0.1; // Minimum Q value (widest bandwidth)
const MAX_PEAK_Q = 10.0; // Maximum Q value (narrowest bandwidth)
const DEFAULT_SWEEP_DURATION = 8.0; // Default duration of one full sweep cycle in seconds
const DEFAULT_PAN_DURATION = 6.0; // Default duration of one full pan cycle in seconds
const MIN_SWEEP_DURATION = 2.0; // Minimum sweep cycle duration (fastest)
const MAX_SWEEP_DURATION = 30.0; // Maximum sweep cycle duration (slowest)
const MIN_PAN_DURATION = 2.0; // Minimum pan cycle duration (fastest)
const MAX_PAN_DURATION = 20.0; // Maximum pan cycle duration (slowest)
const ABSOLUTE_MIN_FREQ = 20; // Absolute minimum frequency (Hz)
const ABSOLUTE_MAX_FREQ = 20000; // Absolute maximum frequency (Hz)

// Class to manage pink noise calibration
class PinkNoiseCalibrator {
  private static instance: PinkNoiseCalibrator;
  private isPlaying: boolean = false;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private panValue: number = DEFAULT_PAN; // Current pan value (-1 to 1)
  private isPanning: boolean = false; // Whether auto-panning is active
  private panDuration: number = DEFAULT_PAN_DURATION; // Duration of pan cycle in seconds
  private isSweeping: boolean = false; // Whether frequency sweep is active
  private peakGain: number = DEFAULT_PEAK_GAIN; // Peak filter gain in dB
  private peakQ: number = DEFAULT_PEAK_Q; // Peak filter Q factor
  private sweepDuration: number = DEFAULT_SWEEP_DURATION; // Duration of sweep cycle in seconds
  private minSweepFreq: number = DEFAULT_MIN_FREQ; // Minimum frequency for sweep (Hz)
  private maxSweepFreq: number = DEFAULT_MAX_FREQ; // Maximum frequency for sweep (Hz)
  private sweepLFO: OscillatorNode | null = null; // LFO for frequency sweep
  private sweepTimeoutId: number | null = null; // To track and clear sweep timeout
  private panTimeoutId: number | null = null; // To track and clear pan timeout
  
  private audioNodes: {
    source: AudioBufferSourceNode | null;
    peakFilter: BiquadFilterNode | null;
    panner: StereoPannerNode | null;
    gain: GainNode | null;
  } = {
    source: null,
    peakFilter: null,
    panner: null,
    gain: null
  };
  
  private preEQGain: GainNode | null = null;
  private preEQAnalyser: AnalyserNode | null = null;

  private constructor() {
    // Generate pink noise buffer on initialization
    this.generatePinkNoiseBuffer();
  }

  public static getInstance(): PinkNoiseCalibrator {
    if (!PinkNoiseCalibrator.instance) {
      PinkNoiseCalibrator.instance = new PinkNoiseCalibrator();
    }
    return PinkNoiseCalibrator.instance;
  }

  /**
   * Generate pink noise buffer
   */
  private async generatePinkNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Improved pink noise generation using Paul Kellet's refined method
    // This produces a true -3dB/octave spectrum characteristic of pink noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
      // Generate white noise sample
      const white = Math.random() * 2 - 1;
      
      // Pink noise filtering - refined coefficients for accurate spectral slope
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      b6 = white * 0.5362;
      
      // Combine with proper scaling to maintain pink noise characteristics
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6) * 0.11;
    }
    
    // Normalize to avoid clipping
    let peak = 0;
    for (let i = 0; i < bufferSize; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    
    const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
    for (let i = 0; i < bufferSize; i++) {
      data[i] *= normalizationFactor;
    }

    console.log(`🔊 Generated pink noise buffer: ${bufferSize} samples`);
    this.pinkNoiseBuffer = buffer;
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    console.log(`🔊 Setting pink noise calibration playing state: ${playing}`);
    
    this.isPlaying = playing;
    
    if (playing) {
      this.startPlayback();
    } else {
      this.stopPlayback();
    }
  }

  /**
   * Get the current playing state
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Set the pan position for audio
   * @param value Pan position from -1 (full left) to 1 (full right)
   */
  public setPan(value: number): void {
    // Ensure value is within the valid range
    value = Math.max(-1, Math.min(1, value));
    
    if (value === this.panValue) return;
    
    console.log(`🔊 Setting pink noise calibration pan: ${value}`);
    
    this.panValue = value;
    
    // Update panner if playing
    if (this.isPlaying && this.audioNodes.panner) {
      this.audioNodes.panner.pan.setTargetAtTime(
        this.panValue,
        audioContext.getAudioContext().currentTime,
        0.05 // Time constant
      );
      
      // Apply gain compensation for panning
      if (this.audioNodes.gain) {
        const compensatedGain = this.calculatePanCompensation(this.panValue);
        this.audioNodes.gain.gain.setTargetAtTime(
          MASTER_GAIN * compensatedGain,
          audioContext.getAudioContext().currentTime,
          0.05
        );
      }
    }
  }

  /**
   * Get the current pan value
   */
  public getPan(): number {
    return this.panValue;
  }

  /**
   * Set whether auto-panning is enabled
   */
  public setPanning(enabled: boolean): void {
    if (enabled === this.isPanning) return;
    
    console.log(`🔊 Setting auto-panning: ${enabled ? 'enabled' : 'disabled'}`);
    this.isPanning = enabled;
    
    if (this.isPlaying) {
      if (enabled) {
        this.startPanning();
      } else {
        this.stopPanning();
      }
    }
  }

  /**
   * Get whether auto-panning is currently enabled
   */
  public isPanningEnabled(): boolean {
    return this.isPanning;
  }

  /**
   * Set the pan cycle duration in seconds
   * @param durationSeconds Duration of a full pan cycle in seconds
   */
  public setPanDuration(durationSeconds: number): void {
    // Limit to reasonable range
    durationSeconds = Math.max(MIN_PAN_DURATION, Math.min(MAX_PAN_DURATION, durationSeconds));
    
    if (durationSeconds === this.panDuration) return;
    
    console.log(`🔊 Setting pan cycle duration: ${durationSeconds.toFixed(1)} seconds`);
    this.panDuration = durationSeconds;
    
    // If already panning, restart with new duration
    if (this.isPlaying && this.isPanning) {
      this.stopPanning();
      this.startPanning();
    }
  }

  /**
   * Get the current pan cycle duration in seconds
   */
  public getPanDuration(): number {
    return this.panDuration;
  }

  /**
   * Set the sweep speed by setting the duration of a full sweep cycle
   * @param durationSeconds Duration of a full sweep cycle in seconds
   */
  public setSweepDuration(durationSeconds: number): void {
    // Limit to reasonable range
    durationSeconds = Math.max(MIN_SWEEP_DURATION, Math.min(MAX_SWEEP_DURATION, durationSeconds));
    
    if (durationSeconds === this.sweepDuration) return;
    
    console.log(`🔊 Setting sweep cycle duration: ${durationSeconds.toFixed(1)} seconds`);
    this.sweepDuration = durationSeconds;
    
    // If already sweeping, restart the sweep with the new duration
    if (this.isPlaying && this.isSweeping) {
      this.stopSweep();
      this.startSweep();
    }
  }

  /**
   * Get the current sweep duration in seconds
   */
  public getSweepDuration(): number {
    return this.sweepDuration;
  }

  /**
   * Set the minimum frequency for the sweep
   * @param freq Minimum frequency in Hz (20-20000)
   */
  public setMinSweepFreq(freq: number): void {
    // Ensure minimum frequency is within reasonable bounds
    freq = Math.max(ABSOLUTE_MIN_FREQ, Math.min(this.maxSweepFreq * 0.9, freq));
    
    if (freq === this.minSweepFreq) return;
    
    console.log(`🔊 Setting minimum sweep frequency: ${freq.toFixed(1)} Hz`);
    this.minSweepFreq = freq;
    
    // If already sweeping, restart with new range
    if (this.isPlaying && this.isSweeping) {
      this.stopSweep();
      this.startSweep();
    }
  }

  /**
   * Get the current minimum sweep frequency
   */
  public getMinSweepFreq(): number {
    return this.minSweepFreq;
  }

  /**
   * Set the maximum frequency for the sweep
   * @param freq Maximum frequency in Hz (20-20000)
   */
  public setMaxSweepFreq(freq: number): void {
    // Ensure maximum frequency is within reasonable bounds
    freq = Math.max(this.minSweepFreq * 1.1, Math.min(ABSOLUTE_MAX_FREQ, freq));
    
    if (freq === this.maxSweepFreq) return;
    
    console.log(`🔊 Setting maximum sweep frequency: ${freq.toFixed(1)} Hz`);
    this.maxSweepFreq = freq;
    
    // If already sweeping, restart with new range
    if (this.isPlaying && this.isSweeping) {
      this.stopSweep();
      this.startSweep();
    }
  }

  /**
   * Get the current maximum sweep frequency
   */
  public getMaxSweepFreq(): number {
    return this.maxSweepFreq;
  }

  /**
   * Set whether frequency sweeping is enabled
   */
  public setSweeping(enabled: boolean): void {
    if (enabled === this.isSweeping) return;
    
    console.log(`🔊 Setting peak filter sweep: ${enabled ? 'enabled' : 'disabled'}`);
    this.isSweeping = enabled;
    
    if (this.isPlaying) {
      if (enabled) {
        this.startSweep();
      } else {
        this.stopSweep();
        
        // Reset peak filter to center frequency when sweep is disabled
        if (this.audioNodes.peakFilter) {
          const centerFreq = Math.sqrt(this.minSweepFreq * this.maxSweepFreq); // Geometric center
          this.audioNodes.peakFilter.frequency.setValueAtTime(
            centerFreq,
            audioContext.getAudioContext().currentTime
          );
        }
      }
    }
  }

  /**
   * Get whether sweeping is currently enabled
   */
  public isSweepEnabled(): boolean {
    return this.isSweeping;
  }

  /**
   * Set the peak filter gain in dB
   */
  public setPeakGain(gainDb: number): void {
    // Limit to reasonable range: -20 to +20 dB
    gainDb = Math.max(-20, Math.min(20, gainDb));
    
    if (gainDb === this.peakGain) return;
    
    console.log(`🔊 Setting peak filter gain: ${gainDb.toFixed(1)} dB`);
    this.peakGain = gainDb;
    
    // Update peak filter if playing
    if (this.isPlaying && this.audioNodes.peakFilter) {
      this.audioNodes.peakFilter.gain.setTargetAtTime(
        this.peakGain,
        audioContext.getAudioContext().currentTime,
        0.05
      );
    }
  }

  /**
   * Get the current peak filter gain
   */
  public getPeakGain(): number {
    return this.peakGain;
  }

  /**
   * Set the peak filter Q factor (bandwidth)
   * @param q Q factor value (0.1 to 10.0)
   */
  public setPeakQ(q: number): void {
    // Limit to reasonable range: 0.1 to 10
    q = Math.max(MIN_PEAK_Q, Math.min(MAX_PEAK_Q, q));
    
    if (q === this.peakQ) return;
    
    console.log(`🔊 Setting peak filter Q: ${q.toFixed(2)}`);
    this.peakQ = q;
    
    // Update peak filter if playing
    if (this.isPlaying && this.audioNodes.peakFilter) {
      this.audioNodes.peakFilter.Q.setTargetAtTime(
        this.peakQ,
        audioContext.getAudioContext().currentTime,
        0.05
      );
    }
  }

  /**
   * Get the current peak filter Q factor
   */
  public getPeakQ(): number {
    return this.peakQ;
  }

  /**
   * Calculate gain compensation to maintain constant power during panning
   * @param panValue The current pan value (-1 to 1)
   * @returns The compensation factor to maintain constant power
   */
  private calculatePanCompensation(panValue: number): number {
    // Convert to absolute value since compensation is symmetric
    const absPan = Math.abs(panValue);
    
    // Apply center-boosted panning law
    // This will make the center (absPan=0) have the maximum volume (1.0)
    // and attenuate as we move toward the sides
    let compensation = 1.0;
    
    if (absPan > 0) {
      // Use cosine-based attenuation which creates a natural volume decrease as we pan
      // Using Math.cos directly creates a more dramatic center boost than the equal-power formula
      compensation = Math.cos(absPan * Math.PI / 2);
      
      // Ensure compensation doesn't get too quiet at extreme pan positions
      // This applies a floor of 0.7 (-3dB) at full pan left/right
      compensation = Math.max(compensation, 0.7);
    }
    
    return compensation;
  }

  /**
   * Start auto-panning
   */
  private startPanning(): void {
    if (!this.audioNodes.panner) return;
    
    // Clear any existing timeout to avoid multiple panning cycles
    this.stopPanning();
    
    const ctx = audioContext.getAudioContext();
    const panTime = this.panDuration / 2; // Half cycle time
    
    // Schedule the panning (runs continuously)
    const scheduleNextPan = () => {
      if (!this.audioNodes.panner || !this.isPlaying || !this.isPanning) {
        return; // Exit if we're no longer playing or panning
      }
      
      const startTime = ctx.currentTime;
      
      // Pan from left to right
      this.audioNodes.panner.pan.setValueAtTime(-1, startTime);
      this.audioNodes.panner.pan.linearRampToValueAtTime(1, startTime + panTime);
      
      // Pan from right to left
      this.audioNodes.panner.pan.linearRampToValueAtTime(-1, startTime + panTime * 2);
      
      // Apply volume compensation during panning
      if (this.audioNodes.gain) {
        // Schedule gain compensation for left position (start)
        const leftCompensation = this.calculatePanCompensation(-1);
        this.audioNodes.gain.gain.setValueAtTime(
          MASTER_GAIN * leftCompensation,
          startTime
        );
        
        // Schedule gain compensation for center position (middle of first half)
        const centerCompensation = this.calculatePanCompensation(0);
        this.audioNodes.gain.gain.setValueAtTime(
          MASTER_GAIN * centerCompensation,
          startTime + panTime / 2
        );
        
        // Schedule gain compensation for right position (middle)
        const rightCompensation = this.calculatePanCompensation(1);
        this.audioNodes.gain.gain.setValueAtTime(
          MASTER_GAIN * rightCompensation,
          startTime + panTime
        );
        
        // Schedule gain compensation for center position again (middle of second half)
        this.audioNodes.gain.gain.setValueAtTime(
          MASTER_GAIN * centerCompensation,
          startTime + panTime * 1.5
        );
        
        // Schedule gain compensation for left position (end)
        this.audioNodes.gain.gain.setValueAtTime(
          MASTER_GAIN * leftCompensation,
          startTime + panTime * 2
        );
      }
      
      // Schedule the next pan cycle
      this.panTimeoutId = window.setTimeout(() => {
        // Only proceed if we're still playing and panning
        if (this.isPlaying && this.isPanning && this.audioNodes.panner) {
          // Cancel scheduled automation first
          this.audioNodes.panner.pan.cancelScheduledValues(ctx.currentTime);
          if (this.audioNodes.gain) {
            this.audioNodes.gain.gain.cancelScheduledValues(ctx.currentTime);
          }
          
          // Set values to where they should be now to avoid jumps
          this.audioNodes.panner.pan.setValueAtTime(
            this.audioNodes.panner.pan.value,
            ctx.currentTime
          );
          if (this.audioNodes.gain) {
            this.audioNodes.gain.gain.setValueAtTime(
              this.audioNodes.gain.gain.value,
              ctx.currentTime
            );
          }
          
          // Schedule next pan cycle
          scheduleNextPan();
        }
      }, panTime * 2 * 1000 - 50); // Schedule slightly before end to ensure smooth transition
    };
    
    // Start the first pan cycle
    scheduleNextPan();
    
    console.log(`🔊 Started auto-panning, duration: ${this.panDuration.toFixed(1)}s`);
  }

  /**
   * Stop auto-panning
   */
  private stopPanning(): void {
    // Clear the timeout if one exists
    if (this.panTimeoutId !== null) {
      window.clearTimeout(this.panTimeoutId);
      this.panTimeoutId = null;
    }
    
    // Cancel any scheduled parameter changes and reset to current manual pan value
    if (this.audioNodes.panner) {
      const ctx = audioContext.getAudioContext();
      this.audioNodes.panner.pan.cancelScheduledValues(ctx.currentTime);
      this.audioNodes.panner.pan.setValueAtTime(
        this.panValue,
        ctx.currentTime
      );
      
      // Reset gain compensation based on manual pan value
      if (this.audioNodes.gain) {
        this.audioNodes.gain.gain.cancelScheduledValues(ctx.currentTime);
        const compensatedGain = this.calculatePanCompensation(this.panValue);
        this.audioNodes.gain.gain.setValueAtTime(
          MASTER_GAIN * compensatedGain,
          ctx.currentTime
        );
      }
    }
    
    console.log('🔊 Stopped auto-panning');
  }

  /**
   * Start frequency sweep
   */
  private startSweep(): void {
    if (!this.audioNodes.peakFilter) return;
    
    // Clear any existing LFO or timeout to avoid multiple sweeps
    this.stopSweep();
    
    const ctx = audioContext.getAudioContext();
    
    // Set up the frequency range in logarithmic scale
    const minFreq = this.minSweepFreq;
    const maxFreq = this.maxSweepFreq;
    const centerFreq = Math.sqrt(minFreq * maxFreq); // Geometric center
    
    // Start with center frequency
    this.audioNodes.peakFilter.frequency.value = centerFreq;
    
    // Set up automation for the frequency sweep
    const now = ctx.currentTime;
    const sweepTime = this.sweepDuration / 2; // Half cycle (up then down)
    
    // Schedule the sweep (runs continuously)
    const scheduleNextSweep = () => {
      if (!this.audioNodes.peakFilter || !this.isPlaying || !this.isSweeping) {
        return; // Exit if we're no longer playing or sweeping
      }
      
      const startTime = ctx.currentTime;
      
      // Sweep up (exponential ramp from min to max)
      this.audioNodes.peakFilter.frequency.exponentialRampToValueAtTime(
        maxFreq,
        startTime + sweepTime
      );
      
      // Sweep down (exponential ramp from max to min)
      this.audioNodes.peakFilter.frequency.exponentialRampToValueAtTime(
        minFreq,
        startTime + sweepTime * 2
      );
      
      // Schedule the next sweep cycle
      this.sweepTimeoutId = window.setTimeout(() => {
        // Only proceed if we're still playing and sweeping
        if (this.isPlaying && this.isSweeping && this.audioNodes.peakFilter) {
          // Cancel scheduled automation first
          this.audioNodes.peakFilter.frequency.cancelScheduledValues(ctx.currentTime);
          // Then set value to where it should be now to avoid jumps
          this.audioNodes.peakFilter.frequency.setValueAtTime(
            this.audioNodes.peakFilter.frequency.value,
            ctx.currentTime
          );
          // Schedule next sweep
          scheduleNextSweep();
        }
      }, sweepTime * 2 * 1000 - 50); // Schedule slightly before end to ensure smooth transition
    };
    
    // Start the first sweep cycle
    scheduleNextSweep();
    
    console.log(`🔊 Started frequency sweep: ${minFreq}Hz - ${maxFreq}Hz, duration: ${this.sweepDuration.toFixed(1)}s`);
  }

  /**
   * Stop frequency sweep
   */
  private stopSweep(): void {
    // Clear the timeout if one exists
    if (this.sweepTimeoutId !== null) {
      window.clearTimeout(this.sweepTimeoutId);
      this.sweepTimeoutId = null;
    }
    
    // Cancel any scheduled parameter changes if the peak filter exists
    if (this.audioNodes.peakFilter) {
      const ctx = audioContext.getAudioContext();
      this.audioNodes.peakFilter.frequency.cancelScheduledValues(ctx.currentTime);
      
      // Reset to center frequency
      const centerFreq = Math.sqrt(this.minSweepFreq * this.maxSweepFreq); // Geometric center
      this.audioNodes.peakFilter.frequency.setValueAtTime(
        centerFreq,
        ctx.currentTime
      );
    }
    
    // Clean up oscillator if it exists and has been started
    if (this.sweepLFO) {
      try {
        // Only call stop if it was actually started
        // We'll just disconnect it safely, which won't throw errors
        this.sweepLFO.disconnect();
      } catch (e) {
        console.error('Error cleaning up LFO:', e);
      }
      this.sweepLFO = null;
    }
    
    console.log('🔊 Stopped frequency sweep');
  }

  /**
   * Start playback of pink noise
   */
  private startPlayback(): void {
    // Make sure we have a pink noise buffer
    if (!this.pinkNoiseBuffer) {
      console.warn('Pink noise buffer not ready');
      this.generatePinkNoiseBuffer();
      return;
    }
    
    const ctx = audioContext.getAudioContext();
    
    // Get destination node (either preEQGain or directly to EQ processor)
    const destinationNode = this.preEQGain ? 
      this.preEQGain as AudioNode : 
      eqProcessor.getEQProcessor().getInputNode();
    
    // Create audio source
    const source = ctx.createBufferSource();
    source.buffer = this.pinkNoiseBuffer;
    source.loop = true;
    
    // Create peak filter
    const peakFilter = ctx.createBiquadFilter();
    peakFilter.type = 'peaking';
    peakFilter.frequency.value = Math.sqrt(this.minSweepFreq * this.maxSweepFreq); // Geometric center frequency
    peakFilter.Q.value = this.peakQ;
    peakFilter.gain.value = this.peakGain;
    
    // Create panner and gain nodes
    const panner = ctx.createStereoPanner();
    panner.pan.value = this.panValue;
    
    const gain = ctx.createGain();
    const compensatedGain = this.calculatePanCompensation(this.panValue);
    gain.gain.value = MASTER_GAIN * compensatedGain;
    
    // Connect the chain
    source.connect(peakFilter);
    peakFilter.connect(panner);
    panner.connect(gain);
    gain.connect(destinationNode);
    
    // Start the source
    source.start();
    
    // Store nodes
    this.audioNodes = {
      source,
      peakFilter,
      panner,
      gain
    };
    
    console.log(`🔊 Started pink noise playback with peak filter at ${peakFilter.frequency.value.toFixed(1)}Hz, gain: ${this.peakGain.toFixed(1)}dB, Q: ${this.peakQ.toFixed(2)}`);
    
    // Start sweep if enabled
    if (this.isSweeping) {
      this.startSweep();
    }
    
    // Start auto-panning if enabled
    if (this.isPanning) {
      this.startPanning();
    }
  }

  /**
   * Stop playback of pink noise
   */
  private stopPlayback(): void {
    // Stop the sweep first
    this.stopSweep();
    
    // Stop auto-panning
    this.stopPanning();
    
    // Stop and disconnect all audio nodes
    if (this.audioNodes.source) {
      try {
        this.audioNodes.source.stop();
        this.audioNodes.source.disconnect();
      } catch (e) {
        console.error('Error stopping source:', e);
      }
    }
    
    if (this.audioNodes.gain) {
      this.audioNodes.gain.disconnect();
    }
    
    if (this.audioNodes.panner) {
      this.audioNodes.panner.disconnect();
    }
    
    if (this.audioNodes.peakFilter) {
      this.audioNodes.peakFilter.disconnect();
    }
    
    // Reset audio nodes
    this.audioNodes = {
      source: null,
      peakFilter: null,
      panner: null,
      gain: null
    };
    
    console.log('🔊 Stopped pink noise playback');
  }

  /**
   * Create and return a pre-EQ analyzer node
   */
  public createPreEQAnalyser(): AnalyserNode {
    const ctx = audioContext.getAudioContext();
    
    // Create analyzer if it doesn't exist
    if (!this.preEQAnalyser) {
      // Create a gain node to combine all sources
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
      
      // Create analyzer node
      this.preEQAnalyser = ctx.createAnalyser();
      this.preEQAnalyser.fftSize = 2048;
      this.preEQAnalyser.smoothingTimeConstant = 0.8;
      
      // Connect the gain to the analyzer
      this.preEQGain.connect(this.preEQAnalyser);
      
      // Connect to EQ processor
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode());
      
      // If already playing, we need to reconnect all sources
      if (this.isPlaying) {
        this.stopPlayback();
        this.startPlayback();
      }
    }
    
    return this.preEQAnalyser;
  }
  
  /**
   * Get the pre-EQ analyzer, creating it if needed
   */
  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.setPlaying(false);
    
    // Clean up analyzer nodes
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
    }
    
    if (this.preEQAnalyser) {
      this.preEQAnalyser.disconnect();
      this.preEQAnalyser = null;
    }
    
    this.pinkNoiseBuffer = null;
  }
}

/**
 * Get the singleton instance of the PinkNoiseCalibrator
 */
export function getPinkNoiseCalibrator(): PinkNoiseCalibrator {
  return PinkNoiseCalibrator.getInstance();
}

/**
 * Clean up the pink noise calibrator
 */
export function cleanupPinkNoiseCalibrator(): void {
  const calibrator = PinkNoiseCalibrator.getInstance();
  calibrator.dispose();
} 