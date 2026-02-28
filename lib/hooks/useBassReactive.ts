import { useEffect, useRef, MutableRefObject } from 'react';
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
const EXP_RAMP = 6.8; // aggressive exponential emphasis toward 20–60Hz
const TARGET_FFT_SIZE = 16384;

export function useBassReactive(): MutableRefObject<BassData> {
  const dataRef = useRef<BassData>({ magnitude: 0, transient: 0, pitch: 0, frequency: LOW_BASS_MAX_HZ, hue: 200 });

  useEffect(() => {
    let rafId = 0;
    let buffer: Float32Array | null = null;
    let smoothMag = 0;
    let prevSmooth = 0;
    let bassStart = 1;
    let bassEnd = 10;
    let binWidth = 0;
    let initialized = false;

    const tick = () => {
      try {
        const analyser = getAudioRouting().getAnalyserNode();
        if (analyser) {
          // Lazy init
          if (!initialized) {
            if (analyser.fftSize < TARGET_FFT_SIZE) {
              analyser.fftSize = TARGET_FFT_SIZE;
            }
            buffer = new Float32Array(analyser.frequencyBinCount);
            const sr = getSampleRate();
            binWidth = sr / (analyser.frequencyBinCount * 2);
            bassStart = Math.max(1, Math.floor(LOW_BASS_MIN_HZ / binWidth));
            bassEnd = Math.min(Math.ceil(LOW_BASS_MAX_HZ / binWidth), analyser.frequencyBinCount);
            initialized = true;
          }

          analyser.getFloatFrequencyData(buffer!);

          let maxScore = 0;
          let maxBin = bassStart;
          let weightedMagSum = 0;
          let weightSum = 0;

          for (let b = bassStart; b < bassEnd; b++) {
            const db = Math.max(DB_FLOOR, buffer![b]);
            const norm = Math.max(0, (db - DB_FLOOR) / DB_RANGE);
            const freq = b * binWidth;
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
          if (avgMag > smoothMag) {
            smoothMag += (avgMag - smoothMag) * 0.82;
          } else {
            smoothMag += (avgMag - smoothMag) * 0.2;
          }

          // Transient: positive derivative, decays fast
          const transient = Math.max(0, smoothMag - prevSmooth) * 4;
          prevSmooth = smoothMag;

          // Pitch: dominant low-bass frequency → 0–1
          const center = Math.max(DB_FLOOR, buffer![maxBin]);
          const left = maxBin > bassStart ? Math.max(DB_FLOOR, buffer![maxBin - 1]) : center;
          const right = maxBin < bassEnd - 1 ? Math.max(DB_FLOOR, buffer![maxBin + 1]) : center;
          const denom = left - 2 * center + right;
          const offset = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denom)) : 0;
          const freq = (maxBin + offset) * binWidth;
          const pitchT = Math.max(0, Math.min(1, (freq - LOW_BASS_MIN_HZ) / (LOW_BASS_MAX_HZ - LOW_BASS_MIN_HZ)));

          // Keep hue in a confined bass-centric range.
          const hue = 198 - pitchT * 18;

          dataRef.current.magnitude = smoothMag;
          dataRef.current.transient = transient;
          dataRef.current.pitch = pitchT;
          dataRef.current.frequency = freq;
          dataRef.current.hue = hue;
        }
      } catch {
        // Audio not initialized yet
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return dataRef;
}
