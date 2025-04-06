import { getAudioContext } from '@/lib/audio/audioContext'
import * as eqProcessor from '@/lib/audio/eqProcessor'
import { useEQProfileStore } from '@/lib/stores'

// Default values
const DEFAULT_FREQ_MULTIPLIER = 1.0
const DEFAULT_SWEEP_DURATION = 8.0 // 8 seconds per cycle
const MASTER_GAIN = 0.5 // Reduced from 1.5 to make quieter
// const ENVELOPE_ATTACK = 0.01 // 10ms
// const ENVELOPE_RELEASE_LOW_FREQ = 0.8 // 800ms for low frequencies
// const ENVELOPE_RELEASE_HIGH_FREQ = 0.2 // 200ms for high frequencies
const ENVELOPE_MAX_GAIN = 1.0
// const ENVELOPE_MIN_GAIN = 0.001
const DEFAULT_MODULATION_RATE = 8.0 // modulations per second
const DEFAULT_MODULATION_DEPTH = 0.8 // how much to modulate (0-1)
const ENVELOPE_ATTACK_TIME = 0.005 // 5ms attack
const ENVELOPE_RELEASE_TIME = 0.05 // 100ms release
const DEFAULT_SPEED = 1.0 // Default movement speed
const DEFAULT_BACKGROUND_NOISE_VOLUME = 0.1 // Default background noise volume

// Volume oscillation settings
const VOLUME_OSCILLATION_RATE = 1.0 // 1Hz - oscillate once per second
const VOLUME_OSCILLATION_MIN = 0.0 // Silent
const VOLUME_OSCILLATION_MAX = 1.0 // Full volume

// Number of simultaneous nodes to distribute along the line
const NUM_NODES = 20

// Add constants for hit detection
const DEFAULT_HIT_INTERVAL = 0.2 // Default interval between hits (20% of path)

export enum PlaybackMode {
  PATH = 'path', // Follow the path continuously back and forth
  OSCILLATE = 'oscillate', // Oscillate through the path at varying speeds
  SWEEP = 'sweep',    // Smoothly sweep through the path
  ALTERNATE = 'alternate'  // Alternate between start and end points
}

// Simple glyph representation
export interface GlyphData {
  id: string;
  type: 'line'; // For now, only diagonal line is supported
  position: { x: number, y: number }; // Center position
  size: { width: number, height: number }; // Size of the glyph
  angle?: number; // Optional rotation angle
}

// Structure to hold all the node properties for each position along the line
interface AudioNodePoint {
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  filter: BiquadFilterNode | null;
  panner: StereoPannerNode | null;
  position: number; // Position along the path (0-1)
}

class GlyphGridAudioPlayer {
  private static instance: GlyphGridAudioPlayer
  private pinkNoiseBuffer: AudioBuffer | null = null
  private isPlaying: boolean = false
  
  // Change to array of audio nodes along the line
  private audioNodes: AudioNodePoint[] = [];
  
  // Background noise nodes
  private backgroundNoiseNodes: {
    source: AudioBufferSourceNode | null;
    gain: GainNode | null;
    panner: StereoPannerNode | null;
  } = {
    source: null,
    gain: null,
    panner: null
  }
  
  // Background noise volume
  private backgroundNoiseVolume: number = DEFAULT_BACKGROUND_NOISE_VOLUME
  
  // Path related properties - kept for UI visualization
  private pathPosition: number = 0 // Position along the path (0 to 1)
  private pathDirection: number = 1 // Direction of movement (1 = forward, -1 = backward)
  private animationFrameId: number | null = null
  
  // Frequency and sweep settings
  private freqMultiplier: number = DEFAULT_FREQ_MULTIPLIER
  private isSweeping: boolean = false
  private sweepDuration: number = DEFAULT_SWEEP_DURATION
  private sweepTimeoutId: number | null = null
  
  // Current glyph data
  private currentGlyph: GlyphData | null = null
  
  // Add these properties to the class
  private isModulating: boolean = false
  private modulationRate: number = DEFAULT_MODULATION_RATE
  private modulationDepth: number = DEFAULT_MODULATION_DEPTH
  private modulationTimerId: number | null = null
  
  private isManualControl: boolean = false
  private manualPosition: number = 0
  
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
  private discreteFrequency: boolean = false // Changed from true to false for continuous frequency changes
  
  // Add distortion gain property
  private distortionGain: number = 1.0;
  
  // Add volume oscillation properties
  private volumeOscillationEnabled: boolean = true; // Start with oscillation enabled
  private volumeOscillationAnimationId: number | null = null;
  
  private constructor() {
    // Generate pink noise buffer
    this.generatePinkNoiseBuffer()
    
    // Ensure continuous frequency changes
    this.discreteFrequency = false;
    
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
    
    // Update all audio nodes when the glyph changes
    if (this.isPlaying) {
      this.updateNodesForGlyph();
    }
  }
  
  // New method to create and distribute nodes along the line
  private setupNodesForGlyph(): void {
    if (!this.currentGlyph || !this.pinkNoiseBuffer) return;
    
    // Clean up existing nodes first
    this.cleanupAudioNodes();
    
    const ctx = getAudioContext();
    
    // Create new nodes positioned along the line
    for (let i = 0; i < NUM_NODES; i++) {
      // Calculate position along the path (0 to 1)
      const position = i / (NUM_NODES - 1);
      
      // Create source
      const source = ctx.createBufferSource();
      source.buffer = this.pinkNoiseBuffer;
      source.loop = true;
      
      // Create gain node
      const gain = ctx.createGain();
      // Divide master gain by number of nodes to avoid overwhelming volume
      gain.gain.value = (MASTER_GAIN * this.distortionGain) / NUM_NODES;
      
      // Create filter and panner nodes with parameters for this position
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3.0;
      
      const panner = ctx.createStereoPanner();
      
      // Set filter and panner values for this position
      this.setAudioParamsForPosition(position, filter, panner);
      
      // Connect the audio chain
      source.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      
      // Connect to output (directly or through analyzer)
      if (this.preEQAnalyser && this.preEQGain) {
        panner.connect(this.preEQGain);
      } else {
        const eq = eqProcessor.getEQProcessor();
        panner.connect(eq.getInputNode());
      }
      
      // Start the source
      source.start();
      
      // Add to our nodes array
      this.audioNodes.push({
        source,
        gain,
        filter,
        panner,
        position
      });
    }
    
    console.log(`🔊 Created ${NUM_NODES} audio nodes distributed along the glyph line`);
  }
  
  // Update node parameters based on glyph and position
  private updateNodesForGlyph(): void {
    if (!this.currentGlyph) return;
    
    if (this.audioNodes.length === 0) {
      // If we don't have nodes yet, set them up
      this.setupNodesForGlyph();
      return;
    }
    
    // Update the parameters of existing nodes
    this.audioNodes.forEach(node => {
      if (node.filter && node.panner) {
        this.setAudioParamsForPosition(node.position, node.filter, node.panner);
      }
    });
  }
  
  // Calculate audio parameters for a specific position on the line
  private setAudioParamsForPosition(position: number, filter: BiquadFilterNode, panner: StereoPannerNode): void {
    if (!this.currentGlyph) return;
    
    const { position: glyphPos, size: glyphSize } = this.currentGlyph;
    
    // Calculate the actual x and y in normalized space (-1 to 1)
    const startX = glyphPos.x - glyphSize.width / 2;
    const startY = glyphPos.y - glyphSize.height / 2;
    const endX = glyphPos.x + glyphSize.width / 2;
    const endY = glyphPos.y + glyphSize.height / 2;
    
    // Interpolate between start and end points
    const x = startX + position * (endX - startX);
    const y = startY + position * (endY - startY);
    
    // Map y to frequency (bottom = low, top = high)
    const minFreq = 20;
    const maxFreq = 20000;
    
    // Properly normalize y from glyph space to full 0-1 range
    const normalizedY = Math.max(0, Math.min(1, (y + 1) / 2));
    
    // Map to logarithmic frequency scale
    const logMinFreq = Math.log2(minFreq);
    const logMaxFreq = Math.log2(maxFreq);
    const logFreqRange = logMaxFreq - logMinFreq;
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
    
    // Apply frequency multiplier
    const adjustedFreq = centerFreq * this.freqMultiplier;
    
    // Instead of directly using x as panning, distribute panning evenly
    // based on position along the line (0 to 1)
    // This ensures even distribution regardless of line orientation
    // Map position from 0-1 to -1 to 1 for pan
    const panPosition = position * 2 - 1;
    
    // Set the parameters
    filter.frequency.value = adjustedFreq;
    panner.pan.value = panPosition;
  }
  
  // Clean up all audio nodes
  private cleanupAudioNodes(): void {
    this.audioNodes.forEach(node => {
      if (node.source) {
        try {
          node.source.stop();
          node.source.disconnect();
        } catch (e) {
          console.error('Error stopping audio source:', e);
        }
      }
      
      if (node.gain) node.gain.disconnect();
      if (node.filter) node.filter.disconnect();
      if (node.panner) node.panner.disconnect();
    });
    
    // Clear the array
    this.audioNodes = [];
  }
  
  // Method still needed for UI visualization purposes
  private updateAudioNodesFromGlyph(): void {
    if (!this.currentGlyph) return;
    
    // Just update the visualization position
    this.updatePathPosition();
  }
  
  // Keep this method for UI path animation, but it won't affect audio
  private updatePathPosition(): void {
    if (!this.currentGlyph) return;
    
    // If in manual control mode, use the manually set position
    if (this.isManualControl) {
      this.pathPosition = this.manualPosition;
      return;
    }
    
    // Store previous position to detect hit crossing
    const previousPosition = this.pathPosition;
    
    // Calculate new position based on playback mode
    if (this.playbackMode === PlaybackMode.SWEEP) {
      // Apply speed factor to the position increment
      this.pathPosition += 0.005 * this.pathDirection * this.speed;
      
      // If using subsection, check subsection boundaries
      if (this.useSubsection) {
        // Handle both normal and reversed subsection ranges
        const min = Math.min(this.subsectionStart, this.subsectionEnd);
        const max = Math.max(this.subsectionStart, this.subsectionEnd);
        
        if (this.pathPosition >= max) {
          this.pathPosition = max;
          this.pathDirection = -1;
        } else if (this.pathPosition <= min) {
          this.pathPosition = min;
          this.pathDirection = 1;
        }
      } else {
        // Regular full-range behavior
        if (this.pathPosition >= 1) {
          this.pathPosition = 1;
          this.pathDirection = -1;
        } else if (this.pathPosition <= 0) {
          this.pathPosition = 0;
          this.pathDirection = 1;
        }
      }
    } else if (this.playbackMode === PlaybackMode.ALTERNATE) {
      // Alternate mode: jump between start and end points
      const stayDuration = 30 / this.speed; // Number of frames to stay at each point
      
      // Increment a counter to track when to alternate
      this._alternateCounter = (this._alternateCounter || 0) + 1;
      
      if (this._alternateCounter >= stayDuration) {
        this._alternateCounter = 0;
        
        // Switch between start and end
        if (this.pathDirection === 1) {
          // We're at start point, move to end
          this.pathPosition = this.useSubsection ? this.subsectionEnd : 1;
          this.pathDirection = -1;
        } else {
          // We're at end point, move to start
          this.pathPosition = this.useSubsection ? this.subsectionStart : 0;
          this.pathDirection = 1;
        }
      }
    }
  }
  
  // Remove this method since we're no longer updating audio parameters based on position
  // private updateAudioParametersFromPosition(position: number): void {
  //   // Method removed - parameters are set once per node and don't change with animation
  // }
  
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;
    
    if (playing) {
      this.startSound();
    } else {
      this.stopSound();
    }
  }
  
  private startSound(): void {
    if (!this.pinkNoiseBuffer) {
      console.warn('🔊 Tried to start sound but pink noise buffer is not ready');
      return;
    }
    
    // Set up the audio nodes distributed along the line
    this.setupNodesForGlyph();
    
    // Start the animation loop for UI visualization
    this.startAnimationLoop();
    
    // Start frequency sweep if enabled
    if (this.isSweeping) {
      this.startSweep();
    }
    
    // Start volume oscillation
    this.startVolumeOscillation();
  }
  
  private startAnimationLoop(): void {
    const animate = () => {
      this.updateAudioNodesFromGlyph();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    
    animate();
  }
  
  private stopSound(): void {
    // Stop envelope modulation
    this.stopEnvelopeModulation();
    
    // Stop frequency sweep
    this.stopSweep();
    
    // Stop volume oscillation
    this.stopVolumeOscillation();
    
    // Stop animation loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Clean up the analyzer nodes
    if (this.preEQAnalyser) {
      if (this.preEQGain) {
        this.preEQGain.disconnect();
        this.preEQGain = null;
      }
      this.preEQAnalyser = null;
    }
    
    // Clean up all audio nodes
    this.cleanupAudioNodes();
    
    // Stop background noise
    this.stopBackgroundNoise();
  }
  
  public setFrequencyMultiplier(multiplier: number): void {
    this.freqMultiplier = multiplier;
    
    // Update all node frequencies when multiplier changes
    if (this.isPlaying) {
      this.updateNodesForGlyph();
    }
  }
  
  public getFrequencyMultiplier(): number {
    return this.freqMultiplier;
  }
  
  public setSweeping(enabled: boolean): void {
    this.isSweeping = enabled;
    
    if (enabled) {
      this.startSweep();
    } else {
      this.stopSweep();
    }
  }
  
  public isSweepEnabled(): boolean {
    return this.isSweeping;
  }
  
  public setSweepDuration(duration: number): void {
    this.sweepDuration = duration;
    
    // If we're already sweeping, restart with new duration
    if (this.isSweeping) {
      this.stopSweep();
      this.startSweep();
    }
  }
  
  private startSweep(): void {
    if (this.sweepTimeoutId !== null) {
      clearTimeout(this.sweepTimeoutId);
    }
    
    const startTime = Date.now();
    
    const updateSweep = () => {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      const sweepProgress = (elapsed % this.sweepDuration) / this.sweepDuration;
      
      // Sine wave oscillation between 0.5 and 2.0
      this.freqMultiplier = 0.5 + 1.5 * (Math.sin(sweepProgress * Math.PI * 2) * 0.5 + 0.5);
      
      // Update all node frequencies with the new multiplier
      if (this.isPlaying) {
        this.updateNodesForGlyph();
      }
      
      // Schedule next update
      this.sweepTimeoutId = window.setTimeout(updateSweep, 50); // 20 updates per second
    };
    
    updateSweep();
  }
  
  private stopSweep(): void {
    if (this.sweepTimeoutId !== null) {
      clearTimeout(this.sweepTimeoutId);
      this.sweepTimeoutId = null;
    }
  }
  
  public setModulating(enabled: boolean): void {
    if (this.isModulating === enabled) return;
    
    this.isModulating = enabled;
    
    if (enabled && this.isPlaying) {
      this.startEnvelopeModulation();
    } else {
      this.stopEnvelopeModulation();
    }
  }
  
  public isModulationEnabled(): boolean {
    return this.isModulating;
  }
  
  public setModulationRate(rate: number): void {
    this.modulationRate = rate;
    
    // If we're already modulating, restart with new rate
    if (this.isModulating && this.isPlaying) {
      this.stopEnvelopeModulation();
      this.startEnvelopeModulation();
    }
  }
  
  public setModulationDepth(depth: number): void {
    this.modulationDepth = Math.max(0, Math.min(1, depth)); // Clamp between 0 and 1
  }
  
  private startEnvelopeModulation(): void {
    if (this.modulationTimerId !== null) {
      clearInterval(this.modulationTimerId);
    }
    
    // Calculate interval in milliseconds based on rate
    const intervalMs = 1000 / this.modulationRate;
    
    const triggerEnvelope = () => {
      // Apply modulation to all nodes simultaneously
      this.audioNodes.forEach(node => {
        if (!node.gain) return;
        
        const ctx = getAudioContext();
        const now = ctx.currentTime;
        
        // Calculate the minimum gain based on modulation depth
        const minGain = ENVELOPE_MAX_GAIN * (1 - this.modulationDepth);
        
        // Original per-node gain value
        const baseGain = (MASTER_GAIN * this.distortionGain) / NUM_NODES;
        
        // Reset to minimum gain
        node.gain.gain.cancelScheduledValues(now);
        node.gain.gain.setValueAtTime(baseGain * minGain, now);
        
        // Attack phase - quick ramp to max gain
        node.gain.gain.linearRampToValueAtTime(
          baseGain * ENVELOPE_MAX_GAIN, 
          now + ENVELOPE_ATTACK_TIME
        );
        
        // Release phase - slower decay back to min gain
        node.gain.gain.linearRampToValueAtTime(
          baseGain * minGain,
          now + ENVELOPE_ATTACK_TIME + ENVELOPE_RELEASE_TIME
        );
      });
    };
    
    // Trigger immediately then start interval
    triggerEnvelope();
    this.modulationTimerId = window.setInterval(triggerEnvelope, intervalMs);
  }
  
  private stopEnvelopeModulation(): void {
    if (this.modulationTimerId !== null) {
      clearInterval(this.modulationTimerId);
      this.modulationTimerId = null;
    }
    
    // Reset all node gains to max
    this.audioNodes.forEach(node => {
      if (node.gain) {
        const ctx = getAudioContext();
        const baseGain = (MASTER_GAIN * this.distortionGain) / NUM_NODES;
        node.gain.gain.cancelScheduledValues(ctx.currentTime);
        node.gain.gain.setValueAtTime(baseGain, ctx.currentTime);
      }
    });
  }
  
  // Add method to start volume oscillation
  private startVolumeOscillation(): void {
    // Stop any existing oscillation
    this.stopVolumeOscillation();
    
    const startTime = performance.now();
    
    const updateVolume = () => {
      if (!this.isPlaying) return;
      
      // Calculate current time in seconds
      const now = performance.now();
      const elapsed = (now - startTime) / 1000;
      
      // Calculate oscillation value (0 to 1) using sine wave
      // sin varies from -1 to 1, so we normalize to 0 to 1
      const oscillationValue = (Math.sin(elapsed * Math.PI * 2 * VOLUME_OSCILLATION_RATE) + 1) / 2;
      
      // Scale to desired range (min to max)
      const volumeScale = VOLUME_OSCILLATION_MIN + oscillationValue * (VOLUME_OSCILLATION_MAX - VOLUME_OSCILLATION_MIN);
      
      // Apply to all nodes
      this.audioNodes.forEach(node => {
        if (node.gain) {
          // Base gain with distortion applied
          const baseGain = (MASTER_GAIN * this.distortionGain) / NUM_NODES;
          
          // Apply oscillation factor
          node.gain.gain.value = baseGain * volumeScale;
        }
      });
      
      // Schedule next update
      this.volumeOscillationAnimationId = requestAnimationFrame(updateVolume);
    };
    
    // Start the oscillation loop
    this.volumeOscillationAnimationId = requestAnimationFrame(updateVolume);
    console.log('🔊 Started volume oscillation at 1Hz');
  }
  
  // Add method to stop volume oscillation
  private stopVolumeOscillation(): void {
    if (this.volumeOscillationAnimationId !== null) {
      cancelAnimationFrame(this.volumeOscillationAnimationId);
      this.volumeOscillationAnimationId = null;
      
      // Reset gains to normal
      this.audioNodes.forEach(node => {
        if (node.gain) {
          const baseGain = (MASTER_GAIN * this.distortionGain) / NUM_NODES;
          node.gain.gain.value = baseGain;
        }
      });
    }
  }
  
  // Add public method to enable/disable volume oscillation
  public setVolumeOscillation(enabled: boolean): void {
    if (enabled === this.volumeOscillationEnabled) return;
    
    this.volumeOscillationEnabled = enabled;
    
    if (this.isPlaying) {
      if (enabled) {
        this.startVolumeOscillation();
      } else {
        this.stopVolumeOscillation();
      }
    }
  }
  
  // Add getter for volume oscillation state
  public isVolumeOscillationEnabled(): boolean {
    return this.volumeOscillationEnabled;
  }
  
  public dispose(): void {
    this.setPlaying(false);
    this.stopSweep();
    this.stopEnvelopeModulation();
    this.stopVolumeOscillation();
    this.stopBackgroundNoise();
  }
  
  // Add this new public method to expose the current path position
  public getPathPosition(): number {
    return this.pathPosition;
  }
  
  // New method to set manual position control
  public setManualPosition(position: number): void {
    this.isManualControl = true;
    this.manualPosition = Math.max(0, Math.min(1, position));
  }
  
  // New method to turn off manual control
  public setManualControl(enabled: boolean): void {
    this.isManualControl = enabled;
    if (!enabled) {
      // Reset to the current path position when turning off manual control
      this.pathPosition = this.manualPosition;
    }
  }
  
  // New method to resume automatic movement from a specific position
  public resumeFromPosition(position: number): void {
    this.pathPosition = Math.max(0, Math.min(1, position));
    this.isManualControl = false;
  }
  
  // Add method to create and return an analyzer
  public createPreEQAnalyser(): AnalyserNode {
    const ctx = getAudioContext();
    
    // If we already have one, return it
    if (this.preEQAnalyser) {
      return this.preEQAnalyser;
    }
    
    // Create analyzer node
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    
    // Create gain node for analyzer connection
    const preEQGain = ctx.createGain();
    preEQGain.gain.value = 1.0;
    
    // Connect the gain node to analyzer and EQ
    preEQGain.connect(analyser);
    const eq = eqProcessor.getEQProcessor();
    preEQGain.connect(eq.getInputNode());
    
    // Store for later access
    this.preEQAnalyser = analyser;
    this.preEQGain = preEQGain;
    
    // If we're playing, reconnect all nodes through the analyzer
    if (this.isPlaying) {
      this.audioNodes.forEach(node => {
        if (node.panner) {
          node.panner.disconnect();
          node.panner.connect(preEQGain);
        }
      });
    }
    
    return analyser;
  }
  
  // Add method to get the current analyzer
  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser;
  }
  
  // Add method to get current audio parameters - returns parameters for a node in the middle
  public getAudioParameters(): { frequency: number, panning: number } {
    // Default values
    let frequency = 0;
    let panning = 0;
    
    // If we have nodes, get values from a node in the middle
    if (this.audioNodes.length > 0) {
      const middleIndex = Math.floor(this.audioNodes.length / 2);
      const middleNode = this.audioNodes[middleIndex];
      
      if (middleNode.filter) {
        frequency = middleNode.filter.frequency.value;
      }
      
      if (middleNode.panner) {
        panning = middleNode.panner.pan.value;
      }
    }
    
    return { frequency, panning };
  }
  
  // Add method to set subsection bounds
  public setSubsection(start: number, end: number, enabled: boolean = true): void {
    // Clamp values between 0 and 1 but don't enforce start <= end
    this.subsectionStart = Math.max(0, Math.min(1, start));
    this.subsectionEnd = Math.max(0, Math.min(1, end));
    this.useSubsection = enabled;
    
    // If playing, update nodes to reflect the subsection
    if (this.isPlaying && enabled) {
      // Recalculate node positions based on subsection
      this.setupNodesForGlyph();
    }
    
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
    
    // If playing, regenerate nodes for full range
    if (this.isPlaying) {
      this.setupNodesForGlyph();
    }
  }
  
  // Add getter and setter for speed
  public setSpeed(speed: number): void {
    // Ensure speed is positive and reasonable (between 0.25x and 20x)
    this.speed = Math.max(0.25, Math.min(20.0, speed));
  }
  
  public getSpeed(): number {
    return this.speed;
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
    this.discreteFrequency = useDiscrete;
  }
  
  // Add getter for current frequency update mode
  public isDiscreteFrequency(): boolean {
    return this.discreteFrequency;
  }
  
  // Add method to handle distortion gain
  private setDistortionGain(gain: number): void {
    // Clamp gain between 0 and 1
    this.distortionGain = Math.max(0, Math.min(1, gain));
    
    // If playing, apply to all gain nodes
    if (this.isPlaying) {
      this.audioNodes.forEach(node => {
        if (node.gain) {
          // Apply directly to each node's gain
          const baseGain = MASTER_GAIN * this.distortionGain / NUM_NODES;
          node.gain.gain.value = baseGain;
        }
      });
    }
  }
  
  // Add method to handle background noise
  private startBackgroundNoise(): void {
    if (!this.pinkNoiseBuffer) return;
    
    const ctx = getAudioContext();
    
    // Create new audio nodes for background noise
    const source = ctx.createBufferSource();
    source.buffer = this.pinkNoiseBuffer;
    source.loop = true;
    
    // Create gain node for volume control
    const gain = ctx.createGain();
    gain.gain.value = this.backgroundNoiseVolume;
    
    // Create panner node that will follow main panner
    const panner = ctx.createStereoPanner();
    panner.pan.value = 0; // Center the background noise
    
    // Connect background noise chain
    source.connect(gain);
    gain.connect(panner);
    
    // Connect to EQ processor
    const eq = eqProcessor.getEQProcessor();
    panner.connect(eq.getInputNode());
    
    // Store nodes
    this.backgroundNoiseNodes = {
      source,
      gain,
      panner
    };
    
    // Start the source
    source.start();
  }
  
  private stopBackgroundNoise(): void {
    if (this.backgroundNoiseNodes.source) {
      this.backgroundNoiseNodes.source.stop();
      this.backgroundNoiseNodes.source.disconnect();
    }
    
    if (this.backgroundNoiseNodes.gain) {
      this.backgroundNoiseNodes.gain.disconnect();
    }
    
    if (this.backgroundNoiseNodes.panner) {
      this.backgroundNoiseNodes.panner.disconnect();
    }
    
    // Reset background noise nodes
    this.backgroundNoiseNodes = {
      source: null,
      gain: null,
      panner: null
    };
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