import { useEffect } from 'react';
import { useAudioContext } from '../hooks/useAudioContext';
import { useSettings } from '../hooks/useSettings';
import { useAudioLoader } from '../hooks/useAudioLoader';
import type { LoadingMetrics } from '../hooks/useAudioLoader';
import { useStemManager } from '../hooks/useStemManager';
import type { StemStateEntry } from '../hooks/useStemManager';
import { usePlaybackController } from '../hooks/usePlaybackController';
import { useAudioEffects } from '../hooks/useAudioEffects';
import type { UseEqEffectResult } from '../hooks/effects/useEqEffect';
import type { UseCompressorEffectResult } from '../hooks/effects/useCompressorEffect';
import type { UseReverbEffectResult } from '../hooks/effects/useReverbEffect';
import type { UseStereoExpanderEffectResult } from '../hooks/effects/useStereoExpanderEffect';

/**
 * Orchestrator hook for multi-stem audio player.
 *
 * This hook composes focused hooks to provide a complete audio player:
 * - useAudioContext: AudioContext + master gain
 * - useSettings: localStorage persistence (per-recording)
 * - useAudioLoader: Metadata fetching + buffer loading
 * - useStemManager: Individual stem state + mute/solo logic
 * - usePlaybackController: Play/pause/stop/seek + RAF timing
 * - useAudioEffects: Audio effects chain (EQ, stereo expander, reverb, compressor)
 *
 * Responsibilities:
 * - Data flow between focused hooks
 * - Persist stem state changes
 * - Persist playback position
 * - Persist effects settings
 *
 * Pattern: Thin composition layer. No business logic here - just wiring.
 */

export interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  metadataUrl: string;
  sampleRate?: number;
}

export interface UseStemPlayerResult {
  // Loading state
  isLoading: boolean;
  loadingMetrics: LoadingMetrics | null;

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Stem state
  stems: StemStateEntry[];

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

  // Audio effects
  eq: UseEqEffectResult;
  compressor: UseCompressorEffectResult;
  reverb: UseReverbEffectResult;
  stereoExpander: UseStereoExpanderEffectResult;
}

export function useStemPlayer({
  profileName,
  fileName,
  metadataUrl,
  sampleRate = 44100,
}: UseStemPlayerOptions): UseStemPlayerResult {
  // 1. Audio context and master gain
  const { getContext, getMasterInput } = useAudioContext({ sampleRate });
  const audioContext = getContext();
  const masterInput = getMasterInput();

  // 2. Settings (per-recording only)
  const {
    getSavedRecordingState,
    persistPlaybackPosition,
    persistStemSettings,
    persistEffectsSettings,
  } = useSettings({ profileName, fileName });

  // 3. Load audio buffers
  const { isLoading, loadingMetrics, stems: loadedStems, duration, metadataBaseUrl } = useAudioLoader({
    profileName,
    fileName,
    metadataUrl,
    audioContext,
  });

  // 4. Stem management (gain, mute, solo)
  const {
    stems,
    setStemGain,
    resetStemGain,
    toggleMute,
    toggleSolo,
    getLoadedStems,
    getCurrentState,
  } = useStemManager({
    audioContext,
    masterInput,
    stems: loadedStems,
    metadataBaseUrl,
    savedState: getSavedRecordingState(),
  });

  // 5. Playback control
  const { isPlaying, currentTime, play, pause, stop, seek, formatTime } = usePlaybackController({
    audioContext,
    duration,
    getLoadedStems,
  });

  // 6. Audio effects (EQ, stereo expander, reverb, compressor)
  const savedRecordingState = getSavedRecordingState();
  const { eq, compressor, reverb, stereoExpander, getCurrentEffectsConfig } = useAudioEffects({
    audioContext,
    masterInput,
    savedEffectsConfig: {
      eqConfig: savedRecordingState.eqConfig,
      compressorConfig: savedRecordingState.compressorConfig,
      reverbConfig: savedRecordingState.reverbConfig,
      stereoExpanderConfig: savedRecordingState.stereoExpanderConfig,
    },
  });

  // Persist playback position (debounced by useSettings)
  useEffect(() => {
    if (!isLoading) {
      persistPlaybackPosition(currentTime);
    }
  }, [currentTime, isLoading, persistPlaybackPosition]);

  // Persist stem settings (debounced by useSettings)
  useEffect(() => {
    if (!isLoading && stems.length > 0) {
      const state = getCurrentState();
      persistStemSettings(state.stemGains, state.stemMutes, state.stemSolos);
    }
  }, [stems, isLoading, getCurrentState, persistStemSettings]);

  // Persist effects settings (debounced by useSettings)
  useEffect(() => {
    if (!isLoading) {
      const configs = getCurrentEffectsConfig();
      persistEffectsSettings(configs);
    }
  }, [
    eq.settings,
    compressor.settings,
    reverb.settings,
    stereoExpander.settings,
    isLoading,
    getCurrentEffectsConfig,
    persistEffectsSettings,
  ]);

  return {
    // Loading
    isLoading,
    loadingMetrics,

    // Playback
    isPlaying,
    currentTime,
    duration,

    // Stems
    stems,

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

    // Audio effects
    eq,
    compressor,
    reverb,
    stereoExpander,
  };
}
