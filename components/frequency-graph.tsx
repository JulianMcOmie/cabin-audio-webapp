"use client"

import { FrequencyEQ } from "./parametric-eq"

interface FrequencyGraphProps {
  selectedDot?: [number, number] | null
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
}

export function FrequencyGraph({ 
  selectedDot = null, 
  disabled = false, 
  className, 
  onInstructionChange,
  onRequestEnable
}: FrequencyGraphProps) {
  return (
    <div className={className}>
      <FrequencyEQ
        disabled={disabled}
        onInstructionChange={onInstructionChange}
        onRequestEnable={onRequestEnable}
      />
    </div>
  )
}

