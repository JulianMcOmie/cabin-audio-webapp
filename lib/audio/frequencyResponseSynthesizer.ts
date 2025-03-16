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
   * @returns An AudioBuffer containing the impulse response
   */
  public async generateClick(slopeDb: number): Promise<AudioBuffer> {
    const ctx = audioContext.getAudioContext();
    const length = 4096; // Power of 2 for FFT
    const sampleRate = ctx.sampleRate;
    
    console.log(`🔊 Generating impulse with ${slopeDb} dB/octave slope`);
    
    // Create our output buffer
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const outputChannel = buffer.getChannelData(0);
    
    // Step 1: Create the frequency domain representation
    
    // Create arrays for frequency domain representation
    const realFFT = new Float32Array(length);
    const imagFFT = new Float32Array(length);
    
    // Calculate frequency resolution
    const freqResolution = sampleRate / length;
    
    // Reference frequency (20Hz is standard for audio slope calculations)
    const refFreq = 20;
    
    // Calculate magnitude for each frequency bin
    for (let i = 0; i < length/2; i++) {
      // Calculate the frequency at this bin
      const freq = i * freqResolution;
      
      // Skip DC
      if (i === 0) {
        realFFT[i] = 0;
        imagFFT[i] = 0;
        continue;
      }
      
      // Calculate octaves from reference
      // Reference is 20Hz, so log2(freq/20) gives octaves above 20Hz
      const octaves = Math.log2(Math.max(freq, refFreq) / refFreq);
      
      // Apply the dB/octave slope
      const dbGain = slopeDb * octaves;
      
      // Convert from dB to linear magnitude
      const magnitude = Math.pow(10, dbGain / 20.0);
      
      // Use zero phase for all components to align them at t=0
      // This creates a concentrated click instead of noise
      realFFT[i] = magnitude;
      imagFFT[i] = 0;
      
      // Mirror for the negative frequencies (conjugate symmetry)
      if (i > 0 && i < length/2) {
        realFFT[length - i] = realFFT[i];
        imagFFT[length - i] = -imagFFT[i]; // Note the minus sign for conjugate
      }
    }
    
    // Set Nyquist bin (real-only for real output signal)
    realFFT[length/2] = 0;
    imagFFT[length/2] = 0;
    
    // Step 2: Perform IFFT
    this.performIFFT(realFFT, imagFFT, outputChannel);
    
    // Step 3: Apply a tapering window
    // Only apply it to the latter portion to preserve the initial impact
    const fadeStart = Math.floor(length * 0.01); // Start fade very early
    for (let i = fadeStart; i < length; i++) {
      const fadeAmount = Math.exp(-5 * (i - fadeStart) / (length - fadeStart));
      outputChannel[i] *= fadeAmount;
    }
    
    // Step 4: Normalize the buffer
    this.normalizeBuffer(outputChannel);
    
    return buffer;
  }
  
  /**
   * Performs inverse FFT (time domain from frequency domain)
   */
  private performIFFT(realFreq: Float32Array, imagFreq: Float32Array, outputSignal: Float32Array): void {
    const N = realFreq.length;
    
    // Simple direct implementation of IFFT
    for (let n = 0; n < N; n++) {
      let real = 0;
      
      for (let k = 0; k < N; k++) {
        const phase = 2 * Math.PI * k * n / N;
        real += realFreq[k] * Math.cos(phase) - imagFreq[k] * Math.sin(phase);
      }
      
      outputSignal[n] = real / N;
    }
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