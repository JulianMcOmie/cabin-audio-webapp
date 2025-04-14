import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider"; // Assuming slider control for now
import { AutoCalibration, CalibrationStep } from "@/lib/calibration/AutoCalibration"; // Import the class

interface AutoCalibrationModalProps {
  open: boolean;
  onClose: () => void;
  // We will need props later to:
  // - Get the active EQ profile
  // - Update the EQ profile bands
  // - Control audio playback for noise sources
}

export function AutoCalibrationModal({ open, onClose }: AutoCalibrationModalProps) {
  const [calibration] = useState(() => new AutoCalibration()); // Instantiate the calibration logic
  const [currentStep, setCurrentStep] = useState<CalibrationStep | null>(null);
  const [currentValue, setCurrentValue] = useState<number>(0);

  useEffect(() => {
    if (open) {
      calibration.reset(); // Reset steps when modal opens
      const step = calibration.getCurrentStep();
      setCurrentStep(step);
      if (step) {
        setCurrentValue(step.initialValue ?? (step.controlRange[0] + step.controlRange[1]) / 2);
        // TODO: Start playing noise sources for this step
        console.log("Starting step:", step);
        console.log("Noise sources:", step.noiseSources);
      }
    } else {
      // TODO: Stop any playing noise sources
      console.log("Closing calibration modal, stopping audio.");
    }
  }, [open, calibration]);

  const handleNextStep = () => {
    // TODO: Apply the currentValue to the target band parameter
    console.log(`Applying value ${currentValue} to band ${currentStep?.targetBandIndex}, parameter ${currentStep?.parameterToControl}`);

    const hasNext = calibration.nextStep();
    if (hasNext) {
      const nextStep = calibration.getCurrentStep();
      setCurrentStep(nextStep);
      if (nextStep) {
        setCurrentValue(nextStep.initialValue ?? (nextStep.controlRange[0] + nextStep.controlRange[1]) / 2);
        // TODO: Stop old noise sources, start new ones
        console.log("Moving to next step:", nextStep);
        console.log("Noise sources:", nextStep.noiseSources);
      }
    } else {
      // Calibration finished
      console.log("Auto-calibration finished.");
      onClose(); // Close the modal when finished
    }
  };

  const handleValueChange = (value: number[]) => {
    setCurrentValue(value[0]);
    // TODO: Apply the change *live* to the EQ band (this requires access to the EQ profile/processor)
    // console.log(`Live update: ${currentStep?.parameterToControl} = ${value[0]}`);
  };

  const handleClose = () => {
    // TODO: Stop any playing noise sources before closing
     console.log("Closing calibration modal via button, stopping audio.");
    onClose();
  }

  if (!open || !currentStep) return null;

  const totalSteps = calibration.getTotalSteps();
  const currentStepNumber = currentStep.id; // Assuming step IDs are sequential starting from 1

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Auto-Calibrate EQ (Step {currentStepNumber} of {totalSteps})</DialogTitle>
          <DialogDescription>
            Follow the instructions to calibrate your EQ settings.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-sm text-muted-foreground">{currentStep.instruction}</p>

          {/* Control Element (Slider for now) */}
          <div className="space-y-2">
             <label className="text-sm font-medium capitalize">
               Adjust {currentStep.parameterToControl}
             </label>
             <Slider
               value={[currentValue]}
               min={currentStep.controlRange[0]}
               max={currentStep.controlRange[1]}
               step={(currentStep.controlRange[1] - currentStep.controlRange[0]) / 100} // Example step
               onValueChange={handleValueChange}
             />
             <div className="flex justify-between text-xs text-muted-foreground">
                <span>{currentStep.controlRange[0]}</span>
                <span>{currentStep.parameterToControl === 'gain' ? `${currentValue.toFixed(1)} dB` : currentValue.toFixed(0)}</span>
                <span>{currentStep.controlRange[1]}</span>
             </div>
          </div>

          {/* Maybe display noise source info for debugging? */}
          {/* <pre className="text-xs bg-muted p-2 rounded overflow-auto">
            {JSON.stringify(currentStep.noiseSources, null, 2)}
          </pre> */}

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