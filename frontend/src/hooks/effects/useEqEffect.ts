import { useState, useRef, useCallback, useEffect } from 'react';

export interface EqBand {
  id: string;
  frequency: number;
  type: BiquadFilterType;
  gain: number;
  q: number;
}

export interface EqSettings {
  bands: EqBand[];
  enabled: boolean;
}

export interface UseEqEffectOptions {
  audioContext: AudioContext | null;
  initialConfig?: unknown;
}

export interface UseEqEffectResult {
  isReady: boolean;
  inputNode: AudioNode | null; // Connect audio TO here (first filter)
  outputNode: AudioNode | null; // Connect audio FROM here (last filter)
  settings: EqSettings;
  updateBand: (id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
  getConfig: () => unknown;
  setConfig: (config: unknown) => void;
}

const DEFAULT_BANDS: EqBand[] = [
  { id: 'low', frequency: 80, type: 'lowshelf', gain: 0, q: 1 },
  { id: 'lowmid', frequency: 250, type: 'peaking', gain: 0, q: 1 },
  { id: 'mid', frequency: 1000, type: 'peaking', gain: 0, q: 1 },
  { id: 'highmid', frequency: 3500, type: 'peaking', gain: 0, q: 1 },
  { id: 'high', frequency: 10000, type: 'highshelf', gain: 0, q: 1 },
];

/**
 * EQ effect hook using BiquadFilter nodes.
 *
 * Manages 5-band graphic EQ with per-recording settings.
 */
export function useEqEffect({
  audioContext,
  initialConfig,
}: UseEqEffectOptions): UseEqEffectResult {
  const [isReady, setIsReady] = useState(false);
  const nodesRef = useRef<BiquadFilterNode[]>([]);

  // Initialize settings from config or defaults
  const [settings, setSettings] = useState<EqSettings>(() => {
    if (initialConfig && typeof initialConfig === 'object' && initialConfig !== null) {
      const config = initialConfig as EqSettings;
      if (config.bands && config.enabled !== undefined) {
        return config;
      }
    }
    return { bands: DEFAULT_BANDS, enabled: true };
  });

  // Create and connect filter nodes when audioContext becomes available
  useEffect(() => {
    if (!audioContext) return;

    // Create filters if not already created
    if (nodesRef.current.length === 0) {
      nodesRef.current = settings.bands.map(b => {
        const f = audioContext.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.frequency;
        f.Q.value = b.q;
        f.gain.value = b.gain;
        return f;
      });

      // Chain the filters together
      for (let i = 0; i < nodesRef.current.length - 1; i++) {
        nodesRef.current[i].connect(nodesRef.current[i + 1]);
      }
      setIsReady(true);
    }

    return () => {
      // Cleanup on unmount
      nodesRef.current.forEach(f => {
        try {
          f.disconnect();
        } catch {}
      });
      setIsReady(false);
    };
    // Only depend on audioContext - don't recreate filters on settings changes!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  // Update filter parameters when settings change
  useEffect(() => {
    if (!audioContext || !isReady) return;

    settings.bands.forEach((b, i) => {
      const f = nodesRef.current[i];
      if (!f) return;

      const targetGain = settings.enabled ? b.gain : 0;
      f.gain.setTargetAtTime(targetGain, audioContext.currentTime, 0.01);

      if (settings.enabled) {
        f.type = b.type;
        f.frequency.setTargetAtTime(b.frequency, audioContext.currentTime, 0.01);
        f.Q.setTargetAtTime(b.q, audioContext.currentTime, 0.01);
      }
    });
  }, [settings, audioContext, isReady]);

  const updateBand = useCallback((id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => {
    setSettings(prev => ({
      ...prev,
      bands: prev.bands.map(b => b.id === id ? { ...b, ...changes } : b)
    }));
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, enabled }));
  }, []);

  const reset = useCallback(() => {
    setSettings({ bands: DEFAULT_BANDS, enabled: true });
  }, []);

  const getConfig = useCallback(() => {
    return settings;
  }, [settings]);

  const setConfig = useCallback((config: unknown) => {
    if (config && typeof config === 'object' && config !== null) {
      const eqConfig = config as EqSettings;
      if (eqConfig.bands && eqConfig.enabled !== undefined) {
        setSettings(eqConfig);
      }
    }
  }, []);

  return {
    isReady,
    inputNode: nodesRef.current[0] || null, // First filter in chain
    outputNode: nodesRef.current[nodesRef.current.length - 1] || null, // Last filter in chain
    settings,
    updateBand,
    setEnabled,
    reset,
    getConfig,
    setConfig,
  };
}
