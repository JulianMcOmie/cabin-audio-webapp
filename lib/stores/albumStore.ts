import { create } from 'zustand';
import { Album } from '../models/Album';

interface AlbumState {
  albums: Record<string, Album>;
  
  // Actions
  addAlbum: (album: Album) => void;
  updateAlbum: (albumId: string, updates: Partial<Album>) => void;
  deleteAlbum: (albumId: string) => void;
  getAlbums: () => Album[];
  getAlbumById: (albumId: string) => Album | undefined;
  getAlbumsByArtist: (artistId: string) => Album[];
}

export const useAlbumStore = create<AlbumState>((set, get) => ({
  albums: {},
  
  addAlbum: (album: Album) => {
    set((state) => ({
      albums: {
        ...state.albums,
        [album.id]: album
      }
    }));
  },
  
  updateAlbum: (albumId: string, updates: Partial<Album>) => {
    set((state) => {
      const album = state.albums[albumId];
      if (!album) return state;
      
      return {
        albums: {
          ...state.albums,
          [albumId]: {
            ...album,
            ...updates,
            lastModified: Date.now(),
            syncStatus: 'modified' as const
          }
        }
      };
    });
  },
  
  deleteAlbum: (albumId: string) => {
    set((state) => {
      const newAlbums = { ...state.albums };
      delete newAlbums[albumId];
      
      return {
        albums: newAlbums
      };
    });
  },
  
  getAlbums: () => {
    return Object.values(get().albums);
  },
  
  getAlbumById: (albumId: string) => {
    return get().albums[albumId];
  },
  
  getAlbumsByArtist: (artistId: string) => {
    return Object.values(get().albums).filter(album => album.artistId === artistId);
  }
})); 