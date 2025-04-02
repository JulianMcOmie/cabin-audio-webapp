"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { HelpCircle, Play, Power, Volume2, Sliders, ChevronLeft, ChevronRight, Check, Move, Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FrequencyGraph } from "@/components/frequency-graph"
import { EQProfiles } from "@/components/eq-profiles"
import { EQCalibrationModal } from "@/components/eq-calibration-modal"
import { LoginModal } from "@/components/login-modal"
import { SignupModal } from "@/components/signup-modal"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { usePlayerStore } from "@/lib/stores"
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
import * as dotGridAudio from '@/lib/audio/dotGridAudio'
import { FrequencyEQ } from "@/components/parametric-eq/FrequencyEQ"

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
    addProfile,
    updateProfile
  } = useEQProfileStore()
  
  // Get the player state to control music playback
  const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore()
  
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [showCreateNewDialog, setShowCreateNewDialog] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  
  // Auto-calibration state
  const [showAutoCalibration, setShowAutoCalibration] = useState(false)
  const [calibrationStep, setCalibrationStep] = useState(0)
  const [calibrationConfig, setCalibrationConfig] = useState({
    bassBoost: 0,  // -12 to 12 dB
    trebleBoost: 0,  // -12 to 12 dB
    midBoost: 0,  // -12 to 12 dB
    lowMidBoost: 0,  // -12 to 12 dB
    highMidBoost: 0,  // -12 to 12 dB
  })
  const calibrationDotsRef = useRef<{
    highLeft: string,
    highRight: string,
    lowLeft: string,
    lowRight: string,
    mid: string,
    lowMid: string,
    highMid: string
  }>({
    highLeft: "0,0",
    highRight: "4,0",
    lowLeft: "0,4",
    lowRight: "4,4",
    mid: "2,2",
    lowMid: "2,3",
    highMid: "2,1"
  })
  
  // Track the selected profile ID
  const [selectedProfileId, setSelectedProfileId] = useState<string>("")
  
//   const [activeTab, setActiveTab] = useState("eq")
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  
  // State for the reference calibration audio
  const [calibrationPlaying] = useState(false)
  
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
  
  // Add state for toggling between Glyph Grid and Dot Grid
  const [activeGrid, setActiveGrid] = useState<"line" | "dot">("dot");

  // New state to track selected dots for dot grid
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set());
  
  // Add state to track if the device is mobile
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile devices
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    // Check initially
    checkMobile()
    
    // Set up listener for resize
    window.addEventListener('resize', checkMobile)
    
    // Cleanup
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

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
    } else if (calibrationPlaying || dotGridPlaying) {
      // Do nothing, handled by the calibration effect or dot grid effect
      // This prevents clearing analyzer if glyph stops but others are playing
    } else {
      // Clean up when not playing
      setPreEQAnalyser(null);
    }
  }, [glyphGridPlaying, calibrationPlaying, dotGridPlaying]);

  // Add a new effect to handle the analyzer for dot grid
  useEffect(() => {
    if (dotGridPlaying) {
      // Create and connect the analyzer for dot grid
      const dotAudio = dotGridAudio.getDotGridAudioPlayer();
      const analyser = dotAudio.createPreEQAnalyser();
      setPreEQAnalyser(analyser);
      
      console.log("🎯 Connected dot grid to FFT analyzer");
    } else if (calibrationPlaying || glyphGridPlaying) {
      // Do nothing, handled by other effects
      // This prevents clearing analyzer if dot grid stops but others are playing
    } else {
      // Clean up when not playing
      setPreEQAnalyser(null);
    }
  }, [dotGridPlaying, calibrationPlaying, glyphGridPlaying]);

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

  // Add effect to update frequency and panning info
  useEffect(() => {
    if (!glyphGridPlaying) {
      return;
    }
    
    // Function to update current audio parameters
    const updateAudioInfo = () => {
      requestAnimationFrame(updateAudioInfo);
    };
    
    const frameId = requestAnimationFrame(updateAudioInfo);
    return () => cancelAnimationFrame(frameId);
  }, [glyphGridPlaying]);

  // Add effect to stop calibration when music starts playing
  useEffect(() => {
    // If music starts playing, stop any active calibration
    if (isMusicPlaying) {
      if (dotGridPlaying) {
        setDotGridPlaying(false);
      }
      if (glyphGridPlaying) {
        setGlyphGridPlaying(false);
      }
    }
  }, [isMusicPlaying, dotGridPlaying, glyphGridPlaying]);

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

  // Add a function to handle dot grid play/stop
  const handleDotGridPlayToggle = () => {
    if (dotGridPlaying) {
      // Just stop playing without clearing dot selection
      setDotGridPlaying(false);
    } else {
      // If music is playing, pause it
      if (isMusicPlaying) {
        setMusicPlaying(false);
      }
      
      // If starting and there are no dots selected, don't start
      // (this is handled by the DotCalibration component internally)
      setDotGridPlaying(true);
    }
    
    // Stop the glyph grid if it's playing
    if (glyphGridPlaying) setGlyphGridPlaying(false);
  };

  // Function to apply calibration to EQ
  const applyCalibrationToEQ = () => {
    // Get the active profile
    const activeProfile = getActiveProfile();
    if (!activeProfile) return;
    
    // Create a new profile with the calibration settings
    const newBands = [
      // Bass band (around 60Hz)
      {
        id: uuidv4(),
        frequency: 60,
        gain: calibrationConfig.bassBoost,
        q: 1.2, // Wide band
        type: "peaking" as const
      },
      // Low-mid band (around 250Hz)
      {
        id: uuidv4(),
        frequency: 250,
        gain: calibrationConfig.lowMidBoost,
        q: 1.0, // Medium width
        type: "peaking" as const
      },
      // Mid band (around 1000Hz)
      {
        id: uuidv4(),
        frequency: 1000,
        gain: calibrationConfig.midBoost,
        q: 1.0, // Medium width
        type: "peaking" as const
      },
      // High-mid band (around 3500Hz)
      {
        id: uuidv4(),
        frequency: 3500,
        gain: calibrationConfig.highMidBoost,
        q: 1.0, // Medium width
        type: "peaking" as const
      },
      // Treble band (around 10000Hz)
      {
        id: uuidv4(),
        frequency: 10000,
        gain: calibrationConfig.trebleBoost,
        q: 1.2, // Wide band
        type: "peaking" as const
      }
    ];
    
    // Create a new calibrated profile
    const calibratedProfile = {
      ...activeProfile,
      bands: newBands,
      name: activeProfile.name + " (Calibrated)",
      id: uuidv4(),
      lastModified: Date.now(),
      syncStatus: 'modified' as SyncStatus
    };
    
    // Add the new profile and select it
    addProfile(calibratedProfile);
    setActiveProfile(calibratedProfile.id);
    setSelectedProfileId(calibratedProfile.id);
    
    // Enable EQ if not already enabled
    if (!isEQEnabled) {
      setEQEnabled(true);
    }
    
    // Close auto-calibration modal
    setShowAutoCalibration(false);
  };
  
  // Helper function to get dots for current calibration step
  const getCurrentCalibrationDots = () => {
    const dots = new Set<string>();
    const { highLeft, highRight, lowLeft, lowRight, mid, lowMid, highMid } = calibrationDotsRef.current;
    
    // Determine which dots to show based on current step
    switch (calibrationStep) {
      case 0: // Bass step - show low dots
        dots.add(lowLeft);
        dots.add(lowRight);
        break;
      case 1: // Treble step - show high dots
        dots.add(highLeft);
        dots.add(highRight);
        break;
      case 2: // Mid calibration
        dots.add(mid);
        break;
      case 3: // Low-mid calibration
        dots.add(lowMid);
        break;
      case 4: // High-mid calibration
        dots.add(highMid);
        break;
      default:
        break;
    }
    
    return dots;
  };

  // Add a random movement effect for EQ bands
  const [randomModeActive, setRandomModeActive] = useState(false)
  const randomModeIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const targetFrequenciesRef = useRef<Map<string, number>>(new Map())
  // Add a ref for the timer that generates new positions
  const newPositionsTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Add state for random mode speed
  const [randomModeSpeed, setRandomModeSpeed] = useState(0.5) // 0.0 to 1.0
  
  useEffect(() => {
    if (!randomModeActive || !isEQEnabled) {
      // Clear intervals if random mode is off or EQ is disabled
      if (randomModeIntervalRef.current) {
        clearInterval(randomModeIntervalRef.current)
        randomModeIntervalRef.current = null
      }
      if (newPositionsTimerRef.current) {
        clearTimeout(newPositionsTimerRef.current)
        newPositionsTimerRef.current = null
      }
      // Clear target frequencies
      targetFrequenciesRef.current.clear()
      return
    }
    
    const activeProfile = getActiveProfile()
    if (!activeProfile || activeProfile.bands.length === 0) return
    
    // Function to generate a random frequency across the audio spectrum
    function getRandomFrequency() {
      // Use logarithmic distribution for frequencies to sound more natural
      // 20Hz to 20kHz (covers the full audible range)
      const minLog = Math.log(20)
      const maxLog = Math.log(20000)
      const randomLog = minLog + Math.random() * (maxLog - minLog)
      return Math.exp(randomLog)
    }
    
    // Function to assign new random targets to all bands
    function assignNewTargets() {
      const currentProfile = getActiveProfile();
      if (!currentProfile || currentProfile.bands.length === 0) return;
      
      currentProfile.bands.forEach(band => {
        const randomFreq = getRandomFrequency()
        targetFrequenciesRef.current.set(band.id, randomFreq)
      })
      
      // Schedule the next target assignment
      // Use speed to determine interval - faster speed = shorter interval
      const interval = Math.max(1000, 5000 * (1 - randomModeSpeed));
      newPositionsTimerRef.current = setTimeout(assignNewTargets, interval)
    }
    
    // Initialize targets for any bands that don't have them yet
    activeProfile.bands.forEach(band => {
      if (!targetFrequenciesRef.current.has(band.id)) {
        targetFrequenciesRef.current.set(band.id, band.frequency)
      }
    })
    
    // Initial assignment of random targets
    assignNewTargets()
    
    // Set up interval for smooth movements toward target frequencies
    randomModeIntervalRef.current = setInterval(() => {
      // Get the latest profile to ensure we're working with current data
      const currentProfile = getActiveProfile();
      if (!currentProfile || currentProfile.bands.length === 0) return;
      
      const updatedBands = currentProfile.bands.map(band => {
        // Get current target frequency for this band
        const targetFreq = targetFrequenciesRef.current.get(band.id) || band.frequency
        
        // Calculate step size - adjusted by speed setting
        const distance = targetFreq - band.frequency
        // Faster movement with higher speed (up to 25% of distance per step at max speed)
        const speedFactor = 0.05 + (randomModeSpeed * 0.20)
        const step = distance * speedFactor
        
        // Apply the step
        let newFrequency = band.frequency + step
        
        // Ensure we stay within audible range
        newFrequency = Math.max(20, Math.min(20000, newFrequency))
        
        // Keep the same band configuration, just update frequency
        return {
          ...band,
          frequency: newFrequency
        }
      })
      
      // Only update if there are changes
      if (updatedBands.some((band, i) => Math.abs(band.frequency - currentProfile.bands[i].frequency) > 0.1)) {
        // Update the profile with the new bands
        updateProfile(currentProfile.id, { bands: updatedBands })
      }
    }, 16) // Update at 60fps (approximately) for very smooth animation
    
    // Clean up intervals and targets on unmount or when disabled
    return () => {
      if (randomModeIntervalRef.current) {
        clearInterval(randomModeIntervalRef.current)
        randomModeIntervalRef.current = null
      }
      if (newPositionsTimerRef.current) {
        clearTimeout(newPositionsTimerRef.current)
        newPositionsTimerRef.current = null
      }
      targetFrequenciesRef.current.clear()
    }
  }, [randomModeActive, isEQEnabled, getActiveProfile, updateProfile, randomModeSpeed])
  
  // Handler for toggling random mode
  const toggleRandomMode = useCallback(() => {
    setRandomModeActive(prev => !prev)
  }, [])

  // Handler for random mode speed slider
  const handleRandomSpeedChange = useCallback((values: number[]) => {
    setRandomModeSpeed(values[0])
  }, [])

  // If on mobile, show a message instead of the EQ interface
  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center p-6">
        <div className="w-24 h-24 mb-6 text-gray-400">
          <Sliders className="w-full h-full" />
        </div>
        <h2 className="text-2xl font-semibold mb-3">EQ Functionality</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          For the best experience with our advanced EQ functionality, please use Cabin Audio on a desktop computer.
        </p>
        <p className="text-sm text-muted-foreground">
          The detailed frequency controls and visualization require a larger screen for precise adjustments.
        </p>
      </div>
    )
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
        {/* Combined EQ and Grid Layout */}
        <div className="flex flex-row gap-6">
          {/* EQ Section - Now takes more of the width */}
          <div className="w-3/4 relative" ref={eqContainerRef}>
            {/* FFT Visualizer should always be visible during audio playback */}
            {(calibrationPlaying || glyphGridPlaying || dotGridPlaying) && preEQAnalyser && (
              <div className="absolute inset-0 z-0">
                <div className="w-full aspect-[2/1] frequency-graph rounded-lg border dark:border-gray-700 overflow-hidden opacity-80 relative pointer-events-none">
                  {/* The actual EQ visualization area has 40px margins on all sides */}
                  <div className="absolute inset-0 m-[40px]">
                    <FFTVisualizer 
                      analyser={preEQAnalyser} 
                      width={eqWidth - 80} /* Subtract margins from width (40px * 2) */
                      height={(eqWidth / 2) - 80} /* Subtract margins from height (40px * 2) */
                      className="w-full h-full"
                    />
                  </div>
                </div>
              </div>
            )}
            
            {/* FrequencyEQ component overlaid on top */}
            <div className="relative z-10">
              <FrequencyEQ 
                disabled={!isEQEnabled}
                onInstructionChange={setInstruction}
                onRequestEnable={() => setEQEnabled(true)}
                randomModeActive={randomModeActive}
                className="w-full"
              />
            </div>

            {/* Contextual Instructions */}
            <div className="mt-1 mb-3 px-2 py-1.5 bg-muted/40 rounded text-sm text-muted-foreground border-l-2 border-electric-blue">
              {instruction}
            </div>

            {/* EQ Toggle Button */}
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
              
              {/* Random Mode Toggle Button */}
              <Button
                variant={randomModeActive ? "default" : "outline"}
                size="sm"
                className={`ml-2 ${randomModeActive ? "bg-teal-500 hover:bg-teal-600 text-white" : ""}`}
                onClick={toggleRandomMode}
                title={randomModeActive ? "Stop Random Frequency Mode" : "Start Random Frequency Mode"}
                disabled={!isEQEnabled}
              >
                <Shuffle className="h-4 w-4 mr-2" />
                {randomModeActive ? "Random On" : "Random Mode"}
              </Button>
              
              {/* Random Mode Speed Slider - Only show when random mode is active */}
              {randomModeActive && (
                <div className="ml-4 pl-4 border-l flex items-center gap-2" style={{ width: '200px' }}>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Speed:</span>
                  <Slider
                    value={[randomModeSpeed]}
                    min={0.1}
                    max={1.0}
                    step={0.1}
                    onValueChange={handleRandomSpeedChange}
                    className="flex-1"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Grid Visualizer - Now takes less width */}
          <div className="w-1/4 bg-gray-100 dark:bg-card rounded-lg p-4">
            <div className="flex flex-col space-y-4">
              {/* Updated segmented control with dot grid as default/left option */}
              <div className="flex border rounded-md overflow-hidden w-fit">
                <button
                  className={`px-4 py-2 text-sm font-medium ${
                    activeGrid === "dot" 
                      ? "bg-teal-500 text-white" 
                      : "bg-background hover:bg-muted"
                  }`}
                  onClick={() => setActiveGrid("dot")}
                >
                  Dot Grid
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium ${
                    activeGrid === "line" 
                      ? "bg-teal-500 text-white" 
                      : "bg-background hover:bg-muted"
                  }`}
                  onClick={() => setActiveGrid("line")}
                >
                  Line Tool
                </button>
              </div>
            </div>
            
            {/* Grid content area */}
            <div className="mt-4">
              {activeGrid === "line" ? (
                <GlyphGrid
                  isPlaying={glyphGridPlaying}
                  disabled={false}
                />
              ) : (
                <DotCalibration
                  isPlaying={dotGridPlaying}
                  setIsPlaying={setDotGridPlaying}
                  disabled={false}
                  preEQAnalyser={preEQAnalyser}
                  selectedDots={selectedDots}
                  setSelectedDots={setSelectedDots}
                />
              )}
            </div>
            
            {/* Play button moved to bottom of grid section */}
            <div className="flex justify-center mt-6">
              <Button
                size="lg"
                variant={activeGrid === "line" ? (glyphGridPlaying ? "default" : "outline") : (dotGridPlaying ? "default" : "outline")}
                className={activeGrid === "line" ? (glyphGridPlaying ? "bg-teal-500 hover:bg-teal-600 text-white" : "") : (dotGridPlaying ? "bg-teal-500 hover:bg-teal-600 text-white" : "")}
                onClick={() => {
                  if (activeGrid === "line") {
                    setGlyphGridPlaying(!glyphGridPlaying);
                    if (dotGridPlaying) setDotGridPlaying(false);
                    
                    // If enabling glyph grid playback and music is playing, pause the music
                    if (!glyphGridPlaying && isMusicPlaying) {
                      setMusicPlaying(false);
                    }
                  } else {
                    handleDotGridPlayToggle();
                  }
                }}
              >
                <Play className="mr-2 h-5 w-5" />
                {activeGrid === "line" 
                  ? (glyphGridPlaying ? "Stop Calibration" : "Play Calibration") 
                  : (dotGridPlaying ? "Stop Calibration" : "Play Calibration")}
              </Button>
            </div>
            
            {/* Tutorial button replacing help text link */}
            <div className="flex justify-center mt-3 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs bg-teal-500 hover:bg-teal-600 text-white"
                onClick={() => {
                  // Stop music if playing
                  if (isMusicPlaying) {
                    setMusicPlaying(false);
                  }
                  
                  // Stop any active calibration
                  if (dotGridPlaying) {
                    setDotGridPlaying(false);
                  }
                  if (glyphGridPlaying) {
                    setGlyphGridPlaying(false);
                  }
                  
                  // Reset calibration state
                  setCalibrationStep(0);
                  setCalibrationConfig({
                    bassBoost: 0,
                    trebleBoost: 0,
                    midBoost: 0,
                    lowMidBoost: 0,
                    highMidBoost: 0,
                  });
                  
                  // Show auto-calibration modal
                  setShowAutoCalibration(true);
                }}
              >
                <Sliders className="mr-1 h-3 w-3" />
                Auto-Calibrate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowCalibrationModal(true)}
              >
                <HelpCircle className="mr-1 h-3 w-3" />
                Tutorial
              </Button>
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
      
      {/* Auto-Calibration Modal */}
      <Dialog open={showAutoCalibration} onOpenChange={(open) => !open && setShowAutoCalibration(false)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Auto-Calibration {calibrationStep + 1}/5</DialogTitle>
          </DialogHeader>
          
          <div className="py-4 space-y-6">
            {/* Instructions based on current step */}
            <div className="text-sm p-4 bg-muted/20 rounded-lg border">
              {calibrationStep === 0 && (
                <p>Step 1: Adjust the bass boost slider until the low notes sound balanced between left and right. You should hear low bass tones alternating between left and right speakers.</p>
              )}
              {calibrationStep === 1 && (
                <p>Step 2: Adjust the treble boost slider until the high notes sound balanced between left and right. You should hear high treble tones alternating between left and right speakers.</p>
              )}
              {calibrationStep === 2 && (
                <p>Step 3: Adjust the mid control until it sounds centered and natural. You will hear a mid-range tone in the center.</p>
              )}
              {calibrationStep === 3 && (
                <p>Step 4: Fine-tune the low-mid frequencies to balance with the bass. This helps smooth the transition between bass and mid-range.</p>
              )}
              {calibrationStep === 4 && (
                <p>Step 5: Fine-tune the high-mid frequencies to balance with the treble. This helps smooth the transition between mid-range and treble.</p>
              )}
            </div>
            
            {/* Sliders */}
            <div className="space-y-6 p-4 border rounded-lg">
              {/* Bass Boost Slider - Show only in step 0 */}
              {calibrationStep === 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bass Boost</label>
                  <div className="flex items-center gap-4">
                    <span className="text-xs w-10 text-right">-12dB</span>
                    <Slider
                      value={[calibrationConfig.bassBoost]}
                      min={-12}
                      max={12}
                      step={0.5}
                      onValueChange={(value) => {
                        // Just update the state - we'll apply all changes at the end
                        const newConfig = {...calibrationConfig, bassBoost: value[0]};
                        setCalibrationConfig(newConfig);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs w-10">+12dB</span>
                    <span className="text-xs w-14 text-right">{calibrationConfig.bassBoost.toFixed(1)}dB</span>
                  </div>
                </div>
              )}
              
              {/* Treble Boost Slider - Show only in step 1 */}
              {calibrationStep === 1 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Treble Boost</label>
                  <div className="flex items-center gap-4">
                    <span className="text-xs w-10 text-right">-12dB</span>
                    <Slider
                      value={[calibrationConfig.trebleBoost]}
                      min={-12}
                      max={12}
                      step={0.5}
                      onValueChange={(value) => {
                        // Just update the state - we'll apply all changes at the end
                        const newConfig = {...calibrationConfig, trebleBoost: value[0]};
                        setCalibrationConfig(newConfig);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs w-10">+12dB</span>
                    <span className="text-xs w-14 text-right">{calibrationConfig.trebleBoost.toFixed(1)}dB</span>
                  </div>
                </div>
              )}
              
              {/* Mid Boost Slider - Show only in step 2 */}
              {calibrationStep === 2 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mid-range Boost</label>
                  <div className="flex items-center gap-4">
                    <span className="text-xs w-10 text-right">-12dB</span>
                    <Slider
                      value={[calibrationConfig.midBoost]}
                      min={-12}
                      max={12}
                      step={0.5}
                      onValueChange={(value) => {
                        // Just update the state - we'll apply all changes at the end
                        const newConfig = {...calibrationConfig, midBoost: value[0]};
                        setCalibrationConfig(newConfig);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs w-10">+12dB</span>
                    <span className="text-xs w-14 text-right">{calibrationConfig.midBoost.toFixed(1)}dB</span>
                  </div>
                </div>
              )}
              
              {/* Low-Mid Boost Slider - Show only in step 3 */}
              {calibrationStep === 3 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Low-Mid Boost</label>
                  <div className="flex items-center gap-4">
                    <span className="text-xs w-10 text-right">-12dB</span>
                    <Slider
                      value={[calibrationConfig.lowMidBoost]}
                      min={-12}
                      max={12}
                      step={0.5}
                      onValueChange={(value) => {
                        // Just update the state - we'll apply all changes at the end
                        const newConfig = {...calibrationConfig, lowMidBoost: value[0]};
                        setCalibrationConfig(newConfig);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs w-10">+12dB</span>
                    <span className="text-xs w-14 text-right">{calibrationConfig.lowMidBoost.toFixed(1)}dB</span>
                  </div>
                </div>
              )}
              
              {/* High-Mid Boost Slider - Show only in step 4 */}
              {calibrationStep === 4 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">High-Mid Boost</label>
                  <div className="flex items-center gap-4">
                    <span className="text-xs w-10 text-right">-12dB</span>
                    <Slider
                      value={[calibrationConfig.highMidBoost]}
                      min={-12}
                      max={12}
                      step={0.5}
                      onValueChange={(value) => {
                        // Just update the state - we'll apply all changes at the end
                        const newConfig = {...calibrationConfig, highMidBoost: value[0]};
                        setCalibrationConfig(newConfig);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs w-10">+12dB</span>
                    <span className="text-xs w-14 text-right">{calibrationConfig.highMidBoost.toFixed(1)}dB</span>
                  </div>
                </div>
              )}

              {/* Hidden Dot Calibration - We still need this for audio generation but don't display it */}
              <div className="hidden">
                <DotCalibration
                  isPlaying={true}
                  setIsPlaying={() => {}}
                  disabled={false}
                  selectedDots={getCurrentCalibrationDots()}
                  setSelectedDots={() => {}}
                />
              </div>
            </div>
          </div>
          
          {/* Navigation Buttons with improved visibility */}
          <DialogFooter className="flex justify-between pt-4 border-t">
            <div>
              {calibrationStep > 0 && (
                <Button 
                  variant="outline" 
                  onClick={() => setCalibrationStep(prev => prev - 1)}
                  className="mr-2"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
              )}
            </div>
            
            <div>
              {calibrationStep < 4 ? (
                <Button 
                  size="lg"
                  className="bg-teal-500 hover:bg-teal-600 text-white font-medium"
                  onClick={() => setCalibrationStep(prev => prev + 1)}
                >
                  Next Step
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button 
                  size="lg"
                  className="bg-teal-500 hover:bg-teal-600 text-white font-medium"
                  onClick={applyCalibrationToEQ}
                >
                  Apply Calibration
                  <Check className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

