import type { EQBand } from '../models/EQBand';
import { GuidedEQRound, bandwidthToQ, type Pad, type Resolution } from './guidedEQ';

export type DotPosition = readonly [number, number];
export interface Experiment { pair: readonly [DotPosition, DotPosition]; channel: 'both' | 'left' | 'right'; region: 'broad' | 'upper' | 'lower'; }
export const EXPERIMENTS: Experiment[] = [
  { pair: [[1, 2], [1, 0]], channel: 'both', region: 'broad' },
  { pair: [[1, 2], [1, 1]], channel: 'both', region: 'upper' },
  { pair: [[1, 1], [1, 0]], channel: 'both', region: 'lower' },
];
[2, 0, 3].forEach(col => [1, 0].forEach(row => EXPERIMENTS.push({ pair: [[col, row + 1], [col, row]], channel: col === 2 ? 'both' : col === 0 ? 'left' : 'right', region: row === 1 ? 'upper' : 'lower' })));
[2, 1, 0].forEach(row => [0, 1, 2].forEach(col => EXPERIMENTS.push({ pair: [[col, row], [col + 1, row]], channel: col === 1 ? 'both' : col === 0 ? 'left' : 'right', region: row === 2 ? 'upper' : row === 0 ? 'lower' : 'broad' })));
EXPERIMENTS.push({ pair: [[0, 2], [3, 0]], channel: 'both', region: 'broad' }, { pair: [[3, 2], [0, 0]], channel: 'both', region: 'broad' });
export const TOTAL_STEPS = EXPERIMENTS.length * 3;
export interface RecordEntry { baseline: EQBand[]; choices: [Pad, Pad]; resolution?: Resolution; output?: EQBand[]; }
export interface Session { version: 1; sampleRate: number; step: number; records: RecordEntry[]; }
export const neutral = (): Pad => ({ x: .5, y: .5 });
const copy = (bands: EQBand[]) => bands.map(b => ({ ...b }));
export const newRecord = (baseline: EQBand[]): RecordEntry => ({ baseline: copy(baseline), choices: [neutral(), neutral()] });
export const newSession = (sampleRate: number): Session => ({ version: 1, sampleRate, step: 0, records: [newRecord([])] });

/** Same 5-octave band-noise mapping used by the existing two-dot player. */
export function stimulusRange(row: number, sampleRate: number): [number, number] {
  const top = Math.min(20000, sampleRate * .45);
  const lower = 20 * (top / 32 / 20) ** (row / 2);
  return [lower, lower * 32];
}
export function depthLevels(index: number): [number, number] {
  return index === 0 ? [0, -18] : index % 2 ? [0, -9] : [-9, -18];
}
export function experimentRound(session: Session, index: number): GuidedEQRound {
  const { baseline } = session.records[index], config = EXPERIMENTS[index];
  const id = `guided-${config.channel}-${config.region}`;
  const upper = Math.min(12000, session.sampleRate * .4);
  const frequency: [number, number] = config.region === 'lower' ? [60, 1800] : config.region === 'upper' ? [800, upper] : [120, upper];
  const existing = baseline.find(b => b.id === id);
  const center = config.region === 'lower' ? 350 : config.region === 'upper' ? 3500 : 1200;
  const band: EQBand = existing ?? { id, frequency: Math.min(center, upper), gain: 0, q: bandwidthToQ(1.5, Math.min(center, upper), session.sampleRate), channel: config.channel, type: 'peaking' };
  // Existing non-flat bands get a bandwidth pass; otherwise gain stays available.
  return new GuidedEQRound({ id: `pair-${index}`, baseline, band, slice: existing && Math.abs(existing.gain) >= .25 ? 'frequency-bandwidth' : 'frequency-gain', sampleRate: session.sampleRate, limits: { frequency, gain: [-6, 6], bandwidth: [.25, 3] }, stimulusRanges: config.pair.map(p => stimulusRange(p[1], session.sampleRate)) });
}
export function changeChoice(session: Session, pad: Pad): Session {
  const index = Math.floor(session.step / 3), phase = session.step % 3;
  if (session.step >= TOTAL_STEPS || phase === 2) return session;
  const current = session.records[index], choices: [Pad, Pad] = [...current.choices];
  choices[phase] = { ...pad };
  // Any downstream judgment was made against the old correction.
  return { ...session, records: [...session.records.slice(0, index), { baseline: current.baseline, choices }] };
}
export function advanceSession(session: Session, keepPrevious = false): Session {
  if (session.step >= TOTAL_STEPS) return session;
  const index = Math.floor(session.step / 3), phase = session.step % 3;
  const records = [...session.records], record = { ...records[index] };
  if (phase === 1) {
    const round = experimentRound(session, index);
    round.choose(0, record.choices[0]); round.choose(1, record.choices[1]);
    record.resolution = round.resolve();
  }
  if (phase === 2) {
    if (!record.resolution) throw new Error('This pair has no combined result');
    const output = keepPrevious || record.resolution.status === 'recheck' ? record.baseline : record.resolution.bands;
    record.output = copy(output);
    if (index + 1 < EXPERIMENTS.length && JSON.stringify(records[index + 1]?.baseline) !== JSON.stringify(output)) {
      records.splice(index + 1, records.length, newRecord(output));
    }
  }
  records[index] = record;
  return { ...session, records, step: session.step + 1 };
}
export const backSession = (session: Session): Session => ({ ...session, step: Math.max(0, session.step - 1) });
export function retryPair(session: Session): Session {
  const index = Math.min(EXPERIMENTS.length - 1, Math.floor(session.step / 3));
  return { ...session, step: index * 3, records: [...session.records.slice(0, index), newRecord(session.records[index].baseline)] };
}
export function previewBands(session: Session): EQBand[] {
  if (session.step >= TOTAL_STEPS) return copy(session.records[EXPERIMENTS.length - 1].output ?? []);
  const index = Math.floor(session.step / 3), phase = session.step % 3, record = session.records[index];
  return phase === 2 ? copy(record.resolution?.bands ?? record.baseline) : experimentRound(session, index).preview(record.choices[phase]);
}
