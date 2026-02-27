"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { SettingsPanel } from "@/components/settings-panel"
import * as dotGridAudio from "@/lib/audio/dotGridAudio"
import { resumeAudioContext } from "@/lib/audio/audioContext"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"

const DotGrid3D = dynamic(
  () => import("@/components/dot-grid-3d").then((mod) => mod.DotGrid3D),
  { ssr: false }
)

interface EQViewProps {
  setEqEnabled: (enabled: boolean) => void
}

const MIN_ROWS = 3
const MAX_ROWS = 12
const MIN_COLS = 3
const MAX_COLS = 14

export function EQView({ setEqEnabled }: EQViewProps) {
  const [selectedDots, setSelectedDots] = useState<Set<string>>(new Set())
  const [gridRows, setGridRows] = useState(3)
  const [gridCols, setGridCols] = useState(5)
  const [speed, setSpeed] = useState(2)
  const [volumePercent, setVolumePercent] = useState(80)
  const [settingsCollapsed, setSettingsCollapsed] = useState(true)
  const [hoveredDot, setHoveredDot] = useState<string | null>(null)
  const { isEQEnabled, setEQEnabled } = useEQProfileStore()
  const sequenceStartMsRef = useRef<number>(Date.now())
  const [playClockMs, setPlayClockMs] = useState(0)

  const hasSelectedDots = selectedDots.size > 0

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()

    player.setLoopSequencerEnabled(true)
    player.setLoopSequencerPlayTogether(false)
    player.setInterleavedHits(true)
    player.setVolumeSteps(1)
    player.setNumberOfHits(1)
    player.setHitDecay(0)
    player.setVolumeLevelRangeDb(0)
    player.setSubHitPlaybackEnabled(false)
    player.setHitModeAttack(0.01)
    player.setHitModeRelease(1.2)

    player.setPerCycleVolumeEnabled(false)
    player.setPerDotVolumeWaveEnabled(false)
    player.setAutoVolumeCycleEnabled(false)

    const analyser = player.createPreEQAnalyser()
    player.connectToAnalyser(analyser)

    setEQEnabled(true)

    return () => {
      player.setPlaying(false)
    }
  }, [setEQEnabled])

  useEffect(() => {
    setEqEnabled(isEQEnabled)
  }, [isEQEnabled, setEqEnabled])

  useEffect(() => {
    setSelectedDots((prev) => {
      const next = new Set<string>()
      prev.forEach((dotKey) => {
        const [x, y] = dotKey.split(",").map(Number)
        if (x < gridCols && y < gridRows) {
          next.add(dotKey)
        }
      })
      return next
    })
  }, [gridRows, gridCols])

  useEffect(() => {
    sequenceStartMsRef.current = Date.now()
  }, [selectedDots, speed, gridRows, gridCols])

  useEffect(() => {
    if (!hasSelectedDots) return
    let frameId = 0

    const tick = () => {
      setPlayClockMs(Date.now())
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [hasSelectedDots])

  useEffect(() => {
    const player = dotGridAudio.getDotGridAudioPlayer()
    player.updateDots(selectedDots, gridRows, gridCols)
    if (selectedDots.size > 0) {
      void resumeAudioContext().then(() => {
        player.setPlaying(true)
      })
    } else {
      player.setPlaying(false)
    }
  }, [selectedDots, gridRows, gridCols])

  useEffect(() => {
    dotGridAudio.getDotGridAudioPlayer().setHitModeRate(speed)
  }, [speed])

  useEffect(() => {
    const normalized = volumePercent / 100
    const perceivedGain = Math.pow(normalized, 2.2)
    const db = -48 + perceivedGain * 48
    dotGridAudio.getDotGridAudioPlayer().setVolumeDb(db)
  }, [volumePercent])

  const orderedDotKeys = useMemo(() => {
    const dots = Array.from(selectedDots).map((dotKey) => {
      const [x, y] = dotKey.split(",").map(Number)
      return { dotKey, x, y }
    })

    dots.sort((a, b) => {
      const rowDiff = a.y - b.y
      if (rowDiff !== 0) return rowDiff
      const reverse = a.y % 2 === 1
      return reverse ? b.x - a.x : a.x - b.x
    })

    return dots.map((d) => d.dotKey)
  }, [selectedDots])

  const { playingDotKey, beatIndex } = useMemo(() => {
    if (!hasSelectedDots || orderedDotKeys.length === 0) return { playingDotKey: null, beatIndex: 0 }
    const intervalMs = 1000 / Math.max(speed, 0.1)
    const elapsed = Math.max(0, playClockMs - sequenceStartMsRef.current)
    const beat = Math.floor(elapsed / intervalMs)
    const index = beat % orderedDotKeys.length
    return { playingDotKey: orderedDotKeys[index], beatIndex: beat }
  }, [hasSelectedDots, orderedDotKeys, playClockMs, speed])

  const handleDotSelect = useCallback((x: number, y: number) => {
    void resumeAudioContext()
    const key = `${x},${y}`
    setSelectedDots((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const handleDotDeselect = useCallback((x: number, y: number) => {
    const key = `${x},${y}`
    setSelectedDots((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const handleSetGridSize = useCallback((rows: number, cols: number) => {
    setGridRows(rows)
    setGridCols(cols)
  }, [])

  return (
    <div className="relative w-full h-full min-h-0">
      <DotGrid3D
        gridRows={gridRows}
        gridCols={gridCols}
        selectedDots={selectedDots}
        onDotSelect={handleDotSelect}
        onDotDeselect={handleDotDeselect}
        playingDotKey={playingDotKey}
        beatIndex={beatIndex}
        hoveredDot={hoveredDot}
        onHoverDot={setHoveredDot}
      />
      <SettingsPanel
        collapsed={settingsCollapsed}
        onToggle={() => setSettingsCollapsed((v) => !v)}
        gridRows={gridRows}
        gridCols={gridCols}
        minRows={MIN_ROWS}
        maxRows={MAX_ROWS}
        minCols={MIN_COLS}
        maxCols={MAX_COLS}
        onSetGridSize={handleSetGridSize}
        speed={speed}
        onSpeedChange={setSpeed}
        volumePercent={volumePercent}
        onVolumeChange={setVolumePercent}
      />
    </div>
  )
}
