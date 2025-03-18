/**
 * Audio Initialization Module
 * 
 * This module provides functions to initialize and clean up the audio system.
 * It should be called once at application startup from a top-level component.
 */

import * as audioContext from './audioContext';
import * as audioPlayer from './audioPlayer';
// import * as eqProcessor from './eqProcessor';
import * as audioRouting from './audioRouting';

// Flag to track initialization state
let isInitialized = false;

/**
 * Initialize the complete audio system
 * This should be called once at application startup
 */
export const initializeAudio = (): void => {
  console.log('🔈 Initializing audio system');
  
  if (isInitialized) {
    console.log('🔈 Audio system already initialized, skipping');
    return;
  }
  
  try {
    // Initialize components in the correct order
    console.log('🔈 Initializing audio context');
    audioContext.getAudioContext(); // Initialize audio context
    
    // console.log('🔈 Initializing EQ processor');
    // eqProcessor.initializeEQProcessor();
    
    console.log('🔈 Initializing audio routing');
    audioRouting.initializeAudioRouting();
    
    console.log('🔈 Initializing audio player');
    // Initialize audio player without subscription to player store
    audioPlayer.initializeAudioPlayer();
    
    // Set initialization flag
    isInitialized = true;
    console.log('🔈 Audio system initialization complete');
  } catch (error) {
    console.error('🔈 Error initializing audio system:', error);
    throw new Error(`Failed to initialize audio system: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Clean up the audio system
 * This should be called when the application is unmounted or closed
 */
export const cleanupAudio = (): void => {
  console.log('🔈 Cleaning up audio system');
  
  if (!isInitialized) {
    console.log('🔈 Audio system not initialized, nothing to clean up');
    return;
  }
  
  try {
    // Clean up in reverse order
    console.log('🔈 Cleaning up audio player');
    audioPlayer.cleanupAudioPlayer();
    
    console.log('🔈 Cleaning up audio routing');
    audioRouting.cleanupAudioRouting();
    
    console.log('🔈 Suspending audio context');
    audioContext.suspendAudioContext();
    
    // Reset initialization flag
    isInitialized = false;
    console.log('🔈 Audio system cleanup complete');
  } catch (error) {
    console.error('🔈 Error during audio system cleanup:', error);
  }
};

/**
 * Check if the audio system is initialized
 */
export const isAudioInitialized = (): boolean => {
  return isInitialized;
};

// Export audio components for direct access
export { getAudioContext } from './audioContext';
export { getAudioPlayer } from './audioPlayer';
export { getEQProcessor } from './eqProcessor';
export { getAudioRouting } from './audioRouting';