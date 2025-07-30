"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"

interface ABEQControlProps {
  disabled?: boolean
  onFrequenciesChange?: (soundAFreqs: number[], soundBFreqs: number[]) => void
}

export function ABEQControlComponent({ disabled = false, onFrequenciesChange }: ABEQControlProps) {
  // Default frequencies for Sound A cuts (lower frequencies)
  const [soundAFreqs, setSoundAFreqs] = useState<number[]>([200, 800, 1600])
  
  // Default frequencies for Sound B cuts (higher frequencies)  
  const [soundBFreqs, setSoundBFreqs] = useState<number[]>([3200, 6400, 12800])

  const handleSoundAFreqChange = (index: number, value: number[]) => {
    const newFreqs = [...soundAFreqs]
    newFreqs[index] = value[0]
    setSoundAFreqs(newFreqs)
    onFrequenciesChange?.(newFreqs, soundBFreqs)
  }

  const handleSoundBFreqChange = (index: number, value: number[]) => {
    const newFreqs = [...soundBFreqs]
    newFreqs[index] = value[0]
    setSoundBFreqs(newFreqs)
    onFrequenciesChange?.(soundAFreqs, newFreqs)
  }

  const formatFrequency = (freq: number): string => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}kHz`
    }
    return `${freq}Hz`
  }

  // Convert frequency to slider position (logarithmic scale)
  const freqToSlider = (freq: number): number => {
    // Map 20Hz - 20kHz to 0-100 logarithmically
    const minFreq = 20
    const maxFreq = 20000
    return Math.round((Math.log(freq / minFreq) / Math.log(maxFreq / minFreq)) * 100)
  }

  // Convert slider position to frequency (logarithmic scale)
  const sliderToFreq = (value: number): number => {
    const minFreq = 20
    const maxFreq = 20000
    return Math.round(minFreq * Math.pow(maxFreq / minFreq, value / 100))
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
          A/B EQ Band Controls
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Control the frequencies that get cut (-18dB, thin Q) for each sound. 
          Sound A cuts lower frequencies, Sound B cuts higher frequencies.
        </p>
      </CardHeader>
      
      <CardContent className="space-y-8">
        {/* Sound A Controls */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <Label className="text-base font-medium">Sound A Cuts (Lower Frequencies)</Label>
          </div>
          
          <div className="space-y-4">
            {soundAFreqs.map((freq, index) => (
              <div key={`a-${index}`} className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Band {index + 1}</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {formatFrequency(freq)}
                  </span>
                </div>
                <Slider
                  disabled={disabled}
                  value={[freqToSlider(freq)]}
                  onValueChange={(value) => handleSoundAFreqChange(index, [sliderToFreq(value[0])])}
                  max={100}
                  min={0}
                  step={1}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Sound B Controls */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <Label className="text-base font-medium">Sound B Cuts (Higher Frequencies)</Label>
          </div>
          
          <div className="space-y-4">
            {soundBFreqs.map((freq, index) => (
              <div key={`b-${index}`} className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm">Band {index + 1}</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {formatFrequency(freq)}
                  </span>
                </div>
                <Slider
                  disabled={disabled}
                  value={[freqToSlider(freq)]}
                  onValueChange={(value) => handleSoundBFreqChange(index, [sliderToFreq(value[0])])}
                  max={100}
                  min={0}
                  step={1}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Settings Summary */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>EQ Settings:</strong> -18dB cuts with thin Q (high selectivity)</p>
            <p><strong>Sound A:</strong> {soundAFreqs.map(formatFrequency).join(', ')} removed</p>
            <p><strong>Sound B:</strong> {soundBFreqs.map(formatFrequency).join(', ')} removed</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}