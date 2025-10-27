import { useRef, useCallback } from 'react';

export interface UseAudioContextOptions {
  sampleRate?: number;
}

export interface UseAudioContextResult {
  getContext: () => AudioContext;
  getMasterInput: () => GainNode;
  isReady: () => boolean;
}

/**
 * Manages AudioContext lifecycle and master gain node.
 *
 * Responsibilities:
 * - AudioContext creation with specified sample rate
 * - Context state management (suspended -> running)
 * - Master gain node creation and persistence
 * - Thread-safe context access via getters
 *
 * Pattern: All audio objects stored in refs (no state).
 * No effects = no cleanup needed, no dependency issues.
 */
export function useAudioContext({
  sampleRate = 44100
}: UseAudioContextOptions = {}): UseAudioContextResult {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterInputRef = useRef<GainNode | null>(null);

  const getContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      console.log('[useAudioContext] Creating new AudioContext with sample rate:', sampleRate);
      audioCtxRef.current = new AudioContext({ sampleRate });
      console.log('[useAudioContext] AudioContext created:', {
        state: audioCtxRef.current.state,
        sampleRate: audioCtxRef.current.sampleRate,
        baseLatency: audioCtxRef.current.baseLatency,
        outputLatency: audioCtxRef.current.outputLatency
      });
    }
    return audioCtxRef.current;
  }, [sampleRate]);

  const getMasterInput = useCallback((): GainNode => {
    const ctx = getContext();

    if (!masterInputRef.current) {
      console.log('[useAudioContext] Creating master input gain node');
      masterInputRef.current = ctx.createGain();
      masterInputRef.current.gain.value = 1;
      console.log('[useAudioContext] Master input created:', {
        channelCount: masterInputRef.current.channelCount,
        channelCountMode: masterInputRef.current.channelCountMode,
        channelInterpretation: masterInputRef.current.channelInterpretation
      });
    }

    return masterInputRef.current;
  }, [getContext]);

  const isReady = useCallback((): boolean => {
    return audioCtxRef.current !== null && masterInputRef.current !== null;
  }, []);

  return {
    getContext,
    getMasterInput,
    isReady,
  };
}
