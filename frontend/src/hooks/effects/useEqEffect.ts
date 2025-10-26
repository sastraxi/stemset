import { useState, useRef, useEffect, useCallback } from 'react';

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
  inputNode: BiquadFilterNode | null; // First filter in the chain
  outputNode: BiquadFilterNode | null; // Last filter in the chain
  nodes: BiquadFilterNode[];
  settings: EqSettings;
  updateBand: (id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const DEFAULT_BANDS: EqBand[] = [
  { id: 'low', frequency: 80, type: 'lowshelf', gain: 0, q: 1 },
  { id: 'lowmid', frequency: 250, type: 'peaking', gain: 0, q: 1 },
  { id: 'mid', frequency: 1000, type: 'peaking', gain: 0, q: 1 },
  { id: 'highmid', frequency: 3500, type: 'peaking', gain: 0, q: 1 },
  { id: 'high', frequency: 10000, type: 'highshelf', gain: 0, q: 1 },
];

const DEFAULT_SETTINGS: EqSettings = {
  bands: DEFAULT_BANDS,
  enabled: true,
};

export function useEqEffect({
  audioContext,
  initialConfig,
}: UseEqEffectOptions): UseEqEffectResult {
  const [settings, setSettings] = useState<EqSettings>(() => {
    if (initialConfig && typeof initialConfig === 'object' && initialConfig !== null) {
      const config = initialConfig as EqSettings;
      if (config.bands && config.enabled !== undefined) {
        return config;
      }
    }
    return DEFAULT_SETTINGS;
  });

  const [isReady, setIsReady] = useState(false);
  const nodesRef = useRef<BiquadFilterNode[]>([]);

  // Create filter nodes once when audioContext is available
  useEffect(() => {
    if (!audioContext || nodesRef.current.length > 0) return;

    const createdNodes = settings.bands.map(b => {
      const f = audioContext.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.frequency;
      f.Q.value = b.q;
      f.gain.value = b.gain;
      return f;
    });

    // Chain the filters together internally, once.
    for (let i = 0; i < createdNodes.length - 1; i++) {
      createdNodes[i].connect(createdNodes[i + 1]);
    }

    nodesRef.current = createdNodes;
    setIsReady(true);

    return () => {
      createdNodes.forEach(f => { try { f.disconnect(); } catch {} });
      setIsReady(false);
      nodesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  // Update filter parameters when settings change
  useEffect(() => {
    if (!audioContext || !isReady) return;

    settings.bands.forEach((b, i) => {
      const f = nodesRef.current[i];
      if (!f) return;
      // When the effect is disabled, the orchestrator will bypass it entirely.
      // Here, we just set the parameters regardless of the enabled state.
      // The gain will be whatever the user has set it to.
      f.gain.setTargetAtTime(b.gain, audioContext.currentTime, 0.01);
      f.type = b.type;
      f.frequency.setTargetAtTime(b.frequency, audioContext.currentTime, 0.01);
      f.Q.setTargetAtTime(b.q, audioContext.currentTime, 0.01);
    });
  }, [settings.bands, audioContext, isReady]);

  const updateBand = useCallback((id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => {
    setSettings(prev => ({ ...prev, bands: prev.bands.map(b => b.id === id ? { ...b, ...changes } : b) }));
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, enabled }));
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    isReady,
    inputNode: nodesRef.current[0] || null,
    outputNode: nodesRef.current[nodesRef.current.length - 1] || null,
    nodes: nodesRef.current,
    settings,
    updateBand,
    setEnabled,
    reset,
  };
}
