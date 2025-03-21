import * as apiClient from '../apiClient';
import { Track } from '../../models/Track';

// API endpoints
const TRACKS_ENDPOINT = '/tracks';

// Interface for track response from API
interface TrackResponse {
  id: string;
  title: string;
  artistId?: string;
  albumId?: string;
  duration: number;
  trackNumber?: number;
  year?: number;
  genre?: string;
  storageKey: string;
  coverStorageKey?: string;
  lastModified: number;
}

// Check if a track exists on the server
export const checkTrackExists = async (trackId: string): Promise<boolean> => {
  try {
    await apiClient.get<TrackResponse>(`${TRACKS_ENDPOINT}/${trackId}`);
    return true;
  } catch (error) {
    if (error instanceof apiClient.ApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
};

// Get a track by ID
export const getTrack = async (trackId: string): Promise<Track> => {
  const response = await apiClient.get<TrackResponse>(`${TRACKS_ENDPOINT}/${trackId}`);
  
  return {
    ...response,
    syncStatus: 'synced'
  };
};

// Get all tracks
export const getAllTracks = async (): Promise<Track[]> => {
  const response = await apiClient.get<TrackResponse[]>(TRACKS_ENDPOINT);
  
  return response.map(track => ({
    ...track,
    syncStatus: 'synced'
  }));
};

// Get tracks updated since a specific time
export const getTracksUpdatedSince = async (timestamp: number): Promise<Track[]> => {
  const response = await apiClient.get<TrackResponse[]>(
    `${TRACKS_ENDPOINT}?updatedSince=${timestamp}`
  );
  
  return response.map(track => ({
    ...track,
    syncStatus: 'synced'
  }));
};

// Create a new track
export const createTrack = async (track: Track): Promise<Track> => {
  const response = await apiClient.post<TrackResponse>(TRACKS_ENDPOINT, {
    id: track.id,
    title: track.title,
    artistId: track.artistId,
    albumId: track.albumId,
    duration: track.duration,
    trackNumber: track.trackNumber,
    year: track.year,
    genre: track.genre,
    storageKey: track.storageKey,
    coverStorageKey: track.coverStorageKey
  });
  
  return {
    ...response,
    syncStatus: 'synced'
  };
};

// Update an existing track
export const updateTrack = async (track: Track): Promise<Track> => {
  const response = await apiClient.put<TrackResponse>(
    `${TRACKS_ENDPOINT}/${track.id}`,
    {
      title: track.title,
      artistId: track.artistId,
      albumId: track.albumId,
      duration: track.duration,
      trackNumber: track.trackNumber,
      year: track.year,
      genre: track.genre,
      storageKey: track.storageKey,
      coverStorageKey: track.coverStorageKey
    }
  );
  
  return {
    ...response,
    syncStatus: 'synced'
  };
};

// Delete a track
export const deleteTrack = async (trackId: string): Promise<void> => {
  await apiClient.del(`${TRACKS_ENDPOINT}/${trackId}`);
};

// Upload track audio file
export const uploadTrackAudio = async (
  trackId: string,
  audioFile: Blob
): Promise<void> => {
  // Create form data
  const formData = new FormData();
  formData.append('file', audioFile);
  
  // Upload file
  await apiClient.request<void>(
    `${TRACKS_ENDPOINT}/${trackId}/audio`,
    {
      method: 'POST',
      body: formData,
      headers: {
        // Don't set Content-Type, it will be set automatically with boundary
      }
    }
  );
};

// Download track audio file
export const downloadTrackAudio = async (trackId: string): Promise<Blob> => {
  const response = await fetch(
    `${apiClient.API_BASE_URL}${TRACKS_ENDPOINT}/${trackId}/audio`,
    {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    }
  );
  
  if (!response.ok) {
    throw new apiClient.ApiError(
      'Failed to download track audio',
      response.status
    );
  }
  
  return await response.blob();
};

// Upload track cover image
export const uploadTrackCover = async (
  trackId: string,
  imageFile: Blob
): Promise<void> => {
  // Create form data
  const formData = new FormData();
  formData.append('file', imageFile);
  
  // Upload file
  await apiClient.request<void>(
    `${TRACKS_ENDPOINT}/${trackId}/cover`,
    {
      method: 'POST',
      body: formData,
      headers: {
        // Don't set Content-Type, it will be set automatically with boundary
      }
    }
  );
};

// Download track cover image
export const downloadTrackCover = async (trackId: string): Promise<Blob> => {
  const response = await fetch(
    `${apiClient.API_BASE_URL}${TRACKS_ENDPOINT}/${trackId}/cover`,
    {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    }
  );
  
  if (!response.ok) {
    throw new apiClient.ApiError(
      'Failed to download track cover',
      response.status
    );
  }
  
  return await response.blob();
}; 