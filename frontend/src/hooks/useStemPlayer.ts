import { useCallback, useEffect, useMemo, useState } from "react";
import { debounce } from "lodash-es";
import type { StemResponse } from "../api/generated/types.gen";
import type {
  EffectsChainConfig,
  StemCompressionLevel,
  StemEqLevel,
  StemUserConfig,
  StemViewModel,
} from "../types";
import { useAudioContext } from "../lib/audio/core/useAudioContext";
import { useAudioEffects } from "./useAudioEffects";
import type { LoadingMetrics } from "../lib/audio/types";
import { useAudioBufferLoader } from "../lib/audio/core/useAudioBufferLoader";
import { useRecordingConfig } from "./useRecordingConfig";
import { usePlaybackEngine } from "../lib/audio/core/usePlaybackEngine";
import type { PlaybackNode } from "../lib/audio/types";
import { useStemAudioGraph } from "../lib/audio/effects/useStemAudioGraph";

/**
 * Orchestrator hook for multi-stem audio player.
 */
export interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  stemsData: StemResponse[];
  sampleRate?: number;
  recordingId: string;
  startTimeSec?: number; // Clip start time (optional)
  endTimeSec?: number; // Clip end time (optional)
  disablePositionPersistence?: boolean; // Don't persist playback position (for clips)
}

export interface UseStemPlayerResult {
  // Loading state
  isLoading: boolean;
  loadingMetrics: LoadingMetrics | null;

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number; // Effective duration (clip duration for clips, full duration for recordings)
  fullDuration: number; // Always the full recording duration

  // Stem view models (merged metadata + user config)
  stems: Record<string, StemViewModel>;
  stemOrder: string[]; // For consistent ordering

  // Playback controls
  play: () => void;
  pause: () => void;
  stop: (seekTime?: number) => void;
  seek: (seconds: number) => void;
  formatTime: (seconds: number) => string;

  // Stem controls
  setStemGain: (stemName: string, gain: number) => void;
  resetStemGain: (stemName: string) => void;
  toggleMute: (stemName: string) => void;
  toggleSolo: (stemName: string) => void;
  cycleStemCompression: (stemName: string) => void;
  cycleStemEqLow: (stemName: string) => void;
  cycleStemEqMid: (stemName: string) => void;
  cycleStemEqHigh: (stemName: string) => void;

  // Master volume
  masterVolume: number;
  setMasterVolume: (volume: number) => void;

  // Effects
  effectsConfig: EffectsChainConfig;
  updateParametricEqBand: (
    band: "lowBand" | "midBand" | "highBand",
    changes: Partial<EffectsChainConfig["parametricEq"]["lowBand"]>,
  ) => void;
  setParametricEqEnabled: (enabled: boolean) => void;
  resetParametricEq: () => void;
  updateEqBand: (
    id: string,
    changes: Partial<{
      gain: number;
      frequency: number;
      q: number;
      type: BiquadFilterType;
    }>,
  ) => void;
  setEqEnabled: (enabled: boolean) => void;
  resetEq: () => void;
  updateCompressor: (
    changes: Partial<EffectsChainConfig["compressor"]>,
  ) => void;
  setCompressorEnabled: (enabled: boolean) => void;
  resetCompressor: () => void;
  updateReverb: (changes: Partial<EffectsChainConfig["reverb"]>) => void;
  setReverbEnabled: (enabled: boolean) => void;
  resetReverb: () => void;
  updateStereoExpander: (
    changes: Partial<EffectsChainConfig["stereoExpander"]>,
  ) => void;
  setStereoExpanderEnabled: (enabled: boolean) => void;
  resetStereoExpander: () => void;
  compressorGainReduction: number;
  audioContext: AudioContext | null;
  getMasterOutput: () => GainNode;
}

export function useStemPlayer({
  stemsData,
  sampleRate = 44100,
  recordingId,
  startTimeSec,
  endTimeSec,
}: UseStemPlayerOptions): UseStemPlayerResult {
  // 1. Audio context and master gain
  const {
    getContext,
    getMasterInput,
    getMasterOutput,
    masterVolume,
    setMasterVolume,
  } = useAudioContext({ sampleRate });
  const audioContext = getContext();
  const masterInput = getMasterInput();
  const masterOutput = getMasterOutput();

  // 2. Configuration from backend (React Query cache)
  const { config, updateConfig } = useRecordingConfig(recordingId);

  // Ephemeral local state for immediate UI updates
  const [localStemConfigs, setLocalStemConfigs] = useState<Record<string, StemUserConfig>>({});

  // Debounced save to backend
  const debouncedSaveStemConfigs = useMemo(
    () =>
      debounce((newConfigs: Record<string, StemUserConfig>) => {
        updateConfig("stems", newConfigs);
      }, 500),
    [updateConfig],
  );

  const debouncedSavePlaybackPosition = useMemo(
    () =>
      debounce((position: number) => {
        updateConfig("playbackPosition", { position });
      }, 1000),
    [updateConfig],
  );

  // Merged config: local ephemeral state overrides backend state
  const stemConfigs = useMemo(() => {
    const backendStems = (config.stems as Record<string, StemUserConfig>) ?? {};
    return { ...backendStems, ...localStemConfigs };
  }, [config.stems, localStemConfigs]);

  const playbackPositionConfig = useMemo(() => {
    return (config.playbackPosition as { position: number }) ?? { position: 0 };
  }, [config.playbackPosition]);

  // 3. Load audio buffers
  const {
    isLoading,
    loadingMetrics,
    buffers: loadedStems,
    duration: fullDuration,
  } = useAudioBufferLoader({
    stems: stemsData,
    audioContext,
    trackMetrics: true,
  });

  // 4. Create audio nodes with saved config
  const { stemNodes } = useStemAudioGraph({
    audioContext,
    masterInput,
    buffers: loadedStems,
    config: stemConfigs,
  });

  // 5. Stem view models (derived from nodes and persisted config)
  const stemOrder = useMemo(() => {
    if (stemNodes.size === 0) return [];
    const order = Array.from(stemNodes.keys());
    order.sort((a, b) => a.localeCompare(b));
    return order;
  }, [stemNodes]);

  const stems: Record<string, StemViewModel> = useMemo(() => {
    const newStems: Record<string, StemViewModel> = {};
    stemNodes.forEach((node, name) => {
      const savedStem = stemConfigs[name];
      const loadedStem = loadedStems.get(name);
      const metadata = loadedStem?.metadata;

      newStems[name] = {
        name,
        stemType: metadata?.stem_type || "unknown",
        waveformUrl: metadata?.waveform_url || "",
        initialGain: node.initialGain,
        gain: savedStem?.gain ?? node.initialGain,
        muted: savedStem?.muted ?? false,
        soloed: savedStem?.soloed ?? false,
        compression: savedStem?.compression ?? "off",
        eqLow: savedStem?.eqLow ?? "off",
        eqMid: savedStem?.eqMid ?? "off",
        eqHigh: savedStem?.eqHigh ?? "off",
      };
    });
    return newStems;
  }, [stemNodes, loadedStems, stemConfigs]);

  // NOTE: Removed effect that applied stem state to audio nodes
  // This is now handled internally by useStemAudioGraph

  // 6. Audio effects (each effect persists its own config independently)
  const { parametricEq, eq, compressor, reverb, stereoExpander } =
    useAudioEffects({
      audioContext,
      masterInput,
      masterOutput,
      recordingId,
    });

  // 8. Calculate effective duration for clips (what we report to UI)
  const duration = useMemo(() => {
    if (startTimeSec !== undefined && endTimeSec !== undefined) {
      // Clip mode: return bounded duration
      return Math.min(endTimeSec, fullDuration) - Math.max(0, startTimeSec);
    }
    // Full recording mode: return full duration
    return fullDuration;
  }, [fullDuration, startTimeSec, endTimeSec]);

  // 9. Convert stemNodes to playback nodes
  const playbackNodes = useMemo((): Map<string, PlaybackNode> => {
    const nodes = new Map<string, PlaybackNode>();
    stemNodes.forEach((node, name) => {
      const loadedStem = loadedStems.get(name);
      if (loadedStem) {
        nodes.set(name, {
          buffer: loadedStem.buffer,
          entryPoint: node.gainNode,
        });
      }
    });
    return nodes;
  }, [stemNodes, loadedStems]);

  // 10. Playback control (use saved position or 0 if none)
  const { isPlaying, currentTime, play, pause, stop, seek, formatTime } =
    usePlaybackEngine({
      audioContext,
      duration,
      nodes: playbackNodes,
      initialPosition: playbackPositionConfig.position,
      startOffset: startTimeSec,
    });

  // Persist playback position when playback stops or pauses
  useEffect(() => {
    if (isPlaying) return; // Don't save while playing (too many updates)
    debouncedSavePlaybackPosition(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentTime]); // Intentionally omit debouncedSavePlaybackPosition to avoid infinite loop

  // Validate and correct playback position once duration is loaded
  useEffect(() => {
    if ((duration > 0 && currentTime > duration) || currentTime < 0) {
      // If current position is beyond song length, reset to beginning
      stop();
    }
  }, [duration, currentTime, stop]);

  // Stem control actions (update local state + trigger debounced save)
  const setStemGain = useCallback(
    (stemName: string, gain: number) => {
      const newGain = Math.max(0, Math.min(gain, 2));
      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], gain: newGain },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs],
  );

  const resetStemGain = useCallback(
    (stemName: string) => {
      const newConfigs = {
        ...stemConfigs,
        [stemName]: {
          ...stemConfigs[stemName],
          gain: stems[stemName]?.initialGain ?? 1,
        },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  const toggleMute = useCallback(
    (stemName: string) => {
      const currentMuted = stems[stemName]?.muted ?? false;
      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], muted: !currentMuted },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  const toggleSolo = useCallback(
    (stemName: string) => {
      const currentSoloed = stems[stemName]?.soloed ?? false;
      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], soloed: !currentSoloed },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  const cycleStemCompression = useCallback(
    (stemName: string) => {
      const currentCompression: StemCompressionLevel =
        stems[stemName]?.compression ?? "off";
      const compressionLevels: StemCompressionLevel[] = [
        "off",
        "low",
        "medium",
        "high",
      ];
      const currentIndex = compressionLevels.indexOf(currentCompression);
      const nextIndex = (currentIndex + 1) % compressionLevels.length;
      const nextCompression = compressionLevels[nextIndex];

      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], compression: nextCompression },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  const cycleStemEqLow = useCallback(
    (stemName: string) => {
      const currentLevel: StemEqLevel = stems[stemName]?.eqLow ?? "off";
      const levels: StemEqLevel[] = ["off", "low", "medium", "high"];
      const currentIndex = levels.indexOf(currentLevel);
      const nextIndex = (currentIndex + 1) % levels.length;
      const nextLevel = levels[nextIndex];

      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], eqLow: nextLevel },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  const cycleStemEqMid = useCallback(
    (stemName: string) => {
      const currentLevel: StemEqLevel = stems[stemName]?.eqMid ?? "off";
      const levels: StemEqLevel[] = ["off", "low", "medium", "high"];
      const currentIndex = levels.indexOf(currentLevel);
      const nextIndex = (currentIndex + 1) % levels.length;
      const nextLevel = levels[nextIndex];

      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], eqMid: nextLevel },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  const cycleStemEqHigh = useCallback(
    (stemName: string) => {
      const currentLevel: StemEqLevel = stems[stemName]?.eqHigh ?? "off";
      const levels: StemEqLevel[] = ["off", "low", "medium", "high"];
      const currentIndex = levels.indexOf(currentLevel);
      const nextIndex = (currentIndex + 1) % levels.length;
      const nextLevel = levels[nextIndex];

      const newConfigs = {
        ...stemConfigs,
        [stemName]: { ...stemConfigs[stemName], eqHigh: nextLevel },
      };
      setLocalStemConfigs(newConfigs);
      debouncedSaveStemConfigs(newConfigs);
    },
    [stemConfigs, debouncedSaveStemConfigs, stems],
  );

  return {
    // Loading
    isLoading,
    loadingMetrics,

    // Playback
    isPlaying,
    currentTime,
    duration,
    fullDuration,

    // Stems
    stems,
    stemOrder,

    // Playback controls
    play,
    pause,
    stop,
    seek,
    formatTime,

    // Stem controls
    setStemGain,
    resetStemGain,
    toggleMute,
    toggleSolo,
    cycleStemCompression,
    cycleStemEqLow,
    cycleStemEqMid,
    cycleStemEqHigh,

    // Master volume
    masterVolume,
    setMasterVolume,

    // Effects
    effectsConfig: {
      parametricEq: parametricEq.config,
      eq: eq.config,
      compressor: compressor.config,
      reverb: reverb.config,
      stereoExpander: stereoExpander.config,
    },
    updateParametricEqBand: parametricEq.updateBand,
    setParametricEqEnabled: parametricEq.setEnabled,
    resetParametricEq: parametricEq.reset,
    updateEqBand: eq.updateBand,
    setEqEnabled: eq.setEnabled,
    resetEq: eq.reset,
    updateCompressor: compressor.update,
    setCompressorEnabled: compressor.setEnabled,
    resetCompressor: compressor.reset,
    updateReverb: reverb.update,
    setReverbEnabled: reverb.setEnabled,
    resetReverb: reverb.reset,
    updateStereoExpander: stereoExpander.update,
    setStereoExpanderEnabled: stereoExpander.setEnabled,
    resetStereoExpander: stereoExpander.reset,
    compressorGainReduction: compressor.gainReduction,
    audioContext,
    getMasterOutput,
  };
}
