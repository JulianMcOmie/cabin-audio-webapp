/**
 * Audio Initialization Module
 * 
 * This module provides functions to initialize and clean up the audio system.
 * It should be called once at application startup from a top-level component.
 */

import * as audioContext from './audioContext';
import * as audioPlayer from './audioPlayer';
import * as audioRouting from './audioRouting';
import * as eqProcessor from './eqProcessor';
import * as sineEqProcessor from './sineEqProcessor';

// Flag to track initialization state
let isInitialized = false;

/**
 * Initialize the complete audio system
 * This should be called once at application startup
 */
export const initializeAudio = (): void => {
  if (isInitialized) {
    return; 
  }
  
  try {
    // Initialize components in the correct order
    audioContext.getAudioContext(); // Initialize audio context
    
    // eqProcessor is a singleton, so it will be initialized automatically
    // Same for sineEqProcessor

    audioRouting.initializeAudioRouting();
    
    // Initialize audio player without subscription to player store
    audioPlayer.initializeAudioPlayer();
    
    // Set initialization flag
    isInitialized = true;
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
  if (!isInitialized) {
    return;
  }
  
  try {
    // Clean up in reverse order
    audioPlayer.cleanupAudioPlayer();
    audioRouting.cleanupAudioRouting();
    
    // Reset processors
    eqProcessor.resetEQProcessor();
    sineEqProcessor.resetSineEQProcessor();
    
    // Suspend audio context
    audioContext.suspendAudioContext();
    
    // Reset initialization flag
    isInitialized = false;
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