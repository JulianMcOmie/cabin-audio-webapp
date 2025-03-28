"use client"

import { Music, Sliders, ExternalLink } from "lucide-react"
import { useTrackStore, usePlayerStore, useArtistStore } from "@/lib/stores"
import { Track } from "@/lib/models/Track"
import { useEffect, useState } from "react"

interface SearchResultsProps {
  query: string
  setActiveTab?: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => void
  onClose?: () => void
}

type SidebarTab = {
  id: "eq" | "library" | "export" | "desktop" | "mobile" | "profile"
  name: string
  icon: React.ReactNode
}

export function SearchResults({ query, setActiveTab, onClose }: SearchResultsProps) {
  // Get real tracks from track store
  const getTracks = useTrackStore(state => state.getTracks)
  const getArtistById = useArtistStore(state => state.getArtistById)
  const setCurrentTrack = usePlayerStore(state => state.setCurrentTrack)
  const setIsPlaying = usePlayerStore(state => state.setIsPlaying)
  
  // Local state for real tracks
  const [tracks, setTracks] = useState<Track[]>([])
  
  // Load tracks on component mount
  useEffect(() => {
    const loadedTracks = getTracks()
    setTracks(loadedTracks)
  }, [getTracks])
  
  // Define sidebar tabs
  const sidebarTabs: SidebarTab[] = [
    { id: "library", name: "Music Library", icon: <Music className="h-4 w-4 text-purple" /> },
    { id: "eq", name: "EQ Settings", icon: <Sliders className="h-4 w-4 text-electric-blue" /> },
    { id: "export", name: "Export EQ Settings", icon: <ExternalLink className="h-4 w-4 text-red" /> }
  ]

  // Filter tracks based on query
  const filteredTracks = query
    ? tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(query.toLowerCase()) ||
          track.artistId?.toLowerCase().includes(query.toLowerCase())
      )
    : tracks.slice(0, 5) // Only show first 5 tracks when no query
    
  // Filter sidebar tabs based on query
  const filteredTabs = query
    ? sidebarTabs.filter(tab => 
        tab.name.toLowerCase().includes(query.toLowerCase())
      )
    : sidebarTabs
  
  // Handle tab click
  const handleTabClick = (tabId: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => {
    if (setActiveTab) {
      setActiveTab(tabId)
    }
    
    if (onClose) onClose()
  }
  
  // Handle track click
  const handleTrackClick = (trackId: string) => {
    // Play the selected track
    setCurrentTrack(trackId)
    setIsPlaying(true)
    
    if (onClose) onClose()
  }
  
  // Helper to get artist name
  const getArtistName = (artistId: string | undefined) => {
    if (!artistId) return "Unknown Artist"
    
    const artist = getArtistById(artistId)
    return artist?.name || "Unknown Artist"
  }

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-50 max-h-[400px] overflow-auto">
      {filteredTabs.length > 0 || filteredTracks.length > 0 ? (
        <>
          {filteredTracks.length > 0 && (
            <div className="p-2">
              <h3 className="text-xs font-medium text-muted-foreground mb-2 px-2">Songs</h3>
              <div className="space-y-1">
                {filteredTracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md cursor-pointer"
                    onClick={() => handleTrackClick(track.id)}
                  >
                    <Music className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm">{track.title}</div>
                      <div className="text-xs text-muted-foreground">{getArtistName(track.artistId)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredTabs.length > 0 && (
            <div className={`p-2 ${filteredTracks.length > 0 ? 'border-t' : ''}`}>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 px-2">Navigation</h3>
              <div className="space-y-1">
                {filteredTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md cursor-pointer"
                    onClick={() => handleTabClick(tab.id)}
                  >
                    {tab.icon}
                    <span className="text-sm">{tab.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="p-4 text-center text-muted-foreground">
          {query ? "No results found" : "Start typing to search"}
        </div>
      )}
    </div>
  )
}

