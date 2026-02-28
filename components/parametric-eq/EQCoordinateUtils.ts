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
   * Matches the app's particle visualizer gradient:
   *   Bass (low) → blue (#5577ff)
   *   Mid         → cyan (#00ffff)
   *   Treble (high) → teal-green (#55ffaa)
   */
  static getBandColor(
    frequency: number,
    alpha: number = 1,
    isDarkMode: boolean = false
  ): string {
    const minFreq = Math.log10(20);
    const maxFreq = Math.log10(20000);
    const t = (Math.log10(frequency) - minFreq) / (maxFreq - minFreq);

    // Three-stop gradient matching the visualizer:
    //   t=0  → hue 225 (blue)     sat 80  light 67  (#5577ff)
    //   t=0.5 → hue 180 (cyan)    sat 100 light 50  (#00ffff)
    //   t=1  → hue 153 (teal-green) sat 80 light 67 (#55ffaa)
    let hue: number, saturation: number, lightness: number;

    if (t < 0.5) {
      const s = t / 0.5; // 0→1 across the bass-to-mid range
      hue = 225 - s * 45;          // 225 → 180
      saturation = 80 + s * 20;    // 80 → 100
      lightness = 67 - s * 17;     // 67 → 50
    } else {
      const s = (t - 0.5) / 0.5;   // 0→1 across mid-to-treble range
      hue = 180 - s * 27;          // 180 → 153
      saturation = 100 - s * 20;   // 100 → 80
      lightness = 50 + s * 17;     // 50 → 67
    }

    // In light mode, darken colors for contrast on light backgrounds
    if (!isDarkMode) {
      lightness = lightness * 0.55;
      saturation = Math.min(100, saturation * 1.1);
    }

    return `hsla(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%, ${alpha})`;
  }
} 