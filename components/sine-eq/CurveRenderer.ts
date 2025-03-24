import { EQPoint, FrequencyResponsePoint } from './types';
import { CoordinateUtils } from './CoordinateUtils';

export class CurveRenderer {
  /**
   * Draw the EQ response curve based on control points
   */
  static drawCurve(
    ctx: CanvasRenderingContext2D,
    points: EQPoint[],
    width: number,
    height: number,
    freqRange: { min: number, max: number },
    ampRange: { min: number, max: number },
    isDarkMode: boolean,
    lineWidth: number = 4,
    alpha: number = 1.0,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    // First sort the points by frequency
    const sortedPoints = [...points].sort((a, b) => a.frequency - b.frequency);
    
    // If we have no points, draw a flat line at 0dB
    if (sortedPoints.length === 0) {
      ctx.beginPath();
      const y0 = CoordinateUtils.amplitudeToY(0, height, ampRange);
      ctx.moveTo(xOffset, y0 + yOffset);
      ctx.lineTo(width + xOffset, y0 + yOffset);
      ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      return;
    }
    
    // Generate frequency response from points
    const response = this.generateResponse(sortedPoints, freqRange, 200);
    
    // Draw the curve
    ctx.beginPath();
    
    // Process all points in the response
    for (let i = 0; i < response.length; i++) {
      const point = response[i];
      const x = CoordinateUtils.freqToX(point.frequency, width, freqRange);
      const y = CoordinateUtils.amplitudeToY(point.amplitude, height, ampRange);
      
      if (i === 0) {
        ctx.moveTo(x + xOffset, y + yOffset);
      } else {
        ctx.lineTo(x + xOffset, y + yOffset);
      }
    }
    
    // Create a gradient for the curve stroke
    const gradient = ctx.createLinearGradient(xOffset, yOffset, width + xOffset, yOffset);
    
    // Add color stops for a smooth gradient across the frequency spectrum
    const numStops = 20;
    const logMin = Math.log10(freqRange.min);
    const logMax = Math.log10(freqRange.max);
    const logRange = logMax - logMin;
    
    for (let i = 0; i <= numStops; i++) {
      const position = i / numStops;
      const logFreq = logMin + position * logRange;
      const freq = Math.pow(10, logFreq);
      gradient.addColorStop(position, CoordinateUtils.getFrequencyColor(freq, alpha, isDarkMode));
    }
    
    // Apply the gradient
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  
  /**
   * Generate a full frequency response curve from control points
   */
  static generateResponse(
    points: EQPoint[],
    freqRange: { min: number, max: number },
    resolution: number = 200
  ): FrequencyResponsePoint[] {
    // If no points, return flat response
    if (points.length === 0) {
      return this.generateFlatResponse(freqRange, resolution);
    }
    
    // If only one point, return flat response at that amplitude
    if (points.length === 1) {
      return this.generateFlatResponse(freqRange, resolution, points[0].amplitude);
    }
    
    // Generate logarithmically spaced frequency points
    const frequencies: number[] = [];
    const logMin = Math.log10(freqRange.min);
    const logMax = Math.log10(freqRange.max);
    const logStep = (logMax - logMin) / (resolution - 1);
    
    for (let i = 0; i < resolution; i++) {
      const logFreq = logMin + i * logStep;
      frequencies.push(Math.pow(10, logFreq));
    }
    
    // Calculate amplitude at each frequency using linear interpolation
    const response: FrequencyResponsePoint[] = [];
    
    for (const freq of frequencies) {
      // Find the control points that surround this frequency
      let leftPoint: EQPoint | null = null;
      let rightPoint: EQPoint | null = null;
      
      for (const point of points) {
        if (point.frequency <= freq) {
          if (!leftPoint || point.frequency > leftPoint.frequency) {
            leftPoint = point;
          }
        }
        
        if (point.frequency >= freq) {
          if (!rightPoint || point.frequency < rightPoint.frequency) {
            rightPoint = point;
          }
        }
      }
      
      let amplitude: number;
      
      // Interpolate between points
      if (leftPoint && rightPoint) {
        if (leftPoint === rightPoint) {
          amplitude = leftPoint.amplitude;
        } else {
          amplitude = CoordinateUtils.linearInterpolate(
            freq,
            leftPoint.frequency,
            leftPoint.amplitude,
            rightPoint.frequency,
            rightPoint.amplitude
          );
        }
      } else if (leftPoint) {
        // We're to the right of all points
        amplitude = leftPoint.amplitude;
      } else if (rightPoint) {
        // We're to the left of all points
        amplitude = rightPoint.amplitude;
      } else {
        // This shouldn't happen, but just in case
        amplitude = 0;
      }
      
      response.push({ frequency: freq, amplitude });
    }
    
    return response;
  }
  
  /**
   * Generate a flat frequency response
   */
  static generateFlatResponse(
    freqRange: { min: number, max: number },
    resolution: number = 200,
    amplitude: number = 0
  ): FrequencyResponsePoint[] {
    const response: FrequencyResponsePoint[] = [];
    const logMin = Math.log10(freqRange.min);
    const logMax = Math.log10(freqRange.max);
    const logStep = (logMax - logMin) / (resolution - 1);
    
    for (let i = 0; i < resolution; i++) {
      const logFreq = logMin + i * logStep;
      const freq = Math.pow(10, logFreq);
      response.push({ frequency: freq, amplitude });
    }
    
    return response;
  }
  
  /**
   * Draw the control points
   */
  static drawPoints(
    ctx: CanvasRenderingContext2D,
    points: EQPoint[],
    width: number,
    height: number,
    freqRange: { min: number, max: number },
    ampRange: { min: number, max: number },
    isDarkMode: boolean,
    selectedPoint: number | null = null,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    // Draw each control point
    points.forEach((point, index) => {
      const x = CoordinateUtils.freqToX(point.frequency, width, freqRange);
      const y = CoordinateUtils.amplitudeToY(point.amplitude, height, ampRange);
      
      const isSelected = index === selectedPoint;
      const pointColor = CoordinateUtils.getFrequencyColor(
        point.frequency, 
        isSelected ? 1.0 : 0.9, 
        isDarkMode
      );
      
      // Draw the point with no outline
      ctx.beginPath();
      ctx.arc(x + xOffset, y + yOffset, isSelected ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = pointColor;
      ctx.fill();
    });
  }
  
  /**
   * Draw the reference point (1kHz, 0dB)
   */
  static drawReferencePoint(
    ctx: CanvasRenderingContext2D,
    point: EQPoint,
    width: number,
    height: number,
    freqRange: { min: number, max: number },
    ampRange: { min: number, max: number },
    isDarkMode: boolean,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    const x = CoordinateUtils.freqToX(point.frequency, width, freqRange);
    const y = CoordinateUtils.amplitudeToY(point.amplitude, height, ampRange);
    
    // Draw an outer ring
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 12, 0, Math.PI * 2);
    ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    ctx.fill();
    
    // Draw middle ring
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 8, 0, Math.PI * 2);
    ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.fill();
    
    // Draw the inner point (white/black depending on theme)
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 4, 0, Math.PI * 2);
    ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';
    ctx.fill();
    
    // Draw a small ring to indicate it's a reference
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 10, 0, Math.PI * 2);
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  
  /**
   * Draw a ghost point (hover indicator)
   */
  static drawGhostPoint(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    frequency: number,
    isDarkMode: boolean,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    const pointColor = CoordinateUtils.getFrequencyColor(frequency, 0.7, isDarkMode);
    
    // Draw the ghost point
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 5, 0, Math.PI * 2);
    ctx.fillStyle = pointColor;
    ctx.fill();
    
    // Draw dashed border
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 7, 0, Math.PI * 2);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
} 