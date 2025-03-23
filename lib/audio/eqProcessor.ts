import * as audioContext from './audioContext';
import { EQProfile } from '../models/EQProfile';
// import { EQBand } from '../models/EQBand';
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
  
  // Create the filter chain based on profile bands
  private createFilterChain(profile: EQProfile): void {
    // If there are no bands, just ensure input is connected to volume node
    if (!profile.bands || profile.bands.length === 0) {
      // If we already have a direct connection, keep it
      if (this.filters.length === 0) {
        return;
      }
      
      // Otherwise, disconnect filters and create direct connection
      this.disconnectFilters();
      this.filters = [];
      this.inputNode!.connect(this.volumeNode!);
      return;
    }
    
    const audioCtx = audioContext.getAudioContext();
    const currentTime = audioCtx.currentTime;
    const TRANSITION_TIME = 0.05; // 50ms transition for smoothness
    
    // Check if we need to create new filters or can reuse existing ones
    if (this.filters.length !== profile.bands.length) {
      // Number of bands changed, we need to recreate the filter chain
      console.log('🎮 Number of bands changed, recreating filter chain');
      
      // Disconnect existing filters
      this.disconnectFilters();
      
      // Clear the filters array
      this.filters = [];
      
      // Create new filters for each band
      profile.bands.forEach((band, index) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = band.frequency;
        filter.Q.value = band.q;
        
        // Set gain with immediate value but prepare for ramping in future changes
        filter.gain.value = this.isEnabled ? band.gain : 0;
        this.filters.push(filter);
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
        
      }
    } else {
      // Same number of bands, we can update existing filters
      
      profile.bands.forEach((band, index) => {
        const filter = this.filters[index];
        
        // Smoothly transition to new frequency
        filter.frequency.linearRampToValueAtTime(band.frequency, currentTime + TRANSITION_TIME);
        
        // Smoothly transition to new Q
        filter.Q.linearRampToValueAtTime(band.q, currentTime + TRANSITION_TIME);
        
        // Smoothly transition to new gain (respecting enabled state)
        const targetGain = this.isEnabled ? band.gain : 0;
        filter.gain.linearRampToValueAtTime(targetGain, currentTime + TRANSITION_TIME);
      });
    }
  }
  
  // Disconnect all filters from the chain
  private disconnectFilters(): void {
    // Disconnect input from first filter or volume node
    this.inputNode!.disconnect();
    
    // Disconnect all filters
    this.filters.forEach(filter => {
      filter.disconnect();
    });
    
  }
  
  // Apply an EQ profile to the filters
  public applyProfile(profile: EQProfile): void {
    this.currentProfile = profile;
    
    // Create or update the filter chain with this profile's bands
    this.createFilterChain(profile);
    
    // Set volume according to profile with smooth transition
    if (this.volumeNode) {
      const audioCtx = audioContext.getAudioContext();
      const TRANSITION_TIME = 0.05; // 50ms
      
      // Convert from dB to linear gain if needed
      const volumeGain = this.isEnabled && profile.volume ? 
        Math.pow(10, profile.volume / 20) : 1.0;
      
      // Smoothly transition to new volume
      this.volumeNode.gain.linearRampToValueAtTime(
        volumeGain, 
        audioCtx.currentTime + TRANSITION_TIME
      );
    }
  }
  
  // Enable or disable the EQ with smooth transition
  public setEnabled(enabled: boolean): void {

    // Only process if there's an actual change
    if (this.isEnabled === enabled) {
      return;
    }
    
    this.isEnabled = enabled;
    
    // If we have a current profile and filters, smoothly transition them
    if (this.currentProfile && this.filters.length > 0) {
      const audioCtx = audioContext.getAudioContext();
      const currentTime = audioCtx.currentTime;
      const TRANSITION_TIME = 0.01; // 100ms for enable/disable
      
      
      // For each filter, smoothly transition its gain to the target value
      this.currentProfile.bands.forEach((band, index) => {
        if (index < this.filters.length) {
          const filter = this.filters[index];
          const targetGain = enabled ? band.gain : 0;
          
          // Start transition from current value to target
          filter.gain.linearRampToValueAtTime(targetGain, currentTime + TRANSITION_TIME);
        }
      });
      
      // Also smoothly transition volume if needed
      if (this.volumeNode && this.currentProfile.volume) {
        const volumeGain = enabled ? 
          Math.pow(10, this.currentProfile.volume / 20) : 1.0;
        
        this.volumeNode.gain.linearRampToValueAtTime(
          volumeGain, 
          currentTime + TRANSITION_TIME
        );
      }
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
  
  // Update a single band with smooth transition
  public updateBand(indexOrBand: number | import('../models/EQBand').EQBand, gain?: number, frequency?: number, q?: number): void {
    // If we're passed an EQBand object
    if (typeof indexOrBand === 'object') {
      const band = indexOrBand;
      
      // First, check if we already have a filter at this frequency
      const existingFilterIndex = this.findBandIndexByFrequency(band.frequency);
      
      if (existingFilterIndex !== -1) {
        // Update existing filter
        this.updateBand(existingFilterIndex, band.gain, band.frequency, band.q);
      } else {
        // Create a new filter for this frequency
        if (this.inputNode && this.volumeNode) {
          const audioCtx = audioContext.getAudioContext();
          const filter = audioCtx.createBiquadFilter();
          filter.type = band.type || 'peaking';
          filter.frequency.value = band.frequency;
          filter.gain.value = this.isEnabled ? band.gain : 0;
          filter.Q.value = band.q;
          
          // Add to filters array
          this.filters.push(filter);
          
          // Reconstruct the filter chain
          this.disconnectFilters();
          
          // Connect everything in sequence
          let prevNode: AudioNode = this.inputNode;
          for (const filter of this.filters) {
            prevNode.connect(filter);
            prevNode = filter;
          }
          prevNode.connect(this.volumeNode);
        }
      }
      
      return;
    }
    
    // Regular index-based update (original implementation)
    const index = indexOrBand as number;
    if (index < this.filters.length && this.currentProfile) {
      const audioCtx = audioContext.getAudioContext();
      const currentTime = audioCtx.currentTime;
      const TRANSITION_TIME = 0.01; // 10ms
      
      const filter = this.filters[index];
      const targetGain = this.isEnabled ? gain! : 0;
      
      // Smoothly transition to new gain
      filter.gain.linearRampToValueAtTime(targetGain, currentTime + TRANSITION_TIME);
      
      // Optionally update frequency
      if (frequency !== undefined) {
        filter.frequency.linearRampToValueAtTime(frequency, currentTime + TRANSITION_TIME);
      }
      
      // Optionally update Q
      if (q !== undefined) {
        filter.Q.linearRampToValueAtTime(q, currentTime + TRANSITION_TIME);
      }
      
      // Update the profile in memory
      if (this.currentProfile && this.currentProfile.bands) {
        const updatedBands = [...this.currentProfile.bands];
        if (updatedBands[index]) {
          updatedBands[index] = {
            ...updatedBands[index],
            gain: gain!,
            ...(frequency !== undefined && { frequency }),
            ...(q !== undefined && { q })
          };
          
          this.currentProfile = {
            ...this.currentProfile,
            bands: updatedBands,
            lastModified: Date.now()
          };
        }
      }
    }
  }
  
  // Find the index of a filter by frequency
  public findBandIndexByFrequency(frequency: number, tolerance: number = 0.001): number {
    for (let i = 0; i < this.filters.length; i++) {
      // Compare with some tolerance for floating point
      if (Math.abs(this.filters[i].frequency.value - frequency) <= tolerance) {
        return i;
      }
    }
    return -1;
  }
  
  // Remove a filter by frequency
  public removeBandByFrequency(frequency: number): boolean {
    const index = this.findBandIndexByFrequency(frequency);
    if (index !== -1) {
      // Remove from the filters array
      this.filters.splice(index, 1);
      
      // Reconstruct the filter chain
      this.disconnectFilters();
      
      // If we still have filters, reconnect them
      if (this.filters.length > 0 && this.inputNode && this.volumeNode) {
        let prevNode: AudioNode = this.inputNode;
        for (const filter of this.filters) {
          prevNode.connect(filter);
          prevNode = filter;
        }
        prevNode.connect(this.volumeNode);
      } else if (this.inputNode && this.volumeNode) {
        // Direct connection if no filters
        this.inputNode.connect(this.volumeNode);
      }
      
      return true;
    }
    return false;
  }
  
  // Update volume with smooth transition
  public updateVolume(volume: number): void {
    if (this.volumeNode && this.currentProfile) {
      const audioCtx = audioContext.getAudioContext();
      const currentTime = audioCtx.currentTime;
      const TRANSITION_TIME = 0.05; // 50ms
      
      // Convert from dB to linear gain
      const volumeGain = this.isEnabled ? 
        Math.pow(10, volume / 20) : 1.0;
      
      // Smoothly transition to new volume
      this.volumeNode.gain.linearRampToValueAtTime(
        volumeGain, 
        currentTime + TRANSITION_TIME
      );
      
    
      // Update the profile in memory
      this.currentProfile = {
        ...this.currentProfile,
        volume,
        lastModified: Date.now()
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