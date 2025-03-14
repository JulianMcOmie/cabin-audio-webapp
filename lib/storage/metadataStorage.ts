import { v4 as uuidv4 } from 'uuid';
import * as indexedDBManager from './indexedDBManager';
import * as fileStorage from './fileStorage';
import { Track } from '../models/Track';
import { Album } from '../models/Album';
import { Artist } from '../models/Artist';
import { useTrackStore, useAlbumStore, useArtistStore } from '../stores';

interface AudioMetadata {
  title: string
  artist: string
  album: string
  duration: number
  year?: number
  trackNumber?: number
  genre?: string
  coverArt?: Blob
}

/**
 * Extracts metadata from an audio file using Web Audio API for duration
 * and basic file parsing for ID3/metadata tags
 */
export async function extractMetadata(file: File): Promise<AudioMetadata> {
  // Get duration using Web Audio API
  const duration = await getAudioDuration(file)
  
  // For now return basic metadata with just duration
  // In a full implementation, we would parse ID3 tags here
  return {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: "Unknown Artist",
    album: "Unknown Album", 
    duration
  }
}

/**
 * Gets audio duration using Web Audio API
 */
async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    // Create temporary audio context
    const audioContext = new (window.AudioContext || window.webkitAudioContext)()
    
    // Create file reader to get array buffer
    const reader = new FileReader()
    
    reader.onload = async (e) => {
      try {
        if (!e.target?.result || typeof e.target.result === 'string') {
          throw new Error('Failed to read file')
        }
        
        // Decode audio data to get duration
        const audioBuffer = await audioContext.decodeAudioData(e.target.result)
        resolve(audioBuffer.duration)
        
        // Clean up
        audioContext.close()
      } catch (error) {
        reject(error)
      }
    }
    
    reader.onerror = (error) => reject(error)
    
    // Read file as array buffer
    reader.readAsArrayBuffer(file)
  })
}

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
    duration: metadata.duration,
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