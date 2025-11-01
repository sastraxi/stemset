import { useState, useRef, useEffect, useCallback } from 'react';
import { useConfigPersistence } from '../useConfigPersistence';
import { StereoExpanderConfig } from '@/types';

export interface UseStereoExpanderEffectOptions {
  audioContext: AudioContext | null;
  recordingId: string;
}

export interface UseStereoExpanderEffectResult {
  isReady: boolean;
  inputNode: AudioWorkletNode | null;
  outputNode: AudioWorkletNode | null;
  config: StereoExpanderConfig;
  update: (changes: Partial<StereoExpanderConfig>) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const DEFAULT_STEREO_EXPANDER_CONFIG: StereoExpanderConfig = {
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
  recordingId,
}: UseStereoExpanderEffectOptions): UseStereoExpanderEffectResult {
  // Persist config directly to database
  const { config, setConfig } = useConfigPersistence({
    recordingId,
    configKey: 'stereoExpander',
    defaultValue: DEFAULT_STEREO_EXPANDER_CONFIG,
    debounceMs: 500,
  });

  const [isReady, setIsReady] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);

  useEffect(() => {
    if (!audioContext || workletLoadedRef.current) return;

    async function loadWorklet() {
      try {
        if (!audioContext) return;

        await audioContext.audioWorklet.addModule('/multiband-stereo-expander.js');
        workletLoadedRef.current = true;

        const node = new AudioWorkletNode(audioContext, 'multiband-stereo-expander', { outputChannelCount: [2] });

        // Create a simple synthetic reverb impulse response
        // This creates a basic hall reverb simulation
        const reverbLength = Math.floor(audioContext.sampleRate * 0.5); // 5000ms reverb tail
        const reverbBuffer = new Float32Array(reverbLength);

        for (let i = 0; i < reverbLength; i++) {
          // Exponential decay with some randomness for diffusion
          const decay = Math.exp(-3 * i / reverbLength);
          const diffusion = (Math.random() - 0.5) * 0.1;
          reverbBuffer[i] = decay * (0.8 + diffusion);
        }

        // Send the reverb buffer to the worklet
        node.port.postMessage({ reverbBuffer });

        workletNodeRef.current = node;
        setIsReady(true);
      } catch (error) {
        console.error('[useStereoExpanderEffect] Failed to load AudioWorklet:', error);
        console.error('[useStereoExpanderEffect] AudioContext state:', audioContext?.state);
        console.error('[useStereoExpanderEffect] AudioContext sample rate:', audioContext?.sampleRate);
        console.error('[useStereoExpanderEffect] Worklet loaded ref:', workletLoadedRef.current);
        console.error('[useStereoExpanderEffect] Error details:', {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : 'No stack trace'
        });
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

    const { lowMidCrossover, midHighCrossover, expLow, compLow, expMid, compMid, expHigh, compHigh } = config;
    workletNodeRef.current.parameters.get('lowMidCrossover')?.setTargetAtTime(lowMidCrossover, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('midHighCrossover')?.setTargetAtTime(midHighCrossover, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('expLow')?.setTargetAtTime(expLow, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('compLow')?.setTargetAtTime(compLow, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('expMid')?.setTargetAtTime(expMid, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('compMid')?.setTargetAtTime(compMid, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('expHigh')?.setTargetAtTime(expHigh, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('compHigh')?.setTargetAtTime(compHigh, audioContext.currentTime, 0.01);
  }, [config, audioContext, isReady]);

  const update = useCallback((changes: Partial<StereoExpanderConfig>) => {
    setConfig(prev => ({ ...prev, ...changes }));
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_STEREO_EXPANDER_CONFIG);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig(prev => ({ ...prev, enabled }));
  }, []);

  return {
    isReady,
    inputNode: workletNodeRef.current,
    outputNode: workletNodeRef.current,
    config: {
      ...config,
      // FIXME: Disable the effect until it's fully implemented
      enabled: false,
    },
    update,
    reset,
    setEnabled,
  };
}
