import { EQBandWithUI } from './types';
import { EQCurveRenderer } from './EQCurveRenderer';
import { EQCoordinateUtils } from './EQCoordinateUtils';
import { calculateBandResponse } from './useEQProcessor';

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
    isEnabled: boolean = true
  ) {
    // Skip if band is outside visible range
    if (band.frequency < freqRange.min || band.frequency > freqRange.max) return;
    
    // Adjust opacity based on isHovered state
    const baseOpacity = isHovered ? 0.7 : 0.4; // More opaque when highlighted, but more vibrant by default
    
    const bandColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, baseOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${baseOpacity})`;
      
    const strokeOpacity = isHovered ? 0.8 : 0.6; // More opaque when highlighted, more vibrant by default
    const strokeColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, strokeOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${strokeOpacity})`;
    
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
      strokeColor
    );
    
    // Draw the band handle
    const x = EQCoordinateUtils.freqToX(band.frequency, width, freqRange);
    const y = EQCoordinateUtils.gainToY(band.gain, height);
    
    // Increase handle color opacity when highlighted
    const handleOpacity = band.isHovered || isHovered ? 0.9 : 0.8; // More vibrant by default
    const handleColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, handleOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${handleOpacity})`;
    
    this.drawBandHandle(ctx, x, y, handleColor, band.isHovered || isHovered, isEnabled);
  }
  
  /**
   * Draws just the handle for an EQ band
   */
  static drawBandHandle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    isHighlighted: boolean,
    isEnabled: boolean = true
  ) {
    const handleRadius = isHighlighted ? 10 : 8;
    
    // Create a shadow effect for depth
    if (isEnabled && isHighlighted) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
    }
    
    // Draw the outer circle
    ctx.beginPath();
    ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Reset shadow for other elements
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw border
    ctx.strokeStyle = isEnabled 
      ? (isHighlighted ? '#fff' : '#888')
      : (isHighlighted ? '#ccc' : '#888');
    ctx.lineWidth = isHighlighted ? 2 : 1;
    ctx.stroke();
    
    // Draw inner circle for a more polished look
    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(x, y, handleRadius - 4, 0, Math.PI * 2);
      ctx.fillStyle = isEnabled ? 'rgba(255, 255, 255, 0.3)' : 'rgba(200, 200, 200, 0.3)';
      ctx.fill();
      
      // Draw a smaller inner circle for depth
      ctx.beginPath();
      ctx.arc(x, y, handleRadius / 3, 0, Math.PI * 2);
      ctx.fillStyle = isEnabled ? 'rgba(255, 255, 255, 0.6)' : 'rgba(200, 200, 200, 0.6)';
      ctx.fill();
    }
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