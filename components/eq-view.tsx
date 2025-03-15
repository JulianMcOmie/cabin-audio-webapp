"use client"

import { useState } from "react"
import { HelpCircle, Play, Power, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FrequencyGraph } from "@/components/frequency-graph"
import { DotCalibration } from "@/components/dot-grid"
import { EQProfiles } from "@/components/eq-profiles"
import { EQCalibrationModal } from "@/components/eq-calibration-modal"
import { LoginModal } from "@/components/login-modal"
import { SignupModal } from "@/components/signup-modal"
import { InfoCircle } from "@/components/ui/info-circle"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { Slider } from "@/components/ui/slider"

interface EQViewProps {
  isPlaying: boolean
  setIsPlaying: (isPlaying: boolean) => void
  onSignupClick: () => void
}

export function EQView({ isPlaying, setIsPlaying, onSignupClick }: EQViewProps) {
  const [selectedDot, setSelectedDot] = useState<[number, number] | null>(null)
  const [instruction, setInstruction] = useState("Click + drag on the center line to add a band")
  const { isEQEnabled, setEQEnabled, distortionGain, setDistortionGain } = useEQProfileStore()
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [showCreateNewOverlay, setShowCreateNewOverlay] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState("Flat")
  const [activeTab, setActiveTab] = useState("eq")
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  
  // State for the dot grid calibration audio
  const [dotGridPlaying, setDotGridPlaying] = useState(false)

  const handleProfileClick = () => {
    setShowCreateNewOverlay(true)
  }

  const handleSelectProfile = (name: string) => {
    setSelectedProfile(name)
    setShowCreateNewOverlay(false)
  }

  const handleDistortionGainChange = (value: number[]) => {
    setDistortionGain(value[0])
  }

  // Format the gain as a percentage
  const formatDistortionGain = (gain: number): string => {
    return `${Math.round(gain * 100)}%`;
  }

  return (
    <div className="mx-auto space-y-8 pb-24">
      <div className="flex justify-between items-center mb-2">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">EQ</h2>
          <p className="text-sm text-muted-foreground">Make your music sound incredible with personalized EQ.</p>
          <div className="flex items-center mt-1">
            <div className={`h-2 w-2 rounded-full mr-2 ${isEQEnabled ? "bg-green-500" : "bg-red-500"}`}></div>
            <span className="text-xs text-muted-foreground">EQ is currently {isEQEnabled ? "enabled" : "disabled"}</span>
          </div>
        </div>
        <Button variant="outline" onClick={() => setShowCalibrationModal(true)}>
          <HelpCircle className="mr-2 h-5 w-5" />
          Tutorial
        </Button>
      </div>

      {/* Main EQ View */}
      <div className="space-y-6">
        {/* Frequency Graph (on top) */}
        <div className="relative">
          <FrequencyGraph 
            selectedDot={selectedDot} 
            disabled={!isEQEnabled} 
            className="w-full" 
            onInstructionChange={setInstruction}
            onRequestEnable={() => setEQEnabled(true)}
          />

          {/* Contextual Instructions */}
          <div className="mt-1 mb-3 px-2 py-1.5 bg-muted/40 rounded text-sm text-muted-foreground border-l-2 border-electric-blue">
            {instruction}
          </div>

          {/* EQ Toggle Overlay */}
          <div className="eq-toggle-container">
            <Button
              variant={isEQEnabled ? "default" : "outline"}
              size="sm"
              className={isEQEnabled ? "bg-electric-blue hover:bg-electric-blue/90 text-white" : ""}
              onClick={() => setEQEnabled(!isEQEnabled)}
            >
              <Power className="h-4 w-4 mr-2" />
              {isEQEnabled ? "EQ On" : "EQ Off"}
            </Button>
          </div>

          {showCreateNewOverlay && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
              <div className="text-center p-6 max-w-xs">
                <p className="mb-4">Sign up to create more profiles.</p>
                <Button
                  onClick={() => setShowSignupModal(true)}
                  className="bg-electric-blue hover:bg-electric-blue/90 text-white"
                >
                  Sign up
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Distortion Control Section */}
        <div className="border rounded-lg p-6 bg-card">
          <div className="flex items-center mb-3">
            <Volume2 className="h-5 w-5 mr-2 text-muted-foreground" />
            <h3 className="text-lg font-medium">Anti-Distortion Control</h3>
          </div>
          
          <p className="text-sm text-muted-foreground mb-4">
            If you hear distortion or clipping, reduce the volume using this slider to prevent audio artifacts.
            This is especially useful when using strong EQ settings.
          </p>
          
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Volume Level</span>
              <span className="text-sm font-medium">{formatDistortionGain(distortionGain)}</span>
            </div>
            
            <Slider
              value={[distortionGain]}
              min={0.01}
              max={1.0}
              step={0.01}
              onValueChange={handleDistortionGainChange}
              className="w-full"
            />
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Less Volume, Less Distortion</span>
              <span>Full Volume</span>
            </div>
          </div>
        </div>

        {/* Calibration Section */}
        <div className="mt-8 border rounded-lg p-6 bg-card">
          <h3 className="text-lg font-medium mb-4">How to Calibrate Your EQ</h3>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-3/5 space-y-5">
              <div>
                <h4 className="font-medium mb-2">Understanding the Grid</h4>
                <p className="text-muted-foreground">
                  The dot grid lets you play noise bursts with different sound characteristics:
                </p>
                <ul className="list-disc pl-5 space-y-1 mt-2 text-sm text-muted-foreground">
                  <li>
                    <strong>Horizontal position</strong> (left-right): Controls stereo balance
                  </li>
                  <li>
                    <strong>Vertical position</strong> (up-down): Adjusts frequency content - higher points have more
                    treble, lower points have more bass
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium mb-2">Calibration Steps</h4>
                <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                  <li>Select dots on the grid by clicking them (select multiple dots if desired)</li>
                  <li>Press Play to hear pink noise bursts at the selected positions</li>
                  <li>
                    Adjust the EQ settings until:
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>Bursts on different rows sound like they come from different heights</li>
                      <li>Bursts sound evenly spaced in a grid-like pattern in your soundstage</li>
                    </ul>
                  </li>
                  <li>
                    Save your settings by{" "}
                    <Button
                      variant="link"
                      className="text-electric-blue hover:text-electric-blue/80 font-medium p-0 h-auto"
                      onClick={() => setShowSignupModal(true)}
                    >
                      signing up
                    </Button>{" "}
                    or{" "}
                    <Button
                      variant="link"
                      className="text-electric-blue hover:text-electric-blue/80 font-medium p-0 h-auto"
                      onClick={() => {
                        const exportTab = document.querySelector('[data-tab="export"]')
                        if (exportTab) {
                          ;(exportTab as HTMLElement).click()
                        }
                      }}
                    >
                      exporting them
                    </Button>
                  </li>
                </ol>
              </div>

              <div>
                <details className="group">
                  <summary className="font-medium mb-2 cursor-pointer flex items-center">
                    <h4>Tips</h4>
                    <svg
                      className="ml-2 h-4 w-4 transition-transform group-open:rotate-180"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </summary>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground mt-2">
                    <li>
                      <strong>Try different dot combinations</strong> - select dots in a pattern to test spatial imaging
                    </li>
                    <li>
                      <strong>Select dots on the same row</strong> - to test stereo imaging across left-right axis
                    </li>
                    <li>
                      <strong>Select dots on the same column</strong> - to test frequency separation top-to-bottom
                    </li>
                    <li>
                      <strong>Toggle EQ on/off</strong> - compare with and without EQ to verify improvements
                    </li>
                    <li>
                      <strong>Increase grid size</strong> - for more detailed spatial testing with more points
                    </li>
                  </ul>
                </details>
              </div>

              <InfoCircle>
                This calibration creates a personalized EQ tailored to your unique hearing and audio equipment,
                improving spatial separation and clarity for all your music.
              </InfoCircle>
            </div>

            <div className="md:w-2/5 flex flex-col justify-start">
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-3 text-center">Calibration Controls</h4>

                {/* Dot Calibration component */}
                <div className="mb-3">
                  <DotCalibration 
                    isPlaying={dotGridPlaying}
                    setIsPlaying={setDotGridPlaying}
                    disabled={!isEQEnabled}
                  />
                </div>

                <Button
                  size="sm"
                  className="w-full bg-electric-blue hover:bg-electric-blue/90 text-white mb-2"
                  onClick={() => setDotGridPlaying(!dotGridPlaying)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {dotGridPlaying ? "Stop Calibration Sound" : "Play Calibration Sound"}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Select multiple dots on the grid to test different spatial positions
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TODO: Add back in profiles when functional */}
      {/* <div className="mt-8">
        <h3 className="text-lg font-medium mb-4">EQ Profiles</h3>
        <EQProfiles
          onProfileClick={handleProfileClick}
          selectedProfile={selectedProfile}
          onSelectProfile={handleSelectProfile}
        />
      </div>

      <div className="mt-4 text-center">
        <p className="text-sm text-muted-foreground">
          <Button
            variant="link"
            className="text-electric-blue hover:text-electric-blue/80 font-medium p-0 h-auto"
            onClick={() => setShowSignupModal(true)}
          >
            Sign up
          </Button>{" "}
          to save your custom EQ settings.
        </p>
      </div> */}

      <EQCalibrationModal open={showCalibrationModal} onClose={() => setShowCalibrationModal(false)} />
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SignupModal open={showSignupModal} onClose={() => setShowSignupModal(false)} />
    </div>
  )
}

