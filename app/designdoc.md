# Cabin Audio Backend Architecture Design Document

## Overview

This document outlines the architecture for the Cabin Audio web application backend, focusing on local data management, audio processing, and synchronization with AWS cloud services.

## Core Principles

1. **Separation of Concerns**: Clear boundaries between UI, business logic, and data storage
2. **Unidirectional Data Flow**: State flows down, events flow up
3. **Single Source of Truth**: Zustand store as the central state repository
4. **Progressive Enhancement**: Core functionality works without backend connectivity
5. **Offline-First Approach**: App functions without internet, syncs when connected

## Architecture Components

### 1. State Management

Using Zustand for state management due to its simplicity, hook-based access, and small footprint.

```
/lib/store/
  index.ts              # Combined store exports
  playerStore.ts        # Audio playback state
  libraryStore.ts       # Music library state
  eqStore.ts            # EQ settings state
  authStore.ts          # Authentication state
  syncStore.ts          # Synchronization state
```

Key stores include:

#### playerStore
```typescript
interface PlayerState {
  currentTrackId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  queue: string[];      // Track IDs in queue
  queueIndex: number;   // Current position in queue
}
```

#### libraryStore
```typescript
interface LibraryState {
  tracks: Record<string, Track>;
  albums: Record<string, Album>;
  artists: Record<string, Artist>;
  playlists: Record<string, Playlist>;
  isLoading: boolean;
  error: string | null;
}
```

#### eqStore
```typescript
interface EQState {
  profiles: Record<string, EQProfile>;
  currentProfileId: string | null;
  isEnabled: boolean;
}
```

#### syncStore
```typescript
interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncTime: number | null;
  pendingChanges: number;
  error: string | null;
}
```

### 2. Data Models

```
/lib/models/
  Track.ts              # Track data model
  Album.ts              # Album data model
  Artist.ts             # Artist data model
  Playlist.ts           # Playlist data model
  EQProfile.ts          # EQ profile data model
  EQBand.ts             # EQ band settings
  SyncRecord.ts         # Synchronization record
```

Key models:

#### Track
```typescript
interface Track {
  id: string;
  title: string;
  artistId: string;    // Reference to Artist
  albumId: string;     // Reference to Album
  duration: number;
  trackNumber?: number;
  year?: number;
  genre?: string;
  source: 'local' | 'remote';
  storageKey: string;  // IndexedDB key or S3 path
  coverStorageKey?: string; // Cover art storage location
  lastModified: number;
  syncStatus: 'synced' | 'modified' | 'pending' | 'conflict';
}
```

#### Album
```typescript
interface Album {
  id: string;
  title: string;
  artistId: string;    // Reference to Artist
  year?: number;
  coverStorageKey?: string;
  lastModified: number;
  syncStatus: 'synced' | 'modified' | 'pending' | 'conflict';
}
```

#### Artist
```typescript
interface Artist {
  id: string;
  name: string;
  lastModified: number;
  syncStatus: 'synced' | 'modified' | 'pending' | 'conflict';
}
```

#### Playlist
```typescript
interface Playlist {
  id: string;
  name: string;
  trackIds: string[];  // References to Tracks
  lastModified: number;
  syncStatus: 'synced' | 'modified' | 'pending' | 'conflict';
}
```

#### EQProfile
```typescript
interface EQProfile {
  id: string;
  name: string;
  bands: EQBand[];
  isDefault: boolean;
  lastModified: number;
  syncStatus: 'synced' | 'modified' | 'pending' | 'conflict';
}

interface EQBand {
  frequency: number;
  gain: number;
  q: number;  // Quality factor
}
```

### 3. Local Storage

```
/lib/storage/
  indexedDBManager.ts   # IndexedDB interface
  fileStorage.ts        # Audio file storage
  metadataStorage.ts    # Track metadata storage
```

Responsibilities:
- Store audio files in IndexedDB
- Extract and store metadata from files
- Implement CRUD operations for all entities
- Manage storage limits and cleanup

### 4. Audio Engine

```
/lib/audio/
  audioContext.ts       # AudioContext singleton
  audioPlayer.ts        # Audio playback
  eqProcessor.ts        # EQ processing
  audioRouting.ts       # Audio routing
  playbackQueue.ts      # Queue management
```

#### audioContext.ts
- Creates and manages a singleton Web Audio API context
- Handles browser audio limitations and permissions
- Provides shared context to other audio components

#### audioPlayer.ts
- Loads and decodes audio files
- Controls playback (play, pause, seek)
- Tracks playback state
- Interfaces with audioRouting for output

#### eqProcessor.ts
- Creates filter nodes for EQ bands
- Applies EQ profiles to filter settings
- Provides input/output nodes for the audio chain

#### audioRouting.ts
- Manages audio signal chain
- Connects/disconnects audio nodes
- Handles output device selection

#### playbackQueue.ts
- Maintains queue of tracks for playback
- Handles next/previous track selection
- Supports shuffle and repeat modes

### 5. Synchronization

```
/lib/sync/
  syncManager.ts        # Sync orchestration
  syncQueue.ts          # Offline change queue
  entitySync/
    trackSync.ts        # Track synchronization
    albumSync.ts        # Album synchronization
    artistSync.ts       # Artist synchronization
    playlistSync.ts     # Playlist synchronization
    eqSync.ts           # EQ profile synchronization
```

#### syncManager.ts
- Orchestrates overall sync process
- Determines sync priorities and order
- Tracks global sync state
- Handles authentication for sync operations

#### syncQueue.ts
- Records operations when offline
- Prioritizes operations for sync
- Handles retries and backoff
- Maintains operation history for conflict resolution

#### Entity-specific sync handlers
- Implement entity-specific sync logic
- Handle serialization/deserialization
- Implement conflict resolution strategies
- Track entity-specific sync state

### 6. API Layer

```
/lib/api/
  apiClient.ts          # Base API client
  endpoints/
    tracksApi.ts        # Track-related endpoints
    albumsApi.ts        # Album-related endpoints
    artistsApi.ts       # Artist-related endpoints
    playlistsApi.ts     # Playlist-related endpoints
    eqApi.ts            # EQ-related endpoints
    authApi.ts          # Authentication endpoints
```

Responsibilities:
- Handle communication with AWS backend
- Manage authentication and tokens
- Format requests and parse responses
- Handle API errors and retries

### 7. UI Hooks

```
/lib/hooks/
  usePlayer.ts          # Player controls hook
  useLibrary.ts         # Library access hook
  useEQ.ts              # EQ controls hook
  useSync.ts            # Sync status hook
  useSearch.ts          # Search functionality hook
```

These hooks connect UI components to the state and services:
- Expose state for rendering
- Provide actions for user interactions
- Abstract implementation details from components
- Handle loading and error states

## Data Flow

### Music Playback Flow

1. User selects track → libraryStore provides track data
2. play() action dispatched → playerStore updates state
3. audioPlayer subscribes to state change
4. audioPlayer loads audio from IndexedDB (local) or S3 (remote)
5. Audio routed through EQ processor via audioRouting
6. Playback progress updates playerStore
7. UI components react to playerStore changes

### Library Management Flow

1. User uploads file → fileStorage stores in IndexedDB
2. Metadata extracted → metadataStorage updates
3. libraryStore updated with new track
4. syncQueue records change for future sync
5. UI updates to show new track
6. When online, syncManager processes queue
7. trackSync uploads to S3 and updates DynamoDB
8. syncStore updated with completion status

### EQ Adjustment Flow

1. User adjusts EQ → eqStore updates state
2. eqProcessor subscribes to state change
3. Audio processing updated in real-time
4. User saves profile → eqStore creates new profile
5. syncQueue records change for future sync
6. When online, eqSync uploads to DynamoDB
7. syncStore updated with completion status

## Sync Process

### Automatic Sync Triggers

1. **App Initialization**: Check for pending changes on startup
2. **Authentication**: Sync after successful login
3. **Connectivity Change**: Sync when coming online
4. **Periodic**: Background sync at intervals when online
5. **Data Change**: Trigger sync after significant local changes

### Sync Priority

1. Small metadata (artists, albums)
2. EQ profiles
3. Playlists
4. Track metadata
5. Audio files (on demand or by user preference)

### Conflict Resolution

For V1, we'll implement a simple timestamp-based "last write wins" strategy:
1. Compare lastModified timestamps
2. Keep the most recent version
3. For playlist conflicts, merge and remove duplicates
4. For EQ profiles, create a new version with conflict suffix

In future versions, we can implement more sophisticated conflict resolution:
1. Three-way merge for compatible changes
2. User selection for incompatible changes
3. Detailed conflict visualization and resolution UI

## Implementation Phases

### Phase 1: Core Infrastructure
- State management setup
- Data models definition
- Basic IndexedDB storage
- Simple audio playback

### Phase 2: Audio Processing
- Web Audio API integration
- EQ processing implementation
- Playback queue management

### Phase 3: Synchronization
- Sync queue implementation
- Basic AWS integration
- Simple conflict resolution

### Phase 4: Refinement
- Performance optimization
- Error handling improvement
- Edge case coverage
- UI polish

## Future Considerations

- Collaborative playlists
- Advanced audio analysis
- Machine learning for music recommendations
- Audio fingerprinting for duplicate detection
- Social sharing features
