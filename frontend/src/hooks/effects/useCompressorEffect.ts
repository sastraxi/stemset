import { useState, useRef, useEffect, useCallback } from 'react';
import { useConfigPersistence } from '../useConfigPersistence';
import { CompressorConfig } from '@/types';

export interface UseCompressorEffectOptions {
  audioContext: AudioContext | null;
  recordingId: string;
}

export interface UseCompressorEffectResult {
  isReady: boolean;
  inputNode: AudioWorkletNode | null;
  outputNode: AudioWorkletNode | null;
  config: CompressorConfig;
  update: (changes: Partial<CompressorConfig>) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  gainReduction: number;
}

export const DEFAULT_COMPRESSOR_CONFIG: CompressorConfig = {
  threshold: -6,
  attack: 0.005,
  hold: 0.02,
  release: 0.1,
  enabled: false,
};

export function useCompressorEffect({
  audioContext,
  recordingId,
}: UseCompressorEffectOptions): UseCompressorEffectResult {
  // Persist config directly to database
  const { config, setConfig } = useConfigPersistence({
    recordingId,
    configKey: 'compressor',
    defaultValue: DEFAULT_COMPRESSOR_CONFIG,
    debounceMs: 500,
  });

  const [isReady, setIsReady] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);
  const [gainReduction, setGainReduction] = useState(0);

  useEffect(() => {
    if (!audioContext || workletLoadedRef.current) return;

    async function loadWorklet() {
      try {
        if (!audioContext) {
          throw new Error('AudioContext is null');
        }

        await audioContext.audioWorklet.addModule('/limiter-processor.js');
        workletLoadedRef.current = true;

        const node = new AudioWorkletNode(audioContext, 'master-limiter-processor', { outputChannelCount: [2] });

        node.port.onmessage = (event) => {
          if (event.data.type === 'gainReduction') {
            setGainReduction(event.data.value);
          }
        };

        workletNodeRef.current = node;
        setIsReady(true);
      } catch (error) {
        console.error('[useCompressorEffect] Failed to load AudioWorklet:', error);
        console.error('[useCompressorEffect] AudioContext state:', audioContext?.state);
        console.error('[useCompressorEffect] AudioContext sample rate:', audioContext?.sampleRate);
        console.error('[useCompressorEffect] Worklet loaded ref:', workletLoadedRef.current);
        console.error('[useCompressorEffect] Error details:', {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : 'No stack trace'
        });
      }
    }

    loadWorklet();

    return () => {
      workletNodeRef.current?.port.close();
      workletNodeRef.current?.disconnect();
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  useEffect(() => {
    if (!audioContext || !isReady || !workletNodeRef.current) return;

    const { threshold, attack, hold, release } = config;
    workletNodeRef.current.parameters.get('threshold')?.setTargetAtTime(threshold, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('attack')?.setTargetAtTime(attack, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('hold')?.setTargetAtTime(hold, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('release')?.setTargetAtTime(release, audioContext.currentTime, 0.01);

    // Auto makeup gain: compensate for threshold reduction (industry standard formula)
    const autoMakeupGainDb = -threshold;
    workletNodeRef.current.parameters.get('makeupGain')?.setTargetAtTime(autoMakeupGainDb, audioContext.currentTime, 0.01);

    if (!config.enabled) {
      setGainReduction(0);
    }
  }, [config, audioContext, isReady]);

  const update = useCallback((changes: Partial<CompressorConfig>) => {
    setConfig(prev => ({ ...prev, ...changes }));
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_COMPRESSOR_CONFIG);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig(prev => ({ ...prev, enabled }));
  }, []);

  return {
    isReady,
    inputNode: workletNodeRef.current,
    outputNode: workletNodeRef.current,
    config,
    update,
    reset,
    setEnabled,
    gainReduction,
  };
}
