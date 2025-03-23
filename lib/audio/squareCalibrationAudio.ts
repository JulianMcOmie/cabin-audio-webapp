// import * as audioContext from './audioContext';
// import * as eqProcessor from './eqProcessor';

// // Constants
// const MIN_FREQ = 20; // Hz
// const MAX_FREQ = 20000; // Hz
// const MASTER_GAIN = 0.8;

// // Envelope settings
// const ENVELOPE_ATTACK = 0.01; // seconds
// const ENVELOPE_DECAY = 0.02; // seconds
// const ENVELOPE_SUSTAIN = 0.8; // level
// const ENVELOPE_RELEASE = 0.4; // seconds
// const BURST_LENGTH = 0.15; // seconds

// // Pattern timing
// const BURST_INTERVAL = 0.3; // seconds between bursts (reduced from 0.3 to make it faster)
// const GROUP_PAUSE = 0.3; // pause between groups (reduced from 0.5)

// // Drum pattern timing (based on 120 BPM)
// const BEAT_DURATION = 0.5; // duration of one beat in seconds (120 BPM = 0.5s per beat)
// const SIXTEENTH_NOTE = BEAT_DURATION / 4; // duration of a sixteenth note

// // Filter settings
// const MIN_Q = 2.0;   // Minimum Q value (wider bandwidth)
// const MAX_Q = 4.0;  // Maximum Q value (narrower bandwidth)

// // Corner indices
// enum Corner {
//   BOTTOM_LEFT = 0,
//   TOP_RIGHT = 1,
//   BOTTOM_RIGHT = 2,
//   TOP_LEFT = 3
// }

// // Extended grid positions for 3x3 pattern
// enum GridPosition {
//   TOP_LEFT = 0,
//   TOP_CENTER = 1,
//   TOP_RIGHT = 2,
//   MIDDLE_LEFT = 3,
//   CENTER = 4,
//   MIDDLE_RIGHT = 5,
//   BOTTOM_LEFT = 6,
//   BOTTOM_CENTER = 7,
//   BOTTOM_RIGHT = 8
// }

// // Observer pattern for corner activation
// type CornerListener = (corner: Corner) => void;
// // Observer for grid position activation
// type GridPositionListener = (position: GridPosition) => void;
// // Pattern mode
// type PatternMode = 'diagonal' | 'drumGrid';

// class SquareCalibrationAudio {
//   private static instance: SquareCalibrationAudio;
//   private noiseBuffer: AudioBuffer | null = null;
//   private isPlaying: boolean = false;
//   private currentCorner: Corner = Corner.BOTTOM_LEFT;
//   private cornerCount: number = 0;
//   private timeoutId: number | null = null;
//   private cornerListeners: CornerListener[] = [];
//   private gridPositionListeners: GridPositionListener[] = [];
//   private preEQAnalyser: AnalyserNode | null = null;
//   private preEQGain: GainNode | null = null;
  
//   // Pattern mode toggle
//   private patternMode: PatternMode = 'diagonal';
  
//   // Drum pattern variables
//   private beatCount: number = 0;
//   private measureCount: number = 0;
//   private sixteenthCount: number = 0;
  
//   // Square position and size (normalized 0-1)
//   private squarePosition: [number, number] = [0.2, 0.2]; // [left, bottom]
//   private squareSize: [number, number] = [0.6, 0.6]; // [width, height]
  
//   // Dot density - number of dots per diagonal (2 = corners only, 3-5 = additional intermediate points)
//   private dotDensity: number = 2;
  
//   // Current position index along the diagonal
//   private currentPositionIndex: number = 0;
  
//   // Current diagonal index (0 = bottom-left to top-right, 1 = bottom-right to top-left)
//   private currentDiagonalIndex: number = 0;

//   private constructor() {
//     // Initialize noise buffer
//     this.generateNoiseBuffer();
//   }

//   public static getInstance(): SquareCalibrationAudio {
//     if (!SquareCalibrationAudio.instance) {
//       SquareCalibrationAudio.instance = new SquareCalibrationAudio();
//     }
//     return SquareCalibrationAudio.instance;
//   }

//   /**
//    * Generate pink noise buffer
//    * Uses Paul Kellet's refined method for generating pink noise
//    */
//   private async generateNoiseBuffer(): Promise<void> {
//     const ctx = audioContext.getAudioContext();
//     const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
//     const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
//     const data = buffer.getChannelData(0);

//     // Pink noise generation using Paul Kellet's refined method
//     // This produces a true -3dB/octave spectrum characteristic of pink noise
//     let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
//     for (let i = 0; i < bufferSize; i++) {
//       // Generate white noise sample
//       const white = Math.random() * 2 - 1;
      
//       // Pink noise filtering - refined coefficients for accurate spectral slope
//       b0 = 0.99886 * b0 + white * 0.0555179;
//       b1 = 0.99332 * b1 + white * 0.0750759;
//       b2 = 0.96900 * b2 + white * 0.1538520;
//       b3 = 0.86650 * b3 + white * 0.3104856;
//       b4 = 0.55000 * b4 + white * 0.5329522;
//       b5 = -0.7616 * b5 - white * 0.0168980;
//       b6 = white * 0.5362;
      
//       // Combine with proper scaling to maintain pink noise characteristics
//       // The sum is multiplied by 0.11 to normalize the output
//       data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6) * 0.11;
//     }
    
//     // Apply a second-pass normalization to ensure consistent volume
//     // Find the peak amplitude
//     let peak = 0;
//     for (let i = 0; i < bufferSize; i++) {
//       const abs = Math.abs(data[i]);
//       if (abs > peak) peak = abs;
//     }
    
//     // Normalize to avoid clipping but maintain energy
//     const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
//     for (let i = 0; i < bufferSize; i++) {
//       data[i] *= normalizationFactor;
//     }

//     console.log(`🔊 Generated pink noise buffer: ${bufferSize} samples, normalized by ${normalizationFactor.toFixed(4)}`);
//     this.noiseBuffer = buffer;
//   }

//   /**
//    * Create and return a pre-EQ analyzer node
//    */
//   public createPreEQAnalyser(): AnalyserNode {
//     const ctx = audioContext.getAudioContext();
    
//     // Create analyzer if it doesn't exist
//     if (!this.preEQAnalyser) {
//       // Create a gain node to combine all sources
//       this.preEQGain = ctx.createGain();
//       this.preEQGain.gain.value = 1.0;
      
//       // Create analyzer node
//       this.preEQAnalyser = ctx.createAnalyser();
//       this.preEQAnalyser.fftSize = 2048;
//       this.preEQAnalyser.smoothingTimeConstant = 0.8;
      
//       // Connect the gain to the analyzer
//       this.preEQGain.connect(this.preEQAnalyser);
      
//       // Connect to EQ processor
//       const eq = eqProcessor.getEQProcessor();
//       this.preEQGain.connect(eq.getInputNode());
//     }
    
//     return this.preEQAnalyser;
//   }
  
//   /**
//    * Get the pre-EQ analyzer, creating it if needed
//    */
//   public getPreEQAnalyser(): AnalyserNode | null {
//     return this.preEQAnalyser;
//   }

//   /**
//    * Set the square position and size
//    * @param position [left, bottom] normalized 0-1
//    * @param size [width, height] normalized 0-1
//    */
//   public setSquare(position: [number, number], size: [number, number]): void {
//     this.squarePosition = position;
//     this.squareSize = size;
//     console.log(`🔊 Square updated: pos=${position}, size=${size}`);
//   }

//   /**
//    * Get the current square position and size
//    */
//   public getSquare(): { position: [number, number], size: [number, number] } {
//     return {
//       position: this.squarePosition,
//       size: this.squareSize
//     };
//   }
  
//   /**
//    * Set the dot density (number of dots per diagonal)
//    * @param density Number between 2-5 
//    */
//   public setDotDensity(density: number): void {
//     // Ensure density is between 2-5
//     const validDensity = Math.max(2, Math.min(5, Math.floor(density)));
//     if (this.dotDensity !== validDensity) {
//       this.dotDensity = validDensity;
//       console.log(`🔊 Dot density set to ${this.dotDensity}`);
//     }
//   }
  
//   /**
//    * Get the current dot density
//    */
//   public getDotDensity(): number {
//     return this.dotDensity;
//   }

//   /**
//    * Set playing state
//    */
//   public setPlaying(playing: boolean): void {
//     if (playing === this.isPlaying) return;
    
//     this.isPlaying = playing;
//     console.log(`🔊 Square calibration ${playing ? 'started' : 'stopped'}`);
    
//     if (playing) {
//       this.startPattern();
//     } else {
//       this.stopPattern();
//     }
//   }

//   /**
//    * Get playing state
//    */
//   public isActive(): boolean {
//     return this.isPlaying;
//   }

//   /**
//    * Add a listener for corner activations
//    */
//   public addCornerListener(listener: CornerListener): void {
//     this.cornerListeners.push(listener);
//   }

//   /**
//    * Remove a corner listener
//    */
//   public removeCornerListener(listener: CornerListener): void {
//     this.cornerListeners = this.cornerListeners.filter(l => l !== listener);
//   }
  
// //   /**
// //    * Add a listener for position activations (including intermediate points)
// //    */
// //   public addPositionListener(listener: PositionListener): void {
// //     this.positionListeners.push(listener);
// //   }
  
// //   /**
// //    * Remove a position listener
// //    */
// //   public removePositionListener(listener: PositionListener): void {
// //     this.positionListeners = this.positionListeners.filter(l => l !== listener);
// //   }

//   /**
//    * Toggle between pattern modes
//    * @param mode The pattern mode to set ('diagonal' or 'drumGrid')
//    */
//   public setPatternMode(mode: PatternMode): void {
//     if (this.patternMode !== mode) {
//       this.patternMode = mode;
//       console.log(`🔊 Pattern mode changed to: ${mode}`);
      
//       // If currently playing, restart with new pattern
//       if (this.isPlaying) {
//         this.stopPattern();
//         this.startPattern();
//       }
//     }
//   }
  
//   /**
//    * Get current pattern mode
//    */
//   public getPatternMode(): PatternMode {
//     return this.patternMode;
//   }

//   /**
//    * Add a listener for grid position activations
//    */
//   public addGridPositionListener(listener: GridPositionListener): void {
//     this.gridPositionListeners.push(listener);
//   }
  
//   /**
//    * Remove a grid position listener
//    */
//   public removeGridPositionListener(listener: GridPositionListener): void {
//     this.gridPositionListeners = this.gridPositionListeners.filter(l => l !== listener);
//   }

//   /**
//    * Start the noise burst pattern
//    */
//   private startPattern(): void {
//     if (this.patternMode === 'diagonal') {
//       // Reset counter and start with first corner for diagonal mode
//       this.currentCorner = Corner.BOTTOM_LEFT;
//       this.cornerCount = 0;
      
//       // Schedule first burst
//       this.scheduleNextBurst();
//     } else {
//       // Reset counters for drum grid mode
//       this.beatCount = 0;
//       this.measureCount = 0;
//       this.sixteenthCount = 0;
      
//       // Schedule first drum pattern
//       this.scheduleDrumPattern();
//     }
//   }

//   /**
//    * Schedule the next noise burst for diagonal pattern
//    */
//   private scheduleNextBurst(): void {
//     if (!this.isPlaying || this.patternMode !== 'diagonal') return;
    
//     // Calculate the current position along the diagonal
//     const position = this.getPositionAlongDiagonal(
//       this.currentDiagonalIndex, 
//       this.currentPositionIndex, 
//       this.dotDensity
//     );
    
//     // Play noise at the calculated position
//     this.playNoiseAtPosition(position);
    
//     // If this is a corner position, notify corner listeners too
//     const isCornerPosition = this.currentPositionIndex === 0 || 
//                             this.currentPositionIndex === this.dotDensity - 1;
    
//     // Modified pattern logic: make one corner in each diagonal play twice as often
//     if (this.cornerCount % 16 < 8) {
//       // First diagonal: make BOTTOM_LEFT the primary corner (plays 2/3 of the time)
//       if (this.cornerCount % 3 === 0 || this.cornerCount % 3 === 1) {
//         this.currentCorner = Corner.BOTTOM_LEFT;
//       } else {
//         this.currentCorner = Corner.TOP_RIGHT;
//       }
//     } else {
//       // Second diagonal: make BOTTOM_RIGHT the primary corner (plays 2/3 of the time)
//       if (this.cornerCount % 3 === 0 || this.cornerCount % 3 === 1) {
//         this.currentCorner = Corner.BOTTOM_RIGHT;
//       } else {
//         this.currentCorner = Corner.TOP_LEFT;
//       }
//     }
    
//     // Notify position listeners
//     this.positionListeners.forEach(listener => 
//       listener(position, isCornerPosition, this.currentDiagonalIndex)
//     );
    
//     // Increment position index
//     this.currentPositionIndex++;
    
//     // If we've reached the end of the current diagonal
//     if (this.currentPositionIndex >= this.dotDensity) {
//       this.currentPositionIndex = 0;
      
//       // Increment corner count - used to track repeats of the pattern
//       this.cornerCount++;
      
//       // After 4 complete cycles of a diagonal, switch to the other diagonal
//       if (this.cornerCount % 4 === 0) {
//         this.currentDiagonalIndex = (this.currentDiagonalIndex + 1) % 2;
//       }
//     }
    
//     // Determine the next interval
//     // Add a small pause between diagonals
//     const isDigaonalTransition = this.currentPositionIndex === 0 && this.cornerCount % 4 === 0 && this.cornerCount > 0;
//     const nextInterval = isDigaonalTransition ? GROUP_PAUSE : BURST_INTERVAL;
    
//     // Schedule next burst
//     this.timeoutId = window.setTimeout(() => {
//       this.scheduleNextBurst();
//     }, nextInterval * 1000);
//   }
  
//   /**
//    * Schedule the drum pattern (3x3 grid)
//    */
//   private scheduleDrumPattern(): void {
//     if (!this.isPlaying || this.patternMode !== 'drumGrid') return;
    
//     // Calculate which positions should play on this sixteenth note
//     const positionsToPlay = this.getPositionsForCurrentBeat();
    
//     // Play sounds for all active positions
//     for (const position of positionsToPlay) {
//       this.playNoiseAtGridPosition(position);
      
//       // Notify listeners
//       this.gridPositionListeners.forEach(listener => listener(position));
//     }
    
//     // Update counters
//     this.sixteenthCount++;
//     if (this.sixteenthCount % 4 === 0) {
//       // Every quarter note
//       this.beatCount++;
//       if (this.beatCount % 4 === 0) {
//         // Every measure (4 beats)
//         this.measureCount++;
//         this.beatCount = 0;
//       }
//     }
//     if (this.sixteenthCount === 16) {
//       // Reset sixteenth counter after each measure
//       this.sixteenthCount = 0;
//     }
    
//     // Schedule next sixteenth note
//     this.timeoutId = window.setTimeout(() => {
//       this.scheduleDrumPattern();
//     }, SIXTEENTH_NOTE * 1000);
//   }
  
//   /**
//    * Get which grid positions should play on the current beat
//    */
//   private getPositionsForCurrentBeat(): GridPosition[] {
//     const positions: GridPosition[] = [];
//     const beat = Math.floor(this.sixteenthCount / 4) + 1; // 1-based beat number (1, 2, 3, 4)
//     const isAnd = this.sixteenthCount % 4 === 2; // is this an "and" (offbeat)
//     const isSecondMeasure = this.measureCount % 2 === 1;
    
//     // Center top: Every quarter note (beats 1, 2, 3, 4)
//     if (this.sixteenthCount % 4 === 0) {
//       positions.push(GridPosition.TOP_CENTER);
//     }
    
//     // Center bottom: Every beat 1
//     if (beat === 1 && !isAnd) {
//       positions.push(GridPosition.BOTTOM_CENTER);
//     }
    
//     // Center (snare): Every beat 3
//     if (beat === 3 && !isAnd) {
//       positions.push(GridPosition.CENTER);
//     }
    
//     // Top left: Beats 1-and and 3-and
//     if ((beat === 1 || beat === 3) && isAnd) {
//       positions.push(GridPosition.TOP_LEFT);
//     }
    
//     // Top right: Beats 2-and and 4-and
//     if ((beat === 2 || beat === 4) && isAnd) {
//       positions.push(GridPosition.TOP_RIGHT);
//     }
    
//     // Middle left: Beat 2
//     if (beat === 2 && !isAnd) {
//       positions.push(GridPosition.MIDDLE_LEFT);
//     }
    
//     // Middle right: Beat 4
//     if (beat === 4 && !isAnd) {
//       positions.push(GridPosition.MIDDLE_RIGHT);
//     }
    
//     // Bottom left: Beat 4 (every second measure)
//     if (isSecondMeasure && beat === 4 && !isAnd) {
//       positions.push(GridPosition.BOTTOM_LEFT);
//     }
    
//     // Bottom right: Beat 4-and (every second measure)
//     if (isSecondMeasure && beat === 4 && isAnd) {
//       positions.push(GridPosition.BOTTOM_RIGHT);
//     }
    
//     return positions;
//   }

//   /**
//    * Stop the pattern
//    */
//   private stopPattern(): void {
//     if (this.timeoutId !== null) {
//       window.clearTimeout(this.timeoutId);
//       this.timeoutId = null;
//     }
//   }
  
//   /**
//    * Play a noise burst at a grid position (3x3)
//    */
//   private playNoiseAtGridPosition(position: GridPosition): void {
//     if (!this.noiseBuffer) {
//       console.warn('Noise buffer not ready');
//       return;
//     }
    
//     const ctx = audioContext.getAudioContext();
    
//     // Calculate position within the square for the 3x3 grid
//     let xPos: number, yPos: number;
    
//     // Map grid position to normalized coordinates
//     // We divide the square into a 3x3 grid
//     const left = this.squarePosition[0];
//     const bottom = this.squarePosition[1];
//     const width = this.squareSize[0];
//     const height = this.squareSize[1];
    
//     const xStep = width / 2;  // Three columns
//     const yStep = height / 2; // Three rows
    
//     switch (position) {
//       case GridPosition.TOP_LEFT:
//         xPos = left;
//         yPos = bottom + height;
//         break;
//       case GridPosition.TOP_CENTER:
//         xPos = left + xStep;
//         yPos = bottom + height;
//         break;
//       case GridPosition.TOP_RIGHT:
//         xPos = left + width;
//         yPos = bottom + height;
//         break;
//       case GridPosition.MIDDLE_LEFT:
//         xPos = left;
//         yPos = bottom + yStep;
//         break;
//       case GridPosition.CENTER:
//         xPos = left + xStep;
//         yPos = bottom + yStep;
//         break;
//       case GridPosition.MIDDLE_RIGHT:
//         xPos = left + width;
//         yPos = bottom + yStep;
//         break;
//       case GridPosition.BOTTOM_LEFT:
//         xPos = left;
//         yPos = bottom;
//         break;
//       case GridPosition.BOTTOM_CENTER:
//         xPos = left + xStep;
//         yPos = bottom;
//         break;
//       case GridPosition.BOTTOM_RIGHT:
//         xPos = left + width;
//         yPos = bottom;
//         break;
//     }
    
//     // Play the sound with the same audio chain as the corner sound
//     this.playNoiseAtPosition(xPos, yPos);
    
//     // Log the grid position noise burst
//     console.log(`🔊 Grid noise burst at position ${GridPosition[position]}: x=${xPos.toFixed(2)}, y=${yPos.toFixed(2)}`);
//   }
  
//   /**
//    * Play a noise burst at a specific position
//    */
//   private playNoiseAtPosition(position: DiagonalPosition): void {
//     if (!this.noiseBuffer) {
//       console.warn('Noise buffer not ready');
//       return;
//     }
    
//     // Calculate position based on corner
//     let xPos = 0, yPos = 0;
    
//     switch (corner) {
//       case Corner.BOTTOM_LEFT:
//         xPos = this.squarePosition[0];
//         yPos = this.squarePosition[1];
//         break;
//       case Corner.TOP_RIGHT:
//         xPos = this.squarePosition[0] + this.squareSize[0];
//         yPos = this.squarePosition[1] + this.squareSize[1];
//         break;
//       case Corner.BOTTOM_RIGHT:
//         xPos = this.squarePosition[0] + this.squareSize[0];
//         yPos = this.squarePosition[1];
//         break;
//       case Corner.TOP_LEFT:
//         xPos = this.squarePosition[0];
//         yPos = this.squarePosition[1] + this.squareSize[1];
//         break;
//     }
    
//     // Play the sound
//     this.playNoiseAtPosition(xPos, yPos);
    
//     // Log the noise burst details
//     console.log(`🔊 Noise burst at corner ${Corner[corner]}: x=${xPos.toFixed(2)}, y=${yPos.toFixed(2)}`);
//   }
  
//   /**
//    * Common method to play noise at a specific position
//    */
//   private playNoiseAtPosition(xPos: number, yPos: number): void {
//     if (!this.noiseBuffer) {
//       console.warn('Noise buffer not ready');
//       return;
//     }
    
//     const ctx = audioContext.getAudioContext();
    
//     // Clamp values to 0-1 range just in case
//     const xPos = Math.max(0, Math.min(1, position.x));
//     const yPos = Math.max(0, Math.min(1, position.y));
    
//     // Create nodes
//     const source = ctx.createBufferSource();
//     source.buffer = this.noiseBuffer;
    
//     // Map y position to frequency (logarithmic)
//     const logMinFreq = Math.log2(MIN_FREQ);
//     const logMaxFreq = Math.log2(MAX_FREQ);
//     const logFreqRange = logMaxFreq - logMinFreq;
//     const centerFreq = Math.pow(2, logMinFreq + yPos * logFreqRange);
    
//     // Create a bandpass filter
//     const filter = ctx.createBiquadFilter();
//     filter.type = 'bandpass';
//     filter.frequency.value = centerFreq;
    
//     // Bandwidth is inversely proportional to square height
//     // Smaller height = much higher Q (narrower bandwidth)
//     // Use exponential scaling for more dramatic effect at small heights
//     const normalizedHeight = this.squareSize[1]; // 0 to 1
//     const heightFactor = Math.pow(1 - normalizedHeight, 2); // Square it for more dramatic effect at smaller heights
//     const Q = MIN_Q + heightFactor * (MAX_Q - MIN_Q);
    
//     filter.Q.value = Q;
    
//     // Create a panner
//     const panner = ctx.createStereoPanner();
    
//     // Map x position to panning
//     // 0 = full left, 1 = full right
//     const pan = xPos * 2 - 1; // Convert to -1 to 1 range
//     panner.pan.value = pan;
    
//     // Create a gain node
//     const gainNode = ctx.createGain();
//     gainNode.gain.value = MASTER_GAIN;
    
//     // Create envelope
//     const envelopeGain = ctx.createGain();
//     const now = ctx.currentTime;
    
//     // Set up ADSR envelope
//     envelopeGain.gain.setValueAtTime(0, now);
//     envelopeGain.gain.linearRampToValueAtTime(1, now + ENVELOPE_ATTACK);
//     envelopeGain.gain.linearRampToValueAtTime(ENVELOPE_SUSTAIN, now + ENVELOPE_ATTACK + ENVELOPE_DECAY);
//     envelopeGain.gain.setValueAtTime(ENVELOPE_SUSTAIN, now + BURST_LENGTH);
//     envelopeGain.gain.linearRampToValueAtTime(0, now + BURST_LENGTH + ENVELOPE_RELEASE);
    
//     // Connect the audio chain
//     source.connect(filter);
//     filter.connect(panner);
//     panner.connect(envelopeGain);
//     envelopeGain.connect(gainNode);
    
//     // Connect to the output destination
//     if (this.preEQGain) {
//       gainNode.connect(this.preEQGain);
//     } else {
//       const eq = eqProcessor.getEQProcessor();
//       gainNode.connect(eq.getInputNode());
//     }
    
//     // Start and automatically stop
//     source.start();
//     source.stop(now + BURST_LENGTH + ENVELOPE_RELEASE + 0.1);
//   }

//   /**
//    * Clean up resources
//    */
//   public dispose(): void {
//     this.setPlaying(false);
//     this.cornerListeners = [];
//     this.gridPositionListeners = [];
    
//     if (this.preEQGain) {
//       this.preEQGain.disconnect();
//       this.preEQGain = null;
//     }
    
//     if (this.preEQAnalyser) {
//       this.preEQAnalyser.disconnect();
//       this.preEQAnalyser = null;
//     }
    
//     this.noiseBuffer = null;
//   }
// }

// // Export Corner enum
// export { Corner };
// // export type { DiagonalPosition };

// /**
//  * Get the singleton instance of the SquareCalibrationAudio
//  */
// export function getSquareCalibrationAudio(): SquareCalibrationAudio {
//   return SquareCalibrationAudio.getInstance();
// }

// /**
//  * Clean up the square calibration audio
//  */
// export function cleanupSquareCalibrationAudio(): void {
//   const player = SquareCalibrationAudio.getInstance();
//   player.dispose();
// } 