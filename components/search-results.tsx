"use client"

import { Music, Sliders } from "lucide-react"

interface SearchResultsProps {
  query: string
}

export function SearchResults({ query }: SearchResultsProps) {
  // Sample data for EQ profiles
  const eqProfiles = [
    { id: "1", name: "Bass Boost", type: "eq" },
    { id: "2", name: "Vocal Clarity", type: "eq" },
    { id: "3", name: "Treble Boost", type: "eq" },
    { id: "4", name: "Cinema", type: "eq" },
    { id: "5", name: "Flat", type: "eq" },
  ]

  // Sample data for songs
  const songs = [
    { id: "1", title: "Ambient Forest", artist: "Nature Sounds", type: "song" },
    { id: "2", title: "Ocean Waves", artist: "Nature Sounds", type: "song" },
    { id: "3", title: "Rainy Day", artist: "Nature Sounds", type: "song" },
    { id: "4", title: "Mountain Stream", artist: "Nature Sounds", type: "song" },
    { id: "5", title: "Thunderstorm", artist: "Nature Sounds", type: "song" },
  ]

  // Filter results based on query
  const filteredEqProfiles = query
    ? eqProfiles.filter((profile) => profile.name.toLowerCase().includes(query.toLowerCase()))
    : eqProfiles

  const filteredSongs = query
    ? songs.filter(
        (song) =>
          song.title.toLowerCase().includes(query.toLowerCase()) ||
          song.artist.toLowerCase().includes(query.toLowerCase()),
      )
    : songs

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-50 max-h-[400px] overflow-auto">
      {filteredEqProfiles.length > 0 || filteredSongs.length > 0 ? (
        <>
          {filteredEqProfiles.length > 0 && (
            <div className="p-2">
              <h3 className="text-xs font-medium text-muted-foreground mb-2 px-2">EQ Profiles</h3>
              <div className="space-y-1">
                {filteredEqProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md cursor-pointer"
                  >
                    <Sliders className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{profile.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredSongs.length > 0 && (
            <div className="p-2 border-t">
              <h3 className="text-xs font-medium text-muted-foreground mb-2 px-2">Songs</h3>
              <div className="space-y-1">
                {filteredSongs.map((song) => (
                  <div
                    key={song.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-md cursor-pointer"
                  >
                    <Music className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm">{song.title}</div>
                      <div className="text-xs text-muted-foreground">{song.artist}</div>
                    </div>
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

