/** Convert decibels to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Convert linear gain to decibels. */
function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/**
 * Calculate the auto-gain compensation (in dB) for a set of EQ bands.
 *
 * Samples the combined EQ response at 128 log-spaced frequencies (20 Hz – 20 kHz),
 * weights each sample by a -4.5 dB/oct assumed spectral slope (0 dB at 20 Hz,
 * ~-45 dB at 20 kHz), and returns the negative of the maximum weighted gain,
 * clamped to ≤ 0. This ensures just enough gain reduction to prevent clipping
 * from EQ boosts, accounting for where in the spectrum the boost occurs.
 */
export function calculateAutoGainDb(
  bands: import('../models/EQBand').EQBand[],
  audioCtx: BaseAudioContext,
): number {
  if (bands.length === 0) return 0;

  const NUM_POINTS = 128;
  const F_MIN = 20;
  const F_MAX = 20000;
  const DB_PER_OCT = -4.5;

  // Generate 128 log-spaced frequencies
  const frequencies = new Float32Array(NUM_POINTS);
  const logMin = Math.log(F_MIN);
  const logMax = Math.log(F_MAX);
  for (let i = 0; i < NUM_POINTS; i++) {
    frequencies[i] = Math.exp(logMin + (i / (NUM_POINTS - 1)) * (logMax - logMin));
  }

  // Accumulate dB gains across all bands
  const totalGainDb = new Float64Array(NUM_POINTS); // starts at 0

  const magResponse = new Float32Array(NUM_POINTS);
  const phaseResponse = new Float32Array(NUM_POINTS);

  for (const band of bands) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = band.type ?? 'peaking';
    filter.frequency.value = band.frequency;
    filter.gain.value = band.gain;
    filter.Q.value = band.q;

    filter.getFrequencyResponse(frequencies, magResponse, phaseResponse);

    for (let i = 0; i < NUM_POINTS; i++) {
      totalGainDb[i] += gainToDb(magResponse[i]);
    }
  }

  // Find maximum weighted gain
  let maxWeightedGain = -Infinity;
  for (let i = 0; i < NUM_POINTS; i++) {
    const signalWeight = DB_PER_OCT * Math.log2(frequencies[i] / F_MIN);
    const weightedGain = totalGainDb[i] + signalWeight;
    if (weightedGain > maxWeightedGain) {
      maxWeightedGain = weightedGain;
    }
  }

  // Return negative of max weighted gain, clamped to ≤ 0
  return -Math.max(0, maxWeightedGain);
}
