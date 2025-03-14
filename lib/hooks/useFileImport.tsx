"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import { useTrackStore } from "@/lib/stores"
import { Track } from "@/lib/models/Track"
import * as fileStorage from "@/lib/storage/fileStorage"
import * as metadataStorage from "@/lib/storage/metadataStorage"
import { v4 as uuidv4 } from "uuid"

interface UseFileImportOptions {
  onComplete?: (files: File[]) => void
  onError?: (error: string) => void
}

export function useFileImport({ onComplete, onError }: UseFileImportOptions = {}) {
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragCounter, setDragCounter] = useState(0)

  // Connect to track store
  const { addTrack } = useTrackStore()

  // For cancellation
  const importCancelRef = useRef<boolean>(false)

  // Cleanup function for when component unmounts during import
  useEffect(() => {
    return () => {
      importCancelRef.current = true
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => prev + 1)
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => prev - 1)
      if (dragCounter <= 1) {
        setDragActive(false)
        setDragCounter(0)
      }
    },
    [dragCounter],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    setDragCounter(0)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files)
    }
  }, [])

  const cancelImport = useCallback(() => {
    if (isImporting) {
      importCancelRef.current = true
      setIsImporting(false)
      setImportProgress(0)
      setCurrentFile(null)
    }
  }, [isImporting])

  // Process a single file and extract metadata, store in IndexedDB
  const processFile = useCallback(async (file: File): Promise<Track> => {
    try {
      setCurrentFile(file.name)
      
      // Store audio file in IndexedDB and get storage key
      const storageKey = await fileStorage.storeAudioFile(file)
      
      // Generate a basic track with metadata from filename
      const title = file.name.replace(/\.[^/.]+$/, "")
      const id = uuidv4()
      
      // Create track object
      const track: Track = {
        id,
        title,
        artistId: "Unknown Artist",
        albumId: "Unknown Album",
        duration: 0, // Will be updated when audio decodes
        storageKey,
        lastModified: Date.now(),
        syncStatus: 'pending'
      }
      
      // Extract real metadata from audio file
      try {
        const metadata = await metadataStorage.extractMetadata(file)
        if (metadata) {
          track.title = metadata.title || track.title
          track.artistId = metadata.artist || track.artistId
          track.albumId = metadata.album || track.albumId
          track.duration = metadata.duration || track.duration
        }
      } catch (error) {
        console.warn("Failed to extract metadata:", error)
        // Continue with basic track info if metadata extraction fails
      }
      
      return track
    } catch (error) {
      console.error("Error processing file:", error)
      throw new Error(`Failed to process ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  const handleFileSelect = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList).filter(
        (file) =>
          file.type.startsWith("audio/") ||
          file.name.endsWith(".mp3") ||
          file.name.endsWith(".wav") ||
          file.name.endsWith(".flac"),
      )

      if (files.length === 0) {
        setError("No audio files found. Please select MP3, WAV, or FLAC files.")
        onError?.("No audio files found. Please select MP3, WAV, or FLAC files.")
        return
      }

      // Reset state
      setIsImporting(true)
      setImportProgress(0)
      setCurrentFile(null)
      importCancelRef.current = false

      // Process files and store in IndexedDB
      const processFiles = async () => {
        const totalFiles = files.length
        const importedTracks: Track[] = []

        for (let i = 0; i < totalFiles; i++) {
          if (importCancelRef.current) {
            break
          }

          const file = files[i]
          
          try {
            // Calculate progress for this file (each file is 1/totalFiles of progress)
            const startProgress = (i / totalFiles) * 100
            const endProgress = ((i + 1) / totalFiles) * 100
            
            // Show starting progress
            setImportProgress(startProgress)
            
            // Process file and store in IndexedDB
            const track = await processFile(file)
            
            // Add to track store (which will internally save to IndexedDB)
            addTrack(track)
            
            // Track for callback
            importedTracks.push(track)
            
            // Update progress
            setImportProgress(endProgress)
            
            console.log(`Added track to store: ${track.title}`)
          } catch (err) {
            console.error(`Error processing ${file.name}:`, err)
          }
        }

        if (!importCancelRef.current) {
          setImportProgress(100)
          // Small delay before completing to show 100%
          await new Promise((resolve) => setTimeout(resolve, 300))
          setIsImporting(false)
          setCurrentFile(null)
          
          // Call onComplete with processed files
          if (importedTracks.length > 0) {
            onComplete?.(files)
          }
        }
      }

      processFiles().catch((err) => {
        setError("Failed to import files: " + (err.message || "Unknown error"))
        onError?.("Failed to import files: " + (err.message || "Unknown error"))
        setIsImporting(false)
      })
    },
    [onComplete, onError, processFile, addTrack],
  )

  return {
    // State
    isImporting,
    importProgress,
    currentFile,
    dragActive,
    error,

    // Methods
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    cancelImport,
    clearError,
  }
}

