import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioContext } from './useAudioContext';
import { useConfigPersistence } from './useConfigPersistence';
import { useAudioLoader } from './useAudioLoader';
import type { LoadingMetrics } from './useAudioLoader';
import { useStemAudioNodes } from './useStemAudioNodes';
import { usePlaybackController } from './usePlaybackController';
import { useAudioEffects } from './useAudioEffects';
import type { StemViewModel, StemUserConfig, EffectsChainConfig } from '../types';

/**
 * Orchestrator hook for multi-stem audio player.
 *
 * NEW ARCHITECTURE - No getter functions, all state at top level
 *
 * Data flow:
 * 1. Load audio buffers (useAudioLoader)
 * 2. Create audio nodes (useStemAudioNodes)
 * 3. Manage stem state (local state in this hook)
 * 4. Apply stem state to audio nodes (useEffect)
 * 5. Persist changes to localStorage (useRecordingConfig)
 *
 * Key insight: Stem state (gains, mutes, solos) is just React state.
 * Audio nodes react to state changes via useEffect.
 */

export interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  stemsData: import('../types').StemResponse[];
  sampleRate?: number;
  recordingId: string;
}

export interface UseStemPlayerResult {
  // Loading state
  isLoading: boolean;
  isConfigLoading: boolean; // Config loading state (for disabling controls)
  loadingMetrics: LoadingMetrics | null;

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Stem view models (merged metadata + user config)
  stems: Record<string, StemViewModel>;
  stemOrder: string[]; // For consistent ordering

  // Playback controls
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  formatTime: (seconds: number) => string;

  // Stem controls
  setStemGain: (stemName: string, gain: number) => void;
  resetStemGain: (stemName: string) => void;
  toggleMute: (stemName: string) => void;
  toggleSolo: (stemName: string) => void;

  // Master volume
  masterVolume: number;
  setMasterVolume: (volume: number) => void;

  // Effects
  effectsConfig: EffectsChainConfig;
  updateEqBand: (id: string, changes: Partial<{ gain: number; frequency: number; q: number; type: BiquadFilterType }>) => void;
  setEqEnabled: (enabled: boolean) => void;
  resetEq: () => void;
  updateCompressor: (changes: Partial<EffectsChainConfig['compressor']>) => void;
  setCompressorEnabled: (enabled: boolean) => void;
  resetCompressor: () => void;
  updateReverb: (changes: Partial<EffectsChainConfig['reverb']>) => void;
  setReverbEnabled: (enabled: boolean) => void;
  resetReverb: () => void;
  updateStereoExpander: (changes: Partial<EffectsChainConfig['stereoExpander']>) => void;
  setStereoExpanderEnabled: (enabled: boolean) => void;
  resetStereoExpander: () => void;
  compressorGainReduction: number;
}

export function useStemPlayer({
  profileName,
  fileName,
  stemsData,
  sampleRate = 44100,
  recordingId,
}: UseStemPlayerOptions): UseStemPlayerResult {
  // 1. Audio context and master gain
  const { getContext, getMasterInput, getMasterOutput, masterVolume, setMasterVolume } = useAudioContext({ sampleRate });
  const audioContext = getContext();
  const masterInput = getMasterInput();
  const masterOutput = getMasterOutput();

  // 2. Persist stem configs (volume, mute, solo) and playback position independently
  const {
    config: stemConfigs,
    setConfig: setStemConfigsState,
    isLoading: isStemConfigsLoading
  } = useConfigPersistence<Record<string, StemUserConfig>>({
    recordingId,
    configKey: 'stems',
    defaultValue: {},
    debounceMs: 500,
  });

  const {
    config: playbackPositionConfig,
    setConfig: setPlaybackPositionConfig,
    isLoading: isPlaybackPositionLoading
  } = useConfigPersistence<{ position: number }>({
    recordingId,
    configKey: 'playbackPosition',
    defaultValue: { position: 0 },
    debounceMs: 1000, // Longer debounce for playback position
  });

  const isConfigLoading = isStemConfigsLoading || isPlaybackPositionLoading;

  // 3. Load audio buffers
  const { isLoading, loadingMetrics, stems: loadedStems, duration, metadataBaseUrl } = useAudioLoader({
    profileName,
    fileName,
    stemsData,
    audioContext,
  });

  // 4. Create audio nodes
  const { stemNodes } = useStemAudioNodes({
    audioContext,
    masterInput,
    stems: loadedStems,
  });

  // 5. Stem view models (merge metadata + user config)
  const [stems, setStems] = useState<Record<string, StemViewModel>>({});
  const [stemOrder, setStemOrder] = useState<string[]>([]);
  const stemsInitializedRef = useRef(false);
  const playbackPositionInitializedRef = useRef(false);

  // Initialize stem view models when audio nodes are created AND config is loaded
  // ONLY RUNS ONCE - subsequent changes to stemConfigs don't re-initialize
  useEffect(() => {
    if (stemNodes.size === 0) return;
    if (isStemConfigsLoading) return; // Wait for config to load
    if (stemsInitializedRef.current) return; // Already initialized, skip

    const newStems: Record<string, StemViewModel> = {};
    const order: string[] = [];

    stemNodes.forEach((node, name) => {
      const savedStem = stemConfigs[name];
      const loadedStem = loadedStems.get(name);
      const metadata = loadedStem?.metadata;

      newStems[name] = {
        // Identity
        name,

        // From metadata (immutable)
        stemType: metadata?.stem_type || 'unknown',
        waveformUrl: metadata?.waveform_url || '',
        initialGain: node.initialGain,

        // From user config (mutable)
        gain: savedStem?.gain ?? node.initialGain,
        muted: savedStem?.muted ?? false,
        soloed: savedStem?.soloed ?? false,
      };
      order.push(name);
    });

    order.sort((a, b) => a.localeCompare(b));

    setStems(newStems);
    setStemOrder(order);
    stemsInitializedRef.current = true; // Mark as initialized
  }, [stemNodes, metadataBaseUrl, loadedStems, stemConfigs, isStemConfigsLoading]);

  // 6. Apply stem state to audio nodes (reactive!)
  useEffect(() => {
    if (stemNodes.size === 0) return;

    const hasSolo = Object.values(stems).some(s => s.soloed);

    stemNodes.forEach((node, name) => {
      const state = stems[name];
      if (!state) return;

      // Apply gain
      node.gainNode.gain.value = state.gain;

      // Apply audibility (mute/solo logic)
      let audible = true;
      if (hasSolo) {
        audible = state.soloed;
      } else {
        audible = !state.muted;
      }
      node.outputGainNode.gain.value = audible ? 1 : 0;
    });
  }, [stems, stemNodes]);

  // Persist stem configs when they change
  useEffect(() => {
    if (Object.keys(stems).length === 0) return; // Not initialized yet
    if (isStemConfigsLoading) return; // Don't save during initial load

    // Extract just the user config portion (gain, muted, soloed)
    const configs: Record<string, StemUserConfig> = {};
    Object.entries(stems).forEach(([name, stem]) => {
      configs[name] = {
        gain: stem.gain,
        muted: stem.muted,
        soloed: stem.soloed,
      };
    });

    setStemConfigsState(configs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stems, isStemConfigsLoading]); // Intentionally omit setStemConfigsState to avoid infinite loop

  // 7. Audio effects (each effect persists its own config independently)
  const { eq, compressor, reverb, stereoExpander} = useAudioEffects({
    audioContext,
    masterInput,
    masterOutput,
    recordingId,
  });

  // 8. Playback control (use saved position or 0 if none)
  const { isPlaying, currentTime, play, pause, stop, seek, formatTime } = usePlaybackController({
    audioContext,
    duration,
    stemNodes,
    initialPosition: playbackPositionConfig.position,
  });

  // Mark playback position as initialized after first render to avoid saving initial state
  useEffect(() => {
    if (!isPlaybackPositionLoading) {
      // Wait one more tick to ensure currentTime has been updated from initialPosition
      const timer = setTimeout(() => {
        playbackPositionInitializedRef.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isPlaybackPositionLoading]);

  // Persist playback position when playback stops or pauses (not during continuous playback)
  useEffect(() => {
    if (!playbackPositionInitializedRef.current) return; // Don't save until initialized
    if (isPlaying) return; // Don't save while playing (too many updates)

    // Save when paused/stopped or when user seeks while paused
    setPlaybackPositionConfig({ position: currentTime });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentTime]); // Intentionally omit setPlaybackPositionConfig to avoid infinite loop

  // Validate and correct playback position once duration is loaded
  useEffect(() => {
    if (duration > 0 && currentTime > duration || currentTime < 0) {
      // If current position is beyond song length, reset to beginning
      stop()
    }
  }, [duration, currentTime, seek]);

  // Stem control actions
  const setStemGain = useCallback((stemName: string, gain: number) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], gain: Math.max(0, Math.min(gain, 2)) },
    }));
  }, []);

  const resetStemGain = useCallback((stemName: string) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], gain: prev[stemName].initialGain },
    }));
  }, []);

  const toggleMute = useCallback((stemName: string) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], muted: !prev[stemName].muted },
    }));
  }, []);

  const toggleSolo = useCallback((stemName: string) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], soloed: !prev[stemName].soloed },
    }));
  }, []);

  return {
    // Loading
    isLoading,
    isConfigLoading, // Expose config loading state for disabling controls
    loadingMetrics,

    // Playback
    isPlaying,
    currentTime,
    duration,

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

    // Master volume
    masterVolume,
    setMasterVolume,

    // Effects
    effectsConfig: {
      eq: eq.config,
      compressor: compressor.config,
      reverb: reverb.config,
      stereoExpander: stereoExpander.config,
    },
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
  };
}
