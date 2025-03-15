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
    console.log('🎮 EQProcessor.createFilterChain called with', profile.bands?.length || 0, 'bands');
    
    // If there are no bands, just ensure input is connected to volume node
    if (!profile.bands || profile.bands.length === 0) {
      // If we already have a direct connection, keep it
      if (this.filters.length === 0) {
        console.log('🎮 No bands in profile, maintaining direct connection');
        return;
      }
      
      // Otherwise, disconnect filters and create direct connection
      console.log('🎮 No bands in profile, creating direct connection');
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
        
        console.log('🎮 New filter chain connected');
      }
    } else {
      // Same number of bands, we can update existing filters
      console.log('🎮 Updating existing filters with smooth transitions');
      
      profile.bands.forEach((band, index) => {
        const filter = this.filters[index];
        
        // Smoothly transition to new frequency
        filter.frequency.linearRampToValueAtTime(band.frequency, currentTime + TRANSITION_TIME);
        
        // Smoothly transition to new Q
        filter.Q.linearRampToValueAtTime(band.q, currentTime + TRANSITION_TIME);
        
        // Smoothly transition to new gain (respecting enabled state)
        const targetGain = this.isEnabled ? band.gain : 0;
        filter.gain.linearRampToValueAtTime(targetGain, currentTime + TRANSITION_TIME);
        
        console.log(`🎮 Updated filter ${index} with smooth transition`);
      });
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
      
      console.log('🎮 Volume smoothly transitioning to', volumeGain, '(', profile.volume, 'dB)');
    }
  }
  
  // Enable or disable the EQ with smooth transition
  public setEnabled(enabled: boolean): void {
    console.log('🎮 EQProcessor.setEnabled called:', enabled);
    
    // Only process if there's an actual change
    if (this.isEnabled === enabled) {
      console.log('🎮 EQ already in requested state, no change needed');
      return;
    }
    
    this.isEnabled = enabled;
    
    // If we have a current profile and filters, smoothly transition them
    if (this.currentProfile && this.filters.length > 0) {
      const audioCtx = audioContext.getAudioContext();
      const currentTime = audioCtx.currentTime;
      const TRANSITION_TIME = 0.01; // 100ms for enable/disable
      
      console.log('🎮 Smoothly transitioning filters to', enabled ? 'enabled' : 'disabled', 'state');
      
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
  public updateBand(index: number, gain: number, frequency?: number, q?: number): void {
    if (index < this.filters.length && this.currentProfile) {
      const audioCtx = audioContext.getAudioContext();
      const currentTime = audioCtx.currentTime;
      const TRANSITION_TIME = 0.01; // 50ms
      
      const filter = this.filters[index];
      const targetGain = this.isEnabled ? gain : 0;
      
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
      
      console.log(`🎮 Smoothly updating filter ${index}: gain=${gain}${frequency ? ', freq='+frequency : ''}${q ? ', Q='+q : ''}`);
      
      // Update the profile in memory
      const updatedBands = [...this.currentProfile.bands];
      updatedBands[index] = {
        ...updatedBands[index],
        gain,
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
      
      console.log('🎮 Volume smoothly transitioning to', volumeGain, '(', volume, 'dB)');
      
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