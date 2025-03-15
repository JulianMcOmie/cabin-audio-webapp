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
  
  // Create the filter chain based on profile bands
  private createFilterChain(profile: EQProfile): void {
    console.log('🎮 EQProcessor.createFilterChain called with', profile.bands.length, 'bands');
    
    // Disconnect existing filters if any
    this.disconnectFilters();
    
    // Clear the filters array
    this.filters = [];
    
    // If there are no bands, just connect input directly to volume node
    if (!profile.bands || profile.bands.length === 0) {
      console.log('🎮 No bands in profile, using direct connection');
      this.inputNode!.connect(this.volumeNode!);
      return;
    }
    
    // Create filters for each band
    profile.bands.forEach((band, index) => {
      const filter = audioContext.getAudioContext().createBiquadFilter();
      filter.type = 'peaking'; // EQ bands are typically peaking filters
      filter.frequency.value = band.frequency;
      filter.gain.value = this.isEnabled ? band.gain : 0;
      filter.Q.value = band.q;
      
      this.filters.push(filter);
      console.log(`🎮 Created filter ${index}: freq=${band.frequency}, gain=${band.gain}, Q=${band.q}`);
    });
    
    // Connect the filter chain
    if (this.filters.length > 0) {
      // Input to first filter
      this.inputNode!.connect(this.filters[0]);
      
      // Connect filters in series
      for (let i = 0; i < this.filters.length - 1; i++) {
        this.filters[i].connect(this.filters[i + 1]);
      }
      
      // Last filter to volume node
      this.filters[this.filters.length - 1].connect(this.volumeNode!);
      
      console.log('🎮 Filter chain connected');
    } else {
      // Fallback direct connection if no filters were created
      this.inputNode!.connect(this.volumeNode!);
      console.log('🎮 No filters created, using direct connection');
    }
  }
  
  // Disconnect all filters from the chain
  private disconnectFilters(): void {
    console.log('🎮 EQProcessor.disconnectFilters called');
    
    // Disconnect input from first filter or volume node
    this.inputNode!.disconnect();
    
    // Disconnect all filters
    this.filters.forEach(filter => {
      filter.disconnect();
    });
    
    console.log('🎮 All filters disconnected');
  }
  
  // Apply an EQ profile to the filters
  public applyProfile(profile: EQProfile): void {
    console.log('🎮 EQProcessor.applyProfile called with profile:', profile.name);
    this.currentProfile = profile;
    
    // Create a new filter chain with this profile's bands
    this.createFilterChain(profile);
    
    // Set volume according to profile
    if (this.volumeNode) {
      // Convert from dB to linear gain if needed
      const volumeGain = this.isEnabled && profile.volume ? 
        Math.pow(10, profile.volume / 20) : 1.0;
      
      this.volumeNode.gain.value = volumeGain;
      console.log('🎮 Volume set to', volumeGain, '(', profile.volume, 'dB)');
    }
  }
  
  // Enable or disable the EQ
  public setEnabled(enabled: boolean): void {
    console.log('🎮 EQProcessor.setEnabled called:', enabled);
    
    // Only process if there's an actual change
    if (this.isEnabled === enabled) {
      console.log('🎮 EQ already in requested state, no change needed');
      return;
    }
    
    this.isEnabled = enabled;
    
    // If we have a profile, reapply it to update the filter gains
    if (this.currentProfile) {
      console.log('🎮 Reapplying profile with new enabled state');
      this.applyProfile(this.currentProfile);
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
    
    // Subscribe to changes in the store
    useEQProfileStore.subscribe(
      state => {
        if (!eqProcessorInstance) return;
        
        // Handle EQ enabled state changes
        if (eqProcessorInstance.isEQEnabled() !== state.isEQEnabled) {
          console.log('🎮 EQ enabled state changed:', state.isEQEnabled);
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
            console.log('🎮 Active profile changed or updated, applying new profile');
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