"use client"

import { useState, useEffect, useRef } from "react"
import { HelpCircle, Play, Power, Volume2, Sliders, Minus, Triangle } from "lucide-react"
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
import { ShapeGrid } from "@/components/shape-grid"
import { SoundstageExplorer } from "@/components/soundstage-explorer"
import { MultiDot3DExplorer } from "@/components/multi-dot-3d-explorer"
import * as glyphGridAudio from '@/lib/audio/glyphGridAudio'
import * as dotGridAudio from '@/lib/audio/dotGridAudio'
import * as shapeGridAudio from '@/lib/audio/shapeGridAudio'
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

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
  
  // Get the player state to control music playback
  const { isPlaying: isMusicPlaying, setIsPlaying: setMusicPlaying } = usePlayerStore()
  
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [showCreateNewDialog, setShowCreateNewDialog] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  
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

  // State for the soundstage explorer
  const [soundstageExplorerPlaying, setSoundstageExplorerPlaying] = useState(false)

  // State for the multi-dot 3D explorer
  const [multiDot3DPlaying, setMultiDot3DPlaying] = useState(false)

  // Add state for toggling between Glyph Grid and Dot Grid
  const [activeGrid, setActiveGrid] = useState<"line" | "dot" | "shape" | "explorer" | "3d">("dot")

  // New state to track selected dots for dot grid
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set());
  
  // Add state to track if the device is mobile
  const [isMobile, setIsMobile] = useState(false)

  // New states for the Shape Tool
  const [shapeToolPlaying, setShapeToolPlaying] = useState(false);
  const [numShapeDots, setNumShapeDots] = useState(12); // Default number of dots for the shape tool
  const [currentShapeType, setCurrentShapeType] = useState<'circle' | 'triangle' | 'five'>('circle');
  const [shapeGridStretch, setShapeGridStretch] = useState(3.0); // Default 1:3 aspect (3x wider than tall)
  const [shapeContinuousMode, setShapeContinuousMode] = useState(false); // Toggle between discrete dots and continuous sweep

  // New state for Dot Grid sub-hit playback mode
  const [isSubHitPlaybackEnabled, setIsSubHitPlaybackEnabled] = useState(false);

  // New states for Dot Grid speed and tilt range controls
  const [dotGridSpeedMultiplier, setDotGridSpeedMultiplier] = useState(1.0);
  const [dotGridTiltRangeMultiplier, setDotGridTiltRangeMultiplier] = useState(1.0);

  // New state for current glyph shape in Line Tool (GlyphGrid)
  const [currentGlyphShape, setCurrentGlyphShape] = useState<'line' | 'triangle'>('triangle');

  // New state for bandpass bandwidth control
  const [bandpassBandwidth, setBandpassBandwidth] = useState(2.0); // Default Q value

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

  // Add a new effect to handle the analyzer for shape tool
  useEffect(() => {
    if (shapeToolPlaying) {
      // Create and connect the analyzer for shape tool
      const shapeAudio = shapeGridAudio.getShapeGridAudioPlayer();
      const analyser = shapeAudio.createPreEQAnalyser();
      setPreEQAnalyser(analyser);
      console.log("💠 Connected shape tool to FFT analyzer");
    } else if (calibrationPlaying || glyphGridPlaying || dotGridPlaying || soundstageExplorerPlaying) {
      // Do nothing, handled by other effects
    } else {
      setPreEQAnalyser(null);
    }
  }, [shapeToolPlaying, calibrationPlaying, glyphGridPlaying, dotGridPlaying, soundstageExplorerPlaying]);

  // Add a new effect to handle the analyzer for soundstage explorer
  useEffect(() => {
    if (soundstageExplorerPlaying) {
      // Note: soundstage explorer doesn't have a createPreEQAnalyser method yet
      // We'll need to add it or use a different approach
      // For now, we'll skip the analyzer for soundstage explorer
      console.log("🎭 Soundstage explorer playing");
    } else if (calibrationPlaying || glyphGridPlaying || dotGridPlaying || shapeToolPlaying) {
      // Do nothing, handled by other effects
    } else {
      setPreEQAnalyser(null);
    }
  }, [soundstageExplorerPlaying, calibrationPlaying, glyphGridPlaying, dotGridPlaying, shapeToolPlaying]);

  // Sync continuous mode with shape grid audio
  useEffect(() => {
    const shapeAudio = shapeGridAudio.getShapeGridAudioPlayer();
    shapeAudio.setContinuousMode(shapeContinuousMode);
  }, [shapeContinuousMode]);

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
      if (shapeToolPlaying) {
        setShapeToolPlaying(false);
      }
      if (soundstageExplorerPlaying) {
        setSoundstageExplorerPlaying(false);
      }
    }
  }, [isMusicPlaying, dotGridPlaying, glyphGridPlaying, shapeToolPlaying, soundstageExplorerPlaying]);

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
    if (shapeToolPlaying) setShapeToolPlaying(false); // Stop shape tool if dot grid starts
  };

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
            {(calibrationPlaying || glyphGridPlaying || dotGridPlaying || shapeToolPlaying || soundstageExplorerPlaying) && preEQAnalyser && (
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
            </div>
          </div>

          {/* Grid Visualizer - Now takes less width */}
          <div className="w-1/4 bg-gray-100 dark:bg-card rounded-lg p-4">
            <div className="flex flex-col space-y-4">
              {/* Updated segmented control with shape tool first */}
              <div className="flex flex-col gap-2">
                <div className="flex border rounded-md overflow-hidden w-fit">
                  <button
                    className={`px-4 py-2 text-sm font-medium ${
                      activeGrid === "shape"
                        ? "bg-teal-500 text-white"
                        : "bg-background hover:bg-muted"
                    }`}
                    onClick={() => setActiveGrid("shape")}
                  >
                    Shape Tool
                  </button>
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
                <div className="flex border rounded-md overflow-hidden w-fit">
                  <button
                    className={`px-4 py-2 text-sm font-medium ${
                      activeGrid === "explorer"
                        ? "bg-purple-500 text-white"
                        : "bg-background hover:bg-muted"
                    }`}
                    onClick={() => setActiveGrid("explorer")}
                  >
                    Soundstage Explorer
                  </button>
                </div>
                <div className="flex border rounded-md overflow-hidden w-fit">
                  <button
                    className={`px-4 py-2 text-sm font-medium ${
                      activeGrid === "3d"
                        ? "bg-purple-500 text-white"
                        : "bg-background hover:bg-muted"
                    }`}
                    onClick={() => setActiveGrid("3d")}
                  >
                    3D Multi-Dot
                  </button>
                </div>
              </div>
            </div>
            
            {/* Grid content area */}
            <div className="mt-4">
              {activeGrid === "3d" ? (
                <MultiDot3DExplorer
                  isPlaying={multiDot3DPlaying}
                  setIsPlaying={setMultiDot3DPlaying}
                  disabled={false}
                />
              ) : activeGrid === "explorer" ? (
                <SoundstageExplorer
                  isPlaying={soundstageExplorerPlaying}
                  setIsPlaying={setSoundstageExplorerPlaying}
                  disabled={false}
                />
              ) : activeGrid === "shape" ? (
                <>
                  <ShapeGrid
                    isPlaying={shapeToolPlaying}
                    disabled={false}
                    numDots={numShapeDots}
                    shapeType={currentShapeType}
                    stretchFactor={shapeGridStretch}
                  />

                  {/* Shape type selector */}
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-muted-foreground text-center">Shape Type:</p>
                    <div className="flex justify-center gap-2">
                      <Button
                        variant={currentShapeType === 'circle' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentShapeType('circle')}
                        className={currentShapeType === 'circle' ? "bg-sky-500 hover:bg-sky-600 text-white" : ""}
                      >
                        Circle
                      </Button>
                      <Button
                        variant={currentShapeType === 'triangle' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentShapeType('triangle')}
                        className={currentShapeType === 'triangle' ? "bg-sky-500 hover:bg-sky-600 text-white" : ""}
                      >
                        <Triangle className="mr-1 h-4 w-4" /> Triangle
                      </Button>
                      <Button
                        variant={currentShapeType === 'five' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentShapeType('five')}
                        className={currentShapeType === 'five' ? "bg-sky-500 hover:bg-sky-600 text-white" : ""}
                      >
                        5
                      </Button>
                    </div>
                  </div>

                  {/* Number of dots slider */}
                  <div className="flex flex-col items-center gap-2 mt-4">
                    <label htmlFor="num-shape-dots" className="text-sm">Number of Dots: {numShapeDots}</label>
                    <Slider
                      id="num-shape-dots"
                      min={4}
                      max={32}
                      step={1}
                      value={[numShapeDots]}
                      onValueChange={(value) => setNumShapeDots(value[0])}
                      className="w-3/4"
                    />
                  </div>

                  {/* Grid stretch factor slider */}
                  <div className="flex flex-col items-center gap-2 mt-4">
                    <label htmlFor="shape-grid-stretch" className="text-sm">Grid Stretch: 1:{shapeGridStretch.toFixed(1)}</label>
                    <Slider
                      id="shape-grid-stretch"
                      min={1}
                      max={10}
                      step={0.5}
                      value={[shapeGridStretch]}
                      onValueChange={(value) => setShapeGridStretch(value[0])}
                      className="w-3/4"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Wider grid = shapes spread horizontally
                    </p>
                  </div>

                  {/* Continuous mode toggle */}
                  <div className="flex items-center justify-center gap-3 mt-4">
                    <Switch
                      id="shape-continuous-mode"
                      checked={shapeContinuousMode}
                      onCheckedChange={setShapeContinuousMode}
                    />
                    <Label htmlFor="shape-continuous-mode" className="text-sm cursor-pointer">
                      Continuous Sweep Mode
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-1">
                    {shapeContinuousMode
                      ? "Smoothly sweeps around shape perimeter"
                      : "Plays discrete dots sequentially"}
                  </p>
                </>
              ) : activeGrid === "line" ? (
                <GlyphGrid
                  isPlaying={glyphGridPlaying}
                  disabled={false}
                  glyphType={currentGlyphShape}
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

              {/* Add Toggle for Dot Grid Sub-Hit Playback Mode */} 
              {activeGrid === "dot" && (
                <div className="space-y-4 mt-4">
                  <div className="flex items-center space-x-2 justify-center">
                    <Switch 
                      id="subhit-playback-toggle"
                      checked={isSubHitPlaybackEnabled}
                      onCheckedChange={(checked) => {
                        setIsSubHitPlaybackEnabled(checked);
                        dotGridAudio.getDotGridAudioPlayer().setSubHitPlaybackEnabled(checked);
                      }}
                    />
                    <Label htmlFor="subhit-playback-toggle" className="text-sm text-muted-foreground">
                      {isSubHitPlaybackEnabled ? "Sub-Hits Enabled" : "Continuous Play"}
                    </Label>
                  </div>

                  {/* Speed Control Slider */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="dot-speed-slider" className="text-xs text-muted-foreground">Speed</Label>
                      <span className="text-xs text-muted-foreground">{dotGridSpeedMultiplier.toFixed(1)}x</span>
                    </div>
                    <Slider 
                      id="dot-speed-slider"
                      min={0.1} 
                      max={3.0} 
                      step={0.1} 
                      value={[dotGridSpeedMultiplier]} 
                      onValueChange={(value) => {
                        const newSpeed = value[0];
                        setDotGridSpeedMultiplier(newSpeed);
                        dotGridAudio.getDotGridAudioPlayer().setSpeed(newSpeed);
                      }}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Slower</span>
                      <span>Faster</span>
                    </div>
                  </div>

                  {/* Tilt Range Control Slider */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="dot-tilt-slider" className="text-xs text-muted-foreground">Tilt Range</Label>
                      <span className="text-xs text-muted-foreground">{dotGridTiltRangeMultiplier.toFixed(1)}x</span>
                    </div>
                    <Slider 
                      id="dot-tilt-slider"
                      min={0.1} 
                      max={2.5} 
                      step={0.1} 
                      value={[dotGridTiltRangeMultiplier]} 
                      onValueChange={(value) => {
                        const newTilt = value[0];
                        setDotGridTiltRangeMultiplier(newTilt);
                        // TODO: Implement setTiltRangeMultiplier method in dotGridAudio if needed
                      }}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Subtle</span>
                      <span>Extreme</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Add Bandwidth Control for Bandpassed Noise Mode */}
              {activeGrid === "dot" && dotGridAudio.getSoundMode() === 'bandpassed' && (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Bandwidth</span>
                    <span className="text-muted-foreground">Q: {bandpassBandwidth.toFixed(1)}</span>
                  </div>
                  <Slider
                    value={[bandpassBandwidth]}
                    min={0.5}
                    max={10.0}
                    step={0.1}
                    onValueChange={(value) => {
                      setBandpassBandwidth(value[0]);
                      dotGridAudio.setBandpassBandwidth(value[0]);
                    }}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Wide</span>
                    <span>Narrow</span>
                  </div>
                </div>
              )}

              {/* UI for selecting glyph shape when Line Tool is active */} 
              {activeGrid === "line" && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-muted-foreground text-center">Shape Type:</p>
                  <div className="flex justify-center gap-2">
                    <Button 
                      variant={currentGlyphShape === 'line' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentGlyphShape('line')}
                      className={currentGlyphShape === 'line' ? "bg-sky-500 hover:bg-sky-600 text-white" : ""}
                    >
                      <Minus className="mr-1 h-4 w-4" /> Line
                    </Button>
                    <Button 
                      variant={currentGlyphShape === 'triangle' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentGlyphShape('triangle')}
                      className={currentGlyphShape === 'triangle' ? "bg-sky-500 hover:bg-sky-600 text-white" : ""}
                    >
                      <Triangle className="mr-1 h-4 w-4" /> Triangle
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Play button moved to bottom of grid section - hide for explorer since it auto-starts */}
            {activeGrid !== "explorer" && (
              <div className="flex justify-center mt-6">
                <Button
                  size="lg"
                  variant={activeGrid === "line" ? (glyphGridPlaying ? "default" : "outline")
                            : activeGrid === "dot" ? (dotGridPlaying ? "default" : "outline")
                            : (shapeToolPlaying ? "default" : "outline")}
                  className={activeGrid === "line" ? (glyphGridPlaying ? "bg-teal-500 hover:bg-teal-600 text-white" : "")
                              : activeGrid === "dot" ? (dotGridPlaying ? "bg-teal-500 hover:bg-teal-600 text-white" : "")
                              : (shapeToolPlaying ? "bg-teal-500 hover:bg-teal-600 text-white" : "")}
                  onClick={() => {
                    if (activeGrid === "line") {
                      setGlyphGridPlaying(!glyphGridPlaying);
                      if (dotGridPlaying) setDotGridPlaying(false);
                      if (shapeToolPlaying) setShapeToolPlaying(false);
                      if (soundstageExplorerPlaying) setSoundstageExplorerPlaying(false);
                      if (!glyphGridPlaying && isMusicPlaying) setMusicPlaying(false);
                    } else if (activeGrid === "dot") {
                      handleDotGridPlayToggle();
                      if (shapeToolPlaying) setShapeToolPlaying(false);
                      if (soundstageExplorerPlaying) setSoundstageExplorerPlaying(false);
                    } else {
                      setShapeToolPlaying(!shapeToolPlaying);
                      if (dotGridPlaying) setDotGridPlaying(false);
                      if (glyphGridPlaying) setGlyphGridPlaying(false);
                      if (soundstageExplorerPlaying) setSoundstageExplorerPlaying(false);
                      if (!shapeToolPlaying && isMusicPlaying) setMusicPlaying(false);
                    }
                  }}
                >
                  <Play className="mr-2 h-5 w-5" />
                  {activeGrid === "line"
                    ? (glyphGridPlaying ? "Stop Calibration" : "Play Calibration")
                    : activeGrid === "dot"
                      ? (dotGridPlaying ? "Stop Calibration" : "Play Calibration")
                      : (shapeToolPlaying ? "Stop Calibration" : "Play Calibration")}
                </Button>
              </div>
            )}
            
            {/* Tutorial button replacing help text link */}
            <div className="flex justify-center mt-3">
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
    </div>
  )
}

