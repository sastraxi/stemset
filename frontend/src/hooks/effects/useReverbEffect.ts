import { useState, useRef, useCallback, useEffect } from 'react';

export interface ReverbSettings {
  mix: number; // 0 to 1
  decay: number; // 0.1 to 2.0 seconds
  satAmount: number; // 0.1 to 3.0
  enabled: boolean;
}

export interface UseReverbEffectOptions {
  audioContext: AudioContext | null;
  initialConfig?: unknown;
}

export interface UseReverbEffectResult {
  isReady: boolean;
  inputNode: AudioNode | null; // Connect audio TO here
  outputNode: AudioNode | null; // Connect audio FROM here (same as inputNode)
  settings: ReverbSettings;
  update: (changes: Partial<ReverbSettings>) => void;
  reset: () => void;
  getConfig: () => unknown;
  setConfig: (config: unknown) => void;
}

const DEFAULT_SETTINGS: ReverbSettings = {
  mix: 0.3,
  decay: 0.6,
  satAmount: 1.5,
  enabled: false,
};

/**
 * Plate Reverb with Saturation effect hook using AudioWorklet.
 *
 * Provides plate-style reverb with harmonic saturation.
 */
export function useReverbEffect({
  audioContext,
  initialConfig,
}: UseReverbEffectOptions): UseReverbEffectResult {
  const [isReady, setIsReady] = useState(false);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);

  // Initialize settings from config or defaults
  const [settings, setSettings] = useState<ReverbSettings>(() => {
    if (initialConfig && typeof initialConfig === 'object' && initialConfig !== null) {
      const config = initialConfig as ReverbSettings;
      if (
        typeof config.mix === 'number' &&
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
        await audioContext.audioWorklet.addModule('/plate-reverb-saturation.js');
        workletLoadedRef.current = true;

        // Create the AudioWorkletNode with stereo output
        const node = new AudioWorkletNode(audioContext, 'plate-reverb-saturator', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        // Set initial parameters (clamped to valid ranges)
        const clampedMix = Math.max(0, Math.min(1, settings.mix));
        const clampedDecay = Math.max(0.1, Math.min(2.0, settings.decay));
        const clampedSatAmount = Math.max(0.1, Math.min(3.0, settings.satAmount));

        node.parameters.get('mix')?.setValueAtTime(clampedMix, audioContext.currentTime);
        node.parameters.get('decay')?.setValueAtTime(clampedDecay, audioContext.currentTime);
        node.parameters.get('satAmount')?.setValueAtTime(clampedSatAmount, audioContext.currentTime);

        nodeRef.current = node;
        setIsReady(true);
      } catch (error) {
        console.error('[useReverbEffect] Failed to load AudioWorklet:', error);
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
      setIsReady(false);
    };
    // Only depend on audioContext - don't recreate on settings changes!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  // Update parameters when settings change
  useEffect(() => {
    if (!audioContext || !nodeRef.current) return;

    const node = nodeRef.current;
    node.parameters.get('mix')?.setTargetAtTime(settings.mix, audioContext.currentTime, 0.01);
    node.parameters.get('decay')?.setTargetAtTime(settings.decay, audioContext.currentTime, 0.05);
    node.parameters.get('satAmount')?.setTargetAtTime(settings.satAmount, audioContext.currentTime, 0.01);
  }, [settings, audioContext]);

  const update = useCallback((changes: Partial<ReverbSettings>) => {
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
      const reverbConfig = config as ReverbSettings;
      if (typeof reverbConfig.mix === 'number' && typeof reverbConfig.enabled === 'boolean') {
        setSettings({ ...DEFAULT_SETTINGS, ...reverbConfig });
      }
    }
  }, []);

  return {
    isReady,
    inputNode: nodeRef.current,
    outputNode: nodeRef.current, // Same node for simple effects
    settings,
    update,
    reset,
    getConfig,
    setConfig,
  };
}
