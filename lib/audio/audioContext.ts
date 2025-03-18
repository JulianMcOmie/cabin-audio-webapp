// Singleton AudioContext for the application
let audioContext: AudioContext | null = null;

// Get or create the AudioContext
export const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    // Create a new AudioContext
    audioContext = new (window.AudioContext || (window as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  
  return audioContext;
};

// Resume the AudioContext (needed due to autoplay policy in browsers)
export const resumeAudioContext = async (): Promise<void> => {
  const ctx = getAudioContext();
  
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
};

// Suspend the AudioContext to save resources when not in use
export const suspendAudioContext = async (): Promise<void> => {
  if (audioContext && audioContext.state === 'running') {
    await audioContext.suspend();
  }
};

// Close the AudioContext when the app is being unloaded
export const closeAudioContext = (): void => {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
};

// Get the current state of the AudioContext
export const getAudioContextState = (): AudioContextState | null => {
  return audioContext ? audioContext.state : null;
};

// Check if the browser supports the Web Audio API
export const isWebAudioSupported = (): boolean => {
  return !!(window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
};

// Get the current sample rate of the AudioContext
export const getSampleRate = (): number => {
  return getAudioContext().sampleRate;
};

// Create a buffer source node
export const createBufferSource = (): AudioBufferSourceNode => {
  return getAudioContext().createBufferSource();
};

// Create a gain node
export const createGain = (): GainNode => {
  return getAudioContext().createGain();
};

// Create a biquad filter node
export const createBiquadFilter = (): BiquadFilterNode => {
  return getAudioContext().createBiquadFilter();
};

// Create an analyser node
export const createAnalyser = (): AnalyserNode => {
  return getAudioContext().createAnalyser();
};

// Decode audio data from an ArrayBuffer
export const decodeAudioData = async (audioData: ArrayBuffer): Promise<AudioBuffer> => {
  return getAudioContext().decodeAudioData(audioData);
};

// Get the current time of the AudioContext (used for scheduling)
export const getCurrentTime = (): number => {
  return getAudioContext().currentTime;
}; 