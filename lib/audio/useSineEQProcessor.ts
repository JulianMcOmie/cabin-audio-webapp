import { useState, useEffect } from 'react';
import { 
  getSineEQProcessor, 
  applyActiveProfile as applySineActiveProfile
} from './sineEqProcessor';
import { useSineProfileStore } from '../stores/sineProfileStore';
import { SineProfile } from '../models/SineProfile';

export function useSineEQProcessor() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [currentProfile, setCurrentProfile] = useState<SineProfile | null>(null);
  const { isSineEQEnabled, setSineEQEnabled, getActiveProfile } = useSineProfileStore();
  
  // Apply the current active profile from the store on mount
  useEffect(() => {
    const processor = getSineEQProcessor();
    
    // Initial sync with processor state
    setIsEnabled(processor.isProcessorEnabled());
    setCurrentProfile(processor.getCurrentProfile());
    
    // Apply active profile
    applySineActiveProfile().then(() => {
      // Update state after applying
      setIsEnabled(processor.isProcessorEnabled());
      setCurrentProfile(processor.getCurrentProfile());
    });
  }, []);
  
  // Keep processor in sync with store's enabled state
  useEffect(() => {
    const processor = getSineEQProcessor();
    
    // Only update if they're out of sync
    if (processor.isProcessorEnabled() !== isSineEQEnabled) {
      processor.setEnabled(isSineEQEnabled);
      setIsEnabled(isSineEQEnabled);
    }
  }, [isSineEQEnabled]);
  
  // Apply a specific profile
  const applyProfile = async (profile: SineProfile): Promise<void> => {
    const processor = getSineEQProcessor();
    await processor.applyProfile(profile);
    setCurrentProfile(profile);
  };
  
  // Apply the active profile from the store
  const applyActiveProfile = async (): Promise<void> => {
    await applySineActiveProfile();
    const processor = getSineEQProcessor();
    setCurrentProfile(processor.getCurrentProfile());
    setIsEnabled(processor.isProcessorEnabled());
  };
  
  // Set buffer size
  const setBufferSize = (size: number): void => {
    const processor = getSineEQProcessor();
    processor.setBufferSize(size);
  };
  
  // Enable/disable the processor
  const setEnabled = (enabled: boolean): void => {
    setSineEQEnabled(enabled);
    const processor = getSineEQProcessor();
    processor.setEnabled(enabled);
    setIsEnabled(enabled);
  };
  
  // Get audio nodes for connecting to the audio graph
  const getNodes = () => {
    const processor = getSineEQProcessor();
    return {
      inputNode: processor.getInputNode(),
      outputNode: processor.getOutputNode()
    };
  };
  
  return {
    isEnabled,
    currentProfile,
    applyProfile,
    applyActiveProfile,
    setEnabled,
    setBufferSize,
    getNodes
  };
} 