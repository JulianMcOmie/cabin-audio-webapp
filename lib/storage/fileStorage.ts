import { v4 as uuidv4 } from 'uuid';
import * as indexedDBManager from './indexedDBManager';
import { Track } from '../models/Track';
import { useTrackStore } from '../stores';

// Store an audio file in IndexedDB
export const storeAudioFile = async (file: File): Promise<string> => {
  const fileId = uuidv4();
  await indexedDBManager.storeFile(
    indexedDBManager.STORES.AUDIO_FILES,
    fileId,
    file
  );
  return fileId;
};

// Get an audio file from IndexedDB
export const getAudioFile = async (fileId: string): Promise<Blob | undefined> => {
  return indexedDBManager.getFile(
    indexedDBManager.STORES.AUDIO_FILES,
    fileId
  );
};

// Delete an audio file from IndexedDB
export const deleteAudioFile = async (fileId: string): Promise<void> => {
  return indexedDBManager.deleteFile(
    indexedDBManager.STORES.AUDIO_FILES,
    fileId
  );
};

// Store an image file (cover art) in IndexedDB
export const storeImageFile = async (file: Blob): Promise<string> => {
  const fileId = uuidv4();
  await indexedDBManager.storeFile(
    indexedDBManager.STORES.IMAGES,
    fileId,
    file
  );
  return fileId;
};

// Get an image file from IndexedDB
export const getImageFile = async (fileId: string): Promise<Blob | undefined> => {
  return indexedDBManager.getFile(
    indexedDBManager.STORES.IMAGES,
    fileId
  );
};

// Delete an image file from IndexedDB
export const deleteImageFile = async (fileId: string): Promise<void> => {
  return indexedDBManager.deleteFile(
    indexedDBManager.STORES.IMAGES,
    fileId
  );
};

// Get the URL for an audio file
export const getAudioFileUrl = async (fileId: string): Promise<string> => {
  const file = await getAudioFile(fileId);
  if (!file) {
    throw new Error(`Audio file with ID ${fileId} not found`);
  }
  return URL.createObjectURL(file);
};

// Get the URL for an image file
export const getImageFileUrl = async (fileId: string): Promise<string> => {
  const file = await getImageFile(fileId);
  if (!file) {
    throw new Error(`Image file with ID ${fileId} not found`);
  }
  return URL.createObjectURL(file);
};

// Clean up object URLs to prevent memory leaks
export const revokeObjectUrl = (url: string): void => {
  URL.revokeObjectURL(url);
};

// Calculate total storage used by audio files
export const getAudioStorageUsage = async (): Promise<number> => {
  return indexedDBManager.getStoreSize(indexedDBManager.STORES.AUDIO_FILES);
};

// Calculate total storage used by image files
export const getImageStorageUsage = async (): Promise<number> => {
  return indexedDBManager.getStoreSize(indexedDBManager.STORES.IMAGES);
};

// Calculate total storage used
export const getTotalStorageUsage = async (): Promise<number> => {
  const audioSize = await getAudioStorageUsage();
  const imageSize = await getImageStorageUsage();
  return audioSize + imageSize;
};

// Clean up unused files (those not referenced by any track)
export const cleanupUnusedFiles = async (): Promise<void> => {
  // Get all tracks to find referenced files
  const tracks = useTrackStore.getState().getTracks();
  
  // Collect all referenced file IDs
  const referencedAudioFiles = new Set<string>();
  const referencedImageFiles = new Set<string>();
  
  tracks.forEach(track => {
    if (track.storageKey) {
      referencedAudioFiles.add(track.storageKey);
    }
    if (track.coverStorageKey) {
      referencedImageFiles.add(track.coverStorageKey);
    }
  });
  
  // Get all stored audio files
  const audioFiles = await indexedDBManager.getAllItems<{ id: string }>(
    indexedDBManager.STORES.AUDIO_FILES
  );
  
  // Delete unreferenced audio files
  for (const file of audioFiles) {
    if (!referencedAudioFiles.has(file.id)) {
      await deleteAudioFile(file.id);
    }
  }
  
  // Get all stored image files
  const imageFiles = await indexedDBManager.getAllItems<{ id: string }>(
    indexedDBManager.STORES.IMAGES
  );
  
  // Delete unreferenced image files
  for (const file of imageFiles) {
    if (!referencedImageFiles.has(file.id)) {
      await deleteImageFile(file.id);
    }
  }
}; 