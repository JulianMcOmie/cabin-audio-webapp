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
    isHovered: boolean = false
  ): void {
    // Center line y-position (0dB)
    const centerY = height * 0.5;
    const startPos = 0;
    const endPos = width;
    
    // Calculate volume dot position (using same calculation as gainToY)
    const volumeY = EQCoordinateUtils.gainToY(volume, height);
    
    // Draw a horizontal line across the full width
    ctx.beginPath();
    ctx.strokeStyle = isDarkMode ? "#a1a1aa" : "#64748b";
    ctx.lineWidth = 1;
    ctx.moveTo(startPos, centerY);
    ctx.lineTo(endPos, centerY);
    ctx.stroke();
    
    // Draw filled rectangle between center line and volume line
    ctx.beginPath();
    
    // Use a more prominent color when hovered
    const fillOpacity = isHovered || isDragging ? (isEnabled ? 0.2 : 0.1) : (isEnabled ? 0.1 : 0.03);
    ctx.fillStyle = `rgba(255, 255, 255, ${fillOpacity})`;  // White with opacity
    
    // Draw the full-width rectangle
    ctx.rect(
      startPos, // Start from left edge
      Math.min(centerY, volumeY), // Top of rectangle (either center or volume line)
      endPos, // Full width
      Math.abs(centerY - volumeY) // Height - absolute difference between center and volume
    );
    ctx.fill();
    
    // Draw volume indicator line across full width
    ctx.beginPath();
    
    // Brighter/more visible when hovered
    const lineOpacity = isHovered || isDragging ? 1.0 : (isEnabled ? 0.8 : 0.5);
    ctx.strokeStyle = `rgba(255, 255, 255, ${lineOpacity})`; // White with opacity
    ctx.lineWidth = isHovered || isDragging ? 2 : 1;
    ctx.moveTo(startPos, volumeY);
    ctx.lineTo(endPos, volumeY);
    ctx.stroke();
    
    // Only draw the dot indicator on the right side
    const dotX = width - 20; // 20px from right edge
    
    // Draw volume dot
    ctx.beginPath();
    ctx.fillStyle = isEnabled 
      ? `rgba(255, 255, 255, ${lineOpacity})` 
      : `rgba(255, 255, 255, ${lineOpacity * 0.7})`;
    
    // Larger dot when hovered
    const dotRadius = isHovered || isDragging ? 8 : 6;
    ctx.arc(dotX, volumeY, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw a subtle ring around dot when hovered
    if (isHovered && !isDragging) {
      ctx.beginPath();
      ctx.strokeStyle = isDarkMode 
        ? "rgba(200, 200, 200, 0.4)" 
        : "rgba(150, 150, 150, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.arc(dotX, volumeY, dotRadius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Draw volume value if being dragged or hovered
    if (isDragging || isHovered || Math.abs(volume) > 0.1) {
      ctx.fillStyle = isDarkMode ? "#ffffff" : "#000000";
      ctx.textAlign = "left";
      ctx.font = `${isHovered || isDragging ? "bold " : ""}12px sans-serif`;
      const volumeText = `${volume.toFixed(1)} dB`;
      ctx.fillText(volumeText, dotX + 15, volumeY + 5);
    }
  }

  /**
   * Check if point is inside the volume control dot
   */
  static isInVolumeControl(x: number, y: number, width: number, height: number, volume: number): boolean {
    const dotX = width - 20; // 20px from right edge
    const volumeY = EQCoordinateUtils.gainToY(volume, height);
    const dotRadius = 10; // Slightly larger hit area for better UX
    
    return Math.sqrt(Math.pow(x - dotX, 2) + Math.pow(y - volumeY, 2)) <= dotRadius;
  }
} 