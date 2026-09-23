import type { EQBand } from '../models/EQBand';

export type Pad = { x: number; y: number };
export type Slice = 'frequency-gain' | 'frequency-bandwidth' | 'gain-bandwidth';
type Range = readonly [number, number];
type Shape = { frequency: number; gain: number; bandwidth: number };

export interface RoundOptions {
  id: string;
  baseline: readonly EQBand[];
  /** Existing band to refine, or a new, initially flat peaking band. */
  band: EQBand;
  slice: Slice;
  sampleRate: number;
  limits: { frequency: Range; gain: Range; bandwidth: Range };
  /** Audible frequency ranges of the two stimuli. Not perceptual weights. */
  stimulusRanges: readonly Range[];
  /** Provisional engineering thresholds; must be tuned with listening data. */
  maxDisagreementDb?: number;
  maxFitErrorDb?: number;
}

export interface Resolution {
  status: 'candidate' | 'recheck';
  reason: 'agreement' | 'disagreement' | 'poor-fit';
  /** Candidate profile, or unchanged baseline when a recheck is needed. */
  bands: EQBand[];
  pad: Pad;
  disagreementDb: number;
  fitErrorDb: number;
  frequencies: number[];
  targetDeltaDb: number[];
  fittedDeltaDb: number[];
}

const finite = (v: number) => Number.isFinite(v);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const copyBands = (bands: readonly EQBand[]) => bands.map(b => ({ ...b }));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Digital bandwidth conversion and peaking coefficients follow the W3C
// Audio EQ Cookbook: https://www.w3.org/TR/audio-eq-cookbook/
export function bandwidthToQ(bandwidth: number, frequency: number, sampleRate: number): number {
  assert(finite(sampleRate) && sampleRate > 0 && finite(frequency) && frequency > 0 && frequency < sampleRate / 2 && finite(bandwidth) && bandwidth > 0, 'Invalid bandwidth conversion');
  const w = 2 * Math.PI * frequency / sampleRate;
  return 1 / (2 * Math.sinh(Math.LN2 / 2 * bandwidth * w / Math.sin(w)));
}

function qToBandwidth(q: number, frequency: number, sampleRate: number): number {
  const w = 2 * Math.PI * frequency / sampleRate;
  return 2 * Math.asinh(1 / (2 * q)) / Math.LN2 * Math.sin(w) / w;
}

/** Magnitude of one peaking filter, using the actual playback sample rate. */
export function peakingResponse(band: EQBand, frequencies: readonly number[], sampleRate: number): number[] {
  assert((band.type ?? 'peaking') === 'peaking', 'Expected a peaking band');
  assert(finite(sampleRate) && sampleRate > 0 && finite(band.frequency) && band.frequency > 0 && band.frequency < sampleRate / 2 && finite(band.gain) && finite(band.q) && band.q > 0, 'Invalid peaking band');
  assert(frequencies.every(f => finite(f) && f > 0 && f < sampleRate / 2), 'Invalid response frequencies');
  const a = 10 ** (band.gain / 40), w0 = 2 * Math.PI * band.frequency / sampleRate;
  const alpha = Math.sin(w0) / (2 * band.q), c = -2 * Math.cos(w0);
  const b0 = 1 + alpha * a, b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a, a2 = 1 - alpha / a;
  return frequencies.map(f => {
    const w = 2 * Math.PI * f / sampleRate, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const numerator = (b0 + c * cw + b2 * c2) ** 2 + (c * sw + b2 * s2) ** 2;
    const denominator = (a0 + c * cw + a2 * c2) ** 2 + (c * sw + a2 * s2) ** 2;
    return 10 * Math.log10(numerator / denominator);
  });
}

/** Center of every new pad is the current sound, even for asymmetric bounds. */
function interpolate(value: number, anchor: number, range: Range, log = false): number {
  const transform = log ? Math.log2 : (v: number) => v;
  const inverse = log ? (v: number) => 2 ** v : (v: number) => v;
  const center = transform(anchor), end = transform(range[value < .5 ? 0 : 1]);
  return inverse(center + Math.abs(value - .5) * 2 * (end - center));
}

/**
 * One two-arrangement experiment over one band and one fixed parameter slice.
 * No audio, persistence, automatic round selection, or claims of spatial accuracy.
 */
export class GuidedEQRound {
  private readonly options: RoundOptions;
  private readonly anchor: Shape;
  private readonly selections: Partial<Record<0 | 1, Pad>> = {};

  constructor(options: RoundOptions) {
    assert(['frequency-gain', 'frequency-bandwidth', 'gain-bandwidth'].includes(options.slice), 'Invalid slice');
    assert(finite(options.sampleRate) && options.sampleRate >= 8000, 'Invalid sample rate');
    assert(new Set(options.baseline.map(b => b.id)).size === options.baseline.length, 'Duplicate baseline band IDs');
    const existing = options.baseline.find(b => b.id === options.band.id);
    const band = { ...(existing ?? options.band) };
    assert(!!band.id && (band.type ?? 'peaking') === 'peaking', 'Target must be a named peaking band');
    peakingResponse(band, [band.frequency], options.sampleRate);
    assert(existing !== undefined || band.gain === 0, 'A new band must start flat');
    const anchor = { frequency: band.frequency, gain: band.gain, bandwidth: qToBandwidth(band.q, band.frequency, options.sampleRate) };
    for (const key of ['frequency', 'gain', 'bandwidth'] as const) {
      const [lo, hi] = options.limits[key];
      assert(finite(lo) && finite(hi) && lo < hi, 'Invalid ' + key + ' limits');
      assert(anchor[key] >= lo - 1e-9 && anchor[key] <= hi + 1e-9, 'Anchor outside ' + key + ' limits');
    }
    assert(options.limits.frequency[0] >= 20 && options.limits.frequency[1] <= Math.min(20000, options.sampleRate * .45), 'Frequency limits exceed supported range');
    assert(options.limits.gain[0] >= -12 && options.limits.gain[1] <= 12, 'Gain limits exceed ±12 dB');
    assert(options.limits.bandwidth[0] >= .1 && options.limits.bandwidth[1] <= 4, 'Bandwidth limits exceed 0.1–4 octaves');
    assert(options.stimulusRanges.length > 0 && options.stimulusRanges.every(([lo, hi]) => finite(lo) && finite(hi) && lo >= 20 && lo < hi && hi <= Math.min(20000, options.sampleRate * .45)), 'Invalid stimulus ranges');
    for (const v of [options.maxDisagreementDb ?? 1, options.maxFitErrorDb ?? .5]) assert(finite(v) && v > 0, 'Invalid threshold');
    assert(options.slice !== 'frequency-bandwidth' || Math.abs(band.gain) >= .25, 'Frequency/bandwidth is inaudible near zero gain; use a gain slice');
    this.options = { ...options, baseline: copyBands(options.baseline), band, limits: { frequency: [...options.limits.frequency], gain: [...options.limits.gain], bandwidth: [...options.limits.bandwidth] }, stimulusRanges: options.stimulusRanges.map(r => [...r]) };
    this.anchor = anchor;
  }

  private normalized(pad: Pad): Pad {
    assert(finite(pad.x) && finite(pad.y), 'Invalid pad coordinates');
    return { x: clamp01(pad.x), y: clamp01(pad.y) };
  }

  private bandAt(pad: Pad): EQBand {
    const { x, y } = this.normalized(pad), { slice, limits, sampleRate } = this.options;
    const shape = { ...this.anchor };
    if (slice === 'gain-bandwidth') shape.gain = interpolate(x, shape.gain, limits.gain);
    else shape.frequency = interpolate(x, shape.frequency, limits.frequency, true);
    if (slice === 'frequency-gain') shape.gain = interpolate(1 - y, shape.gain, limits.gain);
    else shape.bandwidth = interpolate(1 - y, shape.bandwidth, limits.bandwidth, true);
    return { ...this.options.band, type: 'peaking', frequency: shape.frequency, gain: shape.gain, q: bandwidthToQ(shape.bandwidth, shape.frequency, sampleRate) };
  }

  preview(pad: Pad): EQBand[] {
    const band = this.bandAt(pad), bands = copyBands(this.options.baseline);
    const index = bands.findIndex(b => b.id === band.id);
    if (index === -1) bands.push(band); else bands[index] = band;
    return bands;
  }

  /** Replaces the previous choice for this arrangement; never adds another band. */
  choose(arrangement: 0 | 1, pad: Pad): void {
    assert(arrangement === 0 || arrangement === 1, 'Invalid arrangement');
    this.selections[arrangement] = this.normalized(pad);
  }

  resolve(): Resolution {
    const a = this.selections[0], b = this.selections[1];
    assert(!!a && !!b, 'Both arrangements need a choice');
    const { sampleRate, stimulusRanges } = this.options;
    // Sample each audible range separately so narrow stimuli cannot fall between bins.
    const frequencies = [...new Set(stimulusRanges.flatMap(([lo, hi]) => Array.from({ length: 65 }, (_, i) => lo * (hi / lo) ** (i / 64))))].sort((x, y) => x - y);
    const response = (pad: Pad) => peakingResponse(this.bandAt(pad), frequencies, sampleRate);
    const anchorResponse = response({ x: .5, y: .5 });
    const delta = (pad: Pad) => response(pad).map((v, i) => v - anchorResponse[i]);
    const da = delta(a), db = delta(b), target = da.map((v, i) => (v + db[i]) / 2);
    const mse = (x: number[], y: number[]) => x.reduce((sum, v, i) => sum + (v - y[i]) ** 2, 0) / x.length;
    const disagreementDb = Math.sqrt(mse(da, db));
    // Approximate bounded minimizer of response error, not an average of band
    // parameters. Fixed third parameter and earlier bands stay fixed.
    let best: Pad = { x: .5, y: .5 }, score = Infinity;
    const visit = (pad: Pad) => {
      const p = this.normalized(pad), d = delta(p);
      const value = mse(d, target) + .01 * d.reduce((s, v) => s + v * v, 0) / d.length;
      if (value < score) { best = p; score = value; }
    };
    visit(best); visit(a); visit(b);
    for (let x = 0; x <= 16; x++) for (let y = 0; y <= 16; y++) visit({ x: x / 16, y: y / 16 });
    for (let radius = 1 / 32; radius >= 1 / 1024; radius /= 2) {
      const center = best;
      for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) visit({ x: center.x + x * radius, y: center.y + y * radius });
    }
    const fittedDeltaDb = delta(best), fitErrorDb = Math.sqrt(mse(fittedDeltaDb, target));
    const reason = disagreementDb > (this.options.maxDisagreementDb ?? 1) ? 'disagreement' : fitErrorDb > (this.options.maxFitErrorDb ?? .5) ? 'poor-fit' : 'agreement';
    return { status: reason === 'agreement' ? 'candidate' : 'recheck', reason, bands: reason === 'agreement' ? this.preview(best) : copyBands(this.options.baseline), pad: { ...best }, disagreementDb, fitErrorDb, frequencies, targetDeltaDb: target, fittedDeltaDb };
  }
}
