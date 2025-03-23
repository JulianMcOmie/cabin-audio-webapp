import { EQBandWithUI } from './types';
import { EQCurveRenderer } from './EQCurveRenderer';
import { EQCoordinateUtils } from './EQCoordinateUtils';
import { calculateBandResponse } from './useEQProcessor';
import { ColorUtils } from './ColorUtils';

export class EQBandRenderer {
  /**
   * Draws a complete EQ band visualization including the curve and handle
   */
  static drawBand(
    ctx: CanvasRenderingContext2D,
    band: EQBandWithUI,
    width: number,
    height: number,
    freqRange: { min: number; max: number },
    isDarkMode: boolean,
    isHovered: boolean,
    isDragging: boolean,
    isEnabled: boolean = true
  ) {
    // Skip if band is outside visible range
    if (band.frequency < freqRange.min || band.frequency > freqRange.max) return;
    
    // Adjust opacity based on isHovered state
    const baseOpacity = isHovered ? 0.85 : 0.5; // More opaque when highlighted, but more vibrant by default
    
    const bandColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, baseOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${baseOpacity})`;
      
    // Always calculate the exact frequency response for the most accurate rendering
    // This ensures we're using the Web Audio API's getFrequencyResponse method
    const response = calculateBandResponse(band);
    
    // Draw band response curve using the exact frequency response
    EQCurveRenderer.drawFilledFrequencyResponse(
      ctx,
      response,
      width,
      height,
      freqRange,
      bandColor,
      isHovered
    );
    
    // Draw the band handle
    const x = EQCoordinateUtils.freqToX(band.frequency, width, freqRange);
    const y = EQCoordinateUtils.gainToY(band.gain, height);
    
    // Increase handle color opacity when highlighted
    // const handleOpacity = band.isHovered || isHovered ? 0.9 : 0.8; // More vibrant by default
    const handleColor = EQCoordinateUtils.getBandColor(band.frequency, 1.0, isDarkMode)
    
    this.drawBandHandle(ctx, x, y, handleColor, band.isHovered || isHovered, isDragging, isEnabled);
  }
  
  /**
   * Draws just the handle for an EQ band
   */
  static drawBandHandle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    isHovered: boolean,
    isDragging: boolean,
    isEnabled: boolean = true
  ) {
    const handleRadius = 8;
    const innerRadius = isDragging ? handleRadius : handleRadius / 2;

    let outerColor = ColorUtils.setOpacity(color, 0.5);
    let innerColor = ColorUtils.setOpacity(color, 1.0);

    if (!isEnabled) {
      outerColor = ColorUtils.makeMuted(color, 0.2);
      innerColor = ColorUtils.makeMuted(color, 0.5);
    }
    
    // Draw the outer circle
    ctx.beginPath();
    ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = outerColor;
    ctx.fill();

    // Draw inner circle with same color but with higher opacity
    ctx.beginPath();
    ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = innerColor;
    ctx.fill();
  }
  
  /**
   * Draw a Q indicator for the band when shift is pressed
   */
  static drawQIndicator(
    ctx: CanvasRenderingContext2D,
    band: EQBandWithUI,
    width: number,
    height: number,
    freqRange: { min: number; max: number },
    isDarkMode: boolean,
    isEnabled: boolean = true
  ): void {
    const x = EQCoordinateUtils.freqToX(band.frequency, width, freqRange);
    const y = EQCoordinateUtils.gainToY(band.gain, height);
    
    // Draw Q indicator as a horizontal line
    const qWidth = 100 / band.q;
    ctx.beginPath();
    ctx.moveTo(x - qWidth / 2, y);
    ctx.lineTo(x + qWidth / 2, y);
    ctx.strokeStyle = isEnabled 
      ? (isDarkMode ? '#fff' : '#000')
      : (isDarkMode ? '#aaa' : '#777');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round'; // Round ends for smoother appearance
    ctx.stroke();
    
    // Draw Q value text
    ctx.fillStyle = isEnabled 
      ? (isDarkMode ? '#fff' : '#000')
      : (isDarkMode ? '#aaa' : '#777');
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Q: ${band.q.toFixed(1)}`, x, y + 20);
    
    // Draw a background for the text to improve readability
    const textWidth = ctx.measureText(`Q: ${band.q.toFixed(1)}`).width;
    const textHeight = 14;
    ctx.fillStyle = isEnabled
      ? (isDarkMode ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)')
      : 'rgba(128, 128, 128, 0.3)';
    ctx.fillRect(x - textWidth / 2 - 2, y + 20 - textHeight / 2 - 2, textWidth + 4, textHeight);
    
    // Re-draw text over background
    ctx.fillStyle = isEnabled 
      ? (isDarkMode ? '#fff' : '#000')
      : (isDarkMode ? '#aaa' : '#777');
    ctx.fillText(`Q: ${band.q.toFixed(1)}`, x, y + 20);
  }
} 