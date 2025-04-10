import { useState, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEQProfileStore } from '@/lib/stores/eqProfileStore';
import { calculateAmplitudeMultiplier } from './amplitudeCurveUtils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Enhanced amplitude curve parameters
export interface AmplitudeCurveParams {
  // Basic parameters
  lowEndGain: number;    // Gain at 20Hz (dB)
  highEndGain: number;   // Gain at 20kHz (dB)
  midPointFreq: number;  // Frequency of the midpoint (Hz)
  midPointGain: number;  // Gain at the midpoint (dB)
  
  // Advanced parameters
  curveType: 'parametric' | 'shelving' | 'notch' | 'bandpass';
  curveShape: number;    // Shape of the curve (0-1)
  
  // Additional control points
  lowMidFreq: number;    // Low-mid frequency (between low and mid)
  lowMidGain: number;    // Low-mid gain
  highMidFreq: number;   // High-mid frequency (between mid and high)
  highMidGain: number;   // High-mid gain
  
  // Resonance parameters
  resonanceFreq: number; // Frequency for resonance peak
  resonanceGain: number; // Gain for resonance peak
  resonanceQ: number;    // Q factor for resonance peak
}

// Default parameters
const DEFAULT_PARAMS: AmplitudeCurveParams = {
  // Basic
  lowEndGain: 0,
  highEndGain: 0,
  midPointFreq: 1000,
  midPointGain: 0,
  
  // Advanced
  curveType: 'parametric',
  curveShape: 0.5,
  
  // Additional points
  lowMidFreq: 200,
  lowMidGain: 0,
  highMidFreq: 5000,
  highMidGain: 0,
  
  // Resonance
  resonanceFreq: 3000,
  resonanceGain: 0,
  resonanceQ: 1.0
};

export function AmplitudeCurveControls() {
  // Get the current profile and update function from the store
  const { getActiveProfile, updateProfile } = useEQProfileStore();
  const profile = getActiveProfile();
  
  // State for the amplitude curve parameters
  const [params, setParams] = useState<AmplitudeCurveParams>(DEFAULT_PARAMS);
  const [activeTab, setActiveTab] = useState('basic');
  
  // Load parameters from profile when it changes
  useEffect(() => {
    if (profile && profile.amplitudeCurveParams) {
      // Ensure all fields exist by merging with defaults
      setParams({...DEFAULT_PARAMS, ...profile.amplitudeCurveParams});
    } else {
      setParams(DEFAULT_PARAMS);
    }
  }, [profile]);
  
  // Update all band gains based on the amplitude curve
  const updateBandGains = (curveParams: AmplitudeCurveParams) => {
    if (!profile) return;
    
    // Update all bands with new gains based on their frequency
    const updatedBands = profile.bands.map(band => {
      const gainMultiplier = calculateAmplitudeMultiplier(band.frequency, curveParams);
      
      return {
        ...band,
        gain: gainMultiplier // Set the gain directly from the curve
      };
    });
    
    // Update the profile with the new bands and curve parameters
    updateProfile(profile.id, { 
      bands: updatedBands,
      amplitudeCurveParams: curveParams
    });
  };
  
  // Apply the amplitude curve to all bands when component mounts
  // or when the profile changes
  useEffect(() => {
    if (profile) {
      // Use existing parameters from profile or defaults
      const curveParams = profile.amplitudeCurveParams ? 
        {...DEFAULT_PARAMS, ...profile.amplitudeCurveParams} : 
        DEFAULT_PARAMS;
      
      // Only update if there are bands to update
      if (profile.bands.length > 0) {
        updateBandGains(curveParams);
      }
    }
  }, [profile?.id]); // Only run when profile ID changes
  
  // Update the profile when parameters change
  const updateParams = (newParams: Partial<AmplitudeCurveParams>) => {
    if (!profile) return;
    
    const updatedParams = { ...params, ...newParams };
    setParams(updatedParams);
    
    // Update all band gains based on the new curve parameters
    updateBandGains(updatedParams);
  };
  
  // Format frequency for display
  const formatFrequency = (freq: number) => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}kHz`;
    }
    return `${freq}Hz`;
  };
  
  // Format gain for display
  const formatGain = (gain: number) => {
    return `${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB`;
  };
  
  // Convert frequency to slider value (logarithmic scale)
  const scaleFrequencyToSlider = (freq: number): number => {
    // Convert frequency to a value between 0 and 1 using logarithmic scale
    const minLog = Math.log10(20); // 20Hz
    const maxLog = Math.log10(20000); // 20kHz
    const freqLog = Math.log10(Math.max(20, Math.min(20000, freq)));
    
    return (freqLog - minLog) / (maxLog - minLog);
  };
  
  // Convert slider value to frequency (logarithmic scale)
  const scaleSliderToFrequency = (value: number): number => {
    // Convert slider value (0-1) to frequency using logarithmic scale
    const minLog = Math.log10(20); // 20Hz
    const maxLog = Math.log10(20000); // 20kHz
    const freqLog = minLog + value * (maxLog - minLog);
    
    return Math.round(Math.pow(10, freqLog));
  };
  
  return (
    <Card className="w-full mt-4">
      <CardHeader>
        <CardTitle className="text-sm font-medium flex justify-between items-center">
          <span>Advanced Amplitude Curve</span>
          <Select 
            value={params.curveType} 
            onValueChange={(value) => updateParams({ curveType: value as any })}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Curve Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="parametric">Parametric</SelectItem>
              <SelectItem value="shelving">Shelving</SelectItem>
              <SelectItem value="notch">Notch</SelectItem>
              <SelectItem value="bandpass">Bandpass</SelectItem>
            </SelectContent>
          </Select>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="resonance">Resonance</TabsTrigger>
          </TabsList>
          
          <TabsContent value="basic" className="space-y-4">
            {/* Basic controls */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="lowEndGain">Low End (20Hz)</Label>
                <span className="text-sm text-muted-foreground">{formatGain(params.lowEndGain)}</span>
              </div>
              <Slider
                id="lowEndGain"
                min={-24}
                max={24}
                step={0.1}
                value={[params.lowEndGain]}
                onValueChange={(value) => updateParams({ lowEndGain: value[0] })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="midPointFreq">Midpoint Frequency</Label>
                <span className="text-sm text-muted-foreground">{formatFrequency(params.midPointFreq)}</span>
              </div>
              <Slider
                id="midPointFreq"
                min={0}
                max={1}
                step={0.001}
                value={[scaleFrequencyToSlider(params.midPointFreq)]}
                onValueChange={(value) => updateParams({ midPointFreq: scaleSliderToFrequency(value[0]) })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>20Hz</span>
                <span>1kHz</span>
                <span>20kHz</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="midPointGain">Midpoint Gain</Label>
                <span className="text-sm text-muted-foreground">{formatGain(params.midPointGain)}</span>
              </div>
              <Slider
                id="midPointGain"
                min={-24}
                max={24}
                step={0.1}
                value={[params.midPointGain]}
                onValueChange={(value) => updateParams({ midPointGain: value[0] })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="highEndGain">High End (20kHz)</Label>
                <span className="text-sm text-muted-foreground">{formatGain(params.highEndGain)}</span>
              </div>
              <Slider
                id="highEndGain"
                min={-24}
                max={24}
                step={0.1}
                value={[params.highEndGain]}
                onValueChange={(value) => updateParams({ highEndGain: value[0] })}
              />
            </div>
          </TabsContent>
          
          <TabsContent value="advanced" className="space-y-4">
            {/* Additional control points */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="lowMidFreq">Low-Mid Frequency</Label>
                <span className="text-sm text-muted-foreground">{formatFrequency(params.lowMidFreq)}</span>
              </div>
              <Slider
                id="lowMidFreq"
                min={0}
                max={1}
                step={0.001}
                value={[scaleFrequencyToSlider(params.lowMidFreq)]}
                onValueChange={(value) => updateParams({ lowMidFreq: scaleSliderToFrequency(value[0]) })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="lowMidGain">Low-Mid Gain</Label>
                <span className="text-sm text-muted-foreground">{formatGain(params.lowMidGain)}</span>
              </div>
              <Slider
                id="lowMidGain"
                min={-24}
                max={24}
                step={0.1}
                value={[params.lowMidGain]}
                onValueChange={(value) => updateParams({ lowMidGain: value[0] })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="highMidFreq">High-Mid Frequency</Label>
                <span className="text-sm text-muted-foreground">{formatFrequency(params.highMidFreq)}</span>
              </div>
              <Slider
                id="highMidFreq"
                min={0}
                max={1}
                step={0.001}
                value={[scaleFrequencyToSlider(params.highMidFreq)]}
                onValueChange={(value) => updateParams({ highMidFreq: scaleSliderToFrequency(value[0]) })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="highMidGain">High-Mid Gain</Label>
                <span className="text-sm text-muted-foreground">{formatGain(params.highMidGain)}</span>
              </div>
              <Slider
                id="highMidGain"
                min={-24}
                max={24}
                step={0.1}
                value={[params.highMidGain]}
                onValueChange={(value) => updateParams({ highMidGain: value[0] })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="curveShape">Curve Shape</Label>
                <span className="text-sm text-muted-foreground">
                  {params.curveShape < 0.5 ? 'Concave' : 'Convex'}
                </span>
              </div>
              <Slider
                id="curveShape"
                min={0}
                max={1}
                step={0.01}
                value={[params.curveShape]}
                onValueChange={(value) => updateParams({ curveShape: value[0] })}
              />
            </div>
          </TabsContent>
          
          <TabsContent value="resonance" className="space-y-4">
            {/* Resonance parameters */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="resonanceFreq">Resonance Frequency</Label>
                <span className="text-sm text-muted-foreground">{formatFrequency(params.resonanceFreq)}</span>
              </div>
              <Slider
                id="resonanceFreq"
                min={0}
                max={1}
                step={0.001}
                value={[scaleFrequencyToSlider(params.resonanceFreq)]}
                onValueChange={(value) => updateParams({ resonanceFreq: scaleSliderToFrequency(value[0]) })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="resonanceGain">Resonance Gain</Label>
                <span className="text-sm text-muted-foreground">{formatGain(params.resonanceGain)}</span>
              </div>
              <Slider
                id="resonanceGain"
                min={-24}
                max={24}
                step={0.1}
                value={[params.resonanceGain]}
                onValueChange={(value) => updateParams({ resonanceGain: value[0] })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="resonanceQ">Resonance Q</Label>
                <span className="text-sm text-muted-foreground">{params.resonanceQ.toFixed(1)}</span>
              </div>
              <Slider
                id="resonanceQ"
                min={0.1}
                max={10}
                step={0.1}
                value={[params.resonanceQ]}
                onValueChange={(value) => updateParams({ resonanceQ: value[0] })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Wide</span>
                <span>Narrow</span>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
} 