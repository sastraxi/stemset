import { useRef, useCallback } from 'react';
import {
  getRecordingState,
  updateRecordingState,
} from '../lib/storage';

export interface UseSettingsOptions {
  profileName: string;
  fileName: string;
}

export interface UseSettingsResult {
  // Per-recording settings
  getSavedRecordingState: () => {
    playbackPosition: number;
    stemGains: Record<string, number>;
    stemMutes: Record<string, boolean>;
    stemSolos: Record<string, boolean>;
    eqConfig?: unknown;
    compressorConfig?: unknown;
    reverbConfig?: unknown;
    stereoExpanderConfig?: unknown;
  };
  persistPlaybackPosition: (position: number) => void;
  persistStemSettings: (
    stemGains: Record<string, number>,
    stemMutes: Record<string, boolean>,
    stemSolos: Record<string, boolean>
  ) => void;
  persistEffectsSettings: (configs: {
    eqConfig?: unknown;
    compressorConfig?: unknown;
    reverbConfig?: unknown;
    stereoExpanderConfig?: unknown;
  }) => void;
}

/**
 * Manages localStorage persistence for all player settings.
 *
 * Responsibilities:
 * - Per-recording settings (playback position, stem gains, stem mutes, stem solos, effects config)
 * - Debounced writes to prevent excessive localStorage operations
 * - Default value management and initialization
 *
 * Pattern: Debounced persistence of per-recording state.
 * All effects config is now per-recording (not global).
 */
export function useSettings({
  profileName,
  fileName,
}: UseSettingsOptions): UseSettingsResult {
  // Debounce timers
  const playbackPositionDebounceRef = useRef<number | null>(null);
  const stemSettingsDebounceRef = useRef<number | null>(null);
  const effectsSettingsDebounceRef = useRef<number | null>(null);

  // Per-recording state getters and setters
  const getSavedRecordingState = useCallback(() => {
    const saved = getRecordingState(profileName, fileName);
    return {
      playbackPosition: saved?.playbackPosition || 0,
      stemGains: saved?.stemGains || {},
      stemMutes: saved?.stemMutes || {},
      stemSolos: saved?.stemSolos || {},
      eqConfig: saved?.eqConfig,
      compressorConfig: saved?.compressorConfig,
      reverbConfig: saved?.reverbConfig,
      stereoExpanderConfig: saved?.stereoExpanderConfig,
    };
  }, [profileName, fileName]);

  const persistPlaybackPosition = useCallback((position: number) => {
    if (playbackPositionDebounceRef.current) {
      clearTimeout(playbackPositionDebounceRef.current);
    }
    playbackPositionDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { playbackPosition: position });
    }, 1000);
  }, [profileName, fileName]);

  const persistStemSettings = useCallback((
    stemGains: Record<string, number>,
    stemMutes: Record<string, boolean>,
    stemSolos: Record<string, boolean>
  ) => {
    if (stemSettingsDebounceRef.current) {
      clearTimeout(stemSettingsDebounceRef.current);
    }
    stemSettingsDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { stemGains, stemMutes, stemSolos });
    }, 500);
  }, [profileName, fileName]);

  const persistEffectsSettings = useCallback((configs: {
    eqConfig?: unknown;
    compressorConfig?: unknown;
    reverbConfig?: unknown;
    stereoExpanderConfig?: unknown;
  }) => {
    if (effectsSettingsDebounceRef.current) {
      clearTimeout(effectsSettingsDebounceRef.current);
    }
    effectsSettingsDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, configs);
    }, 500);
  }, [profileName, fileName]);

  return {
    // Per-recording settings
    getSavedRecordingState,
    persistPlaybackPosition,
    persistStemSettings,
    persistEffectsSettings,
  };
}
