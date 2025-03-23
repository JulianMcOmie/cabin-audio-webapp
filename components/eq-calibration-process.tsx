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

// Generate the calibration frequency steps
// Start at 1000Hz, go up to 20000Hz, then go down from 1000Hz to 20Hz
function generateCalibrationSteps(): number[] {
  const steps: number[] = [];
  
  // Starting point
  steps.push(1000);
  
  // Go up from 1000Hz to 20000Hz
  // Use logarithmic spacing for perceptual accuracy
  const upSteps = [
    1500, 2000, 3000, 4000, 6000, 8000, 12000, 16000, 20000
  ];
  steps.push(...upSteps);
  
  // Go down from 1000Hz to 20Hz
  const downSteps = [
    750, 500, 350, 250, 175, 125, 80, 60, 40, 30, 20
  ];
  steps.push(...downSteps);
  
  return steps;
}

const CALIBRATION_STEPS = generateCalibrationSteps();
const DEFAULT_Q = 2.0; // Q factor for each band
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
  
  // Current gain for the band being adjusted
  const [currentGain, setCurrentGain] = useState(DEFAULT_GAIN);
  
  // All bands created during the calibration
  const [calibratedBands, setCalibratedBands] = useState<EQBand[]>([]);
  
  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Reference to the current active profile
  const [activeProfile, setActiveProfile] = useState(getActiveProfile());
  
  // Calculate progress percentage
  const progress = Math.round((currentStep / CALIBRATION_STEPS.length) * 100);
  
  // Get the current frequency to calibrate
  const currentFrequency = CALIBRATION_STEPS[currentStep];
  
  // Track if the calibration is complete
  const [isComplete, setIsComplete] = useState(false);
  
  // Track how many bands were created
  const [bandCount, setBandCount] = useState(0);
  
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
      q: DEFAULT_Q,
      type: 'peaking'
    };
    
    return newBand;
  }, [currentFrequency, currentGain]);
  
  // Apply EQ changes immediately when slider changes
  useEffect(() => {
    // Dynamically update the EQ processor for immediate feedback
    const eq = eqProcessor.getEQProcessor();
    
    // Create a temporary band for the current frequency
    const tempBand = createBandForCurrentFrequency();
    
    // Apply it to the EQ processor (this doesn't save to the profile)
    eq.updateBand(tempBand);
    
    // Clean up function to remove the temp band when component unmounts
    return () => {
      if (currentFrequency) {
        // Find and remove this frequency from the EQ processor
        eq.removeBandByFrequency(currentFrequency);
      }
    };
  }, [createBandForCurrentFrequency, currentFrequency, currentGain]);
  
  // Update the accumulated bands and move to the next step
  const handleNextStep = () => {
    // Create a band for the current frequency
    const newBand = createBandForCurrentFrequency();
    
    // Add it to our accumulated bands
    const updatedBands = [...calibratedBands, newBand];
    setCalibratedBands(updatedBands);
    
    // If we're at the last step, complete the calibration
    if (currentStep === CALIBRATION_STEPS.length - 1) {
      completeCalibration(updatedBands);
    } else {
      // Move to the next step
      setCurrentStep(currentStep + 1);
      // Reset gain to default
      setCurrentGain(DEFAULT_GAIN);
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
            We've carefully adjusted multiple frequency bands to optimize your audio experience.
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
        <h3 className="text-lg font-medium">EQ Calibration Process</h3>
        <p className="text-sm text-muted-foreground">
          Adjust the volume slider until the sound at this frequency matches your desired level.
        </p>
      </div>
      
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-1/2 space-y-5">
          <div className="text-center">
            <h4 className="text-xl font-semibold">{formatFrequency(currentFrequency)}</h4>
            <p className="text-sm text-muted-foreground">
              {currentStep + 1} of {CALIBRATION_STEPS.length}
            </p>
          </div>
          
          <div className="py-4">
            <Progress value={progress} className="h-2" />
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
                  {currentStep === CALIBRATION_STEPS.length - 1 ? (
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
                <strong>Tip:</strong> The reference row (dashed line) plays at 800Hz without EQ.
                Compare it to your current frequency ({formatFrequency(currentFrequency)}) to ensure balanced sound.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 