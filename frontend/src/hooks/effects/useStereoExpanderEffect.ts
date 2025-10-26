import { useState, useRef, useEffect, useCallback } from 'react';

export interface StereoExpanderSettings {
  lowMidCrossover: number; // Hz, 50 to 2000
  midHighCrossover: number; // Hz, 800 to 12000
  expLow: number; // 0.5 to 2.0 (1.0 = unchanged)
  compLow: number; // 0 to 1
  expMid: number; // 0.5 to 2.0
  compMid: number; // 0 to 1
  expHigh: number; // 0.5 to 2.0
  compHigh: number; // 0 to 1
  enabled: boolean;
}

export interface UseStereoExpanderEffectOptions {
  audioContext: AudioContext | null;
  initialConfig?: unknown;
}

export interface UseStereoExpanderEffectResult {
  isReady: boolean;
  inputNode: AudioWorkletNode | null;
  outputNode: AudioWorkletNode | null;
  settings: StereoExpanderSettings;
  update: (changes: Partial<StereoExpanderSettings>) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
}

const DEFAULT_SETTINGS: StereoExpanderSettings = {
  lowMidCrossover: 300,
  midHighCrossover: 3000,
  expLow: 1.0,
  compLow: 0.2,
  expMid: 1.2,
  compMid: 0.3,
  expHigh: 1.6,
  compHigh: 0.1,
  enabled: false,
};

export function useStereoExpanderEffect({
  audioContext,
  initialConfig,
}: UseStereoExpanderEffectOptions): UseStereoExpanderEffectResult {
  const [settings, setSettings] = useState<StereoExpanderSettings>(() => {
    if (initialConfig && typeof initialConfig === 'object' && initialConfig !== null) {
      const config = initialConfig as StereoExpanderSettings;
      if (typeof config.lowMidCrossover === 'number') {
        return { ...DEFAULT_SETTINGS, ...config };
      }
    }
    return DEFAULT_SETTINGS;
  });

  const [isReady, setIsReady] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);

  useEffect(() => {
    if (!audioContext || workletLoadedRef.current) return;

    async function loadWorklet() {
      try {
        await audioContext.audioWorklet.addModule('/multiband-stereo-expander.js');
        workletLoadedRef.current = true;

        const node = new AudioWorkletNode(audioContext, 'multiband-stereo-expander', { outputChannelCount: [2] });

        workletNodeRef.current = node;
        setIsReady(true);
      } catch (error) {
        console.error('[useStereoExpanderEffect] Failed to load AudioWorklet:', error);
      }
    }

    loadWorklet();

    return () => {
      workletNodeRef.current?.disconnect();
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  useEffect(() => {
    if (!audioContext || !isReady || !workletNodeRef.current) return;

    const { lowMidCrossover, midHighCrossover, expLow, compLow, expMid, compMid, expHigh, compHigh } = settings;
    workletNodeRef.current.parameters.get('lowMidCrossover')?.setTargetAtTime(lowMidCrossover, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('midHighCrossover')?.setTargetAtTime(midHighCrossover, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('expLow')?.setTargetAtTime(expLow, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('compLow')?.setTargetAtTime(compLow, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('expMid')?.setTargetAtTime(expMid, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('compMid')?.setTargetAtTime(compMid, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('expHigh')?.setTargetAtTime(expHigh, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('compHigh')?.setTargetAtTime(compHigh, audioContext.currentTime, 0.01);
  }, [settings, audioContext, isReady]);

  const update = useCallback((changes: Partial<StereoExpanderSettings>) => {
    setSettings(prev => ({ ...prev, ...changes }));
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, enabled }));
  }, []);

  return {
    isReady,
    inputNode: workletNodeRef.current,
    outputNode: workletNodeRef.current,
    settings,
    update,
    reset,
    setEnabled,
  };
}
