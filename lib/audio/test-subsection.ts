import { getGlyphGridAudioPlayer } from './glyphGridAudio';

/**
 * This is a test file to validate the subsection functionality.
 * It can be used from the browser console to manually test:
 * 
 * Example usage in browser console:
 * import('/lib/audio/test-subsection.ts').then(m => m.testSubsection(0.3, 0.7));
 */

export function testSubsection(start: number, end: number) {
  const player = getGlyphGridAudioPlayer();
  
  console.log('Testing subsection:', { start, end });
  
  // Set the subsection
  player.setSubsection(start, end, true);
  
  // Return useful info
  return {
    message: 'Subsection set successfully',
    subsection: player.getSubsection(),
    manualControl: (pos: number) => {
      player.setManualPosition(pos);
      return `Manual position set to ${pos}`;
    },
    togglePlayback: (playing: boolean) => {
      player.setPlaying(playing);
      return `Playback ${playing ? 'started' : 'stopped'}`;
    },
    disableSubsection: () => {
      player.disableSubsection();
      return 'Subsection disabled';
    }
  };
} 