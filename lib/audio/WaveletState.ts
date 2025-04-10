// Define a single wavelet with its parameters
interface Wavelet {
  frequency: number;   // Number of cycles across spectrum (continuous)
  amplitude: number;   // Strength of the wavelet (-1 to 1)
  phase: number;       // Phase shift (0 to 2π)
  centerFreq: number;  // Center frequency in normalized range [0,1]
  falloff: number;     // Falloff range in normalized units [0.01,1]
}

// Import WaveletParams for profile integration
import { WaveletParams } from '@/lib/models/EQProfile';

export class WaveletState {
  // Store an array of wavelets instead of separate parameter arrays
  private wavelets: Wavelet[];
  
  constructor(initialWavelets?: Wavelet[]) {
    // Start with a single default wavelet if none provided
    this.wavelets = initialWavelets || [
      {
        frequency: 4,     // Default to 4 cycles
        amplitude: 0,     // Default to no effect
        phase: 0,         // Default to no phase shift
        centerFreq: 0.5,  // Default to center of spectrum
        falloff: 1,       // Default to infinite range (no falloff)
      }
    ];
  }
  
  // Get all wavelets
  getWavelets(): Wavelet[] {
    return [...this.wavelets];
  }
  
  // Add a new wavelet
  addWavelet(): void {
    this.wavelets.push({
      frequency: 4,     // Default to 4 cycles
      amplitude: 0,     // Default to no effect
      phase: 0,         // Default to no phase shift
      centerFreq: 0.5,  // Default to center of spectrum
      falloff: 1,       // Default to infinite range (no falloff)
    });
  }
  
  // Remove a wavelet
  removeWavelet(index: number): void {
    if (index >= 0 && index < this.wavelets.length) {
      this.wavelets.splice(index, 1);
    }
  }
  
  // Update a specific wavelet parameter
  updateWavelet(index: number, param: keyof Wavelet, value: number): void {
    if (index >= 0 && index < this.wavelets.length) {
      const wavelet = this.wavelets[index];
      
      switch (param) {
        case 'frequency':
          // Keep frequency positive
          wavelet.frequency = Math.max(0.1, value);
          break;
          
        case 'amplitude':
          // Amplitude can be negative
          wavelet.amplitude = value;
          break;
          
        case 'phase':
          // Normalize phase to range [0, 2π]
          wavelet.phase = value % (2 * Math.PI);
          if (wavelet.phase < 0) wavelet.phase += 2 * Math.PI;
          break;
          
        case 'centerFreq':
          // Clamp value to [0, 1]
          wavelet.centerFreq = Math.max(0, Math.min(1, value));
          break;
          
        case 'falloff':
          // Clamp value to [0.01, 1]
          wavelet.falloff = Math.max(0.01, Math.min(1, value));
          break;
      }
    }
  }
  
  // Get value at a specific frequency
  getValueAtFrequency(frequency: number): number {
    // Ensure frequency is in valid range
    if (frequency < 20) frequency = 20;
    if (frequency > 20000) frequency = 20000;
    
    // Normalize frequency to 0-1 range (logarithmically)
    const logFreq = Math.log10(frequency / 20) / Math.log10(20000 / 20);
    
    // Start with 0 base value
    let value = 0;
    
    // Add contribution from each wavelet
    for (const wavelet of this.wavelets) {
      // Skip if amplitude is zero (no contribution)
      if (wavelet.amplitude === 0) continue;
      
      // Calculate distance from center frequency (in normalized 0-1 space)
      const distanceFromCenter = Math.abs(logFreq - wavelet.centerFreq);
      
      // Apply falloff based on distance from center and falloff range
      // falloff = 1 means infinite range (no falloff)
      let amplitude = 1.0;
      
      if (wavelet.falloff < 1) {
        // Calculate amplitude falloff
        const normalizedDistance = distanceFromCenter / wavelet.falloff;
        if (normalizedDistance >= 1.0) {
          // Beyond falloff range, no contribution
          amplitude = 0;
        } else {
          // Smooth falloff using cosine
          amplitude = 0.5 * (1 + Math.cos(Math.PI * normalizedDistance));
        }
      }
      
      // Apply the wavelet with all parameters if amplitude is not zero
      if (amplitude > 0) {
        // Calculate the oscillation using the frequency 
        const oscillation = Math.sin(logFreq * wavelet.frequency * Math.PI + wavelet.phase);
        
        // Combine amplitude, envelope, and oscillation
        value += wavelet.amplitude * oscillation * amplitude * this.envelopeFunction(logFreq, 0.5, 0.7);
      }
    }
    
    return value;
  }
  
  // Envelope function to control the region of influence
  private envelopeFunction(x: number, center: number, width: number): number {
    // Ensure the wavelet doesn't drop off too sharply at the edges
    if (x < 0.05) return 0.5 * (1 + Math.cos(Math.PI * (1 - x/0.05)));
    if (x > 0.95) return 0.5 * (1 + Math.cos(Math.PI * (x-0.95)/0.05));
    
    // Regular envelope in the middle region
    return 1.0;
  }
  
  // Generate points for plotting (frequency, value pairs)
  generateCurvePoints(pointCount: number = 100): [number, number][] {
    const points: [number, number][] = [];
    
    for (let i = 0; i < pointCount; i++) {
      // Generate logarithmically spaced frequencies
      const t = i / (pointCount - 1);
      const frequency = 20 * Math.pow(20000 / 20, t);
      
      // Get the value at this frequency
      const value = this.getValueAtFrequency(frequency);
      
      points.push([frequency, value]);
    }
    
    return points;
  }
  
  // Helper to convert normalized frequency value (0-1) to actual Hz
  normalizedToHz(normalized: number): number {
    return 20 * Math.pow(20000 / 20, normalized);
  }
  
  // Helper to convert Hz to normalized frequency value (0-1)
  hzToNormalized(hz: number): number {
    return Math.log10(hz / 20) / Math.log10(20000 / 20);
  }
  
  // Method to export wavelets to profile format for storage
  exportWavelets(): WaveletParams[] {
    return this.wavelets.map(wavelet => ({
      frequency: wavelet.frequency,
      amplitude: wavelet.amplitude,
      phase: wavelet.phase,
      centerFreq: wavelet.centerFreq,
      falloff: wavelet.falloff
    }));
  }
  
  // Method to import wavelets from profile
  importWavelets(params: WaveletParams[] | undefined): void {
    if (!params || params.length === 0) {
      // Keep default if no params provided
      return;
    }
    
    // Replace the current wavelets with the ones from the profile
    this.wavelets = params.map(param => ({
      frequency: param.frequency,
      amplitude: param.amplitude,
      phase: param.phase,
      centerFreq: param.centerFreq,
      falloff: param.falloff
    }));
  }
} 