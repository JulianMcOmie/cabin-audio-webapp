"use client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface EQCalibrationModalProps {
  open: boolean
  onClose: () => void
}

export function EQCalibrationModal({ open, onClose }: EQCalibrationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">How to Use the EQ and Calibration System</DialogTitle>
          <DialogDescription>Learn how to get the most out of Cabin Audio's EQ technology</DialogDescription>
        </DialogHeader>

        <div className="space-y-8 py-4">
          <section>
            <h3 className="text-lg font-medium mb-2">Understanding the EQ Grid</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="mb-4">
                  The EQ grid is a visual representation of your audio's frequency response. Each point on the grid
                  affects different aspects of your sound:
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Horizontal axis:</strong> Represents frequency (bass to treble)
                  </li>
                  <li>
                    <strong>Vertical axis:</strong> Represents amplitude (volume)
                  </li>
                  <li>
                    <strong>Left side:</strong> Lower frequencies (bass)
                  </li>
                  <li>
                    <strong>Right side:</strong> Higher frequencies (treble)
                  </li>
                  <li>
                    <strong>Top:</strong> Increased volume
                  </li>
                  <li>
                    <strong>Bottom:</strong> Decreased volume
                  </li>
                </ul>
              </div>
              <div className="bg-muted rounded-lg p-4 flex items-center justify-center">
                <img src="/placeholder.svg?height=200&width=300" alt="EQ Grid Explanation" className="rounded-md" />
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-2">Calibration Process</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-muted rounded-lg p-4 flex items-center justify-center">
                <img src="/placeholder.svg?height=200&width=300" alt="Calibration Process" className="rounded-md" />
              </div>
              <div>
                <p className="mb-4">The calibration process helps you fine-tune your EQ settings for optimal sound:</p>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>Click "Play Calibration" to start the test sound</li>
                  <li>Select points on the grid to adjust specific frequencies</li>
                  <li>Listen for changes in the audio as you adjust</li>
                  <li>Use the grid resolution controls to make finer adjustments</li>
                  <li>Save your profile when you're satisfied with the sound</li>
                </ol>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-2">Common EQ Adjustments</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Bass Boost</h4>
                <div className="aspect-video bg-muted rounded-md mb-2 flex items-center justify-center">
                  <img src="/placeholder.svg?height=100&width=160" alt="Bass Boost EQ" className="rounded-md" />
                </div>
                <p className="text-sm">
                  Increase the left side of the grid to enhance low frequencies for more powerful bass.
                </p>
              </div>

              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Vocal Clarity</h4>
                <div className="aspect-video bg-muted rounded-md mb-2 flex items-center justify-center">
                  <img src="/placeholder.svg?height=100&width=160" alt="Vocal Clarity EQ" className="rounded-md" />
                </div>
                <p className="text-sm">Boost the mid-range frequencies to enhance vocals and spoken word content.</p>
              </div>

              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Treble Enhancement</h4>
                <div className="aspect-video bg-muted rounded-md mb-2 flex items-center justify-center">
                  <img src="/placeholder.svg?height=100&width=160" alt="Treble Enhancement EQ" className="rounded-md" />
                </div>
                <p className="text-sm">
                  Increase the right side of the grid to enhance high frequencies for more detail and brightness.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-medium mb-2">Tips for Better Sound</h3>
            <div className="space-y-4">
              <p>Follow these tips to get the most out of your EQ settings:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>Start with small adjustments and listen for changes</li>
                <li>Use the calibration sound to hear the effect of your adjustments in real-time</li>
                <li>Create different profiles for different types of music or content</li>
                <li>Avoid extreme boosts that might cause distortion</li>
                <li>Use the "Flat" profile as a reference point</li>
                <li>Save your profiles to use across different devices</li>
              </ul>
            </div>
          </section>
        </div>

        <div className="flex justify-end mt-4">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

