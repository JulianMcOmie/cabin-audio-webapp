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
  // Optional initial parameters ONLY if targetBandIndex is 'new'
  initialNewBandFrequency?: number; 
  initialNewBandGain?: number;
  initialNewBandQ?: number;
}

export class AutoCalibration {
  private steps: CalibrationStep[];
  private currentStepIndex: number;

  constructor() {
    // Defined calibration steps based on user request
    this.steps = [
      {
        id: 1,
        instruction: "Adjust gain to separate the high (left) and low (right) sounds.",
        targetBandIndex: 'new',       // Creates band 0
        parameterToControl: 'gain',
        controlRange: [-12, 12],      // Allow cutting
        initialValue: 0,
        initialNewBandFrequency: 50,  // Explicit initial frequency for the new band
        initialNewBandGain: 0,       // Start gain at controlled value
        initialNewBandQ: 1,           // Default Q
        noiseSources: [
          { type: 'pink', centerFrequency: 10000, position: -0.8, bandwidth: 1 }, // High left
          { type: 'pink', centerFrequency: 100, position: 0.8, bandwidth: 1 },   // Low right
        ],
      },
      {
        id: 2,
        instruction: "Adjust gain to separate the low (left) and high (right) sounds.",
        targetBandIndex: 'new',       // Creates band 1
        parameterToControl: 'gain',
        controlRange: [-12, 12],
        initialValue: 0,
        initialNewBandFrequency: 15000, // Explicit initial frequency
        initialNewBandGain: 0,        // Start gain at controlled value
        initialNewBandQ: 1,            // Default Q
        noiseSources: [
          { type: 'pink', centerFrequency: 100, position: -0.8, bandwidth: 1 },   // Low left
          { type: 'pink', centerFrequency: 10000, position: 0.8, bandwidth: 1 }, // High right
        ],
      },
      {
        id: 3,
        instruction: "Adjust the frequency of the dip to best separate the 1kHz and 10kHz sounds.",
        targetBandIndex: 'new',       // Creates band 2
        parameterToControl: 'frequency',
        controlRange: [500, 5000],   // Range around 1k-10k midpoint
        initialValue: 1000,         // Start near the lower sound
        initialNewBandFrequency: 1000,  // Start frequency at controlled value
        initialNewBandGain: -12,        // Initial dip
        initialNewBandQ: 3,             // Wider Q for dip
        noiseSources: [
          { type: 'pink', centerFrequency: 1000, position: 0, bandwidth: 2 }, // Mid
          { type: 'pink', centerFrequency: 10000, position: 0, bandwidth: 2 }, // High
        ],
      },
      {
        id: 4,
        instruction: "Adjust the gain of the dip to best separate the 1kHz and 100Hz sounds.",
        targetBandIndex: 2,           // Modify band created in step 3
        parameterToControl: 'gain',
        controlRange: [-24, 0],
        initialValue: -12,          // Start from the previous step's setting
        noiseSources: [
          { type: 'pink', centerFrequency: 1000, position: 0, bandwidth: 2 }, // Mid
          { type: 'pink', centerFrequency: 100, position: 0, bandwidth: 2 },  // Low
        ]
        // No initialNewBand* fields needed as it targets an existing band
      },
      {
        id: 5,
        instruction: "Adjust the frequency of the dip to make the 250Hz sound feel wider.",
        targetBandIndex: 'new',       // Creates band 3
        parameterToControl: 'frequency',
        controlRange: [150, 400],    // Range around 250Hz
        initialValue: 250,
        initialNewBandFrequency: 250,   // Start frequency at controlled value
        initialNewBandGain: -12,        // Initial dip
        initialNewBandQ: 3,             // Wider Q for dip
        noiseSources: [
          { type: 'pink', centerFrequency: 250, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 250, position: 0.8, bandwidth: 1 },  // Right
        ],
      },
      {
        id: 6,
        instruction: "Adjust the gain of the dip to refine the width of the 250Hz sound.",
        targetBandIndex: 3,           // Modify band created in step 5
        parameterToControl: 'gain',
        controlRange: [-24, 0],
        initialValue: -12,
        noiseSources: [
          { type: 'pink', centerFrequency: 250, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 250, position: 0.8, bandwidth: 1 },  // Right
        ]
      },
      {
        id: 7,
        instruction: "Adjust the frequency of the dip to make the 4kHz sound feel wider.",
        targetBandIndex: 'new',       // Creates band 4
        parameterToControl: 'frequency',
        controlRange: [2000, 6000],  // Range around 4kHz
        initialValue: 4000,
        initialNewBandFrequency: 4000,  // Start frequency at controlled value
        initialNewBandGain: -12,        // Initial dip
        initialNewBandQ: 3,             // Wider Q for dip
        noiseSources: [
          { type: 'pink', centerFrequency: 4000, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 4000, position: 0.8, bandwidth: 1 },  // Right
        ],
      },
      {
        id: 8,
        instruction: "Adjust the gain of the dip to refine the width of the 4kHz sound.",
        targetBandIndex: 4,           // Modify band created in step 7
        parameterToControl: 'gain',
        controlRange: [-24, 0],
        initialValue: -12,
        noiseSources: [
          { type: 'pink', centerFrequency: 4000, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 4000, position: 0.8, bandwidth: 1 },  // Right
        ]
      },
      {
        id: 9,
        instruction: "Adjust the frequency of the peak to make the 7kHz sound feel wider.",
        targetBandIndex: 'new',       // Creates band 5
        parameterToControl: 'frequency',
        controlRange: [5000, 9000],   // Range around 7kHz
        initialValue: 7000,
        initialNewBandFrequency: 7000,  // Start frequency at controlled value
        initialNewBandGain: 12,         // Initial peak of 12dB
        initialNewBandQ: 2,             // Default Q
        noiseSources: [
          { type: 'pink', centerFrequency: 7000, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 7000, position: 0.8, bandwidth: 1 },  // Right
        ],
      },
      {
        id: 10,
        instruction: "Adjust the gain of the peak to refine the width of the 7kHz sound.",
        targetBandIndex: 5,           // Modify band created in step 9
        parameterToControl: 'gain',
        controlRange: [0, 24],
        initialValue: 12,
        noiseSources: [
          { type: 'pink', centerFrequency: 7000, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 7000, position: 0.8, bandwidth: 1 },  // Right
        ]
      },
      {
        id: 11,
        instruction: "Adjust the bandwidth of the peak to fine-tune the 7kHz sound.",
        targetBandIndex: 5,           // Modify band created in step 9
        parameterToControl: 'q',
        controlRange: [0.5, 10],
        initialValue: 2,
        noiseSources: [
          { type: 'pink', centerFrequency: 7000, position: -0.8, bandwidth: 1 }, // Left
          { type: 'pink', centerFrequency: 7000, position: 0.8, bandwidth: 1 },  // Right
        ]
      },
      {
        id: 12,
        instruction: "Adjust the frequency of the dip to best separate 300Hz and 700Hz sounds.",
        targetBandIndex: 'new',       // Creates band 6
        parameterToControl: 'frequency',
        controlRange: [400, 600],     // Range between 300Hz and 700Hz
        initialValue: 500,
        initialNewBandFrequency: 500,  // Start frequency at controlled value
        initialNewBandGain: -6,        // Initial dip of 6dB
        initialNewBandQ: 2,            // Default Q for dip
        noiseSources: [
          { type: 'pink', centerFrequency: 300, position: 0, bandwidth: 1 },    // Centered
          { type: 'pink', centerFrequency: 700, position: 0.5, bandwidth: 1 },  // Half-right
        ],
      },
      {
        id: 13,
        instruction: "Adjust the frequency of the thin dip to best separate 2.5kHz and 5kHz sounds.",
        targetBandIndex: 'new',       // Creates band 7
        parameterToControl: 'frequency',
        controlRange: [3000, 4500],   // Range between the two frequencies
        initialValue: 3750,           // Midpoint as starting value
        initialNewBandFrequency: 3750, // Start frequency at controlled value
        initialNewBandGain: -12,       // Initial dip
        initialNewBandQ: 5,            // Thin dip (high Q)
        noiseSources: [
          { type: 'pink', centerFrequency: 2500, position: -0.6, bandwidth: 0.7 }, // Left-panned, thin
          { type: 'pink', centerFrequency: 5000, position: 0.3, bandwidth: 0.7 },  // Right-panned, thin
        ],
      },
      {
        id: 14,
        instruction: "Adjust the gain to find the best balance between 2.5kHz and 5kHz sounds.",
        targetBandIndex: 7,           // Modify band created in step 13
        parameterToControl: 'gain',
        controlRange: [-18, 12],      // Allow for both dips and peaks
        initialValue: -12,            // Start with the dip from previous step
        noiseSources: [
          { type: 'pink', centerFrequency: 2500, position: -0.6, bandwidth: 0.7 }, // Left-panned, thin
          { type: 'pink', centerFrequency: 5000, position: 0.3, bandwidth: 0.7 },  // Right-panned, thin
        ]
      },
      {
        id: 15,
        instruction: "Fine-tune the bandwidth (Q) to optimize separation of 2.5kHz and 5kHz.",
        targetBandIndex: 7,           // Modify band created in step 13
        parameterToControl: 'q',
        controlRange: [2, 12],        // Allow for varying levels of precision
        initialValue: 5,              // Start with the Q from previous step
        noiseSources: [
          { type: 'pink', centerFrequency: 2500, position: -0.6, bandwidth: 0.7 }, // Left-panned, thin
          { type: 'pink', centerFrequency: 5000, position: 0.3, bandwidth: 0.7 },  // Right-panned, thin
        ]
      },
      {
        id: 16,
        instruction: "Adjust the frequency of the thin dip to best separate 6kHz and 9kHz sounds.",
        targetBandIndex: 'new',       // Creates band 8
        parameterToControl: 'frequency',
        controlRange: [6500, 8500],   // Range between the two frequencies
        initialValue: 7500,           // Midpoint as starting value
        initialNewBandFrequency: 7500, // Start frequency at controlled value
        initialNewBandGain: -12,       // Initial dip
        initialNewBandQ: 5,            // Thin dip (high Q)
        noiseSources: [
          { type: 'pink', centerFrequency: 6000, position: 0.4, bandwidth: 0.7 }, // Right-biased, thin
          { type: 'pink', centerFrequency: 9000, position: -0.2, bandwidth: 0.7 }, // Left-biased, thin
        ],
      },
      {
        id: 17,
        instruction: "Adjust the gain to find the best balance between 6kHz and 9kHz sounds.",
        targetBandIndex: 8,           // Modify band created in step 16
        parameterToControl: 'gain',
        controlRange: [-18, 12],      // Allow for both dips and peaks
        initialValue: -12,            // Start with the dip from previous step
        noiseSources: [
          { type: 'pink', centerFrequency: 6000, position: 0.4, bandwidth: 0.7 }, // Right-biased, thin
          { type: 'pink', centerFrequency: 9000, position: -0.2, bandwidth: 0.7 }, // Left-biased, thin
        ]
      },
      {
        id: 18,
        instruction: "Fine-tune the bandwidth (Q) to optimize separation of 6kHz and 9kHz.",
        targetBandIndex: 8,           // Modify band created in step 16
        parameterToControl: 'q',
        controlRange: [2, 12],        // Allow for varying levels of precision
        initialValue: 5,              // Start with the Q from previous step
        noiseSources: [
          { type: 'pink', centerFrequency: 6000, position: 0.4, bandwidth: 0.7 }, // Right-biased, thin
          { type: 'pink', centerFrequency: 9000, position: -0.2, bandwidth: 0.7 }, // Left-biased, thin
        ]
      }
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