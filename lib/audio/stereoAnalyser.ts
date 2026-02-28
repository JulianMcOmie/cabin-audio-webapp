import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';

class StereoAnalyser {
  private splitter: ChannelSplitterNode | null = null;
  private leftAnalyser: AnalyserNode | null = null;
  private rightAnalyser: AnalyserNode | null = null;
  private isConnected: boolean = false;

  connect(): void {
    if (this.isConnected) return;

    const ctx = audioContext.getAudioContext();
    const outputNode = eqProcessor.getEQProcessor().getOutputNode();

    this.splitter = ctx.createChannelSplitter(2);
    this.leftAnalyser = ctx.createAnalyser();
    this.rightAnalyser = ctx.createAnalyser();

    this.leftAnalyser.fftSize = 2048;
    this.leftAnalyser.smoothingTimeConstant = 0.12;
    this.rightAnalyser.fftSize = 2048;
    this.rightAnalyser.smoothingTimeConstant = 0.12;

    // Tap the EQ output (non-invasive — Web Audio allows multiple connections)
    outputNode.connect(this.splitter);
    this.splitter.connect(this.leftAnalyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);

    this.isConnected = true;
  }

  disconnect(): void {
    if (!this.isConnected) return;

    try {
      const outputNode = eqProcessor.getEQProcessor().getOutputNode();
      if (this.splitter) {
        outputNode.disconnect(this.splitter);
        this.splitter.disconnect();
      }
    } catch {
      // Node may already be disconnected
    }

    this.splitter = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.isConnected = false;
  }

  getLeftAnalyser(): AnalyserNode | null {
    return this.leftAnalyser;
  }

  getRightAnalyser(): AnalyserNode | null {
    return this.rightAnalyser;
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  /** Number of frequency bins per channel (fftSize / 2) */
  getFrequencyBinCount(): number {
    return this.leftAnalyser ? this.leftAnalyser.frequencyBinCount : 0;
  }
}

// Singleton
let instance: StereoAnalyser | null = null;

export function getStereoAnalyser(): StereoAnalyser {
  if (!instance) {
    instance = new StereoAnalyser();
  }
  return instance;
}
