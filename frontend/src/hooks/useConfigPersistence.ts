import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface UseConfigPersistenceOptions<T> {
  recordingId: string;
  configKey: string; // 'eq', 'compressor', 'reverb', 'stereoExpander', 'stems', 'playbackPosition'
  defaultValue: T;
  debounceMs?: number; // Default: 500ms
  skipFirstSave?: boolean; // Default: true - skip save on initial mount
}

export interface UseConfigPersistenceResult<T> {
  config: T;
  setConfig: (value: T | ((prev: T) => T)) => void;
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
}

/**
 * Generic hook for persisting config values to the database with React Query.
 *
 * Features:
 * - Automatic loading from API on mount (cached via React Query)
 * - Debounced saves to prevent excessive writes
 * - Optimistic updates with automatic rollback on error
 * - Independent persistence per config key (no race conditions)
 * - Proper cleanup on unmount
 *
 * Usage:
 * ```ts
 * const { config, setConfig, isLoading } = useConfigPersistence({
 *   recordingId: '123',
 *   configKey: 'eq',
 *   defaultValue: DEFAULT_EQ_CONFIG,
 * });
 * ```
 */
export function useConfigPersistence<T>({
  recordingId,
  configKey,
  defaultValue,
  debounceMs = 500,
  skipFirstSave = true,
}: UseConfigPersistenceOptions<T>): UseConfigPersistenceResult<T> {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Local state for the config
  const [config, setConfigState] = useState<T>(defaultValue);

  // Track if this is the first render (to skip initial save)
  const isFirstRenderRef = useRef(skipFirstSave);

  // Debounce timer
  const debounceTimerRef = useRef<number | null>(null);

  // Fetch config from API
  const { data: fetchedConfig, isLoading, error } = useQuery({
    queryKey: ['recordingConfig', recordingId, configKey],
    queryFn: async (): Promise<T | null> => {
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
        if (response.status === 404) {
          return null; // No config exists yet
        }
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      // Extract the specific config key from the response
      const configValue = data[configKey] as T | undefined;
      return configValue ?? null;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });

  // Mutation for saving config
  const mutation = useMutation({
    mutationFn: async (value: T) => {
      const token = getToken();
      if (!token) {
        throw new Error('No auth token available');
      }

      const response = await fetch(`${API_BASE}/api/recordings/${recordingId}/config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: configKey, value }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate OTHER config queries for this recording (multi-tab sync)
      // But don't refetch THIS query to avoid infinite loop
      queryClient.invalidateQueries({
        queryKey: ['recordingConfig', recordingId],
        refetchType: 'none', // Don't trigger refetch, just mark as stale
      });
    },
    onError: () => {
      // Show user-friendly error message
      const displayName = configKey === 'playbackPosition' ? 'playback position' :
        configKey === 'stems' ? 'volume settings' : configKey;
      toast.error(`Failed to save ${displayName}. Your changes may not be persisted.`);

      // Note: React Query will automatically roll back optimistic update
    },
  });

  // Initialize config from fetched data
  useEffect(() => {
    if (fetchedConfig !== null && fetchedConfig !== undefined) {
      setConfigState(fetchedConfig);
      isFirstRenderRef.current = false; // Mark as loaded, enable saves
    } else if (!isLoading && fetchedConfig === null) {
      // No saved config exists, use default
      isFirstRenderRef.current = false; // Enable saves
    }
  }, [fetchedConfig, isLoading, configKey]);

  // Debounced save when config changes
  useEffect(() => {
    // Skip save until initial fetch completes (prevents race conditions)
    if (isLoading || isFirstRenderRef.current) {
      return;
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Start new debounce timer
    debounceTimerRef.current = window.setTimeout(() => {
      mutation.mutate(config);
    }, debounceMs);

    // Cleanup timer on unmount or config change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [config, configKey, debounceMs, isLoading]); // Include isLoading to re-enable saves after fetch

  // Wrapper for setState that handles both direct values and updater functions
  const setConfig = useCallback((value: T | ((prev: T) => T)) => {
    if (typeof value === 'function') {
      setConfigState(value as (prev: T) => T);
    } else {
      setConfigState(value);
    }
  }, []);

  return {
    config,
    setConfig,
    isLoading,
    isSaving: mutation.isPending,
    error: error as Error | null,
  };
}
