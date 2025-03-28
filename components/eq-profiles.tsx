"use client"

import { MoreHorizontal, PlusCircle } from "lucide-react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useEQProfileStore } from "@/lib/stores/eqProfileStore"
import { EQProfile } from "@/lib/models/EQProfile"
import { CheckCircle } from "lucide-react"
import React from "react"

interface EQProfilesProps {
  onProfileClick?: () => void
  selectedProfile: string
  onSelectProfile: (profileId: string) => void
}

export function EQProfiles({ onProfileClick, selectedProfile, onSelectProfile }: EQProfilesProps) {
  const { getProfiles, deleteProfile, getActiveProfile, setActiveProfile } = useEQProfileStore()
  
  // Get profiles directly from the store
  const profiles = getProfiles()
  
  // Sort profiles by dateCreated (oldest first)
  const sortedProfiles = [...profiles].sort((a, b) => {
    // If dateCreated is missing, treat as oldest (beginning of time)
    const dateA = a.dateCreated || 0;
    const dateB = b.dateCreated || 0;
    return dateA - dateB;
  });
  
  // Get the active profile from the store
  const activeProfile = getActiveProfile()
  const activeProfileId = activeProfile?.id || ""
  
  // Sync selected profile with active profile on initial render
  React.useEffect(() => {
    if (activeProfileId && activeProfileId !== selectedProfile) {
      onSelectProfile(activeProfileId);
    }
  }, [activeProfileId, selectedProfile, onSelectProfile]);

  const handleSelectProfile = (profileId: string) => {
    // Set this profile as the active profile in the store
    setActiveProfile(profileId)
    
    // Also call the parent's onSelectProfile function to update its state
    onSelectProfile(profileId)
  }

  const handleDeleteProfile = (profileId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering the card click
    
    // Don't delete if it's the only profile
    if (profiles.length <= 1) return
    
    // Delete the profile
    deleteProfile(profileId)
    
    // If deleted profile was selected, select another one
    if (selectedProfile === profileId) {
      const activeProfile = getActiveProfile()
      if (activeProfile) {
        onSelectProfile(activeProfile.id)
      } else if (profiles.length > 0) {
        // Select the first available profile
        const remainingProfiles = getProfiles()
        if (remainingProfiles.length > 0) {
          onSelectProfile(remainingProfiles[0].id)
        }
      }
    }
  }

  return (
    <div>
      <ScrollArea className="w-full whitespace-nowrap" scrollHideDelay={0}>
        <div className="pb-4">
          {" "}
          {/* Add padding to bottom to ensure no vertical scrolling */}
          <div className="flex w-max space-x-4 p-1">
            {sortedProfiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isSelected={selectedProfile === profile.id}
                isActive={activeProfileId === profile.id}
                onSelect={() => handleSelectProfile(profile.id)}
                onDelete={(e) => handleDeleteProfile(profile.id, e)}
              />
            ))}

            <div className="flex-shrink-0" onClick={onProfileClick}>
              <Card className="w-[160px] h-[120px] flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="flex flex-col items-center justify-center h-full p-6">
                  <PlusCircle className="h-10 w-10 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Create new profile</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}

function ProfileCard({
  profile,
  isSelected,
  isActive,
  onSelect,
  onDelete,
}: {
  profile: EQProfile
  isSelected: boolean
  isActive: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  // Generate a simple visualization based on the profile's bands
  const generateVisualization = () => {
    if (!profile.bands || profile.bands.length === 0) {
      return "/placeholder.svg?height=80&width=160" // Default flat line if no bands
    }
    
    // In a real implementation, we would generate a proper visualization here
    // For now, just return a placeholder
    return "/placeholder.svg?height=80&width=160"
  }

  return (
    <Card
      className={`w-[160px] h-[120px] flex-shrink-0 cursor-pointer transition-colors relative ${
        isSelected ? "ring-2 ring-electric-blue" : "hover:bg-muted/50"
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-4 relative">
        <div className="absolute top-2 right-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Download</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-red-600"
                onClick={onDelete}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="aspect-[2/1] overflow-hidden rounded-md mb-2">
          <img 
            src={generateVisualization()} 
            alt={profile.name} 
            className="w-full h-full object-cover" 
          />
        </div>
        <div className="flex items-center justify-center">
          <h4 className="font-medium text-center">{profile.name}</h4>
          {isActive && (
            <CheckCircle className="h-4 w-4 ml-2 text-green-500" />
          )}
        </div>

        {isSelected && (
          <div className="absolute inset-0 bg-electric-blue-light/30 dark:bg-electric-blue-light/20 rounded-md"></div>
        )}
      </CardContent>
    </Card>
  )
}

