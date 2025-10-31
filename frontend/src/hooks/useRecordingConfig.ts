import { useCallback, useRef, useState, useEffect } from 'react';
import type { RecordingUserConfig, StemUserConfig, EffectsChainConfig } from '../types';
import {
  DEFAULT_EQ_CONFIG,
  DEFAULT_COMPRESSOR_CONFIG,
  DEFAULT_REVERB_CONFIG,
  DEFAULT_STEREO_EXPANDER_CONFIG,
} from './effects';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

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
  recordingId: string;  // Recording UUID for API-based config
}

export interface UseRecordingConfigResult {
  getConfig: () => RecordingUserConfig;
  savePlaybackPosition: (position: number) => void;
  saveStemConfigs: (stems: Record<string, StemUserConfig>) => void;
  saveEffectsConfig: (config: EffectsChainConfig) => void;
}

/**
 * Hook to manage per-recording mutable configuration.
 *
 * Stores all state in PostgreSQL database via API.
 * No localStorage persistence - database is single source of truth.
 *
 * Responsibilities:
 * - Load saved config from API on mount
 * - Debounced saves to prevent excessive writes
 * - Show toast notifications for load/save events
 * - Provide stable callbacks for saving different config sections
 */
export function useRecordingConfig({
  recordingId,
}: UseRecordingConfigOptions): UseRecordingConfigResult {
  const { getToken } = useAuth();
  const [apiConfig, setApiConfig] = useState<RecordingUserConfig | null>(null);
  const apiSaveDisabledRef = useRef(false);

  // Debounce timers
  const playbackPositionDebounceRef = useRef<number | null>(null);
  const stemConfigsDebounceRef = useRef<number | null>(null);
  const effectsConfigDebounceRef = useRef<number | null>(null);

  // Fetch config from API on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const token = getToken();
        if (!token) return;

        const response = await fetch(`${API_BASE}/api/recordings/${recordingId}/config`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();

          // Convert API response to RecordingUserConfig format
          const config: RecordingUserConfig = {
            playbackPosition: data.playbackPosition?.position ?? 0,
            stems: data.stems ?? {},
            effects: data.effects ?? {
              eq: DEFAULT_EQ_CONFIG,
              compressor: DEFAULT_COMPRESSOR_CONFIG,
              reverb: DEFAULT_REVERB_CONFIG,
              stereoExpander: DEFAULT_STEREO_EXPANDER_CONFIG,
            },
          };

          setApiConfig(config);

          // Check if we loaded any non-default settings
          const hasSettings =
            config.playbackPosition > 0 ||
            Object.keys(config.stems).length > 0 ||
            (config.effects.eq.bands.some(b => b.gain !== 0)) ||
            config.effects.compressor.enabled ||
            config.effects.reverb.enabled ||
            config.effects.stereoExpander.enabled;

          if (hasSettings) {
            toast.success('Settings loaded from database');
          }
        }
      } catch (error) {
        console.error('Failed to fetch recording config:', error);
        toast.error('Failed to load settings from database');
      }
    };

    fetchConfig();
  }, [recordingId, getToken]);

  // Save to API
  const saveToApi = useCallback(async (key: string, value: any) => {
    if (apiSaveDisabledRef.current) {
      console.warn(`API saves disabled due to previous error, skipping save for ${key}`);
      return;
    }

    try {
      const token = getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE}/api/recordings/${recordingId}/config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, value }),
      });

      if (response.ok) {
        // Show success toast (but not for playback position - too noisy)
        if (key !== 'playbackPosition') {
          toast.success(`${key === 'stems' ? 'Volume' : 'Effects'} settings saved`);
        }
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error(`Failed to save ${key}:`, error);
      apiSaveDisabledRef.current = true;

      const settingName = key === 'playbackPosition' ? 'playback position' :
                         key === 'stems' ? 'volume' : 'effects';
      toast.error(`Failed to save ${settingName} settings. Further saves disabled.`);
    }
  }, [recordingId, getToken]);

  const getConfig = useCallback((): RecordingUserConfig => {
    if (apiConfig) {
      // Config loaded from database
      return {
        playbackPosition: apiConfig.playbackPosition ?? DEFAULT_RECORDING_CONFIG.playbackPosition,
        stems: apiConfig.stems ?? DEFAULT_RECORDING_CONFIG.stems,
        effects: {
          eq: { ...DEFAULT_EQ_CONFIG, ...(apiConfig.effects?.eq || {}) },
          compressor: { ...DEFAULT_COMPRESSOR_CONFIG, ...(apiConfig.effects?.compressor || {}) },
          reverb: { ...DEFAULT_REVERB_CONFIG, ...(apiConfig.effects?.reverb || {}) },
          stereoExpander: { ...DEFAULT_STEREO_EXPANDER_CONFIG, ...(apiConfig.effects?.stereoExpander || {}) },
        },
      };
    } else {
      // Still loading from database, return defaults
      return DEFAULT_RECORDING_CONFIG;
    }
  }, [apiConfig]);

  const savePlaybackPosition = useCallback((position: number) => {
    if (playbackPositionDebounceRef.current) {
      clearTimeout(playbackPositionDebounceRef.current);
    }
    playbackPositionDebounceRef.current = window.setTimeout(() => {
      saveToApi('playbackPosition', { position });
    }, 1000);
  }, [saveToApi]);

  const saveStemConfigs = useCallback((stems: Record<string, StemUserConfig>) => {
    if (stemConfigsDebounceRef.current) {
      clearTimeout(stemConfigsDebounceRef.current);
    }
    stemConfigsDebounceRef.current = window.setTimeout(() => {
      saveToApi('stems', stems);
    }, 500);
  }, [saveToApi]);

  const saveEffectsConfig = useCallback((effects: EffectsChainConfig) => {
    if (effectsConfigDebounceRef.current) {
      clearTimeout(effectsConfigDebounceRef.current);
    }
    effectsConfigDebounceRef.current = window.setTimeout(() => {
      saveToApi('effects', effects);
    }, 500);
  }, [saveToApi]);

  return {
    getConfig,
    savePlaybackPosition,
    saveStemConfigs,
    saveEffectsConfig,
  };
}
