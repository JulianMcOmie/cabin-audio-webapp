import { FrequencyResponse } from './types';
import { EQCoordinateUtils } from './EQCoordinateUtils';
import { ColorUtils } from './ColorUtils';

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
    alpha: number = 0.8,
    isEnabled: boolean = true,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    if (frequencyResponse.length === 0) return;
    
    const centerY = height / 2;
    
    // Begin drawing the curve
    ctx.beginPath();
    
    // Use high precision rendering with bezier curves
    let isFirstPoint = true;
    let prevX = 0;
    let prevY = centerY;
    
    // Optimize rendering by limiting points to those that are visibly different
    const minPixelDiff = 1; // Minimum pixel difference to include a point
    let lastDrawnX = -minPixelDiff * 2; // Start below the minimum to ensure first point is drawn
    
    // Find and draw visible points with curve smoothing
    for (let i = 0; i < frequencyResponse.length; i++) {
      const point = frequencyResponse[i];
      
      if (point.frequency >= freqRange.min && point.frequency <= freqRange.max) {
        const x = EQCoordinateUtils.freqToX(point.frequency, width, freqRange);
        const y = EQCoordinateUtils.gainToY(point.magnitude, height);
        
        // Only draw points that create a visible difference on screen
        if (Math.abs(x - lastDrawnX) >= minPixelDiff) {
          if (isFirstPoint) {
            ctx.moveTo(x + xOffset, y + yOffset);
            isFirstPoint = false;
          } else {
            // Use quadratic curves for smoother lines
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(
              prevX + xOffset, 
              prevY + yOffset, 
              cpX + xOffset, 
              (prevY + y) / 2 + yOffset
            );
            ctx.lineTo(x + xOffset, y + yOffset);
          }
          
          prevX = x;
          prevY = y;
          lastDrawnX = x;
        }
      }
    }
    
    // Create gradient for the curve
    const gradient = ctx.createLinearGradient(xOffset, yOffset, width + xOffset, yOffset);
    
    // Add color stops based on visible frequency range
    const logMin = Math.log10(freqRange.min);
    const logMax = Math.log10(freqRange.max);
    const logRange = logMax - logMin;
    
    // Create more granular color stops for smoother gradient
    const numStops = 20; // Increase number of color stops for smoother gradient
    
    if (isEnabled) {
      // Full color when enabled
      for (let i = 0; i <= numStops; i++) {
        const position = i / numStops;
        const logFreq = logMin + position * logRange;
        const freq = Math.pow(10, logFreq);
        gradient.addColorStop(position, EQCoordinateUtils.getBandColor(freq, alpha, isDarkMode));
      }
    } else {
      // Grayscale when disabled
      for (let i = 0; i <= numStops; i++) {
        const position = i / numStops;
        gradient.addColorStop(position, `rgba(128, 128, 128, ${alpha})`);
      }
    }
    
    // Draw the stroke with gradient
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round'; // Round line ends for smoother appearance
    ctx.lineJoin = 'round'; // Round line joins for smoother appearance
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
    isHovered: boolean = false,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    if (frequencyResponse.length === 0) return;
    
    const centerY = height / 2;
    
    // Begin drawing the curve
    ctx.beginPath();
    
    // Start at the left edge at center line
    ctx.moveTo(xOffset, centerY + yOffset);
    
    // Use high precision rendering with bezier curves
    let isFirstPoint = true;
    let prevX = 0;
    let prevY = centerY;
    
    // Optimize rendering by limiting points to those that are visibly different
    const minPixelDiff = 1; // Minimum pixel difference to include a point
    let lastDrawnX = -minPixelDiff * 2; // Start below the minimum to ensure first point is drawn
    
    // Draw all visible points with curve smoothing
    for (const point of frequencyResponse) {
      if (point.frequency >= freqRange.min && point.frequency <= freqRange.max) {
        const x = EQCoordinateUtils.freqToX(point.frequency, width, freqRange);
        const y = EQCoordinateUtils.gainToY(point.magnitude, height);
        
        // Only draw points that create a visible difference on screen
        if (Math.abs(x - lastDrawnX) >= minPixelDiff) {
          if (isFirstPoint) {
            ctx.lineTo(x + xOffset, y + yOffset);
            isFirstPoint = false;
          } else {
            // Use quadratic curves for smoother lines
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(
              prevX + xOffset, 
              prevY + yOffset, 
              cpX + xOffset, 
              (prevY + y) / 2 + yOffset
            );
          }
          
          prevX = x;
          prevY = y;
          lastDrawnX = x;
        }
      }
    }
    
    // Complete the path back to the center line
    ctx.lineTo(width + xOffset, centerY + yOffset);
    ctx.lineTo(xOffset, centerY + yOffset);
    
    // Fill the path
    ctx.fillStyle = ColorUtils.setOpacity(fillColor, isHovered ? 0.5 : 0.2);
    ctx.fill();
  }
} 