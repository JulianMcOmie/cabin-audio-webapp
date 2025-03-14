"use client"

import { FrequencyEQ } from "./parametric-eq"

interface FrequencyGraphProps {
  selectedDot?: [number, number] | null
  disabled?: boolean
  className?: string
  profileId?: string
}

export function FrequencyGraph({ selectedDot = null, disabled = false, className, profileId }: FrequencyGraphProps) {
  return (
    <FrequencyEQ
      profileId={profileId}
      disabled={disabled}
      className={className}
    />
  )
}

