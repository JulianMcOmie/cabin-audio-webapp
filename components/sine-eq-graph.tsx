"use client"

import { SineEQ } from "./sine-eq"

interface SineEQGraphProps {
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
}

export function SineEQGraph({ 
  disabled = false, 
  className, 
  onInstructionChange,
  onRequestEnable
}: SineEQGraphProps) {
  return (
    <div className={className}>
      <SineEQ
        disabled={disabled}
        onInstructionChange={onInstructionChange}
        onRequestEnable={onRequestEnable}
      />
    </div>
  )
} 