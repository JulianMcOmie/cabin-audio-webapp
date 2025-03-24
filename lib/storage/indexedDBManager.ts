const DB_NAME = 'cabinAudioDB';
const DB_VERSION = 2;

// Define store names
export const STORES = {
  TRACKS: 'tracks',
  ALBUMS: 'albums',
  ARTISTS: 'artists',
  PLAYLISTS: 'playlists',
  EQ_PROFILES: 'eqProfiles',
  SINE_PROFILES: 'sineProfiles',
  AUDIO_FILES: 'audioFiles',
  IMAGES: 'images',
  SYNC_STATE: 'syncState'
};

// Initialize the database
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (event) => {
      reject(`Database error: ${(event.target as IDBRequest).error}`);
    };
    
    request.onsuccess = (event) => {
      resolve((event.target as IDBRequest).result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBRequest).result;
      
      // Create object stores with indices
      if (!db.objectStoreNames.contains(STORES.TRACKS)) {
        const trackStore = db.createObjectStore(STORES.TRACKS, { keyPath: 'id' });
        trackStore.createIndex('artistId', 'artistId', { unique: true });
        trackStore.createIndex('albumId', 'albumId', { unique: true });
        trackStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.ALBUMS)) {
        const albumStore = db.createObjectStore(STORES.ALBUMS, { keyPath: 'id' });
        albumStore.createIndex('artistId', 'artistId', { unique: true });
        albumStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.ARTISTS)) {
        const artistStore = db.createObjectStore(STORES.ARTISTS, { keyPath: 'id' });
        artistStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.PLAYLISTS)) {
        const playlistStore = db.createObjectStore(STORES.PLAYLISTS, { keyPath: 'id' });
        playlistStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.EQ_PROFILES)) {
        const eqProfileStore = db.createObjectStore(STORES.EQ_PROFILES, { keyPath: 'id' });
        eqProfileStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.SINE_PROFILES)) {
        const sineProfileStore = db.createObjectStore(STORES.SINE_PROFILES, { keyPath: 'id' });
        sineProfileStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.AUDIO_FILES)) {
        db.createObjectStore(STORES.AUDIO_FILES, { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains(STORES.IMAGES)) {
        db.createObjectStore(STORES.IMAGES, { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains(STORES.SYNC_STATE)) {
        db.createObjectStore(STORES.SYNC_STATE, { keyPath: 'id' });
      }
    };
  });
};

// Generic function to add an item to a store
export const addItem = <T>(storeName: string, item: T): Promise<T> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(item);
      
      request.onsuccess = () => {
        resolve(item);
      };
      
      request.onerror = (event) => {
        reject(`Error adding item to ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Generic function to update an item in a store
export const updateItem = <T>(storeName: string, item: T): Promise<T> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(item);
      
      request.onsuccess = () => {
        resolve(item);
      };
      
      request.onerror = (event) => {
        reject(`Error updating item in ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Generic function to delete an item from a store
export const deleteItem = (storeName: string, id: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = (event) => {
        reject(`Error deleting item from ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Generic function to get an item from a store
export const getItem = <T>(storeName: string, id: string): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);
      
      request.onsuccess = (event) => {
        resolve((event.target as IDBRequest).result);
      };
      
      request.onerror = (event) => {
        reject(`Error getting item from ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Generic function to get all items from a store
export const getAllItems = <T>(storeName: string): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onsuccess = (event) => {
        resolve((event.target as IDBRequest).result);
      };
      
      request.onerror = (event) => {
        reject(`Error getting all items from ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Function to get items by index
export const getItemsByIndex = <T>(
  storeName: string, 
  indexName: string, 
  value: IDBValidKey
): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      
      request.onsuccess = (event) => {
        resolve((event.target as IDBRequest).result);
      };
      
      request.onerror = (event) => {
        reject(`Error getting items by index from ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Function to clear a store
export const clearStore = (storeName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = (event) => {
        reject(`Error clearing store ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Function to store a binary file (audio or image)
export const storeFile = (
  storeName: string, 
  id: string, 
  file: Blob
): Promise<string> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put({ id, data: file });
      
      request.onsuccess = () => {
        resolve(id);
      };
      
      request.onerror = (event) => {
        reject(`Error storing file in ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Function to retrieve a binary file
export const getFile = (storeName: string, id: string): Promise<Blob | undefined> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);
      
      request.onsuccess = (event) => {
        const result = (event.target as IDBRequest).result;
        resolve(result ? result.data : undefined);
      };
      
      request.onerror = (event) => {
        reject(`Error getting file from ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
};

// Function to delete a file
export const deleteFile = (storeName: string, id: string): Promise<void> => {
  return deleteItem(storeName, id);
};

// Function to get the total size of a store
export const getStoreSize = (storeName: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    initDB().then(db => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.openCursor();
      
      let size = 0;
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const value = cursor.value;
          // For binary data, use the size of the blob
          if (value.data instanceof Blob) {
            size += value.data.size;
          } else {
            // For JSON data, estimate size by stringifying
            size += new Blob([JSON.stringify(value)]).size;
          }
          cursor.continue();
        } else {
          resolve(size);
        }
      };
      
      request.onerror = (event) => {
        reject(`Error calculating store size for ${storeName}: ${(event.target as IDBRequest).error}`);
      };
    }).catch(reject);
  });
}; 