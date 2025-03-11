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

interface EQProfile {
  id: string
  name: string
  imageUrl: string
}

interface EQProfilesProps {
  onProfileClick?: () => void
  selectedProfile: string
  onSelectProfile: (name: string) => void
}

export function EQProfiles({ onProfileClick, selectedProfile, onSelectProfile }: EQProfilesProps) {
  const profiles: EQProfile[] = [
    {
      id: "1",
      name: "Flat",
      imageUrl: "/placeholder.svg?height=80&width=160",
    },
    {
      id: "2",
      name: "Bass Boost",
      imageUrl: "/placeholder.svg?height=80&width=160",
    },
    {
      id: "3",
      name: "Vocal Clarity",
      imageUrl: "/placeholder.svg?height=80&width=160",
    },
    {
      id: "4",
      name: "Treble Boost",
      imageUrl: "/placeholder.svg?height=80&width=160",
    },
    {
      id: "5",
      name: "Cinema",
      imageUrl: "/placeholder.svg?height=80&width=160",
    },
  ]

  return (
    <div>
      <ScrollArea className="w-full whitespace-nowrap" scrollHideDelay={0}>
        <div className="pb-4">
          {" "}
          {/* Add padding to bottom to ensure no vertical scrolling */}
          <div className="flex w-max space-x-4 p-1">
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isSelected={selectedProfile === profile.name}
                onSelect={() => onSelectProfile(profile.name)}
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
  onSelect,
}: {
  profile: EQProfile
  isSelected: boolean
  onSelect: () => void
}) {
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
              <DropdownMenuItem className="text-red-600">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="aspect-[2/1] overflow-hidden rounded-md mb-2">
          <img src={profile.imageUrl || "/placeholder.svg"} alt={profile.name} className="w-full h-full object-cover" />
        </div>
        <h4 className="font-medium text-center">{profile.name}</h4>

        {isSelected && (
          <div className="absolute inset-0 bg-electric-blue-light/30 dark:bg-electric-blue-light/20 rounded-md"></div>
        )}
      </CardContent>
    </Card>
  )
}

