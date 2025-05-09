import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
// import { getAudioPlayer } from './audioPlayer';
import { useEQProfileStore } from '../stores';

// Constants
const COLUMNS = 5; // Always 5 panning positions - match the value in dot-grid.tsx (odd number ensures a middle column)
const SEQUENTIAL_TRIGGER_DELAY = 0.1; // Delay between sequential dot triggers
const SIMULTANEOUS_STAGGER_DELAY = 0.015; // Stagger offset for simultaneous mode start

// Define Rhythmic Patterns (arrays of delays in seconds)
const RHYTHM_1 = [0.2, 0.2, 0.2, 0.2]; // Steady 1/4 notes (if beat = 0.8s)
const RHYTHM_2 = [0.3, 0.1, 0.3, 0.1]; // Syncopated
const RHYTHM_3 = [0.4, 0.4];          // 1/2 notes
const RHYTHM_4 = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]; // 1/8 notes
const RHYTHMIC_PATTERNS = [RHYTHM_1, RHYTHM_2, RHYTHM_3, RHYTHM_4];

// Envelope settings
const ENVELOPE_MIN_GAIN = 0.0; // Minimum gain during envelope cycle
const ENVELOPE_MAX_GAIN = 1.0; // Maximum gain during envelope cycle
const ENVELOPE_ATTACK = 0.002; // Faster attack time in seconds - for very punchy transients
const ENVELOPE_RELEASE_LOW_FREQ = 0.2; // Release time for lowest frequencies (seconds)
const ENVELOPE_RELEASE_HIGH_FREQ = 0.02; // Release time for highest frequencies (seconds)
const MASTER_GAIN = 6.0; // Much louder master gain for calibration

// Analyzer settings
const FFT_SIZE = 2048; // FFT resolution (must be power of 2)
const SMOOTHING = 0.8; // Analyzer smoothing factor (0-1)

// Volume pattern settings
const VOLUME_PATTERN = [0, 0, 0, 0]

// Define the possible states for a point (used internally, maybe simplified later)
export type PointState = 'on' | 'quiet'; // Kept for potential future use, but might simplify to just 'on'

// Define Diamond Parameters Type
interface DiamondParams {
  center: { x: number, y: number }; // Normalized (-1 to 1)
  size: { width: number, height: number }; // Normalized (total width/height, max 2)
  pointCount: number;
}

// Class for Shape Tool Audio Player
class ShapeToolAudioPlayer {
  private static instance: ShapeToolAudioPlayer;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private isPlaying: boolean = false;
  private audioNodes: Map<string, { // Key might be "point_i" or "x,y"
    source: AudioBufferSourceNode;
    gain: GainNode;
    envelopeGain: GainNode;
    panner: StereoPannerNode;
    filter: BiquadFilterNode;
    position: number; // Index/order for sorting/staggering
    state: PointState; // Kept for consistency, maybe simplified
    // Timing/Rhythm Info
    lastTriggerTime: number; 
    rhythmPattern: number[];
    rhythmIndex: number;
  }> = new Map();
  // Removed grid specific state
  // private gridSize: number = 3; 
  // private columnCount: number = COLUMNS; 
  private preEQAnalyser: AnalyserNode | null = null; // Pre-EQ analyzer node
  private preEQGain: GainNode | null = null; // Gain node for connecting all sources to analyzer
  
  // Animation frame properties
  private animationFrameId: number | null = null;
  private lastTriggerTime: number = 0; // Global trigger time (Sequential Mode)
  
  // Playback Mode
  private playbackMode: 'sequential' | 'simultaneous_staggered' = 'simultaneous_staggered'; // Default to staggered

  // Volume pattern properties - REINTRODUCING INDEX
  private volumePatternIndex: number = 0; // Current position in volume pattern (Sequential Mode)
  private baseDbLevel: number = 0; // Base volume level in dB (0dB = reference level)
  
  // Add distortion gain property
  private distortionGain: number = 1.0;
  
  // Add shape parameters and morph factor
  private currentShapeParams: DiamondParams = { // Store the base shape
    center: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    pointCount: 12,
  };
  private morphFactor: number = 0; // 0 = diamond, 1 = X

  private constructor() {
    // Initialize pink noise buffer
    this.generatePinkNoiseBuffer();
    
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

  public static getInstance(): ShapeToolAudioPlayer {
    if (!ShapeToolAudioPlayer.instance) {
      ShapeToolAudioPlayer.instance = new ShapeToolAudioPlayer();
    }
    return ShapeToolAudioPlayer.instance;
  }

  /**
   * Set the current playback mode.
   * Restarts rhythms if changed while playing.
   */
  public setPlaybackMode(mode: 'sequential' | 'simultaneous_staggered'): void {
    if (mode === this.playbackMode) return;
    
    console.log(`🔊 [ShapeTool] Setting playback mode to: ${mode}`);
    this.playbackMode = mode;
    
    // Restart rhythms if currently playing to apply new mode logic
    if (this.isPlaying) {
      this.stopAllRhythms();
      this.startAllRhythms();
    }
  }

  // Removed setGridSize and updateAllDotPanning

  /**
   * Generate pink noise buffer (Identical to dotGridAudio)
   */
   private async generatePinkNoiseBuffer(): Promise<void> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Improved pink noise generation using Paul Kellet's refined method
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
  }

  /**
   * Create and return a pre-EQ analyzer node (Identical logic)
   */
  public createPreEQAnalyser(): AnalyserNode {
    const ctx = audioContext.getAudioContext();
    if (!this.preEQAnalyser) {
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
      this.preEQAnalyser = ctx.createAnalyser();
      this.preEQAnalyser.fftSize = FFT_SIZE;
      this.preEQAnalyser.smoothingTimeConstant = SMOOTHING;
      this.preEQGain.connect(this.preEQAnalyser);
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode());
      if (this.isPlaying) {
        this.reconnectAllSources();
      }
    }
    return this.preEQAnalyser;
  }
  
  /**
   * Get the pre-EQ analyzer (Identical logic)
   */
  public getPreEQAnalyser(): AnalyserNode | null {
    return this.preEQAnalyser;
  }
  
  /**
   * Connect to an existing external analyzer (Identical logic)
   */
   public connectToAnalyser(analyser: AnalyserNode): void {
    const ctx = audioContext.getAudioContext();
    if (this.preEQGain) {
      this.preEQGain.disconnect();
    }
    if (!this.preEQGain) {
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
    }
    this.preEQAnalyser = analyser;
    const eq = eqProcessor.getEQProcessor();
    this.preEQGain.connect(this.preEQAnalyser);
    this.preEQGain.connect(eq.getInputNode());
    this.reconnectAllSources();
  }
  
  /**
   * Disconnect from the external analyzer (Identical logic)
   */
  public disconnectFromAnalyser(): void {
    this.preEQAnalyser = null;
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
      this.reconnectAllSources();
    }
  }
  
  /**
   * Reconnect all sources (Identical logic)
   */
  private reconnectAllSources(): void {
    if (this.audioNodes.size === 0) return;
    const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();
    this.audioNodes.forEach((nodes, nodeKey) => {
      try {
        nodes.gain.disconnect();
        nodes.gain.connect(destinationNode);
      } catch (e) {
        console.error(`[ShapeTool] Error reconnecting source for node ${nodeKey}:`, e);
      }
    });
  }

  /**
   * Update the shape and calculate points to render as audio nodes.
   */
  public updateShape(params: DiamondParams): void {
    console.log('[ShapeTool] Updating base shape:', params);
    // Store the new base shape parameters
    this.currentShapeParams = { ...params };
    
    const calculatedPoints: Map<string, { x: number; y: number; index: number }> = new Map();
    // Use stored parameters and current morph factor for calculation
    const { center, size, pointCount } = this.currentShapeParams;
    const factor = this.morphFactor; // Use the current morph factor
    
    if (pointCount <= 0) {
        console.warn("[ShapeTool] Point count must be positive.");
        // Clear existing nodes if point count is zero or less
        this.updateAudioNodes(new Map());
        return;
    }

    // Define diamond vertices in normalized space (-1 to 1)
    const topY = Math.min(1, center.y + size.height / 2);
    const bottomY = Math.max(-1, center.y - size.height / 2);
    const rightX = Math.min(1, center.x + size.width / 2);
    const leftX = Math.max(-1, center.x - size.width / 2);
    
    const vertices = [
        { x: center.x, y: bottomY }, // Bottom
        { x: rightX, y: center.y },  // Right
        { x: center.x, y: topY },    // Top
        { x: leftX, y: center.y },   // Left
    ];

    const pointsPerEdge = Math.max(1, Math.floor(pointCount / 4));
    const totalPointsToGenerate = pointsPerEdge * 4; // Ensure we generate a multiple of 4
    let pointIndex = 0;

    for (let i = 0; i < 4; i++) {
      const startVertex = vertices[i];
      const endVertex = vertices[(i + 1) % 4];

      // Place points along the edge (excluding the end vertex, handled by next edge)
      for (let j = 0; j < pointsPerEdge; j++) {
          if (pointIndex >= totalPointsToGenerate) break; // Safety break

          const t = j / pointsPerEdge; // Interpolation factor (0 <= t < 1)
          const pointX = startVertex.x + t * (endVertex.x - startVertex.x);
          const pointY = startVertex.y + t * (endVertex.y - startVertex.y);
          
          // --- Calculate Target X position --- 
          // Simple X: interpolate X towards center X, keep Y the same
          // const targetX = center.x;
          // const targetY = pointY; 

          // Diagonal X interpolation:
          let targetX, targetY;
          const diamondCenter = center; // center is from this.currentShapeParams
          const t_edge = t; // t is j / pointsPerEdge, progress along current diamond edge

          // Normalized bounding box corners (topY, bottomY, leftX, rightX are already defined in this scope)
          const corner_BR_bb = { x: rightX, y: bottomY };
          const corner_TR_bb = { x: rightX, y: topY };
          const corner_TL_bb = { x: leftX, y: topY };
          const corner_BL_bb = { x: leftX, y: bottomY };

          if (i === 0) { // Edge 0: Diamond's Bottom point to Right point
                         // Target: X-arm from diamondCenter to bounding_box_BottomRight_corner
              targetX = diamondCenter.x + t_edge * (corner_BR_bb.x - diamondCenter.x);
              targetY = diamondCenter.y + t_edge * (corner_BR_bb.y - diamondCenter.y);
          } else if (i === 1) { // Edge 1: Diamond's Right point to Top point
                                // Target: X-arm from diamondCenter to bounding_box_TopRight_corner
              targetX = diamondCenter.x + t_edge * (corner_TR_bb.x - diamondCenter.x);
              targetY = diamondCenter.y + t_edge * (corner_TR_bb.y - diamondCenter.y);
          } else if (i === 2) { // Edge 2: Diamond's Top point to Left point
                                // Target: X-arm from diamondCenter to bounding_box_TopLeft_corner
              targetX = diamondCenter.x + t_edge * (corner_TL_bb.x - diamondCenter.x);
              targetY = diamondCenter.y + t_edge * (corner_TL_bb.y - diamondCenter.y);
          } else { // i === 3 // Edge 3: Diamond's Left point to Bottom point
                             // Target: X-arm from diamondCenter to bounding_box_BottomLeft_corner
              targetX = diamondCenter.x + t_edge * (corner_BL_bb.x - diamondCenter.x);
              targetY = diamondCenter.y + t_edge * (corner_BL_bb.y - diamondCenter.y);
          }

          // --- Interpolate between diamond point and target X point --- 
          const interpolatedX = pointX + (targetX - pointX) * factor;
          const interpolatedY = pointY + (targetY - pointY) * factor;
          
          // Clamp final interpolated coordinates
          const clampedX = Math.max(-1, Math.min(1, interpolatedX));
          const clampedY = Math.max(-1, Math.min(1, interpolatedY));

          const pointKey = `point_${pointIndex}`; // Unique key for each point
          calculatedPoints.set(pointKey, { x: clampedX, y: clampedY, index: pointIndex });
          pointIndex++;
      }
    }

    this.updateAudioNodes(calculatedPoints);
  }

  /**
   * Add/remove/update audio nodes based on calculated points.
   */
  private updateAudioNodes(calculatedPoints: Map<string, { x: number; y: number; index: number }>): void {
    const currentKeys = new Set(this.audioNodes.keys());
    const newKeys = new Set(calculatedPoints.keys());
    const ctx = audioContext.getAudioContext(); // Get context for timing
    const now = ctx.currentTime;

    // Remove nodes that are no longer needed
    currentKeys.forEach(key => {
      if (!newKeys.has(key)) {
        this.removePointNode(key);
      }
    });

    // Add new nodes or update existing ones (position might change slightly)
    calculatedPoints.forEach((pointData, key) => {
      if (!currentKeys.has(key)) {
        this.addPointNode(key, pointData.x, pointData.y, pointData.index);
      } else {
        // Potentially update existing node properties if needed (e.g., filter freq/pan)
        const nodes = this.audioNodes.get(key);
        if (nodes) {
          const centerFreq = this.calculateFrequency(pointData.y);
          const panPosition = this.calculatePan(pointData.x);
          // Use setTargetAtTime for potentially smoother transitions
          nodes.filter.frequency.setTargetAtTime(centerFreq, now, 0.01); 
          nodes.panner.pan.setTargetAtTime(panPosition, now, 0.01);
          nodes.position = pointData.index; // Update position index
          // Could update rhythm pattern here too if needed
        }
      }
    });
  }

  /**
   * Set the playing state
   */
  public setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    
    this.isPlaying = playing;

    console.log('[ShapeTool] Set playing state:', playing);
    
    if (playing) {
      this.startAllSources();
      this.startAllRhythms();
      
      // Reset volume pattern index only for sequential mode
      if (this.playbackMode === 'sequential') {
        this.volumePatternIndex = 0;
      }
    } else {
      this.stopAllRhythms();
      this.stopAllSources();
    }
  }

  /**
   * Start all rhythm timers based on playback mode.
   */
   private startAllRhythms(): void {
    this.stopAllRhythms(); // Ensure previous loops are stopped
    this.animationFrameId = null;
    const ctx = audioContext.getAudioContext();

    // --- SEQUENTIAL MODE --- 
    if (this.playbackMode === 'sequential') {
      this.lastTriggerTime = ctx.currentTime; // Reset global timer

      // Get node keys ordered by their position index
      const orderedNodeKeys = Array.from(this.audioNodes.entries())
        .sort(([, nodeA], [, nodeB]) => nodeA.position - nodeB.position)
        .map(([key]) => key);
        
      if (orderedNodeKeys.length === 0) return;
      
      let currentNodeIndex = 0;

      const frameLoop = (timestamp: number) => {
        if (!this.isPlaying || this.playbackMode !== 'sequential') {
          this.stopAllRhythms(); // Stop if mode changes or stopped
          return; 
        }
        
        const now = ctx.currentTime;
        
        if (now - this.lastTriggerTime >= SEQUENTIAL_TRIGGER_DELAY) {
          const nodeKey = orderedNodeKeys[currentNodeIndex];
          
          if (this.audioNodes.has(nodeKey)) {
            const volumeOffset = VOLUME_PATTERN[this.volumePatternIndex];
            const effectiveVolumeDb = this.baseDbLevel + volumeOffset;
            this.triggerPointEnvelope(nodeKey, effectiveVolumeDb); // Use renamed trigger fn
          }
          
          this.lastTriggerTime = now;
          this.volumePatternIndex = (this.volumePatternIndex + 1) % VOLUME_PATTERN.length;
          if (this.volumePatternIndex === 0) {
            currentNodeIndex = (currentNodeIndex + 1) % orderedNodeKeys.length;
          }
        }
        
        this.animationFrameId = requestAnimationFrame(frameLoop);
      };
      this.animationFrameId = requestAnimationFrame(frameLoop);

    // --- SIMULTANEOUS STAGGERED MODE --- 
    } else if (this.playbackMode === 'simultaneous_staggered') {
      if (this.audioNodes.size === 0) return;
      
      // Get node keys ordered by position index for initial stagger
      const orderedNodeKeys = Array.from(this.audioNodes.entries())
          .sort(([, nodeA], [, nodeB]) => nodeA.position - nodeB.position)
          .map(([key]) => key);

      // Initialize start times with stagger and reset rhythm index
      const startTime = ctx.currentTime;
      orderedNodeKeys.forEach((nodeKey, index) => {
          const nodes = this.audioNodes.get(nodeKey);
          if (nodes) {
              nodes.lastTriggerTime = startTime + index * SIMULTANEOUS_STAGGER_DELAY;
              nodes.rhythmIndex = 0; // Reset index
          }
      });

      const frameLoop = (timestamp: number) => {
        if (!this.isPlaying || this.playbackMode !== 'simultaneous_staggered') {
            this.stopAllRhythms(); // Stop if mode changes or stopped
            return; 
        }
        
        const now = ctx.currentTime;
        
        this.audioNodes.forEach((nodes, nodeKey) => {
          const pattern = nodes.rhythmPattern;
          // Safety check for empty pattern
          if (!pattern || pattern.length === 0) {
            console.warn(`[ShapeTool] Node ${nodeKey} has empty rhythm pattern.`);
            return; 
          }
          const currentIndex = nodes.rhythmIndex % pattern.length; // Ensure index is valid
          const currentDelay = pattern[currentIndex];
          
          if (now - nodes.lastTriggerTime >= currentDelay) {
            this.triggerPointEnvelope(nodeKey, this.baseDbLevel); // Use renamed trigger fn
            
            nodes.lastTriggerTime += currentDelay; 
            nodes.rhythmIndex = (currentIndex + 1) % pattern.length;
            
            if (nodes.lastTriggerTime < now - currentDelay) {
              nodes.lastTriggerTime = now;
            }
          }
        });
        
        this.animationFrameId = requestAnimationFrame(frameLoop);
      };
      this.animationFrameId = requestAnimationFrame(frameLoop);
    }
  }
  
  /**
   * Stop all rhythm timers
   */
  private stopAllRhythms(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Start all audio sources (Mostly identical logic)
   */
   private startAllSources(): void {
    const ctx = audioContext.getAudioContext();
    if (!this.pinkNoiseBuffer) {
      this.generatePinkNoiseBuffer();
      return;
    }
    const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();
    if (this.preEQAnalyser && !this.preEQGain) {
      this.preEQGain = ctx.createGain();
      this.preEQGain.gain.value = 1.0;
      this.preEQGain.connect(this.preEQAnalyser);
      const eq = eqProcessor.getEQProcessor();
      this.preEQGain.connect(eq.getInputNode());
    }
    
    this.audioNodes.forEach((nodes, nodeKey) => {
      try {
        const source = ctx.createBufferSource();
        source.buffer = this.pinkNoiseBuffer;
        source.loop = true;
        
        // source -> filter -> panner -> envelopeGain -> gain -> destinationNode
        source.connect(nodes.filter);
        nodes.filter.connect(nodes.panner);
        nodes.panner.connect(nodes.envelopeGain);
        nodes.envelopeGain.connect(nodes.gain);
        
        nodes.gain.gain.value = MASTER_GAIN * this.distortionGain; // Apply distortion
        nodes.gain.connect(destinationNode);
        nodes.envelopeGain.gain.value = ENVELOPE_MIN_GAIN; // Start silent
        
        source.start();
        nodes.source = source; // Store reference
      } catch (e) {
        console.error(`[ShapeTool] Error starting source for node ${nodeKey}:`, e);
      }
    });
  }

  /**
   * Stop all audio sources (Identical logic)
   */
  private stopAllSources(): void {
    this.audioNodes.forEach((nodes, nodeKey) => {
      try {
        if (nodes.source) {
          nodes.source.stop();
          nodes.source.disconnect();
        }
      } catch (e) {
        // Ignore errors often thrown when stopping already stopped sources
        // console.warn(`[ShapeTool] Error stopping source for node ${nodeKey}:`, e);
      }
    });
  }

  /**
   * Trigger the envelope for a specific point node.
   * Renamed from triggerDotEnvelope.
   */
  private triggerPointEnvelope(nodeKey: string, volumeDb: number = 0): void {
    const nodes = this.audioNodes.get(nodeKey);
    if (!nodes) return;
    
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime; 

    // Use PointState if needed (e.g., for 'quiet' state)
    let effectiveVolumeDb = volumeDb;
    if (nodes.state === 'quiet') { // Example if quiet state is used
      effectiveVolumeDb -= 18; 
    }
    
    // Calculate release time based on frequency (Identical logic)
    const centerFreq = nodes.filter.frequency.value;
    const minFreqLog = Math.log2(20);
    const maxFreqLog = Math.log2(20000);
    const freqLog = Math.log2(centerFreq);
    const normalizedFreq = Math.max(0, Math.min(1, 
      (freqLog - minFreqLog) / (maxFreqLog - minFreqLog)
    ));
    const releaseTime = ENVELOPE_RELEASE_LOW_FREQ + 
      normalizedFreq * (ENVELOPE_RELEASE_HIGH_FREQ - ENVELOPE_RELEASE_LOW_FREQ);
    
    // Apply volume
    const gainRatio = Math.pow(10, effectiveVolumeDb / 20); 
    nodes.gain.gain.cancelScheduledValues(now);
    // Apply distortion gain here as well
    nodes.gain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain * gainRatio, now); 
    
    // Apply envelope (Identical logic)
    nodes.envelopeGain.gain.cancelScheduledValues(now);
    nodes.envelopeGain.gain.setValueAtTime(ENVELOPE_MIN_GAIN, now);
    nodes.envelopeGain.gain.linearRampToValueAtTime(
      ENVELOPE_MAX_GAIN, 
      now + ENVELOPE_ATTACK
    );
    nodes.envelopeGain.gain.exponentialRampToValueAtTime(
      0.001, 
      now + ENVELOPE_ATTACK + releaseTime
    );
    nodes.envelopeGain.gain.setValueAtTime(0, now + ENVELOPE_ATTACK + releaseTime + 0.001);
  }

  /**
   * Add a new point node to the audio system.
   * Renamed from addDot. Takes calculated coordinates.
   */
  private addPointNode(nodeKey: string, x: number, y: number, index: number): void {
    const ctx = audioContext.getAudioContext();
    
    // Calculate frequency and pan based on normalized coords (-1 to 1)
    const centerFreq = this.calculateFrequency(y);
    const panPosition = this.calculatePan(x);
    
    // Create filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerFreq;
    filter.Q.value = 1.0; // Keep Q simple for now
    
    // Create panner
    const panner = ctx.createStereoPanner();
    panner.pan.value = panPosition;

    // Create gains
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN; // Base gain, adjusted by envelope/volume/distortion
    const envelopeGain = ctx.createGain();
    envelopeGain.gain.value = ENVELOPE_MIN_GAIN; // Start silent

    // --- Assign Rhythmic Pattern --- 
    // Assign based on index modulo number of patterns
    const patternIndex = index % RHYTHMIC_PATTERNS.length; 
    const rhythmPattern = RHYTHMIC_PATTERNS[patternIndex];
    const rhythmIndex = 0; 
    const lastTriggerTime = 0; // Initialized properly in startAllRhythms

    // Store the nodes
    this.audioNodes.set(nodeKey, {
      source: ctx.createBufferSource(), // Dummy source
      gain,
      envelopeGain,
      panner,
      filter,
      position: index, // Store index for sorting/staggering
      state: 'on', // Default state to 'on', can be adapted if needed
      // Timing/Rhythm Info
      lastTriggerTime: lastTriggerTime, 
      rhythmPattern: rhythmPattern, 
      rhythmIndex: rhythmIndex, 
    });
  }

  // Helper to calculate frequency from normalized Y (-1 to 1)
  private calculateFrequency(normalizedY: number): number {
      const minFreq = 40; 
      const maxFreq = 15000; 
      const logMinFreq = Math.log2(minFreq);
      const logMaxFreq = Math.log2(maxFreq);
      const logFreqRange = logMaxFreq - logMinFreq;
      // Map normalizedY from [-1, 1] to [0, 1] for frequency calculation
      const t = (normalizedY + 1) / 2; 
      return Math.pow(2, logMinFreq + t * logFreqRange);
  }

  // Helper to calculate pan from normalized X (-1 to 1)
  private calculatePan(normalizedX: number): number {
      // Simple linear pan
      return Math.max(-1, Math.min(1, normalizedX));
  }
  
  /**
   * Remove a point node from the audio system.
   * Renamed from removeDot.
   */
  private removePointNode(nodeKey: string): void {
    const nodes = this.audioNodes.get(nodeKey);
    if (!nodes) return;
    
    if (this.isPlaying && nodes.source) {
      try {
        nodes.source.stop();
        nodes.source.disconnect();
      } catch (e) {
        // console.warn(`[ShapeTool] Warning stopping source for node ${nodeKey}:`, e);
      }
    }
    // Disconnect other nodes to be safe
    try { nodes.gain.disconnect(); } catch (e) {}
    try { nodes.envelopeGain.disconnect(); } catch (e) {}
    try { nodes.panner.disconnect(); } catch (e) {}
    try { nodes.filter.disconnect(); } catch (e) {}

    this.audioNodes.delete(nodeKey);
  }

  /**
   * Set the master volume in dB (Identical logic)
   */
  public setVolumeDb(dbLevel: number): void {
    this.baseDbLevel = dbLevel;
  }

  /**
   * Clean up resources (Identical logic, adjusted logging)
   */
   public dispose(): void {
    console.log("[ShapeTool] Disposing audio player...");
    this.setPlaying(false); // Stops sources and rhythms
    
    if (this.preEQGain) {
      this.preEQGain.disconnect();
      this.preEQGain = null;
    }
    if (this.preEQAnalyser) {
      // Analyzer might be managed externally, just disconnect gain from it
      // this.preEQAnalyser.disconnect(); 
      this.preEQAnalyser = null;
    }
    
    // Ensure all nodes are removed cleanly
    const keys = Array.from(this.audioNodes.keys());
    keys.forEach(key => this.removePointNode(key));
    this.audioNodes.clear();

    this.pinkNoiseBuffer = null; // Allow garbage collection
    console.log("[ShapeTool] Disposal complete.");
  }

  // Handle distortion gain (Identical logic)
  private setDistortionGain(gain: number): void {
    this.distortionGain = Math.max(0, Math.min(1, gain));
    // Apply gain change immediately if playing
    if (this.isPlaying) {
        this.audioNodes.forEach(nodes => {
            const currentGainRatio = Math.pow(10, this.baseDbLevel / 20); // Assuming last volume is known/applied
            nodes.gain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain * currentGainRatio, audioContext.getAudioContext().currentTime);
        });
    }
  }

  /**
   * Set the morph factor and trigger shape update.
   * @param factor 0 for diamond, 1 for X
   */
  public setMorphFactor(factor: number): void {
      this.morphFactor = Math.max(0, Math.min(1, factor)); // Clamp 0-1
      // Recalculate points using the stored shape params and new factor
      this.updateShape(this.currentShapeParams);
  }
}

/**
 * Get the singleton instance of the ShapeToolAudioPlayer
 */
export function getShapeToolAudioPlayer(): ShapeToolAudioPlayer {
  return ShapeToolAudioPlayer.getInstance();
}

/**
 * Clean up the shape tool audio player
 */
export function cleanupShapeToolAudioPlayer(): void {
  // Get instance and dispose if it exists
  // Need a way to check if instance exists without creating it
  // Modify getInstance slightly or add a static check method if needed,
  // otherwise, this might create an instance just to dispose it.
  // For now, assume getInstance handles potential null instance gracefully or we ensure it exists before calling cleanup.
  try {
      const player = ShapeToolAudioPlayer.getInstance();
      player.dispose();
  } catch (e) {
      console.warn("[ShapeTool] Error during cleanup:", e);
      // Instance might not have been created
  }
} 