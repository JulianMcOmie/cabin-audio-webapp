"use client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface EQCalibrationModalProps {
  open: boolean
  onClose: () => void
}

export function EQCalibrationModal({ open, onClose }: EQCalibrationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">Calibration Guide</DialogTitle>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="h-[calc(80vh-210px)] mt-4 overflow-auto">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We offer EQ calibration tools unlike anything you&apos;ve likely seen before. They help you adjust your EQ to create a wider and taller soundstage in your headphone (yes, we&apos;re adding the dimension of height to the soundstage).
              Most people never think about sound having height - that&apos;s what makes this special.
            </p>

            <div>
              <h3 className="font-medium mb-2">How to Use the Dot Grid</h3>
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
                <li>Each dot represents a different position in your soundstage</li>
                <li>Click on any dot to hear a sound at that position</li>
                <li><strong>Your goal:</strong> Make your soundstage huge - create maximum vertical and horizontal separation while keeping dots evenly spaced</li>
                <li>Adjust your EQ (especially boost lows and highs) until:
                  <ul className="list-disc pl-5 mt-1">
                    <li>High dots sound clearly above you</li>
                    <li>Low dots sound clearly below you</li>
                    <li>Left dots sound far to the left</li>
                    <li>Right dots sound far to the right</li>
                    <li>Dots are evenly spaced</li>
                    <li>Dots stay in the same place as they oscillate in volume</li>
                  </ul>
                </li>
              </ol>
            </div>

            <div className="bg-muted/50 p-3 rounded-md text-sm">
              <strong>This is counterintuitive!</strong> You&apos;ll need to make stronger EQ adjustments than you think. 
              Boosting highs and lows significantly will help expand the soundstage vertically - this height component creates the most dramatic improvement.
            </div>

            <div>
              <h3 className="font-medium mb-2">Tips for Best Results</h3>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                <li>Don&apos;t be afraid to make dramatic EQ changes - especially boosting highs and lows</li>
                <li>You might need to add weird, random dips and peaks to create spatial changes</li>
                <li>To get the bass to move down and the highs to move up, you might need to add random peaks and dips in the high end</li>
                <li>Focus on creating maximum height (vertical separation) - this is what most headphones lack</li>
                <li>The line tool is an alternative view showing the same effect - use whichever makes more sense to you</li>
                <li>Trust your ears - when the dots are obviously at different heights, you&apos;ve got it right</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Fixed position footer */}
        <div className="border-t pt-4 pb-4 mt-auto">
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

