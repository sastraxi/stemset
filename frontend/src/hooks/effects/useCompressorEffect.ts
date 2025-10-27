import { useState, useRef, useEffect, useCallback } from 'react';

export interface CompressorConfig {
  threshold: number; // dB, -40 to 0
  attack: number; // seconds, 0.001 to 0.1
  release: number; // seconds, 0.01 to 1.0
  bodyBlend: number; // 0 to 1
  airBlend: number; // 0 to 1
  enabled: boolean;
}

export interface UseCompressorEffectOptions {
  audioContext: AudioContext | null;
  initialConfig?: CompressorConfig;
}

export interface UseCompressorEffectResult {
  isReady: boolean;
  inputNode: AudioWorkletNode | null;
  outputNode: GainNode | null;
  config: CompressorConfig;
  update: (changes: Partial<CompressorConfig>) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  gainReduction: number;
}

export const DEFAULT_COMPRESSOR_CONFIG: CompressorConfig = {
  threshold: -6,
  attack: 0.005,
  release: 0.1,
  bodyBlend: 0.0,
  airBlend: 0.1,
  enabled: true,
};

export function useCompressorEffect({
  audioContext,
  initialConfig,
}: UseCompressorEffectOptions): UseCompressorEffectResult {
  const [config, setConfig] = useState<CompressorConfig>(() => {
    return initialConfig || DEFAULT_COMPRESSOR_CONFIG;
  });

  const [isReady, setIsReady] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const makeupGainRef = useRef<GainNode | null>(null);
  const workletLoadedRef = useRef(false);
  const [gainReduction, setGainReduction] = useState(0);

  useEffect(() => {
    if (!audioContext || workletLoadedRef.current) return;

    async function loadWorklet() {
      try {
        if (!audioContext) {
          throw new Error('AudioContext is null');
        }

        await audioContext.audioWorklet.addModule('/airbody-compressor.js');
        workletLoadedRef.current = true;

        const node = new AudioWorkletNode(audioContext, 'airbody-compressor', { outputChannelCount: [2] });
        const makeupGain = audioContext.createGain();

        // Internal connection
        node.connect(makeupGain);

        node.port.onmessage = (event) => {
          if (event.data.type === 'gainReduction') {
            setGainReduction(event.data.value);
          }
        };

        workletNodeRef.current = node;
        makeupGainRef.current = makeupGain;
        setIsReady(true);
      } catch (error) {
        console.error('[useCompressorEffect] Failed to load AudioWorklet:', error);
      }
    }

    loadWorklet();

    return () => {
      workletNodeRef.current?.port.close();
      workletNodeRef.current?.disconnect();
      makeupGainRef.current?.disconnect();
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  useEffect(() => {
    if (!audioContext || !isReady || !workletNodeRef.current || !makeupGainRef.current) return;

    const { threshold, attack, release, bodyBlend, airBlend } = config;
    workletNodeRef.current.parameters.get('threshold')?.setTargetAtTime(threshold, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('attack')?.setTargetAtTime(attack, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('release')?.setTargetAtTime(release, audioContext.currentTime, 0.05);
    workletNodeRef.current.parameters.get('bodyBlend')?.setTargetAtTime(bodyBlend, audioContext.currentTime, 0.01);
    workletNodeRef.current.parameters.get('airBlend')?.setTargetAtTime(airBlend, audioContext.currentTime, 0.01);

    const makeupGainLinear = Math.pow(10, -threshold / 20);
    makeupGainRef.current.gain.setTargetAtTime(makeupGainLinear, audioContext.currentTime, 0.01);

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
    outputNode: makeupGainRef.current,
    config,
    update,
    reset,
    setEnabled,
    gainReduction,
  };
}
