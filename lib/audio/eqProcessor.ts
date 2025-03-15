import * as audioContext from './audioContext';
import { EQProfile } from '../models/EQProfile';
import { EQBand } from '../models/EQBand';
import { useEQProfileStore } from '../stores';

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
    console.log('🎮 EQProcessor.initialize called');
    
    // Create input and output nodes
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();
    this.volumeNode = audioContext.createGain();
    
    // Make sure volume node is at unity gain (no volume change)
    this.volumeNode.gain.value = 1.0;
    
    // Simple pass-through connection - input to volume to output
    this.inputNode.connect(this.volumeNode);
    this.volumeNode.connect(this.outputNode);
    
    console.log('🎮 EQProcessor initialized with pass-through connection');
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
    console.log('🎮 EQProcessor.applyProfile called:', profile);
    this.currentProfile = profile;
    
    // For now, we're not applying any actual EQ, just storing the profile
    
    // Make sure volume is set to unity gain (no change)
    // Later we'll implement proper volume handling
    this.volumeNode!.gain.value = 1.0;
    
    console.log('🎮 Profile stored, but no EQ applied yet');
  }
  
  // Enable or disable the EQ
  public setEnabled(enabled: boolean): void {
    console.log('🎮 EQProcessor.setEnabled called:', enabled);
    this.isEnabled = enabled;
    
    // For now, just store the enabled state
    // Later we'll implement actual EQ bypass logic
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
    console.log('🎮 Creating new EQProcessor instance');
    eqProcessorInstance = new EQProcessor();
    
    // Initialize with the active profile from the store
    const eqStore = useEQProfileStore.getState();
    const activeProfile = eqStore.getActiveProfile();
    
    if (activeProfile) {
      console.log('🎮 Applying active profile from store');
      eqProcessorInstance.applyProfile(activeProfile);
    } else {
      // Create and apply a default profile
      console.log('🎮 No active profile, using default');
      const defaultProfile = eqProcessorInstance.createDefaultProfile();
      eqProcessorInstance.applyProfile(defaultProfile);
      
      // Save the default profile to the store
      eqStore.addProfile(defaultProfile);
      eqStore.setActiveProfile(defaultProfile.id);
    }
    
    // Set the enabled state based on the store
    eqProcessorInstance.setEnabled(eqStore.isEQEnabled);
    
    // Subscribe to changes in the EQ enabled state
    useEQProfileStore.subscribe(
      state => {
        if (eqProcessorInstance) {
          console.log('🎮 EQ enabled state changed:', state.isEQEnabled);
          eqProcessorInstance.setEnabled(state.isEQEnabled);
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