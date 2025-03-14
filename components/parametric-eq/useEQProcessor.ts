import { useState, useEffect, useMemo } from 'react';
import { EQBandWithUI, FrequencyResponse } from './types';

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
 * Calculate frequency response for a single band
 */
export function calculateBandResponse(band: EQBandWithUI): FrequencyResponse[] {
  // Generate frequency points
  const frequencies: number[] = [];
  for (let i = 0; i < 100; i++) {
    frequencies.push(20 * Math.pow(10, i / 33)); // 20Hz to 20kHz
  }
  
  const response: FrequencyResponse[] = [];
  
  for (let i = 0; i < frequencies.length; i++) {
    const freq = frequencies[i];
    let gain = 0;
    
    // Calculate gain for this frequency based on band type
    if (band.type === 'peaking') {
      const freqRatio = freq / band.frequency;
      const bw = Math.log2(freqRatio) * band.q;
      gain = band.gain / (1 + bw * bw * 4);
    } else if (band.type === 'lowshelf') {
      if (freq < band.frequency) {
        gain = band.gain;
      } else {
        const octaves = Math.log2(freq / band.frequency);
        gain = band.gain / (1 + Math.pow(2, octaves * band.q));
      }
    } else if (band.type === 'highshelf') {
      if (freq > band.frequency) {
        gain = band.gain;
      } else {
        const octaves = Math.log2(band.frequency / freq);
        gain = band.gain / (1 + Math.pow(2, octaves * band.q));
      }
    } else if (band.type === 'lowpass') {
      const octaves = Math.log2(freq / band.frequency);
      if (octaves > 0) {
        gain = -12 * octaves * band.q;
      }
    } else if (band.type === 'highpass') {
      const octaves = Math.log2(band.frequency / freq);
      if (octaves > 0) {
        gain = -12 * octaves * band.q;
      }
    }
    
    response.push({
      frequency: freq,
      magnitude: gain
    });
  }
  
  return response;
}

/**
 * Calculate combined frequency response for all bands
 */
export function calculateCombinedFrequencyResponse(bands: EQBandWithUI[]): FrequencyResponse[] {
  // If no bands, return flat response
  if (bands.length === 0) {
    return Array.from({ length: 100 }, (_, i) => {
      const frequency = 20 * Math.pow(10, i / 33); // Log scale from 20Hz to 20kHz
      return { frequency, magnitude: 0 };
    });
  }
  
  // Generate frequency points
  const frequencies: number[] = [];
  for (let i = 0; i < 100; i++) {
    frequencies.push(20 * Math.pow(10, i / 33)); // 20Hz to 20kHz
  }
  
  // Calculate individual band responses if not already calculated
  const bandsWithResponses = bands.map(band => {
    if (!band.frequencyResponse || band.frequencyResponse.length === 0) {
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