import { useState, useRef, useCallback, useEffect } from 'react';

export interface CompressorSettings {
  threshold: number; // dB, -40 to 0
  attack: number; // seconds, 0.001 to 0.1
  release: number; // seconds, 0.01 to 1.0
  bodyBlend: number; // 0 to 1
  airBlend: number; // 0 to 1
  enabled: boolean;
}

export interface UseCompressorEffectOptions {
  audioContext: AudioContext | null;
  initialConfig?: unknown;
}

export interface UseCompressorEffectResult {
  isReady: boolean;
  inputNode: AudioNode | null; // Where to connect audio TO
  outputNode: AudioNode | null; // Where to connect audio FROM
  settings: CompressorSettings;
  update: (changes: Partial<CompressorSettings>) => void;
  reset: () => void;
  getConfig: () => unknown;
  setConfig: (config: unknown) => void;
  gainReduction: number;
}

const DEFAULT_SETTINGS: CompressorSettings = {
  threshold: -6,
  attack: 0.005,
  release: 0.1,
  bodyBlend: 0.0,  // 0 = no body processing, 1 = full body processing
  airBlend: 0.1,   // 0 = no air processing, 1 = full air processing
  enabled: true,
};

/**
 * AirBody Compressor effect hook using AudioWorklet.
 *
 * Multi-band compressor/limiter with "body" and "air" characteristics.
 */
export function useCompressorEffect({
  audioContext,
  initialConfig,
}: UseCompressorEffectOptions): UseCompressorEffectResult {
  const [isReady, setIsReady] = useState(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const makeupGainRef = useRef<GainNode | null>(null);
  const workletLoadedRef = useRef(false);
  const [gainReduction, setGainReduction] = useState(0);

  // Initialize settings from config or defaults
  const [settings, setSettings] = useState<CompressorSettings>(() => {
    if (initialConfig && typeof initialConfig === 'object' && initialConfig !== null) {
      const config = initialConfig as CompressorSettings;
      if (
        typeof config.threshold === 'number' &&
        typeof config.enabled === 'boolean'
      ) {
        return { ...DEFAULT_SETTINGS, ...config };
      }
    }
    return DEFAULT_SETTINGS;
  });

  // Load AudioWorklet module and create nodes when audioContext becomes available
  useEffect(() => {
    if (!audioContext) return;

    async function loadWorklet() {
      if (!audioContext || workletLoadedRef.current) return;

      try {
        await audioContext.audioWorklet.addModule('/airbody-compressor.js');
        workletLoadedRef.current = true;

        // Create the AudioWorkletNode with stereo output
        const node = new AudioWorkletNode(audioContext, 'airbody-compressor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        // Set initial parameters (clamped to valid ranges)
        const clampedThreshold = Math.max(-40, Math.min(0, settings.threshold));
        const clampedAttack = Math.max(0.001, Math.min(0.1, settings.attack));
        const clampedRelease = Math.max(0.01, Math.min(1.0, settings.release));
        const clampedBodyBlend = Math.max(0, Math.min(1, settings.bodyBlend));
        const clampedAirBlend = Math.max(0, Math.min(1, settings.airBlend));

        node.parameters.get('threshold')?.setValueAtTime(clampedThreshold, audioContext.currentTime);
        node.parameters.get('attack')?.setValueAtTime(clampedAttack, audioContext.currentTime);
        node.parameters.get('release')?.setValueAtTime(clampedRelease, audioContext.currentTime);
        node.parameters.get('bodyBlend')?.setValueAtTime(clampedBodyBlend, audioContext.currentTime);
        node.parameters.get('airBlend')?.setValueAtTime(clampedAirBlend, audioContext.currentTime);

        // Create makeup gain node (comes after the compressor)
        const makeupGain = audioContext.createGain();
        // Apply constant makeup gain based on threshold
        const makeupGainLinear = Math.pow(10, -clampedThreshold / 20);
        makeupGain.gain.value = makeupGainLinear;
        node.connect(makeupGain);

        // Listen for gain reduction messages with throttling
        let lastUpdate = 0;
        let smoothReduction = 0;
        const alpha = 0.3;

        node.port.onmessage = (event) => {
          if (event.data.type === 'gainReduction') {
            const now = performance.now();
            const rawReduction = event.data.value;

            // Smooth the gain reduction value
            smoothReduction = smoothReduction === 0 ? rawReduction : smoothReduction * (1 - alpha) + rawReduction * alpha;

            // Throttle UI updates to ~30fps to prevent excessive React updates
            if (now - lastUpdate > 33) {
              setGainReduction(smoothReduction);
              lastUpdate = now;
            }
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
      // Cleanup on unmount
      if (workletNodeRef.current) {
        try {
          workletNodeRef.current.disconnect();
        } catch {}
      }
      if (makeupGainRef.current) {
        try {
          makeupGainRef.current.disconnect();
        } catch {}
      }
      setIsReady(false);
    };
    // Only depend on audioContext - don't recreate on settings changes!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext]);

  // Update parameters when settings change
  useEffect(() => {
    if (!audioContext || !workletNodeRef.current) return;

    const node = workletNodeRef.current;
    node.parameters.get('threshold')?.setTargetAtTime(settings.threshold, audioContext.currentTime, 0.01);
    node.parameters.get('attack')?.setTargetAtTime(settings.attack, audioContext.currentTime, 0.01);
    node.parameters.get('release')?.setTargetAtTime(settings.release, audioContext.currentTime, 0.05);
    node.parameters.get('bodyBlend')?.setTargetAtTime(settings.bodyBlend, audioContext.currentTime, 0.01);
    node.parameters.get('airBlend')?.setTargetAtTime(settings.airBlend, audioContext.currentTime, 0.01);

    // Update makeup gain when threshold changes
    if (makeupGainRef.current) {
      const makeupGainLinear = Math.pow(10, -settings.threshold / 20);
      makeupGainRef.current.gain.setTargetAtTime(makeupGainLinear, audioContext.currentTime, 0.01);
    }
  }, [settings, audioContext]);

  // Reset gain reduction and makeup gain when disabled
  useEffect(() => {
    if (!settings.enabled) {
      setGainReduction(0);
      if (makeupGainRef.current && audioContext) {
        makeupGainRef.current.gain.setValueAtTime(1, audioContext.currentTime);
      }
    }
  }, [settings.enabled, audioContext]);

  const update = useCallback((changes: Partial<CompressorSettings>) => {
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
      const compConfig = config as CompressorSettings;
      if (typeof compConfig.threshold === 'number' && typeof compConfig.enabled === 'boolean') {
        setSettings({ ...DEFAULT_SETTINGS, ...compConfig });
      }
    }
  }, []);

  return {
    isReady,
    inputNode: workletNodeRef.current, // Connect audio TO here
    outputNode: makeupGainRef.current, // Connect audio FROM here
    settings,
    update,
    reset,
    getConfig,
    setConfig,
    gainReduction,
  };
}
