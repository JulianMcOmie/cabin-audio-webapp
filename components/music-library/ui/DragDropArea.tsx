"use client"

import { DragEventHandler, ReactNode } from "react"

interface DragDropAreaProps {
  children: ReactNode
  dragActive: boolean
  onDragEnter: DragEventHandler
  onDragLeave: DragEventHandler
  onDragOver: DragEventHandler
  onDrop: DragEventHandler
  className?: string
}

export function DragDropArea({
  children,
  dragActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  className = ""
}: DragDropAreaProps) {
  return (
    <div 
      className={`${className} ${dragActive ? "drag-active" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-drag-container="true"
    >
      {children}
    </div>
  )
} 