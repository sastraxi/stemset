import { useState, useEffect, useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { useRecording } from "./queries";
import { apiRecordingsRecordingIdGetRecordingStatusQueryKey } from "@/api/generated/@tanstack/react-query.gen";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface UseConfigPersistenceOptions<T> {
  recordingId: string;
  configKey: string; // 'eq', 'compressor', 'reverb', 'stereoExpander', 'stems', 'playbackPosition'
  defaultValue: T;
  debounceMs?: number; // Default: 500ms
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
 * Design principles:
 * 1. Backend config (from React Query cache) is the source of truth for persisted state
 * 2. Local state handles immediate UI updates
 * 3. Only save when user actually changes a value (not on initial load)
 * 4. Use stable object identity checks to prevent unnecessary saves
 * 5. Debounce saves to prevent excessive writes
 */
export function useConfigPersistence<T>({
  recordingId,
  configKey,
  defaultValue,
  debounceMs = 500,
}: UseConfigPersistenceOptions<T>): UseConfigPersistenceResult<T> {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Fetch recording data (uses React Query cache)
  const { data: recording, isLoading, error } = useRecording(recordingId);

  // Extract the config for this key from the recording
  // This is the "persisted" value from the backend
  const backendConfig = useMemo(() => {
    if (!recording?.config) return null;
    const value = recording.config[
      configKey as keyof typeof recording.config
    ] as T | null | undefined;
    return value ?? null;
  }, [recording, configKey]);

  // Local state for immediate UI updates
  // Initialize with backend config if available, otherwise use default
  const [config, setConfigState] = useState<T>(() => {
    // On mount: use backend config if it exists
    // Don't merge with defaults - backend config is the source of truth
    if (backendConfig !== null) {
      return backendConfig as T;
    }
    return defaultValue;
  });

  // Track whether we've initialized from backend yet
  // This prevents saving the initial backend value back to the server
  const [initialized, setInitialized] = useState(false);

  // When backend config loads/changes, update local state
  // But only if we haven't initialized yet OR if backend changed externally
  useEffect(() => {
    if (isLoading) return;

    if (!initialized) {
      // First load: set local state to backend value (no merge with defaults)
      if (backendConfig !== null) {
        setConfigState(backendConfig as T);
      }
      setInitialized(true);
    }
    // Note: We don't update local state on subsequent backend changes
    // because the user might be actively editing. Our debounced save
    // will push local changes to the backend.
  }, [backendConfig, isLoading, initialized]);

  // Mutation for saving config to backend
  const mutation = useMutation({
    mutationFn: async (value: T) => {
      const token = getToken();
      if (!token) {
        throw new Error("No auth token available");
      }

      const response = await fetch(
        `${API_BASE}/api/recordings/${recordingId}/config`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ key: configKey, value }),
        },
      );

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    },
    onMutate: async (newValue) => {
      // Optimistically update the cache immediately
      const queryKey = apiRecordingsRecordingIdGetRecordingStatusQueryKey({
        path: { recording_id: recordingId },
      });

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(queryKey);

      // Optimistically update
      queryClient.setQueryData(queryKey, (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return {
          ...old,
          config: {
            ...(old as { config?: Record<string, unknown> }).config,
            [configKey]: newValue,
          },
        };
      });

      // Return context for rollback
      return { previousData, queryKey };
    },
    onError: (_err, _newValue, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }

      // Show user-friendly error message
      const displayName =
        configKey === "playbackPosition"
          ? "playback position"
          : configKey === "stems"
            ? "volume settings"
            : configKey;
      toast.error(
        `Failed to save ${displayName}. Your changes may not be persisted.`,
      );
    },
  });

  // Stable JSON strings for comparison (avoid re-computing on every render)
  const configJson = useMemo(() => JSON.stringify(config), [config]);
  const backendConfigJson = useMemo(
    () => (backendConfig !== null ? JSON.stringify(backendConfig) : null),
    [backendConfig],
  );
  const defaultValueJson = useMemo(
    () => JSON.stringify(defaultValue),
    [defaultValue],
  );

  // Debounced save effect
  useEffect(() => {
    // Don't save until we've initialized
    if (!initialized) return;

    // Don't save during initial load
    if (isLoading) return;

    // Don't save if config matches backend (no change)
    if (backendConfigJson !== null && configJson === backendConfigJson) {
      return;
    }

    // If backend has no config yet and our config equals default, don't save
    // This prevents saving defaults on first load
    if (backendConfigJson === null && configJson === defaultValueJson) {
      return;
    }

    // Debounce the save
    const timer = setTimeout(() => {
      mutation.mutate(config);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [
    configJson,
    backendConfigJson,
    defaultValueJson,
    initialized,
    isLoading,
    mutation,
    debounceMs,
    config,
  ]);

  // Wrapper for setState that handles both direct values and updater functions
  const setConfig = useCallback((value: T | ((prev: T) => T)) => {
    setConfigState(value);
  }, []);

  return {
    config,
    setConfig,
    isLoading,
    isSaving: mutation.isPending,
    error: error as Error | null,
  };
}
