import { FrequencyResponse } from './types';
import { EQCoordinateUtils } from './EQCoordinateUtils';

/**
 * Utility class for rendering EQ frequency response curves
 */
export class EQCurveRenderer {
  /**
   * Draw a frequency response curve with gradient coloring
   */
  static drawFrequencyResponse(
    ctx: CanvasRenderingContext2D,
    frequencyResponse: FrequencyResponse[],
    width: number,
    height: number,
    freqRange: { min: number, max: number },
    isDarkMode: boolean,
    lineWidth: number = 3,
    alpha: number = 0.8
  ): void {
    if (frequencyResponse.length === 0) return;
    
    const centerY = height / 2;
    
    // Begin drawing the curve
    ctx.beginPath();
    
    let startX = 0;
    let startY = centerY;
    let isFirstPoint = true;
    
    // Find the first visible point and start there
    for (const point of frequencyResponse) {
      if (point.frequency >= freqRange.min && point.frequency <= freqRange.max) {
        const x = EQCoordinateUtils.freqToX(point.frequency, width, freqRange);
        const y = EQCoordinateUtils.gainToY(point.magnitude, height);
        
        if (isFirstPoint) {
          ctx.moveTo(x, y);
          startX = x;
          startY = y;
          isFirstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    
    // Create gradient for the curve
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    
    // Add color stops based on visible frequency range
    const logMin = Math.log10(freqRange.min);
    const logMax = Math.log10(freqRange.max);
    const logRange = logMax - logMin;
    
    for (let i = 0; i <= 10; i++) {
      const position = i / 10;
      const logFreq = logMin + position * logRange;
      const freq = Math.pow(10, logFreq);
      gradient.addColorStop(position, EQCoordinateUtils.getBandColor(freq, alpha, isDarkMode));
    }
    
    // Draw the stroke with gradient
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  
  /**
   * Draw a filled frequency response curve for a single band
   */
  static drawFilledFrequencyResponse(
    ctx: CanvasRenderingContext2D,
    frequencyResponse: FrequencyResponse[],
    width: number,
    height: number,
    freqRange: { min: number, max: number },
    fillColor: string,
    strokeColor?: string
  ): void {
    if (frequencyResponse.length === 0) return;
    
    const centerY = height / 2;
    
    // Begin drawing the curve
    ctx.beginPath();
    
    // Start at the left edge at center line
    ctx.moveTo(0, centerY);
    
    let isFirstPoint = true;
    let lastX = 0;
    
    // Draw all visible points
    for (const point of frequencyResponse) {
      if (point.frequency >= freqRange.min && point.frequency <= freqRange.max) {
        const x = EQCoordinateUtils.freqToX(point.frequency, width, freqRange);
        const y = EQCoordinateUtils.gainToY(point.magnitude, height);
        
        if (isFirstPoint) {
          isFirstPoint = false;
        }
        
        ctx.lineTo(x, y);
        lastX = x;
      }
    }
    
    // Complete the path back to the center line
    ctx.lineTo(lastX || width, centerY);
    ctx.lineTo(0, centerY);
    
    // Fill the path
    ctx.fillStyle = fillColor;
    ctx.fill();
    
    // Optionally stroke the outline
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  
  /**
   * Draw a frequency response curve using approximation formulas
   * This is used when we don't have pre-calculated frequency response data
   */
  static drawApproximatedBandResponse(
    ctx: CanvasRenderingContext2D,
    band: {
      frequency: number,
      gain: number,
      q: number,
      type: BiquadFilterType
    },
    width: number,
    height: number,
    freqRange: { min: number, max: number },
    fillColor: string,
    strokeColor?: string
  ): void {
    const centerY = height / 2;
    
    // Begin drawing the curve
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    
    // Draw the response curve using approximation formulas
    for (let i = 0; i < width; i++) {
      const freq = EQCoordinateUtils.xToFreq(i, width, freqRange);
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
      
      const y = EQCoordinateUtils.gainToY(gain, height);
      ctx.lineTo(i, y);
    }
    
    // Complete the path
    ctx.lineTo(width, centerY);
    
    // Fill the path
    ctx.fillStyle = fillColor;
    ctx.fill();
    
    // Optionally stroke the outline
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
} 