import { useRef, useCallback, useEffect, MutableRefObject } from 'react';
import { getAudioRouting } from '@/lib/audio/audioRouting';
import { getSampleRate } from '@/lib/audio/audioContext';

export interface BassData {
  magnitude: number;   // 0–1, smoothed bass energy
  transient: number;   // 0–1, spike on bass hits (for shake)
  pitch: number;       // 0–1, dominant bass frequency mapped (20Hz..150Hz)
  frequency: number;   // Dominant bass frequency in Hz (20Hz..150Hz)
  hue: number;         // CSS hue centered around cyan with subtle bass-note shift
}

const DB_FLOOR = -80;
const DB_CEIL = -10;
const DB_RANGE = DB_CEIL - DB_FLOOR;

const LOW_BASS_MAX_HZ = 150;
const LOW_BASS_MIN_HZ = 20;
const EXP_RAMP = 6.8;
// Use a smaller FFT size — we only need the 20-150Hz range,
// so 2048 bins is more than sufficient and avoids the cost of 16384.
const BASS_FFT_SIZE = 2048;

export function useBassReactive(enabled: boolean): { dataRef: MutableRefObject<BassData>; update: () => void } {
  const dataRef = useRef<BassData>({ magnitude: 0, transient: 0, pitch: 0, frequency: LOW_BASS_MAX_HZ, hue: 200 });

  // Pre-allocated state kept in refs to avoid GC
  const bufferRef = useRef<Float32Array | null>(null);
  const stateRef = useRef({
    smoothMag: 0,
    prevSmooth: 0,
    bassStart: 1,
    bassEnd: 10,
    binWidth: 0,
    initialized: false,
  });

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      stateRef.current.initialized = false;
      stateRef.current.smoothMag = 0;
      stateRef.current.prevSmooth = 0;
      bufferRef.current = null;
      dataRef.current.magnitude = 0;
      dataRef.current.transient = 0;
    }
  }, [enabled]);

  const update = useCallback(() => {
    if (!enabled) return;

    try {
      const analyser = getAudioRouting().getAnalyserNode();
      if (!analyser) return;

      const s = stateRef.current;

      // Lazy init — use a reasonable FFT size instead of mutating to 16384
      if (!s.initialized) {
        if (analyser.fftSize < BASS_FFT_SIZE) {
          analyser.fftSize = BASS_FFT_SIZE;
        }
        bufferRef.current = new Float32Array(analyser.frequencyBinCount);
        const sr = getSampleRate();
        s.binWidth = sr / (analyser.frequencyBinCount * 2);
        s.bassStart = Math.max(1, Math.floor(LOW_BASS_MIN_HZ / s.binWidth));
        s.bassEnd = Math.min(Math.ceil(LOW_BASS_MAX_HZ / s.binWidth), analyser.frequencyBinCount);
        s.initialized = true;
      }

      const buffer = bufferRef.current!;
      analyser.getFloatFrequencyData(buffer);

      let maxScore = 0;
      let maxBin = s.bassStart;
      let weightedMagSum = 0;
      let weightSum = 0;

      for (let b = s.bassStart; b < s.bassEnd; b++) {
        const db = Math.max(DB_FLOOR, buffer[b]);
        const norm = Math.max(0, (db - DB_FLOOR) / DB_RANGE);
        const freq = b * s.binWidth;
        const rampT = Math.max(0, Math.min(1, (LOW_BASS_MAX_HZ - freq) / (LOW_BASS_MAX_HZ - LOW_BASS_MIN_HZ)));
        const subT = Math.max(0, Math.min(1, (60 - freq) / 40));
        const invFreq = Math.pow(LOW_BASS_MAX_HZ / Math.max(LOW_BASS_MIN_HZ, freq), 3.2);
        const weight = Math.exp(rampT * EXP_RAMP) * (1 + subT * 6.5) * invFreq;

        weightedMagSum += norm * weight;
        weightSum += weight;

        const score = norm * weight;
        if (score > maxScore) {
          maxScore = score;
          maxBin = b;
        }
      }

      const avgMag = weightSum > 0 ? weightedMagSum / weightSum : 0;

      // Smooth: fast attack, slow release
      if (avgMag > s.smoothMag) {
        s.smoothMag += (avgMag - s.smoothMag) * 0.82;
      } else {
        s.smoothMag += (avgMag - s.smoothMag) * 0.2;
      }

      // Transient: positive derivative, decays fast
      const transient = Math.max(0, s.smoothMag - s.prevSmooth) * 4;
      s.prevSmooth = s.smoothMag;

      // Pitch: dominant low-bass frequency → 0–1
      const center = Math.max(DB_FLOOR, buffer[maxBin]);
      const left = maxBin > s.bassStart ? Math.max(DB_FLOOR, buffer[maxBin - 1]) : center;
      const right = maxBin < s.bassEnd - 1 ? Math.max(DB_FLOOR, buffer[maxBin + 1]) : center;
      const denom = left - 2 * center + right;
      const offset = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denom)) : 0;
      const freq = (maxBin + offset) * s.binWidth;
      const pitchT = Math.max(0, Math.min(1, (freq - LOW_BASS_MIN_HZ) / (LOW_BASS_MAX_HZ - LOW_BASS_MIN_HZ)));

      const hue = 198 - pitchT * 18;

      dataRef.current.magnitude = s.smoothMag;
      dataRef.current.transient = transient;
      dataRef.current.pitch = pitchT;
      dataRef.current.frequency = freq;
      dataRef.current.hue = hue;
    } catch {
      // Audio not initialized yet
    }
  }, [enabled]);

  return { dataRef, update };
}
