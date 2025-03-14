/**
 * Utility class for coordinate conversions in the EQ graph
 */
export class EQCoordinateUtils {
  /**
   * Convert frequency to x position on canvas
   */
  static freqToX(
    freq: number, 
    width: number, 
    freqRange: { min: number, max: number }
  ): number {
    const minLog = Math.log10(freqRange.min);
    const maxLog = Math.log10(freqRange.max);
    return width * (Math.log10(freq) - minLog) / (maxLog - minLog);
  }

  /**
   * Convert x position to frequency
   */
  static xToFreq(
    x: number, 
    width: number, 
    freqRange: { min: number, max: number }
  ): number {
    const minLog = Math.log10(freqRange.min);
    const maxLog = Math.log10(freqRange.max);
    return Math.pow(10, minLog + (x / width) * (maxLog - minLog));
  }

  /**
   * Convert gain to y position on canvas
   */
  static gainToY(
    gain: number, 
    height: number
  ): number {
    // Map gain from -24dB to +24dB to canvas height
    return height / 2 - (gain / 24) * (height / 2);
  }

  /**
   * Convert y position to gain
   */
  static yToGain(
    y: number, 
    height: number
  ): number {
    // Map y position to gain between -24dB and +24dB
    return -((y - height / 2) / (height / 2)) * 24;
  }

  /**
   * Get color for a band based on its frequency
   */
  static getBandColor(
    frequency: number, 
    alpha: number = 1,
    isDarkMode: boolean = false
  ): string {
    // Map frequency to hue (blue for low, red for high)
    const minFreq = Math.log10(20);
    const maxFreq = Math.log10(20000);
    const normalizedFreq = (Math.log10(frequency) - minFreq) / (maxFreq - minFreq);
    
    // Use HSL color space for a nice gradient
    const hue = 240 - normalizedFreq * 240; // 240 (blue) to 0 (red)
    const lightness = isDarkMode ? 60 : 50; // Brighter in dark mode
    return `hsla(${hue}, 80%, ${lightness}%, ${alpha})`;
  }
} 