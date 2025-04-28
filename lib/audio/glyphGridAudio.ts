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
  private isPlaying: boolean = false
  private audioNodes: {
    source: OscillatorNode | null;
    gain: GainNode | null;
    panner: StereoPannerNode | null;
  } = {
    source: null,
    gain: null,
    panner: null,
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
  
  private constructor() {
    // Removed generatePinkNoiseBuffer call
    
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
  
  // Removed generatePinkNoiseBuffer method
  
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
    
    // Map x to pan position (-1 to 1)
    const panPosition = x
    
    // Now update the audio nodes with these values
    // Set oscillator frequency directly
    if (this.audioNodes.source) {
      this.audioNodes.source.frequency.value = adjustedFreq
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
    // Removed pink noise buffer check
    
    const ctx = getAudioContext()
    
    // Create new audio nodes
    const source = ctx.createOscillator() // Changed to OscillatorNode
    source.type = 'sine' // Set type to sine
    source.frequency.value = 500 // Default starting frequency
    
    // Create gain node for volume - apply distortion gain
    const gain = ctx.createGain()
    gain.gain.value = MASTER_GAIN * this.distortionGain;
    
    // Removed envelope gain node
    
    // Create panner node
    const panner = ctx.createStereoPanner()
    panner.pan.value = 0 // Start centered
    
    // Removed filter node
    
    // Connect the audio chain: oscillator -> gain -> panner
    source.connect(gain)
    gain.connect(panner)
    
    // If we have an analyzer, connect through it
    if (this.preEQAnalyser && this.preEQGain) {
      panner.connect(this.preEQGain)
      // preEQGain is already connected to destination and analyzer
    } else {
      // Connect to EQ processor directly
      const eq = eqProcessor.getEQProcessor()
      panner.connect(eq.getInputNode())
    }
    
    // Store the nodes
    this.audioNodes = {
      source,
      gain,
      panner,
      // Removed filter and envelopeGain
    }
    
    // Start the source
    source.start()
    
    // Start the animation loop to update path position
    this.startAnimationLoop()
    
    // Removed startEnvelopeModulation call
  }
  
  private startAnimationLoop(): void {
    const animate = () => {
      this.updateAudioNodesFromGlyph()
      this.animationFrameId = requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  private stopSound(): void {
    // Removed stopEnvelopeModulation call
    
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
    
    if (this.audioNodes.source) {
      this.audioNodes.source.stop()
      this.audioNodes.source.disconnect()
    }
    
    if (this.audioNodes.gain) {
      this.audioNodes.gain.disconnect()
    }
    
    // Removed envelopeGain disconnect
    
    // Removed filter disconnect
    
    if (this.audioNodes.panner) {
      this.audioNodes.panner.disconnect()
    }
    
    // Reset audio nodes
    this.audioNodes = {
      source: null,
      gain: null,
      panner: null,
      // Removed filter and envelopeGain
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
  
  // Removed modulation methods: setModulating, isModulationEnabled, setModulationRate, setModulationDepth, startEnvelopeModulation, stopEnvelopeModulation
  
  public dispose(): void {
    this.setPlaying(false)
    this.stopSweep()
    // Removed stopEnvelopeModulation call
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
    if (this.isPlaying && this.audioNodes.panner) { // Removed filter check
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
    if (this.audioNodes.source) { // Check source for frequency
      frequency = this.audioNodes.source.frequency.value;
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
    
    // If playing, apply to active gain node
    if (this.isPlaying && this.audioNodes.gain) {
      // Apply directly to the gain node
      this.audioNodes.gain.gain.value = MASTER_GAIN * this.distortionGain;
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