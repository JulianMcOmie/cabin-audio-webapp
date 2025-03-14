"use client"

import { useState } from "react"
import { HelpCircle, Play, Power } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FrequencyGraph } from "@/components/frequency-graph"
import { DotGrid } from "@/components/dot-grid"
import { EQProfiles } from "@/components/eq-profiles"
import { EQCalibrationModal } from "@/components/eq-calibration-modal"
import { LoginModal } from "@/components/login-modal"
import { SignupModal } from "@/components/signup-modal"
import { InfoCircle } from "@/components/ui/info-circle"

interface EQViewProps {
  isPlaying: boolean
  setIsPlaying: (isPlaying: boolean) => void
  eqEnabled: boolean
  setEqEnabled: (enabled: boolean) => void
  onSignupClick: () => void
}

export function EQView({ isPlaying, setIsPlaying, eqEnabled, setEqEnabled, onSignupClick }: EQViewProps) {
  const [selectedDot, setSelectedDot] = useState<[number, number] | null>(null)
  const [gridSize, setGridSize] = useState(8)
  // Remove the local eqEnabled state since it's now passed as a prop
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [showCreateNewOverlay, setShowCreateNewOverlay] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState("Flat")
  const [activeTab, setActiveTab] = useState("eq")
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)

  const increaseResolution = () => {
    if (gridSize < 16) {
      setGridSize(gridSize + 1)
    }
  }

  const decreaseResolution = () => {
    if (gridSize > 4) {
      setGridSize(gridSize - 1)
    }
  }

  const handleProfileClick = () => {
    setShowCreateNewOverlay(true)
  }

  const handleSelectProfile = (name: string) => {
    setSelectedProfile(name)
    setShowCreateNewOverlay(false)
  }

  return (
    <div className="mx-auto space-y-8 pb-24">
      <div className="flex justify-between items-center mb-2">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">EQ</h2>
          <p className="text-sm text-muted-foreground">Make your music sound incredible with personalized EQ.</p>
          <div className="flex items-center mt-1">
            <div className={`h-2 w-2 rounded-full mr-2 ${eqEnabled ? "bg-green-500" : "bg-red-500"}`}></div>
            <span className="text-xs text-muted-foreground">EQ is currently {eqEnabled ? "enabled" : "disabled"}</span>
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
          <FrequencyGraph selectedDot={selectedDot} disabled={!eqEnabled} className="w-full" />

          {/* Contextual Instructions */}
          <div className="mt-1 mb-3 px-2 py-1.5 bg-muted/40 rounded text-sm text-muted-foreground border-l-2 border-electric-blue">
            Click + drag on the center line to add a band
          </div>

          {/* EQ Toggle Overlay */}
          <div className="eq-toggle-container">
            <Button
              variant={eqEnabled ? "default" : "outline"}
              size="sm"
              className={eqEnabled ? "bg-electric-blue hover:bg-electric-blue/90 text-white" : ""}
              onClick={() => setEqEnabled(!eqEnabled)}
            >
              <Power className="h-4 w-4 mr-2" />
              {eqEnabled ? "EQ On" : "EQ Off"}
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
                  <li>Play the noise bursts by clicking points on the grid</li>
                  <li>Listen to how the sounds appear positioned in space</li>
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
                      <strong>Use extreme adjustments</strong> - good results often require dramatic bass and treble
                      boosts
                    </li>
                    <li>
                      <strong>Test all positions</strong> - check multiple points as each responds differently to EQ
                      changes
                    </li>
                    <li>
                      <strong>Toggle EQ on/off</strong> - compare with and without EQ to verify you're making
                      improvements
                    </li>
                    <li>
                      <strong>Trust your ears</strong> - effective changes may seem unintuitive, but focus on what
                      sounds right
                    </li>
                    <li>
                      <strong>Use calibration sounds only</strong> - calibrating while listening to music rarely works
                      well
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

                {/* Actual Dot Grid */}
                <div className="h-[180px] mb-3 bg-background/50 rounded-lg p-3">
                  <DotGrid selectedDot={selectedDot} setSelectedDot={setSelectedDot} gridSize={gridSize} />
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">
                    Grid Size: {gridSize}×{gridSize}
                  </span>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={decreaseResolution}
                      disabled={gridSize <= 4 || !eqEnabled}
                    >
                      <span className="text-sm">-</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={increaseResolution}
                      disabled={gridSize >= 16 || !eqEnabled}
                    >
                      <span className="text-sm">+</span>
                    </Button>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full bg-electric-blue hover:bg-electric-blue/90 text-white mb-2"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {isPlaying ? "Pause Sound" : "Play Test Sound"}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Click dots on the grid to play different test sounds
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
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
      </div>

      <EQCalibrationModal open={showCalibrationModal} onClose={() => setShowCalibrationModal(false)} />
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SignupModal open={showSignupModal} onClose={() => setShowSignupModal(false)} />
    </div>
  )
}

