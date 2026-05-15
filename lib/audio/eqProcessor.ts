import * as audioContext from './audioContext';
import { EQProfile } from '../models/EQProfile';
import { EQBand, EQBandChannel } from '../models/EQBand';
import { useEQProfileStore } from '../stores';
import { dbToGain } from '../utils/audioMath';

const TRANSITION_TIME = 0.05; // 50ms transition for smoothness

type ChannelKey = 'both' | 'left' | 'right';

const getChannel = (band: EQBand): EQBandChannel => band.channel ?? 'both';

// Class to manage EQ processing
class EQProcessor {
  // Filter chains per channel destination
  private bothFilters: BiquadFilterNode[] = [];
  private leftFilters: BiquadFilterNode[] = [];
  private rightFilters: BiquadFilterNode[] = [];

  // Graph nodes
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  private volumeNode: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;

  private isEnabled: boolean = true;
  private currentProfile: EQProfile | null = null;

  constructor() {
    this.initialize();
  }

  // Initialize the EQ processor
  private initialize(): void {
    // Create input and output nodes
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();
    this.volumeNode = audioContext.createGain();

    // Make sure volume node is at unity gain (no volume change)
    this.volumeNode.gain.value = 1.0;

    // Simple pass-through connection - input to volume to output
    this.inputNode.connect(this.volumeNode);
    this.volumeNode.connect(this.outputNode);
  }

  // Get the input node for connecting audio sources
  public getInputNode(): AudioNode {
    return this.inputNode!;
  }

  // Get the output node for connecting to the destination
  public getOutputNode(): AudioNode {
    return this.outputNode!;
  }

  // Partition bands by channel
  private partitionBands(bands: EQBand[]): Record<ChannelKey, EQBand[]> {
    const both: EQBand[] = [];
    const left: EQBand[] = [];
    const right: EQBand[] = [];
    for (const band of bands) {
      const ch = getChannel(band);
      if (ch === 'left') left.push(band);
      else if (ch === 'right') right.push(band);
      else both.push(band);
    }
    return { both, left, right };
  }

  // Create a new filter node for a band
  private makeFilter(band: EQBand): BiquadFilterNode {
    const audioCtx = audioContext.getAudioContext();
    const filter = audioCtx.createBiquadFilter();
    filter.type = band.type || 'peaking';
    filter.frequency.value = band.frequency;
    filter.Q.value = band.q;
    filter.gain.value = this.isEnabled ? band.gain : 0;
    return filter;
  }

  // Tear down and rebuild the entire filter graph based on the profile's bands
  private createFilterChain(profile: EQProfile): void {
    // Always fully tear down the existing graph (simpler and robust)
    this.disconnectAll();

    const { both, left, right } = this.partitionBands(profile.bands || []);
    const needSplit = left.length > 0 || right.length > 0;

    // Rebuild filter arrays
    this.bothFilters = both.map((b) => this.makeFilter(b));
    this.leftFilters = left.map((b) => this.makeFilter(b));
    this.rightFilters = right.map((b) => this.makeFilter(b));

    const audioCtx = audioContext.getAudioContext();

    // Connect the "both" chain starting from inputNode
    let tail: AudioNode = this.inputNode!;
    for (const f of this.bothFilters) {
      tail.connect(f);
      tail = f;
    }

    if (!needSplit) {
      // No L/R-only bands → tail goes straight to volume
      tail.connect(this.volumeNode!);
      return;
    }

    // Stereo split
    this.splitter = audioCtx.createChannelSplitter(2);
    this.merger = audioCtx.createChannelMerger(2);
    tail.connect(this.splitter);

    // Left chain: splitter[0] → leftFilters → merger[0]
    let leftTail: AudioNode = this.splitter;
    let leftTailOutput = 0; // which output index on the upstream node feeds the merger
    if (this.leftFilters.length > 0) {
      this.splitter.connect(this.leftFilters[0], 0);
      for (let i = 0; i < this.leftFilters.length - 1; i++) {
        this.leftFilters[i].connect(this.leftFilters[i + 1]);
      }
      leftTail = this.leftFilters[this.leftFilters.length - 1];
      leftTailOutput = 0;
    }
    leftTail.connect(this.merger, leftTailOutput, 0);

    // Right chain: splitter[1] → rightFilters → merger[1]
    let rightTail: AudioNode = this.splitter;
    let rightTailOutput = 1;
    if (this.rightFilters.length > 0) {
      this.splitter.connect(this.rightFilters[0], 1);
      for (let i = 0; i < this.rightFilters.length - 1; i++) {
        this.rightFilters[i].connect(this.rightFilters[i + 1]);
      }
      rightTail = this.rightFilters[this.rightFilters.length - 1];
      rightTailOutput = 0;
    }
    rightTail.connect(this.merger, rightTailOutput, 1);

    // Merger → volume
    this.merger.connect(this.volumeNode!);
  }

  // Disconnect all filters and splitter/merger nodes from the chain
  private disconnectAll(): void {
    try { this.inputNode?.disconnect(); } catch {}
    for (const f of this.bothFilters) { try { f.disconnect(); } catch {} }
    for (const f of this.leftFilters) { try { f.disconnect(); } catch {} }
    for (const f of this.rightFilters) { try { f.disconnect(); } catch {} }
    if (this.splitter) { try { this.splitter.disconnect(); } catch {} }
    if (this.merger) { try { this.merger.disconnect(); } catch {} }
    this.bothFilters = [];
    this.leftFilters = [];
    this.rightFilters = [];
    this.splitter = null;
    this.merger = null;
  }

  // Apply an EQ profile to the filters
  public applyProfile(profile: EQProfile): void {
    this.currentProfile = profile;

    // (Re)build the filter graph
    this.createFilterChain(profile);

    // Set volume according to profile with smooth transition
    if (this.volumeNode) {
      const audioCtx = audioContext.getAudioContext();

      // Convert from dB to linear gain if needed
      const volumeGain = this.isEnabled && profile.volume ?
        dbToGain(profile.volume) : 1.0;

      // Smoothly transition to new volume
      this.volumeNode.gain.linearRampToValueAtTime(
        volumeGain,
        audioCtx.currentTime + TRANSITION_TIME
      );
    }
  }

  // Enable or disable the EQ with smooth transition
  public setEnabled(enabled: boolean): void {
    if (this.isEnabled === enabled) return;
    this.isEnabled = enabled;

    if (!this.currentProfile) return;

    const audioCtx = audioContext.getAudioContext();
    const currentTime = audioCtx.currentTime;
    const ENABLE_TRANSITION = 0.01; // 10ms

    // Walk through currentProfile bands in their original order but map them
    // to the appropriate filter array.
    const bothCount = { i: 0 };
    const leftCount = { i: 0 };
    const rightCount = { i: 0 };

    for (const band of this.currentProfile.bands || []) {
      const ch = getChannel(band);
      let filter: BiquadFilterNode | undefined;
      if (ch === 'left') {
        filter = this.leftFilters[leftCount.i++];
      } else if (ch === 'right') {
        filter = this.rightFilters[rightCount.i++];
      } else {
        filter = this.bothFilters[bothCount.i++];
      }
      if (filter) {
        const targetGain = enabled ? band.gain : 0;
        filter.gain.linearRampToValueAtTime(targetGain, currentTime + ENABLE_TRANSITION);
      }
    }

    // Also smoothly transition volume if needed
    if (this.volumeNode && this.currentProfile.volume) {
      const volumeGain = enabled ? dbToGain(this.currentProfile.volume) : 1.0;
      this.volumeNode.gain.linearRampToValueAtTime(
        volumeGain,
        currentTime + ENABLE_TRANSITION
      );
    }
  }

  // Check if EQ is enabled
  public isEQEnabled(): boolean {
    return this.isEnabled;
  }

  // Get the current profile
  public getCurrentProfile(): EQProfile | null {
    return this.currentProfile;
  }

  // Update a single band (legacy path used by useEQ hook). Re-applies the
  // profile to keep the stereo graph consistent.
  public updateBand(indexOrBand: number | EQBand, gain?: number, frequency?: number, q?: number): void {
    if (!this.currentProfile) return;
    const bands = [...(this.currentProfile.bands || [])];

    if (typeof indexOrBand === 'object') {
      const band = indexOrBand;
      const existingIdx = bands.findIndex(b => Math.abs(b.frequency - band.frequency) <= 0.001);
      if (existingIdx !== -1) {
        bands[existingIdx] = { ...bands[existingIdx], ...band };
      } else {
        bands.push(band);
      }
    } else {
      const index = indexOrBand;
      if (index < 0 || index >= bands.length) return;
      bands[index] = {
        ...bands[index],
        ...(gain !== undefined ? { gain } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(q !== undefined ? { q } : {}),
      };
    }

    this.applyProfile({
      ...this.currentProfile,
      bands,
      lastModified: Date.now(),
    });
  }

  // Find the index of a band by frequency in the current profile
  public findBandIndexByFrequency(frequency: number, tolerance: number = 0.001): number {
    if (!this.currentProfile) return -1;
    const bands = this.currentProfile.bands || [];
    for (let i = 0; i < bands.length; i++) {
      if (Math.abs(bands[i].frequency - frequency) <= tolerance) return i;
    }
    return -1;
  }

  // Remove a band by frequency
  public removeBandByFrequency(frequency: number): boolean {
    if (!this.currentProfile) return false;
    const index = this.findBandIndexByFrequency(frequency);
    if (index === -1) return false;
    const bands = [...(this.currentProfile.bands || [])];
    bands.splice(index, 1);
    this.applyProfile({ ...this.currentProfile, bands, lastModified: Date.now() });
    return true;
  }

  // Update volume with smooth transition
  public updateVolume(volume: number): void {
    if (this.volumeNode && this.currentProfile) {
      const audioCtx = audioContext.getAudioContext();
      const currentTime = audioCtx.currentTime;

      const volumeGain = this.isEnabled ? dbToGain(volume) : 1.0;
      this.volumeNode.gain.linearRampToValueAtTime(volumeGain, currentTime + TRANSITION_TIME);

      this.currentProfile = {
        ...this.currentProfile,
        volume,
        lastModified: Date.now(),
      };
    }
  }

  // Create a default flat EQ profile
  public createDefaultProfile(): EQProfile {
    return {
      id: 'default',
      name: 'Profile 1',
      bands: [],
      volume: 0,
      lastModified: Date.now(),
      syncStatus: 'synced'
    };
  }
}

// Singleton instance
let eqProcessorInstance: EQProcessor | null = null;

// Get or create the EQ processor instance
export const getEQProcessor = (): EQProcessor => {
  if (!eqProcessorInstance) {
    eqProcessorInstance = new EQProcessor();

    // Initialize with the active profile from the store
    const eqStore = useEQProfileStore.getState();
    const activeProfile = eqStore.getActiveProfile();

    if (activeProfile) {
      eqProcessorInstance.applyProfile(activeProfile);
    } else {
      // Create and apply a default profile
      const defaultProfile = eqProcessorInstance.createDefaultProfile();
      eqProcessorInstance.applyProfile(defaultProfile);

      // Save the default profile to the store
      eqStore.addProfile(defaultProfile);
      eqStore.setActiveProfile(defaultProfile.id);
    }

    // Set the enabled state based on the store
    eqProcessorInstance.setEnabled(eqStore.isEQEnabled);

    // Subscribe to changes in the store
    useEQProfileStore.subscribe(
      state => {
        if (!eqProcessorInstance) return;

        // Handle EQ enabled state changes
        if (eqProcessorInstance.isEQEnabled() !== state.isEQEnabled) {
          eqProcessorInstance.setEnabled(state.isEQEnabled);
        }

        // Handle active profile changes
        const activeProfile = state.activeProfileId ? state.profiles[state.activeProfileId] : null;
        if (activeProfile) {
          const currentProfile = eqProcessorInstance.getCurrentProfile();

          // Apply the profile if it's different or has been updated
          if (!currentProfile ||
              currentProfile.id !== activeProfile.id ||
              currentProfile.lastModified !== activeProfile.lastModified) {
            eqProcessorInstance.applyProfile(activeProfile);
          }
        }
      }
    );
  }

  return eqProcessorInstance;
};

// Reset the EQ processor (useful for testing or when changing audio context)
export const resetEQProcessor = (): void => {
  eqProcessorInstance = null;
};
