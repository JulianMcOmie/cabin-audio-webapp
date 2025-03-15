"use client"

import { useState, useEffect } from "react"
import { Copy, Download, FileDown, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQBand } from "@/lib/models/EQBand"
import { useToast } from "@/components/common/ToastManager"
import { EQProfile } from "@/lib/models/EQProfile"

// EQ formats interface to type-check the export data
interface EQFormats {
  "15-band": Record<string, string>;
  "10-band": Record<string, string>;
}

export default function ExportView() {
  const { showToast } = useToast()
  const { getProfiles, getActiveProfile } = useEQProfileStore()
  
  // State for profiles and selection
  const [profiles, setProfiles] = useState<EQProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  
  // Export format state
  const [exportFormats, setExportFormats] = useState<EQFormats>({
    "15-band": {},
    "10-band": {}
  })
  const [hasTooManyBands, setHasTooManyBands] = useState({
    "10-band": false,
    "15-band": false
  })
  
  // Load profiles once on component mount
  useEffect(() => {
    const loadedProfiles = getProfiles()
    setProfiles(loadedProfiles)
    
    // Set active profile as default selected if available
    const active = getActiveProfile()
    if (active && !selectedProfileId) {
      setSelectedProfileId(active.id)
    }
  }, [getProfiles, getActiveProfile, selectedProfileId])
  
  // Generate EQ formats based on the selected profile
  useEffect(() => {
    if (!selectedProfileId || profiles.length === 0) return
    
    const profile = profiles.find(p => p.id === selectedProfileId)
    if (!profile) return
    
    // Create simple 10-band and 15-band exports by taking the first N bands
    const formats: EQFormats = {
      "15-band": {},
      "10-band": {}
    }
    
    const bands = profile.bands || []
    const bandCount = bands.length
    
    // Sort bands by frequency for consistent export
    const sortedBands = [...bands].sort((a, b) => a.frequency - b.frequency)
    
    // Check if we have more bands than can be exported in each format
    setHasTooManyBands({
      "10-band": bandCount > 10,
      "15-band": bandCount > 15
    })
    
    // Generate APO-compatible format for 10-band EQ
    let format10 = [`Preamp: ${profile.volume || 0} dB`]
    
    // Add bands in standard APO format
    const bandsFor10 = sortedBands.slice(0, 10)
    bandsFor10.forEach((band, index) => {
      // Determine filter type based on band type or reasonable default
      let filterType = "PK" // Default to peaking
      if (band.type === "lowshelf") filterType = "LSC"
      if (band.type === "highshelf") filterType = "HSC"
      
      format10.push(`Filter ${index + 1}: ON ${filterType} Fc ${Math.round(band.frequency)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q ? band.q.toFixed(2) : "1.00"}`)
    })
    
    // Add placeholder bands for missing bands
    for (let i = bandsFor10.length; i < 10; i++) {
      format10.push(`Filter ${i + 1}: ON PK Fc ${500 * (i + 1)} Hz Gain 0.0 dB Q 1.00`)
    }
    
    // Generate APO-compatible format for 15-band EQ
    let format15 = [`Preamp: ${profile.volume || 0} dB`]
    
    // Add bands in standard APO format
    const bandsFor15 = sortedBands.slice(0, 15)
    bandsFor15.forEach((band, index) => {
      // Determine filter type based on band type or reasonable default
      let filterType = "PK" // Default to peaking
      if (band.type === "lowshelf") filterType = "LSC"
      if (band.type === "highshelf") filterType = "HSC"
      
      format15.push(`Filter ${index + 1}: ON ${filterType} Fc ${Math.round(band.frequency)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q ? band.q.toFixed(2) : "1.00"}`)
    })
    
    // Add placeholder bands for missing bands
    for (let i = bandsFor15.length; i < 15; i++) {
      format15.push(`Filter ${i + 1}: ON PK Fc ${300 * (i + 1)} Hz Gain 0.0 dB Q 1.00`)
    }
    
    formats["10-band"][profile.name] = format10.join('\n')
    formats["15-band"][profile.name] = format15.join('\n')
    
    setExportFormats(formats)
  }, [selectedProfileId, profiles])

  const handleCopyToClipboard = (format: keyof EQFormats) => {
    if (!selectedProfileId) return
    
    const profile = profiles.find(p => p.id === selectedProfileId)
    if (!profile) return
    
    const content = exportFormats[format][profile.name]
    
    if (content) {
      navigator.clipboard.writeText(content)
      showToast({
        message: "Copied to clipboard",
        variant: "success"
      })
    }
  }

  const handleDownload = (format: keyof EQFormats) => {
    if (!selectedProfileId) return
    
    const profile = profiles.find(p => p.id === selectedProfileId)
    if (!profile) return
    
    const content = exportFormats[format][profile.name]
    
    if (content) {
      const fileName = `${profile.name.replace(/\s+/g, "-").toLowerCase()}_${format}.txt`
      
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
      
      showToast({
        message: `Downloaded ${fileName}`,
        variant: "success"
      })
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 pb-24">
      <h1 className="text-3xl font-bold mb-2">Export EQ Settings</h1>
      <p className="text-muted-foreground mb-8">Download EQ settings for other apps.</p>
      <div className="mb-8">
        <div className="mb-2">
          <label className="block text-sm font-medium mb-2">Select EQ Profile</label>
          <Select 
            value={selectedProfileId || ""} 
            onValueChange={value => setSelectedProfileId(value)}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Select an EQ profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {(!selectedProfileId || profiles.length === 0) && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-8 dark:bg-yellow-900/20 dark:border-yellow-800">
          <p className="text-yellow-800 dark:text-yellow-300">
            Please select an EQ profile to export. {profiles.length === 0 ? "You don't have any profiles yet." : ""}
          </p>
        </div>
      )}
      
      {selectedProfileId && (
        <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="mb-4">
              <h2 className="text-lg font-medium">15-Band EQ Settings</h2>
            </div>

                {hasTooManyBands["15-band"] && selectedProfileId && profiles.find(p => p.id === selectedProfileId) && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4 flex items-center text-sm text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-300">
                    <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                    <div>
                      This profile has {profiles.find(p => p.id === selectedProfileId)?.bands?.length || 0} bands. Only the first 15 bands are included.
                    </div>
                  </div>
                )}

            <div className="bg-muted p-4 rounded-md font-mono text-sm whitespace-pre-wrap overflow-auto h-40 relative group">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 bg-background/80"
                onClick={() => handleCopyToClipboard("15-band")}
              >
                <Copy className="h-4 w-4" />
                <span className="sr-only">Copy to clipboard</span>
              </Button>
                  {selectedProfileId && profiles.find(p => p.id === selectedProfileId)?.name && 
                    exportFormats["15-band"][profiles.find(p => p.id === selectedProfileId)!.name]}
            </div>

            <div className="mt-4 text-right">
              <Button variant="outline" size="sm" onClick={() => handleDownload("15-band")}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="mb-4">
              <h2 className="text-lg font-medium">10-Band EQ Settings</h2>
            </div>

                {hasTooManyBands["10-band"] && selectedProfileId && profiles.find(p => p.id === selectedProfileId) && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4 flex items-center text-sm text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-300">
                    <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                    <div>
                      This profile has {profiles.find(p => p.id === selectedProfileId)?.bands?.length || 0} bands. Only the first 10 bands are included.
                    </div>
                  </div>
                )}

            <div className="bg-muted p-4 rounded-md font-mono text-sm whitespace-pre-wrap overflow-auto h-40 relative group">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 bg-background/80"
                onClick={() => handleCopyToClipboard("10-band")}
              >
                <Copy className="h-4 w-4" />
                <span className="sr-only">Copy to clipboard</span>
              </Button>
                  {selectedProfileId && profiles.find(p => p.id === selectedProfileId)?.name && 
                    exportFormats["10-band"][profiles.find(p => p.id === selectedProfileId)!.name]}
            </div>

            <div className="mt-4 text-right">
              <Button variant="outline" size="sm" onClick={() => handleDownload("10-band")}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
          
          {/* Additional export formats - commented out for now
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Button
          variant="outline"
              onClick={() => handleDownload("Wavelet")}
          className="flex flex-col items-center py-6 h-auto"
        >
          <FileDown className="h-6 w-6 mb-2" />
          <span>Wavelet</span>
        </Button>

        <Button
          variant="outline"
              onClick={() => handleDownload("PowerAmp")}
          className="flex flex-col items-center py-6 h-auto"
        >
          <FileDown className="h-6 w-6 mb-2" />
          <span>PowerAmp</span>
        </Button>
          </div>
          */}
        </>
      )}
      
      <div className="space-y-6">
        <h2 className="text-xl font-medium mb-4">Instructions</h2>

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="windows">
            <AccordionTrigger>Windows</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Equalizer APO</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install Equalizer APO from the official website</li>
                    <li>Open the configuration file in C:\Program Files\EqualizerAPO\config</li>
                    <li>Copy and paste the 15-band EQ settings</li>
                    <li>Save the file and restart any audio applications</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Peace Equalizer (GUI for Equalizer APO)</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install Peace Equalizer after installing Equalizer APO</li>
                    <li>Open Peace and go to the 15-band or 10-band view</li>
                    <li>Manually adjust the sliders to match the values</li>
                    <li>Save as a new preset</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Foobar2000</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install the Graphic Equalizer component</li>
                    <li>Go to DSP Manager and enable the Graphic Equalizer</li>
                    <li>Manually adjust the bands to match the values</li>
                    <li>Save as a preset</li>
                  </ol>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="macos">
            <AccordionTrigger>macOS</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">eqMac</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install eqMac from the official website</li>
                    <li>Open the app and go to the Advanced EQ section</li>
                    <li>Click on "Import" and paste the 15-band EQ settings</li>
                    <li>Click "Apply" to save your changes</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Audio Hijack</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install Audio Hijack from Rogue Amoeba</li>
                    <li>Create a new session and add the 10-band EQ effect</li>
                    <li>Manually adjust the sliders to match the values</li>
                    <li>Save the session</li>
                  </ol>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* <AccordionItem value="android">
            <AccordionTrigger>Android</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Wavelet</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install Wavelet from the Google Play Store</li>
                    <li>Open the app and go to the Graphic Equalizer section</li>
                    <li>Tap on "Import" and paste the Wavelet format text</li>
                    <li>Save the preset with a name</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">PowerAmp</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Open PowerAmp and go to Settings</li>
                    <li>Tap on "Audio" and then "Equalizer"</li>
                    <li>Tap on the menu icon and select "Import"</li>
                    <li>Paste the PowerAmp format text and save</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Neutron Music Player</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Open Neutron and go to DSP Effects</li>
                    <li>Enable the Graphic Equalizer</li>
                    <li>Manually adjust the bands to match the values</li>
                    <li>Save as a preset</li>
                  </ol>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="ios">
            <AccordionTrigger>iOS</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Apple Music</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Open Settings on your iOS device</li>
                    <li>Go to Music &gt; EQ</li>
                    <li>Select "Custom" and adjust the sliders to match the values</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Boom: Bass Booster & Equalizer</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Install Boom from the App Store</li>
                    <li>Open the app and go to the Equalizer section</li>
                    <li>Create a custom preset and adjust the bands to match the values</li>
                    <li>Save the preset</li>
                  </ol>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="audio-production">
            <AccordionTrigger>Audio Production</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Convolution Files (44.1kHz/48kHz)</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Open your DAW (Digital Audio Workstation)</li>
                    <li>Insert a convolution reverb plugin on your track</li>
                    <li>Load the .wav file as an impulse response</li>
                    <li>Adjust the wet/dry mix to taste</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Professional Audio Software</h3>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Use a parametric EQ plugin in your DAW</li>
                    <li>Create bands at each frequency point from the 15-band settings</li>
                    <li>Set the gain values according to the dB values</li>
                    <li>Use medium Q values (around 1.0) for each band</li>
                  </ol>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem> */}
        </Accordion>
      </div>
    </div>
  )
}

// EQ Curve Preview Component
function EQCurvePreview({ data }: { data: number[] }) {
  // Draw a simple EQ curve based on the data
  return (
    <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="curve-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="50%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>

      {/* Center line (0dB) */}
      <line
        x1="0"
        y1="50"
        x2="300"
        y2="50"
        stroke="currentColor"
        className="text-muted-foreground/30"
        strokeWidth="1"
        strokeDasharray="4,4"
      />

      {/* +6dB and -6dB lines */}
      <line
        x1="0"
        y1="25"
        x2="300"
        y2="25"
        stroke="currentColor"
        className="text-muted-foreground/30"
        strokeWidth="0.5"
        strokeDasharray="2,2"
      />
      <line
        x1="0"
        y1="75"
        x2="300"
        y2="75"
        stroke="currentColor"
        className="text-muted-foreground/30"
        strokeWidth="0.5"
        strokeDasharray="2,2"
      />

      {/* EQ curve */}
      <polyline
        points={data
          .map((value, index) => {
            const x = (index / (data.length - 1)) * 300
            // Convert dB value to y position (50 is center, -12dB to +12dB range)
            const y = 50 - (value / 12) * 25
            return `${x},${y}`
          })
          .join(" ")}
        fill="none"
        stroke="url(#curve-gradient)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Frequency labels */}
      <text x="0" y="95" className="text-xs fill-current text-muted-foreground" fontSize="8">
        20Hz
      </text>
      <text x="75" y="95" className="text-xs fill-current text-muted-foreground" fontSize="8">
        100Hz
      </text>
      <text x="150" y="95" className="text-xs fill-current text-muted-foreground" fontSize="8">
        1kHz
      </text>
      <text x="225" y="95" className="text-xs fill-current text-muted-foreground" fontSize="8">
        10kHz
      </text>
      <text x="290" y="95" className="text-xs fill-current text-muted-foreground" fontSize="8">
        20kHz
      </text>

      {/* dB labels */}
      <text x="5" y="25" className="text-xs fill-current text-muted-foreground" fontSize="8">
        +6dB
      </text>
      <text x="5" y="50" className="text-xs fill-current text-muted-foreground" fontSize="8">
        0dB
      </text>
      <text x="5" y="75" className="text-xs fill-current text-muted-foreground" fontSize="8">
        -6dB
      </text>
    </svg>
  )
}

