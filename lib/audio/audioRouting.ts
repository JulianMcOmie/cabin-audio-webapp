import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// Class to manage audio routing
class AudioRouting {
  private destinationNode: AudioNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private isConnected: boolean = false;
  
  constructor() {
    this.initialize();
  }
  
  // Initialize audio routing
  private initialize(): void {
    console.log('🎵 [Audio Routing] Initializing audio routing...');
    // Get the audio context destination (speakers)
    this.destinationNode = audioContext.getAudioContext().destination;
    console.log('🎵 [Audio Routing] Got audio context destination');
    
    // Create an analyser node for visualizations
    this.analyserNode = audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    console.log(`🎵 [Audio Routing] Created analyser node with FFT size: ${this.analyserNode.fftSize}`);
    
    // Connect EQ processor output to analyser
    const eqOutput = eqProcessor.getEQProcessor().getOutputNode();
    eqOutput.connect(this.analyserNode);
    console.log('🎵 [Audio Routing] Connected EQ processor output to analyser');
    
    // Connect analyser to destination
    this.analyserNode.connect(this.destinationNode);
    console.log('🎵 [Audio Routing] Connected analyser to destination');
    
    this.isConnected = true;
    console.log('🎵 [Audio Routing] Full audio routing chain: EQ Output -> Analyser -> Speakers');
  }
  
  // Get the analyser node for visualizations
  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }
  
  // Disconnect all audio nodes (useful when changing output devices)
  public disconnect(): void {
    if (this.isConnected && this.analyserNode) {
      this.analyserNode.disconnect();
      eqProcessor.getEQProcessor().getOutputNode().disconnect();
      this.isConnected = false;
    }
  }
  
  // Reconnect audio nodes
  public reconnect(): void {
    if (!this.isConnected && this.analyserNode && this.destinationNode) {
      eqProcessor.getEQProcessor().getOutputNode().connect(this.analyserNode);
      this.analyserNode.connect(this.destinationNode);
      this.isConnected = true;
    }
  }
  
  // Change output device
  public async changeOutputDevice(deviceId: string): Promise<boolean> {
    try {
      // This requires the Audio Output Devices API which is not fully supported
      // in all browsers. For browsers that support it:
      const ctx = audioContext.getAudioContext();
      // Check if the setSinkId method exists on the AudioContext
      if ('setSinkId' in ctx) {
        await (ctx as AudioContext & { setSinkId(deviceId: string): Promise<void> }).setSinkId(deviceId);
        return true;
      }
      
      // For browsers that don't support setSinkId, we can't change the output device
      console.warn('Audio output device selection is not supported in this browser');
      return false;
    } catch (error) {
      console.error('Error changing audio output device:', error);
      return false;
    }
  }
  
  // Get available audio output devices
  public async getOutputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audiooutput');
    } catch (error) {
      console.error('Error getting audio output devices:', error);
      return [];
    }
  }
  
  // Get frequency data for visualizations
  public getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode) {
      return null;
    }
    
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    return dataArray;
  }
  
  // Get time domain data for visualizations
  public getTimeDomainData(): Uint8Array | null {
    if (!this.analyserNode) {
      return null;
    }
    
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteTimeDomainData(dataArray);
    return dataArray;
  }
}

// Singleton instance
let audioRoutingInstance: AudioRouting | null = null;

// Get or create the audio routing instance
export const getAudioRouting = (): AudioRouting => {
  if (!audioRoutingInstance) {
    audioRoutingInstance = new AudioRouting();
  }
  
  return audioRoutingInstance;
};

// Initialize audio routing (call this when the app starts)
export const initializeAudioRouting = (): void => {
  getAudioRouting();
};

// Clean up audio routing (call this when the app is unloaded)
export const cleanupAudioRouting = (): void => {
  if (audioRoutingInstance) {
    audioRoutingInstance.disconnect();
    audioRoutingInstance = null;
  }
}; 