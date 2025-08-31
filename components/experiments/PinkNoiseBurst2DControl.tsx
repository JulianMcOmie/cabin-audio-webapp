"use client"

import { useState, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"

interface PinkNoiseBurst2DControlProps {
  disabled?: boolean
  onFrequenciesChange?: (filter1Freq: number, filter2Freq: number) => void
  initialFilter1Freq?: number
  initialFilter2Freq?: number
}

export function PinkNoiseBurst2DControl({ 
  disabled = false, 
  onFrequenciesChange,
  initialFilter1Freq = 2000,
  initialFilter2Freq = 8000
}: PinkNoiseBurst2DControlProps) {
  const [filter1Freq, setFilter1Freq] = useState(initialFilter1Freq)
  const [filter2Freq, setFilter2Freq] = useState(initialFilter2Freq)
  const [isDragging, setIsDragging] = useState(false)
  const padRef = useRef<HTMLDivElement>(null)

  // Frequency range constants
  const MIN_FREQ = 1000 // 1kHz
  const MAX_FREQ = 20000 // 20kHz

  // Convert frequency to logarithmic position (0-1)
  const freqToPosition = useCallback((freq: number): number => {
    return Math.log(freq / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ)
  }, [])

  // Convert logarithmic position (0-1) to frequency
  const positionToFreq = useCallback((pos: number): number => {
    return Math.round(MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, pos))
  }, [])

  // Format frequency for display
  const formatFrequency = useCallback((freq: number): string => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}kHz`
    }
    return `${freq}Hz`
  }, [])

  // Handle mouse/touch events
  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !padRef.current || disabled) return

    const rect = padRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)) // Invert Y axis

    const newFilter1Freq = positionToFreq(x)
    const newFilter2Freq = positionToFreq(y)

    setFilter1Freq(newFilter1Freq)
    setFilter2Freq(newFilter2Freq)
    onFrequenciesChange?.(newFilter1Freq, newFilter2Freq)
  }, [isDragging, disabled, positionToFreq, onFrequenciesChange])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    
    // Update frequencies immediately on click
    handlePointerMove(event)
  }, [disabled, handlePointerMove])

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  // Calculate positions for visual indicators
  const filter1Position = freqToPosition(filter1Freq)
  const filter2Position = freqToPosition(filter2Freq)

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
          2D Filter Control
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Click and drag to control both peak filter center frequencies simultaneously.
          X-axis controls Filter 1, Y-axis controls Filter 2 (1kHz - 20kHz range).
        </p>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* 2D Control Pad */}
        <div className="space-y-4">
          <Label className="text-base font-medium">Interactive Control Pad</Label>
          
          <div 
            ref={padRef}
            className={`relative w-full h-64 bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-gray-300 rounded-lg overflow-hidden ${
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair hover:border-gray-400'
            } ${isDragging ? 'border-blue-500 bg-gradient-to-br from-blue-100 to-purple-100' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{ touchAction: 'none' }} // Prevent touch scrolling
          >
            {/* Grid lines */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Vertical lines */}
              {[0.2, 0.4, 0.6, 0.8].map((pos) => (
                <div
                  key={`v-${pos}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-300 opacity-30"
                  style={{ left: `${pos * 100}%` }}
                />
              ))}
              {/* Horizontal lines */}
              {[0.2, 0.4, 0.6, 0.8].map((pos) => (
                <div
                  key={`h-${pos}`}
                  className="absolute left-0 right-0 h-px bg-gray-300 opacity-30"
                  style={{ top: `${pos * 100}%` }}
                />
              ))}
            </div>

            {/* Control point indicator */}
            <div
              className={`absolute w-4 h-4 bg-orange-500 rounded-full border-2 border-white shadow-lg transform -translate-x-2 -translate-y-2 transition-all duration-75 ${
                isDragging ? 'scale-125' : 'scale-100'
              }`}
              style={{
                left: `${filter1Position * 100}%`,
                top: `${(1 - filter2Position) * 100}%`, // Invert Y for display
              }}
            />

            {/* Axis labels */}
            <div className="absolute bottom-2 left-2 text-xs text-gray-600 font-mono">
              1kHz
            </div>
            <div className="absolute bottom-2 right-2 text-xs text-gray-600 font-mono">
              20kHz
            </div>
            <div className="absolute top-2 left-2 text-xs text-gray-600 font-mono">
              20kHz
            </div>
            <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 text-xs text-gray-600">
              Filter 1 Frequency →
            </div>
            <div className="absolute top-1/2 left-2 transform -translate-y-1/2 -rotate-90 text-xs text-gray-600">
              Filter 2 Frequency →
            </div>
          </div>
        </div>

        {/* Current Values Display */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
              <Label className="text-sm font-medium">Filter 1 (X-axis)</Label>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-lg font-mono text-gray-800">
                {formatFrequency(filter1Freq)}
              </span>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
              <Label className="text-sm font-medium">Filter 2 (Y-axis)</Label>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-lg font-mono text-gray-800">
                {formatFrequency(filter2Freq)}
              </span>
            </div>
          </div>
        </div>

        {/* Filter Settings Summary */}
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Peak Filter Settings:</strong> -18dB magnitude, Q = 3.0</p>
            <p><strong>Filter 1:</strong> {formatFrequency(filter1Freq)} center frequency</p>
            <p><strong>Filter 2:</strong> {formatFrequency(filter2Freq)} center frequency</p>
            <p><strong>Range:</strong> 1kHz - 20kHz (logarithmic scale)</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}