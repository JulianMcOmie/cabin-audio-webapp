"use client";

import React, { useState } from 'react';
import { WaveletState } from '@/lib/audio/WaveletState';

interface ControlPanelProps {
  waveletState: WaveletState;
  onWaveletUpdate: (index: number, param: string, value: number) => void;
  onAddWavelet: () => void;
  onRemoveWavelet: (index: number) => void;
}

export const WaveletControlPanel: React.FC<ControlPanelProps> = ({
  waveletState,
  onWaveletUpdate,
  onAddWavelet,
  onRemoveWavelet
}) => {
  // Get all wavelets
  const wavelets = waveletState.getWavelets();
  
  // Current wavelet page (0-based index)
  const [currentPage, setCurrentPage] = useState(0);
  
  // Format phase value to degrees for display
  const formatPhase = (radians: number): string => {
    const degrees = Math.round((radians * 180) / Math.PI);
    return `${degrees}°`;
  };
  
  // Format center frequency to Hz
  const formatFrequency = (normalized: number): string => {
    const freq = waveletState.normalizedToHz(normalized);
    if (freq < 1000) {
      return `${Math.round(freq)}Hz`;
    } else {
      return `${(freq / 1000).toFixed(1)}kHz`;
    }
  };
  
  // Format falloff range
  const formatFalloff = (value: number): string => {
    if (value >= 0.99) return "∞";
    return value.toFixed(2);
  };
  
  // Navigate to previous wavelet
  const goToPrevWavelet = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };
  
  // Navigate to next wavelet
  const goToNextWavelet = () => {
    setCurrentPage((prev) => Math.min(wavelets.length - 1, prev + 1));
  };
  
  // Handle adding a new wavelet
  const handleAddWavelet = () => {
    onAddWavelet();
    // Navigate to the new wavelet
    setCurrentPage(wavelets.length);
  };
  
  // Handle removing current wavelet
  const handleRemoveWavelet = () => {
    if (wavelets.length <= 1) return; // Prevent removing the last wavelet
    
    onRemoveWavelet(currentPage);
    // Adjust current page if needed
    if (currentPage >= wavelets.length - 1) {
      setCurrentPage(Math.max(0, wavelets.length - 2));
    }
  };
  
  // Reset current wavelet
  const resetCurrentWavelet = () => {
    const index = currentPage;
    onWaveletUpdate(index, 'frequency', 4);
    onWaveletUpdate(index, 'amplitude', 0);
    onWaveletUpdate(index, 'phase', 0);
    onWaveletUpdate(index, 'centerFreq', 0.5);
    onWaveletUpdate(index, 'falloff', 1);
  };
  
  return (
    <div className="control-panel p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium">Wavelet Controls</h2>
        
        <div className="flex space-x-2">
          <button
            onClick={handleAddWavelet}
            className="text-sm px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded"
          >
            Add Wavelet
          </button>
          
          {wavelets.length > 1 && (
            <button
              onClick={handleRemoveWavelet}
              className="text-sm px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      
      {/* Wavelet Navigation */}
      {wavelets.length > 0 && (
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={goToPrevWavelet}
            disabled={currentPage === 0}
            className={`px-3 py-1 rounded text-sm ${
              currentPage === 0 
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            ← Previous
          </button>
          
          <div className="text-sm font-medium">
            Wavelet {currentPage + 1} of {wavelets.length}
          </div>
          
          <button
            onClick={goToNextWavelet}
            disabled={currentPage >= wavelets.length - 1}
            className={`px-3 py-1 rounded text-sm ${
              currentPage >= wavelets.length - 1 
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            Next →
          </button>
        </div>
      )}
      
      {/* Current Wavelet Controls */}
      {wavelets.length > 0 && (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg">
          <div className="mb-3">
            <h3 className="text-md font-medium mb-1">Wavelet #{currentPage + 1}</h3>
            <button
              onClick={resetCurrentWavelet}
              className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded px-2 py-1"
            >
              Reset This Wavelet
            </button>
          </div>
          
          <div className="space-y-4">
            {/* Frequency slider */}
            <div className="slider-container">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium">Frequency (cycles)</label>
                <span className="text-xs text-gray-500">{wavelets[currentPage].frequency.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="64"
                step="0.1"
                value={wavelets[currentPage].frequency}
                onChange={(e) => onWaveletUpdate(currentPage, 'frequency', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-purple-500"
              />
            </div>
            
            {/* Amplitude slider */}
            <div className="slider-container">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium">Amplitude</label>
                <span className="text-xs text-gray-500">{wavelets[currentPage].amplitude.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={wavelets[currentPage].amplitude}
                onChange={(e) => onWaveletUpdate(currentPage, 'amplitude', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-blue-500"
              />
            </div>
            
            {/* Phase slider */}
            <div className="slider-container">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium">Phase</label>
                <span className="text-xs text-gray-500">{formatPhase(wavelets[currentPage].phase)}</span>
              </div>
              <input
                type="range"
                min="0"
                max={2 * Math.PI}
                step={Math.PI / 180}
                value={wavelets[currentPage].phase}
                onChange={(e) => onWaveletUpdate(currentPage, 'phase', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-green-500"
              />
            </div>
            
            {/* Center Frequency slider */}
            <div className="slider-container">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium">Center Frequency</label>
                <span className="text-xs text-gray-500">{formatFrequency(wavelets[currentPage].centerFreq)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={wavelets[currentPage].centerFreq}
                onChange={(e) => onWaveletUpdate(currentPage, 'centerFreq', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-amber-500"
              />
            </div>
            
            {/* Falloff Range slider */}
            <div className="slider-container">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium">Falloff Range</label>
                <span className="text-xs text-gray-500">{formatFalloff(wavelets[currentPage].falloff)}</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={wavelets[currentPage].falloff}
                onChange={(e) => onWaveletUpdate(currentPage, 'falloff', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-pink-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}; 