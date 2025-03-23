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
    isEnabled: boolean = true,
    xOffset: number = 0,
    yOffset: number = 0
  ) {
    // Skip if band is outside visible range
    if (band.frequency < freqRange.min || band.frequency > freqRange.max) return;
    
    // Adjust opacity based on isHovered state
    const baseOpacity = isHovered ? 0.85 : 0.5; // More opaque when highlighted, but more vibrant by default
    
    // Get the base color
    let bandColor = EQCoordinateUtils.getBandColor(band.frequency, baseOpacity, isDarkMode);
    
    // If disabled, convert to grayscale 
    if (!isEnabled) {
      bandColor = ColorUtils.makeGrayscale(bandColor, baseOpacity * 0.7);
    }
      
    // Always calculate the exact frequency response for the most accurate rendering
    // This ensures we're using the Web Audio API's getFrequencyResponse method
    const response = calculateBandResponse(band);
    
    // Draw band response curve using the exact frequency response
    try {
      EQCurveRenderer.drawFilledFrequencyResponse(
        ctx,
        response,
        width,
        height,
        freqRange,
        bandColor,
        isHovered,
        xOffset,
        yOffset
      );
    } catch (e) {
      // Fall back to original method if the updated one isn't available
      (EQCurveRenderer.drawFilledFrequencyResponse as any)(
        ctx,
        response,
        width,
        height,
        freqRange,
        bandColor,
        isHovered
      );
    }
    
    // Draw the band handle
    const x = EQCoordinateUtils.freqToX(band.frequency, width, freqRange);
    const y = EQCoordinateUtils.gainToY(band.gain, height);
    
    // Increase handle color opacity when highlighted
    // const handleOpacity = band.isHovered || isHovered ? 0.9 : 0.8; // More vibrant by default
    const handleColor = EQCoordinateUtils.getBandColor(band.frequency, 1.0, isDarkMode)
    
    this.drawBandHandle(ctx, x + xOffset, y + yOffset, handleColor, band.isHovered || isHovered, isDragging, isEnabled);
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

    // Set colors based on enabled state
    let outerColor, innerColor;
    
    if (isEnabled) {
      outerColor = ColorUtils.setOpacity(color, 0.5);
      innerColor = ColorUtils.setOpacity(color, 1.0);
    } else {
      // Use grayscale for disabled state
      outerColor = ColorUtils.makeGrayscale(color, 0.3);
      innerColor = ColorUtils.makeGrayscale(color, 0.5);
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
    isEnabled: boolean = true,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    const x = EQCoordinateUtils.freqToX(band.frequency, width, freqRange);
    const y = EQCoordinateUtils.gainToY(band.gain, height);
    
    // Draw Q indicator as a horizontal line
    const qWidth = 100 / band.q;
    ctx.beginPath();
    ctx.moveTo(x + xOffset - qWidth / 2, y + yOffset);
    ctx.lineTo(x + xOffset + qWidth / 2, y + yOffset);
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
    ctx.fillText(`Q: ${band.q.toFixed(1)}`, x + xOffset, y + yOffset + 20);
    
    // Draw a background for the text to improve readability
    const textWidth = ctx.measureText(`Q: ${band.q.toFixed(1)}`).width;
    const textHeight = 14;
    ctx.fillStyle = isEnabled
      ? (isDarkMode ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)')
      : 'rgba(128, 128, 128, 0.3)';
    ctx.fillRect(x + xOffset - textWidth / 2 - 2, y + yOffset + 20 - textHeight / 2 - 2, textWidth + 4, textHeight);
    
    // Re-draw text over background
    ctx.fillStyle = isEnabled 
      ? (isDarkMode ? '#fff' : '#000')
      : (isDarkMode ? '#aaa' : '#777');
    ctx.fillText(`Q: ${band.q.toFixed(1)}`, x + xOffset, y + yOffset + 20);
  }

  /**
   * Draw volume control slider
   */
  static drawVolumeControl(
    ctx: CanvasRenderingContext2D,
    volume: number,
    width: number,
    height: number,
    isDarkMode: boolean,
    isEnabled: boolean = true,
    isDragging: boolean = false,
    isHovered: boolean = false,
    xOffset: number = 0,
    yOffset: number = 0
  ): void {
    // Center line y-position (0dB)
    const centerY = height * 0.5;
    const startPos = 0;
    const endPos = width;
    
    // Calculate volume dot position (using same calculation as gainToY)
    const volumeY = EQCoordinateUtils.gainToY(volume, height);
    
    // Draw filled rectangle between center line and volume line
    ctx.beginPath();
    
    // Use a more prominent color when hovered
    const fillOpacity = isHovered || isDragging ? (isEnabled ? 0.2 : 0.1) : (isEnabled ? 0.1 : 0.03);
    ctx.fillStyle = `rgba(255, 255, 255, ${fillOpacity})`;  // White with opacity
    
    // Draw the full-width rectangle
    ctx.rect(
      xOffset + startPos, // Start from left edge + offset
      yOffset + Math.min(centerY, volumeY), // Top of rectangle (either center or volume line)
      endPos, // Full width
      Math.abs(centerY - volumeY) // Height - absolute difference between center and volume
    );
    ctx.fill();
    
    // Draw volume indicator line across full width
    ctx.beginPath();
    
    // Brighter/more visible when hovered
    let lineOpacity = isHovered || isDragging ? 0.0 : (isEnabled ? 0.0 : 0.0);
    ctx.strokeStyle = `rgba(255, 255, 255, ${lineOpacity})`; // White with opacity
    ctx.lineWidth = isHovered || isDragging ? 2 : 1;
    ctx.moveTo(xOffset + startPos, yOffset + volumeY);
    ctx.lineTo(xOffset + endPos, yOffset + volumeY);
    ctx.stroke();

    const dotOpacity = isHovered || isDragging ? 1.0 : (isEnabled ? 0.8 : 0.5);
    
    // Place dot directly on the right edge of the inner area
    const dotX = width; // Right along inner edge
    
    // Draw volume dot
    ctx.beginPath();
    ctx.fillStyle = isEnabled 
      ? `rgba(255, 255, 255, ${dotOpacity})` 
      : `rgba(255, 255, 255, ${dotOpacity * 0.7})`;
    
    // Larger dot when hovered
    const dotRadius = isHovered || isDragging ? 8 : 6;
    ctx.arc(xOffset + dotX, yOffset + volumeY, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw a subtle ring around dot when hovered
    if (isHovered && !isDragging) {
      ctx.beginPath();
      ctx.strokeStyle = isDarkMode 
        ? "rgba(200, 200, 200, 0.4)" 
        : "rgba(150, 150, 150, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.arc(xOffset + dotX, yOffset + volumeY, dotRadius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Check if point is inside the volume control dot
   */
  static isInVolumeControl(x: number, y: number, width: number, height: number, volume: number, xOffset: number = 0, yOffset: number = 0): boolean {
    const dotX = width; // Update to match new position (right along inner edge)
    const volumeY = EQCoordinateUtils.gainToY(volume, height);
    const dotRadius = 10; // Slightly larger hit area for better UX
    
    // Adjust for margins by subtracting offsets from incoming coordinates
    const adjustedX = x - xOffset;
    const adjustedY = y - yOffset;
    
    return Math.sqrt(Math.pow(adjustedX - dotX, 2) + Math.pow(adjustedY - volumeY, 2)) <= dotRadius;
  }
} 