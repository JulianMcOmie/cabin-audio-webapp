import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

// -6 dB headroom to guard against auto-gain miscalculations
const HEADROOM_GAIN = Math.pow(10, -6 / 20); // ≈ 0.5012

// Class to manage audio routing
class AudioRouting {
  private destinationNode: AudioNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private headroomNode: GainNode | null = null;
  private isConnected: boolean = false;
  private frequencyBuffer: Uint8Array | null = null;
  private timeDomainBuffer: Uint8Array | null = null;
  
  constructor() {
    this.initialize();
  }
  
  // Initialize audio routing
  private initialize(): void {
    // Get the audio context destination (speakers)
    this.destinationNode = audioContext.getAudioContext().destination;
    
    // Create an analyser node for visualizations
    this.analyserNode = audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // Create a headroom gain node to guard against clipping
    this.headroomNode = audioContext.createGain();
    this.headroomNode.gain.value = HEADROOM_GAIN;

    // Connect: EQ output → analyser → headroom → destination
    eqProcessor.getEQProcessor().getOutputNode().connect(this.analyserNode);
    this.analyserNode.connect(this.headroomNode);
    this.headroomNode.connect(this.destinationNode);
    
    this.isConnected = true;
  }
  
  // Get the analyser node for visualizations
  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }
  
  // Disconnect all audio nodes (useful when changing output devices)
  public disconnect(): void {
    if (this.isConnected && this.analyserNode) {
      this.analyserNode.disconnect();
      this.headroomNode?.disconnect();
      eqProcessor.getEQProcessor().getOutputNode().disconnect();
      this.isConnected = false;
    }
  }

  // Reconnect audio nodes
  public reconnect(): void {
    if (!this.isConnected && this.analyserNode && this.headroomNode && this.destinationNode) {
      eqProcessor.getEQProcessor().getOutputNode().connect(this.analyserNode);
      this.analyserNode.connect(this.headroomNode);
      this.headroomNode.connect(this.destinationNode);
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
  
  // Get frequency data for visualizations (pre-allocated buffer, no GC pressure)
  public getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode) {
      return null;
    }

    const binCount = this.analyserNode.frequencyBinCount;
    if (!this.frequencyBuffer || this.frequencyBuffer.length !== binCount) {
      this.frequencyBuffer = new Uint8Array(binCount);
    }
    this.analyserNode.getByteFrequencyData(this.frequencyBuffer);
    return this.frequencyBuffer;
  }

  // Get time domain data for visualizations (pre-allocated buffer, no GC pressure)
  public getTimeDomainData(): Uint8Array | null {
    if (!this.analyserNode) {
      return null;
    }

    const binCount = this.analyserNode.frequencyBinCount;
    if (!this.timeDomainBuffer || this.timeDomainBuffer.length !== binCount) {
      this.timeDomainBuffer = new Uint8Array(binCount);
    }
    this.analyserNode.getByteTimeDomainData(this.timeDomainBuffer);
    return this.timeDomainBuffer;
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