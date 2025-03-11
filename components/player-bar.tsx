"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PlayerBarProps {
  track: {
    title: string
    artist: string
    album: string
    duration: number
    currentTime: number
    coverUrl: string
  }
  isPlaying: boolean
  setIsPlaying: (isPlaying: boolean) => void
}

export function PlayerBar({ track, isPlaying, setIsPlaying }: PlayerBarProps) {
  const [currentTime, setCurrentTime] = useState(track.currentTime)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)
  const [isDraggingProgress, setIsDraggingProgress] = useState(false)
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)

  // Update progress when playing
  useEffect(() => {
    let interval: NodeJS.Timeout

    if (isPlaying && !isDraggingProgress) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= track.duration) {
            setIsPlaying(false)
            return 0
          }
          return prev + 1
        })
      }, 1000)
    }

    return () => clearInterval(interval)
  }, [isPlaying, track.duration, setIsPlaying, isDraggingProgress])

  // Reset current time when track changes
  useEffect(() => {
    setCurrentTime(track.currentTime)
  }, [track])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleProgressMouseDown = (e: React.MouseEvent) => {
    if (!progressRef.current) return
    setIsDraggingProgress(true)
    updateProgressFromMouse(e)
    document.addEventListener("mousemove", handleProgressMouseMove)
    document.addEventListener("mouseup", handleProgressMouseUp)
  }

  const handleProgressMouseMove = (e: MouseEvent) => {
    updateProgressFromMouse(e)
  }

  const handleProgressMouseUp = () => {
    setIsDraggingProgress(false)
    document.removeEventListener("mousemove", handleProgressMouseMove)
    document.removeEventListener("mouseup", handleProgressMouseUp)
  }

  const updateProgressFromMouse = (e: MouseEvent | React.MouseEvent) => {
    if (!progressRef.current) return
    const rect = progressRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const percentage = x / rect.width
    setCurrentTime(percentage * track.duration)
  }

  const handleVolumeMouseDown = (e: React.MouseEvent) => {
    if (!volumeRef.current) return
    setIsDraggingVolume(true)
    updateVolumeFromMouse(e)
    document.addEventListener("mousemove", handleVolumeMouseMove)
    document.addEventListener("mouseup", handleVolumeMouseUp)
  }

  const handleVolumeMouseMove = (e: MouseEvent) => {
    updateVolumeFromMouse(e)
  }

  const handleVolumeMouseUp = () => {
    setIsDraggingVolume(false)
    document.removeEventListener("mousemove", handleVolumeMouseMove)
    document.removeEventListener("mouseup", handleVolumeMouseUp)
  }

  const updateVolumeFromMouse = (e: MouseEvent | React.MouseEvent) => {
    if (!volumeRef.current) return
    const rect = volumeRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const percentage = x / rect.width
    const newVolume = Math.round(percentage * 100)
    setVolume(newVolume)
    if (newVolume === 0) {
      setIsMuted(true)
    } else {
      setIsMuted(false)
    }
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
  }

  return (
    <div className="player-bar p-2 w-full">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 w-[30%] min-w-[180px]">
          <img
            src={track.coverUrl || "/placeholder.svg"}
            alt={`${track.album} cover`}
            className="h-12 w-12 rounded-md object-cover"
          />
          <div className="flex flex-col min-w-0">
            <div className="text-sm font-medium truncate">{track.title}</div>
            <div className="text-xs text-muted-foreground truncate">{track.artist}</div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 w-full max-w-md">
            <div className="text-xs w-8 text-right">{formatTime(currentTime)}</div>
            <div ref={progressRef} className="player-slider flex-1" onMouseDown={handleProgressMouseDown}>
              <div className="player-slider-track" style={{ width: `${(currentTime / track.duration) * 100}%` }}></div>
              <div className="player-slider-thumb" style={{ left: `${(currentTime / track.duration) * 100}%` }}></div>
            </div>
            <div className="text-xs w-8">{formatTime(track.duration)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-[20%] min-w-[120px] justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <div ref={volumeRef} className="volume-slider w-24" onMouseDown={handleVolumeMouseDown}>
            <div className="volume-slider-track" style={{ width: `${isMuted ? 0 : volume}%` }}></div>
            <div className="volume-slider-thumb" style={{ left: `${isMuted ? 0 : volume}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  )
}

