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

  useEffect(() => {
    if (open) {
      calibration.reset();
      newBandIdRef.current = null; // Reset new band ID on open
      const step = calibration.getCurrentStep();
      setCurrentStep(step);
      if (step) {
        const initialVal = step.initialValue ?? (step.controlRange[0] + step.controlRange[1]) / 2;
        setCurrentValue(initialVal);
        audioPlayer.startNoiseSources(step.noiseSources);
        console.log("Starting step:", step);

        // Pre-create band if step targets 'new'
        if (step.targetBandIndex === 'new') {
            handleValueChange([initialVal], true); // Trigger initial band creation
        }
      } else {
         // No steps defined
         console.warn("AutoCalibration: No calibration steps found.");
         audioPlayer.stopNoiseSources();
      }
    } else {
      audioPlayer.stopNoiseSources();
      console.log("Closing calibration modal, stopping audio.");
    }

    // Cleanup function
    return () => {
      if (open) { // Ensure cleanup only happens when modal was open
         audioPlayer.stopNoiseSources();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, calibration]); // Audio player instance is stable, addBand/updateProfile/getActiveProfile are stable

  const handleNextStep = () => {
    // Value is already applied live by handleValueChange
    // We just need to advance the step and manage audio
    audioPlayer.stopNoiseSources(); // Stop audio for the completed step
    newBandIdRef.current = null; // Reset new band ID for the next step

    const hasNext = calibration.nextStep();
    if (hasNext) {
      const nextStep = calibration.getCurrentStep();
      setCurrentStep(nextStep);
      if (nextStep) {
        const initialVal = nextStep.initialValue ?? (nextStep.controlRange[0] + nextStep.controlRange[1]) / 2;
        setCurrentValue(initialVal);
        audioPlayer.startNoiseSources(nextStep.noiseSources);
        console.log("Moving to next step:", nextStep);

        // Pre-create band if next step targets 'new'
        if (nextStep.targetBandIndex === 'new') {
            handleValueChange([initialVal], true); // Trigger initial band creation for new step
        }
      }
    } else {
      // Calibration finished
      console.log("Auto-calibration finished.");
      onClose(); // Close the modal
    }
  };

  const handleValueChange = (value: number[], isInitialSetup = false) => {
    const newValue = value[0];
    setCurrentValue(newValue);

    if (!currentStep) return;

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
            // Create a new band object
            const newBand: EQBand = {
                id: uuidv4(),
                frequency: currentStep.parameterToControl === 'frequency' ? newValue : 1000,
                gain: currentStep.parameterToControl === 'gain' ? newValue : 0,
                q: currentStep.parameterToControl === 'q' ? newValue : 1,
                type: 'peaking'
            };
            // Add the new band to the array for update
            updatedBands.push(newBand);
            targetBandId = newBand.id;
            newBandIdRef.current = targetBandId; // Store the ID for this step
            bandIndex = updatedBands.length - 1; // New band is at the end
            profileNeedsUpdate = true; // Profile needs update because we added a band
            console.log(`AutoCalibration: Prepared new band ${targetBandId} for step ${currentStep.id}`);
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