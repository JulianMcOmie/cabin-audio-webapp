import { EQBandWithUI } from './types';
import { EQCurveRenderer } from './EQCurveRenderer';
import { EQCoordinateUtils } from './EQCoordinateUtils';

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
    isSelected: boolean,
    isEnabled: boolean = true
  ) {
    console.log("drawing band at frequency: ", band.frequency);
    // Skip if band is outside visible range
    if (band.frequency < freqRange.min || band.frequency > freqRange.max) return;
    
    // Adjust opacity based on isSelected state
    const baseOpacity = isSelected ? 0.6 : 0.3; // More opaque when highlighted
    
    const bandColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, baseOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${baseOpacity})`;
      
    const strokeOpacity = isSelected ? 0.8 : 0.5; // More opaque when highlighted
    const strokeColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, strokeOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${strokeOpacity})`;
    
    // Draw band response curve
    if (band.frequencyResponse && band.frequencyResponse.length > 0) {
      // Use pre-calculated frequency response if available
      EQCurveRenderer.drawFilledFrequencyResponse(
        ctx, 
        band.frequencyResponse, 
        width, 
        height, 
        freqRange, 
        bandColor, 
        strokeColor
      );
    } else {
      // Otherwise use approximation formulas
      EQCurveRenderer.drawApproximatedBandResponse(
        ctx,
        band,
        width,
        height,
        freqRange,
        bandColor,
        strokeColor
      );
    }
    
    // Draw the band handle
    const x = EQCoordinateUtils.freqToX(band.frequency, width, freqRange);
    const y = EQCoordinateUtils.gainToY(band.gain, height);
    
    // Increase handle color opacity when highlighted
    const handleOpacity = band.isHovered ? 0.9 : (isSelected ? 0.8 : 0.7);
    const handleColor = isEnabled 
      ? EQCoordinateUtils.getBandColor(band.frequency, handleOpacity, isDarkMode)
      : `rgba(128, 128, 128, ${handleOpacity})`;
    
    this.drawBandHandle(ctx, x, y, handleColor, band.isHovered || isSelected, isEnabled);
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
    
    // Draw the outer circle
    ctx.beginPath();
    ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
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
    ctx.stroke();
    
    // Draw Q value text
    ctx.fillStyle = isEnabled 
      ? (isDarkMode ? '#fff' : '#000')
      : (isDarkMode ? '#aaa' : '#777');
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Q: ${band.q.toFixed(1)}`, x, y + 20);
  }
} 