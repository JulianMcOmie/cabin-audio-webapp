import { useEffect, useRef } from 'react';
import { getStereoAnalyser } from '@/lib/audio/stereoAnalyser';
import { getSampleRate } from '@/lib/audio/audioContext';

// Number of log-spaced display bins
export const STEREO_DISPLAY_BINS = 192;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;

export interface StereoFFTData {
  /** Per-display-bin combined magnitude, 0–1 */
  magnitude: Float32Array;
  /** Per-display-bin transient (positive spectral flux), 0–1 */
  transient: Float32Array;
  /** Per-display-bin pan, -1 (left) to +1 (right) */
  pan: Float32Array;
  /** Whether data is valid (analyser connected and producing data) */
  active: boolean;
}

/**
 * Pre-compute which raw FFT bins map to each display bin.
 * Returns an array of [startBin, endBin) pairs (inclusive start, exclusive end).
 */
function buildBinMapping(frequencyBinCount: number, sampleRate: number): Array<[number, number]> {
  const mapping: Array<[number, number]> = [];
  const minLog = Math.log(MIN_FREQ);
  const maxLog = Math.log(MAX_FREQ);
  const binFreqStep = sampleRate / (frequencyBinCount * 2); // fftSize = frequencyBinCount * 2

  for (let i = 0; i < STEREO_DISPLAY_BINS; i++) {
    const freqLow = Math.exp(minLog + (i / STEREO_DISPLAY_BINS) * (maxLog - minLog));
    const freqHigh = Math.exp(minLog + ((i + 1) / STEREO_DISPLAY_BINS) * (maxLog - minLog));

    const binLow = Math.max(0, Math.floor(freqLow / binFreqStep));
    const binHigh = Math.min(frequencyBinCount, Math.ceil(freqHigh / binFreqStep));

    // Ensure at least one bin
    mapping.push([binLow, Math.max(binLow + 1, binHigh)]);
  }

  return mapping;
}

export function useStereoFFT(enabled: boolean) {
  const dataRef = useRef<StereoFFTData>({
    magnitude: new Float32Array(STEREO_DISPLAY_BINS),
    transient: new Float32Array(STEREO_DISPLAY_BINS),
    pan: new Float32Array(STEREO_DISPLAY_BINS),
    active: false,
  });

  // Pre-allocated buffers for raw FFT data (avoid GC pressure)
  const leftBufferRef = useRef<Float32Array | null>(null);
  const rightBufferRef = useRef<Float32Array | null>(null);
  const binMappingRef = useRef<Array<[number, number]> | null>(null);
  const prevMagnitudeRef = useRef<Float32Array>(new Float32Array(STEREO_DISPLAY_BINS));
  const transientStateRef = useRef<Float32Array>(new Float32Array(STEREO_DISPLAY_BINS));

  // Connect/disconnect the stereo analyser based on enabled
  useEffect(() => {
    const analyser = getStereoAnalyser();
    if (enabled) {
      analyser.connect();

      // Allocate buffers once connected
      const binCount = analyser.getFrequencyBinCount();
      if (binCount > 0) {
        leftBufferRef.current = new Float32Array(binCount);
        rightBufferRef.current = new Float32Array(binCount);
        binMappingRef.current = buildBinMapping(binCount, getSampleRate());
      }
    } else {
      analyser.disconnect();
      dataRef.current.active = false;
      leftBufferRef.current = null;
      rightBufferRef.current = null;
      binMappingRef.current = null;
      prevMagnitudeRef.current.fill(0);
      transientStateRef.current.fill(0);
      dataRef.current.transient.fill(0);
    }

    const data = dataRef.current;
    return () => {
      analyser.disconnect();
      data.active = false;
      data.transient.fill(0);
    };
  }, [enabled]);

  /**
   * Call this inside useFrame to update the FFT data.
   * Reads from the AnalyserNodes and writes to dataRef.current in-place.
   */
  const update = () => {
    const analyser = getStereoAnalyser();
    const leftNode = analyser.getLeftAnalyser();
    const rightNode = analyser.getRightAnalyser();

    if (
      !leftNode || !rightNode ||
      !leftBufferRef.current || !rightBufferRef.current ||
      !binMappingRef.current
    ) {
      dataRef.current.active = false;
      dataRef.current.transient.fill(0);
      prevMagnitudeRef.current.fill(0);
      transientStateRef.current.fill(0);
      return;
    }

    // Read raw dB data from both channels
    leftNode.getFloatFrequencyData(leftBufferRef.current);
    rightNode.getFloatFrequencyData(rightBufferRef.current);

    const leftRaw = leftBufferRef.current;
    const rightRaw = rightBufferRef.current;
    const mapping = binMappingRef.current;
    const mag = dataRef.current.magnitude;
    const trn = dataRef.current.transient;
    const pan = dataRef.current.pan;
    const prevMag = prevMagnitudeRef.current;
    const trnState = transientStateRef.current;

    // dB range for normalization: -80 dB (silence floor) to -10 dB (loud)
    const DB_FLOOR = -80;
    const DB_CEIL = -10;
    const DB_RANGE = DB_CEIL - DB_FLOOR;

    for (let i = 0; i < STEREO_DISPLAY_BINS; i++) {
      const [start, end] = mapping[i];

      // Average dB across raw bins, then normalize to 0–1
      let leftDbSum = 0;
      let rightDbSum = 0;
      const count = end - start;

      for (let b = start; b < end; b++) {
        leftDbSum += Math.max(DB_FLOOR, leftRaw[b]);
        rightDbSum += Math.max(DB_FLOOR, rightRaw[b]);
      }

      const leftDb = leftDbSum / count;
      const rightDb = rightDbSum / count;

      // Normalize dB to 0–1 range
      const leftNorm = Math.max(0, Math.min(1, (leftDb - DB_FLOOR) / DB_RANGE));
      const rightNorm = Math.max(0, Math.min(1, (rightDb - DB_FLOOR) / DB_RANGE));

      // Combined magnitude
      const combined = (leftNorm + rightNorm) / 2;
      mag[i] = combined;

      // Pan: use normalized magnitudes for balanced L/R comparison
      const denom = rightNorm + leftNorm + 1e-10;
      pan[i] = (rightNorm - leftNorm) / denom;

      // Positive spectral flux with quick decay keeps frequency-specific hits salient.
      const delta = combined - prevMag[i];
      const impulse = delta > 0 ? Math.min(1, delta * 6.5) : 0;
      trnState[i] = Math.max(impulse, trnState[i] * 0.6);
      trn[i] = trnState[i];
      prevMag[i] = combined;
    }

    dataRef.current.active = true;
  };

  return { dataRef, update, displayBins: STEREO_DISPLAY_BINS };
}
