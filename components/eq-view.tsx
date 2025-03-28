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
import { DotCalibration } from "@/components/dot-grid"
import { GlyphGrid } from "@/components/glyph-grid"
import * as glyphGridAudio from '@/lib/audio/glyphGridAudio'
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

  // State for the dot grid
  const [dotGridPlaying, setDotGridPlaying] = useState(false)
  
  // State for the glyph grid
  const [glyphGridPlaying, setGlyphGridPlaying] = useState(false)
  
  // Add state for tracking current audio parameters
  const [currentFrequency, setCurrentFrequency] = useState<number>(0);
  const [currentPanning, setCurrentPanning] = useState<number>(0);

  // Add state for toggling between Glyph Grid and Dot Grid
  const [activeGrid, setActiveGrid] = useState<"glyph" | "dot">("glyph");

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
    } else if (glyphGridPlaying) {
      // Do nothing, handled by the glyph grid effect
      // This prevents clearing analyzer if calibration stops but glyph is playing
    } else {
      // Clean up when not playing
      setPreEQAnalyser(null);
    }
  }, [calibrationPlaying, glyphGridPlaying]);

  // Add a new effect to handle the analyzer for glyph grid
  useEffect(() => {
    if (glyphGridPlaying) {
      // Create and connect the analyzer for glyph grid
      const glyphAudio = glyphGridAudio.getGlyphGridAudioPlayer();
      const analyser = glyphAudio.createPreEQAnalyser();
      setPreEQAnalyser(analyser);
    } else if (calibrationPlaying) {
      // Do nothing, handled by the calibration effect
      // This prevents clearing analyzer if glyph stops but calibration is playing
    } else {
      // Clean up when not playing
      setPreEQAnalyser(null);
    }
  }, [glyphGridPlaying, calibrationPlaying]);

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

  // Add function to format frequency
  const formatFrequency = (freq: number): string => {
    if (freq < 1000) {
      return `${Math.round(freq)} Hz`;
    } else {
      return `${(freq / 1000).toFixed(1)} kHz`;
    }
  };

  // Add effect to update frequency and panning info
  useEffect(() => {
    if (!glyphGridPlaying) {
      setCurrentFrequency(0);
      setCurrentPanning(0);
      return;
    }
    
    // Function to update current audio parameters
    const updateAudioInfo = () => {
      const audio = glyphGridAudio.getGlyphGridAudioPlayer();
      const { frequency, panning } = audio.getAudioParameters();
      setCurrentFrequency(frequency);
      setCurrentPanning(panning);
      requestAnimationFrame(updateAudioInfo);
    };
    
    const frameId = requestAnimationFrame(updateAudioInfo);
    return () => cancelAnimationFrame(frameId);
  }, [glyphGridPlaying]);

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
        {/* EQ Section - Now takes full width */}
        <div className="w-full relative" ref={eqContainerRef}>
          {/* FFT Visualizer should always be visible during audio playback */}
          {(calibrationPlaying || glyphGridPlaying) && preEQAnalyser && (
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
          
          {/* Audio Parameters Display for Glyph Grid */}
          {glyphGridPlaying && (
            <div className="mt-4 flex justify-between text-sm">
              <div className="px-3 py-1.5 bg-muted/40 rounded-md">
                <span className="font-medium">Frequency:</span> {formatFrequency(currentFrequency)}
              </div>
              <div className="px-3 py-1.5 bg-muted/40 rounded-md">
                <span className="font-medium">Pan Position:</span> {currentPanning.toFixed(2)}
              </div>
            </div>
          )}
        </div>

        {/* Glyph Grid - Now below the EQ section with new layout */}
        <div className="mt-8 border rounded-lg p-6 bg-card">
          <div className="flex flex-col space-y-4">
            <h3 className="text-lg font-medium">Grid Visualizer</h3>
            
            {/* Add segmented control for switching between grid types */}
            <div className="flex border rounded-md overflow-hidden w-fit">
              <button
                className={`px-4 py-2 text-sm font-medium ${
                  activeGrid === "glyph" 
                    ? "bg-electric-blue text-white" 
                    : "bg-background hover:bg-muted"
                }`}
                onClick={() => setActiveGrid("glyph")}
              >
                Glyph Grid
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium ${
                  activeGrid === "dot" 
                    ? "bg-electric-blue text-white" 
                    : "bg-background hover:bg-muted"
                }`}
                onClick={() => setActiveGrid("dot")}
              >
                Dot Grid
              </button>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-6 mt-4">
            {/* Left side: Grid Canvas */}
            <div className="md:w-1/2">
              <div className="bg-muted/30 p-4 rounded-lg">
                {activeGrid === "glyph" ? (
                  <GlyphGrid
                    isPlaying={glyphGridPlaying}
                    disabled={false}
                  />
                ) : (
                  <DotCalibration
                    isPlaying={dotGridPlaying}
                    disabled={false}
                  />
                )}
              </div>
            </div>
            
            {/* Right side: Controls */}
            <div className="md:w-1/2 flex flex-col justify-between">
              {/* Play button is now in the right column but at the bottom */}
              <div className="flex justify-center mt-4">
                <Button
                  size="lg"
                  variant={activeGrid === "glyph" ? (glyphGridPlaying ? "default" : "outline") : (dotGridPlaying ? "default" : "outline")}
                  className={activeGrid === "glyph" ? (glyphGridPlaying ? "bg-electric-blue hover:bg-electric-blue/90 text-white" : "") : (dotGridPlaying ? "bg-electric-blue hover:bg-electric-blue/90 text-white" : "")}
                  onClick={() => {
                    if (activeGrid === "glyph") {
                      setGlyphGridPlaying(!glyphGridPlaying);
                      if (dotGridPlaying) setDotGridPlaying(false);
                    } else {
                      setDotGridPlaying(!dotGridPlaying);
                      if (glyphGridPlaying) setGlyphGridPlaying(false);
                    }
                  }}
                >
                  <Play className="mr-2 h-5 w-5" />
                  {activeGrid === "glyph" 
                    ? (glyphGridPlaying ? "Stop" : "Play") 
                    : (dotGridPlaying ? "Stop" : "Play")}
                </Button>
              </div>
            </div>
          </div>
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

      {/* Dialogs remain the same */}
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

