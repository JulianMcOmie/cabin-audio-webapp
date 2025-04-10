import { AmplitudeCurveParams } from './AmplitudeCurveControls';

/**
 * Calculate the amplitude (gain) for a given frequency based on the amplitude curve parameters
 * @param frequency The frequency to calculate the amplitude for (in Hz)
 * @param params The amplitude curve parameters
 * @returns The amplitude in dB
 */
export function calculateAmplitudeMultiplier(
  frequency: number,
  params: AmplitudeCurveParams
): number {
  // If no parameters are provided, return 0 (no change)
  if (!params) return 0;
  
  // Choose the appropriate curve calculation based on the curve type
  switch (params.curveType) {
    case 'shelving':
      return calculateShelvingCurve(frequency, params);
    case 'notch':
      return calculateNotchCurve(frequency, params);
    case 'bandpass':
      return calculateBandpassCurve(frequency, params);
    case 'parametric':
    default:
      return calculateParametricCurve(frequency, params);
  }
}

/**
 * Calculate a parametric curve with multiple control points
 */
function calculateParametricCurve(frequency: number, params: AmplitudeCurveParams): number {
  // Extract parameters
  const { 
    lowEndGain, highEndGain, 
    midPointFreq, midPointGain,
    lowMidFreq, lowMidGain,
    highMidFreq, highMidGain,
    resonanceFreq, resonanceGain, resonanceQ,
    curveShape 
  } = params;
  
  // Convert frequencies to logarithmic scale
  const logFreq = Math.log10(frequency);
  const logLowFreq = Math.log10(20); // 20Hz
  const logHighFreq = Math.log10(20000); // 20kHz
  
  // Define all control points in order of frequency
  const controlPoints = [
    { freq: 20, gain: lowEndGain },
    { freq: lowMidFreq, gain: lowMidGain },
    { freq: midPointFreq, gain: midPointGain },
    { freq: highMidFreq, gain: highMidGain },
    { freq: 20000, gain: highEndGain }
  ].sort((a, b) => a.freq - b.freq); // Ensure points are in frequency order
  
  // Find the two points that bracket the input frequency
  let lowerPoint = controlPoints[0];
  let upperPoint = controlPoints[controlPoints.length - 1];
  
  for (let i = 0; i < controlPoints.length - 1; i++) {
    if (frequency >= controlPoints[i].freq && frequency <= controlPoints[i + 1].freq) {
      lowerPoint = controlPoints[i];
      upperPoint = controlPoints[i + 1];
      break;
    }
  }
  
  // Calculate the basic interpolation
  const logLowerFreq = Math.log10(lowerPoint.freq);
  const logUpperFreq = Math.log10(upperPoint.freq);
  
  // Calculate position on the log scale from 0 to 1
  let t = (logFreq - logLowerFreq) / (logUpperFreq - logLowerFreq);
  
  // Apply curve shaping (power function)
  if (curveShape !== 0.5) {
    const power = curveShape < 0.5 
      ? 1 + (0.5 - curveShape) * 4 // Concave curve (1 to 3)
      : 1 / (1 + (curveShape - 0.5) * 4); // Convex curve (1 to 1/3)
    
    t = Math.pow(t, power);
  }
  
  // Linear interpolation between points
  let gain = lowerPoint.gain + (upperPoint.gain - lowerPoint.gain) * t;
  
  // Add resonance peak if enabled
  if (resonanceGain !== 0 && resonanceQ > 0) {
    // Calculate distance from resonance frequency (in octaves)
    const octaveDistance = Math.log2(frequency / resonanceFreq);
    
    // Apply peak based on distance and Q factor
    // Higher Q = narrower peak
    const resonanceFactor = Math.exp(-Math.pow(octaveDistance * resonanceQ, 2));
    
    // Add the resonance to the gain
    gain += resonanceGain * resonanceFactor;
  }
  
  return gain;
}

/**
 * Calculate a shelving curve with low shelf and high shelf
 */
function calculateShelvingCurve(frequency: number, params: AmplitudeCurveParams): number {
  const { 
    lowEndGain, highEndGain, 
    midPointFreq, 
    curveShape 
  } = params;
  
  // Convert to log scale
  const logFreq = Math.log10(frequency);
  const logMidFreq = Math.log10(midPointFreq);
  
  // Calculate transition steepness (higher curve shape = steeper transition)
  const steepness = 1 + curveShape * 3;
  
  // Calculate low shelf component
  let lowShelf = 0;
  if (lowEndGain !== 0) {
    // Sigmoid function for smooth transition centered at midpoint
    const lowShelfFactor = 1 / (1 + Math.exp(steepness * (logFreq - logMidFreq)));
    lowShelf = lowEndGain * lowShelfFactor;
  }
  
  // Calculate high shelf component
  let highShelf = 0;
  if (highEndGain !== 0) {
    // Sigmoid function for smooth transition centered at midpoint
    const highShelfFactor = 1 / (1 + Math.exp(-steepness * (logFreq - logMidFreq)));
    highShelf = highEndGain * highShelfFactor;
  }
  
  return lowShelf + highShelf;
}

/**
 * Calculate a notch filter curve
 */
function calculateNotchCurve(frequency: number, params: AmplitudeCurveParams): number {
  const { 
    midPointFreq, midPointGain,
    resonanceQ
  } = params;
  
  // For notch, we invert the resonance to create a dip
  const notchGain = -Math.abs(midPointGain);
  
  // Calculate distance from notch frequency (in octaves)
  const octaveDistance = Math.log2(frequency / midPointFreq);
  
  // Higher Q = narrower notch
  const notchQ = resonanceQ * 2; // Scale Q to make the notch appropriately narrow
  const notchFactor = Math.exp(-Math.pow(octaveDistance * notchQ, 2));
  
  // Calculate notch (negative gain at center frequency)
  return notchGain * notchFactor;
}

/**
 * Calculate a bandpass filter curve
 */
function calculateBandpassCurve(frequency: number, params: AmplitudeCurveParams): number {
  const {
    lowMidFreq, highMidFreq,
    midPointGain, curveShape
  } = params;
  
  // Convert to log scale
  const logFreq = Math.log10(frequency);
  const logLowMidFreq = Math.log10(lowMidFreq);
  const logHighMidFreq = Math.log10(highMidFreq);
  
  // Center of the band
  const logCenterFreq = (logLowMidFreq + logHighMidFreq) / 2;
  
  // Width of the band
  const logBandwidth = logHighMidFreq - logLowMidFreq;
  
  // Calculate distance from center (normalized by bandwidth)
  const distanceFromCenter = 2 * Math.abs(logFreq - logCenterFreq) / logBandwidth;
  
  // Calculate bandpass response
  let bandpassFactor = 0;
  
  if (distanceFromCenter <= 1) {
    // Inside the band: apply cosine shape
    bandpassFactor = Math.cos(Math.PI * distanceFromCenter / 2);
    
    // Apply curve shape to modify the response
    bandpassFactor = Math.pow(bandpassFactor, 1 + curveShape * 3);
  }
  
  return midPointGain * bandpassFactor;
}

/**
 * Apply the amplitude curve to a frequency response
 * @param response The frequency response to modify
 * @param params The amplitude curve parameters
 * @returns The modified frequency response
 */
export function applyAmplitudeCurve(
  response: { frequency: number; magnitude: number }[],
  params: AmplitudeCurveParams
): { frequency: number; magnitude: number }[] {
  if (!params) return response;
  
  return response.map(point => {
    const amplitudeMultiplier = calculateAmplitudeMultiplier(point.frequency, params);
    return {
      frequency: point.frequency,
      magnitude: point.magnitude + amplitudeMultiplier
    };
  });
} 