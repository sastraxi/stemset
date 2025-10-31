import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAudioContext } from './useAudioContext';
import { useRecordingConfig } from './useRecordingConfig';
import { useAudioLoader } from './useAudioLoader';
import type { LoadingMetrics } from './useAudioLoader';
import { useStemAudioNodes } from './useStemAudioNodes';
import { usePlaybackController } from './usePlaybackController';
import { useAudioEffects } from './useAudioEffects';
import type { StemViewModel, EffectsChainConfig, RecordingUserConfig } from '../types';
import {
  DEFAULT_EQ_CONFIG,
  DEFAULT_COMPRESSOR_CONFIG,
  DEFAULT_REVERB_CONFIG,
  DEFAULT_STEREO_EXPANDER_CONFIG,
} from './effects';

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

  // 2. Recording config (database persistence via API)
  // config is undefined (loading), null (no config), or RecordingUserConfig (loaded)
  const { config, isLoading: isConfigLoading, savePlaybackPosition, saveStemConfigs, saveEffectsConfig } = useRecordingConfig({
    recordingId,
  });

  // Default config to use when config is null (no saved config exists)
  const DEFAULT_CONFIG: RecordingUserConfig = useMemo(() => ({
    playbackPosition: 0,
    stems: {},
    effects: {
      eq: DEFAULT_EQ_CONFIG,
      compressor: DEFAULT_COMPRESSOR_CONFIG,
      reverb: DEFAULT_REVERB_CONFIG,
      stereoExpander: DEFAULT_STEREO_EXPANDER_CONFIG,
    },
  }), []);

  // Effective config for components:
  // - undefined = still loading, components should disable controls
  // - null or RecordingUserConfig = loaded, use actual config or defaults
  const effectiveConfig = useMemo(() => {
    if (config === undefined) {
      // Still loading - return undefined to signal components to disable
      return undefined;
    }
    // Config loaded: use it if it exists, otherwise use defaults
    return config ?? DEFAULT_CONFIG;
  }, [config, DEFAULT_CONFIG]);

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

  // Track if config has been loaded at least once to prevent saving defaults
  const [configHasLoaded, setConfigHasLoaded] = useState(false);

  useEffect(() => {
    if (!isConfigLoading && !configHasLoaded) {
      setConfigHasLoaded(true);
    }
  }, [isConfigLoading, configHasLoaded]);

  // Initialize stem view models when audio nodes are created AND config is loaded
  useEffect(() => {
    if (stemNodes.size === 0) return;
    // CRITICAL: Wait for config to load before initializing stems
    // This prevents defaults from being used before saved config arrives
    if (effectiveConfig === undefined) return;

    const newStems: Record<string, StemViewModel> = {};
    const order: string[] = [];

    stemNodes.forEach((node, name) => {
      const savedStem = effectiveConfig.stems[name];
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
  }, [stemNodes, metadataBaseUrl, loadedStems, effectiveConfig]);

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

  // 7. Audio effects (use defaults while loading, then switch to saved config)
  const { eq, compressor, reverb, stereoExpander} = useAudioEffects({
    audioContext,
    masterInput,
    masterOutput,
    initialConfig: effectiveConfig ? {
      eqConfig: effectiveConfig.effects.eq,
      compressorConfig: effectiveConfig.effects.compressor,
      reverbConfig: effectiveConfig.effects.reverb,
      stereoExpanderConfig: effectiveConfig.effects.stereoExpander,
    } : {
      eqConfig: DEFAULT_EQ_CONFIG,
      compressorConfig: DEFAULT_COMPRESSOR_CONFIG,
      reverbConfig: DEFAULT_REVERB_CONFIG,
      stereoExpanderConfig: DEFAULT_STEREO_EXPANDER_CONFIG,
    },
  });

  // 8. Playback control (use 0 position while config loads)
  const { isPlaying, currentTime, play, pause, stop, seek, formatTime } = usePlaybackController({
    audioContext,
    duration,
    stemNodes,
    initialPosition: effectiveConfig?.playbackPosition ?? 0,
  });

  // Validate and correct playback position once duration is loaded
  useEffect(() => {
    if (duration > 0 && currentTime > duration || currentTime < 0) {
      // If current position is beyond song length, reset to beginning
      stop()
    }
  }, [duration, currentTime, seek]);

  // 9. Persist playback position (only after config has loaded at least once)
  useEffect(() => {
    if (!isLoading && configHasLoaded) {
      savePlaybackPosition(currentTime);
    }
  }, [currentTime, isLoading, configHasLoaded, savePlaybackPosition]);

  // 10. Persist stem configs (only after config has loaded at least once)
  useEffect(() => {
    if (!isLoading && configHasLoaded && Object.keys(stems).length > 0) {
      const stemConfigs: Record<string, import('../types').StemUserConfig> = {};

      Object.entries(stems).forEach(([name, viewModel]) => {
        stemConfigs[name] = {
          gain: viewModel.gain,
          muted: viewModel.muted,
          soloed: viewModel.soloed,
        };
      });

      saveStemConfigs(stemConfigs);
    }
  }, [stems, isLoading, configHasLoaded, saveStemConfigs]);

  // 11. Persist effects config (only after config has loaded at least once)
  useEffect(() => {
    if (!isLoading && configHasLoaded) {
      saveEffectsConfig({
        eq: eq.config,
        compressor: compressor.config,
        reverb: reverb.config,
        stereoExpander: stereoExpander.config,
      });
    }
  }, [
    eq.config,
    compressor.config,
    reverb.config,
    stereoExpander.config,
    isLoading,
    configHasLoaded,
    saveEffectsConfig,
  ]);

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
