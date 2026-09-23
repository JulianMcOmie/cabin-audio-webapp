import type { EQBand } from '../models/EQBand';
import { stimulusRange, depthLevels, type Experiment } from '../calibration/guidedSession';

/** Isolated audition graph: never routes through or edits the user's active EQ. */
export class GuidedCalibrationPlayer {
  readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly voices: { source: AudioBufferSourceNode; hp: BiquadFilterNode[]; lp: BiquadFilterNode[]; envelope: GainNode; pan: StereoPannerNode }[] = [];
  private readonly filters: BiquadFilterNode[][];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private nextDot = 0;
  private hitCount = 0;
  private initialArrangement = 0;
  private audibleArrangement = 0;
  private levels: [number, number] = [0, -18];
  private events: { time: number; dot: number; arrangement: number }[] = [];
  private volume = .32;
  private speed = 3;
  private trimDb = -12;
  private closed = false;

  constructor(sampleRate?: number) {
    this.context = new AudioContext(sampleRate ? { sampleRate } : undefined);
    const ctx = this.context, mix = ctx.createGain(), splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2);
    mix.connect(splitter);
    // Nine stable slots per ear: both/left/right × broad/upper/lower.
    this.filters = [0, 1].map(ear => {
      const chain = Array.from({ length: 9 }, () => { const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = 1000; f.Q.value = 1; f.gain.value = 0; return f; });
      splitter.connect(chain[0], ear);
      chain.forEach((f, i) => i < chain.length - 1 ? f.connect(chain[i + 1]) : f.connect(merger, 0, ear));
      return chain;
    });
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .12;
    merger.connect(this.master); this.master.connect(limiter); limiter.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), data = noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) { const white = Math.random() * 2 - 1; b0 = .99765 * b0 + white * .099046; b1 = .963 * b1 + white * .2965164; b2 = .57 * b2 + white * 1.0526913; data[i] = (b0 + b1 + b2 + white * .1848) * .08; }
    for (let dot = 0; dot < 2; dot++) {
      const source = ctx.createBufferSource(); source.buffer = noise; source.loop = true;
      const edges = (type: BiquadFilterType) => Array.from({ length: 4 }, () => { const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = Math.SQRT1_2; return f; });
      const hp = edges('highpass'), lp = edges('lowpass'), envelope = ctx.createGain(), pan = ctx.createStereoPanner();
      envelope.gain.value = 0;
      const chain: AudioNode[] = [source, ...hp, ...lp, envelope, pan, mix];
      chain.slice(0, -1).forEach((n, i) => n.connect(chain[i + 1])); source.start();
      this.voices.push({ source, hp, lp, envelope, pan });
    }
  }
  get playing() { return this.timer !== null; }
  private outputGain() { this.master.gain.setTargetAtTime(this.volume * 10 ** (this.trimDb / 20), this.context.currentTime, .035); }
  setVolume(volume: number) { this.volume = Math.max(0, Math.min(1, volume)); this.outputGain(); }
  /** Multiplier relative to the original 720 ms cadence. */
  setSpeed(speed: number) {
    if (!Number.isFinite(speed)) return;
    const next = Math.max(1, Math.min(6, speed));
    if (next === this.speed) return;
    const running = this.playing;
    this.pause(); this.speed = next;
    if (running) this.scheduleStart();
  }
  /** Fixed conservative headroom throughout both choices and their review. */
  setHeadroom(baseline: EQBand[]) { this.trimDb = -6 - baseline.reduce((sum, b) => sum + Math.max(0, b.gain), 0); this.outputGain(); }
  setBands(bands: EQBand[]) {
    if (bands.length > 9) throw new Error('Calibration supports at most nine bands');
    this.filters.forEach((chain, ear) => chain.forEach((f, i) => {
      const b = bands[i], relevant = b && (!b.channel || b.channel === 'both' || b.channel === (ear === 0 ? 'left' : 'right'));
      f.frequency.setTargetAtTime(b?.frequency ?? 1000, this.context.currentTime, .035);
      f.Q.setTargetAtTime(b?.q ?? 1, this.context.currentTime, .035);
      f.gain.setTargetAtTime(relevant ? b.gain : 0, this.context.currentTime, .035);
    }));
  }
  configure(experiment: Experiment, index: number, arrangement: number) {
    const running = this.playing; this.pause();
    this.levels = depthLevels(index);
    this.initialArrangement = arrangement; this.audibleArrangement = arrangement;
    experiment.pair.forEach(([col, row], i) => {
      const [low, high] = stimulusRange(row, this.context.sampleRate), voice = this.voices[i];
      voice.hp.forEach(f => f.frequency.setValueAtTime(low, this.context.currentTime));
      voice.lp.forEach(f => f.frequency.setValueAtTime(high, this.context.currentTime));
      voice.pan.pan.setValueAtTime(-.9 + col * .6, this.context.currentTime);
    });
    if (running) this.scheduleStart();
  }
  async play() { if (this.closed) return; await this.context.resume(); if (!this.closed && !this.playing) this.scheduleStart(); }
  private scheduleStart() {
    this.nextTime = this.context.currentTime + .06; this.nextDot = 0; this.hitCount = 0; this.audibleArrangement = this.initialArrangement; this.events = [];
    const tick = () => {
      const now = this.context.currentTime;
      if (this.nextTime < now) this.nextTime = now + .03;
      while (this.nextTime < now + .15) {
        const dot = this.nextDot, gain = this.voices[dot].envelope.gain, time = this.nextTime, duration = 1 / this.speed;
        const arrangement = (this.initialArrangement + Math.floor(this.hitCount / 4)) % 2;
        const level = this.levels[arrangement ? 1 - dot : dot];
        gain.setValueAtTime(0, time); gain.linearRampToValueAtTime(10 ** (level / 20), time + .012 * duration); gain.setValueAtTime(10 ** (level / 20), time + .12 * duration); gain.exponentialRampToValueAtTime(.0001, time + .5 * duration); gain.setValueAtTime(0, time + .53 * duration);
        this.events.push({ time, dot, arrangement }); this.events = this.events.filter(e => e.time > now - 2);
        this.hitCount++; this.nextDot = 1 - dot; this.nextTime += .72 / this.speed;
      }
    };
    this.timer = setInterval(tick, 30); tick();
  }
  pulse() {
    if (!this.playing) return { dot: -1, strength: 0, arrangement: this.audibleArrangement };
    const now = this.context.currentTime, event = [...this.events].reverse().find(e => e.time <= now);
    if (event) this.audibleArrangement = event.arrangement;
    return event ? { arrangement: event.arrangement, dot: event.dot, strength: Math.exp(-(now - event.time) * 7 * this.speed) } : { dot: -1, strength: 0, arrangement: this.audibleArrangement };
  }
  pause() { if (this.timer) clearInterval(this.timer); this.timer = null; this.events = []; this.voices.forEach(v => { v.envelope.gain.cancelScheduledValues(this.context.currentTime); v.envelope.gain.setTargetAtTime(0, this.context.currentTime, .01); }); }
  async dispose() { if (this.closed) return; this.closed = true; this.pause(); this.voices.forEach(v => v.source.stop()); await this.context.close(); }
}
