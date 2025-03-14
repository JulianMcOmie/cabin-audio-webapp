import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EQProcessor } from './EQProcessor';
import EQGraph from './EQGraph';
import EQControlPanel from './EQControlPanel';
import { EQBand, FrequencyResponse } from './types';
import { v4 as uuidv4 } from 'uuid';
import styles from './EQ.module.css';

interface EQToolProps {
  audioContext: AudioContext;
  inputNode?: AudioNode;
  outputNode?: AudioNode;
}

// Create 10 evenly spaced frequency bands (logarithmic spacing)
const createInitialBands = (): EQBand[] => {
  const bands: EQBand[] = [];
  const minFreq = 30;
  const maxFreq = 16000;
  const defaultQ = 1.0;
  
  // Create 10 logarithmically spaced bands
  for (let i = 0; i < 10; i++) {
    // Calculate frequency using logarithmic spacing
    const t = i / 9; // 0 to 1
    const freq = Math.round(minFreq * Math.pow(maxFreq / minFreq, t));
    
    bands.push({
      id: uuidv4(),
      frequency: freq,
      gain: 0, // All start at 0 gain
      Q: defaultQ, // All use the same bandwidth
      type: 'peaking',
      isHovered: false
    });
  }
  
  return bands;
};

// Add this interface to store the randomization deltas
interface BandRandomization {
  gainDelta: number;   // -12 to +12 dB change
  freqMultiplier: number;  // Frequency multiplier
  qMultiplier: number;     // Q multiplier
}

const EQTool: React.FC<EQToolProps> = ({
  audioContext,
  inputNode,
  outputNode,
}) => {
  const [bands, setBands] = useState<EQBand[]>([]);
  const [originalBands, setOriginalBands] = useState<EQBand[]>([]);
  const [modifiedBandIndices, setModifiedBandIndices] = useState<number[]>([]);
  const [randomizationValues, setRandomizationValues] = useState<BandRandomization[]>([]);
  const [frequencyResponse, setFrequencyResponse] = useState<FrequencyResponse[]>([]);
  const [selectedBand, setSelectedBand] = useState<EQBand | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [randomizationAmount, setRandomizationAmount] = useState(0);
  const eqProcessorRef = useRef<EQProcessor | null>(null);

  // Initialize EQ processor and create initial bands
  useEffect(() => {
    if (!audioContext) return;
    
    const processor = new EQProcessor(audioContext);
    eqProcessorRef.current = processor;
    
    // Connect to input/output if provided
    if (inputNode) {
      inputNode.connect(processor.getInput()!);
    }
    
    if (outputNode) {
      processor.connect(outputNode);
    }
    
    // Create initial 10 evenly spaced bands
    const initialBands = createInitialBands();
    
    // Add bands to processor
    initialBands.forEach(band => {
      processor.addBand(band);
    });
    
    // Set bands and original bands (for resetting)
    setBands(initialBands);
    setOriginalBands([...initialBands]);
    
    // Update frequency response
    updateFrequencyResponse();
    
    // Generate initial random modification
    generateRandomModification();
    
    return () => {
      // Clean up
      if (inputNode && processor.getInput()) {
        inputNode.disconnect(processor.getInput()!);
      }
      
      if (outputNode) {
        processor.getOutput()?.disconnect(outputNode);
      }
    };
  }, [audioContext, inputNode, outputNode]);

  // Generate a new random modification proposal
  const generateRandomModification = useCallback(() => {
    // Reset slider
    setRandomizationAmount(0);
    
    // Randomly select 3 band indices to modify
    const indices: number[] = [];
    const availableIndices = Array.from({ length: bands.length }, (_, i) => i);
    
    while (indices.length < 3 && availableIndices.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableIndices.length);
      const selectedIndex = availableIndices.splice(randomIndex, 1)[0];
      indices.push(selectedIndex);
    }
    
    // Generate random modification values
    const randomizations: BandRandomization[] = indices.map(() => ({
      gainDelta: (Math.random() * 24 - 12),  // -12 to +12 dB
      freqMultiplier: Math.pow(2, (Math.random() * 2 - 1)),  // Octave shift up/down
      qMultiplier: Math.pow(2, (Math.random() * 2 - 1) * 2),  // Q change
    }));
    
    // Store randomization values
    setRandomizationValues(randomizations);
    setModifiedBandIndices(indices);
    setOriginalBands([...bands]);
  }, [bands]);

  // Apply randomization based on slider value
  useEffect(() => {
    if (modifiedBandIndices.length === 0 || originalBands.length === 0 || randomizationValues.length === 0) return;
    
    // Create a copy of the original bands
    const newBands = [...originalBands];
    
    // Modify the selected bands
    modifiedBandIndices.forEach((index, i) => {
      const band = originalBands[index];
      const randomization = randomizationValues[i];
      
      if (!band || !randomization) return;
      
      // Apply stored randomizations scaled by slider value
      const gainChange = randomization.gainDelta * randomizationAmount;
      const freqMultiplier = Math.pow(randomization.freqMultiplier, randomizationAmount);
      const qMultiplier = Math.pow(randomization.qMultiplier, randomizationAmount);
      
      // Create modified band
      const modifiedBand = {
        ...band,
        frequency: Math.max(20, Math.min(20000, band.frequency * freqMultiplier)),
        gain: Math.max(-15, Math.min(15, band.gain + gainChange)),
        Q: Math.max(0.1, Math.min(10, band.Q * qMultiplier))
      };
      
      // Update the band
      newBands[index] = modifiedBand;
      
      // Update the processor
      if (eqProcessorRef.current) {
        eqProcessorRef.current.updateBand(band.id, modifiedBand);
      }
    });
    
    // Update state
    setBands(newBands);
    
    // Update frequency response
    updateFrequencyResponse();
  }, [randomizationAmount, modifiedBandIndices, originalBands, randomizationValues]);

  // Calculate and update the frequency response
  const updateFrequencyResponse = useCallback(() => {
    if (!eqProcessorRef.current) return;
    
    try {
      const response = isActive 
        ? eqProcessorRef.current.calculateFrequencyResponse()
        : Array.from({ length: 100 }, (_, i) => {
            const frequency = 20 * Math.pow(10, i / 33); // Log scale from 20Hz to 20kHz
            return { frequency, magnitude: 0 };
          });
      
      setFrequencyResponse(response);
    } catch (error) {
      console.error("Error calculating frequency response:", error);
    }
  }, [isActive]);

  // Confirm the current changes
  const confirmChanges = useCallback(() => {
    // Set the current bands as the new baseline
    setOriginalBands([...bands]);
    
    // Generate a new random modification
    generateRandomModification();
  }, [bands, generateRandomModification]);

  // Standard band operations
  const handleBandUpdate = useCallback((id: string, updates: Partial<EQBand>) => {
    if (!eqProcessorRef.current) return;
    
    // Update band in processor
    eqProcessorRef.current.updateBand(id, updates);
    
    // Get updated bands
    const updatedBands = eqProcessorRef.current.getBands();
    setBands(updatedBands);
    
    // Update selected band if it's the one being updated
    if (selectedBand && selectedBand.id === id) {
      const updatedBand = updatedBands.find(b => b.id === id);
      if (updatedBand) {
        setSelectedBand(updatedBand);
      }
    }
    
    // Update frequency response
    updateFrequencyResponse();
  }, [selectedBand, updateFrequencyResponse]);

  const handleBandAdd = useCallback((band: Partial<EQBand>) => {
    if (!eqProcessorRef.current) return;
    
    const newBand: EQBand = {
      id: uuidv4(),
      frequency: band.frequency || 1000,
      gain: band.gain || 0,
      Q: band.Q || 1,
      type: band.type || 'peaking',
      isHovered: false
    };
    
    // Add to processor
    eqProcessorRef.current.addBand(newBand);
    
    // Get updated bands
    const updatedBands = eqProcessorRef.current.getBands();
    setBands(updatedBands);
    setOriginalBands([...updatedBands]);
    
    // Update frequency response
    updateFrequencyResponse();
  }, [updateFrequencyResponse]);

  const handleBandRemove = useCallback((id: string) => {
    if (!eqProcessorRef.current) return;
    
    // Remove band from processor
    eqProcessorRef.current.removeBand(id);
    
    // Get updated bands
    const updatedBands = eqProcessorRef.current.getBands();
    setBands(updatedBands);
    setOriginalBands([...updatedBands]);
    
    // Clear selected band if it's the one being removed
    if (selectedBand && selectedBand.id === id) {
      setSelectedBand(null);
    }
    
    // Update frequency response
    updateFrequencyResponse();
  }, [selectedBand, updateFrequencyResponse]);

  const handleBandTypeChange = useCallback((id: string, type: BiquadFilterType) => {
    handleBandUpdate(id, { type });
  }, [handleBandUpdate]);

  const handleBandHover = useCallback((id: string | null) => {
    setBands(prev => prev.map(band => ({
      ...band,
      isHovered: band.id === id
    })));
    
    // Update selected band
    if (id) {
      const band = bands.find(b => b.id === id);
      if (band) {
        setSelectedBand(band);
      }
    }
  }, [bands]);

  return (
    <div className={styles.eqTool}>
      <div className={styles.eqGraphContainer}>
        <EQGraph
          bands={bands}
          frequencyResponse={frequencyResponse}
          onBandAdd={handleBandAdd}
          onBandUpdate={handleBandUpdate}
          onBandRemove={handleBandRemove}
          onBandHover={handleBandHover}
        />
      </div>
      
      <div className={styles.randomizationControls}>
        <div className={styles.controlRow}>
          <label>Random Modification:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={randomizationAmount}
            onChange={(e) => setRandomizationAmount(Number(e.target.value))}
            className={styles.slider}
            style={{ '--value': `${randomizationAmount * 100}%` } as React.CSSProperties}
          />
          <span>{(randomizationAmount * 100).toFixed(0)}%</span>
        </div>
        
        <div className={styles.buttonGroup}>
          <button 
            className={styles.applyButton}
            onClick={confirmChanges}
          >
            Confirm Changes
          </button>
          <button 
            className={styles.newProposalButton}
            onClick={generateRandomModification}
          >
            New Random Change
          </button>
        </div>
      </div>
      
      <EQControlPanel
        selectedBand={selectedBand}
        onBandUpdate={handleBandUpdate}
        onBandTypeChange={handleBandTypeChange}
        isActive={isActive}
        onToggleActive={() => {
          const newActive = !isActive;
          setIsActive(newActive);
          updateFrequencyResponse();
        }}
      />
    </div>
  );
};

export default EQTool; 