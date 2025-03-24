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
  private createImpulseResponseFromFrequencyResponse(points: EQPoint[]): AudioBuffer {
    const ctx = audioContext.getAudioContext();
    
    // Create a function that can be sampled at any frequency
    const responseFunction = createFrequencyResponseFunction(points, referenceNode);
    
    // Generate frequency response array
    const frequencyResponse = generateFrequencyResponseArray(
      responseFunction,
      DEFAULT_FREQ_RANGE,
      this.bufferSize // Use buffer size as resolution
    );
    
    // Create FFT buffer with real and imaginary components
    // We'll use AnalyserNode's getFloatFrequencyData to fill this
    const realBuffer = new Float32Array(this.bufferSize);
    const imagBuffer = new Float32Array(this.bufferSize);
    
    // Fill the frequency response data (convert from dB to linear magnitude)
    for (let i = 0; i < frequencyResponse.length; i++) {
      // Convert dB amplitude to linear magnitude
      const linearMagnitude = dbToLinear(frequencyResponse[i].amplitude);
      
      // Set magnitude as real component (phase is 0 for minimum phase)
      realBuffer[i] = linearMagnitude;
      imagBuffer[i] = 0; // Zero phase (minimum phase response)
    }
    
    // Mirror the frequency response for negative frequencies (conjugate symmetry)
    // This ensures the resulting impulse response is real
    for (let i = 1; i < this.bufferSize / 2; i++) {
      realBuffer[this.bufferSize - i] = realBuffer[i];
      imagBuffer[this.bufferSize - i] = -imagBuffer[i]; // Conjugate
    }
    
    // Create an AudioBuffer for our impulse response
    const impulseBuffer = ctx.createBuffer(2, this.bufferSize, ctx.sampleRate);
    
    // Use OfflineAudioContext to perform IFFT
    const offlineCtx = new OfflineAudioContext(
      1, // Mono
      this.bufferSize,
      ctx.sampleRate
    );
    
    // Create an oscillator to generate the impulse
    const oscillator = offlineCtx.createOscillator();
    
    // Create a custom wave using our frequency response
    try {
      // Use the Web Audio API's createPeriodicWave to perform the IFFT
      const wave = offlineCtx.createPeriodicWave(realBuffer, imagBuffer, {
        disableNormalization: true
      });
      
      oscillator.setPeriodicWave(wave);
      oscillator.frequency.value = 0; // DC (needed for impulse response)
      
      // Connect to the offline context destination
      oscillator.connect(offlineCtx.destination);
      
      // Start the oscillator at the beginning
      oscillator.start();
      
      // Render the audio
      return offlineCtx.startRendering().then(renderedBuffer => {
        // Apply windowing to avoid time-domain artifacts
        this.applyWindow(renderedBuffer);
        
        // Copy to stereo buffer
        for (let channel = 0; channel < 2; channel++) {
          const channelData = impulseBuffer.getChannelData(channel);
          const renderedData = renderedBuffer.getChannelData(0);
          
          // Copy data
          for (let i = 0; i < this.bufferSize; i++) {
            channelData[i] = renderedData[i];
          }
        }
        
        return impulseBuffer;
      });
    } catch (error) {
      console.error('Error creating impulse response:', error);
      
      // Fallback: create a flat impulse response
      for (let channel = 0; channel < 2; channel++) {
        const channelData = impulseBuffer.getChannelData(channel);
        channelData[0] = 1.0; // Simple delta function
      }
      
      return Promise.resolve(impulseBuffer);
    }
  }
  
  // Apply a window function to the impulse response to reduce artifacts
  private applyWindow(buffer: AudioBuffer): void {
    // Apply a half Hann (raised cosine) window
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < data.length; i++) {
      // Half Hann window: 0.5 * (1 - cos(2π*n/(N-1)))
      const windowValue = 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)));
      data[i] *= windowValue;
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