import { create } from 'zustand';
import { Playlist } from '../models/Playlist';

interface PlaylistState {
  playlists: Record<string, Playlist>;
  currentPlaylistId: string | null;
  
  // Actions
  addPlaylist: (playlist: Playlist) => void;
  updatePlaylist: (playlistId: string, updates: Partial<Playlist>) => void;
  deletePlaylist: (playlistId: string) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  setCurrentPlaylist: (playlistId: string | null) => void;
  getPlaylists: () => Playlist[];
  getPlaylistById: (playlistId: string) => Playlist | undefined;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: {},
  currentPlaylistId: null,
  
  addPlaylist: (playlist: Playlist) => {
    set((state) => ({
      playlists: {
        ...state.playlists,
        [playlist.id]: playlist
      }
    }));
  },
  
  updatePlaylist: (playlistId: string, updates: Partial<Playlist>) => {
    set((state) => {
      const playlist = state.playlists[playlistId];
      if (!playlist) return state;
      
      return {
        playlists: {
          ...state.playlists,
          [playlistId]: {
            ...playlist,
            ...updates,
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  deletePlaylist: (playlistId: string) => {
    set((state) => {
      const newPlaylists = { ...state.playlists };
      delete newPlaylists[playlistId];
      
      // Reset current playlist if it was deleted
      const newCurrentPlaylistId = 
        state.currentPlaylistId === playlistId ? null : state.currentPlaylistId;
      
      return {
        playlists: newPlaylists,
        currentPlaylistId: newCurrentPlaylistId
      };
    });
  },
  
  addTrackToPlaylist: (playlistId: string, trackId: string) => {
    set((state) => {
      const playlist = state.playlists[playlistId];
      if (!playlist) return state;
      
      // Don't add duplicate track
      if (playlist.trackIds.includes(trackId)) return state;
      
      return {
        playlists: {
          ...state.playlists,
          [playlistId]: {
            ...playlist,
            trackIds: [...playlist.trackIds, trackId],
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => {
    set((state) => {
      const playlist = state.playlists[playlistId];
      if (!playlist) return state;
      
      return {
        playlists: {
          ...state.playlists,
          [playlistId]: {
            ...playlist,
            trackIds: playlist.trackIds.filter(id => id !== trackId),
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  setCurrentPlaylist: (playlistId: string | null) => {
    set({ currentPlaylistId: playlistId });
  },
  
  getPlaylists: () => {
    return Object.values(get().playlists);
  },
  
  getPlaylistById: (playlistId: string) => {
    return get().playlists[playlistId];
  }
})); 