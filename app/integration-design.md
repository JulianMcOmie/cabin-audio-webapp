# Cabin Audio Web App Integration Design

## Overview

This document outlines the integration plan for connecting the backend services and data layers with the existing UI components. The implementation follows a layered architecture and a modular phased approach, focusing primarily on track management for v1.

1. **UI Layer**: React components and pages
2. **Hook Layer**: React hooks that provide functionality to UI components
3. **Store Layer**: Zustand stores for state management
4. **Storage Layer**: IndexedDB for local data storage

## Existing Component Analysis

To ensure proper integration, we must reference and utilize the existing components as defined in the design document. Below is a summary of the existing components and their expected locations:

### Store Layer Components

The following stores are already implemented as specified in the design document:

```
/lib/store/
  index.ts              # Combined store exports
  playerStore.ts        # Audio playback state
  libraryStore.ts       # Music library state (includes tracks)
  eqStore.ts            # EQ settings state
  authStore.ts          # Authentication state
  syncStore.ts          # Synchronization state
```

### Data Models

The following data models are already defined:

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

### Storage Services

The following storage services manage data persistence:

```
/lib/storage/
  indexedDBManager.ts   # IndexedDB interface
  fileStorage.ts        # Audio file storage
  metadataStorage.ts    # Track metadata storage
```

### Audio Engine Components

The following audio components handle playback and processing:

```
/lib/audio/
  audioContext.ts       # AudioContext singleton
  audioPlayer.ts        # Audio playback
  eqProcessor.ts        # EQ processing
  audioRouting.ts       # Audio routing
```

### Synchronization Components

The following components manage data synchronization:

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

## Interface Compatibility Analysis

To ensure proper integration, we need to align the interfaces from the integration design with those from the design document.

### Track Interface

**Design Doc Interface**:
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

**Integration Requirements**:
- Components must use this Track interface from `/lib/models/Track`
- UI needs to handle the optional fields appropriately
- Components should display the syncStatus when relevant

### PlayerState Interface

**Design Doc Interface**:
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

**Integration Requirements**:
- Components should respect and utilize all loading states
- UI should properly visualize loading progress
- Error handling should use the error field appropriately

### Toast Interface

**Note about Toast Interface**:
Based on linting errors in the MusicLibrary component, the toast interface uses `variant` instead of `type`:

```typescript
interface ToastOptions {
  message: string;
  variant: 'success' | 'error' | 'info';  // NOT 'type'
  duration?: number;
  onDismiss?: () => void;
}
```

All UI components need to use this correct interface when showing toast notifications.

## Hook Architecture Overview

Hooks are the primary way components will interact with application state and backend services. The following hooks are already implemented or need to be implemented based on the existing infrastructure:

### 1. useToast

**Location**: `/components/common/ToastManager.tsx`

**Purpose**: Provides toast notification functionality throughout the application.

**Required Interface Adjustment**:
```typescript
// Change this:
showToast({ message: 'Message', type: 'success' })

// To this:
showToast({ message: 'Message', variant: 'success' })
```

**Usage**:
```typescript
const { showToast } = useToast();

// Show success notification
showToast({ 
  message: 'Track imported successfully', 
  variant: 'success' 
});

// Show error notification
showToast({ 
  message: 'Failed to import track', 
  variant: 'error' 
});
```

### 2. useFileImport

**Location**: `/lib/hooks/useFileImport.ts`

**Purpose**: Manages file import state and process, including drag-and-drop functionality.

**Integration with Existing Services**:
- Should use `fileStorage.ts` for storing audio files 
- Should use `metadataStorage.ts` for extracting and storing track metadata
- Should connect to `libraryStore` to update the track list

**Usage**:
```typescript
const {
  isImporting,
  importProgress,
  currentFile,
  dragActive,
  error,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleFileSelect,
  cancelImport,
  clearError
} = useFileImport();

// Attach to import area
<div
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave}
  onDragOver={handleDragOver}
  onDrop={handleDrop}
>
  {/* Import area content */}
</div>
```

### 3. usePlayer

**Location**: `/lib/hooks/usePlayer.ts`

**Purpose**: Controls audio playback, track selection, and player state.

**Integration with Existing Services**:
- Should connect to `playerStore` state 
- Should use `audioPlayer.ts` for playback control
- Should connect to `audioRouting.ts` for output control

**Usage**:
```typescript
const {
  isPlaying,
  currentTrackId,
  currentTrack,
  isLoading,
  loadingState,
  error,
  playTrack,
  setPlayState,
  resetPlayer,
  next,
  previous,
  volume,
  setVolume,
  isMuted,
  setMuteState,
  currentTime,
  duration,
  seekTo
} = usePlayer();

// Play a specific track
playTrack('track-id-123');

// Set play/pause state
setPlayState(true);

// Adjust volume
setVolume(0.8);
```

### 4. useTrackStore

**Location**: `/lib/hooks/useTrackStore.ts`

**Purpose**: Provides access to the track data store.

**Integration with Existing Services**:
- Should connect to `libraryStore` for track data
- Should use `metadataStorage.ts` for metadata operations

**Usage**:
```typescript
const {
  tracks,
  isLoading,
  error,
  getTrack,
  getAllTracks,
  addTrack,
  updateTrack,
  deleteTrack,
  loadTracks
} = useTrackStore();

// Get all tracks
const allTracks = getAllTracks();

// Get a specific track
const track = getTrack('track-id-123');

// Add a new track
addTrack(newTrack);
```

### 5. useDataLoading

**Location**: `/lib/hooks/useDataLoading.ts`

**Purpose**: Manages loading data from storage into the application state.

**Integration with Existing Services**:
- Should use `indexedDBManager.ts` for database operations
- Should connect to all relevant stores to update application state

**Usage**:
```typescript
const {
  isLoading,
  error,
  loadData,
  clearError,
  retry
} = useDataLoading();

// Load data on component mount
useEffect(() => {
  loadData();
}, [loadData]);

// Handle loading states within component
```

### 6. useSyncManager (Phase 5)

**Location**: `/lib/hooks/useSyncManager.ts`

**Purpose**: Manages synchronization with the mock backend.

**Integration with Existing Services**:
- Should connect to `syncStore` for sync state
- Should use `syncManager.ts` for orchestrating sync operations

**Usage**:
```typescript
const {
  syncStatus,
  lastSyncTime,
  pendingChanges,
  error,
  sync,
  clearError
} = useSyncManager();

// Trigger sync manually
<button onClick={sync} disabled={syncStatus === 'syncing'}>
  Sync Now {pendingChanges > 0 ? `(${pendingChanges})` : ''}
</button>
```

## Component-Specific Integration Requirements

### MusicLibrary Component (`components/music-library.tsx`)

**Current Interface**:
```typescript
interface MusicLibraryProps {
  eqEnabled: boolean;
  setActiveTab: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => void;
  onSignupClick: () => void;
}
```

**Integration Changes**:
- Use `useTrackStore` for track data instead of local state
- Use `usePlayer` for playback control
- Update toast calls to use `variant` instead of `type`
- Add visual indicators for track sync status based on Track model

### PlayerBar Component

**Integration Requirements**:
- Connect to `usePlayer` hook for all playback functionality
- Display loading states from the player store
- Add visual progress indicator for track loading
- Handle errors through toast notifications

### Toast Component

**Required Files**:
- `app/components/common/Toast.tsx`
- `app/components/common/ToastManager.tsx`

**Implementation Notes**:
- Toast interface uses `variant` instead of `type`
- Must provide a context provider in the application layout

### FileImportOverlay Component

**Required File**:
- `app/components/import/FileImportOverlay.tsx`

**Implementation Notes**:
- Should provide visual feedback during file imports
- Should display progress percentage
- Should show current file being processed
- Should allow cancellation of import

## Modular Implementation Strategy

### Phase 1: UI Components and Interfaces

✅ **Completed**

This phase defined the interfaces for UI components and established the visual states and interactions. The UI components now need to be connected to the backend services.

### Phase 2: Core Track Management Integration

This phase connects the UI components to the track management functionality. To ensure proper implementation and testing, we've broken this phase into smaller subphases:

#### Phase 2.1: Track Store Connection

✅ **Completed**

This subphase connected UI components to the existing track data store functionality.

**Implementation Notes**:
- Verified useTrackStore hook connects properly to libraryStore for track data
- Implemented core functionality: getAllTracks, getTrack, and other track operations
- Added error handling and loading states
- Connected MusicLibrary component to use the track store for data

#### Phase 2.2: File Import Enhancement

✅ **Completed**

This subphase improved the file import process to work with the track store, allowing us to test the track state functionality with real imports.

**Implementation Notes**:
- Enhanced useFileImport hook with metadata extraction functionality
- Connected import completion to track store updates
- Implemented drag-and-drop process with progress indicators
- Added error handling with toast notifications
- Integrated with track storage to update library UI after successful imports

#### Phase 2.3: Player Integration

✅ **Completed**

This subphase directly connects UI components to the playerStore for consistent playback state management.

**Core Integration Concept**:
The goal was simple: Replace the prop-based communication between components with direct access to the shared playerStore. Both the MusicLibrary and PlayerBar components now:
1. Read playback state directly from usePlayerStore
2. Update playback state directly through usePlayerStore actions

**Implementation Notes**:
- PlayerBar component now uses usePlayerStore directly instead of props
- MusicLibrary component uses usePlayerStore for track playback state
- Page.tsx no longer manages player state or passes it through props
- The components communicate through the centralized playerStore
- Play/pause events now properly propagate between components

#### Phase 2.4: Toast Integration

✅ **Completed**

This subphase implemented the toast notification system for providing user feedback.

**Implementation Notes**:
- Toast interface now uses `variant` instead of `type` for message styling
- Error handling throughout the application uses toast notifications
- Components use proper toast feedback for user actions
- ToastManager provides a consistent notification system across the app

### Phase 3: Local Storage Implementation

This phase connects stores to existing IndexedDB storage services.

**Existing Components**:
- `/lib/storage/indexedDBManager.ts`: Singleton that provides IndexedDB access
- `/lib/storage/fileStorage.ts`: Handles audio file storage
- `/lib/storage/metadataStorage.ts`: Manages track metadata

**Specific Tasks**:

1. **Store Integration**:
   - Modify `/lib/stores/trackStore.ts` to load tracks from metadataStorage on initialization
   - Update store CRUD methods to call metadataStorage methods
   - Add loading states to indicate database operations

2. **Audio Loading**:
   - Update `/lib/stores/playerStore.ts` to load audio via fileStorage
   - Implement tracking of file loading progress
   - Add error handling for missing files

3. **File Import**:
   - Connect `/lib/hooks/useFileImport.ts` to fileStorage and metadataStorage
   - Add progress tracking for file storage operations

**Data Flow to Implement**:
- Store Initialization: trackStore loads data from metadataStorage on creation
- File Import: useFileImport → fileStorage → metadataStorage → trackStore
- Playback: playerStore → fileStorage → audioPlayer

**Deliverables**:
1. Track persistence between sessions
2. File import with storage to IndexedDB
3. Audio loading from IndexedDB for playback
4. Progress indicators during storage operations

**Verification**:
- Data persists after page refresh
- Audio files can be imported and played back
- Loading indicators display correctly
- Error handling works for storage issues

### Phase 4: Basic Playback Controls

This phase implements basic track playback functionality.

**Integration Tasks**:

1. **Player Hook Enhancements**:
   - Connect to audio engine components
   - Implement all playback controls
   - Handle loading and error states

2. **UI Updates**:
   - Add progress indicators for track loading
   - Enhance player controls with all available actions
   - Implement seek functionality

3. **Error Handling**:
   - Add clear error messages for playback issues
   - Provide retry options for failed playback
   - Use toast notifications for important issues

**Expected Result**:
- Full playback functionality with the Web Audio API
- Visual feedback during all playback states
- Proper error handling and recovery

### Phase 5: Temporary Sync Solution

This phase implements a mock synchronization system.

**Integration Tasks**:

1. **Sync Manager Integration**:
   - Connect to existing sync components
   - Implement sync status indicators
   - Add manual sync triggers

2. **Track Sync Status**:
   - Add visual indicators for track sync status
   - Implement conflict resolution UI
   - Handle sync errors appropriately

3. **Mock API Integration**:
   - Connect to mock API implementations
   - Add simulated network operations
   - Implement error handling for API calls

**Expected Result**:
- Visual indicators for sync status
- Ability to trigger sync operations
- Proper handling of sync conflicts
- Error recovery for failed sync operations

## Conclusion

This integration plan provides a modular approach to connecting the existing UI components with the backend services. By following this plan, we can ensure proper utilization of the existing infrastructure while maintaining a clean architecture.

The interface-focused approach ensures compatibility with the existing components, and the phased implementation allows for incremental functionality delivery. This document should be used as a reference guide when implementing the integration tasks for each phase.

**Update: Implementation should prioritize maintainability and clean separation of concerns.**

**Implementation Progress Update:**
- Phase 1 (UI Components and Interfaces): ✅ Completed
- Phase 2.1 (Track Store Connection): ✅ Completed
- Phase 2.2 (File Import Enhancement): ✅ Completed
- Phase 2.3 (Player Integration): ✅ Completed
- Phase 2.4 (Toast Integration): ✅ Completed
- Phase 3 (Local Storage Implementation): 🔄 In Progress
- Remaining phases to be implemented according to the plan
