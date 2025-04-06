"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { HelpCircle, Play, Power, Volume2, Sliders } from "lucide-react"
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
  
  // Add state for multi-band control
  const [selectedBands, setSelectedBands] = useState<string[]>([])
  const [amplitudeMultiplier, setAmplitudeMultiplier] = useState(1.0) // Default to 1.0 (no change)
  const [amplitudeDifference, setAmplitudeDifference] = useState(0.0) // Default to 0.0 (no difference)
  
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

  // Add state for showing error messages
  const [importError, setImportError] = useState<string | null>(null);

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

  // Handle selected bands change from FrequencyEQ
  const handleSelectedBandsChange = useCallback((bandIds: string[]) => {
    setSelectedBands(bandIds);
    
    // Reset sliders when selection changes
    if (bandIds.length !== 2) {
      setAmplitudeMultiplier(1.0);
      setAmplitudeDifference(0.0);
    }
  }, []);
  
  // Apply amplitude adjustments to the selected bands
  const applyAmplitudeAdjustments = useCallback(() => {
    // Only proceed if exactly 2 bands are selected
    if (selectedBands.length !== 2) return;
    
    const profile = getActiveProfile();
    if (!profile) return;
    
    // Find the two selected bands
    const band1 = profile.bands.find(band => band.id === selectedBands[0]);
    const band2 = profile.bands.find(band => band.id === selectedBands[1]);
    
    if (!band1 || !band2) return;
    
    // Calculate the average gain of both bands
    const avgGain = (band1.gain + band2.gain) / 2;
    
    // Apply amplitude multiplier to the average gain
    const multipliedAvgGain = avgGain * amplitudeMultiplier;
    
    // Calculate new gains with the difference applied
    // The amplitude difference is split between the two bands
    const halfDifference = amplitudeDifference / 2;
    const newGain1 = multipliedAvgGain - halfDifference;
    const newGain2 = multipliedAvgGain + halfDifference;
    
    // Clamp gains to valid range (-24 to 24 dB)
    const clampedGain1 = Math.max(-24, Math.min(24, newGain1));
    const clampedGain2 = Math.max(-24, Math.min(24, newGain2));
    
    // Update the profile with new gains
    const updatedBands = [...profile.bands];
    
    // Find and update the bands
    const index1 = updatedBands.findIndex(b => b.id === selectedBands[0]);
    const index2 = updatedBands.findIndex(b => b.id === selectedBands[1]);
    
    if (index1 !== -1 && index2 !== -1) {
      updatedBands[index1] = { ...updatedBands[index1], gain: clampedGain1 };
      updatedBands[index2] = { ...updatedBands[index2], gain: clampedGain2 };
      
      // Update the profile
      updateProfile(profile.id, { bands: updatedBands });
    }
  }, [selectedBands, amplitudeMultiplier, amplitudeDifference, getActiveProfile, updateProfile]);
  
  // Apply adjustments when slider values change
  useEffect(() => {
    if (selectedBands.length === 2) {
      applyAmplitudeAdjustments();
    }
  }, [selectedBands, amplitudeMultiplier, amplitudeDifference, applyAmplitudeAdjustments]);

  // Handle amplitude multiplier change
  const handleAmplitudeMultiplierChange = (value: number[]) => {
    setAmplitudeMultiplier(value[0]);
  };
  
  // Handle amplitude difference change
  const handleAmplitudeDifferenceChange = (value: number[]) => {
    setAmplitudeDifference(value[0]);
  };
  
  // Format the multiplier value
  const formatMultiplier = (value: number): string => {
    return `${value.toFixed(1)}x`;
  };
  
  // Format the difference value
  const formatDifference = (value: number): string => {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
  };

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

  const handleProfileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        let profileData;

        // Try to parse as JSON
        try {
          profileData = JSON.parse(content);
        } catch (jsonError) {
          // If JSON parsing fails, try to parse as plain text
          try {
            // Check if this is the Filter format (Filter 1: ON PK Fc...)
            const lines = content.split('\n').filter(line => line.trim().length > 0);
            const isFilterFormat = lines[0]?.match(/^Filter \d+: /);
            
            if (isFilterFormat) {
              // Parse the filter format
              const bands = lines.map(line => {
                // Parse each filter line with a regex
                const match = line.match(/^Filter \d+: (ON|OFF) ([A-Z]+) Fc ([0-9.]+) Hz Gain ([0-9.-]+) dB Q ([0-9.]+)$/);
                if (!match) return null;
                
                const [_, state, type, frequency, gain, q] = match;
                
                // Only include filters that are ON
                if (state !== 'ON') return null;
                
                // Map filter types to band types
                let filterType = 'peaking'; // Default for PK
                if (type === 'HSC') filterType = 'highshelf';
                else if (type === 'LSC') filterType = 'lowshelf';
                
                return {
                  type: filterType,
                  frequency: parseFloat(frequency),
                  gain: parseFloat(gain),
                  q: parseFloat(q)
                };
              }).filter(Boolean);
              
              const profileName = file.name.replace(/\.[^.]+$/, '') || 'Imported Profile';
              
              profileData = {
                name: profileName,
                bands: bands,
                volume: 0 // Default volume
              };
            } else {
              // Attempt to extract profile data from plain text format
              const lines = content.split('\n');
              const name = lines.find(line => line.startsWith('Name:'))?.substring(5).trim();
              if (!name) throw new Error('Profile name not found');

              // Extract bands if they exist
              const bandsStr = content.match(/Bands:([\s\S]*?)(?=Volume:|$)/)?.[1].trim();
              const bands = bandsStr ? JSON.parse(bandsStr) : [];

              // Extract volume
              const volumeStr = content.match(/Volume:\s*([\-\d\.]+)/)?.[1];
              const volume = volumeStr ? parseFloat(volumeStr) : 0;

              profileData = {
                name,
                bands,
                volume
              };
            }
          } catch (textError) {
            console.error('Text parsing error:', textError);
            throw new Error('Invalid file format. Please upload a valid EQ profile.');
          }
        }

        // Validate the profile data
        if (!profileData.name) {
          throw new Error('Profile name is required');
        }

        // Create a new profile with the imported data and generated fields
        const newProfile = {
          id: uuidv4(),
          name: profileData.name,
          bands: Array.isArray(profileData.bands) ? profileData.bands : [],
          volume: typeof profileData.volume === 'number' ? profileData.volume : 0,
          lastModified: Date.now(),
          syncStatus: 'modified' as SyncStatus
        };

        // Add the profile and select it
        addProfile(newProfile);
        setSelectedProfileId(newProfile.id);
        setActiveProfile(newProfile.id);

        // Reset the file input
        event.target.value = '';
        
        console.log(`Imported profile: ${newProfile.name} with ${newProfile.bands.length} bands`);
      } catch (error) {
        console.error('Error importing profile:', error);
        setImportError(error instanceof Error ? error.message : 'Failed to import profile');
        
        // Reset the file input
        event.target.value = '';
      }
    };

    reader.readAsText(file);
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
              <FrequencyGraph 
                selectedDot={selectedDot} 
                disabled={!isEQEnabled} 
                className="w-full" 
                onInstructionChange={setInstruction}
                onRequestEnable={() => setEQEnabled(true)}
                onSelectedBandsChange={handleSelectedBandsChange}
              />
            </div>

            {/* Contextual Instructions */}
            <div className="mt-1 mb-3 px-2 py-1.5 bg-muted/40 rounded text-sm text-muted-foreground border-l-2 border-electric-blue">
              {instruction}
            </div>

            {/* Multi-band controls - only show when exactly 2 bands are selected */}
            {selectedBands.length === 2 && (
              <div className="mt-4 p-4 border rounded-lg bg-card">
                <h4 className="font-medium mb-3">Multi-Band Adjustment</h4>
                
                {/* Amplitude Multiplier Slider */}
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm">Overall Amplitude</span>
                    <span className="text-sm font-medium">{formatMultiplier(amplitudeMultiplier)}</span>
                  </div>
                  <Slider
                    value={[amplitudeMultiplier]}
                    min={-2.0}
                    max={2.0}
                    step={0.1}
                    onValueChange={handleAmplitudeMultiplierChange}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>-2x</span>
                    <span>0x</span>
                    <span>2x</span>
                  </div>
                </div>
                
                {/* Amplitude Difference Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm">Amplitude Difference</span>
                    <span className="text-sm font-medium">{formatDifference(amplitudeDifference)}</span>
                  </div>
                  <Slider
                    value={[amplitudeDifference]}
                    min={-24}
                    max={24}
                    step={0.5}
                    onValueChange={handleAmplitudeDifferenceChange}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>-24 dB</span>
                    <span>0 dB</span>
                    <span>+24 dB</span>
                  </div>
                </div>
              </div>
            )}

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
        <div className="flex justify-between items-center mb-3">
          <div>
            {importError && (
              <p className="text-sm text-red-500">
                {importError}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('profile-upload')?.click()}
              title="Import profile from file"
            >
              Import Profile
            </Button>
            <input
              type="file"
              id="profile-upload"
              className="hidden"
              accept=".txt,.json"
              onChange={handleProfileImport}
            />
          </div>
        </div>
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

