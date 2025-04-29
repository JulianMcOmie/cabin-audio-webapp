import { getAudioContext } from '@/lib/audio/audioContext'
import * as eqProcessor from '@/lib/audio/eqProcessor'
import { useEQProfileStore } from '@/lib/stores'

// Types
export type GlyphType = 'line' | 'circle' | 'diamond' | 'triangle';

// Default values
const DEFAULT_FREQ_MULTIPLIER = 1.0
// const DEFAULT_SWEEP_DURATION = 8.0 // No longer needed
const MASTER_GAIN = 1.5
const DEFAULT_SPEED = 1.0 // Speed multiplier for path animation
const REFERENCE_FREQUENCY = 1000 // Hz, for pink noise gain adjustment
const DEFAULT_NUMBER_OF_TONES = 5

// Removed PlaybackMode enum

// Simple glyph representation
export interface GlyphData {
  id: string;
  type: GlyphType;
  position: { x: number, y: number }; // Center position
  size: { width: number, height: number }; // Size of the glyph
  angle?: number; // Optional rotation angle
}

interface ToneAudioNodes {
  source: OscillatorNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

class GlyphGridAudioPlayer {
  private static instance: GlyphGridAudioPlayer
  private isPlaying: boolean = false
  // Store an array of nodes, one set per tone
  private audioNodesArray: ToneAudioNodes[] = []

  // Path animation properties
  private pathPosition: number = 0 // Current start offset (0 to 1)
  private speed: number = DEFAULT_SPEED
  private animationFrameId: number | null = null
  private lastTimestamp: number = 0 // For calculating delta time in animation

  // Current glyph data
  private currentGlyph: GlyphData | null = null

  // Removed modulation properties
  // Removed manual control properties

  // Keep preEQAnalyser for visualization
  private preEQAnalyser: AnalyserNode | null = null
  private preEQGain: GainNode | null = null // Gain node before analyser/EQ

  // Removed subsection properties
  // Removed playbackMode property
  // Removed alternateCounter
  // Removed hitPoints, lastHitIndex, discreteFrequency

  // Keep distortion gain
  private distortionGain: number = 1.0;

  // Add number of tones
  private numberOfTones: number = DEFAULT_NUMBER_OF_TONES;

  // Frequency multiplier still potentially useful
  private freqMultiplier: number = DEFAULT_FREQ_MULTIPLIER

  private constructor() {
    // Apply initial distortion gain from store
    const initialDistortionGain = useEQProfileStore.getState().distortionGain;
    this.distortionGain = Math.max(0, Math.min(1, initialDistortionGain)); // Apply clamped gain initially

    // Subscribe to distortion gain changes from the store
    useEQProfileStore.subscribe(
      (state) => {
        // Apply gain changes to all active nodes
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

  // Method to set the number of tones
  public setNumberOfTones(count: number): void {
    const newCount = Math.max(1, Math.min(50, Math.round(count))); // Clamp between 1 and 50
    if (newCount === this.numberOfTones) return;

    this.numberOfTones = newCount;
    console.log(`🔊 Set number of tones to ${this.numberOfTones}`);

    // Restart sound if playing to apply the new number of tones
    if (this.isPlaying) {
      this.stopSound();
      this.startSound();
    }
  }

  public getNumberOfTones(): number {
    return this.numberOfTones;
  }

  // Method to set speed
  public setSpeed(newSpeed: number): void {
    this.speed = Math.max(0.05, Math.min(10.0, newSpeed)); // Clamp speed
    console.log(`🔊 Set speed to ${this.speed.toFixed(2)}x`);
    // No need to restart sound, speed affects animation loop directly
  }

  public getSpeed(): number {
    return this.speed;
  }

  // Method to get current path position (for UI)
  public getPathPosition(): number {
    return this.pathPosition;
  }

  // Helper function to calculate (x, y) for a point on the glyph path
  // This needs to be public if the UI needs it to draw dots
  public calculatePositionOnGlyph(
    glyph: GlyphData,
    progress: number // 0 to 1
  ): { x: number, y: number } {
    const { type, position: glyphPos, size: glyphSize } = glyph;
    const centerX = glyphPos.x;
    const centerY = glyphPos.y;
    const radiusX = glyphSize.width / 2;
    const radiusY = glyphSize.height / 2;
    let x: number;
    let y: number;

    // Ensure progress wraps around for closed shapes
    const effectiveProgress = progress % 1.0;

    switch (type) {
      case 'line': {
        // For a line, progress is linear from start to end
        const startX = centerX - radiusX;
        const startY = centerY - radiusY;
        const endX = centerX + radiusX;
        const endY = centerY + radiusY;
        x = startX + effectiveProgress * (endX - startX);
        y = startY + effectiveProgress * (endY - startY);
        break;
      }
      case 'circle': {
        const angle = effectiveProgress * 2 * Math.PI - Math.PI / 2; // Start from top
        x = centerX + radiusX * Math.cos(angle);
        y = centerY + radiusY * Math.sin(angle);
        break;
      }
      case 'diamond': {
        const segment = Math.floor(effectiveProgress * 4);
        const segmentProgress = (effectiveProgress * 4) % 1;
        const points = [
          { x: centerX, y: centerY + radiusY }, // Top
          { x: centerX + radiusX, y: centerY }, // Right
          { x: centerX, y: centerY - radiusY }, // Bottom
          { x: centerX - radiusX, y: centerY }, // Left
        ];
        const startPoint = points[segment % 4];
        const endPoint = points[(segment + 1) % 4];
        x = startPoint.x + (endPoint.x - startPoint.x) * segmentProgress;
        y = startPoint.y + (endPoint.y - startPoint.y) * segmentProgress;
        break;
      }
      case 'triangle': {
        const segment = Math.floor(effectiveProgress * 3);
        const segmentProgress = (effectiveProgress * 3) % 1;
        const points = [
          { x: centerX, y: centerY + radiusY }, // Top
          { x: centerX + radiusX, y: centerY - radiusY }, // Bottom Right
          { x: centerX - radiusX, y: centerY - radiusY }, // Bottom Left
        ];
        const startPoint = points[segment % 3];
        const endPoint = points[(segment + 1) % 3];
        x = startPoint.x + (endPoint.x - startPoint.x) * segmentProgress;
        y = startPoint.y + (endPoint.y - startPoint.y) * segmentProgress;
        break;
      }
      default:
        x = centerX;
        y = centerY;
        break;
    }
    // Clamp values to ensure they are within the -1 to 1 range expected
    return {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y))
    };
  }


  public setGlyph(glyph: GlyphData): void {
    // Check if glyph properties affecting audio actually changed
    const didChange = !this.currentGlyph ||
                      this.currentGlyph.type !== glyph.type ||
                      this.currentGlyph.position.x !== glyph.position.x ||
                      this.currentGlyph.position.y !== glyph.position.y ||
                      this.currentGlyph.size.width !== glyph.size.width ||
                      this.currentGlyph.size.height !== glyph.size.height;

    // Assign the new glyph regardless of change, UI might depend on it
    this.currentGlyph = { ...glyph }; // Create a copy

    if (this.isPlaying && didChange) {
      console.log("🔊 Glyph changed, restarting sound");
      this.stopSound()
      this.startSound() // Restarting resets pathPosition implicitly
    } else if (this.currentGlyph && !this.isPlaying && didChange) {
        // If not playing but glyph changes, ensure the change is noted
        // The new glyph will be used next time play starts.
        console.log("🔊 Glyph updated while stopped.");
    }
  }

  // Removed updateAudioNodesFromGlyph and updatePathPosition
  // Removed updateAudioParametersFromPosition (logic moved to startSound/helper)

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
    if (!this.currentGlyph) {
        console.warn("🔊 Cannot start sound without a glyph set.");
        this.isPlaying = false; // Ensure isPlaying state is accurate
        return;
    }
    if (this.audioNodesArray.length > 0) {
        console.warn("🔊 Sound already started, stopping existing nodes first.");
        this.stopSound(); // Ensure clean state
    }

    console.log(`🔊 Starting sound with ${this.numberOfTones} tones for glyph: ${this.currentGlyph.type}`);

    const ctx = getAudioContext()
    this.audioNodesArray = [] // Clear previous nodes

    // Determine the output node (either preEQGain or EQ input)
    let outputNode: AudioNode;
    if (this.preEQAnalyser && this.preEQGain) {
        outputNode = this.preEQGain; // Connect before analyzer/EQ
    } else {
        outputNode = eqProcessor.getEQProcessor().getInputNode(); // Connect directly to EQ
    }

    // Create nodes for each tone (initial parameters will be set by updateAllToneParameters)
    for (let i = 0; i < this.numberOfTones; i++) {
      // --- Create Nodes ---
      const source = ctx.createOscillator()
      source.type = 'sine'
      // Use setValueAtTime for frequency to be precise
      source.frequency.setValueAtTime(440, ctx.currentTime) // Placeholder, will be updated immediately

      const gain = ctx.createGain()
       // Use setValueAtTime for gain to be precise
      gain.gain.setValueAtTime(0, ctx.currentTime) // Placeholder, will be updated immediately

      const panner = ctx.createStereoPanner()
       // Use setValueAtTime for pan to be precise
      panner.pan.setValueAtTime(0, ctx.currentTime) // Placeholder, will be updated immediately

      // --- Connect Nodes ---
      source.connect(gain)
      gain.connect(panner)
      panner.connect(outputNode); // Connect panner to the determined output

      // --- Store and Start ---
      this.audioNodesArray.push({ source, gain, panner })
      source.start()
    }

    // Set initial parameters based on starting position (0)
    this.pathPosition = 0;
    this.updateAllToneParameters();

    // Start the animation loop
    this.startAnimationLoop();
  }


  private stopSound(): void {
    if (this.audioNodesArray.length === 0) return; // Nothing to stop

    console.log(`🔊 Stopping ${this.audioNodesArray.length} tones.`);
    const stopTime = getAudioContext().currentTime; // Ensure nodes stop simultaneously
    // Stop and disconnect all nodes
    this.audioNodesArray.forEach(nodes => {
      // Add a slight ramp down to avoid clicks, though stopping oscillators usually handles this
      // nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, stopTime); // Hold current gain
      // nodes.gain.gain.linearRampToValueAtTime(0.0001, stopTime + 0.01); // Quick ramp down
      try {
        nodes.source.stop(stopTime + 0.01); // Stop slightly after ramp finishes
      } catch (e) {
          // Ignore errors if stop() was already called or node is invalid
           // console.warn("Error stopping oscillator:", e);
      }
      // Disconnect after stopping
      nodes.source.disconnect()
      nodes.gain.disconnect()
      nodes.panner.disconnect()
    })
    this.audioNodesArray = [] // Clear the array

    // Stop animation loop
    this.stopAnimationLoop();
  }

  public setFrequencyMultiplier(multiplier: number): void {
    const newMultiplier = Math.max(0.1, Math.min(10.0, multiplier)); // Clamp multiplier
    if (newMultiplier === this.freqMultiplier) return;

    this.freqMultiplier = newMultiplier;
    console.log(`🔊 Set frequency multiplier to ${this.freqMultiplier.toFixed(2)}`);

    // Update frequencies and gains if playing
    if (this.isPlaying) {
      this.updateAllToneParameters();
    }
  }

  public getFrequencyMultiplier(): number {
    return this.freqMultiplier
  }

  // Removed sweeping methods
  // Removed modulation methods

  // Update distortion gain for all active tones
  private setDistortionGain(gainValue: number): void {
    const newGain = Math.max(0, Math.min(1, gainValue)); // Clamp gain
    if (newGain === this.distortionGain) return; // Avoid unnecessary updates if value hasn't changed

    this.distortionGain = newGain;
    // console.log(`🔊 Set distortion gain to ${this.distortionGain.toFixed(2)}`); // Logged in updateAllToneParameters now

    // Update gains if playing
    if (this.isPlaying && this.audioNodesArray.length > 0) {
      this.updateAllToneGains();
    } else {
         // If not playing, just store the value. It will be used when startSound is called.
         console.log(`🔊 Stored distortion gain ${this.distortionGain.toFixed(2)} (will apply on play)`);
    }
  }

  // Helper to update frequency, panning, and gain for all active tones based on pathPosition
  private updateAllToneParameters(): void {
      if (!this.currentGlyph || this.audioNodesArray.length === 0) return;

      // console.log(`🔊 Updating parameters for ${this.audioNodesArray.length} tones (Pos: ${this.pathPosition.toFixed(3)})`); // Too noisy for animation loop
      const now = getAudioContext().currentTime;

      this.audioNodesArray.forEach((nodes, i) => {
          // Calculate the effective progress for this tone including the current path offset
          const progress = (i / this.numberOfTones + this.pathPosition) % 1.0;
          // Recalculate both X and Y based on the shifted progress
          const { x, y } = this.calculatePositionOnGlyph(this.currentGlyph!, progress);

          // Recalculate Frequency
          const minFreq = 20;
          const maxFreq = 20000;
          const normalizedY = Math.max(0, Math.min(1, (y + 1) / 2));
          const logMinFreq = Math.log2(minFreq);
          const logMaxFreq = Math.log2(maxFreq);
          const logFreqRange = logMaxFreq - logMinFreq;
          const centerFreq = Math.pow(2, logMinFreq + normalizedY * logFreqRange);
          const adjustedFreq = centerFreq * this.freqMultiplier;

          // Recalculate Gain
          const gainAdjustment = Math.sqrt(REFERENCE_FREQUENCY / Math.max(adjustedFreq, 1));
          const finalGainValue = MASTER_GAIN * this.distortionGain * gainAdjustment;

          // Apply updates using setValueAtTime for smooth transitions if needed,
          // For animation, target needs to be slightly ahead? Or just use value for now.
          nodes.source.frequency.value = adjustedFreq; // Direct update might be okay for animation?
          nodes.gain.gain.value = finalGainValue;
          nodes.panner.pan.value = x;
      });
  }

  // Helper to update only gain (e.g., for distortion changes without path movement)
  private updateAllToneGains(): void {
      if (!this.currentGlyph || this.audioNodesArray.length === 0) return;

      console.log(`🔊 Updating gains for ${this.audioNodesArray.length} tones (Distortion: ${this.distortionGain.toFixed(2)})`);
      const now = getAudioContext().currentTime;

      this.audioNodesArray.forEach((nodes) => {
          // Gain depends on frequency, which depends on the current position (y)
          // We need the current frequency to recalculate the gain correctly
          const currentFreq = nodes.source.frequency.value;
          const gainAdjustment = Math.sqrt(REFERENCE_FREQUENCY / Math.max(currentFreq, 1));
          const finalGainValue = MASTER_GAIN * this.distortionGain * gainAdjustment;

          // Apply updates
          nodes.gain.gain.setValueAtTime(finalGainValue, now);
      });
  }

  // --- Animation Loop --- 
  private startAnimationLoop(): void {
    if (this.animationFrameId !== null) return; // Already running

    console.log("🔊 Starting animation loop");
    this.lastTimestamp = performance.now(); // Initialize timestamp

    const animate = (timestamp: number) => {
      const deltaTime = (timestamp - this.lastTimestamp) / 1000; // Convert ms to seconds
      this.lastTimestamp = timestamp;

      if (this.isPlaying && this.speed > 0) {
          // Calculate position increment based on speed and time
          // Speed 1.0 = one full loop in ~10 seconds (adjust as needed)
          const positionIncrement = (deltaTime * this.speed) / 10.0; 
          this.pathPosition = (this.pathPosition + positionIncrement) % 1.0; // Update and wrap position

          // Update all audio parameters based on the new pathPosition
          this.updateAllToneParameters();
      } 

      // Schedule the next frame
      this.animationFrameId = requestAnimationFrame(animate);
    };

    // Start the loop
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private stopAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      console.log("🔊 Stopping animation loop");
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public dispose(): void {
    this.setPlaying(false) // This calls stopSound()
    // Removed stopSweep
    // Removed stopEnvelopeModulation
     // Clean up the analyzer nodes explicitly on dispose
    if (this.preEQAnalyser) {
      if (this.preEQGain) {
        // Disconnect gain from analyzer and destination (EQ)
        try { this.preEQGain.disconnect() } catch (e) {}
        this.preEQGain = null
      }
      // Disconnect analyzer itself (might not be necessary if gain is disconnected)
      try { this.preEQAnalyser.disconnect(); } catch (e) {}
      this.preEQAnalyser = null
    }
    console.log("🔊 GlyphGridAudioPlayer disposed.");
  }

  // Removed manual control methods
  // Removed resumeFromPosition

  // Update analyzer creation to handle multiple inputs via preEQGain
  public createPreEQAnalyser(): AnalyserNode {
    const ctx = getAudioContext()

    if (this.preEQAnalyser) {
      console.log("�� Returning existing PreEQAnalyser.");
      return this.preEQAnalyser
    }

    console.log("🔊 Creating new PreEQAnalyser.");
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.85

    // Create a single gain node to gather all panner outputs before analysis/EQ
    const preEQGain = ctx.createGain()
    preEQGain.gain.value = 1.0 // This gain doesn't affect overall volume, just analysis level if needed

    // Connect the gathering gain node to the analyzer AND the EQ input
    preEQGain.connect(analyser)
    const eq = eqProcessor.getEQProcessor()
    preEQGain.connect(eq.getInputNode())

    this.preEQAnalyser = analyser
    this.preEQGain = preEQGain

    // If already playing, reconnect existing panners to this new gain node
    if (this.isPlaying && this.audioNodesArray.length > 0) {
        console.log(`🔊 Reconnecting ${this.audioNodesArray.length} existing panners to new preEQGain node.`);
        const oldOutput = eq.getInputNode(); // Assume previous output was EQ input
        this.audioNodesArray.forEach(nodes => {
            try {
                nodes.panner.disconnect(oldOutput); // Disconnect from previous destination
            } catch(e) {
                // May already be disconnected if stopSound was called, ignore error
                 // console.warn("Error disconnecting panner from old output:", e);
            }
            nodes.panner.connect(this.preEQGain!); // Connect to the new gathering gain node
        });
    }

    return analyser;
  }

  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser
  }

  // Removed getAudioParameters (less relevant with multiple tones)
  // Removed subsection methods
  // Removed speed methods
  // Removed playback mode methods
  // Removed discrete frequency methods

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