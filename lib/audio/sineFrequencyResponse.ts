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
    // Find the two points that bracket this frequency
    let leftPoint: EQPoint | null = null;
    let rightPoint: EQPoint | null = null;
    
    for (const point of sortedPoints) {
      if (point.frequency <= frequency) {
        if (!leftPoint || point.frequency > leftPoint.frequency) {
          leftPoint = point;
        }
      }
      
      if (point.frequency >= frequency) {
        if (!rightPoint || point.frequency < rightPoint.frequency) {
          rightPoint = point;
        }
      }
    }
    
    // Interpolate between points
    if (leftPoint && rightPoint) {
      if (leftPoint === rightPoint) {
        return leftPoint.amplitude;
      } else {
        return CoordinateUtils.linearInterpolate(
          frequency,
          leftPoint.frequency,
          leftPoint.amplitude,
          rightPoint.frequency,
          rightPoint.amplitude
        );
      }
    } else if (leftPoint) {
      // We're to the right of all points
      return leftPoint.amplitude;
    } else if (rightPoint) {
      // We're to the left of all points
      return rightPoint.amplitude;
    } else {
      // This shouldn't happen, but just in case
      return 0;
    }
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