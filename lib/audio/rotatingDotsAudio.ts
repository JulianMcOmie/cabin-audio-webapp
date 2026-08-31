import { getAudioContext } from './audioContext';
import * as eqProcessor from './eqProcessor';
import {
  BandpassedNoiseGenerator,
  getBandpassRangeForNormalizedY,
  type BandpassRange,
} from './dotGridAudio';

// Two dots orbit the center of the soundstage on a circle tilted into
// depth. Each dot repeatedly fires a wide bandpassed-noise hit (the app's
// standard band-noise voice); the two dots' hits are staggered against
// each other. Position maps to sound:
//   height (projected y)  -> bandpass shift (wide band, sharp edges)
//   projected x           -> stereo pan
//   depth (distance away) -> volume (near = loud, far = quiet)

export const DOT_COUNT = 2;

export const DEFAULT_BANDWIDTH_OCTAVES = 5;
export const MIN_BANDWIDTH_OCTAVES = 1;
export const MAX_BANDWIDTH_OCTAVES = 9;

export const DEFAULT_HIT_RATE_HZ = 8; // hits per second, per dot
export const MIN_HIT_RATE_HZ = 0.25;
export const MAX_HIT_RATE_HZ = 16;

export const DEFAULT_ROTATION_RATE_HZ = 0.1; // revolutions per second
export const MIN_ROTATION_RATE_HZ = 0.005;
export const MAX_ROTATION_RATE_HZ = 2;

export const DEFAULT_RADIUS = 0.4; // normalized; stage is [0,1] x [0,1]
export const MIN_RADIUS = 0.05;
export const MAX_RADIUS = 0.5;

export const DEFAULT_ORBIT_CENTER_X = 0.5;
export const DEFAULT_ORBIT_CENTER_Y = 0.5;
const MIN_ORBIT_CENTER = 0.05;
const MAX_ORBIT_CENTER = 0.95;

// Only the first dot sounds by default; the second is there to unmute.
export const DEFAULT_MUTED_DOTS: readonly boolean[] = [false, true];

// Tilt of the orbit plane about the vertical axis. 0 = flat circle facing
// the listener (no depth); higher tilts swing the dots toward and away
// from the listener while keeping the full height sweep for the bandpass
// shift.
export const DEFAULT_TILT_DEGREES = 55;
export const MIN_TILT_DEGREES = 0;
export const MAX_TILT_DEGREES = 85;

export const DEFAULT_VOLUME_DEPTH_DB = 30; // attenuation at the far point
export const MIN_VOLUME_DEPTH_DB = 0;
export const MAX_VOLUME_DEPTH_DB = 60;

export const DEFAULT_STAGGER_PERCENT = 100; // 100 = dots evenly interleaved
export const DEFAULT_HIT_RELEASE_S = 0.6;
export const MIN_HIT_RELEASE_S = 0.03;
export const MAX_HIT_RELEASE_S = 3;

export type EdgeSlope = 12 | 24 | 48; // dB/octave per band edge
export const DEFAULT_EDGE_SLOPE: EdgeSlope = 48;

// Perspective camera distance from the orbit center, in normalized stage
// units. Shared with the view so audio and visuals project identically.
export const CAMERA_DISTANCE = 1.6;

const HIT_ATTACK_S = 0.008;
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0;
const EXTRA_EDGE_STAGES = 3; // beyond the generator's own edges: up to 48 dB/oct
const EXTRA_EDGE_Q = 0.707;
const HIGHPASS_PARK_HZ = 8; // effectively passthrough for inactive stages
const LOWPASS_PARK_HZ = 20000;
// Makeup gain over the BandpassedNoiseGenerator's internal 0.25 scalar so
// the hits sit at a solid base level before the user volume slider.
const BASE_BOOST_DB = 12;
const SCHEDULER_TICK_MS = 60;
const SCHEDULER_LOOKAHEAD_S = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

// Same loudness compensation the other band-shaped hit players use.
function loudnessCompensationDb(centerFrequency: number): number {
  if (centerFrequency < 1000) return Math.log2(1000 / centerFrequency) * 3;
  if (centerFrequency > 4000) return Math.log2(centerFrequency / 4000) * 2;
  return 0;
}

export interface DotSpatialState {
  // Projected, normalized stage coordinates (y up), used for audio AND display
  x: number;
  y: number;
  // Perspective scale: >1 near the listener, <1 far away
  scale: number;
  // 0 = nearest point of the orbit, 1 = farthest
  depthNorm: number;
}

export interface DotVisualState extends DotSpatialState {
  gainDb: number;
  band: BandpassRange;
  muted: boolean;
  // 0 right at a hit, rises toward 1 as the hit fades; >=1 when idle
  hitAge: number;
}

interface DotNodes {
  generator: BandpassedNoiseGenerator;
  extraHighpass: BiquadFilterNode[];
  extraLowpass: BiquadFilterNode[];
  envelopeGain: GainNode;
  volumeGain: GainNode;
  muteGain: GainNode;
  panner: StereoPannerNode;
  nextHitTime: number;
  lastHitTime: number;
}

class RotatingDotsPlayer {
  private ctx: AudioContext;
  private masterGain: GainNode | null = null;
  private dots: DotNodes[] = [];
  private schedulerId: number | null = null;
  private playing = false;

  // Rotation phase is tracked incrementally so rate changes do not jump.
  private basePhase = 0;
  private basePhaseTime = 0;

  private rotationRateHz = DEFAULT_ROTATION_RATE_HZ;
  private radius = DEFAULT_RADIUS;
  private tiltDegrees = DEFAULT_TILT_DEGREES;
  private hitRateHz = DEFAULT_HIT_RATE_HZ;
  private staggerPercent = DEFAULT_STAGGER_PERCENT;
  private bandwidthOctaves = DEFAULT_BANDWIDTH_OCTAVES;
  private volumeDepthDb = DEFAULT_VOLUME_DEPTH_DB;
  private hitReleaseS = DEFAULT_HIT_RELEASE_S;
  private edgeSlope: EdgeSlope = DEFAULT_EDGE_SLOPE;
  private volumeDb = 0;
  private mutedDots: boolean[] = [...DEFAULT_MUTED_DOTS];
  private centerX = DEFAULT_ORBIT_CENTER_X;
  private centerY = DEFAULT_ORBIT_CENTER_Y;

  constructor() {
    this.ctx = getAudioContext();
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public setRotationRateHz(rate: number): void {
    const next = clamp(rate, MIN_ROTATION_RATE_HZ, MAX_ROTATION_RATE_HZ);
    const now = this.ctx.currentTime;
    this.basePhase = this.getPhaseAtTime(now);
    this.basePhaseTime = now;
    this.rotationRateHz = next;
  }

  public setRadius(radius: number): void {
    this.radius = clamp(radius, MIN_RADIUS, MAX_RADIUS);
  }

  public setOrbitCenter(x: number, y: number): void {
    this.centerX = clamp(x, MIN_ORBIT_CENTER, MAX_ORBIT_CENTER);
    this.centerY = clamp(y, MIN_ORBIT_CENTER, MAX_ORBIT_CENTER);
  }

  public setTiltDegrees(degrees: number): void {
    this.tiltDegrees = clamp(degrees, MIN_TILT_DEGREES, MAX_TILT_DEGREES);
  }

  public setHitRateHz(rate: number): void {
    this.hitRateHz = clamp(rate, MIN_HIT_RATE_HZ, MAX_HIT_RATE_HZ);
  }

  public setStaggerPercent(percent: number): void {
    this.staggerPercent = clamp(percent, 0, 100);
  }

  public setBandwidthOctaves(octaves: number): void {
    this.bandwidthOctaves = clamp(octaves, MIN_BANDWIDTH_OCTAVES, MAX_BANDWIDTH_OCTAVES);
    this.dots.forEach((dot) => dot.generator.setBandpassBandwidth(this.bandwidthOctaves));
  }

  public setVolumeDepthDb(db: number): void {
    this.volumeDepthDb = clamp(db, MIN_VOLUME_DEPTH_DB, MAX_VOLUME_DEPTH_DB);
  }

  public setHitReleaseS(seconds: number): void {
    this.hitReleaseS = clamp(seconds, MIN_HIT_RELEASE_S, MAX_HIT_RELEASE_S);
  }

  public setEdgeSlope(slope: EdgeSlope): void {
    this.edgeSlope = slope;
  }

  public setVolumeDb(db: number): void {
    this.volumeDb = clamp(db, -60, 12);
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        dbToGain(this.volumeDb + BASE_BOOST_DB),
        this.ctx.currentTime,
        0.02
      );
    }
  }

  public setDotMuted(index: number, muted: boolean): void {
    if (index < 0 || index >= DOT_COUNT) return;
    this.mutedDots[index] = muted;
    const dot = this.dots[index];
    if (dot) {
      dot.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  public isDotMuted(index: number): boolean {
    return this.mutedDots[index] ?? false;
  }

  private getPhaseAtTime(time: number): number {
    return this.basePhase + 2 * Math.PI * this.rotationRateHz * (time - this.basePhaseTime);
  }

  // 3D position of dot `index` at audio-clock `time`, projected with the
  // same perspective the view uses. The orbit plane is tilted about the
  // vertical axis: x is foreshortened into depth z while the height sweep
  // stays full-range. z > 0 = away from the listener.
  private getDotSpatialState(index: number, time: number): DotSpatialState {
    const theta = this.getPhaseAtTime(time) + (index * 2 * Math.PI) / DOT_COUNT;
    const tiltRad = (this.tiltDegrees * Math.PI) / 180;
    const px = this.radius * Math.cos(theta) * Math.cos(tiltRad);
    const py = this.radius * Math.sin(theta);
    const pz = this.radius * Math.cos(theta) * Math.sin(tiltRad);
    const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE + pz);
    return {
      x: this.centerX + px * scale,
      y: this.centerY + py * scale,
      scale,
      // 0 at the orbit's nearest point, up to sin(tilt) at its farthest —
      // a face-on circle (tilt 0) has no depth, so no attenuation.
      depthNorm: (Math.sin(tiltRad) * (Math.cos(theta) + 1)) / 2,
    };
  }

  private getGainDbForDepth(depthNorm: number): number {
    return -this.volumeDepthDb * clamp(depthNorm, 0, 1);
  }

  public getBandForY(y: number): BandpassRange {
    return getBandpassRangeForNormalizedY(clamp(y, 0, 1), this.bandwidthOctaves);
  }

  public getDotVisualStates(): DotVisualState[] {
    const now = this.ctx.currentTime;
    const states: DotVisualState[] = [];
    for (let index = 0; index < DOT_COUNT; index++) {
      const spatial = this.getDotSpatialState(index, now);
      const lastHitTime = this.dots[index]?.lastHitTime ?? -Infinity;
      const hitSpan = HIT_ATTACK_S + this.hitReleaseS * 3;
      states.push({
        ...spatial,
        gainDb: this.getGainDbForDepth(spatial.depthNorm),
        band: this.getBandForY(spatial.y),
        muted: this.mutedDots[index] ?? false,
        hitAge: now >= lastHitTime ? (now - lastHitTime) / hitSpan : 1,
      });
    }
    return states;
  }

  // Sampled orbit path (projected), for the view to draw with depth cues.
  public getOrbitPath(samples: number): DotSpatialState[] {
    const path: DotSpatialState[] = [];
    const tiltRad = (this.tiltDegrees * Math.PI) / 180;
    for (let i = 0; i <= samples; i++) {
      const theta = (i / samples) * 2 * Math.PI;
      const px = this.radius * Math.cos(theta) * Math.cos(tiltRad);
      const py = this.radius * Math.sin(theta);
      const pz = this.radius * Math.cos(theta) * Math.sin(tiltRad);
      const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE + pz);
      path.push({
        x: this.centerX + px * scale,
        y: this.centerY + py * scale,
        scale,
        depthNorm: (Math.sin(tiltRad) * (Math.cos(theta) + 1)) / 2,
      });
    }
    return path;
  }

  public start(): void {
    if (this.playing) return;
    this.playing = true;

    const now = this.ctx.currentTime;
    this.basePhase = 0;
    this.basePhaseTime = now;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = dbToGain(this.volumeDb + BASE_BOOST_DB);
    this.masterGain.connect(eqProcessor.getEQProcessor().getInputNode());

    const hitInterval = 1 / this.hitRateHz;
    this.dots = [];
    for (let index = 0; index < DOT_COUNT; index++) {
      // The app's standard wide band-noise voice: internal per-band noise
      // sources shaped by the 20-band sloped generator, cut by sharp
      // highpass/lowpass edges.
      const generator = new BandpassedNoiseGenerator(this.ctx);
      generator.setBandpassBandwidth(this.bandwidthOctaves);
      generator.setInputSlope(PINK_NOISE_SLOPE_DB_PER_OCT);
      generator.setIndependentBandNoiseEnabled(true);

      // Optional extra edge stages for sharper-than-stock band edges.
      const extraHighpass: BiquadFilterNode[] = [];
      const extraLowpass: BiquadFilterNode[] = [];
      let tail: AudioNode = generator.getOutputNode();
      for (let stage = 0; stage < EXTRA_EDGE_STAGES; stage++) {
        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.Q.value = EXTRA_EDGE_Q;
        highpass.frequency.value = HIGHPASS_PARK_HZ;
        tail.connect(highpass);
        tail = highpass;
        extraHighpass.push(highpass);

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.Q.value = EXTRA_EDGE_Q;
        lowpass.frequency.value = LOWPASS_PARK_HZ;
        tail.connect(lowpass);
        tail = lowpass;
        extraLowpass.push(lowpass);
      }

      const envelopeGain = this.ctx.createGain();
      envelopeGain.gain.value = 0;
      const volumeGain = this.ctx.createGain();
      const muteGain = this.ctx.createGain();
      muteGain.gain.value = this.mutedDots[index] ? 0 : 1;
      const panner = this.ctx.createStereoPanner();

      tail.connect(envelopeGain);
      envelopeGain.connect(volumeGain);
      volumeGain.connect(muteGain);
      muteGain.connect(panner);
      panner.connect(this.masterGain);

      const staggerOffset =
        (index * (this.staggerPercent / 100) * hitInterval) / DOT_COUNT;
      this.dots.push({
        generator,
        extraHighpass,
        extraLowpass,
        envelopeGain,
        volumeGain,
        muteGain,
        panner,
        nextHitTime: now + 0.05 + staggerOffset,
        lastHitTime: -Infinity,
      });
    }

    this.schedulerTick();
    this.schedulerId = window.setInterval(() => this.schedulerTick(), SCHEDULER_TICK_MS);
  }

  public stop(): void {
    if (!this.playing) return;
    this.playing = false;

    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }

    const now = this.ctx.currentTime;
    const master = this.masterGain;
    const dots = this.dots;
    this.masterGain = null;
    this.dots = [];

    if (master) {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.03);
    }
    window.setTimeout(() => {
      dots.forEach((dot) => {
        dot.generator.setIndependentBandNoiseEnabled(false);
        dot.generator.getOutputNode().disconnect();
        dot.extraHighpass.forEach((filter) => filter.disconnect());
        dot.extraLowpass.forEach((filter) => filter.disconnect());
        dot.envelopeGain.disconnect();
        dot.volumeGain.disconnect();
        dot.muteGain.disconnect();
        dot.panner.disconnect();
      });
      master?.disconnect();
    }, 60);
  }

  private schedulerTick(): void {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const horizon = now + SCHEDULER_LOOKAHEAD_S;
    const hitInterval = 1 / this.hitRateHz;

    this.dots.forEach((dot, index) => {
      if (dot.nextHitTime < now - hitInterval) {
        // Fell badly behind (tab was backgrounded); resync to the grid.
        const staggerOffset =
          (index * (this.staggerPercent / 100) * hitInterval) / DOT_COUNT;
        dot.nextHitTime =
          now + hitInterval - ((now - staggerOffset) % hitInterval);
      }
      while (dot.nextHitTime < horizon) {
        this.scheduleHit(dot, index, dot.nextHitTime);
        dot.nextHitTime += hitInterval;
      }
    });
  }

  private scheduleHit(dot: DotNodes, index: number, time: number): void {
    const spatial = this.getDotSpatialState(index, time);
    const band = this.getBandForY(spatial.y);

    dot.generator.scheduleBandpassFrequencyAndBandwidth(
      band.centerFrequency,
      this.bandwidthOctaves,
      time
    );

    const activeExtraStages = Math.max(0, Math.round(this.edgeSlope / 12) - 1);
    dot.extraHighpass.forEach((filter, stage) => {
      const target = stage < activeExtraStages ? band.lowerEdge : HIGHPASS_PARK_HZ;
      filter.frequency.setValueAtTime(clamp(target, HIGHPASS_PARK_HZ, LOWPASS_PARK_HZ), time);
    });
    dot.extraLowpass.forEach((filter, stage) => {
      const target = stage < activeExtraStages ? band.upperEdge : LOWPASS_PARK_HZ;
      filter.frequency.setValueAtTime(clamp(target, HIGHPASS_PARK_HZ, LOWPASS_PARK_HZ), time);
    });

    dot.panner.pan.setValueAtTime(clamp(2 * spatial.x - 1, -1, 1), time);
    dot.volumeGain.gain.setValueAtTime(
      dbToGain(
        this.getGainDbForDepth(spatial.depthNorm) +
          loudnessCompensationDb(band.centerFrequency)
      ),
      time
    );

    // Long releases may overlap the next hit; retrigger from the envelope's
    // current level (no snap to zero) so overlapping hits don't click.
    const envelope = dot.envelopeGain.gain;
    if (typeof envelope.cancelAndHoldAtTime === 'function') {
      envelope.cancelAndHoldAtTime(time);
    } else {
      envelope.cancelScheduledValues(time);
      envelope.setValueAtTime(0, time);
    }
    envelope.linearRampToValueAtTime(1, time + HIT_ATTACK_S);
    envelope.setTargetAtTime(0, time + HIT_ATTACK_S, this.hitReleaseS / 3);

    dot.lastHitTime = time;
  }
}

let playerInstance: RotatingDotsPlayer | null = null;

export function getRotatingDotsPlayer(): RotatingDotsPlayer {
  if (!playerInstance) {
    playerInstance = new RotatingDotsPlayer();
  }
  return playerInstance;
}
