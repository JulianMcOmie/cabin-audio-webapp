import { useState, useEffect, useMemo } from 'react';
import { EQBandWithUI, FrequencyResponse } from './types';
import * as audioContext from '@/lib/audio/audioContext';

// Higher resolution for frequency points
const FREQUENCY_POINTS = 500; // Increased from 100 to 500 points

/**
 * Hook for calculating frequency responses for EQ bands
 */
export function useEQProcessor(bands: EQBandWithUI[]) {
  const [frequencyResponse, setFrequencyResponse] = useState<FrequencyResponse[]>([]);

  // Calculate frequency response when bands change
  useEffect(() => {
    setFrequencyResponse(calculateCombinedFrequencyResponse(bands));
  }, [bands]);

  return {
    frequencyResponse
  };
}

/**
 * Generate logarithmically spaced frequency points from 20Hz to 20kHz
 */
export function generateFrequencyPoints(count: number = FREQUENCY_POINTS): Float32Array {
  // Create a Float32Array for the frequency points (required by getFrequencyResponse)
  const frequencies = new Float32Array(count);
  
  // Generate logarithmically spaced frequency points
  for (let i = 0; i < count; i++) {
    // Use log scale for better frequency distribution
    // This formula gives more points in the lower frequencies which is perceptually important
    frequencies[i] = 20 * Math.pow(10, i / (count / 3));
  }
  
  return frequencies;
}

/**
 * Calculate frequency response for a single band using the Web Audio API
 */
export function calculateBandResponse(band: EQBandWithUI): FrequencyResponse[] {
  // Get frequency points
  const frequencies = generateFrequencyPoints();
  
  // Create a temporary filter to get exact frequency response
  const ctx = audioContext.getAudioContext();
  const filter = ctx.createBiquadFilter();
  
  // Configure the filter with the band's parameters
  filter.type = band.type;
  filter.frequency.value = band.frequency;
  filter.Q.value = band.q;
  filter.gain.value = band.gain;
  
  // Arrays for the frequency response
  const magResponse = new Float32Array(frequencies.length);
  const phaseResponse = new Float32Array(frequencies.length); // We don't use phase data
  
  // Get exact frequency response
  filter.getFrequencyResponse(frequencies, magResponse, phaseResponse);
  
  // Convert magnitude response to dB for consistency with the rest of the app
  const response: FrequencyResponse[] = [];
  
  for (let i = 0; i < frequencies.length; i++) {
    // Convert linear magnitude to dB gain
    // Web Audio API returns linear magnitude, so we need to convert to dB
    const linearMagnitude = magResponse[i];
    let dbGain = 0;
    
    if (linearMagnitude > 0) {
      // Convert magnitude to dB
      dbGain = 20 * Math.log10(linearMagnitude);
      
      // Normalize peak gains to match user's expected gain value
      // This is especially important for peaking and shelving filters
      if (band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf') {
        // Find the approximate peak value at the center frequency
        const centerFreqIndex = frequencies.findIndex(f => f >= band.frequency);
        if (centerFreqIndex >= 0) {
          const peakGain = Math.max(
            Math.abs(20 * Math.log10(magResponse[Math.max(0, centerFreqIndex - 1)])),
            Math.abs(20 * Math.log10(magResponse[centerFreqIndex])),
            Math.abs(20 * Math.log10(magResponse[Math.min(frequencies.length - 1, centerFreqIndex + 1)]))
          );
          
          // Scale the response to match the expected gain
          if (peakGain > 0.1) {
            const scaleFactor = Math.abs(band.gain) / peakGain;
            dbGain *= scaleFactor;
          }
        }
      }
    }
    
    response.push({
      frequency: frequencies[i],
      magnitude: dbGain
    });
  }
  
  return response;
}

/**
 * Calculate combined frequency response for all bands with higher resolution
 */
export function calculateCombinedFrequencyResponse(bands: EQBandWithUI[]): FrequencyResponse[] {
  // If no bands, return flat response
  if (bands.length === 0) {
    // Return a flat response with higher resolution
    const frequencies = generateFrequencyPoints();
    return Array.from(frequencies, frequency => ({
      frequency,
      magnitude: 0
    }));
  }
  
  // Get frequency points
  const frequencies = generateFrequencyPoints();
  
  // Calculate individual band responses if not already calculated
  const bandsWithResponses = bands.map(band => {
    if (!band.frequencyResponse || band.frequencyResponse.length !== FREQUENCY_POINTS) {
      return {
        ...band,
        frequencyResponse: calculateBandResponse(band)
      };
    }
    return band;
  });
  
  // Combine responses from all bands by summing magnitudes
  const combinedResponse: FrequencyResponse[] = [];
  
  for (let i = 0; i < frequencies.length; i++) {
    let totalMagnitude = 0;
    
    // Sum the magnitude responses from each band
    bandsWithResponses.forEach(band => {
      if (band.frequencyResponse && band.frequencyResponse[i]) {
        totalMagnitude += band.frequencyResponse[i].magnitude;
      }
    });
    
    combinedResponse.push({
      frequency: frequencies[i],
      magnitude: totalMagnitude
    });
  }
  
  return combinedResponse;
} 