"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import { useTrackStore } from "@/lib/stores"
import { Track } from "@/lib/models/Track"

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

  // Extract metadata from file - enhanced for Phase 2.2
  const extractMetadata = useCallback((file: File, index: number): Track => {
    console.log(`[extractMetadata] Starting metadata extraction for file: ${file.name}`);
    
    // Extract filename without extension as the title
    const title = file.name.replace(/\.[^/.]+$/, "")
    
    // Generate a unique ID
    const id = `imported-${Date.now()}-${index}`
    
    // Get file extension
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    
    // Basic metadata (would be enhanced with real extraction in Phase 3)
    const trackMetadata = {
      id,
      title,
      artistId: "Unknown Artist", // Phase 3 would extract this from ID3/metadata
      albumId: "Unknown Album",   // Phase 3 would extract this from ID3/metadata
      duration: Math.floor(Math.random() * 300) + 120, // Random duration between 2-6 minutes
      storageKey: `file-${id}.${extension}`,
      lastModified: Date.now(),
      syncStatus: 'pending' as const
    };
    
    console.log(`[extractMetadata] Completed metadata extraction:`, trackMetadata);
    return trackMetadata;
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

  const handleFileSelect = useCallback(
    (fileList: FileList) => {
      console.log(`[useFileImport] handleFileSelect called with ${fileList.length} files`);
      
      const files = Array.from(fileList).filter(
        (file) =>
          file.type.startsWith("audio/") ||
          file.name.endsWith(".mp3") ||
          file.name.endsWith(".wav") ||
          file.name.endsWith(".flac"),
      )

      console.log(`[useFileImport] ${files.length} valid audio files found`);

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

      // Simulate file processing and add to track store
      const processFiles = async () => {
        console.log(`[useFileImport] Starting to process ${files.length} files`);
        const totalFiles = files.length
        const importedFiles: File[] = []
        const importedTracks: Track[] = []

        for (let i = 0; i < totalFiles; i++) {
          if (importCancelRef.current) {
            console.log(`[useFileImport] Import cancelled`);
            break
          }

          const file = files[i]
          console.log(`[useFileImport] Processing file ${i+1}/${totalFiles}: ${file.name}`);
          setCurrentFile(file.name)

          // Simulate processing time based on file size
          const processingTime = Math.min((file.size / 1000000) * 500, 2000) // 500ms per MB, max 2s

          // Simulate progress updates during processing
          const startProgress = (i / totalFiles) * 100
          const endProgress = ((i + 1) / totalFiles) * 100
          const progressStep = (endProgress - startProgress) / 10

          for (let j = 0; j < 10; j++) {
            if (importCancelRef.current) break

            await new Promise((resolve) => setTimeout(resolve, processingTime / 10))
            setImportProgress(startProgress + progressStep * j)
          }

          try {
            // Extract metadata and add to store - NEW for Phase 2.2
            console.log(`[useFileImport] Extracting metadata for ${file.name}`);
            const trackMetadata = extractMetadata(file, i)
            
            // Add to track store
            console.log(`[useFileImport] Adding track to store:`, trackMetadata);
            addTrack(trackMetadata)
            
            // Track for callback
            importedTracks.push(trackMetadata)
            importedFiles.push(file)
            
            console.log(`[useFileImport] Successfully added track to store: ${trackMetadata.title} (ID: ${trackMetadata.id})`);
          } catch (err) {
            console.error(`[useFileImport] Error processing ${file.name}:`, err)
          }

          setImportProgress(endProgress)
        }

        if (!importCancelRef.current) {
          setImportProgress(100)
          // Small delay before completing to show 100%
          await new Promise((resolve) => setTimeout(resolve, 500))
          setIsImporting(false)
          
          // Call onComplete with processed files
          if (importedFiles.length > 0) {
            console.log(`[useFileImport] Import complete: ${importedTracks.length} files processed and added to store`);
            console.log(`[useFileImport] Final track count in store: ${useTrackStore.getState().tracks.length}`);
            onComplete?.(importedFiles)
          }
        }
      }

      processFiles().catch((err) => {
        console.error(`[useFileImport] Fatal error during import:`, err);
        setError("Failed to import files: " + (err.message || "Unknown error"))
        onError?.("Failed to import files: " + (err.message || "Unknown error"))
        setIsImporting(false)
      })
    },
    [onComplete, onError, extractMetadata, addTrack],
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

