import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores';

// Constants
const MIN_FREQ = 40;
const MAX_FREQ = 15000;
const LOG_MIN_FREQ = Math.log2(MIN_FREQ);
const LOG_MAX_FREQ = Math.log2(MAX_FREQ);
const LOG_FREQ_RANGE = LOG_MAX_FREQ - LOG_MIN_FREQ;
const MASTER_GAIN = 0.5; // Lower gain for sine tones initially
const TONE_ATTACK = 0.01;
const TONE_RELEASE = 0.05;

interface SineGridParams {
    numLines: number; // Number of lines for each slope (+1 and -1)
    tonesPerLine: number;
    hOffset: number; // Range -1 to 1
    vOffset: number; // Range -1 to 1
}

interface ToneNode {
    oscillator: OscillatorNode;
    panner: StereoPannerNode;
    envelopeGain: GainNode;
    masterGain: GainNode;
}

class SineGridAudioPlayer {
    private static instance: SineGridAudioPlayer;
    private isPlaying: boolean = false;
    private audioNodes: Map<string, ToneNode> = new Map(); // Key: "lineIdx-toneIdx-slope"
    private params: SineGridParams = {
        numLines: 3,
        tonesPerLine: 5,
        hOffset: 0,
        vOffset: 0,
    };
    private preEQAnalyser: AnalyserNode | null = null;
    private preEQGain: GainNode | null = null;
    private distortionGain: number = 1.0;
    private stopTimeoutId: NodeJS.Timeout | null = null;

    private constructor() {
        // Apply initial distortion gain from store
        const distortionGain = useEQProfileStore.getState().distortionGain;
        this.setDistortionGain(distortionGain);

        // Subscribe to distortion gain changes
        useEQProfileStore.subscribe(
            (state) => this.setDistortionGain(state.distortionGain)
        );
    }

    public static getInstance(): SineGridAudioPlayer {
        if (!SineGridAudioPlayer.instance) {
            SineGridAudioPlayer.instance = new SineGridAudioPlayer();
        }
        return SineGridAudioPlayer.instance;
    }

    public setParameters(newParams: Partial<SineGridParams>): void {
        const needsUpdate = JSON.stringify(this.params) !== JSON.stringify({ ...this.params, ...newParams });
        this.params = { ...this.params, ...newParams };

        if (needsUpdate && this.isPlaying) {
            this.stopPlayback();
            this.createNodes();
            this.startPlayback();
        } else if (needsUpdate) {
            this.createNodes(); // Recreate nodes even if not playing
        }
    }

    public getParameters(): SineGridParams {
        return this.params;
    }

    private createNodes(): void {
        this.clearNodes(); // Clear existing nodes first
        const ctx = audioContext.getAudioContext();
        const { numLines, tonesPerLine, hOffset, vOffset } = this.params;

        // Helper to calculate position and frequency/pan
        const calculateToneProps = (lineIndex: number, toneIndex: number, slope: 1 | -1) => {
            // Calculate line constant 'c' - equally spaced around 0
            // Spacing depends on numLines. If numLines=1, c=0. If numLines=3, c=-1, 0, 1 (scaled).
            const lineSpacing = numLines > 1 ? 2 / (numLines - 1) : 0; // Scaled spacing in range [-1, 1]
            const c = numLines === 1 ? 0 : -1 + lineIndex * lineSpacing;

            // Calculate tone position along the line segment (e.g., x from -0.8 to 0.8)
            const toneSpacing = tonesPerLine > 1 ? 1.6 / (tonesPerLine - 1) : 0;
            const xBase = tonesPerLine === 1 ? 0 : -0.8 + toneIndex * toneSpacing; // Position along x-axis for distribution
            
            // Calculate actual (x, y) based on line equation y = slope*x + c
            let x = xBase;
            let y = slope * x + c;

            // Apply offsets (clamped to avoid going too far off-screen)
            x = Math.max(-1, Math.min(1, x + hOffset));
            y = Math.max(-1, Math.min(1, y + vOffset));

            // Map x to panning (-1 to 1)
            const pan = x;

            // Map y to frequency (logarithmic, range 0 to 1 first, then scale)
            // Normalize y from [-1, 1] to [0, 1]
            const normalizedY = (y + 1) / 2;
            const freq = Math.pow(2, LOG_MIN_FREQ + normalizedY * LOG_FREQ_RANGE);

            return { freq, pan };
        };

        // Create nodes for positive slope lines
        for (let i = 0; i < numLines; i++) {
            for (let j = 0; j < tonesPerLine; j++) {
                const key = `${i}-${j}-1`;
                const { freq, pan } = calculateToneProps(i, j, 1);
                this.addTone(key, freq, pan);
            }
        }

        // Create nodes for negative slope lines
        for (let i = 0; i < numLines; i++) {
            for (let j = 0; j < tonesPerLine; j++) {
                const key = `${i}-${j}--1`;
                const { freq, pan } = calculateToneProps(i, j, -1);
                this.addTone(key, freq, pan);
            }
        }
        
        // Connect nodes if analyser/EQ exists
        this.connectAllSources();
    }

    private addTone(key: string, freq: number, pan: number): void {
        if (this.audioNodes.has(key)) return; // Avoid duplicates

        const ctx = audioContext.getAudioContext();

        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, ctx.currentTime);

        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, ctx.currentTime);

        const envelopeGain = ctx.createGain();
        envelopeGain.gain.value = 0; // Start silent

        const masterGain = ctx.createGain();
        masterGain.gain.value = MASTER_GAIN * this.distortionGain;

        this.audioNodes.set(key, { oscillator, panner, envelopeGain, masterGain });
    }
    
    private connectAllSources(): void {
        const ctx = audioContext.getAudioContext();
        // Ensure preEQGain exists if an analyser is attached
        if (this.preEQAnalyser && !this.preEQGain) {
            this.preEQGain = ctx.createGain();
            this.preEQGain.gain.value = 1.0;
            this.preEQGain.connect(this.preEQAnalyser);
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        }
        
        const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();

        this.audioNodes.forEach(nodes => {
            try {
                 // Connect chain: oscillator -> panner -> envelopeGain -> masterGain -> destination
                nodes.oscillator.disconnect(); // Ensure clean connection
                nodes.oscillator.connect(nodes.panner);
                nodes.panner.connect(nodes.envelopeGain);
                nodes.envelopeGain.connect(nodes.masterGain);
                nodes.masterGain.connect(destinationNode);
            } catch (e) {
                console.error("Error connecting sine node:", e);
            }
        });
    }

    private startPlayback(): void {
        if (!this.isPlaying) return; // Should only be called internally via setPlaying
        
        // Clear any pending stop timeout
        if (this.stopTimeoutId) {
            clearTimeout(this.stopTimeoutId);
            this.stopTimeoutId = null;
        }

        const ctx = audioContext.getAudioContext();
        const now = ctx.currentTime;

        this.audioNodes.forEach(nodes => {
            try {
                // Apply distortion gain just before starting
                nodes.masterGain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain, now);
                // Start oscillator
                nodes.oscillator.start(now);
                // Trigger envelope
                nodes.envelopeGain.gain.cancelScheduledValues(now);
                nodes.envelopeGain.gain.setValueAtTime(0, now); // Start at 0
                nodes.envelopeGain.gain.linearRampToValueAtTime(1.0, now + TONE_ATTACK); // Ramp up
            } catch (e) {
                 // Ignore errors if oscillator already started
                 if (!(e instanceof DOMException && e.name === 'InvalidStateError')) {
                    console.error("Error starting sine node:", e);
                }
            }
        });
    }

    private stopPlayback(): void {
        if (this.audioNodes.size === 0) return;

        const ctx = audioContext.getAudioContext();
        const now = ctx.currentTime;

        this.audioNodes.forEach(nodes => {
            try {
                // Ramp down envelope
                nodes.envelopeGain.gain.cancelScheduledValues(now);
                nodes.envelopeGain.gain.setValueAtTime(nodes.envelopeGain.gain.value, now); // Hold current value
                nodes.envelopeGain.gain.linearRampToValueAtTime(0.0, now + TONE_RELEASE); // Ramp down

                // Stop oscillator after release
                 nodes.oscillator.stop(now + TONE_RELEASE + 0.01);
            } catch (e) {
                // Ignore errors if oscillator already stopped
                 if (!(e instanceof DOMException && e.name === 'InvalidStateError')) {
                    console.error("Error stopping sine node:", e);
                }
            }
        });
        // Schedule clearing nodes after stop time to allow release envelope to finish.
        if (this.stopTimeoutId) clearTimeout(this.stopTimeoutId); // Clear previous timeout if exists
        this.stopTimeoutId = setTimeout(() => {
            if (!this.isPlaying) { // Check again in case it was restarted quickly
                this.clearNodes();
            }
            this.stopTimeoutId = null;
        }, (TONE_RELEASE + 0.1) * 1000); 
    }

    private clearNodes(): void {
         // Ensure oscillators are stopped before disconnecting
         this.audioNodes.forEach(nodes => {
            try {
                nodes.oscillator.disconnect();
                nodes.panner.disconnect();
                nodes.envelopeGain.disconnect();
                nodes.masterGain.disconnect();
            } catch (e) {
                // Ignore disconnection errors
            }
        });
        this.audioNodes.clear();
    }

    public setPlaying(playing: boolean): void {
        if (playing === this.isPlaying) return;
        this.isPlaying = playing;

        if (playing) {
             if (this.audioNodes.size === 0) {
                 this.createNodes(); // Create nodes if they don't exist
             }
             this.connectAllSources(); // Ensure connections are fresh
             this.startPlayback();
        } else {
             this.stopPlayback();
        }
    }

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
            this.preEQGain.connect(this.preEQAnalyser); // Connect gain to analyser
        }
        this.connectAllSources(); // Reconnect sources to ensure they go through gain/analyser
        return this.preEQAnalyser;
    }

    public connectToAnalyser(analyser: AnalyserNode): void {
         const ctx = audioContext.getAudioContext();
         if (this.preEQGain) {
             this.preEQGain.disconnect(); // Disconnect existing gain connections
         } else {
             this.preEQGain = ctx.createGain();
             this.preEQGain.gain.value = 1.0;
         }
         this.preEQAnalyser = analyser; // Use external analyser
         this.preEQGain.connect(this.preEQAnalyser);
         this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
         this.connectAllSources(); // Reconnect all sources to the new gain node
    }

    public disconnectFromAnalyser(): void {
        if (this.preEQGain) {
            this.preEQGain.disconnect(); // Disconnects from analyser and EQ
            this.preEQAnalyser = null; // Clear internal analyser reference
            // Reconnect gain directly to EQ processor
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
            this.connectAllSources(); // Reconnect sources to go directly to EQ via gain
        }
    }

    private setDistortionGain(gain: number): void {
        this.distortionGain = Math.max(0, Math.min(1, gain));
        // Apply gain change to existing nodes if playing
        const now = audioContext.getAudioContext().currentTime;
        this.audioNodes.forEach(nodes => {
             if (this.isPlaying) { // Only ramp if playing
                nodes.masterGain.gain.linearRampToValueAtTime(MASTER_GAIN * this.distortionGain, now + 0.01);
            } else {
                nodes.masterGain.gain.value = MASTER_GAIN * this.distortionGain; // Set immediately if not playing
            }
        });
    }

    public dispose(): void {
        this.setPlaying(false); // This triggers stopPlayback and schedules clearNodes
        if (this.stopTimeoutId) {
            clearTimeout(this.stopTimeoutId);
            this.stopTimeoutId = null;
        }
        this.clearNodes(); // Clear immediately on dispose

        if (this.preEQGain) {
            this.preEQGain.disconnect();
            this.preEQGain = null;
        }
        this.preEQAnalyser = null;
        // TODO: Unsubscribe from store? Requires more robust singleton management or explicit unsubscribe method.
    }
}

export function getSineGridAudioPlayer(): SineGridAudioPlayer {
    return SineGridAudioPlayer.getInstance();
}

export function cleanupSineGridAudioPlayer(): void {
    SineGridAudioPlayer.getInstance().dispose();
} 