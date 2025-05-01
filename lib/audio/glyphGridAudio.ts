import { getAudioContext } from '@/lib/audio/audioContext'
import * as eqProcessor from '@/lib/audio/eqProcessor'
import { useEQProfileStore } from '@/lib/stores'

// Default values
const DEFAULT_FREQ_MULTIPLIER = 1.0
const DEFAULT_SWEEP_DURATION = 8.0 // 8 seconds per cycle
const SINE_GAIN = 0.01 // Make sine tone much quieter
const NOISE_GAIN = 0.5 // Adjust NOISE_GAIN as we now have two sources
// const ENVELOPE_ATTACK = 0.01 // 10ms
// const ENVELOPE_RELEASE_LOW_FREQ = 0.8 // 800ms for low frequencies
// const ENVELOPE_RELEASE_HIGH_FREQ = 0.2 // 200ms for high frequencies
// const ENVELOPE_MAX_GAIN = 1.0
// const ENVELOPE_MIN_GAIN = 0.001
// const DEFAULT_MODULATION_RATE = 8.0 // modulations per second
// const DEFAULT_MODULATION_DEPTH = 0.8 // how much to modulate (0-1)
// const ENVELOPE_ATTACK_TIME = 0.005 // 5ms attack
// const ENVELOPE_RELEASE_TIME = 0.05 // 100ms release
const DEFAULT_SPEED = 1.0 // Default movement speed
const NOISE_FILTER_Q = 3.0 // Q factor for the HP/LP noise filters (higher = steeper cutoff)
const NOISE_BANDWIDTH_OCTAVES = 3.0 // Bandwidth between HP and LP filters in octaves

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

class GlyphGridAudioPlayer {
  private static instance: GlyphGridAudioPlayer
  private pinkNoiseBuffer: AudioBuffer | null = null
  private isPlaying: boolean = false
  private audioNodes: {
    oscillatorSource: OscillatorNode | null;
    sineGain: GainNode | null;
    noiseSourceHP: AudioBufferSourceNode | null;
    noiseFilterHP: BiquadFilterNode | null;
    noiseGainHP: GainNode | null;
    noiseSourceLP: AudioBufferSourceNode | null;
    noiseFilterLP: BiquadFilterNode | null;
    noiseGainLP: GainNode | null;
    mixerGain: GainNode | null;
    panner: StereoPannerNode | null;
  } = {
    oscillatorSource: null,
    sineGain: null,
    noiseSourceHP: null,
    noiseFilterHP: null,
    noiseGainHP: null,
    noiseSourceLP: null,
    noiseFilterLP: null,
    noiseGainLP: null,
    mixerGain: null,
    panner: null
  }
  
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
  
  private constructor() {
    // Add back pink noise generation call
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
      channelData[i] = pink * 0.11 // Pink noise generally needs scaling down
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
          // This is a hit point (reached end)
          this.updateAudioParametersFromPosition(this.pathPosition)
        } else if (this.pathPosition <= min) {
          this.pathPosition = min
          this.pathDirection = 1
          // This is a hit point (reached start)
          this.updateAudioParametersFromPosition(this.pathPosition)
        } else if (this.discreteFrequency) {
          // Check if we crossed a hit point
          const hitInterval = DEFAULT_HIT_INTERVAL
          const currentInterval = Math.floor(this.pathPosition / hitInterval)
          const previousInterval = Math.floor(previousPosition / hitInterval)
          
          if (currentInterval !== previousInterval) {
            // We crossed a hit point, update audio
            this.updateAudioParametersFromPosition(this.pathPosition)
          }
        } else {
          // Continuous mode - always update
          this.updateAudioParametersFromPosition(this.pathPosition)
        }
      } else {
        // Regular full-range behavior
        if (this.pathPosition >= 1) {
          this.pathPosition = 1
          this.pathDirection = -1
          // This is a hit point (reached end)
          this.updateAudioParametersFromPosition(this.pathPosition)
        } else if (this.pathPosition <= 0) {
          this.pathPosition = 0
          this.pathDirection = 1
          // This is a hit point (reached start)
          this.updateAudioParametersFromPosition(this.pathPosition)
        } else if (this.discreteFrequency) {
          // Check if we crossed a hit point
          const hitInterval = DEFAULT_HIT_INTERVAL
          const currentInterval = Math.floor(this.pathPosition / hitInterval)
          const previousInterval = Math.floor(previousPosition / hitInterval)
          
          if (currentInterval !== previousInterval) {
            // We crossed a hit point, update audio
            this.updateAudioParametersFromPosition(this.pathPosition)
          }
        } else {
          // Continuous mode - always update
          this.updateAudioParametersFromPosition(this.pathPosition)
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
        
        // Update audio parameters at each alternation point
        this.updateAudioParametersFromPosition(this.pathPosition)
      }
    }
  }
  
  // New method to update audio parameters from a position
  private updateAudioParametersFromPosition(position: number): void {
    if (!this.currentGlyph) return
    
    // Get the glyph's position and size
    const { position: glyphPos, size: glyphSize } = this.currentGlyph
    
    // Calculate the actual x and y in normalized space (-1 to 1)
    const startX = glyphPos.x - glyphSize.width / 2
    const startY = glyphPos.y - glyphSize.height / 2
    const endX = glyphPos.x + glyphSize.width / 2
    const endY = glyphPos.y + glyphSize.height / 2
    
    // Interpolate between start and end points
    const x = startX + position * (endX - startX)
    const y = startY + position * (endY - startY)
    
    // Map y to frequency (bottom = low, top = high)
    const minFreq = 20
    const maxFreq = 20000
    
    // Properly normalize y from glyph space to full 0-1 range
    const normalizedY = Math.max(0, Math.min(1, (y + 1) / 2))
    
    // Map to logarithmic frequency scale
    const logMinFreq = Math.log2(minFreq)
    const logMaxFreq = Math.log2(maxFreq)
    const logFreqRange = logMaxFreq - logMinFreq
    const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange)
    
    // Apply frequency multiplier
    const adjustedFreq = centerFreq * this.freqMultiplier

    // Calculate HP and LP cutoff frequencies based on bandwidth
    const octaveMultiplier = Math.pow(2, NOISE_BANDWIDTH_OCTAVES / 2)
    let hpCutoff = adjustedFreq * octaveMultiplier
    let lpCutoff = adjustedFreq / octaveMultiplier

    // Clamp frequencies to avoid issues
    const minClampFreq = 20
    const maxClampFreq = 20000 // Or use ctx.sampleRate / 2 if needed
    hpCutoff = Math.max(minClampFreq, Math.min(maxClampFreq, hpCutoff))
    lpCutoff = Math.max(minClampFreq, Math.min(maxClampFreq, lpCutoff))
    const finalOscFreq = Math.max(minClampFreq, Math.min(maxClampFreq, adjustedFreq))
    
    // Map x to pan position (-1 to 1)
    const panPosition = x
    
    // Now update the audio nodes with these values
    if (this.audioNodes.oscillatorSource) {
      this.audioNodes.oscillatorSource.frequency.value = finalOscFreq
    }
    
    if (this.audioNodes.noiseFilterHP) {
      this.audioNodes.noiseFilterHP.frequency.value = hpCutoff
    }
    
    if (this.audioNodes.noiseFilterLP) {
      this.audioNodes.noiseFilterLP.frequency.value = lpCutoff
    }
    
    if (this.audioNodes.panner) {
      this.audioNodes.panner.pan.value = panPosition
    }
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
    // Add check for pink noise buffer again
    if (!this.pinkNoiseBuffer) {
      console.warn('🔊 Tried to start sound but pink noise buffer is not ready')
      return
    }
    
    const ctx = getAudioContext()
    
    // --- Create Sine Path Nodes ---
    const oscillatorSource = ctx.createOscillator()
    oscillatorSource.type = 'sine' // Use sine wave
    const sineGain = ctx.createGain()
    sineGain.gain.value = SINE_GAIN

    // --- Create Noise Path Nodes (High Pass) ---
    const noiseSourceHP = ctx.createBufferSource()
    noiseSourceHP.buffer = this.pinkNoiseBuffer
    noiseSourceHP.loop = true
    const noiseFilterHP = ctx.createBiquadFilter()
    noiseFilterHP.type = 'highpass'
    noiseFilterHP.frequency.value = 800 // Default frequency, will be updated
    noiseFilterHP.Q.value = NOISE_FILTER_Q
    const noiseGainHP = ctx.createGain()
    noiseGainHP.gain.value = NOISE_GAIN

    // --- Create Noise Path Nodes (Low Pass) ---
    const noiseSourceLP = ctx.createBufferSource()
    noiseSourceLP.buffer = this.pinkNoiseBuffer // Use the same buffer
    noiseSourceLP.loop = true
    const noiseFilterLP = ctx.createBiquadFilter()
    noiseFilterLP.type = 'lowpass'
    noiseFilterLP.frequency.value = 200 // Default frequency, will be updated
    noiseFilterLP.Q.value = NOISE_FILTER_Q
    const noiseGainLP = ctx.createGain()
    noiseGainLP.gain.value = NOISE_GAIN

    // --- Create Mixer and Panner Nodes ---
    const mixerGain = ctx.createGain()
    mixerGain.gain.value = this.distortionGain // Apply current distortion gain
    const panner = ctx.createStereoPanner()
    panner.pan.value = 0 // Start centered
    
    // --- Connect Audio Graph ---
    // Sine Path: oscillatorSource -> sineGain -> mixerGain
    oscillatorSource.connect(sineGain)
    sineGain.connect(mixerGain)
    
    // Noise Path (HP): noiseSourceHP -> noiseFilterHP -> noiseGainHP -> mixerGain
    noiseSourceHP.connect(noiseFilterHP)
    noiseFilterHP.connect(noiseGainHP)
    noiseGainHP.connect(mixerGain)

    // Noise Path (LP): noiseSourceLP -> noiseFilterLP -> noiseGainLP -> mixerGain
    noiseSourceLP.connect(noiseFilterLP)
    noiseFilterLP.connect(noiseGainLP)
    noiseGainLP.connect(mixerGain)
    
    // Combined Path: mixerGain -> panner -> Output
    mixerGain.connect(panner)
    
    // Connect panner to output (preEQ analyser or EQ input)
    if (this.preEQAnalyser && this.preEQGain) {
      panner.connect(this.preEQGain)
      // preEQGain is already connected to analyser and EQ input
    } else {
      // Connect directly to EQ processor input
      const eq = eqProcessor.getEQProcessor()
      panner.connect(eq.getInputNode())
    }
    
    // Store the nodes
    this.audioNodes = {
      oscillatorSource,
      sineGain,
      noiseSourceHP,
      noiseFilterHP,
      noiseGainHP,
      noiseSourceLP,
      noiseFilterLP,
      noiseGainLP,
      mixerGain,
      panner,
    }
    
    // Start the sources
    oscillatorSource.start()
    noiseSourceHP.start()
    noiseSourceLP.start()
    
    // Start the animation loop to update path position
    this.startAnimationLoop()
  }
  
  private startAnimationLoop(): void {
    const animate = () => {
      this.updateAudioNodesFromGlyph()
      this.animationFrameId = requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  private stopSound(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    
    // Stop sources
    if (this.audioNodes.oscillatorSource) {
      this.audioNodes.oscillatorSource.stop()
      this.audioNodes.oscillatorSource.disconnect()
    }
    if (this.audioNodes.noiseSourceHP) {
      this.audioNodes.noiseSourceHP.stop()
      this.audioNodes.noiseSourceHP.disconnect()
    }
    if (this.audioNodes.noiseSourceLP) {
      this.audioNodes.noiseSourceLP.stop()
      this.audioNodes.noiseSourceLP.disconnect()
    }
    
    // Disconnect gains and filters
    if (this.audioNodes.sineGain) {
      this.audioNodes.sineGain.disconnect()
    }
    if (this.audioNodes.noiseGainHP) {
      this.audioNodes.noiseGainHP.disconnect()
    }
    if (this.audioNodes.noiseGainLP) {
      this.audioNodes.noiseGainLP.disconnect()
    }
    if (this.audioNodes.noiseFilterHP) {
      this.audioNodes.noiseFilterHP.disconnect()
    }
    if (this.audioNodes.noiseFilterLP) {
      this.audioNodes.noiseFilterLP.disconnect()
    }
    
    // Disconnect mixer and panner
    if (this.audioNodes.mixerGain) {
      this.audioNodes.mixerGain.disconnect()
    }
    if (this.audioNodes.panner) {
      this.audioNodes.panner.disconnect()
    }
    
    // Reset audio nodes
    this.audioNodes = {
      oscillatorSource: null,
      sineGain: null,
      noiseSourceHP: null,
      noiseFilterHP: null,
      noiseGainHP: null,
      noiseSourceLP: null,
      noiseFilterLP: null,
      noiseGainLP: null,
      mixerGain: null,
      panner: null,
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
    if (this.isPlaying && this.audioNodes.oscillatorSource && this.audioNodes.panner) {
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
    let frequency = 0;
    let panning = 0;
    
    // Get values from audio nodes if available
    if (this.audioNodes.oscillatorSource) {
      frequency = this.audioNodes.oscillatorSource.frequency.value;
    }
    
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
    
    // If playing, apply to active mixer gain node
    if (this.isPlaying && this.audioNodes.mixerGain) {
      // Apply directly to the mixer gain node, remove MASTER_GAIN multiplication
      this.audioNodes.mixerGain.gain.value = this.distortionGain; 
      console.log(`🔊 Glyph Grid distortion gain set to ${this.distortionGain.toFixed(2)}`);
    }
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