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

  /**
   * Catmull-Rom spline interpolation
   * t: interpolation parameter (0 to 1)
   * p0, p1, p2, p3: control points
   */
  public static catmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    
    // Catmull-Rom matrix coefficients
    const c0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const c1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const c2 = -0.5 * p0 + 0.5 * p2;
    const c3 = p1;
    
    return c0 * t3 + c1 * t2 + c2 * t + c3;
  }

  /**
   * Interpolate between points using Catmull-Rom splines
   * frequency: target frequency
   * freq1, freq2: frequency range
   * amp0, amp1, amp2, amp3: amplitudes for interpolation
   */
  public static interpolateFrequencyResponse(
    frequency: number,
    freq1: number,
    freq2: number,
    amp0: number,
    amp1: number,
    amp2: number,
    amp3: number
  ): number {
    // Convert frequencies to log scale for interpolation
    const logFreq1 = Math.log(freq1);
    const logFreq2 = Math.log(freq2);
    const logFreq = Math.log(frequency);
    
    // Normalize the log frequency
    const t = (logFreq - logFreq1) / (logFreq2 - logFreq1);
    
    // Use Catmull-Rom interpolation
    return this.catmullRom(t, amp0, amp1, amp2, amp3);
  }
} 