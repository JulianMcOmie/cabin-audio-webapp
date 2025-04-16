export interface NoiseSourceConfig {
  type: 'pink'; // Start with pink noise, maybe expand later
  centerFrequency: number;
  position: number; // e.g., -1 (left) to 1 (right)
  bandwidth: number; // Q factor or similar
  pulsing?: boolean; // Whether the source should pulse
  pulseDelay?: number; // Delay in seconds before the first pulse cycle starts
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

  constructor() {
    // Replace existing steps with the new simplified sequence including pulsing info
    this.steps = [
      // Step 1: Adjust wide high frequency band gain
      {
        id: 1,
        instruction: "Adjust gain to separate the high sounds (sides) from the mid sound (center).",
        targetBandIndex: 'new',
        parameterToControl: 'gain',
        controlRange: [-12, 12],
        initialValue: 0,
        initialNewBandFrequency: 12000,
        initialNewBandGain: 0,
        initialNewBandQ: 1.0,
        noiseSources: [
          // Non-pulsing center sound
          { type: 'pink', centerFrequency: 1000, position: -1, bandwidth: 1, pulsing: false },
          { type: 'pink', centerFrequency: 1000, position: 1, bandwidth: 1, pulsing: false },
          // Pulsing side sounds
          { type: 'pink', centerFrequency: 10000, position: -1, bandwidth: 1, pulsing: true, pulseDelay: 0 }, // Left starts immediately
          { type: 'pink', centerFrequency: 10000, position: 1, bandwidth: 1, pulsing: true, pulseDelay: 0.5 }, // Right starts half a second later
        ],
      },
      // Step 2: Adjust wide low frequency band gain
      {
        id: 2,
        instruction: "Adjust gain to separate the low sounds (sides) from the mid sound (center).",
        targetBandIndex: 'new',
        parameterToControl: 'gain',
        controlRange: [-12, 12],
        initialValue: 0,
        initialNewBandFrequency: 150,
        initialNewBandGain: 0,
        initialNewBandQ: 1.0,
        noiseSources: [
          // Non-pulsing center sound
          { type: 'pink', centerFrequency: 1000, position: 0, bandwidth: 1, pulsing: false },
           // Pulsing side sounds
          { type: 'pink', centerFrequency: 150, position: -1, bandwidth: 1, pulsing: true, pulseDelay: 0 },
          { type: 'pink', centerFrequency: 150, position: 1, bandwidth: 1, pulsing: true, pulseDelay: 0.5 },
        ],
      },
      // Step 3: Adjust frequency of a low-mid dip
      {
        id: 3,
        instruction: "Adjust the frequency of the dip to best separate the low sounds (sides) from the mid sound (center).",
        targetBandIndex: 'new',
        parameterToControl: 'frequency',
        controlRange: [100, 1000],
        initialValue: 500,
        initialNewBandFrequency: 500,
        initialNewBandGain: -12,
        initialNewBandQ: 2,
        noiseSources: [ // Use pulsing from previous step setup
           // Non-pulsing center sound
          { type: 'pink', centerFrequency: 150, position: 0, bandwidth: 1, pulsing: false },
           // Pulsing side sounds
          { type: 'pink', centerFrequency: 150, position: -1, bandwidth: 1, pulsing: true, pulseDelay: 0 },
          { type: 'pink', centerFrequency: 150, position: 1, bandwidth: 1, pulsing: true, pulseDelay: 0.5 },
        ],
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