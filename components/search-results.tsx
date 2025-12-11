"use client"

import { Music, Sliders, ExternalLink, Play } from "lucide-react"
import { useTrackStore, usePlayerStore, useArtistStore, useAlbumStore } from "@/lib/stores"
import { Track } from "@/lib/models/Track"
import { useEffect, useState, useCallback } from "react"
import { useTheme } from "@/components/theme-provider"
import * as fileStorage from "@/lib/storage/fileStorage"
import Image from "next/image"

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

// UI version of track with resolved artist, album, cover
interface UITrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string
}

export function SearchResults({ query, setActiveTab, onClose }: SearchResultsProps) {
  // Get theme
  const { theme } = useTheme()
  
  // Get stores data
  const getTracks = useTrackStore(state => state.getTracks)
  const getArtistById = useArtistStore(state => state.getArtistById)
  const getAlbumById = useAlbumStore(state => state.getAlbumById)
  const setCurrentTrack = usePlayerStore(state => state.setCurrentTrack)
  const setIsPlaying = usePlayerStore(state => state.setIsPlaying)
  
  // Local state for tracks and cover images
  const [storeTracks, setStoreTracks] = useState<Track[]>([])
  const [coverImageUrls, setCoverImageUrls] = useState<Record<string, string>>({})
  const [uiTracks, setUITracks] = useState<UITrack[]>([])

  // Get the actual default image path based on theme
  // Make sure path is absolute and exists
  const getDefaultCoverImage = useCallback(() => {
    const timestamp = Date.now(); // Add timestamp to prevent caching
    const basePath = theme === 'dark' ? '/default_img_dark.jpg' : '/default_img_light.jpg';
    return `${basePath}?t=${timestamp}`;
  }, [theme])

  // Load tracks on component mount
  useEffect(() => {
    const loadedTracks = getTracks()
    setStoreTracks(loadedTracks)
    
    // First collect all needed cover art keys
    const coverKeys = loadedTracks
      .filter(track => track.coverStorageKey)
      .map(track => track.coverStorageKey!)
      .filter(key => !coverImageUrls[key]);
    
    console.log(`[SearchResults] Found ${coverKeys.length} cover keys to load`);
    
    // Load cover URLs if not already loaded
    if (coverKeys.length > 0) {
      Promise.all(
        coverKeys.map(async (key) => {
          try {
            const url = await fileStorage.getImageFileUrl(key);
            console.log(`[SearchResults] Loaded URL for key ${key}: ${url}`);
            return { key, url };
          } catch (error) {
            console.error(`[SearchResults] Error loading cover art for key ${key}:`, error);
            return { key, url: getDefaultCoverImage() };
          }
        })
      ).then(results => {
        const newUrls: Record<string, string> = { ...coverImageUrls };
        results.forEach(({ key, url }) => {
          newUrls[key] = url;
        });
        console.log(`[SearchResults] Caching ${results.length} cover URLs`);
        setCoverImageUrls(newUrls);
      });
    }
  }, [getTracks, coverImageUrls, getDefaultCoverImage])

  // Convert store tracks to UI tracks whenever store tracks or cover URLs change
  useEffect(() => {
    if (storeTracks.length === 0) return;
    
    const convertedTracks = storeTracks.map((storeTrack): UITrack => {
      // Get artist name
      let artistName = "Unknown Artist";
      if (storeTrack.artistId) {
        const artist = getArtistById(storeTrack.artistId);
        if (artist) {
          artistName = artist.name;
        }
      }
      
      // Get album name
      let albumName = "Unknown Album";
      if (storeTrack.albumId) {
        const album = getAlbumById(storeTrack.albumId);
        if (album) {
          albumName = album.title;
        }
      }
      
      // Get cover URL from cache or use default image
      let coverUrl = getDefaultCoverImage(); // Default to theme-based image
      
      // If track has a cover and we have it in our URL cache, use it
      if (storeTrack.coverStorageKey && coverImageUrls[storeTrack.coverStorageKey]) {
        coverUrl = coverImageUrls[storeTrack.coverStorageKey];
      }
      
      return {
        id: storeTrack.id,
        title: storeTrack.title,
        artist: artistName,
        album: albumName,
        duration: storeTrack.duration,
        coverUrl
      };
    });
    
    setUITracks(convertedTracks);
  }, [storeTracks, coverImageUrls, getArtistById, getAlbumById, theme, getDefaultCoverImage])
  
  // Format duration (seconds to mm:ss)
  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    
    // Round to nearest second to avoid floating point issues
    const totalSeconds = Math.round(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  // Handle track click (play selected track)
  const handleTrackClick = (trackId: string) => {
    const storeTrack = storeTracks.find(t => t.id === trackId);
    if (storeTrack) {
      setCurrentTrack(storeTrack.id);
      setIsPlaying(true);
      if (onClose) onClose();
    }
  };
  
  // Define sidebar tabs
  const sidebarTabs: SidebarTab[] = [
    { id: "library", name: "Music Library", icon: <Music className="h-4 w-4 text-purple" /> },
    { id: "eq", name: "EQ Settings", icon: <Sliders className="h-4 w-4 text-electric-blue" /> },
    { id: "export", name: "Export EQ Settings", icon: <ExternalLink className="h-4 w-4 text-red" /> }
  ]
  
  // Filter sidebar tabs based on query
  const filteredTabs = query
    ? sidebarTabs.filter(tab => 
        tab.name.toLowerCase().includes(query.toLowerCase())
      )
    : sidebarTabs
  
  // Filter tracks based on query
  const filteredTracks = query
    ? uiTracks.filter(
        (track) =>
          track.title.toLowerCase().includes(query.toLowerCase()) ||
          track.artist.toLowerCase().includes(query.toLowerCase()) ||
          track.album.toLowerCase().includes(query.toLowerCase())
      )
    : uiTracks.slice(0, 5) // Only show first 5 tracks when no query
    
  // Handle tab click
  const handleTabClick = (tabId: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => {
    if (setActiveTab) {
      setActiveTab(tabId)
    }
    
    if (onClose) onClose()
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
                    <div className="flex-shrink-0 relative group">
                      <div className="h-10 w-10 rounded-md overflow-hidden relative">
                        <Image 
                          src={track.coverUrl}
                          alt={`${track.album} cover`}
                          fill
                          className="object-cover"
                          unoptimized
                          onError={(e) => {
                            console.log(`[SearchResults] Image error for ${track.id}, falling back to default`);
                            const img = e.target as HTMLImageElement;
                            img.src = getDefaultCoverImage();
                            img.srcset = "";
                          }}
                        />
                      </div>
                      <div
                        className="absolute inset-0 bg-black/40 rounded-md opacity-0 hover:opacity-100 flex items-center justify-center"
                      >
                        <Play className="h-5 w-5 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{track.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {track.artist} • {track.album}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatDuration(track.duration)}
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

