# Music Library Component Refactoring Plan

## Overview

The `music-library.tsx` file (663 lines) has grown too large and contains several UI components that can be extracted. This refactoring will:

1. Reduce file size and complexity
2. Improve maintainability
3. Make components reusable
4. Separate concerns

## Component Extraction Plan

### 1. EQStatusAlert Component

```
/components/music/EQStatusAlert.tsx
```

**Props:**
```typescript
interface EQStatusAlertProps {
  isEnabled: boolean;
  onSettingsClick: () => void;
}
```

**Usage:**
```jsx
<EQStatusAlert 
  isEnabled={eqEnabled} 
  onSettingsClick={() => {
    const eqTab = document.querySelector('[data-tab="eq"]')
    if (eqTab) (eqTab as HTMLElement).click()
  }} 
/>
```

### 2. TrackItem Component

```
/components/music/TrackItem.tsx
```

**Props:**
```typescript
interface TrackItemProps {
  track: Track;
  isPlaying: boolean;
  isCurrentTrack: boolean;
  onPlay: (track: Track) => void;
  onTogglePlayPause: () => void;
}
```

**Usage:**
```jsx
{tracks.map((track, index) => (
  <TrackItem
    key={track.id}
    track={track}
    isPlaying={isPlayingLocal && currentlyPlaying === track.id}
    isCurrentTrack={currentlyPlaying === track.id}
    onPlay={() => handleTrackSelect(track)}
    onTogglePlayPause={() => {
      if (currentlyPlaying === track.id) {
        setIsPlayingLocal(!isPlayingLocal)
        setIsPlaying(!isPlayingLocal)
      }
    }}
  />
))}
```

### 3. EmptyLibrary Component

```
/components/music/EmptyLibrary.tsx
```

**Props:**
```typescript
interface EmptyLibraryProps {
  eqEnabled: boolean;
  dragActive: boolean;
  isImporting: boolean;
  importProgress: number;
  currentFile?: string;
  onImportClick: () => void;
  onCancel: () => void;
  onDragEnter: DragEventHandler;
  onDragLeave: DragEventHandler;
  onDragOver: DragEventHandler;
  onDrop: DragEventHandler;
}
```

**Usage:**
```jsx
<EmptyLibrary
  eqEnabled={eqEnabled}
  dragActive={dragActive}
  isImporting={isImporting}
  importProgress={importProgress}
  currentFile={currentFile}
  onImportClick={handleImportButtonClick}
  onCancel={cancelImport}
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave} 
  onDragOver={handleDragOver}
  onDrop={handleDrop}
/>
```

### 4. LoadingSkeleton Component

```
/components/ui/LoadingSkeleton.tsx
```

**Props:**
```typescript
interface LoadingSkeletonProps {
  itemCount?: number; // For track list skeleton
}
```

**Usage:**
```jsx
<LoadingSkeleton itemCount={5} />
```

### 5. DragDropArea Component

```
/components/ui/DragDropArea.tsx
```

**Props:**
```typescript
interface DragDropAreaProps {
  children: ReactNode;
  dragActive: boolean;
  onDragEnter: DragEventHandler;
  onDragLeave: DragEventHandler;
  onDragOver: DragEventHandler;
  onDrop: DragEventHandler;
  className?: string;
}
```

**Usage:**
```jsx
<DragDropArea
  dragActive={dragActive}
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave}
  onDragOver={handleDragOver}
  onDrop={handleDrop}
  className="mx-auto space-y-8 relative"
>
  {/* Content */}
</DragDropArea>
```

### 6. DragOverlay Component

```
/components/ui/DragOverlay.tsx
```

**Props:**
```typescript
interface DragOverlayProps {
  isVisible: boolean;
}
```

**Usage:**
```jsx
<DragOverlay isVisible={dragActive} />
```

### 7. ImportArea Component

```
/components/music/ImportArea.tsx
```

**Props:**
```typescript
interface ImportAreaProps {
  onImportClick: () => void;
}
```

**Usage:**
```jsx
<ImportArea onImportClick={handleImportButtonClick} />
```

### 8. Animations (CSS)

Extract all CSS animations to a separate file:

```
/styles/animations.css
```

**Usage:**
```jsx
import "/styles/animations.css"
```

## Refactored MusicLibrary Structure

The refactored MusicLibrary component will be much cleaner:

```jsx
export function MusicLibrary({ setCurrentTrack, setIsPlaying, eqEnabled }: MusicLibraryProps) {
  // State and hooks
  
  // Event handlers
  
  if (isLoading) {
    return <LoadingSkeleton itemCount={5} />
  }
  
  if (tracks.length === 0) {
    return <EmptyLibrary {...emptyLibraryProps} />
  }
  
  return (
    <DragDropArea {...dragDropProps}>
      <EQStatusAlert isEnabled={eqEnabled} onSettingsClick={handleEQSettingsClick} />
      
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-2xl font-semibold">Music Library</h2>
          <p className="text-sm text-muted-foreground">Your local files & royalty-free music.</p>
        </div>
        <Button onClick={handleImportButtonClick}>
          <Upload className="mr-2 h-4 w-4" />
          Import Music
        </Button>
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept="audio/*,.mp3,.wav,.flac"
          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
          multiple
        />
      </div>
      
      <div className="rounded-md border p-4">
        {tracks.map((track, index) => (
          <TrackItem
            key={track.id}
            track={track}
            isPlaying={isPlayingLocal && currentlyPlaying === track.id}
            isCurrentTrack={currentlyPlaying === track.id}
            onPlay={() => handleTrackSelect(track)}
            onTogglePlayPause={handleTogglePlayback}
          />
        ))}
        
        {/* Add Track button */}
      </div>
      
      <ImportArea onImportClick={handleImportButtonClick} />
      
      {/* Sign up message */}
      
      <FileImportOverlay
        isVisible={isImporting}
        progress={importProgress}
        currentFile={currentFile || undefined}
        onCancel={cancelImport}
      />
      
      <DragOverlay isVisible={dragActive} />
    </DragDropArea>
  )
}
```

## Implementation Strategy

1. Create each component in its own file
2. Test each component individually
3. Replace components in MusicLibrary one by one
4. Test after each replacement
5. Final cleanup after all components are extracted

## Benefits

- File size reduced from 663 lines to approximately 200 lines
- Improved component reusability
- Better separation of concerns
- Easier maintenance and testing
- More readable codebase 