# Cabin Audio Web App Integration Design

## Overview

This document outlines the integration plan for connecting the backend services and data layers with the existing UI components. The implementation follows a layered architecture and a modular phased approach, focusing primarily on track management for v1.

1. **UI Layer**: React components and pages
2. **Hook Layer**: React hooks that provide functionality to UI components
3. **Store Layer**: Zustand stores for state management
4. **Storage Layer**: IndexedDB for local data storage

## Hook Architecture Overview

Hooks are the primary way components will interact with application state and backend services. Below is a list of all hooks needed for the integration, along with their intended purpose and usage:

### 1. useToast

**Purpose**: Provides toast notification functionality throughout the application.

**Usage**:
```typescript
const { showToast } = useToast();

// Show success notification
showToast({ 
  message: 'Track imported successfully', 
  type: 'success' 
});

// Show error notification
showToast({ 
  message: 'Failed to import track', 
  type: 'error' 
});
```

### 2. useFileImport

**Purpose**: Manages file import state and process, including drag-and-drop functionality.

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

**Purpose**: Controls audio playback, track selection, and player state.

**Usage**:
```typescript
const {
  isPlaying,
  currentTrackId,
  currentTrack,
  isLoading,
  error,
  playTrack,
  togglePlayPause,
  stop,
  next,
  previous,
  volume,
  setVolume,
  isMuted,
  toggleMute,
  currentTime,
  duration,
  seekTo
} = usePlayer();

// Play a specific track
playTrack('track-id-123');

// Toggle play/pause
togglePlayPause();

// Adjust volume
setVolume(0.8);
```

### 4. useTrackStore

**Purpose**: Provides access to the track data store.

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

**Purpose**: Manages loading data from storage into the application state.

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

**Purpose**: Manages synchronization with the mock backend.

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

## Modular Implementation Strategy

### Phase 1: UI Components and Interfaces

This phase involves defining clear interfaces for UI components that will later be connected to backend services. The focus is on component structure and state management interfaces rather than implementation details.

#### Required Interfaces:

1. **Toast Notification Interface**

```typescript
interface ToastProps {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  onDismiss?: () => void;
}

interface ToastContextType {
  showToast: (options: Omit<ToastProps, 'id' | 'onDismiss'>) => void;
}
```

2. **File Import Interface**

```typescript
interface FileImportOverlayProps {
  isVisible: boolean;
  progress: number;
  currentFile?: string;
  onCancel: () => void;
}

interface FileImportHookResult {
  // State
  isImporting: boolean;
  importProgress: number;
  currentFile: string | null;
  dragActive: boolean;
  error: string | null;
  
  // Methods
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleFileSelect: (files: FileList) => void;
  cancelImport: () => void;
  clearError: () => void;
}
```

#### Component-Specific Loading State Implementation

Loading states will be implemented directly within each component using local state initially. These local state implementations will later be connected to the global state management.

1. **MusicLibrary Component Loading States Implementation**:
   ```typescript
   // Inside MusicLibrary component
   const [isLoading, setIsLoading] = useState(true);
   const [tracks, setTracks] = useState<Track[]>([]);
   
   useEffect(() => {
     // Simulate loading tracks
     const loadTracks = async () => {
       setIsLoading(true);
       try {
         // In Phase 1: Simulate API call with timeout
         await new Promise(resolve => setTimeout(resolve, 1000));
         setTracks(/* dummy data */);
       } catch (error) {
         showToast({ 
           message: 'Failed to load tracks', 
           type: 'error' 
         });
       } finally {
         setIsLoading(false);
       }
     };
     
     loadTracks();
   }, []);
   
   // Render based on state
   if (isLoading) {
     return (
       <div className="music-library">
         {/* Inline loading state UI */}
         <div className="track-list-loading">
           {Array(5).fill(0).map((_, i) => (
             <div key={i} className="track-item-loading" />
           ))}
         </div>
       </div>
     );
   }
   
   if (tracks.length === 0) {
     return (
       <div className="music-library">
         {/* Inline empty state UI */}
         <div className="track-list-empty">
           <p>No music found</p>
           <button onClick={handleImportButtonClick}>
             Import Music
           </button>
         </div>
       </div>
     );
   }
   
   // Normal state with tracks
   return (
     <div className="music-library">
       {/* Normal UI */}
     </div>
   );
   ```

2. **PlayerBar Component Loading States Implementation**:
   ```typescript
   // Inside PlayerBar component
   const [isTrackLoading, setIsTrackLoading] = useState(false);
   const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
   const [isPlaying, setIsPlaying] = useState(false);
   
   const handlePlayTrack = useCallback((trackId: string) => {
     setIsTrackLoading(true);
     // Simulate loading track audio
     setTimeout(() => {
       setCurrentTrack(/* track data */);
       setIsPlaying(true);
       setIsTrackLoading(false);
     }, 800);
   }, []);
   
   // Conditional rendering for play/pause button
   const renderPlayButton = () => {
     if (isTrackLoading) {
       return (
         <button className="play-button loading" disabled>
           {/* Simple loading indicator (can be a CSS animation) */}
           <span className="loading-indicator" />
         </button>
       );
     }
     
     if (isPlaying) {
       return (
         <button className="pause-button" onClick={handlePause}>
           {/* Pause icon */}
         </button>
       );
     }
     
     return (
       <button 
         className="play-button" 
         onClick={handlePlay}
         disabled={!currentTrack}
       >
         {/* Play icon */}
       </button>
     );
   };
   
   // No-track state
   if (!currentTrack && !isTrackLoading) {
     return (
       <div className="player-bar empty">
         <div className="player-message">Select a track to play</div>
         {renderPlayButton()}
         {/* Other disabled controls */}
       </div>
     );
   }
   
   return (
     <div className="player-bar">
       {/* Track info */}
       <div className="track-info">
         {isTrackLoading ? (
           <div className="track-info-loading">
             <div className="title-loading" />
             <div className="artist-loading" />
           </div>
         ) : (
           <>
             <div className="title">{currentTrack?.title}</div>
             <div className="artist">{currentTrack?.artist}</div>
           </>
         )}
       </div>
       
       {/* Controls */}
       <div className="player-controls">
         {renderPlayButton()}
         {/* Other controls */}
       </div>
     </div>
   );
   ```

#### Error Handling Strategy

For Phase 1, all errors will be handled through toast notifications rather than inline error states:

- API/Data errors: Show toast with error message and retry option when applicable
- User action errors: Show toast with clear explanation of the issue
- System errors: Show toast with technical details for debugging purposes

This simplifies the initial implementation while still providing user feedback.

#### New Files to Create:

1. **`app/components/common/Toast.tsx`**
   - Purpose: A reusable toast notification component
   - Requirements:
     - Should support success, error, and info notification types
     - Should auto-dismiss after a configurable duration
     - Should provide a way to manually dismiss
     - Should use React Portals to appear on top of other content

2. **`app/components/common/ToastManager.tsx`**
   - Purpose: Context provider for managing toast notifications
   - Requirements:
     - Should provide a React context and hook for showing/hiding toasts
     - Should handle multiple simultaneous toast notifications
     - Should manage toast lifetimes and dismissals

3. **`app/components/import/FileImportOverlay.tsx`**
   - Purpose: Display import progress during file imports
   - Requirements:
     - Should show a progress bar with percentage
     - Should display the name of the file currently being processed
     - Should provide a cancel button to abort the import
     - Should overlay other content when active

4. **`app/hooks/useFileImport.ts`**
   - Purpose: Manage file import state and logic
   - Requirements:
     - Should handle drag and drop events
     - Should track import progress
     - Should support cancellation
     - Should provide file selection via input
     - Should handle errors and expose them for toast notifications
     - Initial implementation should use dummy data processing that will be replaced in Phase 2

#### Files to Modify:

1. **`app/layout.tsx` (or equivalent app wrapper)**
   - Purpose: Add toast notification provider to the application
   - Requirements:
     - Add ToastProvider to the app layout
     - Ensure toast notifications are available application-wide

2. **`app/components/MusicLibrary.tsx` (existing component)**
   - Purpose: Enhance with file import functionality and loading states
   - Requirements:
     - Add drag and drop area for file imports
     - Connect to useFileImport hook
     - Add file input for manual selection
     - Show import overlay during file imports
     - Handle drag states appropriately
     - Implement inline loading states using local state variables:
       - `isLoading`: To show loading UI when fetching tracks
       - `tracks`: Array to store fetched tracks
     - Implement inline empty state when no tracks are available
     - Add CSS directly to the component for loading animations and states

3. **`app/components/PlayerBar.tsx` (existing component)**
   - Purpose: Add loading states to the player controls
   - Requirements:
     - Add local state variables:
       - `isTrackLoading`: To indicate when a track is being loaded
       - `currentTrack`: To store the current track
       - `isPlaying`: To track playback state
     - Show inline loading UI when track is loading
     - Disable controls when no track is selected
     - Show empty state message when no track is selected
     - Use simple CSS animations for loading indicators
     - Add CSS directly to the component for loading animations and states

#### Verification Requirements for Phase 1:

To consider Phase 1 complete, the following should be verifiable:

1. **Toast Notifications**:
   - Toasts appear when triggered and auto-dismiss
   - Toasts can be manually dismissed
   - Different toast types display with appropriate styling

2. **File Import Area**:
   - Visual state changes when files are dragged over
   - File dialog opens when button is clicked
   - Drag and drop functionality triggers the import process

3. **Import Overlay**:
   - Appears during file import with progress information
   - Shows current file being processed
   - Progress bar updates as files are processed
   - Cancel button stops the import process

4. **Import Process (with dummy implementation)**:
   - Starts when files are dropped or selected
   - Shows progress updates
   - Shows success toast notification upon completion
   - Shows error toast notification when import fails
   - Can be cancelled while in progress

5. **Loading States**:
   - MusicLibrary shows loading UI when tracks are being loaded
   - MusicLibrary shows empty state when no tracks are available
   - PlayerBar shows loading indicators when a track is being loaded
   - PlayerBar shows empty state when no track is selected
   - Loading indicators are styled appropriately through component-specific CSS

6. **Error Handling**:
   - Errors during operations trigger toast notifications
   - Toast notifications for errors include helpful messages
   - Critical errors provide retry options when applicable

### Phase 2: Core Track Management Integration

This phase connects the UI components from Phase 1 to the track management functionality, replacing dummy implementations with real data handling.

#### Track List Integration

**Interface Requirements:**

```typescript
interface TrackListProps {
  tracks?: Track[];
  isLoading?: boolean;
  error?: string | null;
  onTrackSelect?: (trackId: string) => void;
  selectedTrackId?: string;
  onRetry?: () => void;
}

interface TrackItemProps {
  track: Track;
  isSelected: boolean;
  isPlaying: boolean;
  onClick: () => void;
}
```

**Implementation Requirements:**
- Replace dummy data with actual tracks from the track store
- Implement track selection functionality
- Display track information including title, artist, and duration
- Show appropriate loading states when fetching tracks
- Show empty state when no tracks are available
- Show error state when track loading fails
- Allow retrying when errors occur

#### Basic Player Integration

**Interface Requirements:**

```typescript
interface PlayerProps {
  track?: Track;
  isPlaying: boolean;
  isLoading?: boolean;
  error?: string | null;
  onPlayPause: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onRetry?: () => void;
}

interface PlayerControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  isDisabled: boolean;
  isLoading?: boolean;
}
```

**Implementation Requirements:**
- Connect player controls to the usePlayer hook
- Display current track information
- Update UI to reflect current playback state
- Handle play/pause functionality
- Show loading state when audio is loading
- Show error state when playback fails
- Disable controls when no track is selected
- Allow retrying when errors occur

### Phase 3: Local Storage Implementation

This phase connects the application to IndexedDB for persistent data storage.

#### Storage Manager Interfaces

```typescript
interface AudioFileStorage {
  storeAudioFile: (file: File) => Promise<string>; // Returns storage key
  getAudioFile: (storageKey: string) => Promise<Blob>;
  deleteAudioFile: (storageKey: string) => Promise<void>;
}

interface MetadataStorage {
  saveTrackMetadata: (file: File, storageKey: string) => Promise<Track>;
  getAllTracks: () => Promise<Track[]>;
  getTrack: (trackId: string) => Promise<Track | null>;
  updateTrack: (track: Track) => Promise<void>;
  deleteTrack: (trackId: string) => Promise<void>;
}

interface DatabaseManager {
  initDB: () => Promise<void>;
  clearAllData: () => Promise<void>;
  isInitialized: boolean;
  error: Error | null;
}
```

**Implementation Requirements:**
- Initialize IndexedDB on application startup
- Create necessary object stores for tracks, artists, albums
- Implement file storage functionality
- Implement metadata extraction and storage
- Connect file import process to storage managers
- Handle and expose errors during storage operations
- Provide initialization status to the application

#### Data Loading Interface

```typescript
interface DataLoadingHook {
  isLoading: boolean;
  error: string | null;
  loadData: () => Promise<void>;
  clearError: () => void;
  retry: () => Promise<void>;
}
```

**Implementation Requirements:**
- Load saved tracks from IndexedDB on application startup
- Update stores with loaded data
- Provide loading state to UI components
- Handle and expose loading errors
- Allow retrying failed loads
- Provide clear error messages for different failure scenarios

### Phase 4: Basic Playback Controls

This phase implements basic track playback functionality without the full audio engine.

#### Player Hook Interface

```typescript
interface PlayerHook {
  // State
  isPlaying: boolean;
  currentTrackId: string | null;
  currentTrack: Track | null;
  isLoading: boolean;
  error: string | null;
  
  // Methods
  playTrack: (trackId: string) => void;
  togglePlayPause: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  clearError: () => void;
  
  // Audio controls
  volume: number;
  setVolume: (volume: number) => void;
  isMuted: boolean;
  toggleMute: () => void;
  
  // Time and position
  currentTime: number;
  duration: number;
  seekTo: (time: number) => void;
}
```

**Implementation Requirements:**
- Create a basic audio player using the Web Audio API
- Implement play/pause functionality
- Connect to track storage to load audio files
- Update UI based on playback state
- Handle track selection and playback initialization
- Implement basic playback controls like volume and seek
- Handle and expose loading and playback errors
- Show loading state when audio is loading or buffering
- Provide error recovery mechanisms

### Phase 5: Temporary Sync Solution

This phase implements a mock synchronization system to simulate backend connectivity.

#### Mock API Interface

```typescript
interface TracksApi {
  getAllTracks: () => Promise<Track[]>;
  getTrack: (trackId: string) => Promise<Track>;
  updateTrack: (track: Track) => Promise<Track>;
  deleteTrack: (trackId: string) => Promise<void>;
  uploadTrack: (track: Track, audioData: Blob) => Promise<Track>;
  downloadTrackAudio: (trackId: string) => Promise<Blob>;
  downloadTrackCover: (trackId: string) => Promise<Blob>;
  // Error handling
  error: string | null;
  clearError: () => void;
  isLoading: boolean;
}

interface SyncManager {
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncTime: number | null;
  pendingChanges: number;
  error: string | null;
  sync: () => Promise<void>;
  clearError: () => void;
}
```

**Implementation Requirements:**
- Create mock implementations of API clients
- Use localStorage to simulate server storage
- Add simulated network delays for realism
- Implement track sync status indicators
- Add sync functionality for tracks
- Handle and expose network errors during sync
- Provide sync status information to the UI
- Implement error recovery mechanisms

#### Track Sync Status

**Each track should have a syncStatus property:**
```typescript
type SyncStatus = 'synced' | 'pending' | 'modified' | 'conflict';

interface Track {
  // Existing properties
  syncStatus: SyncStatus;
  lastModified: number;
  syncError?: string;
}
```

**Implementation Requirements:**
- Display subtle sync status indicators next to tracks
- Provide a global sync action in the app header or settings
- Handle network errors during sync operations
- Implement conflict resolution when needed
- Show appropriate error messages for sync failures

## Detailed Component Integration

### 1. Main Player Component

**Interface Requirements:**
```typescript
interface PlayerComponentProps {
  className?: string;
}
```

**Implementation Requirements:**
- Connect to usePlayer hook for playback state and controls
- Display current track information when available
- Show appropriate empty state when no track is selected
- Show loading state when track is loading
- Show error state when playback fails
- Update UI based on playback state
- Handle play/pause button functionality
- Allow retrying playback when errors occur

### 2. Track List Component

**Interface Requirements:**
```typescript
interface TrackListComponentProps {
  className?: string;
  showHeader?: boolean;
}
```

**Implementation Requirements:**
- Connect to useTrackStore for track data
- Connect to usePlayer for playback control
- Handle track selection
- Display loading state when fetching tracks
- Display error state when loading fails
- Display empty state when no tracks are available
- Show track details including title, artist, and duration
- Indicate the currently playing track
- Show sync status indicators when appropriate
- Allow retrying when track loading fails

### 3. File Import Component

**Interface Requirements:**
```typescript
interface FileImportComponentProps {
  className?: string;
  onImportComplete?: () => void;
  onImportError?: (error: string) => void;
}
```

**Implementation Requirements:**
- Implement drag and drop functionality
- Show visual feedback during drag operations
- Handle file selection via button click
- Display import progress with file information
- Allow cancelling the import process
- Show success feedback when import completes
- Show error feedback when import fails
- Connect to storage managers in Phase 3
- Allow retrying failed imports

## Future Considerations

### 1. EQ Integration

The EQ integration will be implemented in a future phase when the UI components are ready.

### 2. Full Audio Engine Integration

A more comprehensive audio engine integration will be implemented in a future phase.

### 3. Album, Artist, and Playlist Management

While the data models and stores for albums, artists, and playlists are implemented, the UI for managing these entities will be developed in future phases.

### 4. Remote Sync Implementation

Full synchronization with the AWS backend will be implemented when the backend is ready.

## Testing Strategy

### Component Integration Tests

1. **UI Component Tests**
   - Test all visual states of components (normal, loading, error, empty)
   - Verify proper display of error and loading states
   - Test user interactions and state transitions
   - Verify error recovery mechanisms

2. **Store Integration Tests**
   - Test components with actual Zustand stores
   - Verify component updates when store data changes
   - Test error handling and loading scenarios
   - Verify data persistence between renders

3. **Storage Integration Tests**
   - Test data persistence between sessions
   - Verify correct loading from IndexedDB
   - Test error handling for storage operations
   - Verify recovery from initialization failures

4. **Mock API Tests**
   - Test mock API implementations
   - Verify simulated sync operations
   - Test error handling and recovery
   - Verify sync status indicators

## Conclusion

This integration plan provides a modular approach to implementing the backend services with the existing UI. By breaking the implementation into distinct phases, we can deliver incremental functionality while maintaining a clean architecture.

The interface-focused approach allows for flexibility in implementation while ensuring that components can interact properly. Each phase builds on the previous one, allowing for iterative development and testing.

The implementation emphasizes comprehensive error handling and loading states throughout the application, ensuring that users receive appropriate feedback during all operations and can recover from failures gracefully.

**Note:** The mock API (Phase 5) is not required for the earlier phases to work. Phases 1-4 can function independently using local state and IndexedDB storage. The mock API is only needed when you want to simulate server synchronization functionality. 