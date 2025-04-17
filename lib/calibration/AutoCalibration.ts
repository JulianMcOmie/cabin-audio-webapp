export interface NoiseSourceConfig {
  type: 'pink'; // Start with pink noise, maybe expand later
  centerFrequency: number;
  position: number; // e.g., -1 (left) to 1 (right)
  bandwidth: number; // Q factor or similar
  pulsing?: boolean; // Whether the source should pulse
  pulseDelay?: number; // Delay in seconds before the first pulse cycle starts
  pulsePeriod?: number; // Period in seconds for the pulse repetition
  // Volume/gain might also be needed
}

export interface CalibrationStep {
  id: number;
  instruction: string;
  targetBandIndex: number | 'new'; // Index of the band to modify, or 'new' to add one
  parameterToControl: 'frequency' | 'gain' | 'q';
  controlRange: [number, number]; // Min/max for the control (e.g., slider)
  initialValue?: number; // Optional starting value for the control
  noiseSources: NoiseSourceConfig[];
  // Optional initial parameters ONLY if targetBandIndex is 'new'
  initialNewBandFrequency?: number; 
  initialNewBandGain?: number;
  initialNewBandQ?: number;
}

export class AutoCalibration {
  private steps: CalibrationStep[];
  private currentStepIndex: number;

  // Helper method to generate the noise sources
  private _generateCheckerboardNoiseSources(): NoiseSourceConfig[] {
    const sources: NoiseSourceConfig[] = [];
    const GRID_DIMENSION = 5; // NxN grid
    const MIN_FREQ = 20; // Hz
    const MAX_FREQ = 20000; // Hz

    // --- Calculate Logarithmic Frequencies --- 
    const frequencies: number[] = [];
    const bandEdges: number[] = [];
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);
    const logRange = logMax - logMin;
    const logRatioPerBand = logRange / GRID_DIMENSION;

    for (let i = 0; i <= GRID_DIMENSION; i++) {
       bandEdges.push(10**(logMin + i * logRatioPerBand));
    }
    for (let i = 0; i < GRID_DIMENSION; i++) {
        // Center frequency as geometric mean of edges
        frequencies.push(Math.sqrt(bandEdges[i] * bandEdges[i+1]));
    }

    // --- Calculate Evenly Spaced Positions --- 
    const positions: number[] = [];
    const positionStep = 2 / GRID_DIMENSION;
    for (let j = 0; j < GRID_DIMENSION; j++) {
      // Center of each position segment
      positions.push(-1 + positionStep * (j + 0.5));
    }

    // --- Calculate Bandwidth (Q) based on logarithmic division --- 
    // Bandwidth in octaves is constant for log spacing
    const freqRatio = bandEdges[1] / bandEdges[0]; // Same for all bands
    const bandwidthOctaves = Math.log2(freqRatio);
    // Formula relating Q to bandwidth in octaves: Q = sqrt(2^BW) / (2^BW - 1)
    // Handle potential division by zero if BW is 0 (shouldn't happen here)
    const twoPowBW = Math.pow(2, bandwidthOctaves);
    const bandwidthQ = twoPowBW === 1 ? 100 : Math.sqrt(twoPowBW) / (twoPowBW - 1); // High Q if BW=0

    const baseDelay = 0.01; // Base start delay
    const STAGGER_PER_COLUMN = 0.015; // Fixed delay added per column index (seconds)
    const periodA = 1.0; // Pulse period for group A (slower)
    const periodB = 0.5; // Pulse period for group B (faster)

    for (let i = 0; i < frequencies.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        const isGroupA = (i + j) % 2 === 0; // Checkerboard pattern
        const pulsePeriod = isGroupA ? periodA : periodB;
        // Group B starts roughly half a cycle of Group A later
        const groupDelayOffset = isGroupA ? 0 : periodA / 2;

        // Fixed stagger based on column index
        const columnStagger = j * STAGGER_PER_COLUMN;
        const pulseDelay = baseDelay + groupDelayOffset + columnStagger;

        sources.push({
          type: 'pink',
          centerFrequency: frequencies[i],
          position: positions[j],
          bandwidth: bandwidthQ,
          pulsing: true,
          pulsePeriod: pulsePeriod,
          pulseDelay: pulseDelay,
        });
      }
    }
    return sources;
  }

  constructor() {
    // Generate the common noise sources pattern once
    const checkerboardNoiseSources = this._generateCheckerboardNoiseSources();

    this.steps = [
      // Step 1: Adjust wide high frequency band gain
      {
        id: 1,
        instruction: "Adjust gain to separate the high sounds (sides) from the mid sound (center).",
        targetBandIndex: 'new',
        parameterToControl: 'gain',
        controlRange: [-12, 12],
        initialValue: 0,
        initialNewBandFrequency: 12000, // Keep original band target params
        initialNewBandGain: 0,
        initialNewBandQ: 1.0,
        noiseSources: checkerboardNoiseSources, // Use generated sources
      },
      // Step 2: Adjust wide low frequency band gain
      {
        id: 2,
        instruction: "Adjust gain to separate the low sounds (sides) from the mid sound (center).",
        targetBandIndex: 'new',
        parameterToControl: 'gain',
        controlRange: [-12, 12],
        initialValue: 0,
        initialNewBandFrequency: 150, // Keep original band target params
        initialNewBandGain: 0,
        initialNewBandQ: 1.0,
        noiseSources: checkerboardNoiseSources, // Use generated sources
      },
      // Step 3: Adjust frequency of a low-mid dip
      {
        id: 3,
        instruction: "Adjust the frequency of the dip to best separate the low sounds (sides) from the mid sound (center).",
        targetBandIndex: 'new',
        parameterToControl: 'frequency',
        controlRange: [100, 1000],
        initialValue: 500,
        initialNewBandFrequency: 500, // Keep original band target params
        initialNewBandGain: -12,
        initialNewBandQ: 2,
        noiseSources: checkerboardNoiseSources, // Use generated sources
      },
    ];
    this.currentStepIndex = 0;
  }

  getCurrentStep(): CalibrationStep | null {
    return this.steps[this.currentStepIndex] || null;
  }

  nextStep(): boolean {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
      return true;
    }
    return false; // No more steps
  }

  reset(): void {
    this.currentStepIndex = 0;
  }

  getTotalSteps(): number {
    return this.steps.length;
  }
} 