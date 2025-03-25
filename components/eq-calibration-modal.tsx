"use client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface EQCalibrationModalProps {
  open: boolean
  onClose: () => void
}

export function EQCalibrationModal({ open, onClose }: EQCalibrationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">How to Use Cabin Audio</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="eq" className="w-full">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="eq">EQ Controls</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
          </TabsList>

          {/* Fixed height scrollable area */}
          <div className="h-[calc(80vh-210px)] mt-4 overflow-auto">
            <TabsContent value="eq" className="m-0 p-0">
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Basic Controls</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Click center line + drag to add a band</li>
                    <li>• Drag to move a band</li>
                    <li>• Shift + drag to adjust band width</li>
                    <li>• Right-click to remove a band</li>
                    <li>• Drag the dot on the right up/down to adjust volume</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Frequency Guide</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Left side: Low frequencies (bass)</li>
                    <li>• Right side: High frequencies (treble)</li>
                    <li>• Up: Increased volume</li>
                    <li>• Down: Decreased volume</li>
                  </ul>
                </div>

                <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
                  An equalizer (EQ) lets you adjust the volume of different frequency ranges in your audio, allowing you
                  to customize the sound to your preferences or listening environment.
                </div>
              </div>
            </TabsContent>

            <TabsContent value="calibration" className="m-0 p-0">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The Reference Calibration tool helps you adjust your EQ with precision by comparing a reference tone with different frequencies.
                </p>

                <div className="space-y-2">
                  <h3 className="font-medium">How to Use the Calibration:</h3>
                  <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
                    <li>Press <strong>Start</strong> in the Calibration panel to begin playing the test sounds</li>
                    <li>You'll hear two rows of sound bursts:
                      <ul className="list-disc pl-5 mt-1">
                        <li><strong>Reference row</strong> (top): Always plays at 800Hz</li>
                        <li><strong>Test row</strong> (bottom): Plays at the frequency you're adjusting with EQ</li>
                      </ul>
                    </li>
                    <li>Adjust your EQ at different frequencies until both rows sound equally wide/spacious in your headphones</li>
                    <li>When both rows have the same perceived spatial width, your EQ is calibrated for that frequency</li>
                  </ol>
                </div>

                <div className="mt-2">
                  <h3 className="font-medium">Tips for Better Results:</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5 mt-1">
                    <li>Focus on the perceived <strong>spatial width</strong> of the sound, not just volume</li>
                    <li>Low frequencies typically need boosting (drag EQ up)</li>
                    <li>High frequencies may need reduction (drag EQ down)</li>
                    <li>Take your time with each adjustment for best results</li>
                  </ul>
                </div>

                <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
                  The calibration tool uses psychoacoustic techniques to help you match your EQ settings to your unique 
                  hearing and audio equipment, creating a personalized listening experience.
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Fixed position footer with extra padding */}
        <div className="border-t pt-4 pb-4 mt-auto">
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

