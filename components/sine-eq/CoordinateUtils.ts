/**
 * Utility class for coordinate conversions in the Sine EQ
 */
export class CoordinateUtils {
  /**
   * Convert frequency to x position on canvas (logarithmic scale)
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
   * Convert x position to frequency (logarithmic scale)
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
   * Convert amplitude (dB) to y position on canvas
   */
  static amplitudeToY(
    amplitude: number, 
    height: number,
    amplitudeRange: { min: number, max: number }
  ): number {
    // Map amplitude to canvas height (top is minimum, bottom is maximum)
    const range = amplitudeRange.max - amplitudeRange.min;
    return height * (1 - (amplitude - amplitudeRange.min) / range);
  }

  /**
   * Convert y position to amplitude (dB)
   */
  static yToAmplitude(
    y: number, 
    height: number,
    amplitudeRange: { min: number, max: number }
  ): number {
    // Map y position to amplitude
    const range = amplitudeRange.max - amplitudeRange.min;
    return amplitudeRange.min + range * (1 - y / height);
  }

  /**
   * Get color for a frequency
   */
  static getFrequencyColor(
    frequency: number, 
    alpha: number = 1,
    isDarkMode: boolean = false
  ): string {
    // Map frequency to hue (teal for low, pink for high)
    const minFreq = Math.log10(20);
    const maxFreq = Math.log10(20000);
    const normalizedFreq = (Math.log10(frequency) - minFreq) / (maxFreq - minFreq);
    
    // Use HSL color space for a teal-pink gradient
    const hue = normalizedFreq < 0.5 
      ? 180 - normalizedFreq * 60 // Teal to cyan/light blue (180 to 120)
      : 120 + (normalizedFreq - 0.5) * 400; // Light blue to pink (120 to 320)
    
    // Increase saturation and lightness for more vibrant colors
    const saturation = 85;
    // Adjust lightness based on dark mode
    const baseLightness = isDarkMode ? 60 : 70;
    // Slightly boost lightness in the middle range to avoid dark spots
    const lightnessAdjust = Math.sin(normalizedFreq * Math.PI) * 10;
    const lightness = baseLightness + lightnessAdjust;
    
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
  }

  /**
   * Linear interpolation between two points
   */
  static linearInterpolate(
    x: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    // Simple linear interpolation
    return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
  }
} 