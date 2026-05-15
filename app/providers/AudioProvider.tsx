'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
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
  const pathname = usePathname();
  const isInitializedRef = useRef(false);

  useEffect(() => {
    const shouldSkipAudio = pathname?.startsWith('/hrtf');

    if (shouldSkipAudio) {
      if (isInitializedRef.current) {
        cleanupAudio();
        isInitializedRef.current = false;
      }
      return;
    }

    try {
      initializeAudio();
      isInitializedRef.current = true;
    } catch (error) {
      console.error('🔈 AudioProvider - Failed to initialize audio system:', error);
    }

    return () => {
      if (isInitializedRef.current) {
        cleanupAudio();
        isInitializedRef.current = false;
      }
    };
  }, [pathname]);

  return <>{children}</>;
}

export default AudioProvider;
