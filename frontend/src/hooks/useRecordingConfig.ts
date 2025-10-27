import { useCallback, useRef } from 'react';
import {
  getRecordingState,
  updateRecordingState,
} from '../lib/storage';
import type { RecordingUserConfig, StemUserConfig, EffectsChainConfig } from '../types';
import {
  DEFAULT_EQ_CONFIG,
  DEFAULT_COMPRESSOR_CONFIG,
  DEFAULT_REVERB_CONFIG,
  DEFAULT_STEREO_EXPANDER_CONFIG,
} from './effects';

const DEFAULT_RECORDING_CONFIG: RecordingUserConfig = {
  playbackPosition: 0,
  stems: {},
  effects: {
    eq: DEFAULT_EQ_CONFIG,
    compressor: DEFAULT_COMPRESSOR_CONFIG,
    reverb: DEFAULT_REVERB_CONFIG,
    stereoExpander: DEFAULT_STEREO_EXPANDER_CONFIG,
  },
};

export interface UseRecordingConfigOptions {
  profileName: string;
  fileName: string;
}

export interface UseRecordingConfigResult {
  getConfig: () => RecordingUserConfig;
  savePlaybackPosition: (position: number) => void;
  saveStemConfigs: (stems: Record<string, StemUserConfig>) => void;
  saveEffectsConfig: (config: EffectsChainConfig) => void;
}

/**
 * Hook to manage per-recording mutable configuration (localStorage persistence).
 *
 * Responsibilities:
 * - Load saved config from localStorage
 * - Debounced saves to prevent excessive writes
 * - Provide stable callbacks for saving different config sections
 *
 * Pattern: Getter function is stable (always reads fresh from localStorage).
 * Save functions are debounced and stable callbacks.
 */
export function useRecordingConfig({
  profileName,
  fileName,
}: UseRecordingConfigOptions): UseRecordingConfigResult {
  // Debounce timers
  const playbackPositionDebounceRef = useRef<number | null>(null);
  const stemConfigsDebounceRef = useRef<number | null>(null);
  const effectsConfigDebounceRef = useRef<number | null>(null);

  const getConfig = useCallback((): RecordingUserConfig => {
    const saved = getRecordingState(profileName, fileName);
    if (!saved) return DEFAULT_RECORDING_CONFIG;

    // Ensure all required fields exist (for backward compatibility)
    // Deep merge effects to handle new compressor parameters
    return {
      playbackPosition: saved.playbackPosition ?? DEFAULT_RECORDING_CONFIG.playbackPosition,
      stems: saved.stems ?? DEFAULT_RECORDING_CONFIG.stems,
      effects: {
        eq: { ...DEFAULT_EQ_CONFIG, ...(saved.effects?.eq || {}) },
        compressor: { ...DEFAULT_COMPRESSOR_CONFIG, ...(saved.effects?.compressor || {}) },
        reverb: { ...DEFAULT_REVERB_CONFIG, ...(saved.effects?.reverb || {}) },
        stereoExpander: { ...DEFAULT_STEREO_EXPANDER_CONFIG, ...(saved.effects?.stereoExpander || {}) },
      },
    };
  }, [profileName, fileName]);

  const savePlaybackPosition = useCallback((position: number) => {
    if (playbackPositionDebounceRef.current) {
      clearTimeout(playbackPositionDebounceRef.current);
    }
    playbackPositionDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { playbackPosition: position });
    }, 1000);
  }, [profileName, fileName]);

  const saveStemConfigs = useCallback((stems: Record<string, StemUserConfig>) => {
    if (stemConfigsDebounceRef.current) {
      clearTimeout(stemConfigsDebounceRef.current);
    }
    stemConfigsDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { stems });
    }, 500);
  }, [profileName, fileName]);

  const saveEffectsConfig = useCallback((effects: EffectsChainConfig) => {
    if (effectsConfigDebounceRef.current) {
      clearTimeout(effectsConfigDebounceRef.current);
    }
    effectsConfigDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { effects });
    }, 500);
  }, [profileName, fileName]);

  return {
    getConfig,
    savePlaybackPosition,
    saveStemConfigs,
    saveEffectsConfig,
  };
}
