import { getAudioContext } from '@/lib/audio/audioContext'
import * as eqProcessor from '@/lib/audio/eqProcessor'
import { useEQProfileStore } from '@/lib/stores'

// Default values
const DEFAULT_FREQ_MULTIPLIER = 1.0
const DEFAULT_SWEEP_DURATION = 8.0 // 8 seconds per cycle
const MASTER_GAIN = 1.5
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

// Add constants for hit detection
const DEFAULT_HIT_INTERVAL = 0.2 // Default interval between hits (20% of path)

// Number of noise sources along the line
const DEFAULT_NUM_SOURCES = 5
// Stagger offset between sources as percentage of total interval - INCREASED
const DEFAULT_STAGGER_OFFSET = 0.8 // 80% of the modulation interval

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

class GlyphGridAudioPlayer {
  private static instance: GlyphGridAudioPlayer
  private pinkNoiseBuffer: AudioBuffer | null = null
  private isPlaying: boolean = false
  
  // Replace single audioNodes with array of nodes
  private audioNodeGroups: Array<{
    source: AudioBufferSourceNode | null;
    gain: GainNode | null;
    envelopeGain: GainNode | null;
    panner: StereoPannerNode | null;
    filter: BiquadFilterNode | null;
    position: number; // Fixed position along the line (0-1)
  }> = [];
  
  // Main output/analyzer chain
  private mainOutputGain: GainNode | null = null;
  
  // Path related properties
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
  private isModulating: boolean = true
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
  private discreteFrequency: boolean = true // Whether to use discrete or continuous frequency
  
  // Add distortion gain property
  private distortionGain: number = 1.0;
  
  // Add number of sources property
  private numberOfSources: number = DEFAULT_NUM_SOURCES;
  
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
    const previousGlyph = this.currentGlyph;
    this.currentGlyph = glyph;
    
    // Check if we need to update the audio nodes due to a glyph change
    if (this.isPlaying && previousGlyph !== null && 
       (previousGlyph.position.x !== glyph.position.x || 
        previousGlyph.position.y !== glyph.position.y ||
        previousGlyph.size.width !== glyph.size.width ||
        previousGlyph.size.height !== glyph.size.height)) {
      
      // Update all audio nodes to reflect the new glyph position
      this.updateAllAudioNodes();
    }
  }
  
  // New method to update all audio nodes when the glyph changes
  private updateAllAudioNodes(): void {
    if (!this.currentGlyph || this.audioNodeGroups.length === 0) return;
    
    // Update each audio node group based on its fixed position along the line
    this.audioNodeGroups.forEach(group => {
      if (group.filter && group.panner) {
        this.updateAudioParametersForSource(group.position, group.filter, group.panner);
      }
    });
  }
  
  private updateAudioNodesFromGlyph(): void {
    if (!this.currentGlyph) return
    
    // Only update the path position for UI purposes,
    // not source audio parameters
    this.updatePathPosition()
  }
  
  private updatePathPosition(): void {
    if (!this.currentGlyph) return
    
    // If in manual control mode, use the manually set position
    if (this.isManualControl) {
      const position = this.manualPosition
      this.pathPosition = position
      return
    }
    
    // Store previous position to detect hit crossing
    const previousPosition = this.pathPosition
    
    // Calculate new position based on playback mode
    if (this.playbackMode === PlaybackMode.SWEEP) {
      // Apply speed factor to the position increment
      this.pathPosition += 0.005 * this.pathDirection * this.speed
      
      // If using subsection, check subsection boundaries
      if (this.useSubsection) {
        // Handle both normal and reversed subsection ranges
        const min = Math.min(this.subsectionStart, this.subsectionEnd)
        const max = Math.max(this.subsectionStart, this.subsectionEnd)
        
        if (this.pathPosition >= max) {
          this.pathPosition = max
          this.pathDirection = -1
        } else if (this.pathPosition <= min) {
          this.pathPosition = min
          this.pathDirection = 1
        }
      } else {
        // Regular full-range behavior
        if (this.pathPosition >= 1) {
          this.pathPosition = 1
          this.pathDirection = -1
        } else if (this.pathPosition <= 0) {
          this.pathPosition = 0
          this.pathDirection = 1
        }
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
      }
    }
  }
  
  // This method is modified to be a no-op as we don't want to update fixed source positions
  private updateAudioParametersFromPosition(position: number): void {
    // No-op - sources should stay at their fixed positions
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
    
    // Create a main output gain node
    this.mainOutputGain = ctx.createGain();
    this.mainOutputGain.gain.value = 1.0;
    
    // Create analyzer if needed
    let analyzerOutput = this.mainOutputGain;
    if (this.preEQAnalyser && this.preEQGain) {
      this.mainOutputGain.connect(this.preEQGain);
      // preEQGain is already connected to analyzer
    } else {
      // Connect main output to EQ processor
      const eq = eqProcessor.getEQProcessor();
      this.mainOutputGain.connect(eq.getInputNode());
    }
    
    // Clear any existing audio nodes
    this.audioNodeGroups = [];
    
    // Create the specified number of audio sources evenly spread along the line
    for (let i = 0; i < this.numberOfSources; i++) {
      // Calculate fixed position along the line (0 to 1)
      const position = i / (this.numberOfSources - 1 || 1);
      
      // Create new audio nodes for this source
      const source = ctx.createBufferSource();
      source.buffer = this.pinkNoiseBuffer;
      source.loop = true;
      
      // Create gain node for volume - apply distortion gain
      const gain = ctx.createGain();
      gain.gain.value = (MASTER_GAIN * this.distortionGain) / Math.sqrt(this.numberOfSources);
      
      // Create envelope gain node
      const envelopeGain = ctx.createGain();
      envelopeGain.gain.value = 0.0; // Start silent
      
      // Create filter node (bandpass filter)
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 5.0; // Default Q
      
      // Create panner node
      const panner = ctx.createStereoPanner();
      
      // Connect the audio chain for this source
      source.connect(gain);
      gain.connect(envelopeGain);
      envelopeGain.connect(filter);
      filter.connect(panner);
      panner.connect(this.mainOutputGain);
      
      // Set the audio parameters based on position
      this.updateAudioParametersForSource(position, filter, panner);
      
      // Start the source
      source.start();
      
      // Add to our array of audio node groups
      this.audioNodeGroups.push({
        source,
        gain,
        envelopeGain,
        panner,
        filter,
        position
      });
    }
    
    // Start the animation loop
    this.startAnimationLoop();
    
    // Start envelope modulation if enabled
    if (this.isModulating) {
      this.startEnvelopeModulation();
    }
  }
  
  private startAnimationLoop(): void {
    const animate = () => {
      this.updateAudioNodesFromGlyph()
      this.animationFrameId = requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  private stopSound(): void {
    // Stop envelope modulation
    this.stopEnvelopeModulation()
    
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
    
    // Clean up and disconnect all audio nodes
    this.audioNodeGroups.forEach(group => {
      if (group.source) {
        group.source.stop()
        group.source.disconnect()
      }
      
      if (group.gain) group.gain.disconnect()
      if (group.envelopeGain) group.envelopeGain.disconnect()
      if (group.filter) group.filter.disconnect()
      if (group.panner) group.panner.disconnect()
    })
    
    // Clear the audio nodes array
    this.audioNodeGroups = []
    
    // Disconnect main output gain
    if (this.mainOutputGain) {
      this.mainOutputGain.disconnect()
      this.mainOutputGain = null
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
  
  public setModulating(enabled: boolean): void {
    if (this.isModulating === enabled) return
    
    this.isModulating = enabled
    
    if (enabled && this.isPlaying) {
      this.startEnvelopeModulation()
    } else {
      this.stopEnvelopeModulation()
    }
  }
  
  public isModulationEnabled(): boolean {
    return this.isModulating
  }
  
  public setModulationRate(rate: number): void {
    this.modulationRate = rate
    
    // If we're already modulating, restart with new rate
    if (this.isModulating && this.isPlaying) {
      this.stopEnvelopeModulation()
      this.startEnvelopeModulation()
    }
  }
  
  public setModulationDepth(depth: number): void {
    this.modulationDepth = Math.max(0, Math.min(1, depth)) // Clamp between 0 and 1
  }
  
  private startEnvelopeModulation(): void {
    if (this.modulationTimerId !== null) {
      clearInterval(this.modulationTimerId)
    }
    
    // Calculate interval in milliseconds based on rate
    const intervalMs = 1000 / this.modulationRate
    
    // Calculate stagger time - spread sources evenly across the entire interval
    const triggerEnvelope = () => {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      
      // Calculate the minimum gain based on modulation depth
      const minGain = ENVELOPE_MAX_GAIN * (1 - this.modulationDepth)
      
      // Spread triggers evenly across the interval for maximum staggering
      const staggerTime = intervalMs / this.numberOfSources
      
      // Trigger envelope for each source with staggered timing
      this.audioNodeGroups.forEach((group, index) => {
        if (!group.envelopeGain) return
        
        // Calculate staggered time offset based on source index
        // Spread triggers evenly across the interval
        const offsetTime = (staggerTime * index) / 1000 // Convert to seconds
        
        // Reset to minimum gain
        group.envelopeGain.gain.cancelScheduledValues(now + offsetTime)
        group.envelopeGain.gain.setValueAtTime(minGain, now + offsetTime)
        
        // Attack phase - quick ramp to max gain
        group.envelopeGain.gain.linearRampToValueAtTime(
          ENVELOPE_MAX_GAIN,
          now + offsetTime + ENVELOPE_ATTACK_TIME
        )
        
        // Release phase - slower decay back to min gain
        group.envelopeGain.gain.linearRampToValueAtTime(
          minGain,
          now + offsetTime + ENVELOPE_ATTACK_TIME + ENVELOPE_RELEASE_TIME
        )
      })
    }
    
    // Trigger immediately then start interval
    triggerEnvelope()
    this.modulationTimerId = window.setInterval(triggerEnvelope, intervalMs)
  }
  
  private stopEnvelopeModulation(): void {
    if (this.modulationTimerId !== null) {
      clearInterval(this.modulationTimerId)
      this.modulationTimerId = null
    }
    
    // Reset envelope gain to max if available for all sources
    const ctx = getAudioContext()
    this.audioNodeGroups.forEach(group => {
      if (group.envelopeGain) {
        group.envelopeGain.gain.cancelScheduledValues(ctx.currentTime)
        group.envelopeGain.gain.setValueAtTime(ENVELOPE_MAX_GAIN, ctx.currentTime)
      }
    })
  }
  
  public dispose(): void {
    this.setPlaying(false)
    this.stopSweep()
    this.stopEnvelopeModulation()
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
    
    // Connect if we're playing and have sources
    if (this.isPlaying && this.mainOutputGain) {
      // Disconnect the main output from its current destination
      this.mainOutputGain.disconnect()
      
      // Connect main output -> preEQGain -> analyser and preEQGain -> EQ input
      this.mainOutputGain.connect(preEQGain)
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
    let frequency = 0;
    let panning = 0;
    
    // If no sources, return defaults
    if (this.audioNodeGroups.length === 0) {
      return { frequency, panning };
    }
    
    // Sum values from all sources
    let freqSum = 0;
    let panSum = 0;
    
    this.audioNodeGroups.forEach(group => {
      if (group.filter) {
        freqSum += group.filter.frequency.value;
      }
      
      if (group.panner) {
        panSum += group.panner.pan.value;
      }
    });
    
    // Calculate average
    frequency = freqSum / this.audioNodeGroups.length;
    panning = panSum / this.audioNodeGroups.length;
    
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
    
    // If playing, apply to active gain nodes
    if (this.isPlaying) {
      this.audioNodeGroups.forEach(group => {
        if (group.gain) {
          // Apply distortion gain, divided by sqrt of number of sources to maintain overall volume
          group.gain.gain.value = (MASTER_GAIN * this.distortionGain) / Math.sqrt(this.numberOfSources);
        }
      });
      console.log(`🔊 Glyph Grid distortion gain set to ${this.distortionGain.toFixed(2)}`);
    }
  }
  
  // Add method to set number of sources
  public setNumberOfSources(count: number): void {
    this.numberOfSources = Math.max(1, Math.min(12, count));
    
    // If playing, restart the sound to apply the new setting
    if (this.isPlaying) {
      this.stopSound();
      this.startSound();
    }
  }
  
  public getNumberOfSources(): number {
    return this.numberOfSources;
  }
  
  // New method to update parameters for a single source
  private updateAudioParametersForSource(position: number, filter: BiquadFilterNode, panner: StereoPannerNode): void {
    if (!this.currentGlyph) return;
    
    // Get the glyph's position and size
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
    
    // Map x to pan position (-1 to 1)
    const panPosition = x;
    
    // Update the audio nodes with these values
    filter.frequency.value = adjustedFreq;
    panner.pan.value = panPosition;
  }
  
  // Add method to get the source positions for visualization
  public getSourcePositions(): number[] {
    return this.audioNodeGroups.map(group => group.position);
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