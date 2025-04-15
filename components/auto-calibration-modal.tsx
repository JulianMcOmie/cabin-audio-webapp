import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { AutoCalibration, CalibrationStep } from "@/lib/calibration/AutoCalibration";
import { getAutoCalibrationAudioPlayer } from "@/lib/audio/autoCalibrationAudio"; // Import the audio player
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"; // Import the store
import { EQBand } from "@/lib/models/EQBand"; // Import EQBand type
import { v4 as uuidv4 } from 'uuid'; // For generating band IDs

interface AutoCalibrationModalProps {
  open: boolean;
  onClose: () => void;
  // Removed props that are now handled by the store hook
}

export function AutoCalibrationModal({ open, onClose }: AutoCalibrationModalProps) {
  const [calibration] = useState(() => new AutoCalibration());
  const [currentStep, setCurrentStep] = useState<CalibrationStep | null>(null);
  const [currentValue, setCurrentValue] = useState<number>(0);
  const audioPlayer = getAutoCalibrationAudioPlayer(); // Get the audio player instance
  const newBandIdRef = useRef<string | null>(null); // Ref to store the ID of a newly created band for the current step

  // Access the EQ profile store
  const { getActiveProfile, updateProfile } = useEQProfileStore(); // Removed addBand

  // Effect for modal open/close and initial step setup
  useEffect(() => {
    if (open) {
      calibration.reset();
      newBandIdRef.current = null;
      const step = calibration.getCurrentStep();
      // Set the first step - the effect below will handle initial band creation
      setCurrentStep(step);
      if (step) {
        // Set initial slider value for the first step
        const initialVal = step.initialValue ?? (step.controlRange[0] + step.controlRange[1]) / 2;
        setCurrentValue(initialVal);
        audioPlayer.startNoiseSources(step.noiseSources);
        console.log("Starting step:", step);
      } else {
         console.warn("AutoCalibration: No calibration steps found.");
         audioPlayer.stopNoiseSources();
      }
    } else {
      audioPlayer.stopNoiseSources();
      console.log("Closing calibration modal, stopping audio.");
    }

    // Cleanup function for modal close
    return () => {
      if (!open) { // Only stop audio if modal is actually closing
         audioPlayer.stopNoiseSources();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, calibration]); // Only run when modal open state changes

  // Effect for handling initial band creation when the step changes
  useEffect(() => {
    // Only run if the modal is open and we have a valid current step
    if (open && currentStep) {
      // Check if the *current* step requires creating a new band 
      // and we haven't created one for this step instance yet (using newBandIdRef)
      if (currentStep.targetBandIndex === 'new' && !newBandIdRef.current) {
        // Use the current step's initial value for the slider
        const initialVal = currentStep.initialValue ?? (currentStep.controlRange[0] + currentStep.controlRange[1]) / 2;
        // Trigger band creation using the confirmed current step data
        console.log(`useEffect[currentStep]: Triggering initial band creation for Step ID = ${currentStep.id}`);
        handleValueChange([initialVal], true);
      }
    }
  // Trigger this effect when the currentStep changes *after* the modal is open
  }, [open, currentStep]); 

  const handleNextStep = () => {
    audioPlayer.stopNoiseSources();
    newBandIdRef.current = null;

    const hasNext = calibration.nextStep();
    if (hasNext) {
      const nextStep = calibration.getCurrentStep();
      // Set the state for the next step
      setCurrentStep(nextStep);
      if (nextStep) {
        // Set the slider value for the next step
        const initialVal = nextStep.initialValue ?? (nextStep.controlRange[0] + nextStep.controlRange[1]) / 2;
        setCurrentValue(initialVal);
        // Start audio for the next step
        audioPlayer.startNoiseSources(nextStep.noiseSources);
        console.log("Moving to next step:", nextStep);
      }
    } else {
      console.log("Auto-calibration finished.");
      onClose();
    }
  };

  const handleValueChange = (value: number[], isInitialSetup = false) => {
    const newValue = value[0];
    setCurrentValue(newValue);

    if (!currentStep) return;

    // --- DEBUG LOGGING START ---
    console.log(`handleValueChange: Step ID = ${currentStep.id}, isInitialSetup = ${isInitialSetup}`);
    console.log(`  > ParameterToControl: ${currentStep.parameterToControl}`);
    console.log(`  > NewValue (from slider/initial): ${newValue}`);
    console.log(`  > TargetBandIndex: ${currentStep.targetBandIndex}`);
    // --- DEBUG LOGGING END ---

    const activeProfile = getActiveProfile();
    if (!activeProfile) {
      console.error("AutoCalibrationModal: No active profile found.");
      return;
    }

    let targetBandId: string | null = null;
    let bandIndex: number | null = null;
    let profileNeedsUpdate = false;
    let updatedBands = [...activeProfile.bands]; // Start with current bands

    if (currentStep.targetBandIndex === 'new') {
        if (newBandIdRef.current) {
            // Use the ID of the band created earlier in this step
            targetBandId = newBandIdRef.current;
            bandIndex = updatedBands.findIndex(b => b.id === targetBandId);
        } else {
            // Use initial values from the step definition, with defaults if not provided
            const initialFrequency = currentStep.initialNewBandFrequency ?? 1000;
            const initialGain = currentStep.initialNewBandGain ?? 0;
            const initialQ = currentStep.initialNewBandQ ?? 1;
            
            // --- DEBUG LOGGING START (New Band Creation) ---
            console.log(`  > Creating New Band: initialFreq=${initialFrequency}, initialGain=${initialGain}, initialQ=${initialQ}`);
            console.log(`     >> Control Param: ${currentStep.parameterToControl}, NewValue: ${newValue}`);
            // --- DEBUG LOGGING END ---

            // Create a new band object using step definition initials, overriding with the controlled value
            const newBand: EQBand = {
                id: uuidv4(),
                frequency: currentStep.parameterToControl === 'frequency' ? newValue : initialFrequency,
                gain: currentStep.parameterToControl === 'gain' ? newValue : initialGain,
                q: currentStep.parameterToControl === 'q' ? newValue : initialQ,
                type: 'peaking'
            };
            // Add the new band to the array for update
            updatedBands.push(newBand);
            targetBandId = newBand.id;
            newBandIdRef.current = targetBandId; // Store the ID for this step
            bandIndex = updatedBands.length - 1; // New band is at the end
            profileNeedsUpdate = true; // Profile needs update because we added a band
            // If initial setup, we only add the band, no parameter update needed yet
            if (isInitialSetup) {
                 updateProfile(activeProfile.id, { bands: updatedBands });
                 return;
            }
        }
    } else {
        // Target an existing band by index
        bandIndex = currentStep.targetBandIndex;
        if (bandIndex >= 0 && bandIndex < updatedBands.length) {
            targetBandId = updatedBands[bandIndex].id;
        } else {
            console.error(`AutoCalibrationModal: Invalid targetBandIndex ${bandIndex} for profile ${activeProfile.id}`);
            return;
        }
    }

    if (targetBandId !== null && bandIndex !== null && bandIndex >= 0 && bandIndex < updatedBands.length) {
        // Get a mutable copy of the band to update
        const bandToUpdate = { ...updatedBands[bandIndex] };
        let parameterChanged = false;

        // --- DEBUG LOGGING START (Existing Band Update) ---
        console.log(`  > Updating Existing Band ${targetBandId} (Index ${bandIndex}):`);
        console.log(`     >> Control Param: ${currentStep.parameterToControl}, NewValue: ${newValue}`);
        // --- DEBUG LOGGING END ---

        // Update the specific parameter
        if (currentStep.parameterToControl === 'frequency' && bandToUpdate.frequency !== newValue) {
            bandToUpdate.frequency = newValue;
            parameterChanged = true;
        } else if (currentStep.parameterToControl === 'gain' && bandToUpdate.gain !== newValue) {
            bandToUpdate.gain = newValue;
            parameterChanged = true;
        } else if (currentStep.parameterToControl === 'q' && bandToUpdate.q !== newValue) {
            bandToUpdate.q = newValue;
            parameterChanged = true;
        }

        // If the parameter actually changed, update the array and mark for profile update
        if (parameterChanged) {
             updatedBands[bandIndex] = bandToUpdate;
             profileNeedsUpdate = true;
        }
    } else if (currentStep.targetBandIndex !== 'new') {
        // Only log error if we didn't find an *existing* band index
        console.error(`AutoCalibrationModal: Could not find band with ID ${targetBandId} or index ${bandIndex}`);
    }

    // If any change requires a profile update (new band added or parameter changed)
    if (profileNeedsUpdate) {
        updateProfile(activeProfile.id, { bands: updatedBands });
        // console.log(`Live update: Band ${targetBandId}, ${currentStep.parameterToControl} = ${newValue}`);
    }
};


  const handleClose = () => {
    audioPlayer.stopNoiseSources();
    console.log("Closing calibration modal via button, stopping audio.");
    onClose();
  }

  if (!open || !currentStep) return null;

  const totalSteps = calibration.getTotalSteps();
  const currentStepNumber = currentStep.id;

  // Determine slider step based on parameter type
  let sliderStep = 1;
  if (currentStep.parameterToControl === 'gain') sliderStep = 0.1;
  else if (currentStep.parameterToControl === 'q') sliderStep = 0.1;
  else if (currentStep.parameterToControl === 'frequency') {
      // Rough log-like step for frequency
      const range = Math.log10(currentStep.controlRange[1]) - Math.log10(currentStep.controlRange[0]);
      sliderStep = (currentStep.controlRange[1] - currentStep.controlRange[0]) / (range * 50); // Heuristic step size
  }
  sliderStep = Math.max(0.01, sliderStep); // Ensure minimum step

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Auto-Calibrate EQ (Step {currentStepNumber} of {totalSteps})</DialogTitle>
          <DialogDescription>
            {currentStep.instruction}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6"> {/* Increased spacing */}
          {/* Control Element */}
          <div className="space-y-2">
             <label className="text-sm font-medium capitalize">
               Adjust {currentStep.parameterToControl}
             </label>
             <Slider
               value={[currentValue]}
               min={currentStep.controlRange[0]}
               max={currentStep.controlRange[1]}
               step={sliderStep}
               onValueChange={handleValueChange}
             />
             <div className="flex justify-between text-xs text-muted-foreground">
                <span>{currentStep.controlRange[0]}</span>
                {/* Format value based on parameter */}
                <span className="font-medium text-sm text-foreground">
                    {currentStep.parameterToControl === 'gain' ? `${currentValue.toFixed(1)} dB` :
                     currentStep.parameterToControl === 'q' ? currentValue.toFixed(1) :
                     `${currentValue.toFixed(0)} Hz`}
                </span>
                <span>{currentStep.controlRange[1]}</span>
             </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
             className="bg-teal-500 hover:bg-teal-600 text-white"
             onClick={handleNextStep}
          >
            {currentStepNumber === totalSteps ? "Finish" : "Next Step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 