"use client"

import { useState, useEffect, useCallback } from "react"
import { v4 as uuidv4 } from 'uuid'
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Progress } from "@/components/ui/progress"
import { ReferenceCalibration } from "@/components/reference-calibration"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { getReferenceCalibrationAudio } from "@/lib/audio/referenceCalibrationAudio"
import { EQBand } from "@/lib/models/EQBand"
import { AlertCircle, ArrowLeft, ArrowRight, Check, Play, RefreshCw, ThumbsUp } from "lucide-react"
import * as eqProcessor from "@/lib/audio/eqProcessor"

// Define the center frequency and total number of bands
const CENTER_FREQ = 1000; // Middle frequency (1kHz)
const TOTAL_BANDS = 21; // Total number of bands to create
const BANDS_PER_DIRECTION = Math.floor(TOTAL_BANDS / 2); // Number of bands in each direction (up/down)

// Use a single small bandwidth for all bands
const BAND_BANDWIDTH = 0.5; // Half-octave bandwidth
const BASE_Q = 1.0; // Default Q factor (higher = narrower bandwidth)

// Generate all frequencies from middle, going up, then down
function generateCalibrationFrequencies(): number[] {
  const frequencies: number[] = [CENTER_FREQ]; // Start with the center frequency
  
  // Calculate the octave step size - how much to go up/down per step
  // To cover roughly 20Hz to 20kHz in BANDS_PER_DIRECTION steps in each direction
  const octaveRange = Math.log2(20000 / 20); // ~10 octaves from 20Hz to 20kHz
  const octaveStep = octaveRange / (BANDS_PER_DIRECTION * 1.5); // Divide the range into steps
  
  // Generate frequencies going up from center
  let currentFreq = CENTER_FREQ;
  for (let i = 0; i < BANDS_PER_DIRECTION; i++) {
    currentFreq = currentFreq * Math.pow(2, octaveStep); // Multiply by 2^step to go up by octaveStep octaves
    frequencies.push(Math.round(currentFreq));
  }
  
  // Generate frequencies going down from center (excluding center which is already added)
  currentFreq = CENTER_FREQ;
  for (let i = 0; i < BANDS_PER_DIRECTION; i++) {
    currentFreq = currentFreq / Math.pow(2, octaveStep); // Divide by 2^step to go down by octaveStep octaves
    frequencies.push(Math.round(currentFreq));
  }
  
  // Sort frequencies from low to high for display purposes
  return frequencies.sort((a, b) => a - b);
}

const DEFAULT_GAIN = 0; // Default gain in dB (0 = neutral)

interface EQCalibrationProcessProps {
  onComplete: () => void;
  onCancel: () => void;
}

export function EQCalibrationProcess({ onComplete, onCancel }: EQCalibrationProcessProps) {
  // Get access to the EQ profile store
  const { getActiveProfile, updateProfile } = useEQProfileStore();
  
  // Current step in the calibration process
  const [currentStep, setCurrentStep] = useState(0);
  
  // All frequencies for calibration
  const [calibrationFrequencies, setCalibrationFrequencies] = useState<number[]>([]);
  
  // Direction of calibration (0 = center, 1 = going up, 2 = going down)
  const [calibrationDirection, setCalibrationDirection] = useState(0);
  
  // Current gain for the band being adjusted
  const [currentGain, setCurrentGain] = useState(DEFAULT_GAIN);
  
  // All bands created during the calibration
  const [calibratedBands, setCalibratedBands] = useState<EQBand[]>([]);
  
  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Reference to the current active profile
  const [activeProfile, setActiveProfile] = useState(getActiveProfile());
  
  // Track if the calibration is complete
  const [isComplete, setIsComplete] = useState(false);
  
  // Track how many bands were created
  const [bandCount, setBandCount] = useState(0);
  
  // Initialize all frequencies at component mount
  useEffect(() => {
    const frequencies = generateCalibrationFrequencies();
    setCalibrationFrequencies(frequencies);
    console.log("Calibration frequencies:", frequencies);
  }, []);
  
  // Get the current frequency to calibrate
  const currentFrequency = calibrationFrequencies[currentStep] || CENTER_FREQ;
  
  // Calculate overall progress percentage
  const calculateProgress = () => {
    return Math.round((currentStep / calibrationFrequencies.length) * 100);
  };
  
  // Update the reference calibration audio when the current frequency changes
  useEffect(() => {
    const audioPlayer = getReferenceCalibrationAudio();
    audioPlayer.setCalibrationFrequency(currentFrequency);
  }, [currentFrequency]);
  
  // Control audio playback
  useEffect(() => {
    const audioPlayer = getReferenceCalibrationAudio();
    audioPlayer.setPlaying(isPlaying);
    
    return () => {
      // Clean up on unmount
      audioPlayer.setPlaying(false);
    }
  }, [isPlaying]);
  
  // Refresh the active profile reference
  useEffect(() => {
    setActiveProfile(getActiveProfile());
  }, [getActiveProfile]);
  
  // Create a new band for the current frequency
  const createBandForCurrentFrequency = useCallback(() => {
    const newBand: EQBand = {
      id: uuidv4(),
      frequency: currentFrequency,
      gain: currentGain,
      q: BASE_Q / BAND_BANDWIDTH, // Q is inverse of bandwidth
      type: 'peaking'
    };
    
    return newBand;
  }, [currentFrequency, currentGain]);
  
  // Add a new useEffect to apply all calibrated bands to the EQ processor
  useEffect(() => {
    // Apply all previously calibrated bands to the EQ
    const eq = eqProcessor.getEQProcessor();
    
    // First, clear any bands that might be at frequencies we're calibrating
    calibratedBands.forEach(band => {
      eq.removeBandByFrequency(band.frequency);
    });
    
    // Then apply all calibrated bands so far
    calibratedBands.forEach(band => {
      eq.updateBand(band);
    });
    
    // Clean up function to remove all bands when component unmounts
    return () => {
      calibratedBands.forEach(band => {
        eq.removeBandByFrequency(band.frequency);
      });
    };
  }, [calibratedBands]);
  
  // Apply current band to EQ processor
  useEffect(() => {
    // Dynamically update the EQ processor for immediate feedback
    const eq = eqProcessor.getEQProcessor();
    
    // Create a temporary band for the current frequency
    const tempBand = createBandForCurrentFrequency();
    
    // Only add current frequency band if it's not already in calibratedBands
    const existingBand = calibratedBands.find(band => band.frequency === currentFrequency);
    if (!existingBand) {
      // Apply it to the EQ processor (this doesn't save to the profile)
      eq.updateBand(tempBand);
    }
    
    // Clean up function to remove only the temporary band
    return () => {
      // Only remove the current frequency if it's not in our calibrated set
      if (currentFrequency && !calibratedBands.some(band => band.frequency === currentFrequency)) {
        eq.removeBandByFrequency(currentFrequency);
      }
    };
  }, [createBandForCurrentFrequency, currentFrequency, currentGain, calibratedBands]);
  
  // Move to the next step
  const handleNextStep = () => {
    // Create a band for the current frequency
    const newBand = createBandForCurrentFrequency();
    
    // Add it to our accumulated bands
    const updatedBands = [...calibratedBands, newBand];
    setCalibratedBands(updatedBands);
    
    // Check if we're at the end of calibration
    if (currentStep < calibrationFrequencies.length - 1) {
      // Move to the next frequency
      setCurrentStep(currentStep + 1);
      setCurrentGain(DEFAULT_GAIN); // Reset gain for new frequency
    } else {
      // We've completed all frequencies - calibration is done
      completeCalibration(updatedBands);
    }
  };
  
  // Move to the previous step
  const handlePrevStep = () => {
    if (currentStep > 0) {
      // Remove the last band
      const updatedBands = [...calibratedBands];
      updatedBands.pop();
      setCalibratedBands(updatedBands);
      
      // Move to the previous step
      setCurrentStep(currentStep - 1);
      
      // Set the gain to match the previous band's gain
      if (updatedBands.length > 0) {
        const prevBand = updatedBands[updatedBands.length - 1];
        setCurrentGain(prevBand.gain);
      } else {
        setCurrentGain(DEFAULT_GAIN);
      }
    }
  };
  
  // Complete the calibration and save the profile
  const completeCalibration = (bands: EQBand[]) => {
    if (activeProfile) {
      // Get the existing bands from the active profile
      const existingBands = [...(activeProfile.bands || [])];
      
      // Filter out any existing bands that match our calibration frequencies
      // to avoid duplicates at the same frequencies
      const calibrationFrequencies = new Set(bands.map(band => band.frequency));
      const filteredExistingBands = existingBands.filter(
        band => !calibrationFrequencies.has(band.frequency)
      );
      
      // Combine filtered existing bands with our new calibrated bands
      const combinedBands = [...filteredExistingBands, ...bands];
      
      // Sort bands by frequency (low to high) for better visualization
      combinedBands.sort((a, b) => a.frequency - b.frequency);
      
      // Update the active profile with the combined bands
      updateProfile(activeProfile.id, { 
        bands: combinedBands,
        lastModified: Date.now()
      });
      
      // Save how many bands we added
      setBandCount(bands.length);
      
      // Show the completion screen
      setIsComplete(true);
      
      // Stop audio playback
      setIsPlaying(false);
    }
  };
  
  // Format frequency for display
  const formatFrequency = (freq: number) => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1)}kHz`;
    }
    return `${freq}Hz`;
  };
  
  // Format gain for display
  const formatGain = (gain: number) => {
    const sign = gain > 0 ? '+' : '';
    return `${sign}${gain.toFixed(1)} dB`;
  };
  
  // Render the completion screen
  if (isComplete) {
    return (
      <div className="space-y-6 p-8 max-w-3xl mx-auto text-center">
        <div className="flex flex-col items-center justify-center py-8">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <ThumbsUp className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-2xl font-semibold">Calibration Complete!</h3>
          <p className="text-muted-foreground mt-2">
            Your EQ has been personalized with {bandCount} calibrated frequency bands.
          </p>
        </div>
        
        <div className="bg-muted/50 p-4 rounded-lg mb-6">
          <h4 className="font-medium mb-2">What We Did</h4>
          <p className="text-sm text-muted-foreground">
            We've carefully adjusted {bandCount} frequency bands across the audible spectrum to optimize your audio experience.
            These adjustments were made based on your preferences for each frequency.
          </p>
          
          <h4 className="font-medium mt-4 mb-2">What's Next</h4>
          <p className="text-sm text-muted-foreground">
            Your calibrated EQ profile is now active. You can:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-sm text-muted-foreground text-left">
            <li>Use your audio system with this personalized EQ</li>
            <li>Fine-tune specific frequencies using the main EQ interface</li>
            <li>Create additional EQ profiles for different scenarios</li>
          </ul>
        </div>
        
        <Button 
          className="bg-electric-blue hover:bg-electric-blue/90 text-white"
          onClick={onComplete}
        >
          Return to EQ
        </Button>
      </div>
    );
  }
  
  // Regular calibration UI
  return (
    <div className="space-y-6 p-4 max-w-3xl mx-auto">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">EQ Calibration</h3>
        <p className="text-sm text-muted-foreground">
          Adjust the volume slider until the sound at this frequency matches your desired level.
        </p>
      </div>
      
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-1/2 space-y-5">
          <div className="text-center">
            <h4 className="text-xl font-semibold">{formatFrequency(currentFrequency)}</h4>
            <p className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {calibrationFrequencies.length}
            </p>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span>Overall Progress</span>
              <span>{calculateProgress()}%</span>
            </div>
            <Progress value={calculateProgress()} className="h-2" />
          </div>
          
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Volume Adjustment</span>
                <span className="text-sm font-medium">{formatGain(currentGain)}</span>
              </div>
              
              <Slider
                value={[currentGain]}
                min={-12}
                max={12}
                step={0.5}
                onValueChange={(values) => setCurrentGain(values[0])}
                className="w-full"
              />
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Cut</span>
                <span>Neutral</span>
                <span>Boost</span>
              </div>
            </div>
            
            <div className="flex justify-center">
              <Button
                variant={isPlaying ? "secondary" : "default"}
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-32"
              >
                <Play className={`h-4 w-4 mr-2 ${isPlaying ? "text-green-500" : ""}`} />
                {isPlaying ? "Stop" : "Play"}
              </Button>
            </div>
            
            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={isPlaying}
              >
                Cancel
              </Button>
              
              <div className="space-x-2">
                <Button
                  variant="outline"
                  onClick={handlePrevStep}
                  disabled={currentStep === 0 || isPlaying}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                
                <Button
                  onClick={handleNextStep}
                >
                  {currentStep === calibrationFrequencies.length - 1 ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Complete
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="md:w-1/2">
          <div className="bg-muted/50 p-4 rounded-lg">
            <div className="mb-4">
              <h4 className="font-medium mb-2">Audio Calibration</h4>
              <p className="text-sm text-muted-foreground">
                Listen to the reference and calibration sounds to adjust this frequency band.
              </p>
            </div>
            
            <div className="mb-3">
              <ReferenceCalibration
                isPlaying={isPlaying}
                disabled={false}
              />
            </div>
            
            <div className="mt-4 text-sm bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 p-3 rounded-md flex items-start">
              <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
              <div>
                <p className="mb-1">
                  <strong>Current Frequency:</strong> {formatFrequency(currentFrequency)}
                </p>
                <p>
                  Adjust this frequency until it sounds balanced with the reference tone.
                  We'll create {TOTAL_BANDS} bands across the full frequency spectrum.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 