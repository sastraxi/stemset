import { useState, useRef, useEffect, useCallback } from 'react';

export interface ReverbConfig {
  mix: number; // 0 to 1
  decay: number; // 0.1 to 2.0 seconds
  satAmount: number; // 0.1 to 3.0
  enabled: boolean;
}

export interface UseReverbEffectOptions {
  audioContext: AudioContext | null;
  initialConfig?: ReverbConfig;
}

export interface UseReverbEffectResult {
  isReady: boolean;
  inputNode: AudioWorkletNode | null;
  outputNode: AudioWorkletNode | null;
  config: ReverbConfig;
  update: (changes: Partial<ReverbConfig>) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
}

const DEFAULT_CONFIG: ReverbConfig = {
  mix: 0.3,
  decay: 0.6,
  satAmount: 1.5,
  enabled: false,
};

export function useReverbEffect({
  audioContext,
  initialConfig,
}: UseReverbEffectOptions): UseReverbEffectResult {
  const [config, setConfig] = useState<ReverbConfig>(() => {
    return initialConfig || DEFAULT_CONFIG;
  });

  const [isReady, setIsReady] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);

  useEffect(() => {
    if (!audioContext || workletLoadedRef.current) return;

    async function loadWorklet() {
      try {
        if (!audioContext) return;

        await audioContext.audioWorklet.addModule('/plate-reverb-saturation.js');
        workletLoadedRef.current = true;

        const node = new AudioWorkletNode(audioContext, 'plate-reverb-saturator', { outputChannelCount: [2] });

        workletNodeRef.current = node;
        setIsReady(true);
      } catch (error) {
        console.error('[useReverbEffect] Failed to load AudioWorklet:', error);
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

    const { mix, decay, satAmount } = config;
    workletNodeRef.current.parameters.get('mix')?.setTargetAtTime(mix, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('decay')?.setTargetAtTime(decay, audioContext.currentTime, 0.05);
    workletNodeRef.current.parameters.get('satAmount')?.setTargetAtTime(satAmount, audioContext.currentTime, 0.01);
  }, [config, audioContext, isReady]);

  const update = useCallback((changes: Partial<ReverbConfig>) => {
    setConfig(prev => ({ ...prev, ...changes }));
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig(prev => ({ ...prev, enabled }));
  }, []);

  return {
    isReady,
    inputNode: workletNodeRef.current,
    outputNode: workletNodeRef.current, // For this simple effect, input and output are the same node
    config,
    update,
    reset,
    setEnabled,
  };
}
