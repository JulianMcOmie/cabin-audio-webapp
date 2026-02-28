import { create } from 'zustand';
import { Track } from '../models/Track';
import { Artist } from '../models/Artist';
import { Album } from '../models/Album';
import * as indexedDBManager from '../storage/indexedDBManager';
import { v4 as uuidv4 } from 'uuid';
import { useArtistStore } from './artistStore';
import { useAlbumStore } from './albumStore';

interface TrackState {
  tracks: Record<string, Track>;
  currentTrackId: string | null;
  isPlaying: boolean;
  isLoading?: boolean; // Optional for UI to respond to, but not required
  
  // Actions
  addTrack: (track: Track) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  deleteTrack: (trackId: string) => void;
  setCurrentTrack: (trackId: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  getTracks: () => Track[];
  getTrackById: (trackId: string) => Track | undefined;
}

// Create default artist, album and track
const createDefaultContent = async (): Promise<{track: Track, artistId: string, albumId: string}> => {
  // Create the artist
  const artistId = uuidv4();
  const artist: Artist = {
    id: artistId,
    name: "TheFatRat",
    lastModified: Date.now(),
    syncStatus: "synced"
  };
  
  // Create the album
  const albumId = uuidv4();
  const album: Album = {
    id: albumId,
    title: "Xenogenesis",
    artistId: artistId,
    year: 2014,
    coverStorageKey: "default-xenogenesis-cover",
    lastModified: Date.now(),
    syncStatus: "synced"
  };
  
  // Create the track
  const track: Track = {
    id: uuidv4(),
    title: "Xenogenesis",
    artistId: artistId,
    albumId: albumId,
    duration: 0, // This will be updated when audio is loaded
    trackNumber: 1,
    year: 2014,
    genre: "Electronic",
    storageKey: "default-xenogenesis",
    coverStorageKey: "default-xenogenesis-cover",
    lastModified: Date.now(),
    dateCreated: Date.now(),
    syncStatus: "synced"
  };
  
  // Store artist and album in IndexedDB
  await indexedDBManager.addItem(indexedDBManager.STORES.ARTISTS, artist);
  await indexedDBManager.addItem(indexedDBManager.STORES.ALBUMS, album);
  
  // Add to respective stores
  useArtistStore.getState().addArtist(artist);
  useAlbumStore.getState().addAlbum(album);
  
  return { track, artistId, albumId };
};

// Helper function to load tracks from IndexedDB
const loadTracksFromStorage = async (): Promise<{tracks: Record<string, Track>, defaultTrackId?: string}> => {
  try {
    // Load artists and albums from IndexedDB into their stores
    const [storedArtists, storedAlbums] = await Promise.all([
      indexedDBManager.getAllItems<Artist>(indexedDBManager.STORES.ARTISTS),
      indexedDBManager.getAllItems<Album>(indexedDBManager.STORES.ALBUMS),
    ]);
    storedArtists.forEach(artist => useArtistStore.getState().addArtist(artist));
    storedAlbums.forEach(album => useAlbumStore.getState().addAlbum(album));

    const tracks = await indexedDBManager.getAllItems<Track>(indexedDBManager.STORES.TRACKS);
    const tracksMap: Record<string, Track> = {};
    let defaultTrackId: string | undefined;

    tracks.forEach(track => {
      tracksMap[track.id] = track;
    });
    
    // If no tracks exist, add the default track
    if (Object.keys(tracksMap).length === 0) {
      // Create default content (artist, album, track)
      const { track: defaultTrack } = await createDefaultContent();
      tracksMap[defaultTrack.id] = defaultTrack;
      defaultTrackId = defaultTrack.id;
      
      // Store the default track in IndexedDB
      await indexedDBManager.addItem(indexedDBManager.STORES.TRACKS, defaultTrack);
      
      // Also store the audio file and cover art references
      try {
        // Load audio file
        const audioResponse = await fetch('/Xenogenesis.wav');
        if (audioResponse.ok) {
          const audioBlob = await audioResponse.blob();
          await indexedDBManager.storeFile(
            indexedDBManager.STORES.AUDIO_FILES, 
            defaultTrack.storageKey, 
            audioBlob
          );
        }
        
        // Load cover art
        const coverResponse = await fetch('/Xenogenesis.jpg');
        if (coverResponse.ok) {
          const coverBlob = await coverResponse.blob();
          await indexedDBManager.storeFile(
            indexedDBManager.STORES.IMAGES, 
            defaultTrack.coverStorageKey!, 
            coverBlob
          );
        }
      } catch (error) {
        console.error('Error loading default track assets:', error);
      }
    }
    
    if (!defaultTrackId && Object.keys(tracksMap).length > 0) {
      const firstTrack = Object.values(tracksMap).sort((a, b) => {
        const aDate = a.dateCreated || a.lastModified;
        const bDate = b.dateCreated || b.lastModified;
        return aDate - bDate;
      })[0];
      defaultTrackId = firstTrack?.id;
    }
    
    return { tracks: tracksMap, defaultTrackId };
  } catch (error) {
    console.error('Error loading tracks from storage:', error);
    return { tracks: {} };
  }
};

export const useTrackStore = create<TrackState>((set, get) => {
  // Start loading tracks immediately but don't block initialization
  let initialized = false;
  let initialLoadPromise: Promise<void> | null = null;
  
  // Define internal initialization function
  const initialize = () => {
    if (initialized || initialLoadPromise) return initialLoadPromise;
    
    // Set loading state
    set({ isLoading: true });
    
    // Load tracks from storage
    initialLoadPromise = loadTracksFromStorage()
      .then(({ tracks: loadedTracks, defaultTrackId }) => {
        set({ 
          tracks: loadedTracks, 
          isLoading: false,
          currentTrackId: defaultTrackId || get().currentTrackId
        });
        initialized = true;
      })
      .catch(error => {
        console.error('Failed to initialize track store:', error);
        set({ isLoading: false });
      });
    
    return initialLoadPromise;
  };
  
  // Start initialization immediately
  initialize();
  
  return {
    tracks: {},
    currentTrackId: null,
    isPlaying: false,
    isLoading: true, // Initially loading
    
    addTrack: (track: Track) => {
      // Ensure dateCreated is set if not provided
      const trackWithDate = {
        ...track,
        dateCreated: track.dateCreated || Date.now()
      };
      
      // Update local state first for immediate UI feedback
      set((state) => ({
        tracks: {
          ...state.tracks,
          [trackWithDate.id]: trackWithDate
        }
      }));
      
      // Then persist to IndexedDB (fire and forget)
      indexedDBManager.addItem(indexedDBManager.STORES.TRACKS, trackWithDate)
        .catch(error => console.error('Failed to save track:', error));
    },
    
    updateTrack: (trackId: string, updates: Partial<Track>) => {
      set((state) => {
        const track = state.tracks[trackId];
        if (!track) return state;
        
        const updatedTrack = {
          ...track,
          ...updates,
          dateCreated: track.dateCreated || track.lastModified, // Preserve dateCreated or set it if missing
          lastModified: Date.now(),
          syncStatus: 'modified' as const
        };
        
        // Update local state first
        const newState = {
          tracks: {
            ...state.tracks,
            [trackId]: updatedTrack
          }
        };
        
        // Then persist to IndexedDB (fire and forget)
        indexedDBManager.updateItem(indexedDBManager.STORES.TRACKS, updatedTrack)
          .catch(error => console.error('Failed to update track:', error));
        
        return newState;
      });
    },
    
    deleteTrack: (trackId: string) => {
      set((state) => {
        const newTracks = { ...state.tracks };
        delete newTracks[trackId];
        
        // Reset current track if it was deleted
        const newCurrentTrackId = 
          state.currentTrackId === trackId ? null : state.currentTrackId;
        
        // Delete from IndexedDB (fire and forget)
        indexedDBManager.deleteItem(indexedDBManager.STORES.TRACKS, trackId)
          .catch(error => console.error('Failed to delete track:', error));
        
        return {
          tracks: newTracks,
          currentTrackId: newCurrentTrackId
        };
      });
    },
    
    setCurrentTrack: (trackId: string | null) => {
      set({ currentTrackId: trackId });
    },
    
    setIsPlaying: (playing: boolean) => {
      set({ isPlaying: playing });
    },
    
    getTracks: () => {
      // Ensure tracks are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      
      // Get tracks and sort by dateCreated (ascending - oldest first)
      const tracksArray = Object.values(get().tracks);
      return tracksArray.sort((a, b) => {
        // If dateCreated doesn't exist, use lastModified as fallback
        const aDate = a.dateCreated || a.lastModified;
        const bDate = b.dateCreated || b.lastModified;
        return aDate - bDate;
      });
    },
    
    getTrackById: (trackId: string) => {
      // Ensure tracks are loaded before returning
      if (!initialized && !initialLoadPromise) {
        initialize();
      }
      return get().tracks[trackId];
    }
  };
}); 
