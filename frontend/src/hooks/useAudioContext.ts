import { useCallback, useEffect, useRef, useState } from "react";

const MASTER_VOLUME_KEY = "stemset-master-volume";
const DEFAULT_MASTER_VOLUME = 0.8;

export interface UseAudioContextOptions {
  sampleRate?: number;
}

export interface UseAudioContextResult {
  getContext: () => AudioContext;
  getMasterInput: () => GainNode;
  getMasterOutput: () => GainNode;
  isReady: () => boolean;
  masterVolume: number;
  setMasterVolume: (volume: number) => void;
}

/**
 * Manages AudioContext lifecycle and master gain nodes.
 *
 * Responsibilities:
 * - AudioContext creation with specified sample rate
 * - Context state management (suspended -> running)
 * - Master gain node chain creation: stems → masterInput → masterOutput → destination
 * - Master volume control (applied to masterOutput)
 * - Thread-safe context access via getters
 *
 * Pattern: Audio objects in refs, master volume in state.
 */
export function useAudioContext({
  sampleRate = 44100,
}: UseAudioContextOptions = {}): UseAudioContextResult {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterInputRef = useRef<GainNode | null>(null);
  const masterOutputRef = useRef<GainNode | null>(null);

  // Load master volume from localStorage (global, not per-recording)
  const [masterVolume, setMasterVolumeState] = useState(() => {
    try {
      const stored = localStorage.getItem(MASTER_VOLUME_KEY);
      return stored ? parseFloat(stored) : DEFAULT_MASTER_VOLUME;
    } catch (e) {
      console.warn(
        "[useAudioContext] Failed to load master volume from localStorage:",
        e,
      );
      return DEFAULT_MASTER_VOLUME;
    }
  });

  const getContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      console.log(
        "[useAudioContext] Creating new AudioContext with sample rate:",
        sampleRate,
      );
      audioCtxRef.current = new AudioContext({ sampleRate });
      console.log("[useAudioContext] AudioContext created:", {
        state: audioCtxRef.current.state,
        sampleRate: audioCtxRef.current.sampleRate,
        baseLatency: audioCtxRef.current.baseLatency,
        outputLatency: audioCtxRef.current.outputLatency,
      });
    }
    return audioCtxRef.current;
  }, [sampleRate]);

  const getMasterOutput = useCallback((): GainNode => {
    const ctx = getContext();

    if (!masterOutputRef.current) {
      console.log("[useAudioContext] Creating master output gain node");
      masterOutputRef.current = ctx.createGain();
      masterOutputRef.current.gain.value = masterVolume;
      masterOutputRef.current.connect(ctx.destination);
      console.log(
        "[useAudioContext] Master output created and connected to destination",
      );
    }

    return masterOutputRef.current;
  }, [getContext]);

  const getMasterInput = useCallback((): GainNode => {
    const ctx = getContext();
    const masterOutput = getMasterOutput();

    if (!masterInputRef.current) {
      console.log("[useAudioContext] Creating master input gain node");
      masterInputRef.current = ctx.createGain();
      masterInputRef.current.gain.value = 1;
      masterInputRef.current.connect(masterOutput);
      console.log(
        "[useAudioContext] Master input created and connected to master output",
      );
    }

    return masterInputRef.current;
  }, [getContext, getMasterOutput]);

  const setMasterVolume = useCallback((volume: number) => {
    setMasterVolumeState(volume);
    if (masterOutputRef.current) {
      masterOutputRef.current.gain.value = volume;
    }
    // Persist to localStorage
    try {
      localStorage.setItem(MASTER_VOLUME_KEY, volume.toString());
    } catch (e) {
      console.error(
        "[useAudioContext] Failed to save master volume to localStorage:",
        e,
      );
    }
  }, []);

  // Ensure master output gain is synced with initial volume
  useEffect(() => {
    if (
      masterOutputRef.current &&
      masterOutputRef.current.gain.value !== masterVolume
    ) {
      masterOutputRef.current.gain.value = masterVolume;
    }
  }, [masterVolume]);

  // Monitor AudioContext state changes and auto-resume if interrupted
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const handleStateChange = () => {
      console.log("[useAudioContext] State changed to:", ctx.state);
      if (ctx.state === "interrupted") {
        // iOS may interrupt audio, try to resume
        ctx
          .resume()
          .catch((e) =>
            console.warn(
              "[useAudioContext] Failed to resume after interruption:",
              e,
            ),
          );
      }
    };

    ctx.addEventListener("statechange", handleStateChange);
    return () => ctx.removeEventListener("statechange", handleStateChange);
  }, []);

  const isReady = useCallback((): boolean => {
    return (
      audioCtxRef.current !== null &&
      masterInputRef.current !== null &&
      masterOutputRef.current !== null
    );
  }, []);

  return {
    getContext,
    getMasterInput,
    getMasterOutput,
    isReady,
    masterVolume,
    setMasterVolume,
  };
}
