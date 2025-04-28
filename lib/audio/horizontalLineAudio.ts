import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores';

// Constants
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const LOG_MIN_FREQ = Math.log2(MIN_FREQ);
const LOG_MAX_FREQ = Math.log2(MAX_FREQ);
const LOG_FREQ_RANGE = LOG_MAX_FREQ - LOG_MIN_FREQ;
const DEFAULT_FREQ = 1000; // Default frequency Hz
const MASTER_GAIN = 0.05; // Gain for the line tones
const PULSE_ATTACK = 0.005; // Short attack for pulse
const PULSE_RELEASE = 0.05; // Short release for pulse
const PULSE_DURATION = PULSE_ATTACK + PULSE_RELEASE + 0.01; // Total lifespan of a pulse
const DEFAULT_SPAWN_INTERVAL_MS = 50; // Interval between spawning tones (milliseconds)

interface HorizontalLineParams {
    frequency: number; // Target frequency in Hz
    spawnIntervalMs: number; // Interval between spawns
}

// We don't need to store nodes long-term, they self-destruct
// interface ToneNode { ... }

export class HorizontalLineAudioPlayer {
    private static instance: HorizontalLineAudioPlayer;
    private isPlaying: boolean = false;
    private params: HorizontalLineParams = {
        frequency: DEFAULT_FREQ,
        spawnIntervalMs: DEFAULT_SPAWN_INTERVAL_MS,
    };
    private spawnIntervalId: NodeJS.Timeout | null = null;
    private preEQAnalyser: AnalyserNode | null = null;
    private preEQGain: GainNode | null = null;
    private distortionGain: number = 1.0;
    private activeOscillators: Set<OscillatorNode> = new Set(); // Keep track to stop on dispose/param change

    private constructor() {
        const initialDistortionGain = useEQProfileStore.getState().distortionGain;
        this.setDistortionGain(initialDistortionGain);
        useEQProfileStore.subscribe(
            (state) => this.setDistortionGain(state.distortionGain)
        );
    }

    public static getInstance(): HorizontalLineAudioPlayer {
        if (!HorizontalLineAudioPlayer.instance) {
            HorizontalLineAudioPlayer.instance = new HorizontalLineAudioPlayer();
        }
        return HorizontalLineAudioPlayer.instance;
    }

    public setParameters(newParams: Partial<HorizontalLineParams>): void {
        const oldInterval = this.params.spawnIntervalMs;
        this.params = { ...this.params, ...newParams };

        // Restart spawner only if interval changed and playing
        if (this.isPlaying && oldInterval !== this.params.spawnIntervalMs) {
            this.stopSpawning();
            this.startSpawning();
        }
         // Frequency changes are picked up by newly spawned tones automatically
    }

     public getParameters(): HorizontalLineParams {
        return { ...this.params }; // Return a copy
    }

    private spawnTone(): void {
        if (!this.isPlaying) return;

        const ctx = audioContext.getAudioContext();
        const now = ctx.currentTime;
        const freq = this.params.frequency;

        // Create nodes for this pulse
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, now);

        const panner = ctx.createStereoPanner();
        const randomPan = Math.random() * 2 - 1; // Random pan -1 to 1
        panner.pan.setValueAtTime(randomPan, now);

        const envelopeGain = ctx.createGain();
        envelopeGain.gain.value = 0; // Start silent

        const masterGain = ctx.createGain();
        masterGain.gain.value = MASTER_GAIN * this.distortionGain;

        // Connect chain: oscillator -> panner -> envelopeGain -> masterGain -> destination
        const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();
        oscillator.connect(panner);
        panner.connect(envelopeGain);
        envelopeGain.connect(masterGain);
        masterGain.connect(destinationNode);

        // Apply pulsing envelope
        envelopeGain.gain.setValueAtTime(0, now);
        envelopeGain.gain.linearRampToValueAtTime(1.0, now + PULSE_ATTACK);
        envelopeGain.gain.linearRampToValueAtTime(0.0, now + PULSE_ATTACK + PULSE_RELEASE);

        // Start and schedule stop
        try {
            oscillator.start(now);
            oscillator.stop(now + PULSE_DURATION);
            this.activeOscillators.add(oscillator); // Track it

            // Cleanup after stop
            oscillator.onended = () => {
                oscillator.disconnect();
                panner.disconnect();
                envelopeGain.disconnect();
                masterGain.disconnect();
                 this.activeOscillators.delete(oscillator); // Untrack it
            };
        } catch (e) {
            console.error("Error spawning tone pulse:", e);
            // Clean up immediately if start failed
            try {
                oscillator.disconnect();
                panner.disconnect();
                envelopeGain.disconnect();
                masterGain.disconnect();
            } catch (cleanupError) {}
        }
    }

    private startSpawning(): void {
        if (this.spawnIntervalId) {
            clearInterval(this.spawnIntervalId); // Clear existing interval
        }
        if (!this.isPlaying) return; // Don't start if not playing

        this.spawnIntervalId = setInterval(() => {
            this.spawnTone();
        }, this.params.spawnIntervalMs);
         // Spawn one immediately
         this.spawnTone();
    }

    private stopSpawning(): void {
        if (this.spawnIntervalId) {
            clearInterval(this.spawnIntervalId);
            this.spawnIntervalId = null;
        }
         // Stop all currently active oscillators immediately
         this.activeOscillators.forEach(osc => {
            try {
                osc.stop(); // Stop immediately
                osc.onended = null; // Prevent cleanup function from running again
                osc.disconnect();
            } catch (e) {} // Ignore errors if already stopped/disconnected
        });
        this.activeOscillators.clear();
    }

    public setPlaying(playing: boolean): void {
        if (playing === this.isPlaying) return;
        this.isPlaying = playing;

        if (playing) {
            // Ensure analyser connection if needed
             this.connectStaticNodes();
            this.startSpawning();
        } else {
            this.stopSpawning();
        }
    }

     // Helper to connect preEQGain if it exists
    private connectStaticNodes(): void {
        const ctx = audioContext.getAudioContext();
        if (this.preEQAnalyser && !this.preEQGain) {
            this.preEQGain = ctx.createGain();
            this.preEQGain.gain.value = 1.0;
            this.preEQGain.connect(this.preEQAnalyser);
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        } else if (this.preEQGain) {
            // Ensure it's connected properly if it already exists
            try { this.preEQGain.disconnect(); } catch(e){}
             if (this.preEQAnalyser) {
                 this.preEQGain.connect(this.preEQAnalyser);
             }
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        }
    }

     // --- Analyser Methods ---
    public createPreEQAnalyser(): AnalyserNode {
        const ctx = audioContext.getAudioContext();
        if (!this.preEQGain) {
            this.preEQGain = ctx.createGain();
            this.preEQGain.gain.value = 1.0;
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        }
        if (!this.preEQAnalyser) {
            this.preEQAnalyser = ctx.createAnalyser();
            this.preEQAnalyser.fftSize = 2048;
            this.preEQAnalyser.smoothingTimeConstant = 0.8;
            this.preEQGain.connect(this.preEQAnalyser);
        }
        this.connectStaticNodes(); // Ensure connections are correct
        return this.preEQAnalyser;
    }

    public connectToAnalyser(analyser: AnalyserNode): void {
         const ctx = audioContext.getAudioContext();
         if (!this.preEQGain) {
             this.preEQGain = ctx.createGain();
             this.preEQGain.gain.value = 1.0;
         } else {
             try { this.preEQGain.disconnect(); } catch(e){}
         }
         this.preEQAnalyser = analyser;
         this.preEQGain.connect(this.preEQAnalyser);
         this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
         this.connectStaticNodes();
    }

    public disconnectFromAnalyser(): void {
        if (this.preEQGain) {
             try { this.preEQGain.disconnect(); } catch(e){}
            this.preEQAnalyser = null;
             // Reconnect gain directly to EQ processor
             this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
             this.connectStaticNodes();
        }
    }
    // --- End Analyser Methods ---

    private setDistortionGain(gain: number): void {
        this.distortionGain = Math.max(0, Math.min(1, gain));
        // Gain is applied dynamically in spawnTone, no need to update existing nodes
    }

    public dispose(): void {
        this.setPlaying(false); // Stops spawning and clears active oscillators
        if (this.preEQGain) {
             try { this.preEQGain.disconnect(); } catch(e){}
            this.preEQGain = null;
        }
        this.preEQAnalyser = null;
        // TODO: Unsubscribe from store
    }
}

export function getHorizontalLineAudioPlayer(): HorizontalLineAudioPlayer {
    return HorizontalLineAudioPlayer.getInstance();
}

export function cleanupHorizontalLineAudioPlayer(): void {
    HorizontalLineAudioPlayer.getInstance().dispose();
} 