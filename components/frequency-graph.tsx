"use client"

import { FrequencyEQ } from "./parametric-eq"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"

interface FrequencyGraphProps {
  selectedDot?: [number, number] | null
  disabled?: boolean
  className?: string
  onInstructionChange?: (instruction: string) => void
  onRequestEnable?: () => void
  onSelectedBandsChange?: (selectedBandIds: string[]) => void
}

export function FrequencyGraph({ 
//   selectedDot = null, 
  disabled = false, 
  className, 
  onInstructionChange,
  onRequestEnable,
  onSelectedBandsChange
}: FrequencyGraphProps) {
  // Get the active profile ID from the store
  const { getActiveProfile } = useEQProfileStore();
  const activeProfile = getActiveProfile();
  
  return (
    <div className={className}>
      <FrequencyEQ
        profileId={activeProfile?.id}
        disabled={disabled}
        onInstructionChange={onInstructionChange}
        onRequestEnable={onRequestEnable}
        onSelectedBandsChange={onSelectedBandsChange}
      />
    </div>
  )
}

