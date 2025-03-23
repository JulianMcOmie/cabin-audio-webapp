/**
 * Utility functions for color manipulation in EQ visualization
 */

// Color parsing and conversion functions
export class ColorUtils {
  /**
   * Parse a color string into its HSLA components
   * Supports rgba(), rgb(), hsla(), hsl(), and hex formats
   */
  static parseColor(color: string): { h: number; s: number; l: number; a: number } {
    // Default values
    let h = 0;
    let s = 0;
    let l = 0;
    let a = 1;
    
    // Check for hsla format - support both comma and space separators with % signs
    const hslaMatch = color.match(/hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (hslaMatch) {
      h = parseInt(hslaMatch[1], 10);
      s = parseInt(hslaMatch[2], 10);
      l = parseInt(hslaMatch[3], 10);
      a = hslaMatch[4] ? parseFloat(hslaMatch[4]) : 1;
      return { h, s, l, a };
    }
    
    // Check for rgba format
    const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1], 10) / 255;
      const g = parseInt(rgbaMatch[2], 10) / 255;
      const b = parseInt(rgbaMatch[3], 10) / 255;
      a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
      
      // Convert RGB to HSL
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      l = (max + min) / 2;
      
      if (max === min) {
        h = s = 0; // achromatic
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        
        h = Math.round(h * 60);
        s = Math.round(s * 100);
        l = Math.round(l * 100);
      }
      
      return { h, s, l, a };
    }
    
    // Check for hex format (#RGB or #RRGGBB)
    const hexMatch = color.match(/#([0-9a-f]{3,8})/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      
      // Convert 3-digit hex to 6-digit
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      
      // Parse RGB values
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
      
      // Convert RGB to HSL (same as above)
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      l = (max + min) / 2;
      
      if (max === min) {
        h = s = 0; // achromatic
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        
        h = Math.round(h * 60);
        s = Math.round(s * 100);
        l = Math.round(l * 100);
      }
      
      return { h, s, l, a };
    }
    
    // If all else fails, try direct color generation matching app's pattern
    // This handles cases where direct hsla values are used instead of strings
    try {
      // If it looks like a color string but didn't match our patterns,
      // create a fallback hsla color to avoid black results
      if (color.includes('hsla(') || color.includes('hsl(')) {
        // Extract numeric values from the string
        const values = color.match(/\d+(\.\d+)?/g);
        if (values && values.length >= 3) {
          h = parseFloat(values[0]);
          s = parseFloat(values[1]);
          l = parseFloat(values[2]);
          a = values.length >= 4 ? parseFloat(values[3]) : 1;
          return { h, s, l, a };
        }
      }
    } catch (e) {
      console.error("Error parsing color:", e);
    }
    
    // Default fallback: return a blue color instead of black
    console.warn(`Color format not recognized: ${color}, using default blue`);
    return { h: 210, s: 100, l: 50, a: 1 };
  }
  
  /**
   * Convert HSLA components to an HSLA color string
   */
  static toHsla(h: number, s: number, l: number, a: number = 1): string {
    return `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`;
  }
  
  /**
   * Change the opacity of a color
   */
  static setOpacity(color: string, opacity: number): string {
    const hsla = this.parseColor(color);
    return this.toHsla(hsla.h, hsla.s, hsla.l, opacity);
  }
  
  /**
   * Adjust saturation of a color by a percentage factor
   * @param factor 1.0 = no change, 1.5 = 50% more saturated, 0.5 = 50% less saturated
   */
  static adjustSaturation(color: string, factor: number): string {
    const hsla = this.parseColor(color);
    const newS = Math.max(0, Math.min(100, hsla.s * factor));
    return this.toHsla(hsla.h, newS, hsla.l, hsla.a);
  }
  
  /**
   * Adjust lightness of a color by a percentage factor
   * @param factor 1.0 = no change, 1.5 = 50% lighter, 0.5 = 50% darker
   */
  static adjustLightness(color: string, factor: number): string {
    const hsla = this.parseColor(color);
    const newL = Math.max(0, Math.min(100, hsla.l * factor));
    return this.toHsla(hsla.h, hsla.s, newL, hsla.a);
  }
  
  /**
   * Create a more vibrant version of a color
   * Increases saturation and adjusts lightness for more vibrant appearance
   */
  static makeVibrant(color: string, intensity: number = 1.2): string {
    const hsla = this.parseColor(color);
    
    // Increase saturation
    const newS = Math.min(100, hsla.s * intensity);
    
    // Adjust lightness - make dark colors lighter and light colors darker to increase contrast
    let newL = hsla.l;
    if (hsla.l < 50) {
      newL = Math.min(60, hsla.l * 1.2); // Brighten dark colors
    } else if (hsla.l > 70) {
      newL = Math.max(50, hsla.l * 0.9); // Darken very light colors
    }
    
    return this.toHsla(hsla.h, newS, newL, hsla.a);
  }
  
  /**
   * Create a muted version of a color
   * Decreases saturation and adjusts lightness for more muted appearance
   */
  static makeMuted(color: string, intensity: number = 0.8): string {
    const hsla = this.parseColor(color);
    
    // Decrease saturation
    const newS = hsla.s * intensity;
    
    // Adjust lightness - bring closer to middle gray
    const newL = hsla.l < 50 
      ? Math.min(60, hsla.l * 1.1) // Brighten dark colors slightly
      : Math.max(40, hsla.l * 0.9); // Darken light colors slightly
    
    return this.toHsla(hsla.h, newS, newL, hsla.a);
  }
  
  /**
   * Generate a contrasting color (for text on background)
   * Returns either white or black depending on the background color
   */
  static getContrastColor(backgroundColor: string): string {
    const hsla = this.parseColor(backgroundColor);
    
    // Simple algorithm: if lightness is > 60%, return black, otherwise white
    // This is a simplified approach - for better results, calculate actual contrast ratio
    return hsla.l > 60 ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)';
  }
  
  /**
   * Create a gradient version of a color (for UI elements)
   * Returns an array of colors forming a gradient from light to dark
   */
  static createGradient(baseColor: string, steps: number = 3): string[] {
    const hsla = this.parseColor(baseColor);
    const result: string[] = [];
    
    // Create gradient steps
    for (let i = 0; i < steps; i++) {
      const factor = 0.8 + (0.4 * i / (steps - 1)); // 0.8 to 1.2 range
      const l = Math.max(0, Math.min(100, hsla.l * factor));
      result.push(this.toHsla(hsla.h, hsla.s, l, hsla.a));
    }
    
    return result;
  }
  
  /**
   * Works directly with EQCoordinateUtils.getBandColor
   * Makes the band color more or less vibrant based on state
   */
  static adjustBandColor(frequency: number, isDarkMode: boolean, isHovered: boolean): string {
    // Use the existing getBandColor function from EQCoordinateUtils
    const baseColor = EQCoordinateUtils.getBandColor(frequency, isHovered ? 0.9 : 0.7, isDarkMode);
    
    // Further adjust the color based on hover state
    if (isHovered) {
      return this.makeVibrant(baseColor, 1.2);
    } else {
      return baseColor;
    }
  }
  
  /**
   * Debug utility to log color components
   */
  static debugColor(color: string): void {
    const hsla = this.parseColor(color);
    console.log(`Color: ${color} → HSLA(${hsla.h}, ${hsla.s}%, ${hsla.l}%, ${hsla.a})`);
  }
} 