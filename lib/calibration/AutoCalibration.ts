export interface NoiseSourceConfig {
  type: 'pink'; // Start with pink noise, maybe expand later
  centerFrequency: number;
  position: number; // e.g., -1 (left) to 1 (right)
  bandwidth: number; // Q factor or similar
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
}

export class AutoCalibration {
  private steps: CalibrationStep[];
  private currentStepIndex: number;

  constructor() {
    // Placeholder steps - these will need actual values
    this.steps = [
      {
        id: 1,
        instruction: "Adjust the slider until the sound feels centered.",
        targetBandIndex: 'new',
        parameterToControl: 'frequency',
        controlRange: [100, 1000],
        initialValue: 500,
        noiseSources: [
          { type: 'pink', centerFrequency: 400, position: -0.5, bandwidth: 1 },
          { type: 'pink', centerFrequency: 600, position: 0.5, bandwidth: 1 },
        ],
      },
      {
        id: 2,
        instruction: "Adjust the gain until the sound is clear but not harsh.",
        targetBandIndex: 0, // Assumes the first step added a band at index 0
        parameterToControl: 'gain',
        controlRange: [-12, 12],
        initialValue: 0,
        noiseSources: [
           { type: 'pink', centerFrequency: 500, position: 0, bandwidth: 2 },
        ]
      },
      // Add more steps as needed
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