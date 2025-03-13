# Cabin Audio Backend Architecture Design Document

## Overview

This document outlines the architecture for the Cabin Audio web application backend, focusing on local data management, audio processing, and synchronization with AWS cloud services.

## Core Principles

1. **Separation of Concerns**: Clear boundaries between UI, business logic, and data storage
2. **Unidirectional Data Flow**: State flows down, events flow up
3. **Single Source of Truth**: Zustand store as the central state repository
4. **Progressive Enhancement**: Core functionality works without backend connectivity
5. **Offline-First Approach**: App functions without internet, syncs when connected
6. **Download-First Playback**: V1 only supports playback of fully downloaded audio files

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
  loadingState: 'idle' | 'loading' | 'decoding' | 'ready' | 'error';
  loadingProgress: number; // 0-100 percentage for tracking file loading
  error: string | null;
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
  currentProfileId: string | null;  // Represents last used/default profile
  isEnabled: boolean;
}
```

#### syncStore
```typescript
interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncTime: number | null;
  hasPendingChanges: boolean;
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
  artistId?: string;
  albumId?: string;
  duration: number;
  trackNumber?: number;
  year?: number;
  genre?: string;
  storageKey: string;  // IndexedDB key
  coverStorageKey?: string;
  lastModified: number;
  syncStatus: 'synced' | 'modified' | 'pending' | 'conflict';
}
```

#### Album
```typescript
interface Album {
  id: string;
  title: string;
  artistId?: string;    // Reference to Artist
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
- Handle complete downloads of audio files before playback

### 4. Audio Engine

```
/lib/audio/
  audioContext.ts       # AudioContext singleton
  audioPlayer.ts        # Audio playback
  eqProcessor.ts        # EQ processing
  audioRouting.ts       # Audio routing
```

#### audioContext.ts
- Creates and manages a singleton Web Audio API context
- Handles browser audio limitations and permissions
- Provides shared context to other audio components

#### audioPlayer.ts
- Loads and decodes audio files from IndexedDB
- Controls playback (play, pause, seek)
- Tracks playback state
- Interfaces with audioRouting for output
- Only plays locally downloaded files (no streaming in v1)

#### eqProcessor.ts
- Creates filter nodes for EQ bands
- Applies EQ profiles to filter settings
- Provides input/output nodes for the audio chain
- On initialization, loads last used profile or applies default profile
- Default "Flat" profile is included for first-time users

#### audioRouting.ts
- Manages audio signal chain
- Connects/disconnects audio nodes
- Handles output device selection

### 5. Synchronization

```
/lib/sync/
  syncManager.ts        # Sync orchestration
  entitySync/
    trackSync.ts        # Track synchronization
    albumSync.ts        # Album synchronization
    artistSync.ts       # Artist synchronization
    playlistSync.ts     # Playlist synchronization
    eqSync.ts           # EQ profile synchronization
```

#### syncManager.ts
- Orchestrates overall sync process
- Tracks local sync state and timestamps
- Handles authentication for sync operations
- Coordinates CRUD operations for sync

#### Entity-specific sync handlers
- Implement entity-specific sync logic using standard CRUD operations
- Handle serialization/deserialization
- Implement basic conflict resolution strategies
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
- Handle communication with AWS backend via standard CRUD operations
- Manage authentication and tokens
- Format requests and parse responses
- Handle API errors and retries
- Download complete audio files to IndexedDB before enabling playback

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

1. **Track Selection**: User selects track → libraryStore provides track data
   - UI immediately updates to display selected track info
   - PlayerState updated with new currentTrackId and loadingState: 'loading'

2. **Loading Initiated**: audioPlayer begins loading process
   - Fetch audio file from IndexedDB 
   - Update loadingProgress as file is retrieved
   - UI displays loading indicator with progress

3. **Audio Processing**: Decode audio data for playback
   - PlayerState updated with loadingState: 'decoding'
   - UI shows processing indicator
   - Audio buffer is prepared

4. **Ready State**: Audio ready for playback
   - PlayerState updated with loadingState: 'ready' and duration
   - UI enables play controls
   - If autoplay intended, playback begins

5. **Playback Control**: User triggers play/pause
   - play()/pause() action dispatched → playerStore updates isPlaying state
   - audioPlayer subscribes to state change and controls audio output
   - UI updates to show playing state

6. **Audio Processing**: Sound is processed through EQ
   - Audio routed through EQ processor via audioRouting
   - Applied EQ profile affects audio in real-time

7. **Playback Progress**: Track plays through audio system
   - Playback progress regularly updates playerStore (currentTime)
   - UI components react to playerStore changes (progress bar, time display)

8. **Error Handling**: If issues occur during loading/playback
   - PlayerState updated with loadingState: 'error' and error message
   - UI displays error with retry option
   - User can attempt reload or select different track

### Library Management Flow

1. User uploads file → fileStorage stores in IndexedDB
2. Metadata extracted → metadataStorage updates
3. libraryStore updated with new track
4. syncQueue records change for future sync
5. UI updates to show new track
6. When online, syncManager processes queue
7. trackSync uploads to S3 and updates DynamoDB
8. syncStore updated with completion status (hasPendingChanges set to false)
9. Remote tracks must be fully downloaded to IndexedDB before playback

### EQ Adjustment Flow

1. **Application Startup**: EQ profile initialization
   - App loads the previously selected currentProfileId from persistent storage
   - If no previous selection exists (first-time user), a default "Profile 1" profile is created and selected
   - eqProcessor initializes audio nodes with the selected profile settings

2. **Profile Selection**: User selects an EQ profile
   - eqStore updates currentProfileId (becomes the new default/last used profile)
   - eqProcessor applies profile settings to audio chain
   - Profile selection is persisted for next app launch

3. **EQ Adjustment**: User adjusts EQ parameters
   - eqStore updates the current profile's band settings
   - eqProcessor subscribes to state change
   - Audio processing updated in real-time
   - Changes to current profile are saved automatically

4. **Profile Management**: User explicitly manages profiles
   - Adding: User creates a new profile → added to eqStore.profiles
   - Duplicating: User copies an existing profile with a new name
   - Renaming: User changes name of existing profile
   - Deleting: User removes a profile from the collection
   - If current profile is deleted, another profile is selected as default

5. **Synchronization**: When profiles change
   - syncQueue records change for future sync (hasPendingChanges set to true)
   - When online, eqSync uploads to DynamoDB
   - syncStore updated with completion status (hasPendingChanges set to false)
   - Current profile selection is also synchronized

## Sync Process

### Automatic Sync Triggers

1. **App Initialization**: Check for pending changes on startup
2. **Authentication**: Sync after successful login
3. **Connectivity Change**: Sync when coming online
4. **Periodic**: Background sync at intervals when online
5. **Data Change**: Trigger sync after significant local changes

### Sync Implementation (V1)

For v1, synchronization will be implemented using standard CRUD operations:

1. **Client-Side Timestamp Tracking**:
   - Client stores last sync timestamp per entity type
   - Client tracks which items need to be synced

2. **Upload Changes**:
   - Client sends modified local items to server via standard PUT/POST endpoints
   - Server applies changes and updates timestamps

3. **Download Changes**:
   - Client requests data from GET endpoints with timestamp filters
   - Server returns items updated since provided timestamp

4. **Conditional Operations**:
   - Use HTTP ETags or DynamoDB conditional writes for basic conflict detection
   - Client includes version information when updating items

### Conflict Resolution

For V1, we'll implement a simple timestamp-based approach:
1. Client detects conflicts when server rejects conditional updates
2. For simple conflicts, apply "last write wins" based on timestamps
3. For playlist conflicts, merge items locally before re-uploading
4. For EQ profiles, create a new version with conflict suffix

In future versions, we can implement more sophisticated conflict resolution:
1. Dedicated sync endpoints for more efficient synchronization
2. Three-way merge for compatible changes
3. User selection for incompatible changes
4. Detailed conflict visualization and resolution UI

## Implementation Phases

### Phase 1: Core Infrastructure
- State management setup
- Data models definition
- Basic IndexedDB storage
- Audio file download management
- Simple audio playback of downloaded files

### Phase 2: Audio Processing
- Web Audio API integration
- EQ processing implementation

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

- Streaming audio playback (v2)
- Progressive downloading with partial playback
- Playback queue with shuffle and repeat modes
- Collaborative playlists
- Advanced audio analysis
- Machine learning for music recommendations
- Audio fingerprinting for duplicate detection
- Social sharing features

## Implementation Details & Component Integration

This section outlines the specific integrations between UI components and backend services, detailing which classes interact with which components and how the architecture is implemented across the application.

### Player Components Integration

#### Main Player UI (`components/player-bar.tsx`)
- **Interfaces with**: 
  - `usePlayer` hook (exposes playerStore state and actions)
  - `audioPlayer.ts` (indirectly through playerStore)
- **Responsibilities**:
  - Display current track info from `libraryStore`
  - Show playback controls and current state
  - Display loading/error states based on `loadingState` value
  - Render progress bar using `currentTime` and `duration`
  - Provide volume controls tied to `volume` and `isMuted` state

#### Track Selection Components (`components/music-library.tsx`, `components/playlist-view.tsx`)
- **Interfaces with**:
  - `useLibrary` hook (exposes libraryStore state and actions)
  - `usePlayer` hook (for play/pause functionality)
- **Responsibilities**:
  - List tracks with play/pause buttons
  - Highlight currently playing track based on `currentTrackId`
  - Show loading indicators when a track is being loaded
  - Trigger track loading via `audioPlayer.ts` methods

### EQ Interface Integration

#### EQ Control Panel (`components/eq-view.tsx`)
- **Interfaces with**:
  - `useEQ` hook (exposes eqStore state and actions)
  - `eqProcessor.ts` (indirectly through eqStore)
- **Responsibilities**:
  - Display frequency bands from current profile
  - Provide sliders for adjusting gain values
  - Update profile in real-time as adjustments are made
  - Render visualization of EQ curve

#### Profile Selector (`components/eq-profiles.tsx`)
- **Interfaces with**:
  - `useEQ` hook
- **Responsibilities**:
  - List available EQ profiles
  - Allow selection of profiles (updating `currentProfileId`)
  - Provide profile management UI (add/duplicate/rename/delete)
  - Show sync status of profiles

### Synchronization UI Integration

#### Sync Status Indicator (`components/top-bar.tsx`)
- **Interfaces with**:
  - `useSync` hook (exposes syncStore state and actions)
  - `syncManager.ts` (for triggering manual sync)
- **Responsibilities**:
  - Display current sync status (`idle`/`syncing`/`error`)
  - Show indicator when offline changes are pending
  - Provide manual sync button
  - Display error notifications when sync fails

#### Library Management (`components/music-library.tsx`)
- **Interfaces with**:
  - `useLibrary` hook
  - `fileStorage.ts` (for uploads)
  - `metadataStorage.ts` (for metadata extraction)
- **Responsibilities**:
  - Handle file uploads with drag-and-drop or file picker
  - Show upload progress
  - Display sync status of tracks
  - Indicate when a track is downloading from cloud

### Authentication Components

#### Auth Modal (`components/login-modal.tsx`, `components/signup-modal.tsx`)
- **Interfaces with**:
  - `useAuth` hook (exposes authStore state and actions)
  - `authApi.ts` (for authentication requests)
- **Responsibilities**:
  - Handle user registration and login
  - Show authentication errors
  - Trigger initial sync after successful login
  - Persist authentication tokens

### Class Dependency Chain

1. **UI Components** → **React Hooks** → **Store Actions** → **Core Services** → **Storage Layer**
   - Example: Play button → `usePlayer.play()` → `playerStore.setState()` → `audioPlayer.play()` → `indexedDBManager.getAudioFile()`

2. **File Upload Flow**:
   - `<FileUploader>` → `useLibrary.uploadFiles()` → `fileStorage.storeFile()` + `metadataStorage.extractAndSave()` → `libraryStore.addTrack()` → `syncStore.markChangePending()`

3. **EQ Adjustment Flow**:
   - `<EQBandSlider>` → `useEQ.adjustBand()` → `eqStore.updateBand()` → `eqProcessor.updateFilter()` → Audio processing chain

4. **Sync Process Chain**:
   - `syncManager.startSync()` → Entity-specific handlers (`trackSync`, etc.) → `apiClient` methods → AWS endpoints

### Component Initialization Sequence

1. **Application Startup**:
   - Initialize stores (Zustand)
   - Restore state from persistence (IndexedDB)
   - Check authentication status
   - Initialize audio engine components
   - Load last used EQ profile
   - Check for pending sync operations

2. **Player Initialization**:
   - Create Web Audio API context (`audioContext.ts`)
   - Initialize and connect audio nodes
   - Establish signal routing
   - Register event listeners for audio events

3. **Library Initialization**:
   - Load track metadata from IndexedDB
   - Build artist/album relationships
   - Populate UI with library contents
   - Initialize file drop listeners

4. **EQ Initialization**:
   - Load saved profiles from storage
   - Apply last used profile to audio chain
   - Create default profile if needed
   - Initialize visualizer components

This implementation structure ensures clean separation of concerns while providing clear integration points between UI components and backend services. Each component has well-defined responsibilities and interfaces only with its immediate dependencies.
