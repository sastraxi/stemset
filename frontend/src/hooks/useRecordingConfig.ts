import { useCallback, useRef } from 'react';
import {
  getRecordingState,
  updateRecordingState,
} from '../lib/storage';
import type { EqConfig } from './effects/useEqEffect';
import type { CompressorConfig } from './effects/useCompressorEffect';
import type { ReverbConfig } from './effects/useReverbEffect';
import type { StereoExpanderConfig } from './effects/useStereoExpanderEffect';

export interface RecordingConfig {
  playbackPosition: number;
  stemGains: Record<string, number>;
  stemMutes: Record<string, boolean>;
  stemSolos: Record<string, boolean>;
  eqConfig?: EqConfig;
  compressorConfig?: CompressorConfig;
  reverbConfig?: ReverbConfig;
  stereoExpanderConfig?: StereoExpanderConfig;
}

export interface UseRecordingConfigOptions {
  profileName: string;
  fileName: string;
}

export interface UseRecordingConfigResult {
  getConfig: () => RecordingConfig;
  savePlaybackPosition: (position: number) => void;
  saveStemConfig: (
    stemGains: Record<string, number>,
    stemMutes: Record<string, boolean>,
    stemSolos: Record<string, boolean>
  ) => void;
  saveEffectsConfig: (config: {
    eqConfig?: EqConfig;
    compressorConfig?: CompressorConfig;
    reverbConfig?: ReverbConfig;
    stereoExpanderConfig?: StereoExpanderConfig;
  }) => void;
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
  const stemConfigDebounceRef = useRef<number | null>(null);
  const effectsConfigDebounceRef = useRef<number | null>(null);

  const getConfig = useCallback((): RecordingConfig => {
    const saved = getRecordingState(profileName, fileName);
    return {
      playbackPosition: saved?.playbackPosition || 0,
      stemGains: saved?.stemGains || {},
      stemMutes: saved?.stemMutes || {},
      stemSolos: saved?.stemSolos || {},
      eqConfig: saved?.eqConfig as EqConfig | undefined,
      compressorConfig: saved?.compressorConfig as CompressorConfig | undefined,
      reverbConfig: saved?.reverbConfig as ReverbConfig | undefined,
      stereoExpanderConfig: saved?.stereoExpanderConfig as StereoExpanderConfig | undefined,
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

  const saveStemConfig = useCallback((
    stemGains: Record<string, number>,
    stemMutes: Record<string, boolean>,
    stemSolos: Record<string, boolean>
  ) => {
    if (stemConfigDebounceRef.current) {
      clearTimeout(stemConfigDebounceRef.current);
    }
    stemConfigDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { stemGains, stemMutes, stemSolos });
    }, 500);
  }, [profileName, fileName]);

  const saveEffectsConfig = useCallback((config: {
    eqConfig?: EqConfig;
    compressorConfig?: CompressorConfig;
    reverbConfig?: ReverbConfig;
    stereoExpanderConfig?: StereoExpanderConfig;
  }) => {
    if (effectsConfigDebounceRef.current) {
      clearTimeout(effectsConfigDebounceRef.current);
    }
    effectsConfigDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, config);
    }, 500);
  }, [profileName, fileName]);

  return {
    getConfig,
    savePlaybackPosition,
    saveStemConfig,
    saveEffectsConfig,
  };
}
