'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { GuidedCalibrationPlayer } from '@/lib/audio/guidedCalibrationPlayer';
import { EXPERIMENTS, TOTAL_STEPS, advanceSession, backSession, changeChoice, depthLevels, newSession, previewBands, retryPair, type Session, type DotPosition } from '@/lib/calibration/guidedSession';
import { peakingResponse, type Pad } from '@/lib/calibration/guidedEQ';
import type { EQBand } from '@/lib/models/EQBand';
import type { EQProfile } from '@/lib/models/EQProfile';
import { useEQProfileStore } from '@/lib/stores/eqProfileStore';
import * as storage from '@/lib/storage/indexedDBManager';
import './guided-calibration.css';

const STORAGE_KEY = 'cabin:guided-calibration:v1';
const copy = (bands: EQBand[]) => bands.map(b => ({ ...b }));
function loadSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Session | null;
    if (!value || value.version !== 1 || ![44100, 48000, 88200, 96000].includes(value.sampleRate) || !Number.isInteger(value.step) || value.step < 0 || value.step > TOTAL_STEPS || !Array.isArray(value.records)) return null;
    const needed = Math.min(EXPERIMENTS.length, Math.floor(value.step / 3) + 1);
    if (value.records.length < needed || value.records.length > EXPERIMENTS.length) return null;
    for (const r of value.records) {
      if (!Array.isArray(r.baseline) || r.baseline.length > 9 || !Array.isArray(r.choices) || r.choices.length !== 2) return null;
      if (!r.choices.every(p => [p.x, p.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1))) return null;
      for (const b of [...r.baseline, ...(r.output ?? []), ...(r.resolution?.bands ?? [])]) if (!Number.isFinite(b.frequency) || !Number.isFinite(b.gain) || !Number.isFinite(b.q) || b.frequency < 20 || b.frequency >= value.sampleRate / 2 || Math.abs(b.gain) > 6 || b.q <= 0 || typeof b.id !== 'string') return null;
    }
    previewBands(value); return value;
  } catch { return null; }
}

function Soundstage({ pair, levels, pulse, playing, onToggle }: { pair: readonly [DotPosition, DotPosition]; levels: [number, number]; pulse: { dot: number; strength: number }; playing: boolean; onToggle: () => void }) {
  const [view, setView] = useState({ yaw: 18, pitch: 10 });
  const [width, setWidth] = useState(688);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
  useEffect(() => { const node = host.current; if (!node) return; const observer = new ResizeObserver(() => setWidth(Math.max(260, node.clientWidth))); observer.observe(node); return () => observer.disconnect(); }, []);
  const height = width < 449 ? 264 : Math.round(width * .49);
  const project = (x: number, y: number, z: number) => {
    const yaw = view.yaw * Math.PI / 180, pitch = view.pitch * Math.PI / 180;
    const dz = (z - .85) * Math.cos(yaw) - x * Math.sin(yaw), depth = dz * Math.cos(pitch) - y * Math.sin(pitch), scale = 4.7 / (4.7 + depth);
    return { x: width / 2 + (x * Math.cos(yaw) + (z - .85) * Math.sin(yaw)) * width * .215 * scale, y: height * .48 - (y * Math.cos(pitch) + dz * Math.sin(pitch)) * height * .255 * scale, scale, depth };
  };
  const lines: [number[], number[]][] = [];
  [0, .85, 1.7].forEach(z => { lines.push([[-1.35, -1.12, z], [1.35, -1.12, z]], [[-1.35, 1.12, z], [1.35, 1.12, z]]); [-1.35, 1.35].forEach(x => lines.push([[x, -1.12, z], [x, 1.12, z]])); });
  [-1.35, -.45, .45, 1.35].forEach(x => lines.push([[x, -1.12, 0], [x, -1.12, 1.7]]));
  const dots = pair.map(([col, row], i) => { const z = -levels[i] / 18 * 1.7, x = -1.05 + col * .7, y = -.9 + row * .9; return { i, p: project(x, y, z), floor: project(x, -1.12, z) }; }).sort((a, b) => b.p.depth - a.p.depth);
  const rotate = (yaw: number, pitch: number) => setView({ yaw: Math.max(-65, Math.min(65, yaw)), pitch: Math.max(-8, Math.min(25, pitch)) });
  const release = (e: ReactPointerEvent) => { if (drag.current?.id !== e.pointerId) return; drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); };
  return <div className="gc-stage" ref={host}>
    <button type="button" className="gc-orbit" aria-label="Drag to rotate the soundstage. Arrow keys change viewing angle." onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ...view }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const d = drag.current; if (d?.id === e.pointerId) rotate(d.yaw + (e.clientX - d.x) * .28, d.pitch - (e.clientY - d.y) * .18); }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={e => { const d: Record<string, number[]> = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, 3], ArrowDown: [0, -3] }; if (d[e.key]) { e.preventDefault(); rotate(view.yaw + d[e.key][0], view.pitch + d[e.key][1]); } }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ height }} role="img" aria-label="Two dots alternate with the audio and swap depths every four hits in a three-dimensional soundstage">
        {lines.map(([a, b], i) => { const p = project(a[0], a[1], a[2]), q = project(b[0], b[1], b[2]); return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="gc-wire" />; })}
        {dots.map(({ i, p, floor }) => { const r = (width < 400 ? 13 : 18) * p.scale, strength = pulse.dot === i ? pulse.strength : 0, color = i === 0 ? 'var(--gc-a)' : 'var(--gc-b)'; return <g key={i} data-dot={i}>
          <ellipse cx={floor.x} cy={floor.y} rx={r * 1.1} ry={r * .25} fill={color} opacity={.12} />
          <line x1={p.x} y1={p.y + r + 4} x2={floor.x} y2={floor.y - 3} className="gc-wire" strokeDasharray="2 5" />
          <circle cx={p.x} cy={p.y} r={r * 2.4} fill={color} opacity={strength * .08} />
          <circle cx={p.x} cy={p.y} r={r * 1.5} stroke={color} fill="none" opacity={strength * .65} />
          <circle cx={p.x} cy={p.y} r={r} fill={color} opacity={.5 + strength * .5} />
          <circle cx={p.x - r * .2} cy={p.y - r * .25} r={r * .3} fill="var(--gc-fg)" opacity={.1 + strength * .4} />
        </g>; })}
      </svg>
    </button>
    <button type="button" className="gc-play" onClick={onToggle}>{playing ? 'Pause' : 'Play'}</button>
  </div>;
}

function Curve({ bands, sampleRate }: { bands: EQBand[]; sampleRate: number }) {
  const frequencies = Array.from({ length: 180 }, (_, i) => 20 * (Math.min(20000, sampleRate * .45) / 20) ** (i / 179));
  const curves = ['left', 'right'].map(channel => { const values = frequencies.map(() => 0); bands.filter(b => !b.channel || b.channel === 'both' || b.channel === channel).forEach(b => peakingResponse(b, frequencies, sampleRate).forEach((v, i) => values[i] += v)); return values; });
  const range = Math.max(6, Math.ceil(Math.max(...curves.flat().map(Math.abs)) / 3) * 3);
  return <svg className="gc-curve" viewBox="0 0 680 250" role="img" aria-label={`Final EQ curve. Left ear teal, right ear blue. Range minus ${range} to plus ${range} decibels.`}>
    {[-range, 0, range].map(db => <g key={db}><line x1="48" x2="650" y1={110 - db / range * 85} y2={110 - db / range * 85} className="gc-wire" /><text x="40" y={115 - db / range * 85} textAnchor="end">{db > 0 ? '+' : ''}{db}</text></g>)}
    {[20, 100, 1000, 10000, 20000].filter(f => f <= frequencies.at(-1)!).map(f => <text key={f} x={48 + Math.log(f / 20) / Math.log(frequencies.at(-1)! / 20) * 602} y="222" textAnchor="middle">{f >= 1000 ? `${f / 1000}k` : f}</text>)}
    {curves.map((values, ear) => <path key={ear} d={values.map((v, i) => `${i ? 'L' : 'M'}${48 + i / 179 * 602},${110 - v / range * 85}`).join(' ')} fill="none" stroke={ear ? 'var(--gc-b)' : 'var(--gc-a)'} strokeWidth="2" strokeDasharray={ear ? '5 3' : undefined} />)}
    <text x="350" y="246" textAnchor="middle">Frequency (Hz) · Gain (dB)</text>
  </svg>;
}

export function GuidedCalibrationPage() {
  const [session, setSession] = useState<Session | null>(null), [ready, setReady] = useState(false), [started, setStarted] = useState(false), [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false), [volume, setVolume] = useState(.32), [speed, setSpeed] = useState(3), [pulse, setPulse] = useState({ dot: -1, strength: 0, arrangement: 0 });
  const [comparePrevious, setComparePrevious] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const player = useRef<GuidedCalibrationPlayer | null>(null), latest = useRef(session);
  latest.current = session;
  useEffect(() => { setSession(loadSession()); setReady(true); return () => { void player.current?.dispose(); }; }, []);
  useEffect(() => { if (!session) return; const id = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { setError('Your browser could not save progress. Keep this tab open.'); } }, 250); return () => clearTimeout(id); }, [session]);
  useEffect(() => {
    const persist = () => { if (latest.current) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current)); } catch {} };
    const hide = () => { if (document.hidden) { player.current?.pause(); setPlaying(false); persist(); } };
    window.addEventListener('pagehide', persist); document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('pagehide', persist); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => { if (!started) return; const id = setInterval(() => setPulse(player.current?.pulse() ?? { dot: -1, strength: 0, arrangement: 0 }), 40); return () => clearInterval(id); }, [started]);
  const done = !!session && session.step >= TOTAL_STEPS, index = session ? Math.min(EXPERIMENTS.length - 1, Math.floor(session.step / 3)) : 0;
  const phase = session ? session.step % 3 : 0, record = session?.records[index], review = !done && phase === 2;
  const bands = useMemo(() => session ? previewBands(session) : [], [session]);
  const arrangement = done ? 0 : Math.min(1, phase);
  const liveArrangement = started ? pulse.arrangement : arrangement;
  const levels = depthLevels(index), displayedLevels: [number, number] = liveArrangement ? [levels[1], levels[0]] : levels;
  useEffect(() => {
    const audio = player.current; if (!started || !audio || !record) return;
    audio.setHeadroom(record.baseline); audio.configure(EXPERIMENTS[index], index, arrangement); setPulse(audio.pulse());
    setComparePrevious(false);
  }, [started, index, arrangement, record?.baseline]);
  useEffect(() => { if (started) player.current?.setBands(comparePrevious ? done ? [] : record?.baseline ?? [] : bands); }, [started, bands, comparePrevious, record?.baseline, done]);
  useEffect(() => { player.current?.setVolume(volume); }, [volume]);
  useEffect(() => { player.current?.setSpeed(speed); }, [speed]);
  useEffect(() => { if (done) { player.current?.pause(); setPlaying(false); } }, [done]);
  const start = async () => {
    setBusy(true); setError('');
    try { const audio = new GuidedCalibrationPlayer(session?.sampleRate); player.current = audio; const next = session ?? newSession(audio.context.sampleRate); if (next.sampleRate !== audio.context.sampleRate) throw new Error('This saved session uses a different sample rate. Start a new calibration.'); setSession(next); audio.setVolume(volume); audio.setSpeed(speed); audio.setHeadroom(next.records[Math.min(EXPERIMENTS.length - 1, Math.floor(next.step / 3))].baseline); audio.setBands(previewBands(next)); audio.configure(EXPERIMENTS[Math.min(EXPERIMENTS.length - 1, Math.floor(next.step / 3))], Math.min(EXPERIMENTS.length - 1, Math.floor(next.step / 3)), Math.min(1, next.step % 3)); await audio.play(); setStarted(true); setPlaying(true); } catch (e) { await player.current?.dispose(); player.current = null; setError(e instanceof Error ? e.message : 'Audio could not start.'); } finally { setBusy(false); }
  };
  const toggle = async () => { if (!player.current) return; try { if (playing) player.current.pause(); else await player.current.play(); setPlaying(player.current.playing); } catch { setError('Audio could not resume.'); } };
  const pad = record?.choices[Math.min(1, phase)] ?? { x: .5, y: .5 };
  const updatePad = (next: Pad) => { if (session && !done && !review) setSession(changeChoice(session, next)); };
  const movePad = (e: ReactPointerEvent<HTMLDivElement>) => { const rect = e.currentTarget.getBoundingClientRect(); updatePad({ x: Math.max(0, Math.min(1, (e.clientX - rect.left - 22) / (rect.width - 44))), y: Math.max(0, Math.min(1, (e.clientY - rect.top - 22) / (rect.height - 44))) }); };
  const next = (keep = false) => { if (!session) return; try { setComparePrevious(false); setSession(advanceSession(session, keep)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not combine this pair.'); } };
  const saveProfile = async () => {
    if (!session) return; setBusy(true); setError('');
    try { const profile: EQProfile = { id: crypto.randomUUID(), name: `Guided calibration ${new Date().toLocaleDateString()}`, bands: copy(bands), volume: -bands.reduce((sum, b) => sum + Math.max(0, b.gain), 0), lastModified: Date.now(), syncStatus: 'pending' }; await storage.updateItem(storage.STORES.EQ_PROFILES, profile); useEQProfileStore.setState(state => ({ profiles: { ...state.profiles, [profile.id]: profile } })); useEQProfileStore.getState().setActiveProfile(profile.id); useEQProfileStore.getState().setEQEnabled(true); setSaved(true); } catch { setError('Could not save the profile. You can still download the curve.'); } finally { setBusy(false); }
  };
  const download = () => { if (!session) return; const preamp = -bands.reduce((sum, b) => sum + Math.max(0, b.gain), 0); const blob = new Blob([JSON.stringify({ name: 'Cabin guided calibration', sampleRate: session.sampleRate, preampDb: preamp, bands }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cabin-guided-eq.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const pair = EXPERIMENTS[index].pair, horizontal = pair[0][1] === pair[1][1];
  const instruction = review ? record?.resolution?.status === 'recheck' ? 'These choices differed. Retry this pair, or keep the previous EQ.' : 'Compare the combined adjustment with the previous sound. Keep the one you prefer.' : `Move the slider to where the ${horizontal ? 'left' : 'upper'} dot sounds most clearly ${horizontal ? 'to the left of' : 'above'} and ${liveArrangement ? 'behind' : 'in front of'} the ${horizontal ? 'right' : 'lower'} dot.`;
  return <main className="gc-page"><div className="gc-shell">
    {!started ? <div className="gc-start"><h1>Find your soundstage</h1><p>Listen to two dots. Choose the best spot.</p><button className="gc-button gc-primary" disabled={!ready || busy} onClick={() => void start()}>{busy ? 'Starting…' : session ? 'Continue calibration' : 'Start listening'}</button>{session && <button className="gc-link" onClick={() => { localStorage.removeItem(STORAGE_KEY); setSession(null); }}>Start a new calibration</button>}</div> : <>
      <Soundstage pair={pair} levels={displayedLevels} pulse={pulse} playing={playing} onToggle={() => void toggle()} />
      {done && session ? <section className="gc-result"><h1>Your EQ curve</h1><Curve bands={bands} sampleRate={session.sampleRate} /><div className="gc-legend"><span>Left ear · teal</span><span>Right ear · blue</span></div><div className="gc-result-actions"><button className="gc-button" onClick={() => setComparePrevious(v => !v)}>{comparePrevious ? 'Hear your EQ' : 'Compare flat'}</button><button className="gc-button" onClick={download}>Download curve</button><button className="gc-button gc-primary" disabled={busy || saved} onClick={() => void saveProfile()}>{saved ? 'Profile saved' : 'Save and use EQ'}</button></div><details><summary>EQ bands</summary><table><thead><tr><th>Channel</th><th>Hz</th><th>dB</th><th>Q</th></tr></thead><tbody>{bands.map(b => <tr key={b.id}><td>{b.channel}</td><td>{Math.round(b.frequency)}</td><td>{b.gain.toFixed(2)}</td><td>{b.q.toFixed(2)}</td></tr>)}</tbody></table></details>{saved && <Link href="/">Open Cabin →</Link>}</section> : <div className="gc-controls">
        {!review ? <div className="gc-pad" onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); movePad(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) movePad(e); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><button type="button" className="gc-handle" aria-label="Adjust sound with the arrow keys or drag the pad" style={{ left: `calc(22px + (100% - 44px) * ${pad.x})`, top: `calc(22px + (100% - 44px) * ${pad.y})` }} onKeyDown={e => { const d: Record<string, number[]> = { ArrowLeft: [-.025, 0], ArrowRight: [.025, 0], ArrowUp: [0, -.025], ArrowDown: [0, .025] }; if (d[e.key]) { e.preventDefault(); updatePad({ x: Math.max(0, Math.min(1, pad.x + d[e.key][0])), y: Math.max(0, Math.min(1, pad.y + d[e.key][1])) }); } }} /></div> : <div className="gc-review">{record?.resolution?.status === 'recheck' ? <button className="gc-button" onClick={() => session && setSession(retryPair(session))}>Retry pair</button> : <button className="gc-button" aria-pressed={comparePrevious} onClick={() => setComparePrevious(v => !v)}>{comparePrevious ? 'Hear combined EQ' : 'Hear previous EQ'}</button>}</div>}
        <p className="gc-instruction" aria-live="polite">{instruction}</p>
      </div>}
      <div className="gc-nav"><button className="gc-button" disabled={!session?.step} onClick={() => { if (session) { setComparePrevious(false); setSession(backSession(session)); setSaved(false); } }}>← Back</button><div className="gc-progress"><span>{done ? TOTAL_STEPS : (session?.step ?? 0) + 1} / {TOTAL_STEPS}</span><progress aria-label="Calibration progress" max={TOTAL_STEPS} value={session?.step ?? 0} /></div>{!done && <button className="gc-button gc-primary" onClick={() => next(review && comparePrevious)}>{review ? record?.resolution?.status === 'recheck' || comparePrevious ? 'Keep previous' : session?.step === TOTAL_STEPS - 1 ? 'Finish' : 'Keep EQ →' : 'Next →'}</button>}</div>
      <div className="gc-playback-controls"><label className="gc-volume">Volume<input type="range" min="0" max="1" step=".01" value={volume} onChange={e => setVolume(Number(e.target.value))} /></label><label className="gc-volume">Speed<input aria-label="Hit speed" aria-valuetext={`${speed} times speed`} type="range" min="1" max="6" step=".25" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><output>{speed}×</output></label></div>
    </>}{error && <p className="gc-error" role="alert">{error}</p>}
  </div></main>;
}
