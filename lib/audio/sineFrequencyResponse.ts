import { EQPoint } from '@/components/sine-eq/types';
import { CoordinateUtils } from '@/components/sine-eq/CoordinateUtils';

// Default frequency range for audio processing
export const DEFAULT_FREQ_RANGE = { min: 20, max: 20000 };

/**
 * Creates a frequency response function from a set of control points
 * Returns a function that can be sampled at any frequency
 */
export function createFrequencyResponseFunction(
  points: EQPoint[],
  referenceNode?: EQPoint
): (frequency: number) => number {
  // Include reference node (typically at 1kHz, 0dB) if provided
  const allPoints = referenceNode ? [referenceNode, ...points] : [...points];
  
  // Sort points by frequency for efficient lookup
  const sortedPoints = allPoints.sort((a, b) => a.frequency - b.frequency);
  
  // If no points, return a function that always returns 0
  if (sortedPoints.length === 0) {
    return () => 0;
  }
  
  // If only one point, return a function that always returns that amplitude
  if (sortedPoints.length === 1) {
    return () => sortedPoints[0].amplitude;
  }
  
  // Return a function that can calculate amplitude at any frequency
  return (frequency: number): number => {
    // Edge case checks
    if (frequency <= sortedPoints[0].frequency) {
      return sortedPoints[0].amplitude;
    }
    if (frequency >= sortedPoints[sortedPoints.length - 1].frequency) {
      return sortedPoints[sortedPoints.length - 1].amplitude;
    }
    
    // Find the points that bracket this frequency
    let freq0 = 0, freq1 = 0, freq2 = 0, freq3 = 0;
    let amp0 = 0, amp1 = 0, amp2 = 0, amp3 = 0;
    
    for (let i = 0; i < sortedPoints.length; i++) {
      const currFreq = sortedPoints[i].frequency;
      
      // Exact match
      if (frequency === currFreq) {
        return sortedPoints[i].amplitude;
      }
      
      // Found the bracket
      if (frequency < currFreq) {
        freq1 = sortedPoints[i - 1].frequency;
        amp1 = sortedPoints[i - 1].amplitude;
        freq2 = currFreq;
        amp2 = sortedPoints[i].amplitude;
        
        // Get points for Catmull-Rom interpolation
        amp0 = (i > 1) ? sortedPoints[i - 2].amplitude : amp1;
        freq0 = (i > 1) ? sortedPoints[i - 2].frequency : freq1;
        amp3 = (i < sortedPoints.length - 1) ? sortedPoints[i + 1].amplitude : amp2;
        freq3 = (i < sortedPoints.length - 1) ? sortedPoints[i + 1].frequency : freq2;
        
        break;
      }
    }
    
    // Use Catmull-Rom interpolation
    return CoordinateUtils.interpolateFrequencyResponse(
      frequency,
      freq1,
      freq2,
      amp0,
      amp1,
      amp2,
      amp3
    );
  };
}

/**
 * Generate an array of frequency response points at logarithmically spaced frequencies
 */
export function generateFrequencyResponseArray(
  responseFunction: (frequency: number) => number,
  freqRange = DEFAULT_FREQ_RANGE,
  resolution = 2048 // Higher resolution for FFT
): { frequency: number; amplitude: number }[] {
  const response: { frequency: number; amplitude: number }[] = [];
  const logMin = Math.log10(freqRange.min);
  const logMax = Math.log10(freqRange.max);
  const logStep = (logMax - logMin) / (resolution - 1);
  
  for (let i = 0; i < resolution; i++) {
    const logFreq = logMin + i * logStep;
    const freq = Math.pow(10, logFreq);
    response.push({ 
      frequency: freq, 
      amplitude: responseFunction(freq) 
    });
  }
  
  return response;
}

/**
 * Convert from dB to linear scale
 */
export function dbToLinear(dB: number): number {
  return Math.pow(10, dB / 20);
}

/**
 * Convert from linear to dB scale
 */
export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-6));
} 