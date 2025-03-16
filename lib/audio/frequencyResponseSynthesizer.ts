import * as audioContext from './audioContext';

/**
 * Singleton class to synthesize audio impulse responses with specific spectral slopes.
 * Uses inverse FFT (IFFT) to directly create clicks with precise frequency characteristics.
 */
class FrequencyResponseSynthesizer {
  private static instance: FrequencyResponseSynthesizer;
  
  private constructor() {
    console.log('🔊 Initializing FrequencyResponseSynthesizer');
  }
  
  public static getInstance(): FrequencyResponseSynthesizer {
    if (!FrequencyResponseSynthesizer.instance) {
      FrequencyResponseSynthesizer.instance = new FrequencyResponseSynthesizer();
    }
    return FrequencyResponseSynthesizer.instance;
  }
  
  /**
   * Generates a click with the specified spectral slope using direct IFFT.
   * @param slopeDb The spectral slope in dB/octave (e.g., -3 for pink noise, -6 for brown noise)
   * @returns An AudioBuffer containing the click sound
   */
  public async generateClick(slopeDb: number): Promise<AudioBuffer> {
    const ctx = audioContext.getAudioContext();
    const bufferSize = 4096; // Power of 2 for FFT
    const sampleRate = ctx.sampleRate;
    
    console.log(`🔊 Generating click with ${slopeDb} dB/octave slope`);
    
    // Create our output buffer
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const outputChannel = buffer.getChannelData(0);
    
    // Step 1: Create frequency-domain representation with desired spectral slope
    
    // Arrays for frequency-domain representation (real and imaginary parts)
    const realFreq = new Float32Array(bufferSize);
    const imagFreq = new Float32Array(bufferSize);
    
    // Frequency resolution (Hz per bin)
    const freqResolution = sampleRate / bufferSize;
    
    // Reference frequency (1kHz is standard for audio)
    const refFreq = 1000;
    
    // Flatten the response below 20Hz
    const flattenFreqHz = 20;
    const flattenBin = Math.max(1, Math.round(flattenFreqHz / freqResolution));
    
    // Calculate the magnitude at 20Hz for flattening
    const flattenFreqOctaves = Math.log2(flattenFreqHz / refFreq);
    const flattenMagnitude = Math.pow(10, slopeDb * flattenFreqOctaves / 20);
    
    // DC component (0 Hz)
    realFreq[0] = 0;
    imagFreq[0] = 0;
    
    // Calculate magnitudes for positive frequencies (up to Nyquist)
    for (let i = 1; i < bufferSize / 2; i++) {
      const freqHz = i * freqResolution;
      
      // Calculate magnitude based on spectral slope
      let magnitude;
      
      if (i <= flattenBin) {
        // Below 20Hz, use the flattened magnitude
        magnitude = flattenMagnitude;
      } else {
        // Above 20Hz, apply the spectral slope in dB/octave
        const octavesFromRef = Math.log2(freqHz / refFreq);
        const dbAttenuation = slopeDb * octavesFromRef;
        magnitude = Math.pow(10, dbAttenuation / 20);
      }
      
      // Random phase for natural sound (0 to 2π)
      const phase = Math.random() * 2 * Math.PI;
      
      // Convert magnitude and phase to real and imaginary components
      realFreq[i] = magnitude * Math.cos(phase);
      imagFreq[i] = magnitude * Math.sin(phase);
    }
    
    // Nyquist frequency bin (real-only for real-valued output)
    realFreq[bufferSize / 2] = 0;
    imagFreq[bufferSize / 2] = 0;
    
    // Ensure conjugate symmetry for negative frequencies (for real-valued output)
    for (let i = 1; i < bufferSize / 2; i++) {
      realFreq[bufferSize - i] = realFreq[i];
      imagFreq[bufferSize - i] = -imagFreq[i]; // Note the negative sign
    }
    
    // Step 2: Perform the IFFT directly
    // For a proper impulse response, we need to directly compute the IFFT
    
    // The IFFT formula: x[n] = (1/N) * sum(X[k] * e^(j*2π*k*n/N))
    for (let n = 0; n < bufferSize; n++) {
      let real = 0;
      let imag = 0;
      
      for (let k = 0; k < bufferSize; k++) {
        const phase = 2 * Math.PI * k * n / bufferSize;
        real += realFreq[k] * Math.cos(phase) - imagFreq[k] * Math.sin(phase);
        imag += realFreq[k] * Math.sin(phase) + imagFreq[k] * Math.cos(phase);
      }
      
      // Scale by 1/N
      outputChannel[n] = real / bufferSize;
    }
    
    // Normalize the output
    this.normalizeBuffer(outputChannel);
    
    return buffer;
  }
  
  /**
   * Normalizes a buffer to prevent clipping
   * @param buffer The buffer to normalize
   */
  private normalizeBuffer(buffer: Float32Array): void {
    // Find the maximum absolute value
    let maxValue = 0;
    for (let i = 0; i < buffer.length; i++) {
      const absValue = Math.abs(buffer[i]);
      if (absValue > maxValue) {
        maxValue = absValue;
      }
    }
    
    // Only normalize if needed
    if (maxValue > 0) {
      const normalizationFactor = 0.95 / maxValue; // Leave a little headroom
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] *= normalizationFactor;
      }
    }
  }
}

/**
 * Get the singleton instance of the FrequencyResponseSynthesizer
 */
export function getFrequencyResponseSynthesizer(): FrequencyResponseSynthesizer {
  return FrequencyResponseSynthesizer.getInstance();
} 