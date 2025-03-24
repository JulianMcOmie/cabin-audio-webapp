"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, Check } from "lucide-react"
import { useSineProfileStore } from "@/lib/stores/sineProfileStore"

interface SineProfilesProps {
  onProfileClick?: () => void
  selectedProfile?: string
  onSelectProfile?: (profileId: string) => void
}

export function SineProfiles({
  onProfileClick,
  selectedProfile,
  onSelectProfile
}: SineProfilesProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  
  const { 
    getProfiles, 
    createNewProfile, 
    deleteProfile,
    setActiveProfile
  } = useSineProfileStore()
  
  const profiles = getProfiles()
  
  const handleCreateProfile = () => {
    if (!newProfileName.trim()) return
    
    // Create profile and get the ID
    const newId = createNewProfile(newProfileName.trim())
    
    // Select the new profile
    if (onSelectProfile) {
      onSelectProfile(newId)
    }
    
    // Close dialog
    setShowCreateDialog(false)
    setNewProfileName("")
  }
  
  const handleSelectProfile = (profileId: string) => {
    // Update active profile in store
    setActiveProfile(profileId)
    
    // Notify parent component
    if (onSelectProfile) {
      onSelectProfile(profileId)
    }
  }
  
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Create and manage your sine EQ profiles.
        </p>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => {
            setNewProfileName("")
            setShowCreateDialog(true)
            if (onProfileClick) onProfileClick()
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Profile
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.map((profile) => (
          <Card 
            key={profile.id} 
            className={`cursor-pointer transition-all ${
              selectedProfile === profile.id 
                ? 'border-electric-blue dark:border-electric-blue/70' 
                : 'hover:border-electric-blue/50 dark:hover:border-electric-blue/30'
            }`}
            onClick={() => handleSelectProfile(profile.id)}
          >
            <CardContent className="p-4 flex justify-between items-center">
              <div>
                <h4 className="font-medium">{profile.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {profile.points?.length || 0} control points
                </p>
              </div>
              {selectedProfile === profile.id && (
                <div className="bg-electric-blue text-white p-1 rounded-full">
                  <Check className="h-4 w-4" />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      
      {/* Create New Profile Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Sine EQ Profile</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label htmlFor="profile-name" className="block text-sm font-medium mb-2">
              Profile Name
            </label>
            <Input
              id="profile-name"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="My Custom Sine EQ"
              className="w-full"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-electric-blue hover:bg-electric-blue/90 text-white"
              onClick={handleCreateProfile}
              disabled={!newProfileName.trim()}
            >
              Create Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
} 