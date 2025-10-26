import { useState, useRef, useCallback, useEffect } from 'react';

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
  node: AudioWorkletNode | null;
  settings: StereoExpanderSettings;
  update: (changes: Partial<StereoExpanderSettings>) => void;
  reset: () => void;
  getConfig: () => unknown;
  setConfig: (config: unknown) => void;
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

/**
 * Multi-band Stereo Expander effect hook using AudioWorklet.
 *
 * Provides independent stereo width and compression control per frequency band.
 */
export function useStereoExpanderEffect({
  audioContext,
  initialConfig,
}: UseStereoExpanderEffectOptions): UseStereoExpanderEffectResult {
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);

  // Initialize settings from config or defaults
  const [settings, setSettings] = useState<StereoExpanderSettings>(() => {
    if (initialConfig && typeof initialConfig === 'object' && initialConfig !== null) {
      const config = initialConfig as StereoExpanderSettings;
      if (
        typeof config.lowMidCrossover === 'number' &&
        typeof config.enabled === 'boolean'
      ) {
        return { ...DEFAULT_SETTINGS, ...config };
      }
    }
    return DEFAULT_SETTINGS;
  });

  // Load AudioWorklet module and create node
  useEffect(() => {
    if (!audioContext) return;

    async function loadWorklet() {
      if (!audioContext || workletLoadedRef.current) return;

      try {
        await audioContext.audioWorklet.addModule('/multiband-stereo-expander.js');
        workletLoadedRef.current = true;

        // Create the AudioWorkletNode with stereo output (REQUIRED for stereo processing!)
        const node = new AudioWorkletNode(audioContext, 'multiband-stereo-expander', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        // Set initial parameters (clamped to valid ranges)
        const clampedLowMid = Math.max(50, Math.min(2000, settings.lowMidCrossover));
        const clampedMidHigh = Math.max(800, Math.min(12000, settings.midHighCrossover));
        const clampedExpLow = Math.max(0.5, Math.min(2.0, settings.expLow));
        const clampedCompLow = Math.max(0, Math.min(1, settings.compLow));
        const clampedExpMid = Math.max(0.5, Math.min(2.0, settings.expMid));
        const clampedCompMid = Math.max(0, Math.min(1, settings.compMid));
        const clampedExpHigh = Math.max(0.5, Math.min(2.0, settings.expHigh));
        const clampedCompHigh = Math.max(0, Math.min(1, settings.compHigh));

        node.parameters.get('lowMidCrossover')?.setValueAtTime(clampedLowMid, audioContext.currentTime);
        node.parameters.get('midHighCrossover')?.setValueAtTime(clampedMidHigh, audioContext.currentTime);
        node.parameters.get('expLow')?.setValueAtTime(clampedExpLow, audioContext.currentTime);
        node.parameters.get('compLow')?.setValueAtTime(clampedCompLow, audioContext.currentTime);
        node.parameters.get('expMid')?.setValueAtTime(clampedExpMid, audioContext.currentTime);
        node.parameters.get('compMid')?.setValueAtTime(clampedCompMid, audioContext.currentTime);
        node.parameters.get('expHigh')?.setValueAtTime(clampedExpHigh, audioContext.currentTime);
        node.parameters.get('compHigh')?.setValueAtTime(clampedCompHigh, audioContext.currentTime);

        nodeRef.current = node;
      } catch (error) {
        console.error('[useStereoExpanderEffect] Failed to load AudioWorklet:', error);
      }
    }

    loadWorklet();

    return () => {
      if (nodeRef.current) {
        try {
          nodeRef.current.disconnect();
        } catch {}
        nodeRef.current = null;
      }
    };
    // Only depend on audioContext - don't recreate on settings changes!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  // Update parameters when settings change
  useEffect(() => {
    if (!audioContext || !nodeRef.current) return;

    const node = nodeRef.current;
    node.parameters.get('lowMidCrossover')?.setTargetAtTime(settings.lowMidCrossover, audioContext.currentTime, 0.01);
    node.parameters.get('midHighCrossover')?.setTargetAtTime(settings.midHighCrossover, audioContext.currentTime, 0.01);
    node.parameters.get('expLow')?.setTargetAtTime(settings.expLow, audioContext.currentTime, 0.01);
    node.parameters.get('compLow')?.setTargetAtTime(settings.compLow, audioContext.currentTime, 0.01);
    node.parameters.get('expMid')?.setTargetAtTime(settings.expMid, audioContext.currentTime, 0.01);
    node.parameters.get('compMid')?.setTargetAtTime(settings.compMid, audioContext.currentTime, 0.01);
    node.parameters.get('expHigh')?.setTargetAtTime(settings.expHigh, audioContext.currentTime, 0.01);
    node.parameters.get('compHigh')?.setTargetAtTime(settings.compHigh, audioContext.currentTime, 0.01);
  }, [settings, audioContext]);

  const update = useCallback((changes: Partial<StereoExpanderSettings>) => {
    setSettings(prev => ({ ...prev, ...changes }));
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const getConfig = useCallback(() => {
    return settings;
  }, [settings]);

  const setConfig = useCallback((config: unknown) => {
    if (config && typeof config === 'object' && config !== null) {
      const expanderConfig = config as StereoExpanderSettings;
      if (typeof expanderConfig.lowMidCrossover === 'number' && typeof expanderConfig.enabled === 'boolean') {
        setSettings({ ...DEFAULT_SETTINGS, ...expanderConfig });
      }
    }
  }, []);

  return {
    node: nodeRef.current,
    settings,
    update,
    reset,
    getConfig,
    setConfig,
  };
}
