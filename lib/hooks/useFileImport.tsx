"use client"

import type React from "react"

import { useState, useRef, useCallback, useEffect } from "react"

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

      // Simulate file processing
      const processFiles = async () => {
        const totalFiles = files.length

        for (let i = 0; i < totalFiles; i++) {
          if (importCancelRef.current) {
            break
          }

          const file = files[i]
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

          setImportProgress(endProgress)
        }

        if (!importCancelRef.current) {
          setImportProgress(100)
          // Small delay before completing to show 100%
          await new Promise((resolve) => setTimeout(resolve, 500))
          setIsImporting(false)
          onComplete?.(files)
        }
      }

      processFiles().catch((err) => {
        setError("Failed to import files: " + (err.message || "Unknown error"))
        onError?.("Failed to import files: " + (err.message || "Unknown error"))
        setIsImporting(false)
      })
    },
    [onComplete, onError],
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

