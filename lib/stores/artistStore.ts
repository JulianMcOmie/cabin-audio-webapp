import { create } from 'zustand';
import { Artist } from '../models/Artist';

interface ArtistState {
  artists: Record<string, Artist>;
  
  // Actions
  addArtist: (artist: Artist) => void;
  updateArtist: (artistId: string, updates: Partial<Artist>) => void;
  deleteArtist: (artistId: string) => void;
  getArtists: () => Artist[];
  getArtistById: (artistId: string) => Artist | undefined;
}

export const useArtistStore = create<ArtistState>((set, get) => ({
  artists: {},
  
  addArtist: (artist: Artist) => {
    set((state) => ({
      artists: {
        ...state.artists,
        [artist.id]: artist
      }
    }));
  },
  
  updateArtist: (artistId: string, updates: Partial<Artist>) => {
    set((state) => {
      const artist = state.artists[artistId];
      if (!artist) return state;
      
      return {
        artists: {
          ...state.artists,
          [artistId]: {
            ...artist,
            ...updates,
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  deleteArtist: (artistId: string) => {
    set((state) => {
      const newArtists = { ...state.artists };
      delete newArtists[artistId];
      
      return {
        artists: newArtists
      };
    });
  },
  
  getArtists: () => {
    return Object.values(get().artists);
  },
  
  getArtistById: (artistId: string) => {
    return get().artists[artistId];
  }
})); 