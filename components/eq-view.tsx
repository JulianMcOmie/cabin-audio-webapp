"use client"

import { useState, useEffect, useRef } from "react"
import { HelpCircle, Play, Power, Volume2, Sliders } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FrequencyGraph } from "@/components/frequency-graph"
import { ReferenceCalibration } from "@/components/reference-calibration"
import { EQProfiles } from "@/components/eq-profiles"
import { EQCalibrationModal } from "@/components/eq-calibration-modal"
import { LoginModal } from "@/components/login-modal"
import { SignupModal } from "@/components/signup-modal"
import { InfoCircle } from "@/components/ui/info-circle"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { v4 as uuidv4 } from 'uuid'
import { SyncStatus } from "@/lib/models/SyncStatus"
import { FFTVisualizer } from "@/components/audio/FFTVisualizer"
import { getReferenceCalibrationAudio } from "@/lib/audio/referenceCalibrationAudio"
// Comment out EQCalibrationProcess import
// import { EQCalibrationProcess } from "@/components/eq-calibration-process"

interface EQViewProps {
//   isPlaying: boolean
//   setIsPlaying: (isPlaying: boolean) => void
//   eqEnabled: boolean
  setEqEnabled: (enabled: boolean) => void
//   onSignupClick: () => void
}

export function EQView({ setEqEnabled }: EQViewProps) {
  const [selectedDot] = useState<[number, number] | null>(null)
  const [instruction, setInstruction] = useState("Click + drag on the center line to add a band")
  const { 
    isEQEnabled, 
    setEQEnabled, 
    distortionGain, 
    setDistortionGain,
    getProfiles,
    getActiveProfile,
    setActiveProfile,
    addProfile 
  } = useEQProfileStore()
  
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [showCreateNewDialog, setShowCreateNewDialog] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  
  // Track the selected profile ID
  const [selectedProfileId, setSelectedProfileId] = useState<string>("")
  
//   const [activeTab, setActiveTab] = useState("eq")
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  
  // State for the reference calibration audio
  const [calibrationPlaying, setCalibrationPlaying] = useState(false)
  
  // State for the spectrum analyzer
  const [preEQAnalyser, setPreEQAnalyser] = useState<AnalyserNode | null>(null)
  
  // Ref for measuring the EQ component's width
  const eqContainerRef = useRef<HTMLDivElement>(null)
  
  // State for storing the measured width
  const [eqWidth, setEqWidth] = useState(800)
  
  // Measure the EQ component's width when it changes
  useEffect(() => {
    if (!eqContainerRef.current) return
    
    const updateWidth = () => {
      if (eqContainerRef.current) {
        setEqWidth(eqContainerRef.current.offsetWidth)
      }
    }
    
    // Initial measurement
    updateWidth()
    
    // Use ResizeObserver for more efficient dimension tracking
    const resizeObserver = new ResizeObserver(() => {
      updateWidth()
    })
    
    resizeObserver.observe(eqContainerRef.current)
    
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Sync local eqEnabled state with the store
  useEffect(() => {
    setEqEnabled(isEQEnabled);
  }, [isEQEnabled, setEqEnabled]);

  // Handle creating/removing analyzer when calibration playing state changes
  useEffect(() => {
    if (calibrationPlaying) {
      // Create and connect the analyzer for reference calibration
      const calibration = getReferenceCalibrationAudio();
      const analyser = calibration.createPreEQAnalyser();
      setPreEQAnalyser(analyser);
    } else {
      // Clean up when not playing
      setPreEQAnalyser(null);
    }
  }, [calibrationPlaying]);

  // Initialize selected profile from the active profile and keep it synced
  useEffect(() => {
    const activeProfile = getActiveProfile();
    if (activeProfile) {
      setSelectedProfileId(activeProfile.id);
    } else {
      // If no active profile, select the first available one
      const profiles = getProfiles();
      if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id);
        setActiveProfile(profiles[0].id);
      }
    }
  }, [getActiveProfile, getProfiles, setActiveProfile]);

  const handleProfileClick = () => {
    setNewProfileName("");
    setShowCreateNewDialog(true);
  }

  const handleSelectProfile = (profileId: string) => {
    // Just update the local selected profile ID
    // (The active profile is already set in the EQProfiles component)
    setSelectedProfileId(profileId);
  }

  const handleCreateNewProfile = () => {
    if (!newProfileName.trim()) return;
    
    // Create a new profile with a unique ID
    const newProfile = {
      id: uuidv4(),
      name: newProfileName.trim(),
      bands: [],
      volume: 0,
      lastModified: Date.now(),
      syncStatus: 'modified' as SyncStatus
    };
    
    // Add the new profile and select it
    addProfile(newProfile);
    setSelectedProfileId(newProfile.id);
    setActiveProfile(newProfile.id);
    
    // Close the dialog
    setShowCreateNewDialog(false);
  }

  const handleDistortionGainChange = (value: number[]) => {
    setDistortionGain(value[0])
  }

  // Format the gain as a percentage
  const formatDistortionGain = (gain: number): string => {
    return `${Math.round(gain * 100)}%`;
  }

  const toggleEQ = () => {
    setEQEnabled(!isEQEnabled);
  };

  // Comment out auto-calibration related state
  // const [showCalibrationProcess, setShowCalibrationProcess] = useState(false)

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
        <div className="flex gap-2">
          {/* Comment out the Auto-Calibrate EQ button */}
          {/* <Button 
            className="bg-electric-blue hover:bg-electric-blue/90 text-white" 
            onClick={startCalibration}
          >
            <Sliders className="mr-2 h-5 w-5" />
            Auto-Calibrate EQ
          </Button> */}
          <Button variant="outline" onClick={() => setShowCalibrationModal(true)}>
            <HelpCircle className="mr-2 h-5 w-5" />
            Tutorial
          </Button>
        </div>
      </div>

      {/* Main EQ View */}
      <div className="space-y-6">
        {/* EQ and Calibration in a side-by-side layout that stacks on small screens */}
        <div className="flex flex-col md:flex-row gap-4">
          {/* Frequency Graph (taking most of the width) */}
          <div className="flex-1 relative" ref={eqContainerRef}>
            {/* FFT Visualizer should always be visible during calibration */}
            {(calibrationPlaying) && preEQAnalyser && (
              <div className="absolute inset-0 z-0 w-full aspect-[2/1]">
                <FFTVisualizer 
                  analyser={preEQAnalyser} 
                  width={eqWidth} 
                  height={eqWidth / 2} 
                  className="w-full h-full"
                />
              </div>
            )}
            
            {/* FrequencyEQ component overlaid on top */}
            <div className="relative z-10">
              <FrequencyGraph 
                selectedDot={selectedDot} 
                disabled={!isEQEnabled} 
                className="w-full" 
                onInstructionChange={setInstruction}
                onRequestEnable={() => setEQEnabled(true)}
              />
            </div>

            {/* Contextual Instructions */}
            <div className="mt-1 mb-3 px-2 py-1.5 bg-muted/40 rounded text-sm text-muted-foreground border-l-2 border-electric-blue">
              {instruction}
            </div>

            {/* EQ Toggle Button - Updated for consistency */}
            <div className="eq-toggle-container">
              <Button
                variant={isEQEnabled ? "default" : "outline"}
                size="sm"
                className={isEQEnabled ? "bg-electric-blue hover:bg-electric-blue/90 text-white" : ""}
                onClick={toggleEQ}
                title={isEQEnabled ? "Turn EQ Off" : "Turn EQ On"}
              >
                <Power className="h-4 w-4 mr-2" />
                {isEQEnabled ? "EQ On" : "EQ Off"}
              </Button>
            </div>
          </div>

          {/* Calibration Panel (small width on desktop, full width on mobile) */}
          {/* 
          <div className="w-full md:w-64 bg-muted/50 p-4 rounded-lg">
            <h4 className="font-medium mb-3">Calibration</h4>
            
            <div className="mb-3">
              <ReferenceCalibration 
                isPlaying={calibrationPlaying}
                disabled={false}
              />
            </div>

            <Button
              size="sm"
              className="w-full bg-electric-blue hover:bg-electric-blue/90 text-white"
              onClick={() => setCalibrationPlaying(!calibrationPlaying)}
            >
              <Play className="mr-2 h-4 w-4" />
              {calibrationPlaying ? "Stop" : "Start"}
            </Button>
          </div>
          */}
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

        {/* Calibration Section - Commented out as requested */}
        {/*
        <div className="mt-8 border rounded-lg p-6 bg-card">
          <h3 className="text-lg font-medium mb-4">Reference Frequency Calibration</h3>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-3/5 space-y-5">
              <div>
                <h4 className="font-medium mb-2">Understanding the Reference Calibration</h4>
                <p className="text-muted-foreground">
                  The reference calibration tool helps you compare how your EQ affects different frequencies:
                </p>
                <ul className="list-disc pl-5 space-y-1 mt-2 text-sm text-muted-foreground">
                  <li>
                    <strong>Reference row (dashed line)</strong> plays fixed 800Hz sounds at different pan positions - NOT affected by EQ
                  </li>
                  <li>
                    <strong>Calibration row (solid line)</strong> plays at your chosen frequency - IS affected by your EQ settings
                  </li>
                  <li>
                    <strong>Compare the two</strong> to hear how your EQ enhances or reduces specific frequencies
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium mb-2">Calibration Steps</h4>
                <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                  <li>Press Play to start the calibration pattern</li>
                  <li>Listen to how the reference (800Hz) row sounds across the stereo field</li>
                  <li>
                    Compare with the calibration row at your chosen frequency
                  </li>
                  <li>
                    Drag the handle up/down to change the calibration frequency
                  </li>
                  <li>
                    Adjust your EQ until different frequencies are properly balanced against the reference
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
                      <strong>Check low frequencies</strong> - Often these need boosting (move the line to bottom area)
                    </li>
                    <li>
                      <strong>Check high frequencies</strong> - These may need reduction (move the line to top area)
                    </li>
                    <li>
                      <strong>Listen for panning differences</strong> - Both rows should have similar stereo imaging
                    </li>
                    <li>
                      <strong>Toggle EQ on/off</strong> - Compare with and without EQ to verify improvements
                    </li>
                    <li>
                      <strong>Test speech frequencies</strong> - Around 1kHz-4kHz for clarity
                    </li>
                  </ul>
                </details>
              </div>

              <InfoCircle>
                This calibration creates a personalized EQ tailored to your unique hearing and audio equipment,
                ensuring balanced frequency response across your entire audio spectrum.
              </InfoCircle>
            </div>

            <div className="md:w-2/5 flex flex-col justify-start">
              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-medium">Calibration Controls</h4>
                </div>

                <div className="mb-3">
                  <ReferenceCalibration 
                    isPlaying={calibrationPlaying}
                    disabled={false}
                  />
                </div>

                <Button
                  size="sm"
                  className="w-full bg-electric-blue hover:bg-electric-blue/90 text-white mb-2"
                  onClick={() => setCalibrationPlaying(!calibrationPlaying)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {calibrationPlaying ? "Stop Calibration" : "Start Calibration"}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Drag the handle up/down to change the calibration frequency
                </p>
              </div>
            </div>
          </div>
        </div>
        */}
      </div>

      {/* EQ Profiles Section */}
      <div className="mt-8">
        <h3 className="text-lg font-medium mb-4">EQ Profiles</h3>
        <EQProfiles
          onProfileClick={handleProfileClick}
          selectedProfile={selectedProfileId}
          onSelectProfile={handleSelectProfile}
        />
      </div>

      {/* Comment out the EQ Automatic Calibration Process Dialog */}
      {/* {showCalibrationProcess && (
        <Dialog open={showCalibrationProcess} onOpenChange={setShowCalibrationProcess}>
          <DialogContent className="sm:max-w-[850px] p-0">
            <EQCalibrationProcess 
              onComplete={handleCalibrationComplete} 
              onCancel={handleCalibrationCancel} 
            />
          </DialogContent>
        </Dialog>
      )} */}

      {/* Create New Profile Dialog */}
      <Dialog open={showCreateNewDialog} onOpenChange={setShowCreateNewDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New EQ Profile</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label htmlFor="profile-name" className="block text-sm font-medium mb-2">
              Profile Name
            </label>
            <Input
              id="profile-name"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="My Custom EQ"
              className="w-full"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateNewDialog(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-electric-blue hover:bg-electric-blue/90 text-white"
              onClick={handleCreateNewProfile}
              disabled={!newProfileName.trim()}
            >
              Create Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EQCalibrationModal open={showCalibrationModal} onClose={() => setShowCalibrationModal(false)} />
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SignupModal open={showSignupModal} onClose={() => setShowSignupModal(false)} />
    </div>
  )
}

