import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Pure engine: erase TS types without booting Next, Web Audio, or the profile store.
const source = readFileSync(new URL('./guidedEQ.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const engineUrl = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64');
const { GuidedEQRound, peakingResponse, bandwidthToQ } = await import(engineUrl);

const band = (gain = 0, sampleRate = 48000) => ({ id: 'guided-mid', frequency: 1000, gain, q: bandwidthToQ(1, 1000, sampleRate), type: 'peaking', channel: 'both' });
const options = (overrides = {}) => ({ id: 'upper-lower', baseline: [], band: band(), slice: 'frequency-gain', sampleRate: 48000, limits: { frequency: [250, 4000], gain: [-6, 6], bandwidth: [.25, 3] }, stimulusRanges: [[250, 4000]], ...overrides });
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('peaking response has correct center gain and reciprocal boost/cut at actual sample rates', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const frequencies = [250, 500, 1000, 2000, 10000];
    const boost = peakingResponse(band(6, sampleRate), frequencies, sampleRate);
    const cut = peakingResponse(band(-6, sampleRate), frequencies, sampleRate);
    close(boost[2], 6);
    boost.forEach((v, i) => close(v + cut[i], 0));
    peakingResponse(band(0, sampleRate), frequencies, sampleRate).forEach(v => close(v, 0));
  }
});

test('center preserves existing EQ; moving replaces only the target band', () => {
  const other = { id: 'bass', frequency: 100, gain: -2, q: .7, type: 'lowshelf', channel: 'left' };
  const original = band(3), baseline = [other, original];
  const round = new GuidedEQRound(options({ baseline, band: original }));
  const centered = round.preview({ x: .5, y: .5 });
  close(centered[1].frequency, 1000); close(centered[1].gain, 3); close(centered[1].q, original.q);
  baseline[0].gain = 9; original.gain = 9;
  const changed = round.preview({ x: 1, y: 0 });
  assert.equal(changed.length, 2); assert.equal(changed[0].gain, -2); assert.equal(changed[1].gain, 6);
  close(changed[1].frequency, 4000);
  changed[0].gain = 10;
  assert.equal(round.preview({ x: 0, y: 1 })[0].gain, -2);
});

test('hidden slices hold their third perceptual EQ parameter fixed', () => {
  const b = band(3);
  const frequencyBandwidth = new GuidedEQRound(options({ baseline: [b], band: b, slice: 'frequency-bandwidth' }));
  const p = frequencyBandwidth.preview({ x: 1, y: 0 })[0];
  assert.equal(p.gain, 3); close(p.frequency, 4000); close(p.q, bandwidthToQ(3, 4000, 48000));
  const gainBandwidth = new GuidedEQRound(options({ baseline: [b], band: b, slice: 'gain-bandwidth' }));
  const q = gainBandwidth.preview({ x: 0, y: 1 })[0];
  close(q.frequency, 1000); assert.equal(q.gain, -6); close(q.q, bandwidthToQ(.25, 1000, 48000));
  const frequencyGain = new GuidedEQRound(options());
  close(frequencyGain.preview({ x: 1, y: 0 })[0].q, bandwidthToQ(1, 4000, 48000));
});

test('gain-free slice cannot silently offer an inaudible flat-band search', () => {
  assert.throws(() => new GuidedEQRound(options({ slice: 'frequency-bandwidth' })), /inaudible/);
  assert.throws(() => new GuidedEQRound(options({ band: band(3) })), /start flat/);
});

test('two matching choices yield one bounded candidate; center means no correction', () => {
  const round = new GuidedEQRound(options());
  assert.throws(() => round.resolve(), /Both/);
  round.choose(0, { x: .5, y: .25 }); round.choose(1, { x: .5, y: .25 });
  const result = round.resolve();
  assert.equal(result.status, 'candidate'); close(result.disagreementDb, 0);
  assert.equal(result.bands.length, 1); assert.ok(result.fitErrorDb < .05);
  close(result.bands[0].gain, 3, .1);
  round.choose(0, { x: .5, y: .5 }); round.choose(1, { x: .5, y: .5 });
  close(round.resolve().bands[0].gain, 0);
});

test('contradictory arrangements are not silently averaged into an accepted flat EQ', () => {
  const baseline = [{ id: 'existing', frequency: 100, gain: -2, q: .7 }];
  const round = new GuidedEQRound(options({ baseline }));
  round.choose(0, { x: .5, y: 0 }); round.choose(1, { x: .5, y: 1 });
  const result = round.resolve();
  assert.equal(result.status, 'recheck'); assert.equal(result.reason, 'disagreement');
  assert.deepEqual(result.bands, baseline); assert.ok(result.disagreementDb > 1);
});

test('response consensus is order independent and choice edits replace the old response', () => {
  const left = new GuidedEQRound(options()), right = new GuidedEQRound(options());
  const a = { x: .48, y: .25 }, b = { x: .52, y: .25 };
  left.choose(0, { x: 0, y: 1 }); left.choose(0, a); left.choose(1, b);
  right.choose(1, a); right.choose(0, b);
  a.x = 0;
  const x = left.resolve(), y = right.resolve();
  assert.equal(x.status, 'candidate');
  x.targetDeltaDb.forEach((v, i) => close(v, y.targetDeltaDb[i]));
  close(x.fitErrorDb, y.fitErrorDb, .005);
});

test('reject invalid inputs and clamp finite pointer overshoot', () => {
  assert.throws(() => new GuidedEQRound(options({ sampleRate: NaN })), /sample rate/);
  assert.throws(() => new GuidedEQRound(options({ stimulusRanges: [] })), /stimulus/);
  assert.throws(() => new GuidedEQRound(options({ maxDisagreementDb: -1 })), /threshold/);
  const round = new GuidedEQRound(options());
  assert.throws(() => round.preview({ x: NaN, y: .5 }), /coordinates/);
  assert.equal(round.preview({ x: -5, y: 10 })[0].gain, -6);
  assert.throws(() => round.choose(3, { x: .5, y: .5 }), /arrangement/);
});

const sessionSource = readFileSync(new URL('./guidedSession.ts', import.meta.url), 'utf8');
const sessionCompiled = ts.transpileModule(sessionSource, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText.replace("'./guidedEQ'", JSON.stringify(engineUrl));
const sessionUrl = 'data:text/javascript;base64,' + Buffer.from(sessionCompiled).toString('base64');
const { newSession, changeChoice, advanceSession, backSession, previewBands, retryPair, TOTAL_STEPS, EXPERIMENTS } = await import(sessionUrl);

test('two choices use one baseline; combined result is committed only after review', () => {
  let s = newSession(48000);
  const originalBaseline = s.records[0].baseline;
  s = changeChoice(s, { x: .5, y: .4 });
  assert.equal(s.records[0].baseline, originalBaseline, 'Dragging must not restart the audio configuration');
  assert.ok(previewBands(s)[0].gain > 1);
  s = advanceSession(s);
  assert.equal(previewBands(s)[0].gain, 0, 'Second arrangement starts independently');
  s = advanceSession(changeChoice(s, { x: .5, y: .4 }));
  assert.equal(s.step, 2); assert.equal(s.records[0].output, undefined);
  s = advanceSession(s); assert.equal(s.step, 3); assert.ok(s.records[1].baseline[0].gain > 1);
});

test('Back restores choices and editing an earlier pair invalidates downstream baselines', () => {
  let s = newSession(48000);
  s = advanceSession(changeChoice(s, { x: .5, y: .4 }));
  s = advanceSession(changeChoice(s, { x: .5, y: .4 }));
  s = advanceSession(s);
  s = backSession(backSession(s));
  assert.deepEqual(s.records[0].choices[1], { x: .5, y: .4 });
  s = changeChoice(s, { x: .5, y: .5 });
  assert.equal(s.records.length, 1); assert.equal(s.records[0].resolution, undefined);
  s = retryPair(s); assert.equal(s.step, 0); assert.equal(s.records[0].choices[0].y, .5);
});

test('full non-flat session reaches a finite, channel-aware curve within nine bands', () => {
  let s = newSession(44100);
  for (let i = 0; i < EXPERIMENTS.length; i++) {
    s = advanceSession(changeChoice(s, { x: .5, y: .45 }));
    s = advanceSession(changeChoice(s, { x: .5, y: .45 }));
    assert.equal(s.records[i].resolution.status, 'candidate');
    s = advanceSession(s);
  }
  assert.equal(s.step, TOTAL_STEPS);
  const result = previewBands(s); assert.ok(result.length <= 9);
  assert.ok(result.some(b => b.channel === 'left')); assert.ok(result.some(b => b.channel === 'right'));
  assert.ok(result.every(b => Number.isFinite(b.q) && Number.isFinite(b.gain)));
  assert.deepEqual(previewBands(advanceSession(backSession(s))), result);
});

test('keeping previous and conflicting choices never commit an unwanted correction', () => {
  let s = newSession(48000);
  s = advanceSession(changeChoice(s, { x: .5, y: 0 }));
  s = advanceSession(changeChoice(s, { x: .5, y: 1 }));
  assert.equal(s.records[0].resolution.status, 'recheck');
  s = advanceSession(s); assert.deepEqual(s.records[1].baseline, []);
  s = advanceSession(changeChoice(s, { x: .5, y: .4 }));
  s = advanceSession(changeChoice(s, { x: .5, y: .4 }));
  s = advanceSession(s, true); assert.deepEqual(s.records[2].baseline, []);
});

test('audio graph applies both/ear EQ, cancels scheduled hits on pause, and closes cleanly', async () => {
  const nodes = [];
  const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; }, setTargetAtTime(v, t) { this.events.push(['target', v, t]); this.value = v; }, linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); }, exponentialRampToValueAtTime(v, t) { this.events.push(['exponential', v, t]); }, cancelScheduledValues(t) { this.events.push(['cancel', t]); } });
  const node = kind => { const n = { kind, connections: [], gain: param(), frequency: param(), Q: param(), pan: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect(...to) { this.connections.push(to); }, start() {}, stop() { this.stopped = true; } }; nodes.push(n); return n; };
  class FakeContext {
    sampleRate = 48000; currentTime = 0; destination = node('destination'); closed = false;
    createGain() { return node('gain'); } createChannelSplitter() { return node('splitter'); } createChannelMerger() { return node('merger'); } createBiquadFilter() { return node('filter'); } createDynamicsCompressor() { return node('limiter'); } createBufferSource() { return node('source'); } createStereoPanner() { return node('pan'); }
    createBuffer(_, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    async resume() {} async close() { this.closed = true; }
  }
  const original = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  let tick;
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => { tick = undefined; };
  let player;
  try {
    const audioSource = readFileSync(new URL('../audio/guidedCalibrationPlayer.ts', import.meta.url), 'utf8');
    const js = ts.transpileModule(audioSource, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText.replace("'../calibration/guidedSession'", JSON.stringify(sessionUrl));
    const { GuidedCalibrationPlayer } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    player = new GuidedCalibrationPlayer();
    player.configure(EXPERIMENTS[0], 0, 0);
    player.setBands([{ ...band(3), channel: 'left' }]);
    const filters = nodes.filter(n => n.kind === 'filter');
    assert.equal(filters[0].gain.value, 3); assert.equal(filters[9].gain.value, 0);
    await player.play(); assert.equal(player.playing, true);
    player.context.currentTime = .07; assert.equal(player.pulse().dot, 0);
    player.context.currentTime = .2; tick();
    const envelopes = nodes.filter(n => n.kind === 'gain' && n.gain.events.some(e => e[0] === 'linear'));
    const attack = envelope => envelope.gain.events.filter(e => e[0] === 'linear').at(-1)[2];
    assert.equal(envelopes.length, 2);
    assert.ok(Math.abs(attack(envelopes[1]) - attack(envelopes[0]) - .24) < 1e-9, 'Default hits are 240 ms apart');
    const release = envelopes[0].gain.events.filter(e => e[0] === 'set' && e[1] === 0).at(-1)[2];
    assert.ok(release < .3, 'Each hit finishes before the next dot');
    player.setSpeed(6); assert.equal(player.playing, true);
    assert.ok(envelopes.every(n => n.gain.events.some(e => e[0] === 'cancel' && e[1] === .2)), 'Speed change cancels old hits');
    assert.equal(filters[0].gain.value, 3, 'Speed leaves EQ intact');
    assert.equal(envelopes[0].gain.events.filter(e => e[0] === 'linear').at(-1)[1], 1);
    player.context.currentTime = .25; tick();
    assert.ok(Math.abs(attack(envelopes[1]) - attack(envelopes[0]) - .12) < 1e-9, 'Live speed change uses 120 ms spacing');
    player.pause(); player.setSpeed(1); assert.equal(tick, undefined, 'Adjusting speed while paused stays paused');
    assert.equal(player.playing, false); assert.equal(player.pulse().dot, -1);
    player.setSpeed(3); player.configure(EXPERIMENTS[1], 1, 1);
    await player.play();
    const firstHit = player.context.currentTime + .06;
    for (let hit = 0; hit < 9; hit++) {
      const time = firstHit + hit * .24;
      player.context.currentTime = time - .01; tick();
      player.context.currentTime = time + .001;
      const expectedArrangement = (1 + Math.floor(hit / 4)) % 2;
      const pulse = player.pulse();
      assert.equal(pulse.arrangement, expectedArrangement, `Hit ${hit + 1} uses the correct depth assignment`);
      assert.equal(pulse.dot, hit % 2);
      const expectedDb = (expectedArrangement ? 1 - hit % 2 : hit % 2) === 0 ? 0 : -9;
      const actualGain = envelopes[hit % 2].gain.events.filter(e => e[0] === 'linear').at(-1)[1];
      assert.ok(Math.abs(actualGain - 10 ** (expectedDb / 20)) < 1e-9, 'Visual depth agrees with scheduled audio gain');
    }
    assert.equal(filters[0].gain.value, 3, 'Alternating depths preserves the selected EQ');
    player.pause();
    assert.ok(nodes.some(n => n.kind === 'gain' && n.gain.events.some(e => e[0] === 'cancel')));
    await player.dispose(); assert.equal(player.context.closed, true);
    assert.ok(nodes.filter(n => n.kind === 'source').every(n => n.stopped));
  } finally { await player?.dispose(); globalThis.AudioContext = original; globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval; }
});
