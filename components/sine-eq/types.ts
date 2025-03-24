// Define the basic point structure for the sine EQ
export interface EQPoint {
  frequency: number; // Frequency in Hz
  amplitude: number; // Amplitude in dB
}

// Ghost point for hovering
export interface GhostPoint {
  visible: boolean;
  x: number;
  y: number;
  frequency: number;
  amplitude: number;
}

// Frequency response point
export interface FrequencyResponsePoint {
  frequency: number;
  amplitude: number;
} 