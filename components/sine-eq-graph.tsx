"use client"

import { SineEQ } from "./sine-eq"
import { useSineProfileStore } from "@/lib/stores/sineProfileStore"

interface SineEQGraphProps {
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
  profileId?: string
}

export function SineEQGraph({ 
  disabled = false, 
  className, 
  onInstructionChange,
  onRequestEnable,
  profileId
}: SineEQGraphProps) {
  // Use the sine profiles store
  const { isSineEQEnabled } = useSineProfileStore()
  
  // If disabled is not explicitly provided, use the store value
  const actualDisabled = disabled !== undefined ? disabled : !isSineEQEnabled
  
  return (
    <div className={className}>
      <SineEQ
        disabled={actualDisabled}
        onInstructionChange={onInstructionChange}
        onRequestEnable={onRequestEnable}
        profileId={profileId}
      />
    </div>
  )
} 