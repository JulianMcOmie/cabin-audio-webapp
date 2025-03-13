import { v4 as uuidv4 } from 'uuid';
import * as indexedDBManager from './indexedDBManager';
import * as fileStorage from './fileStorage';
import { Track } from '../models/Track';
import { Album } from '../models/Album';
import { Artist } from '../models/Artist';
import { useTrackStore, useAlbumStore, useArtistStore } from '../stores';

// Extract metadata from an audio file
export const extractMetadata = async (file: File): Promise<{
  title: string;
  artist: string;
  album: string;
  year?: number;
  trackNumber?: number;
  genre?: string;
  coverArt?: Blob;
}> => {
  // In a real implementation, we would use a library like music-metadata-browser
  // to extract metadata from the audio file. For this implementation, we'll
  // simulate metadata extraction from the filename.
  
  const filename = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
  
  // Try to parse filename in format "Artist - Album - Track# - Title"
  const parts = filename.split(' - ');
  
  let title = filename;
  let artist = 'Unknown Artist';
  let album = 'Unknown Album';
  let trackNumber: number | undefined = undefined;
  
  if (parts.length >= 2) {
    // At minimum, assume "Artist - Title" format
    artist = parts[0];
    title = parts[parts.length - 1];
    
    if (parts.length >= 3) {
      // If we have at least 3 parts, assume middle part is album
      album = parts[1];
      
      if (parts.length >= 4) {
        // If we have 4 parts, try to parse track number
        const trackStr = parts[2];
        const trackNum = parseInt(trackStr, 10);
        if (!isNaN(trackNum)) {
          trackNumber = trackNum;
        }
      }
    }
  }
  
  // For this implementation, we don't have real cover art extraction
  // In a real app, we would extract it from the audio file's metadata
  
  return {
    title,
    artist,
    album,
    trackNumber
  };
};

// Save track metadata to IndexedDB and update stores
export const saveTrackMetadata = async (
  file: File,
  storageKey: string
): Promise<Track> => {
  // Extract metadata from file
  const metadata = await extractMetadata(file);
  
  // Find or create artist
  let artistId = '';
  const existingArtists = useArtistStore.getState().getArtists();
  const existingArtist = existingArtists.find(a => a.name === metadata.artist);
  
  if (existingArtist) {
    artistId = existingArtist.id;
  } else {
    // Create new artist
    const newArtist: Artist = {
      id: uuidv4(),
      name: metadata.artist,
      lastModified: Date.now(),
      syncStatus: 'pending'
    };
    
    // Save to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.ARTISTS,
      newArtist
    );
    
    // Update store
    useArtistStore.getState().addArtist(newArtist);
    
    artistId = newArtist.id;
  }
  
  // Find or create album
  let albumId = '';
  const existingAlbums = useAlbumStore.getState().getAlbums();
  const existingAlbum = existingAlbums.find(
    a => a.title === metadata.album && a.artistId === artistId
  );
  
  if (existingAlbum) {
    albumId = existingAlbum.id;
  } else {
    // Create new album
    const newAlbum: Album = {
      id: uuidv4(),
      title: metadata.album,
      artistId,
      year: metadata.year,
      lastModified: Date.now(),
      syncStatus: 'pending'
    };
    
    // Save to IndexedDB
    await indexedDBManager.addItem(
      indexedDBManager.STORES.ALBUMS,
      newAlbum
    );
    
    // Update store
    useAlbumStore.getState().addAlbum(newAlbum);
    
    albumId = newAlbum.id;
  }
  
  // Create track
  const track: Track = {
    id: uuidv4(),
    title: metadata.title,
    artistId,
    albumId,
    duration: 0, // We'll update this after decoding the audio
    trackNumber: metadata.trackNumber,
    year: metadata.year,
    genre: metadata.genre,
    storageKey,
    lastModified: Date.now(),
    syncStatus: 'pending'
  };
  
  // If we have cover art, store it
  if (metadata.coverArt) {
    const coverStorageKey = await fileStorage.storeImageFile(metadata.coverArt);
    track.coverStorageKey = coverStorageKey;
  }
  
  // Save to IndexedDB
  await indexedDBManager.addItem(
    indexedDBManager.STORES.TRACKS,
    track
  );
  
  // Update store
  useTrackStore.getState().addTrack(track);
  
  return track;
};

// Update track duration after decoding audio
export const updateTrackDuration = async (
  trackId: string,
  duration: number
): Promise<void> => {
  const trackStore = useTrackStore.getState();
  const track = trackStore.getTrackById(trackId);
  
  if (track) {
    const updatedTrack = {
      ...track,
      duration,
      lastModified: Date.now()
    };
    
    // Update in IndexedDB
    await indexedDBManager.updateItem(
      indexedDBManager.STORES.TRACKS,
      updatedTrack
    );
    
    // Update in store
    trackStore.updateTrack(trackId, { duration });
  }
};

// Load all metadata from IndexedDB into stores
export const loadAllMetadata = async (): Promise<void> => {
  // Load artists
  const artists = await indexedDBManager.getAllItems<Artist>(
    indexedDBManager.STORES.ARTISTS
  );
  
  artists.forEach(artist => {
    useArtistStore.getState().addArtist(artist);
  });
  
  // Load albums
  const albums = await indexedDBManager.getAllItems<Album>(
    indexedDBManager.STORES.ALBUMS
  );
  
  albums.forEach(album => {
    useAlbumStore.getState().addAlbum(album);
  });
  
  // Load tracks
  const tracks = await indexedDBManager.getAllItems<Track>(
    indexedDBManager.STORES.TRACKS
  );
  
  tracks.forEach(track => {
    useTrackStore.getState().addTrack(track);
  });
}; 