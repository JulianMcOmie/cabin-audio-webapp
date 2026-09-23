// Eighth-order Butterworth: four biquads, 48 dB/octave rejection below
// the cutoff, with the combined -3 dB edge at the requested frequency.
export function createSharpHighpassFilters(context: BaseAudioContext): BiquadFilterNode[] {
  const order = 8;
  return Array.from({ length: order / 2 }, (_, index) => {
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    const q = 1 / (2 * Math.cos((2 * index + 1) * Math.PI / (2 * order)));
    // Web Audio highpass/lowpass Q uses decibels, unlike bandpass Q.
    filter.Q.value = 20 * Math.log10(q);
    return filter;
  });
}
