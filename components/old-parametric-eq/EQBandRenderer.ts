import { EQBand } from './types';
import { EQCurveRenderer } from './EQCurveRenderer';
import { EQCoordinateUtils } from './EQCoordinateUtils';

export class EQBandRenderer {
  /**
   * Draws a complete EQ band visualization including the curve and handle
   */
  static drawBand(
    ctx: CanvasRenderingContext2D,
    band: EQBand,
    freqToX: (freq: number) => number,
    gainToY: (gain: number) => number,
    xToFreq: (x: number) => number,
    getBandColor: (freq: number, alpha?: number) => string,
    width: number,
    height: number,
    isSelected: boolean,
    isQAdjustment: boolean,
    freqRange: { min: number; max: number }
  ) {
    // Skip if band is outside visible range
    if (band.frequency < freqRange.min || band.frequency > freqRange.max) return;
    
    const bandColor = getBandColor(band.frequency, 0.3);
    const strokeColor = getBandColor(band.frequency, 0.5);
    
    if (!band.frequencyResponse)
    {
        console.log("no frequency response");
    }
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
      console.log("drawing filled frequency response");
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
      console.log("drawing approximated band response");
    }
    
    // Draw the band handle
    const x = freqToX(band.frequency);
    const y = gainToY(band.gain);
    const color = getBandColor(band.frequency, band.isHovered ? 0.9 : 0.7);
    
    this.drawBandHandle(ctx, x, y, color, isSelected || band.isHovered);
    
    // Draw Q indicator if shift is pressed or band is selected
    if (isQAdjustment && (band.isHovered || isSelected)) {
      this.drawQIndicator(
        ctx, band, freqToX, gainToY, getBandColor
      );
    }
  }
  
  /**
   * Draws just the handle for an EQ band
   * Simplified interface to work with EQGraph
   */
  static drawBandHandle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    isHighlighted: boolean
  ) {
    const handleRadius = isHighlighted ? 10 : 8;
    
    // Draw the outer circle
    ctx.beginPath();
    ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Draw border
    ctx.strokeStyle = isHighlighted ? '#fff' : '#888';
    ctx.lineWidth = isHighlighted ? 2 : 1;
    ctx.stroke();
    
    // Draw inner circle for a more polished look
    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(x, y, handleRadius - 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();
    }
  }
  
  /**
   * Draw a small indicator of the band type inside the handle
   */
  private static drawTypeIndicator(
    ctx: CanvasRenderingContext2D,
    band: EQBand,
    x: number,
    y: number
  ): void {
    const radius = 4;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    
    switch (band.type) {
      case 'peaking':
        // Draw a small dot
        ctx.beginPath();
        ctx.arc(x, y, radius / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        break;
        
      case 'lowshelf':
        // Draw a horizontal line with left side higher
        ctx.beginPath();
        ctx.moveTo(x - radius, y - radius / 3);
        ctx.lineTo(x + radius, y + radius / 3);
        ctx.stroke();
        break;
        
      case 'highshelf':
        // Draw a horizontal line with right side higher
        ctx.beginPath();
        ctx.moveTo(x - radius, y + radius / 3);
        ctx.lineTo(x + radius, y - radius / 3);
        ctx.stroke();
        break;
        
      case 'lowpass':
        // Draw a downward slope
        ctx.beginPath();
        ctx.moveTo(x - radius, y - radius / 3);
        ctx.lineTo(x, y + radius / 3);
        ctx.lineTo(x + radius, y + radius / 3);
        ctx.stroke();
        break;
        
      case 'highpass':
        // Draw an upward slope
        ctx.beginPath();
        ctx.moveTo(x - radius, y + radius / 3);
        ctx.lineTo(x, y - radius / 3);
        ctx.lineTo(x + radius, y - radius / 3);
        ctx.stroke();
        break;
    }
  }
  
  /**
   * Draw a Q indicator for the band
   */
  private static drawQIndicator(
    ctx: CanvasRenderingContext2D,
    band: EQBand,
    freqToX: (freq: number) => number,
    gainToY: (gain: number) => number,
    getBandColor: (freq: number, alpha?: number) => string
  ): void {
    const x = freqToX(band.frequency);
    const y = gainToY(band.gain);
    
    // Draw Q indicator as a horizontal line
    const qWidth = 100 / band.Q;
    ctx.beginPath();
    ctx.moveTo(x - qWidth / 2, y);
    ctx.lineTo(x + qWidth / 2, y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw Q value text
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Q: ${band.Q.toFixed(1)}`, x, y + 20);
  }
} 