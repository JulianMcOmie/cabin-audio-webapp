import { getAudioContext } from '@/lib/audio/audioContext'

// Default values
const DEFAULT_FREQ_MULTIPLIER = 1.0
const DEFAULT_SWEEP_DURATION = 8.0 // 8 seconds per cycle
const MASTER_GAIN = 0.5
const ENVELOPE_ATTACK = 0.01 // 10ms
const ENVELOPE_RELEASE_LOW_FREQ = 0.8 // 800ms for low frequencies
const ENVELOPE_RELEASE_HIGH_FREQ = 0.2 // 200ms for high frequencies
const ENVELOPE_MAX_GAIN = 1.0
const ENVELOPE_MIN_GAIN = 0.001
const DEFAULT_MODULATION_RATE = 8.0 // modulations per second
const DEFAULT_MODULATION_DEPTH = 0.8 // how much to modulate (0-1)
const ENVELOPE_ATTACK_TIME = 0.005 // 5ms attack
const ENVELOPE_RELEASE_TIME = 0.1 // 100ms release

export enum PlaybackMode {
  PATH = 'path', // Follow the path continuously back and forth
  OSCILLATE = 'oscillate' // Oscillate through the path at varying speeds
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
    source: AudioBufferSourceNode | null;
    gain: GainNode | null;
    envelopeGain: GainNode | null;
    panner: StereoPannerNode | null;
    filter: BiquadFilterNode | null;
  } = {
    source: null,
    gain: null,
    envelopeGain: null,
    panner: null,
    filter: null
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
  
  private constructor() {
    this.generatePinkNoiseBuffer()
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
    
    const ctx = getAudioContext()
    
    // Get current position on the path (0 to 1)
    // For a diagonal line, this maps directly to both x and y
    const position = this.pathPosition
    
    // Get the glyph's position and size
    const { position: glyphPos, size: glyphSize } = this.currentGlyph
    
    // Calculate the actual x and y in normalized space (-1 to 1)
    // For a diagonal line, start at bottom-left, end at top-right
    const startX = glyphPos.x - glyphSize.width / 2
    const startY = glyphPos.y - glyphSize.height / 2
    const endX = glyphPos.x + glyphSize.width / 2
    const endY = glyphPos.y + glyphSize.height / 2
    
    // Interpolate between start and end points
    const x = startX + position * (endX - startX)
    const y = startY + position * (endY - startY)
    
    // Map y to frequency (bottom = low, top = high)
    const minFreq = 20 // Lower minimum for better low-end
    const maxFreq = 20000 // Lower maximum to avoid harsh high-end
    
    // Properly normalize y from glyph space to full 0-1 range
    // This ensures we fully reach 0 at bottom and 1 at top
    const normalizedY = Math.max(0, Math.min(1, (y + 1) / 2))

    // For debugging - check if we're hitting the full range
    if (position === 0 || position === 1) {
      console.log(`🔊 At ${position === 0 ? 'start' : 'end'} - Normalized y: ${normalizedY.toFixed(4)}, Raw y: ${y.toFixed(4)}`)
    }
    
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
    if (this.audioNodes.filter) {
      this.audioNodes.filter.frequency.value = adjustedFreq
    }
    
    if (this.audioNodes.panner) {
      this.audioNodes.panner.pan.value = panPosition
    }
    
    // Move the path position
    this.pathPosition += 0.005 * this.pathDirection
    
    // Reverse direction at ends
    if (this.pathPosition >= 1) {
      this.pathPosition = 1
      this.pathDirection = -1
    } else if (this.pathPosition <= 0) {
      this.pathPosition = 0
      this.pathDirection = 1
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
    if (!this.pinkNoiseBuffer) {
      console.warn('🔊 Tried to start sound but pink noise buffer is not ready')
      return
    }
    
    const ctx = getAudioContext()
    
    // Create new audio nodes
    const source = ctx.createBufferSource()
    source.buffer = this.pinkNoiseBuffer
    source.loop = true
    
    // Create gain node for volume
    const gain = ctx.createGain()
    gain.gain.value = MASTER_GAIN
    
    // Create envelope gain node
    const envelopeGain = ctx.createGain()
    envelopeGain.gain.value = ENVELOPE_MAX_GAIN
    
    // Create panner node
    const panner = ctx.createStereoPanner()
    panner.pan.value = 0 // Start centered
    
    // Create filter node (bandpass filter)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 500 // Default frequency
    filter.Q.value = 3.0 // Default Q
    
    // Connect the nodes
    source.connect(gain)
    gain.connect(envelopeGain)
    envelopeGain.connect(filter)
    filter.connect(panner)
    panner.connect(ctx.destination)
    
    // Store the nodes
    this.audioNodes = {
      source,
      gain,
      envelopeGain,
      panner,
      filter
    }
    
    // Start the source
    source.start()
    
    // Start the animation loop to update path position
    this.startAnimationLoop()
    
    // Start envelope modulation if enabled
    if (this.isModulating) {
      this.startEnvelopeModulation()
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
    
    if (this.audioNodes.source) {
      this.audioNodes.source.stop()
      this.audioNodes.source.disconnect()
    }
    
    if (this.audioNodes.gain) {
      this.audioNodes.gain.disconnect()
    }
    
    if (this.audioNodes.envelopeGain) {
      this.audioNodes.envelopeGain.disconnect()
    }
    
    if (this.audioNodes.filter) {
      this.audioNodes.filter.disconnect()
    }
    
    if (this.audioNodes.panner) {
      this.audioNodes.panner.disconnect()
    }
    
    // Reset audio nodes
    this.audioNodes = {
      source: null,
      gain: null,
      envelopeGain: null,
      panner: null,
      filter: null
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
    const startMultiplier = this.freqMultiplier
    
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
    
    const triggerEnvelope = () => {
      if (!this.audioNodes.envelopeGain) return
      
      const ctx = getAudioContext()
      const now = ctx.currentTime
      
      // Calculate the minimum gain based on modulation depth
      const minGain = ENVELOPE_MAX_GAIN * (1 - this.modulationDepth)
      
      // Reset to minimum gain
      this.audioNodes.envelopeGain.gain.cancelScheduledValues(now)
      this.audioNodes.envelopeGain.gain.setValueAtTime(minGain, now)
      
      // Attack phase - quick ramp to max gain
      this.audioNodes.envelopeGain.gain.linearRampToValueAtTime(
        ENVELOPE_MAX_GAIN, 
        now + ENVELOPE_ATTACK_TIME
      )
      
      // Release phase - slower decay back to min gain
      this.audioNodes.envelopeGain.gain.linearRampToValueAtTime(
        minGain,
        now + ENVELOPE_ATTACK_TIME + ENVELOPE_RELEASE_TIME
      )

      console.log('🔊 Envelope modulation triggered')
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
    
    // Reset envelope gain to max if available
    if (this.audioNodes.envelopeGain) {
      const ctx = getAudioContext()
      this.audioNodes.envelopeGain.gain.cancelScheduledValues(ctx.currentTime)
      this.audioNodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MAX_GAIN, ctx.currentTime)
    }
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