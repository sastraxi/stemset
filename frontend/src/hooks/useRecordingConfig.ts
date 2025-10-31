import { useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
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

export interface UseRecordingConfigOptions {
  recordingId: string;  // Recording UUID for API-based config
}

export interface UseRecordingConfigResult {
  config: RecordingUserConfig | null | undefined; // undefined = loading, null = no config exists, object = loaded
  isLoading: boolean;
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
 * - Load saved config from API on mount (via React Query)
 * - Debounced saves to prevent excessive writes
 * - Show toast notifications for load/save events
 * - Provide stable callbacks for saving different config sections
 * - Prevent saves until initial config is loaded (fixes race condition)
 */
export function useRecordingConfig({
  recordingId,
}: UseRecordingConfigOptions): UseRecordingConfigResult {
  const { getToken } = useAuth();
  const apiSaveDisabledRef = useRef(false);

  // Debounce timers
  const playbackPositionDebounceRef = useRef<number | null>(null);
  const stemConfigsDebounceRef = useRef<number | null>(null);
  const effectsConfigDebounceRef = useRef<number | null>(null);

  // Fetch config from API using React Query
  const { data: apiConfig, isLoading } = useQuery({
    queryKey: ['recordingConfig', recordingId],
    queryFn: async (): Promise<RecordingUserConfig | null> => {
      const token = getToken();
      if (!token) {
        throw new Error('No auth token available');
      }

      const response = await fetch(`${API_BASE}/api/recordings/${recordingId}/config`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // 404 means no config exists yet - return null
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Server returned ${response.status}`);
      }

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

      return config;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - relatively high as requested
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 2,
  });

  // Save to API (only after initial load to prevent race condition)
  const saveToApi = useCallback(async (key: string, value: any) => {
    // CRITICAL: Don't save until initial config is loaded
    // This prevents race condition where defaults overwrite actual saved values
    if (isLoading) {
      console.debug(`Config still loading, skipping save for ${key}`);
      return;
    }

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
  }, [recordingId, getToken, isLoading]);

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

  // Return config directly from React Query
  // - undefined = still loading
  // - null = loaded, but no config exists
  // - RecordingUserConfig = loaded with data
  return {
    config: apiConfig,
    isLoading,
    savePlaybackPosition,
    saveStemConfigs,
    saveEffectsConfig,
  };
}
