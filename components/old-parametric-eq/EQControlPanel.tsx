import React from 'react';
import { EQBand } from './types';
import styles from './EQ.module.css';

interface EQControlPanelProps {
  selectedBand: EQBand | null;
  onBandUpdate: (id: string, updates: Partial<EQBand>) => void;
  onBandTypeChange: (id: string, type: BiquadFilterType) => void;
  isActive: boolean;
  onToggleActive: () => void;
}

const EQControlPanel: React.FC<EQControlPanelProps> = ({
  selectedBand,
  onBandUpdate,
  onBandTypeChange,
  isActive,
  onToggleActive,
}) => {
  const filterTypes: BiquadFilterType[] = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass'];

  const handleFrequencyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBand) return;
    const value = parseFloat(e.target.value);
    onBandUpdate(selectedBand.id, { frequency: value });
  };

  const handleGainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBand) return;
    const value = parseFloat(e.target.value);
    onBandUpdate(selectedBand.id, { gain: value });
  };

  const handleQChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBand) return;
    const value = parseFloat(e.target.value);
    onBandUpdate(selectedBand.id, { Q: value });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!selectedBand) return;
    onBandTypeChange(selectedBand.id, e.target.value as BiquadFilterType);
  };

  return (
    <div className={styles.controlPanel}>
      <div className={styles.header}>
        <h2>EQ Controls</h2>
        <div className={styles.activeToggle}>
          <label>
            <input
              type="checkbox"
              checked={isActive}
              onChange={onToggleActive}
            />
            Active
          </label>
        </div>
      </div>

      {selectedBand ? (
        <div className={styles.bandControls}>
          <div className={styles.controlRow}>
            <label>Frequency</label>
            <div className={styles.controlInput}>
              <input
                type="range"
                min="20"
                max="20000"
                step="1"
                value={selectedBand.frequency}
                onChange={handleFrequencyChange}
              />
              <span>{selectedBand.frequency.toFixed(0)} Hz</span>
            </div>
          </div>

          <div className={styles.controlRow}>
            <label>Gain</label>
            <div className={styles.controlInput}>
              <input
                type="range"
                min="-24"
                max="24"
                step="0.5"
                value={selectedBand.gain}
                onChange={handleGainChange}
              />
              <span>{selectedBand.gain.toFixed(1)} dB</span>
            </div>
          </div>

          <div className={styles.controlRow}>
            <label>Q / Bandwidth</label>
            <div className={styles.controlInput}>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={selectedBand.Q}
                onChange={handleQChange}
              />
              <span>{selectedBand.Q.toFixed(1)}</span>
            </div>
          </div>

          <div className={styles.controlRow}>
            <label>Type</label>
            <select value={selectedBand.type} onChange={handleTypeChange}>
              {filterTypes.map(type => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className={styles.noBandSelected}>
          <p>Click on the graph to add an EQ band</p>
          <p>Drag bands to adjust frequency and gain</p>
          <p>Right-click to remove a band</p>
        </div>
      )}
      
      <div className={styles.helpText}>
        <h3>Tips:</h3>
        <ul>
          <li>Drag bands horizontally to adjust frequency</li>
          <li>Drag bands vertically to adjust gain</li>
          <li>Hold Shift while dragging to adjust Q/bandwidth</li>
          <li>Right-click a band to remove it</li>
          <li>Double-click on the graph to add a new band</li>
          <li>Hover over a band to see its current values</li>
          <li>Use the controls above for precise adjustments</li>
          <li>Different filter types have different effects on the sound</li>
          <li>Peaking filters boost/cut at a specific frequency</li>
          <li>Shelf filters boost/cut all frequencies above or below the cutoff</li>
          <li>Pass filters allow only frequencies above or below the cutoff to pass</li>
          <li>Higher Q values create narrower, more focused adjustments</li>
          <li>Lower Q values affect a wider range of frequencies</li>
          <li>You can create complex EQ curves by combining multiple bands</li>
          <li>The graph shows both individual band responses and the combined response</li>
          <li>Toggle the &quot;Active&quot; switch to compare with the unprocessed sound</li>
          <li>Don&apos;t boost too much - it&apos;s often better to cut unwanted frequencies</li>
        </ul>
      </div>
    </div>
  );
};

export default EQControlPanel; 