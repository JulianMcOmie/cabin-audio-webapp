import * as audioContext from './audioContext';
import { SineProfile } from '../models/SineProfile';
import { 
  createFrequencyResponseFunction, 
  generateFrequencyResponseArray, 
  dbToLinear,
  DEFAULT_FREQ_RANGE
} from './sineFrequencyResponse';
import { useSineProfileStore } from '../stores/sineProfileStore';
import { EQPoint } from '@/components/sine-eq/types';

// Reference node for SineEQ (1kHz, 0dB)
const referenceNode: EQPoint = { frequency: 1000, amplitude: 0 };

// Class to manage SineEQ processing with convolution
class SineEQProcessor {
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  private convolverNode: ConvolverNode | null = null;
  private bypassNode: GainNode | null = null;
  private isEnabled: boolean = true;
  private currentProfile: SineProfile | null = null;
  
  // Configurable parameters
  private bufferSize: number = 4096; // Default buffer size for impulse response
  
  constructor(bufferSize?: number) {
    if (bufferSize) {
      this.bufferSize = bufferSize;
    }
    this.initialize();
  }
  
  // Initialize the processor
  private initialize(): void {
    // Create audio nodes
    const ctx = audioContext.getAudioContext();
    
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();
    
    // Create convolver node
    this.convolverNode = ctx.createConvolver();
    
    // Create bypass node for when convolution is disabled
    this.bypassNode = ctx.createGain();
    this.bypassNode.gain.value = 0; // Initially off, as convolver is on
    
    // Connect the nodes
    this.inputNode.connect(this.convolverNode);
    this.convolverNode.connect(this.outputNode);
    
    // Create bypass path (parallel to convolver)
    this.inputNode.connect(this.bypassNode);
    this.bypassNode.connect(this.outputNode);
    
    // Initialize with a flat impulse response
    this.createFlatImpulseResponse();
  }
  
  // Create flat impulse response (unity gain)
  private createFlatImpulseResponse(): void {
    if (!this.convolverNode) return;
    
    const ctx = audioContext.getAudioContext();
    const buffer = ctx.createBuffer(2, this.bufferSize, ctx.sampleRate);
    
    // Add single impulse at the beginning of each channel
    for (let channel = 0; channel < 2; channel++) {
      const channelData = buffer.getChannelData(channel);
      // Set first sample to 1.0, rest stays at 0
      channelData[0] = 1.0;
    }
    
    // Set the buffer
    this.convolverNode.buffer = buffer;
  }
  
  // Generate impulse response from frequency response using IFFT
  private createImpulseResponseFromFrequencyResponse(points: EQPoint[]): Promise<AudioBuffer> {
    const ctx = audioContext.getAudioContext();
    
    // Create a function that can be sampled at any frequency
    const responseFunction = createFrequencyResponseFunction(points, referenceNode);
    
    // Create impulse buffer
    const impulseBuffer = ctx.createBuffer(2, this.bufferSize, ctx.sampleRate);
    
    // Create FFT data arrays - complex format with real/imag pairs
    const frequencyData = new Float32Array(this.bufferSize * 2);
    
    // Fill frequency response at correct bin positions
    for (let i = 0; i <= this.bufferSize / 2; i++) {
      // Convert bin index to normalized frequency (0 to 0.5)
      const normalizedFreq = i / (this.bufferSize / 2);
      
      // Map to actual frequency (0 to Nyquist)
      const freq = normalizedFreq * (ctx.sampleRate / 2);
      
      // Get amplitude at this frequency and convert to linear
      const amplitude = responseFunction(freq);
      const linearMagnitude = dbToLinear(amplitude);
      
      // Set magnitude as real component (phase is 0 for minimum phase)
      frequencyData[i * 2] = linearMagnitude;     // Real part
      frequencyData[i * 2 + 1] = 0;               // Imaginary part
    }
    
    // Create conjugate symmetry for negative frequencies (excluding DC and Nyquist)
    for (let i = 1; i < this.bufferSize / 2; i++) {
      const reverseIdx = this.bufferSize - i;
      frequencyData[reverseIdx * 2] = frequencyData[i * 2];          // Real part
      frequencyData[reverseIdx * 2 + 1] = -frequencyData[i * 2 + 1]; // Negative imaginary for conjugate
    }
    
    // Perform IFFT (implemented below)
    const timeData = this.performIFFT(frequencyData);
    
    // Copy to the impulse buffer and apply processing
    const channelData = new Float32Array(this.bufferSize);
    for (let i = 0; i < this.bufferSize; i++) {
      // Take only real part and scale by buffer size
      channelData[i] = timeData[i * 2] / this.bufferSize;
    }
    
    // Transform post-ringing into pre-ringing (swap halves of the buffer)
    const halfSize = this.bufferSize / 2;
    const tempData = new Float32Array(halfSize);
    
    // Copy first half to temp
    for (let i = 0; i < halfSize; i++) {
      tempData[i] = channelData[i];
    }
    
    // Move second half to first half
    for (let i = 0; i < halfSize; i++) {
      channelData[i] = channelData[i + halfSize];
    }
    
    // Move temp to second half
    for (let i = 0; i < halfSize; i++) {
      channelData[i + halfSize] = tempData[i];
    }
    
    // Apply windowing
    for (let i = 0; i < this.bufferSize; i++) {
      // Hann window: 0.5 * (1 - cos(2π*n/(N-1)))
      const windowValue = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.bufferSize - 1)));
      channelData[i] *= windowValue;
    }
    
    // Copy to stereo buffer
    for (let channel = 0; channel < 2; channel++) {
      const outputData = impulseBuffer.getChannelData(channel);
      
      // Copy data
      for (let i = 0; i < this.bufferSize; i++) {
        outputData[i] = channelData[i];
      }
    }
    
    // Print out the first few elements of the impulse buffer
    console.log('Impulse buffer:', impulseBuffer.getChannelData(0).slice(0, 10));
    
    return Promise.resolve(impulseBuffer);
  }
  
  // Perform IFFT (Inverse Fast Fourier Transform)
  private performIFFT(frequencyData: Float32Array): Float32Array {
    // Ensure buffer size is power of 2
    const n = frequencyData.length / 2;
    if ((n & (n - 1)) !== 0) {
      throw new Error('FFT size must be a power of 2');
    }
    
    // Create complex data array (conjugate the input for IFFT)
    const data = new Float32Array(frequencyData.length);
    for (let i = 0; i < frequencyData.length; i += 2) {
      data[i] = frequencyData[i];        // Real part stays the same
      data[i+1] = -frequencyData[i+1];   // Conjugate imaginary part
    }
    
    // Perform FFT (the conjugated input makes this an IFFT)
    this.performFFT(data, false);
    
    // Return the result
    return data;
  }
  
  // Perform FFT (Fast Fourier Transform)
  private performFFT(data: Float32Array, inverse: boolean): void {
    const n = data.length / 2;
    
    // Bit reversal permutation
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        // Swap real parts
        const tempReal = data[i*2];
        data[i*2] = data[j*2];
        data[j*2] = tempReal;
        
        // Swap imaginary parts
        const tempImag = data[i*2+1];
        data[i*2+1] = data[j*2+1];
        data[j*2+1] = tempImag;
      }
      
      let k = n / 2;
      while (k <= j) {
        j -= k;
        k /= 2;
      }
      j += k;
    }
    
    // Cooley-Tukey FFT
    for (let step = 1; step < n; step *= 2) {
      const jump = step * 2;
      
      // Calculate twiddle factor
      const theta = Math.PI / step * (inverse ? -1 : 1);
      const wReal = Math.cos(theta);
      const wImag = Math.sin(theta);
      
      for (let group = 0; group < n; group += jump) {
        let tReal = 1.0;
        let tImag = 0.0;
        
        for (let butterfly = 0; butterfly < step; butterfly++) {
          const aIndex = (group + butterfly) * 2;
          const bIndex = (group + butterfly + step) * 2;
          
          // Get values
          const aReal = data[aIndex];
          const aImag = data[aIndex+1];
          const bReal = data[bIndex];
          const bImag = data[bIndex+1];
          
          // Calculate twiddle * b
          const tBReal = bReal * tReal - bImag * tImag;
          const tBImag = bReal * tImag + bImag * tReal;
          
          // Butterfly operation
          data[bIndex] = aReal - tBReal;
          data[bIndex+1] = aImag - tBImag;
          data[aIndex] = aReal + tBReal;
          data[aIndex+1] = aImag + tBImag;
          
          // Update twiddle factor
          const nextTReal = tReal * wReal - tImag * wImag;
          const nextTImag = tReal * wImag + tImag * wReal;
          tReal = nextTReal;
          tImag = nextTImag;
        }
      }
    }
  }
  
  // Apply a sine profile to the processor
  public async applyProfile(profile: SineProfile): Promise<void> {
    this.currentProfile = profile;
    
    if (!this.convolverNode) return;
    
    try {
      // Generate impulse response from profile
      const impulseBuffer = await this.createImpulseResponseFromFrequencyResponse(
        profile.points || []
      );

      // Print out the first few elements of the impulse buffer
      console.log('Impulse buffer:', impulseBuffer.getChannelData(0));
      
      // Set the convolver buffer
      this.convolverNode.buffer = impulseBuffer;
      
      // Update bypass state
      this.setEnabled(this.isEnabled);
    } catch (error) {
      console.error('Error applying sine profile:', error);
    }
  }
  
  // Enable or disable the SineEQ processor
  public setEnabled(enabled: boolean): void {
    if (this.isEnabled === enabled) return;
    
    this.isEnabled = enabled;
    
    // Update node gains for smooth transition
    const ctx = audioContext.getAudioContext();
    const now = ctx.currentTime;
    const TRANSITION_TIME = 0.02; // 20ms transition
    
    if (!this.convolverNode || !this.bypassNode) return;
    
    if (enabled) {
      // Fade in convolver, fade out bypass
      this.bypassNode.gain.linearRampToValueAtTime(0, now + TRANSITION_TIME);
      // Web Audio API doesn't allow changing convolver wet gain, so we use an additional gain node
    } else {
      // Fade in bypass (dry signal only)
      this.bypassNode.gain.linearRampToValueAtTime(1, now + TRANSITION_TIME);
    }
  }
  
  // Get input node
  public getInputNode(): GainNode | null {
    return this.inputNode;
  }
  
  // Get output node
  public getOutputNode(): GainNode | null {
    return this.outputNode;
  }
  
  // Check if processor is enabled
  public isProcessorEnabled(): boolean {
    return this.isEnabled;
  }
  
  // Get the current profile
  public getCurrentProfile(): SineProfile | null {
    return this.currentProfile;
  }
  
  // Update buffer size (requires reapplying the profile)
  public setBufferSize(bufferSize: number): void {
    this.bufferSize = bufferSize;
    
    // If we have a current profile, reapply it
    if (this.currentProfile) {
      this.applyProfile(this.currentProfile);
    } else {
      // Otherwise, recreate flat impulse response
      this.createFlatImpulseResponse();
    }
  }
  
  // Disconnect all nodes
  public disconnect(): void {
    if (this.inputNode) {
      this.inputNode.disconnect();
    }
    if (this.convolverNode) {
      this.convolverNode.disconnect();
    }
    if (this.bypassNode) {
      this.bypassNode.disconnect();
    }
    if (this.outputNode) {
      this.outputNode.disconnect();
    }
  }
}

// Singleton instance
let sineEQProcessorInstance: SineEQProcessor | null = null;

// Get or create the SineEQ processor instance
export const getSineEQProcessor = (): SineEQProcessor => {
  if (!sineEQProcessorInstance) {
    sineEQProcessorInstance = new SineEQProcessor();
  }
  return sineEQProcessorInstance;
};

// Apply active profile from store
export const applyActiveProfile = async (): Promise<void> => {
  const processor = getSineEQProcessor();
  const store = useSineProfileStore.getState();
  
  // Get the active profile
  const activeProfile = store.getActiveProfile();
  
  if (activeProfile) {
    // Apply the profile to the processor
    await processor.applyProfile(activeProfile);
    
    // Set enabled state
    processor.setEnabled(store.isSineEQEnabled);
  }
};

// Reset the processor (useful for testing)
export const resetSineEQProcessor = (): void => {
  if (sineEQProcessorInstance) {
    sineEQProcessorInstance.disconnect();
  }
  sineEQProcessorInstance = null;
}; 