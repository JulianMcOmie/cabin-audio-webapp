import * as audioContext from './audioContext';
import * as eqProcessor from './eqProcessor';
import { useEQProfileStore } from '../stores';

// Constants
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const LOG_MIN_FREQ = Math.log2(MIN_FREQ);
const LOG_MAX_FREQ = Math.log2(MAX_FREQ);
const LOG_FREQ_RANGE = LOG_MAX_FREQ - LOG_MIN_FREQ;
const MASTER_GAIN = 0.01; // Lower gain for sine tones initially
const TONE_ATTACK = 0.01;
const TONE_RELEASE = 0.05;
const LINE_SLOPE = 0.05; // Very small positive slope

interface SineGridParams {
    numLines: number; // Now represents total horizontal-ish lines
    tonesPerLine: number;
    vOffset: number; // Range -1 to 1
}

interface ToneNode {
    oscillator: OscillatorNode | null; // Oscillator can be null when not playing
    panner: StereoPannerNode;
    envelopeGain: GainNode;
    masterGain: GainNode;
    // Store calculated properties
    freq: number;
    pan: number;
}

// Export the class definition
export class SineGridAudioPlayer {
    private static instance: SineGridAudioPlayer;
    private isPlaying: boolean = false;
    private audioNodes: Map<string, ToneNode> = new Map(); // Key: "lineIdx-toneIdx"
    private params: SineGridParams = {
        numLines: 5, // Default to 5 horizontal lines
        tonesPerLine: 10, // Default tones per line
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
         // Check if specific relevant parameters changed
        const oldParams = { ...this.params };
        this.params = { ...this.params, ...newParams };
        const needsUpdate = 
            oldParams.numLines !== this.params.numLines ||
            oldParams.tonesPerLine !== this.params.tonesPerLine ||
            oldParams.vOffset !== this.params.vOffset;


        if (needsUpdate && this.isPlaying) {
            this.stopPlayback(); // Stop current sounds smoothly
             // Recreate nodes with a slight delay to ensure old ones are stopped/cleared
            setTimeout(() => {
                if (this.isPlaying) { // Check if still playing after delay
                     this.createNodes();
                     this.startPlayback(); // Start new sounds
                } else {
                    this.createNodes(); // Just recreate nodes if not playing
                }
            }, (TONE_RELEASE + 0.15) * 1000); // Delay slightly longer than stop clear timeout
        } else if (needsUpdate) {
            // If not playing, recreate immediately or after a short delay if nodes might be clearing
             setTimeout(() => {
                 if (!this.isPlaying) { // Ensure not playing before recreating
                     this.createNodes(); 
                 }
             }, (TONE_RELEASE + 0.15) * 1000);
        }
    }

    public getParameters(): SineGridParams {
        return this.params;
    }

    // Expose calculation logic for visualization
    public static calculateToneProps = (params: SineGridParams, lineIndex: number, toneIndex: number) => {
        const { numLines, tonesPerLine, vOffset } = params;
        // Calculate vertical intercept 'c' for the line.
        // Spread lines vertically from -0.8 to 0.8 to avoid hitting edges.
        const verticalSpacing = numLines > 1 ? 1.6 / (numLines - 1) : 0;
        const c_base = numLines === 1 ? 0 : -0.8 + lineIndex * verticalSpacing;

        // Calculate tone position along the line (x from -0.9 to 0.9)
        const horizontalSpacing = tonesPerLine > 1 ? 1.8 / (tonesPerLine - 1) : 0;
        const xBase = tonesPerLine === 1 ? 0 : -0.9 + toneIndex * horizontalSpacing; 
        
        // Calculate actual (x, y) based on line equation y = slope*x + c
        let x = xBase;
        let y = LINE_SLOPE * x + c_base;

        // Apply only vertical offset
        // x = x + hOffset; // Removed hOffset application
        y = y + vOffset;

        // Clamp final x, y to be within [-1, 1] bounds
        x = Math.max(-1, Math.min(1, x));
        y = Math.max(-1, Math.min(1, y));

        // Map x to panning (-1 to 1)
        const pan = x;

        // Map y to frequency (logarithmic, range 0 to 1 first, then scale)
        const normalizedY = (y + 1) / 2; // Normalize y from [-1, 1] to [0, 1]
        const freq = Math.pow(2, LOG_MIN_FREQ + normalizedY * LOG_FREQ_RANGE);

        return { x, y, freq, pan }; // Return x, y for visualization
    };

    private createNodes(): void {
        this.clearNodes(); // Clear existing nodes first
        // const ctx = audioContext.getAudioContext(); // Context needed only in addTone
        const { numLines, tonesPerLine } = this.params;

        // Create nodes for each line using the static calculation method
        for (let i = 0; i < numLines; i++) {
            for (let j = 0; j < tonesPerLine; j++) {
                const key = `${i}-${j}`; 
                // Use the static method, passing current instance params
                const { freq, pan } = SineGridAudioPlayer.calculateToneProps(this.params, i, j);
                this.addTone(key, freq, pan);
            }
        }
        
        this.connectNonOscillatorSources();
    }

    private addTone(key: string, freq: number, pan: number): void {
        if (this.audioNodes.has(key)) return; // Avoid duplicates

        const ctx = audioContext.getAudioContext();

        // Don't create oscillator here
        // const oscillator = ctx.createOscillator(); ...

        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, ctx.currentTime); // Set pan immediately

        const envelopeGain = ctx.createGain();
        envelopeGain.gain.value = 0;

        const masterGain = ctx.createGain();
        masterGain.gain.value = MASTER_GAIN * this.distortionGain;

        // Store nodes and calculated props
        this.audioNodes.set(key, { 
            oscillator: null, // Oscillator created on play
            panner, 
            envelopeGain, 
            masterGain, 
            freq, // Store calculated freq
            pan // Store calculated pan (though panner is already set)
        });
    }
    
    private connectNonOscillatorSources(): void {
        const ctx = audioContext.getAudioContext();
        if (this.preEQAnalyser && !this.preEQGain) {
            this.preEQGain = ctx.createGain();
            this.preEQGain.gain.value = 1.0;
            this.preEQGain.connect(this.preEQAnalyser);
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        }
        
        const destinationNode = this.preEQGain || eqProcessor.getEQProcessor().getInputNode();

        this.audioNodes.forEach(nodes => {
            try {
                 // Connect chain: panner -> envelopeGain -> masterGain -> destination
                // Disconnect first to be safe
                nodes.panner.disconnect(); 
                nodes.envelopeGain.disconnect();
                nodes.masterGain.disconnect();

                nodes.panner.connect(nodes.envelopeGain);
                nodes.envelopeGain.connect(nodes.masterGain);
                nodes.masterGain.connect(destinationNode);
            } catch (e) {
                console.error("Error connecting sine node static parts:", e);
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

        this.audioNodes.forEach((nodes, key) => {
            try {
                 // Stop and disconnect existing oscillator if any (e.g., from previous play)
                if (nodes.oscillator) {
                    try { nodes.oscillator.stop(); } catch (e) {}
                    nodes.oscillator.disconnect();
                }

                // Create the new oscillator
                const oscillator = ctx.createOscillator();
                oscillator.type = 'sine';
                // Set frequency directly from stored value
                oscillator.frequency.setValueAtTime(nodes.freq, now); 
                
                // Store the new oscillator reference
                nodes.oscillator = oscillator;

                // Connect the new oscillator to the panner
                nodes.oscillator.connect(nodes.panner);

                // Apply distortion gain
                nodes.masterGain.gain.setValueAtTime(MASTER_GAIN * this.distortionGain, now);
                
                // Start oscillator
                nodes.oscillator.start(now);
                
                // Trigger envelope
                nodes.envelopeGain.gain.cancelScheduledValues(now);
                nodes.envelopeGain.gain.setValueAtTime(0, now);
                nodes.envelopeGain.gain.linearRampToValueAtTime(1.0, now + TONE_ATTACK);
            } catch (e) {
                 console.error(`Error starting sine node ${key}:`, e);
            }
        });
    }

    private stopPlayback(): void {
        if (this.audioNodes.size === 0) return;

        const ctx = audioContext.getAudioContext();
        const now = ctx.currentTime;

        this.audioNodes.forEach((nodes, key) => {
             if (!nodes.oscillator) return; // Skip if no oscillator active for this node

            try {
                // Ramp down envelope
                nodes.envelopeGain.gain.cancelScheduledValues(now);
                nodes.envelopeGain.gain.setValueAtTime(nodes.envelopeGain.gain.value, now);
                nodes.envelopeGain.gain.linearRampToValueAtTime(0.0, now + TONE_RELEASE);

                // Stop oscillator after release
                 nodes.oscillator.stop(now + TONE_RELEASE + 0.01);
                 // Set oscillator reference to null after stopping is scheduled
                 nodes.oscillator = null; 
            } catch (e) {
                 if (!(e instanceof DOMException && e.name === 'InvalidStateError')) {
                    console.error(`Error stopping sine node ${key}:`, e);
                } else {
                    // If already stopped, just nullify reference
                     nodes.oscillator = null;
                }
            }
        });
      
        if (this.stopTimeoutId) clearTimeout(this.stopTimeoutId);
        this.stopTimeoutId = setTimeout(() => {
            // No need to clearNodes here, just manage oscillator lifecycle
            this.stopTimeoutId = null;
        }, (TONE_RELEASE + 0.1) * 1000); 
    }

    private clearNodes(): void {
         this.audioNodes.forEach(nodes => {
            try {
                // Stop any playing oscillator immediately before clearing
                 if (nodes.oscillator) {
                    try { nodes.oscillator.stop(); } catch(e) {}
                    nodes.oscillator.disconnect();
                 }
                 // Disconnect static nodes
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
             // Connect static parts if needed (e.g., after dispose/re-init)
             this.connectNonOscillatorSources(); 
             this.startPlayback();
        } else {
             this.stopPlayback();
             // Stop playback handles the stopping/cleanup timing
        }
    }
    
    // Analyser methods...
    public createPreEQAnalyser(): AnalyserNode {
        const ctx = audioContext.getAudioContext();
        if (!this.preEQGain) {
            this.preEQGain = ctx.createGain();
            this.preEQGain.gain.value = 1.0;
            // Connect gain directly to EQ first
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
        }
        if (!this.preEQAnalyser) {
            this.preEQAnalyser = ctx.createAnalyser();
            this.preEQAnalyser.fftSize = 2048;
            this.preEQAnalyser.smoothingTimeConstant = 0.8;
             // Connect gain to analyser (analyser doesn't go to destination)
            this.preEQGain.connect(this.preEQAnalyser); 
        }
        // Ensure static nodes are connected through the gain
        this.connectNonOscillatorSources(); 
        return this.preEQAnalyser;
    }

    public connectToAnalyser(analyser: AnalyserNode): void {
         const ctx = audioContext.getAudioContext();
         if (this.preEQGain) {
             this.preEQGain.disconnect(); 
         } else {
             this.preEQGain = ctx.createGain();
             this.preEQGain.gain.value = 1.0;
         }
         this.preEQAnalyser = analyser; 
         this.preEQGain.connect(this.preEQAnalyser);
         this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
         this.connectNonOscillatorSources(); 
    }

    public disconnectFromAnalyser(): void {
        if (this.preEQGain) {
            this.preEQGain.disconnect(); 
            this.preEQAnalyser = null; 
            // Reconnect gain directly to EQ processor
            this.preEQGain.connect(eqProcessor.getEQProcessor().getInputNode());
            this.connectNonOscillatorSources(); 
        }
    }

    // Distortion Gain
    private setDistortionGain(gain: number): void {
        this.distortionGain = Math.max(0, Math.min(1, gain));
        const now = audioContext.getAudioContext().currentTime;
        this.audioNodes.forEach(nodes => {
             // Apply gain to masterGain node, which persists
             nodes.masterGain.gain.linearRampToValueAtTime(MASTER_GAIN * this.distortionGain, now + 0.01);
        });
    }

    // Dispose
    public dispose(): void {
        const wasPlaying = this.isPlaying;
        this.setPlaying(false); 
        if (this.stopTimeoutId) {
            clearTimeout(this.stopTimeoutId);
            this.stopTimeoutId = null;
        }
        // Ensure nodes are cleared immediately, even if stopPlayback was scheduled
        this.clearNodes(); 

        if (this.preEQGain) {
            this.preEQGain.disconnect();
            this.preEQGain = null;
        }
        this.preEQAnalyser = null;
        // TODO: Unsubscribe from store? 
    }

}

export function getSineGridAudioPlayer(): SineGridAudioPlayer {
    return SineGridAudioPlayer.getInstance();
}

export function cleanupSineGridAudioPlayer(): void {
    SineGridAudioPlayer.getInstance().dispose();
} 