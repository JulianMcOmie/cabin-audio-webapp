import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores';

// Constants for Sloped Pink Noise (adapted from dotGridAudio.ts)
const SLOPE_REF_FREQUENCY = 800; // Hz, reference frequency for slope calculations
const MIN_AUDIBLE_FREQ = 20; // Hz
const MAX_AUDIBLE_FREQ = 20000; // Hz
const PINK_NOISE_SLOPE_DB_PER_OCT = -3.0; // Inherent slope of pink noise
const TARGET_SLOPE_DB_PER_OCT = -4.5; // Fixed slope for Timbre Tool
const SLOPED_NOISE_OUTPUT_GAIN_SCALAR = 3.0; // Scalar for output of SlopedPinkNoiseGenerator - Increased from 0.25
const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

// Envelope for alternating sounds
const ALTERNATE_ATTACK_S = 0.01;
const ALTERNATE_RELEASE_S = 0.01;
const ALTERNATE_INTERVAL_S = 0.5; // Time each sound plays before switching

interface TimbreSoundNodes {
    pinkNoiseSource: AudioBufferSourceNode;
    slopedNoiseGenerator: SlopedPinkNoiseGenerator;
    bandpassFilter: BiquadFilterNode;
    gainNode: GainNode;
}

class SlopedPinkNoiseGenerator {
    private ctx: AudioContext;
    private inputGainNode: GainNode;
    private outputGainNode: GainNode;
    private bandFilters: BiquadFilterNode[] = [];
    private bandGains: GainNode[] = [];
    private centerFrequencies: number[] = [];
    private static readonly NUM_BANDS = 20; // From dotGridAudio

    constructor(audioCtx: AudioContext) {
        this.ctx = audioCtx;
        this.inputGainNode = this.ctx.createGain();
        this.outputGainNode = this.ctx.createGain();
        this.outputGainNode.gain.value = SLOPED_NOISE_OUTPUT_GAIN_SCALAR;

        const logMinFreq = Math.log2(MIN_AUDIBLE_FREQ);
        const logMaxFreq = Math.log2(MAX_AUDIBLE_FREQ);
        const step = (logMaxFreq - logMinFreq) / (SlopedPinkNoiseGenerator.NUM_BANDS + 1);
        const filterQ = 1.0 / Math.sqrt(2); // Butterworth-like for HP/LP in original

        for (let i = 0; i < SlopedPinkNoiseGenerator.NUM_BANDS; i++) {
            const centerFreq = Math.pow(2, logMinFreq + (i + 1) * step);
            this.centerFrequencies.push(centerFreq);

            const lowerCutoff = Math.pow(2, logMinFreq + (i + 0.5) * step);
            const upperCutoff = Math.pow(2, logMinFreq + (i + 1 + 0.5) * step);

            const hpFilter = this.ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.value = lowerCutoff;
            hpFilter.Q.value = filterQ;
            this.bandFilters.push(hpFilter);

            const lpFilter = this.ctx.createBiquadFilter();
            lpFilter.type = 'lowpass';
            lpFilter.frequency.value = upperCutoff;
            lpFilter.Q.value = filterQ;
            this.bandFilters.push(lpFilter);

            const gainNode = this.ctx.createGain();
            this.bandGains.push(gainNode);

            this.inputGainNode.connect(hpFilter);
            hpFilter.connect(lpFilter);
            lpFilter.connect(gainNode);
            gainNode.connect(this.outputGainNode);
        }
        this.setSlope(TARGET_SLOPE_DB_PER_OCT); // Set the fixed slope
    }

    public getInputNode(): GainNode {
        return this.inputGainNode;
    }

    public getOutputNode(): GainNode {
        return this.outputGainNode;
    }

    public setSlope(targetOverallSlopeDbPerOctave: number): void {
        const shapingSlope = targetOverallSlopeDbPerOctave - PINK_NOISE_SLOPE_DB_PER_OCT;
        for (let i = 0; i < SlopedPinkNoiseGenerator.NUM_BANDS; i++) {
            const fc = this.centerFrequencies[i];
            const gainDb = shapingSlope * Math.log2(fc / SLOPE_REF_FREQUENCY);
            const linearGain = Math.pow(10, gainDb / 20);
            this.bandGains[i].gain.value = linearGain;
        }
    }

    public dispose(): void {
        this.inputGainNode.disconnect();
        this.outputGainNode.disconnect();
        this.bandFilters.forEach(filter => filter.disconnect());
        this.bandGains.forEach(gain => gain.disconnect());
    }
}

export class TimbreToolAudioPlayer {
    private static instance: TimbreToolAudioPlayer;
    private ctx: AudioContext;
    private isPlaying: boolean = false;
    private panner: StereoPannerNode;
    private outputGain: GainNode; // Overall output gain for this player
    private preEQAnalyser: AnalyserNode | null = null;
    private preEQGain: GainNode | null = null; // Connects panner to EQ/Analyzer

    private sound1: TimbreSoundNodes | null = null;
    private sound2: TimbreSoundNodes | null = null;

    private currentSoundIndex: number = 0; // 0 for sound1, 1 for sound2
    private alternatingTimerId: number | null = null;

    private pinkNoiseBuffer: AudioBuffer | null = null;

    private constructor() {
        this.ctx = audioContext.getAudioContext();
        this.panner = this.ctx.createStereoPanner();
        this.outputGain = this.ctx.createGain();
        this.outputGain.gain.value = 1.0; // Master volume for this tool's output

        this.panner.connect(this.outputGain);
        // Output gain will connect to preEQGain later

        const initialDistortionGain = useEQProfileStore.getState().distortionGain;
        this.setDistortionGain(initialDistortionGain); // Initial distortion setting

        useEQProfileStore.subscribe(
            (state) => {
                this.setDistortionGain(state.distortionGain);
            }
        );
        this._generatePinkNoiseBuffer();
    }

    public static getInstance(): TimbreToolAudioPlayer {
        if (!TimbreToolAudioPlayer.instance) {
            TimbreToolAudioPlayer.instance = new TimbreToolAudioPlayer();
        }
        return TimbreToolAudioPlayer.instance;
    }

    private _generatePinkNoiseBuffer(): void {
        const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            b6 = white * 0.5362;
            data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.11) * 0.11;
        }

        let peak = 0;
        for (let i = 0; i < bufferSize; i++) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
        }
        const normalizationFactor = peak > 0.8 ? 0.8 / peak : 1.0;
        for (let i = 0; i < bufferSize; i++) {
            data[i] *= normalizationFactor;
        }
        this.pinkNoiseBuffer = buffer;
    }

    private _createSoundNodes(centerFreq: number, qValue: number): TimbreSoundNodes {
        if (!this.pinkNoiseBuffer) {
            this._generatePinkNoiseBuffer(); // Should have been called in constructor
            if (!this.pinkNoiseBuffer) throw new Error("Failed to generate pink noise buffer");
        }

        const pinkNoiseSource = this.ctx.createBufferSource();
        pinkNoiseSource.buffer = this.pinkNoiseBuffer;
        pinkNoiseSource.loop = true;

        const slopedNoiseGenerator = new SlopedPinkNoiseGenerator(this.ctx);
        // Slope is fixed, already set in SlopedPinkNoiseGenerator constructor

        const bandpassFilter = this.ctx.createBiquadFilter();
        bandpassFilter.type = 'bandpass';
        bandpassFilter.frequency.value = centerFreq;
        bandpassFilter.Q.value = qValue;

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 0; // Start silent

        // Connections: pinkNoiseSource -> slopedNoiseGenerator -> bandpassFilter -> gainNode -> panner
        pinkNoiseSource.connect(slopedNoiseGenerator.getInputNode());
        slopedNoiseGenerator.getOutputNode().connect(bandpassFilter);
        bandpassFilter.connect(gainNode);
        gainNode.connect(this.panner);

        pinkNoiseSource.start();

        return { pinkNoiseSource, slopedNoiseGenerator, bandpassFilter, gainNode };
    }

    public setFrequencies(freq1: number, q1: number, freq2: number, q2: number): void {
        this._cleanupSoundNodes(); // Clean up old nodes before creating new ones

        this.sound1 = this._createSoundNodes(freq1, q1);
        this.sound2 = this._createSoundNodes(freq2, q2);

        if (this.isPlaying) {
            this.stop(); // Stop current playback
            this.play(); // Restart with new frequencies
        }
    }

    public setPan(panValue: number): void {
        // Pan value should be between -1 (left) and 1 (right)
        this.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, panValue)), this.ctx.currentTime);
    }

    public play(): void {
        if (this.isPlaying || !this.sound1 || !this.sound2) return;
        this.isPlaying = true;
        this.currentSoundIndex = 0; // Start with sound1
        this._startAlternatingSounds();
    }

    public stop(): void {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        if (this.alternatingTimerId !== null) {
            clearTimeout(this.alternatingTimerId);
            this.alternatingTimerId = null;
        }
        // Fade out current sound quickly
        const currentSound = this.currentSoundIndex === 0 ? this.sound1 : this.sound2;
        if (currentSound) {
            currentSound.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
            currentSound.gainNode.gain.setValueAtTime(currentSound.gainNode.gain.value, this.ctx.currentTime);
            currentSound.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + ALTERNATE_RELEASE_S);
        }
    }

    private _startAlternatingSounds(): void {
        if (!this.isPlaying || !this.sound1 || !this.sound2) return;

        const soundToPlay = this.currentSoundIndex === 0 ? this.sound1 : this.sound2;
        const soundToSilence = this.currentSoundIndex === 0 ? this.sound2 : this.sound1;

        // Fade in the sound to play
        soundToPlay.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        soundToPlay.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        soundToPlay.gainNode.gain.linearRampToValueAtTime(1.0, this.ctx.currentTime + ALTERNATE_ATTACK_S);

        // Fade out the sound to silence (if it was playing)
        soundToSilence.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        soundToSilence.gainNode.gain.setValueAtTime(soundToSilence.gainNode.gain.value, this.ctx.currentTime);
        soundToSilence.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + ALTERNATE_RELEASE_S);
        
        // Switch to the other sound after the interval
        this.currentSoundIndex = 1 - this.currentSoundIndex;

        this.alternatingTimerId = window.setTimeout(() => {
            if (this.isPlaying) {
                this._startAlternatingSounds();
            }
        }, ALTERNATE_INTERVAL_S * 1000);
    }

    public createPreEQAnalyser(): AnalyserNode {
        if (!this.preEQAnalyser) {
            this.preEQGain = this.ctx.createGain();
            this.preEQGain.gain.value = 1.0;

            this.preEQAnalyser = this.ctx.createAnalyser();
            this.preEQAnalyser.fftSize = FFT_SIZE;
            this.preEQAnalyser.smoothingTimeConstant = SMOOTHING;

            this.outputGain.connect(this.preEQGain); // Connect main output to preEQGain
            this.preEQGain.connect(this.preEQAnalyser);
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        }
        return this.preEQAnalyser;
    }
    
    public getPreEQAnalyser(): AnalyserNode | null {
        return this.preEQAnalyser;
    }

    private setDistortionGain(gain: number): void {
        // Apply distortion gain by scaling the main output gain of this tool
        // This assumes distortionGain from store is 0-1 range for volume reduction
        this.outputGain.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), this.ctx.currentTime);
    }

    private _cleanupSoundNodes(): void {
        const sounds = [this.sound1, this.sound2];
        sounds.forEach(sound => {
            if (sound) {
                sound.pinkNoiseSource.stop();
                sound.pinkNoiseSource.disconnect();
                sound.slopedNoiseGenerator.dispose();
                sound.bandpassFilter.disconnect();
                sound.gainNode.disconnect();
            }
        });
        this.sound1 = null;
        this.sound2 = null;
    }

    public dispose(): void {
        this.stop();
        this._cleanupSoundNodes();

        if (this.panner) this.panner.disconnect();
        if (this.outputGain) this.outputGain.disconnect();
        if (this.preEQGain) this.preEQGain.disconnect();
        if (this.preEQAnalyser) this.preEQAnalyser.disconnect();

        this.pinkNoiseBuffer = null; // Allow GC
        // Potentially unsubscribe from store if needed, though instance is singleton
    }
}

export function getTimbreToolAudioPlayer(): TimbreToolAudioPlayer {
    return TimbreToolAudioPlayer.getInstance();
}

export function cleanupTimbreToolAudioPlayer(): void {
    TimbreToolAudioPlayer.getInstance().dispose();
} 