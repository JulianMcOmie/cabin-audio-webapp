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
                  Cabin Audio features a patent-pending calibration system that helps you create a personalized EQ
                  profile tailored to your unique hearing and audio equipment.
                </p>

                <p className="text-sm text-muted-foreground">
                  You&apos;ll find our calibration tool below the EQ graph. It uses a dot grid system that plays test sounds
                  to help you fine-tune your EQ settings for optimal spatial separation and clarity.
                </p>

                <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
                  Try it out! Close this tutorial and scroll down to see the &quot;How to Calibrate Your EQ&quot; section.
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

