import * as audioContext from './audioContext';
import { EQProfile } from '../models/EQProfile';
import { EQBand } from '../models/EQBand';
import { useEQProfileStore } from '../stores';

// Default frequencies for a 10-band EQ
export const DEFAULT_FREQUENCIES = [
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
];

// Default Q values for each band
export const DEFAULT_Q = 1.4;

// Class to manage EQ processing
class EQProcessor {
  private filters: BiquadFilterNode[] = [];
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  private volumeNode: GainNode | null = null;
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
    
    // Create filter nodes for each frequency band
    this.filters = DEFAULT_FREQUENCIES.map((frequency, index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = 'peaking'; // EQ filter type
      filter.frequency.value = frequency;
      filter.gain.value = 0; // Default to flat EQ
      filter.Q.value = DEFAULT_Q;
      
      // Connect filters in series
      if (index === 0) {
        // First filter connects to input
        this.inputNode!.connect(filter);
      } else {
        // Other filters connect to previous filter
        this.filters[index - 1].connect(filter);
      }
      
      return filter;
    });
    
    // Connect last filter to volume node, then to output
    if (this.filters.length > 0) {
      this.filters[this.filters.length - 1].connect(this.volumeNode!);
      this.volumeNode!.connect(this.outputNode!);
    } else {
      // If no filters, connect input directly to output
      this.inputNode!.connect(this.volumeNode!);
      this.volumeNode!.connect(this.outputNode!);
    }
  }
  
  // Get the input node for connecting audio sources
  public getInputNode(): AudioNode {
    return this.inputNode!;
  }
  
  // Get the output node for connecting to the destination
  public getOutputNode(): AudioNode {
    return this.outputNode!;
  }
  
  // Apply an EQ profile to the filters
  public applyProfile(profile: EQProfile): void {
    this.currentProfile = profile;
    
    // Apply each band's settings
    profile.bands.forEach((band, index) => {
      if (index < this.filters.length) {
        const filter = this.filters[index];
        filter.frequency.value = band.frequency;
        filter.gain.value = this.isEnabled ? band.gain : 0;
        filter.Q.value = band.q;
      }
    });
    
    // Apply volume offset
    this.volumeNode!.gain.value = this.isEnabled ? 
      Math.pow(10, profile.volume / 20) : 1.0; // Convert dB to linear gain
  }
  
  // Enable or disable the EQ
  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    
    // If we have a current profile, reapply it with new enabled state
    if (this.currentProfile) {
      this.applyProfile(this.currentProfile);
    } else {
      // Otherwise, just set all filters to 0 gain
      this.filters.forEach(filter => {
        filter.gain.value = 0;
      });
      this.volumeNode!.gain.value = 1.0;
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
  
  // Update a single band in the current profile
  public updateBand(index: number, gain: number): void {
    if (index < this.filters.length && this.currentProfile) {
      // Update the filter directly
      this.filters[index].gain.value = this.isEnabled ? gain : 0;
      
      // Update the profile in memory
      const updatedBands = [...this.currentProfile.bands];
      updatedBands[index] = {
        ...updatedBands[index],
        gain
      };
      
      this.currentProfile = {
        ...this.currentProfile,
        bands: updatedBands
      };
    }
  }
  
  // Update the volume offset
  public updateVolume(volume: number): void {
    if (this.currentProfile) {
      // Update the volume node directly
      this.volumeNode!.gain.value = this.isEnabled ? 
        Math.pow(10, volume / 20) : 1.0;
      
      // Update the profile in memory
      this.currentProfile = {
        ...this.currentProfile,
        volume
      };
    }
  }
  
  // Create a default flat EQ profile
  public createDefaultProfile(): EQProfile {
    return {
      id: 'default',
      name: 'Flat',
      bands: DEFAULT_FREQUENCIES.map(frequency => ({
        frequency,
        gain: 0,
        q: DEFAULT_Q
      })),
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
    
    // Initialize with the active profile or create a default one
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
  }
  
  return eqProcessorInstance;
};

// Reset the EQ processor (useful for testing or when changing audio context)
export const resetEQProcessor = (): void => {
  eqProcessorInstance = null;
}; 