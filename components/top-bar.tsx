"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

interface TopBarProps {
  setActiveTab?: (tab: "eq" | "library") => void
  history?: Array<"eq" | "library">
  currentIndex?: number
  setCurrentIndex?: (index: number) => void
}

type TabHistory = Array<"eq" | "library">

export function TopBar({ setActiveTab, history, currentIndex, setCurrentIndex }: TopBarProps) {
  const [showHowTo, setShowHowTo] = useState(false)

  const [localHistory] = useState<TabHistory>(["eq"])
  const [localCurrentIndex, setLocalCurrentIndex] = useState(0)

  const activeHistory = history || localHistory
  const activeCurrentIndex = currentIndex !== undefined ? currentIndex : localCurrentIndex
  const setActiveCurrentIndex = setCurrentIndex || setLocalCurrentIndex

  const handleBack = () => {
    if (activeCurrentIndex > 0 && setActiveTab) {
      const newIndex = activeCurrentIndex - 1
      setActiveCurrentIndex(newIndex)
      setActiveTab(activeHistory[newIndex])
    }
  }

  const handleForward = () => {
    if (activeCurrentIndex < activeHistory.length - 1 && setActiveTab) {
      const newIndex = activeCurrentIndex + 1
      setActiveCurrentIndex(newIndex)
      setActiveTab(activeHistory[newIndex])
    }
  }

  return (
    <div className="h-16 flex items-center px-6 bg-background">
      <div className="hidden md:flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBack} disabled={activeCurrentIndex <= 0}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleForward} disabled={activeCurrentIndex >= activeHistory.length - 1}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="ml-auto">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowHowTo(true)}>
          <HelpCircle className="h-4 w-4" />
          <span className="sr-only">How to use</span>
        </Button>
      </div>

      <Dialog open={showHowTo} onOpenChange={setShowHowTo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>How to Use</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-4 pt-2 text-sm text-muted-foreground">
                <section>
                  <h3 className="font-medium text-foreground mb-1">The Soundstage</h3>
                  <p>
                    When no music is playing, the dot grid is your <strong>soundstage</strong>. Tap any dot to play a test tone from that position. You&apos;ll notice sounds appear at different heights and widths &mdash; that&apos;s because higher frequencies naturally sound &ldquo;higher up&rdquo; and panning moves them left or right.
                  </p>
                </section>

                <section>
                  <h3 className="font-medium text-foreground mb-1">Why It Matters</h3>
                  <p>
                    Great-sounding audio has instruments spread out across the soundstage &mdash; each in its own space. When everything is spread apart, you hear more detail, more clarity, and more separation. That&apos;s the goal.
                  </p>
                </section>

                <section>
                  <h3 className="font-medium text-foreground mb-1">Using the EQ</h3>
                  <p>
                    The EQ can reshape your soundstage. For example, a bass boost can stretch sounds downward, and adjustments in the high end or upper mids can expand the overall width and height. Experiment &mdash; there&apos;s no single right answer, and results vary by headphones and volume.
                  </p>
                </section>

                <section>
                  <h3 className="font-medium text-foreground mb-1">Tips</h3>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Try different volumes &mdash; soundstage changes with loudness</li>
                    <li>Tap around the grid to build a mental map of your headphones</li>
                    <li>Play music and see how instruments move around the stage</li>
                  </ul>
                </section>
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}
