"use client"

import { useState } from "react"
import { Copy, Download, FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

export default function ExportView() {
  const [selectedProfile, setSelectedProfile] = useState("Bass Boost")

  const profiles = ["Flat", "Bass Boost", "Vocal Clarity", "Treble Boost", "Cinema"]

  // Sample EQ data for demonstration
  const eqData = {
    "15-band": {
      "Bass Boost":
        "25Hz: 6.0dB\n40Hz: 5.5dB\n63Hz: 5.0dB\n100Hz: 4.0dB\n160Hz: 2.5dB\n250Hz: 1.0dB\n400Hz: 0.0dB\n630Hz: 0.0dB\n1kHz: 0.0dB\n1.6kHz: 0.0dB\n2.5kHz: 0.0dB\n4kHz: 0.0dB\n6.3kHz: 0.0dB\n10kHz: 0.0dB\n16kHz: 0.0dB",
      Flat: "25Hz: 0.0dB\n40Hz: 0.0dB\n63Hz: 0.0dB\n100Hz: 0.0dB\n160Hz: 0.0dB\n250Hz: 0.0dB\n400Hz: 0.0dB\n630Hz: 0.0dB\n1kHz: 0.0dB\n1.6kHz: 0.0dB\n2.5kHz: 0.0dB\n4kHz: 0.0dB\n6.3kHz: 0.0dB\n10kHz: 0.0dB\n16kHz: 0.0dB",
      "Vocal Clarity":
        "25Hz: -1.0dB\n40Hz: -1.0dB\n63Hz: -0.5dB\n100Hz: 0.0dB\n160Hz: 0.0dB\n250Hz: 1.0dB\n400Hz: 2.0dB\n630Hz: 3.0dB\n1kHz: 3.5dB\n1.6kHz: 3.0dB\n2.5kHz: 2.0dB\n4kHz: 1.0dB\n6.3kHz: 0.0dB\n10kHz: 0.0dB\n16kHz: 0.0dB",
      "Treble Boost":
        "25Hz: 0.0dB\n40Hz: 0.0dB\n63Hz: 0.0dB\n100Hz: 0.0dB\n160Hz: 0.0dB\n250Hz: 0.0dB\n400Hz: 0.0dB\n630Hz: 0.0dB\n1kHz: 0.5dB\n1.6kHz: 1.0dB\n2.5kHz: 2.0dB\n4kHz: 3.0dB\n6.3kHz: 4.0dB\n10kHz: 4.5dB\n16kHz: 5.0dB",
      Cinema:
        "25Hz: 4.0dB\n40Hz: 4.0dB\n63Hz: 3.5dB\n100Hz: 3.0dB\n160Hz: 1.5dB\n250Hz: 0.0dB\n400Hz: -0.5dB\n630Hz: -1.0dB\n1kHz: 0.0dB\n1.6kHz: 1.0dB\n2.5kHz: 2.0dB\n4kHz: 2.5dB\n6.3kHz: 3.0dB\n10kHz: 3.0dB\n16kHz: 2.0dB",
    },
    "10-band": {
      "Bass Boost":
        "32Hz: 6.0dB\n64Hz: 5.0dB\n125Hz: 3.5dB\n250Hz: 1.0dB\n500Hz: 0.0dB\n1kHz: 0.0dB\n2kHz: 0.0dB\n4kHz: 0.0dB\n8kHz: 0.0dB\n16kHz: 0.0dB",
      Flat: "32Hz: 0.0dB\n64Hz: 0.0dB\n125Hz: 0.0dB\n250Hz: 0.0dB\n500Hz: 0.0dB\n1kHz: 0.0dB\n2kHz: 0.0dB\n4kHz: 0.0dB\n8kHz: 0.0dB\n16kHz: 0.0dB",
      "Vocal Clarity":
        "32Hz: -1.0dB\n64Hz: -0.5dB\n125Hz: 0.0dB\n250Hz: 1.0dB\n500Hz: 2.5dB\n1kHz: 3.5dB\n2kHz: 2.5dB\n4kHz: 1.0dB\n8kHz: 0.0dB\n16kHz: 0.0dB",
      "Treble Boost":
        "32Hz: 0.0dB\n64Hz: 0.0dB\n125Hz: 0.0dB\n250Hz: 0.0dB\n500Hz: 0.0dB\n1kHz: 0.5dB\n2kHz: 1.5dB\n4kHz: 3.0dB\n8kHz: 4.5dB\n16kHz: 5.0dB",
      Cinema:
        "32Hz: 4.0dB\n64Hz: 3.5dB\n125Hz: 2.5dB\n250Hz: 0.0dB\n500Hz: -0.5dB\n1kHz: 0.0dB\n2kHz: 1.5dB\n4kHz: 2.5dB\n8kHz: 3.0dB\n16kHz: 2.0dB",
    },
    Wavelet: {
      "Bass Boost":
        "GraphicEQ: 25 6.0; 40 5.5; 63 5.0; 100 4.0; 160 2.5; 250 1.0; 400 0.0; 630 0.0; 1000 0.0; 1600 0.0; 2500 0.0; 4000 0.0; 6300 0.0; 10000 0.0; 16000 0.0",
      Flat: "GraphicEQ: 25 0.0; 40 0.0; 63 0.0; 100 0.0; 160 0.0; 250 0.0; 400 0.0; 630 0.0; 1000 0.0; 1600 0.0; 2500 0.0; 4000 0.0; 6300 0.0; 10000 0.0; 16000 0.0",
      "Vocal Clarity":
        "GraphicEQ: 25 -1.0; 40 -1.0; 63 -0.5; 100 0.0; 160 0.0; 250 1.0; 400 2.0; 630 3.0; 1000 3.5; 1600 3.0; 2500 2.0; 4000 1.0; 6300 0.0; 10000 0.0; 16000 0.0",
      "Treble Boost":
        "GraphicEQ: 25 0.0; 40 0.0; 63 0.0; 100 0.0; 160 0.0; 250 0.0; 400 0.0; 630 0.0; 1000 0.5; 1600 1.0; 2500 2.0; 4000 3.0; 6300 4.0; 10000 4.5; 16000 5.0",
      Cinema:
        "GraphicEQ: 25 4.0; 40 4.0; 63 3.5; 100 3.0; 160 1.5; 250 0.0; 400 -0.5; 630 -1.0; 1000 0.0; 1600 1.0; 2500 2.0; 4000 2.5; 6300 3.0; 10000 3.0; 16000 2.0",
    },
    PowerAmp: {
      "Bass Boost":
        "25;6.0|40;5.5|63;5.0|100;4.0|160;2.5|250;1.0|400;0.0|630;0.0|1000;0.0|1600;0.0|2500;0.0|4000;0.0|6300;0.0|10000;0.0|16000;0.0",
      Flat: "25;0.0|40;0.0|63;0.0|100;0.0|160;0.0|250;0.0|400;0.0|630;0.0|1000;0.0|1600;0.0|2500;0.0|4000;0.0|6300;0.0|10000;0.0|16000;0.0",
      "Vocal Clarity":
        "25;-1.0|40;-1.0|63;-0.5|100;0.0|160;0.0|250;1.0|400;2.0|630;3.0|1000;3.5|1600;3.0|2500;2.0|4000;1.0|6300;0.0|10000;0.0|16000;0.0",
      "Treble Boost":
        "25;0.0|40;0.0|63;0.0|100;0.0|160;0.0|250;0.0|400;0.0|630;0.0|1000;0.5|1600;1.0|2500;2.0|4000;3.0|6300;4.0|10000;4.5|16000;5.0",
      Cinema:
        "25;4.0|40;4.0|63;3.5|100;3.0|160;1.5|250;0.0|400;-0.5|630;-1.0|1000;0.0|1600;1.0|2500;2.0|4000;2.5|6300;3.0|10000;3.0|16000;2.0",
    },
    Convolution44: {
      "Bass Boost": "[Generated impulse response file for 44.1kHz]",
      Flat: "[Generated impulse response file for 44.1kHz]",
      "Vocal Clarity": "[Generated impulse response file for 44.1kHz]",
      "Treble Boost": "[Generated impulse response file for 44.1kHz]",
      Cinema: "[Generated impulse response file for 44.1kHz]",
    },
    Convolution48: {
      "Bass Boost": "[Generated impulse response file for 48kHz]",
      Flat: "[Generated impulse response file for 48kHz]",
      "Vocal Clarity": "[Generated impulse response file for 48kHz]",
      "Treble Boost": "[Generated impulse response file for 48kHz]",
      Cinema: "[Generated impulse response file for 48kHz]",
    },
  }

  // EQ curve data for visualization
  const eqCurveData = {
    "Bass Boost": [6.0, 5.5, 5.0, 4.0, 2.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    Flat: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "Vocal Clarity": [-1.0, -1.0, -0.5, 0.0, 0.0, 1.0, 2.0, 3.0, 3.5, 3.0, 2.0, 1.0, 0.0, 0.0, 0.0],
    "Treble Boost": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 4.5, 5.0],
    Cinema: [4.0, 4.0, 3.5, 3.0, 1.5, 0.0, -0.5, -1.0, 0.0, 1.0, 2.0, 2.5, 3.0, 3.0, 2.0],
  }

  const handleCopyToClipboard = (format: string) => {
    const formatKey =
      format === "15-band"
        ? "15-band"
        : format === "10-band"
          ? "10-band"
          : format === "wavelet"
            ? "Wavelet"
            : format === "poweramp"
              ? "PowerAmp"
              : format === "convolution44"
                ? "Convolution44"
                : "Convolution48"

    navigator.clipboard.writeText(eqData[formatKey][selectedProfile])
  }

  const handleDownload = (format: string) => {
    const formatKey =
      format === "15-band"
        ? "15-band"
        : format === "10-band"
          ? "10-band"
          : format === "wavelet"
            ? "Wavelet"
            : format === "poweramp"
              ? "PowerAmp"
              : format === "convolution44"
                ? "Convolution44"
                : "Convolution48"

    const content = eqData[formatKey][selectedProfile]
    const fileName = `${selectedProfile.replace(/\s+/g, "-").toLowerCase()}_${format}.txt`

    // Create a blob and download it
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-4xl mx-auto py-8 pb-24">
      {" "}
      {/* Added pb-24 for bottom padding */}
      <h1 className="text-3xl font-bold mb-2">Export EQ Settings</h1>
      <p className="text-muted-foreground mb-8">Download EQ settings for other apps.</p>
      <div className="mb-8">
        <div className="mb-2">
          <label className="block text-sm font-medium mb-2">Select EQ Profile</label>
          <Select value={selectedProfile} onValueChange={setSelectedProfile}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Select an EQ profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {profile}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="mb-4">
              <h2 className="text-lg font-medium">15-Band EQ Settings</h2>
            </div>

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
              {eqData["15-band"][selectedProfile]}
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
              {eqData["10-band"][selectedProfile]}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Button
          variant="outline"
          onClick={() => handleDownload("wavelet")}
          className="flex flex-col items-center py-6 h-auto"
        >
          <FileDown className="h-6 w-6 mb-2" />
          <span>Wavelet</span>
        </Button>

        <Button
          variant="outline"
          onClick={() => handleDownload("poweramp")}
          className="flex flex-col items-center py-6 h-auto"
        >
          <FileDown className="h-6 w-6 mb-2" />
          <span>PowerAmp</span>
        </Button>

        <Button
          variant="outline"
          onClick={() => handleDownload("convolution44")}
          className="flex flex-col items-center py-6 h-auto"
        >
          <FileDown className="h-6 w-6 mb-2" />
          <span>44.1kHz Conv</span>
        </Button>

        <Button
          variant="outline"
          onClick={() => handleDownload("convolution48")}
          className="flex flex-col items-center py-6 h-auto"
        >
          <FileDown className="h-6 w-6 mb-2" />
          <span>48kHz Conv</span>
        </Button>
      </div>
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

          <AccordionItem value="android">
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
          </AccordionItem>
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

