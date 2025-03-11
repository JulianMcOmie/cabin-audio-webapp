"use client"

import { useState } from "react"
import { HelpCircle, Play, Power } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FrequencyGraph } from "@/components/frequency-graph"
import { DotGrid } from "@/components/dot-grid"
import { EQProfiles } from "@/components/eq-profiles"
import { EQCalibrationModal } from "@/components/eq-calibration-modal"
import { LoginModal } from "@/components/login-modal"
import { SignupModal } from "@/components/signup-modal"

interface EQViewProps {
  isPlaying: boolean
  setIsPlaying: (isPlaying: boolean) => void
}

export function EQView({ isPlaying, setIsPlaying }: EQViewProps) {
  const [selectedDot, setSelectedDot] = useState<[number, number] | null>(null)
  const [gridSize, setGridSize] = useState(8)
  const [eqEnabled, setEqEnabled] = useState(true)
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
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-center mb-2">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">EQ</h2>
          <p className="text-sm text-muted-foreground">Make your music sound incredible with personalized EQ.</p>
        </div>
        <Button variant="outline" onClick={() => setShowCalibrationModal(true)}>
          <HelpCircle className="mr-2 h-5 w-5" />
          Tutorial
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 relative flex items-center">
          <FrequencyGraph selectedDot={selectedDot} disabled={!eqEnabled} className="flex-1 h-full" />

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
        <div className="md:w-[300px] flex flex-col">
          <Card className="flex-1">
            <CardContent className="p-4">
              <DotGrid selectedDot={selectedDot} setSelectedDot={setSelectedDot} gridSize={gridSize} />
              <div className="flex items-center justify-between mt-4 border-t pt-4">
                <span className="text-sm text-gray-600">
                  Grid Resolution: {gridSize}×{gridSize}
                </span>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={decreaseResolution}
                    disabled={gridSize <= 4 || !eqEnabled}
                  >
                    <span className="text-lg">-</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={increaseResolution}
                    disabled={gridSize >= 16 || !eqEnabled}
                  >
                    <span className="text-lg">+</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          <Button
            size="lg"
            className="w-full mt-4 bg-electric-blue hover:bg-electric-blue/90 text-white"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            <Play className="mr-2 h-5 w-5" />
            {isPlaying ? "Pause Calibration" : "Play Calibration"}
          </Button>
        </div>
      </div>

      <div className="mt-8">
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

