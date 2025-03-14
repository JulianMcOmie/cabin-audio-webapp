import { EQBand, FrequencyResponse } from './types';

export class EQProcessor {
  private audioContext: AudioContext;
  private inputNode: AudioNode | null = null;
  private outputNode: AudioNode | null = null;
  private filters: Map<string, BiquadFilterNode> = new Map();
  private bands: EQBand[] = [];

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.setupNodes();
  }

  private setupNodes() {
    // Create a gain node to serve as input and output points
    const inputGain = this.audioContext.createGain();
    const outputGain = this.audioContext.createGain();
    
    inputGain.connect(outputGain);
    
    this.inputNode = inputGain;
    this.outputNode = outputGain;
  }

  connect(destination: AudioNode) {
    if (this.outputNode) {
      this.outputNode.connect(destination);
    }
  }

  getInput(): AudioNode | null {
    return this.inputNode;
  }

  getOutput(): AudioNode | null {
    return this.outputNode;
  }

  addBand(band: EQBand): void {
    // Create a new filter
    const filter = this.audioContext.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.frequency;
    filter.gain.value = band.gain;
    filter.Q.value = band.Q;

    // Add to our collection
    this.filters.set(band.id, filter);
    
    // Add band with empty frequency response
    const bandWithEmptyResponse = {
      ...band,
      frequencyResponse: []
    };
    
    this.bands.push(bandWithEmptyResponse);

    // Reconnect all nodes to maintain the chain
    this.reconnectFilters();
    
    // Calculate frequency response for this band
    this.calculateBandResponse(band.id);
  }

  updateBand(id: string, updates: Partial<EQBand>): void {
    const filter = this.filters.get(id);
    if (!filter) return;

    // Update filter parameters
    if (updates.frequency !== undefined) {
      filter.frequency.value = updates.frequency;
    }
    if (updates.gain !== undefined) {
      filter.gain.value = updates.gain;
    }
    if (updates.Q !== undefined) {
      filter.Q.value = updates.Q;
    }
    if (updates.type !== undefined && updates.type !== filter.type) {
      filter.type = updates.type;
    }

    // Update our band data
    const bandIndex = this.bands.findIndex(band => band.id === id);
    if (bandIndex >= 0) {
      this.bands[bandIndex] = { ...this.bands[bandIndex], ...updates };
      
      // Recalculate frequency response for this band
      this.calculateBandResponse(id);
    }
  }

  removeBand(id: string): void {
    const filter = this.filters.get(id);
    if (!filter) return;

    // Remove from collections
    this.filters.delete(id);
    this.bands = this.bands.filter(band => band.id !== id);

    // Reconnect remaining filters
    this.reconnectFilters();
  }

  getBands(): EQBand[] {
    return [...this.bands];
  }

  private reconnectFilters(): void {
    if (!this.inputNode || !this.outputNode) return;

    // Disconnect all nodes
    this.inputNode.disconnect();
    this.filters.forEach(filter => filter.disconnect());

    // If no filters, connect input directly to output
    if (this.filters.size === 0) {
      this.inputNode.connect(this.outputNode);
      return;
    }

    // Connect filters in series
    let previousNode: AudioNode = this.inputNode;
    
    // Sort bands by frequency for more predictable behavior
    const sortedBands = [...this.bands].sort((a, b) => a.frequency - b.frequency);
    
    for (const band of sortedBands) {
      const filter = this.filters.get(band.id);
      if (filter) {
        previousNode.connect(filter);
        previousNode = filter;
      }
    }

    // Connect the last filter to the output
    previousNode.connect(this.outputNode);
  }

  // Calculate frequency response for a single band
  calculateBandResponse(id: string): void {
    const bandIndex = this.bands.findIndex(band => band.id === id);
    if (bandIndex < 0) return;
    
    const band = this.bands[bandIndex];
    const filter = this.filters.get(id);
    if (!filter) return;
    
    // Generate frequency points
    const frequencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      frequencies.push(20 * Math.pow(10, i / 33)); // 20Hz to 20kHz
    }
    
    // Get frequency response for this filter
    const magResponse = new Float32Array(frequencies.length);
    const phaseResponse = new Float32Array(frequencies.length);
    
    filter.getFrequencyResponse(
      new Float32Array(frequencies),
      magResponse,
      phaseResponse
    );
    
    // Convert to dB and store in band
    const response: FrequencyResponse[] = [];
    for (let i = 0; i < frequencies.length; i++) {
      const magDb = 20 * Math.log10(magResponse[i]);
      response.push({
        frequency: frequencies[i],
        magnitude: magDb
      });
    }
    
    // Update the band's frequency response
    this.bands[bandIndex].frequencyResponse = response;
  }

  calculateFrequencyResponse(): FrequencyResponse[] {
    // If no bands, return flat response
    if (this.bands.length === 0) {
      return Array.from({ length: 100 }, (_, i) => {
        const frequency = 20 * Math.pow(10, i / 33); // Log scale from 20Hz to 20kHz
        return { frequency, magnitude: 0 };
      });
    }
    
    // Make sure all bands have their frequency responses calculated
    this.bands.forEach(band => {
      if (!band.frequencyResponse || band.frequencyResponse.length === 0) {
        this.calculateBandResponse(band.id);
      }
    });
    
    // Generate frequency points
    const frequencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      frequencies.push(20 * Math.pow(10, i / 33)); // 20Hz to 20kHz
    }
    
    // Combine responses from all bands by summing magnitudes
    const combinedResponse: FrequencyResponse[] = [];
    
    for (let i = 0; i < frequencies.length; i++) {
      let totalMagnitude = 0;
      
      // Sum the magnitude responses from each band
      this.bands.forEach(band => {
        if (band.frequencyResponse && band.frequencyResponse[i]) {
          totalMagnitude += band.frequencyResponse[i].magnitude;
        }
      });
      
      combinedResponse.push({
        frequency: frequencies[i],
        magnitude: totalMagnitude
      });
    }
    
    return combinedResponse;
  }
} 