'use client';

import { ReactNode, useEffect } from 'react';
import { initializeAudio, cleanupAudio } from '@/lib/audio/initAudio';

interface AudioProviderProps {
  children: ReactNode;
}

/**
 * AudioProvider Component
 * 
 * Handles initialization and cleanup of the audio system for the entire application.
 * This should be placed high in the component tree, but after any required providers.
 */
export function AudioProvider({ children }: AudioProviderProps) {
  useEffect(() => {
    // Initialize audio system on component mount
    console.log('🔈 AudioProvider - Mounting and initializing audio system');
    
    try {
      initializeAudio();
    } catch (error) {
      console.error('🔈 AudioProvider - Failed to initialize audio system:', error);
      // Could show a toast notification here if critical
    }
    
    // Clean up audio system on component unmount
    return () => {
      console.log('🔈 AudioProvider - Unmounting and cleaning up audio system');
      cleanupAudio();
    };
  }, []);
  
  // Simply render children - this component only handles audio initialization
  return <>{children}</>;
}

export default AudioProvider; 