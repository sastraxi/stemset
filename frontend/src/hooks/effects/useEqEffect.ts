import { useState, useRef, useEffect, useCallback } from "react";
import { useConfigKey } from "../useRecordingConfig";
import { EqBand, EqConfig } from "@/types";

export interface UseEqEffectOptions {
  audioContext: AudioContext | null;
  recordingId: string;
}

export interface UseEqEffectResult {
  isReady: boolean;
  inputNode: BiquadFilterNode | null; // First filter in the chain
  outputNode: BiquadFilterNode | null; // Last filter in the chain
  nodes: BiquadFilterNode[];
  config: EqConfig;
  updateBand: (
    id: string,
    changes: Partial<Pick<EqBand, "gain" | "frequency" | "q" | "type">>,
  ) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const DEFAULT_BANDS: EqBand[] = [
  { id: "low", frequency: 80, type: "lowshelf", gain: 0, q: 1 },
  { id: "lowmid", frequency: 250, type: "peaking", gain: 0, q: 1 },
  { id: "mid", frequency: 1000, type: "peaking", gain: 0, q: 1 },
  { id: "highmid", frequency: 3500, type: "peaking", gain: 0, q: 1 },
  { id: "high", frequency: 10000, type: "highshelf", gain: 0, q: 1 },
];

export const DEFAULT_EQ_CONFIG: EqConfig = {
  bands: DEFAULT_BANDS,
  enabled: true,
};

export function useEqEffect({
  audioContext,
  recordingId,
}: UseEqEffectOptions): UseEqEffectResult {
  // Persist config directly to database
  const { config, setConfig } = useConfigKey(
    recordingId,
    "eq",
    DEFAULT_EQ_CONFIG,
    500,
  );

  const [isReady, setIsReady] = useState(false);
  const nodesRef = useRef<BiquadFilterNode[]>([]);

  // Create filter nodes once when audioContext is available
  useEffect(() => {
    if (!audioContext || nodesRef.current.length > 0) return;

    const createdNodes = config.bands.map((b) => {
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
      createdNodes.forEach((f) => {
        try {
          f.disconnect();
        } catch {}
      });
      setIsReady(false);
      nodesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  // Update filter parameters when config changes
  useEffect(() => {
    if (!audioContext || !isReady) return;

    config.bands.forEach((b, i) => {
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
  }, [config.bands, audioContext, isReady]);

  const updateBand = useCallback(
    (
      id: string,
      changes: Partial<Pick<EqBand, "gain" | "frequency" | "q" | "type">>,
    ) => {
      setConfig((prev) => ({
        ...prev,
        bands: prev.bands.map((b) => (b.id === id ? { ...b, ...changes } : b)),
      }));
    },
    [],
  );

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig((prev) => ({ ...prev, enabled }));
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_EQ_CONFIG);
  }, []);

  return {
    isReady,
    inputNode: nodesRef.current[0] || null,
    outputNode: nodesRef.current[nodesRef.current.length - 1] || null,
    nodes: nodesRef.current,
    config,
    updateBand,
    setEnabled,
    reset,
  };
}
