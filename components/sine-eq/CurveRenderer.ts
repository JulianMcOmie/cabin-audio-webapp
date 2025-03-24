import { EQPoint, FrequencyResponsePoint } from './types';
import { CoordinateUtils } from './CoordinateUtils';
import { 
  createFrequencyResponseFunction, 
  generateFrequencyResponseArray, 
  DEFAULT_FREQ_RANGE 
} from '@/lib/audio/sineFrequencyResponse';

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
    yOffset: number = 0,
    disabled: boolean = false
  ): void {
    // First sort the points by frequency
    const sortedPoints = [...points].sort((a, b) => a.frequency - b.frequency);
    
    // If we have no points, draw a flat line at 0dB
    if (sortedPoints.length === 0) {
      ctx.beginPath();
      const y0 = CoordinateUtils.amplitudeToY(0, height, ampRange);
      ctx.moveTo(xOffset, y0 + yOffset);
      ctx.lineTo(width + xOffset, y0 + yOffset);
      ctx.strokeStyle = disabled ? 
        'rgba(120, 120, 120, 0.8)' : 
        (isDarkMode ? 'rgba(255, 255, 255, 1.0)' : 'rgba(0, 0, 0, 1.0)');
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
    
    if (disabled) {
      // Use a gray gradient when disabled
      ctx.strokeStyle = 'rgba(120, 120, 120, 0.8)';
    } else {
      // Create a gradient for the curve stroke
      const gradient = ctx.createLinearGradient(xOffset, yOffset, width + xOffset, yOffset);
      
      // Add color stops for a smooth gradient across the frequency spectrum with full opacity
      const numStops = 20;
      const logMin = Math.log10(freqRange.min);
      const logMax = Math.log10(freqRange.max);
      const logRange = logMax - logMin;
      
      for (let i = 0; i <= numStops; i++) {
        const position = i / numStops;
        const logFreq = logMin + position * logRange;
        const freq = Math.pow(10, logFreq);
        gradient.addColorStop(position, CoordinateUtils.getFrequencyColor(freq, 1.0, isDarkMode));
      }
      
      ctx.strokeStyle = gradient;
    }
    
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
    
    // Use sineFrequencyResponse to create the frequency response function and curve
    // Find the reference node (1kHz, 0dB)
    const referenceNode = points.find(p => p.frequency === 1000 && p.amplitude === 0);
    
    // Get the non-reference points (user control points)
    const userPoints = referenceNode 
      ? points.filter(p => p !== referenceNode) 
      : points;
    
    // Create frequency response function
    const responseFunction = createFrequencyResponseFunction(
      userPoints,
      referenceNode
    );
    
    // Generate frequency response array with logarithmically spaced points
    const responseArray = generateFrequencyResponseArray(
      responseFunction,
      freqRange,
      resolution
    );
    
    return responseArray;
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
    yOffset: number = 0,
    isDragging: boolean = false,
    disabled: boolean = false
  ): void {
    // Draw each control point
    points.forEach((point, index) => {
      const x = CoordinateUtils.freqToX(point.frequency, width, freqRange);
      const y = CoordinateUtils.amplitudeToY(point.amplitude, height, ampRange);
      
      const isSelected = index === selectedPoint;
      const isBeingDragged = isSelected && isDragging;
      
      // Determine point color
      let pointColor;
      if (disabled) {
        pointColor = 'rgba(120, 120, 120, 1.0)';
      } else {
        pointColor = CoordinateUtils.getFrequencyColor(
          point.frequency, 
          1.0, // Full opacity
          isDarkMode
        );
      }
      
      // Draw the point, with larger size when being dragged
      const pointSize = isBeingDragged ? 12 : (isSelected ? 9 : 7);
      ctx.beginPath();
      ctx.arc(x + xOffset, y + yOffset, pointSize, 0, Math.PI * 2);
      ctx.fillStyle = pointColor;
      ctx.fill();
    });
  }
  
  /**
   * Draw the reference point (1kHz, 0dB) as a simple white dot
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
    yOffset: number = 0,
    disabled: boolean = false
  ): void {
    const x = CoordinateUtils.freqToX(point.frequency, width, freqRange);
    const y = CoordinateUtils.amplitudeToY(point.amplitude, height, ampRange);
    
    // Draw the reference point as a simple white/gray dot
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 10, 0, Math.PI * 2);
    ctx.fillStyle = disabled ? 
      'rgba(120, 120, 120, 1.0)' : 
      (isDarkMode ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 1.0)');
    ctx.fill();
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
    yOffset: number = 0,
    disabled: boolean = false
  ): void {
    // Don't draw ghost point if disabled
    if (disabled) return;
    
    const pointColor = CoordinateUtils.getFrequencyColor(frequency, 1.0, isDarkMode);
    
    // Draw the ghost point
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 5, 0, Math.PI * 2);
    ctx.fillStyle = pointColor;
    ctx.fill();
    
    // Draw dashed border
    ctx.beginPath();
    ctx.arc(x + xOffset, y + yOffset, 7, 0, Math.PI * 2);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 1.0)' : 'rgba(0, 0, 0, 1.0)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
} 