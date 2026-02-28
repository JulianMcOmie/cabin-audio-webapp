# Cabin Audio

A web-based audio calibration and music player application built with Next.js and the Web Audio API.

## Features

### Dot Grid Calibration System

The dot grid is an interactive audio calibration tool that generates bandpassed noise at different frequency ranges, allowing users to calibrate their audio system's frequency response.

#### Core Functionality

- **Bandpassed Noise Generation**: Each dot represents a frequency band, with lower dots producing lower frequencies and higher dots producing higher frequencies
- **Grid Layouts**: Configurable grid sizes (3x3 up to 9x9) for different calibration resolutions
- **Volume Levels**: Click dots to cycle through volume levels (off, quiet, medium, loud)
- **Stereo Panning**: Dots are panned left-to-right based on their horizontal position

#### Playback System

The dot grid uses a loop sequencer that cycles through active dots with a sophisticated volume progression system:

- **Volume Steps**: 4 discrete volume levels per dot (quiet to loud progression)
- **Hits per Volume Level**: Configurable multiplier (1x, 2x, 4x, 8x, 16x, 32x) determining how many times each dot plays at each volume level before progressing. Default: 16x
- **Hit Rate**: Adjustable playback speed. Default: 24 hits/second
- **Hit Decay**: Configurable dB range for the quiet-to-loud progression. Default: 40dB

#### Playback Modes

- **Sequential Mode** (default): Each dot completes all its hits before moving to the next dot
- **Interleaved Mode**: Cycles through all dots at each volume level, creating an alternating pattern between dots
- **Play Together Mode**: All dots play simultaneously

#### Advanced Features

- **Red Dots**: Mark specific dots to play less frequently (N of M cycles)
- **Per-Cycle Volume Oscillation**: Volume automatically oscillates across playback cycles
- **Per-Dot Volume Wave**: Creates a moving wave pattern across the dot sequence
- **Bandwidth Control**: Adjust the frequency bandwidth of each dot's bandpass filter
- **Attack/Release Envelope**: Configurable envelope for smooth sound transitions

### Music Player

A full-featured music player with local file support:

- **Local Music Library**: Import audio files (MP3, FLAC, WAV, etc.) from your device
- **Persistent Storage**: Tracks are stored locally using IndexedDB
- **Playback Controls**: Play, pause, skip forward/back, seek
- **Volume Control**: Adjustable volume with mute toggle
- **Track Information**: Displays title, artist, album, and cover art

### Parametric EQ

- **Multi-band EQ**: Add and adjust EQ bands on a frequency graph
- **EQ Profiles**: Save and switch between different EQ configurations
- **Real-time Processing**: All audio is processed through the Web Audio API
- **FFT Visualization**: Real-time frequency spectrum display

## Tech Stack

- **Framework**: Next.js 15 with React 19
- **Audio**: Web Audio API
- **State Management**: Zustand
- **Storage**: IndexedDB for local persistence
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI primitives

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Usage

### Dot Grid Calibration

1. Navigate to the EQ tab
2. Click on dots to activate them (cycles through volume levels)
3. Press Play to start the calibration sequence
4. Adjust settings in the control panel:
   - **Hits per Volume Level**: How many times each dot plays at each volume
   - **Interleave Dots**: Toggle between sequential and interleaved playback
   - **Hit Rate**: Playback speed
   - **Hit Decay**: Volume range for the progression

### Music Library

1. Navigate to the Library tab
2. Drag and drop audio files or click to import
3. Click on a track to play
4. Use the player bar at the bottom for playback controls

