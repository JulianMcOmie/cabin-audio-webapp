"use client"

import { useState, useEffect } from "react"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import * as dotGridAudio from "@/lib/audio/dotGridAudio"
import { NotchFilterNoiseGrid } from "./notch-filter-noise-grid"

interface CalibrationControlsProps {
  onModeChange?: (enabled: boolean) => void
  selectedDotPosition?: { x: number, y: number } | null
  totalRows?: number
}

export function CalibrationControls({ 
  onModeChange,
  selectedDotPosition,
  totalRows = 5
}: CalibrationControlsProps) {
  const [calibrationMode, setCalibrationMode] = useState(true) // Default to enabled
  const [eqGain, setEqGain] = useState(-6)
  const [eqQ, setEqQ] = useState(1.0)
  const [selectedFrequency, setSelectedFrequency] = useState<number | null>(null)

  // Update frequency display when dot selection changes
  useEffect(() => {
    if (selectedDotPosition && calibrationMode) {
      const freq = dotGridAudio.getFrequencyForDot(selectedDotPosition.y, totalRows)
      setSelectedFrequency(freq)
    } else {
      setSelectedFrequency(null)
    }
  }, [selectedDotPosition, totalRows, calibrationMode])

  const handleModeToggle = (checked: boolean) => {
    setCalibrationMode(checked)
    dotGridAudio.setCalibrationMode(checked)
    onModeChange?.(checked)
  }

  const handleGainChange = (values: number[]) => {
    const gain = values[0]
    setEqGain(gain)
    dotGridAudio.setCalibrationEQGain(gain)
  }

  const handleQChange = (values: number[]) => {
    const q = values[0]
    setEqQ(q)
    dotGridAudio.setCalibrationEQQ(q)
  }

  const formatFrequency = (freq: number): string => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}kHz`
    }
    return `${freq.toFixed(0)}Hz`
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <Label htmlFor="calibration-mode" className="text-sm font-medium">
          Calibration Mode
        </Label>
        <Switch
          id="calibration-mode"
          checked={calibrationMode}
          onCheckedChange={handleModeToggle}
        />
      </div>

      {calibrationMode && (
        <>
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-sm">EQ Amplitude</Label>
              <span className="text-sm text-muted-foreground">
                {eqGain > 0 ? '+' : ''}{eqGain.toFixed(1)}dB
              </span>
            </div>
            <Slider
              value={[eqGain]}
              onValueChange={handleGainChange}
              min={-18}
              max={18}
              step={0.5}
              className="w-full"
              disabled={!calibrationMode}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-sm">EQ Bandwidth (Q)</Label>
              <span className="text-sm text-muted-foreground">
                {eqQ.toFixed(1)}
              </span>
            </div>
            <Slider
              value={[Math.log10(eqQ) * 10 + 10]} // Convert to logarithmic scale for slider
              onValueChange={(values) => {
                const logValue = (values[0] - 10) / 10
                const q = Math.pow(10, logValue)
                handleQChange([q])
              }}
              min={0}
              max={30}
              step={0.5}
              className="w-full"
              disabled={!calibrationMode}
            />
          </div>

          {selectedFrequency !== null && (
            <div className="pt-2 border-t">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Selected Frequency</Label>
                <span className="text-sm font-mono font-medium">
                  {formatFrequency(selectedFrequency)}
                </span>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Each dot plays 80 simultaneous sine tones</p>
            <p>• Tones follow -4.5dB/octave slope (20Hz-20kHz)</p>
            <p>• Pattern: off-on-off-on-off-off-on-off</p>
            <p>• EQ boosts/cuts at dot&apos;s frequency on &apos;on&apos; beats</p>
            <p>• Listen for rhythmic changes in timbre</p>
          </div>
        </>
      )}

      <div className="pt-4 border-t">
        <NotchFilterNoiseGrid />
      </div>
    </div>
  )
}