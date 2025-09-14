# NotchFilterNoiseGrid - Multi-Dot Repetition Issue

## Problem
When multiple dots are selected, the component should play each dot 4 times, alternating between notched and full spectrum (8 beats total per dot). Currently, it only plays the notched state repeatedly without ever playing the full spectrum.

## Expected Behavior
For each selected dot:
1. Play notched → full (repetition 1)
2. Play notched → full (repetition 2)
3. Play notched → full (repetition 3)
4. Play notched → full (repetition 4)
5. Move to next dot

## Current Behavior
- Plays notched repeatedly for the first dot
- Never plays full spectrum
- Never advances to the next dot

## Key Variables
- `isNotchedState`: Boolean tracking whether to apply notch filter
- `currentRepetition`: Counter 0-3 for the 4 repetitions
- `currentDotIndex`: Index of current dot in sequence

## Suspected Issue Location
The state update logic in the animation loop (lines 352-369 in notch-filter-noise-grid.tsx) appears to have a race condition or incorrect state checking that prevents proper toggling between notched and full spectrum states.