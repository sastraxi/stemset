import { useState, useRef, useEffect, useCallback } from 'react';
import { useConfigPersistence } from '../useConfigPersistence';
import { ReverbConfig } from '@/types';

export interface UseReverbEffectOptions {
  audioContext: AudioContext | null;
  recordingId: string;
}

export interface UseReverbEffectResult {
  isReady: boolean;
  inputNode: GainNode | null;
  outputNode: GainNode | null;
  config: ReverbConfig;
  update: (changes: Partial<ReverbConfig>) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const DEFAULT_REVERB_CONFIG: ReverbConfig = {
  impulse: 'sparkling-hall',
  mix: 0.3,
  enabled: false,
};

export function useReverbEffect({
  audioContext,
  recordingId,
}: UseReverbEffectOptions): UseReverbEffectResult {
  // Persist config directly to database
  const { config, setConfig } = useConfigPersistence({
    recordingId,
    configKey: 'reverb',
    defaultValue: DEFAULT_REVERB_CONFIG,
    debounceMs: 500,
  });

  const [isReady, setIsReady] = useState(false);
  const inputNodeRef = useRef<GainNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const convolverRef = useRef<ConvolverNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const impulseBufferRef = useRef<AudioBuffer | null>(null);

  // Load impulse response
  useEffect(() => {
    if (!audioContext || !config.impulse) return;

    async function loadImpulseResponse() {
      try {
        const response = await fetch(`/impulse/${config.impulse}.wav`);
        if (!response.ok) {
          throw new Error(`Failed to fetch impulse response: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext!.decodeAudioData(arrayBuffer);
        impulseBufferRef.current = audioBuffer;

        // Update convolver if it exists
        if (convolverRef.current && audioBuffer) {
          convolverRef.current.buffer = audioBuffer;
        }
      } catch (error) {
        console.error('[useReverbEffect] Failed to load impulse response:', error);
        console.error('[useReverbEffect] Failed to load impulse response details:', {
          responseOk: false,
          impulse: config.impulse,
          audioContextState: audioContext?.state,
          errorType: error instanceof Error ? error.constructor.name : typeof error
        });
        // Clear the buffer reference
        impulseBufferRef.current = null;
      }
    }

    loadImpulseResponse();
  }, [audioContext, config.impulse]);

  // Set up audio nodes
  useEffect(() => {
    if (!audioContext) return;

    console.log('[useReverbEffect] Setting up audio nodes');
    console.log('[useReverbEffect] AudioContext state:', audioContext.state);

    try {
      // Create nodes
      console.log('[useReverbEffect] Creating audio nodes');
      const inputNode = audioContext.createGain();
      const outputNode = audioContext.createGain();
      const convolver = audioContext.createConvolver();
      const wetGain = audioContext.createGain();
      const dryGain = audioContext.createGain();
      console.log('[useReverbEffect] Audio nodes created successfully');

      // Set up the routing:
      // input -> [dry path] -> dryGain -> output
      //       -> [wet path] -> convolver -> wetGain -> output
      console.log('[useReverbEffect] Connecting reverb audio graph');
      inputNode.connect(dryGain);
      inputNode.connect(convolver);
      convolver.connect(wetGain);
      dryGain.connect(outputNode);
      wetGain.connect(outputNode);
      console.log('[useReverbEffect] Reverb audio graph connected successfully');

      // Set impulse response if available
      if (impulseBufferRef.current && convolver) {
        try {
          convolver.buffer = impulseBufferRef.current;
        } catch (error) {
          console.error('[useReverbEffect] Failed to set convolver buffer:', error);
        }
      }

      // Store references
      inputNodeRef.current = inputNode;
      outputNodeRef.current = outputNode;
      convolverRef.current = convolver;
      wetGainRef.current = wetGain;
      dryGainRef.current = dryGain;

      setIsReady(true);
    } catch (error) {
      console.error('[useReverbEffect] Failed to create audio nodes:', error);
    }

    return () => {
      inputNodeRef.current?.disconnect();
      outputNodeRef.current?.disconnect();
      convolverRef.current?.disconnect();
      wetGainRef.current?.disconnect();
      dryGainRef.current?.disconnect();
      setIsReady(false);
    };
  }, [audioContext]);

  // Update mix parameter
  useEffect(() => {
    if (!audioContext || !isReady || !wetGainRef.current || !dryGainRef.current) return;

    const { mix } = config;
    const currentTime = audioContext.currentTime;

    // Wet signal gain = mix
    wetGainRef.current.gain.setTargetAtTime(mix, currentTime, 0.01);
    // Dry signal gain = 1 - mix
    dryGainRef.current.gain.setTargetAtTime(1 - mix, currentTime, 0.01);
  }, [config.mix, audioContext, isReady]);

  const update = useCallback((changes: Partial<ReverbConfig>) => {
    setConfig(prev => ({ ...prev, ...changes }));
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_REVERB_CONFIG);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig(prev => ({ ...prev, enabled }));
  }, []);

  return {
    isReady,
    inputNode: inputNodeRef.current,
    outputNode: outputNodeRef.current,
    config,
    update,
    reset,
    setEnabled,
  };
}
