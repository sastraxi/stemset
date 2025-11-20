import { useCallback, useEffect, useMemo, useState } from "react";
import { debounce } from "lodash-es";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRecording } from "./queries/recordings";
import {
  apiRecordingsRecordingIdConfigUpdateRecordingConfigMutation,
  apiRecordingsRecordingIdGetRecordingStatusQueryKey,
} from "@/api/generated/@tanstack/react-query.gen";

/**
 * Idiomatic React Query hook for managing recording configuration.
 *
 * Design principles:
 * 1. React Query cache is the ONLY source of truth for server state
 * 2. No local state duplication - read directly from cache
 * 3. Mutations use invalidation (not manual cache updates)
 * 4. Debouncing happens at UI layer (not in persistence hook)
 */
export function useRecordingConfig(recordingId: string | undefined) {
  const queryClient = useQueryClient();

  // Single query for all recording data (including config)
  const { data: recording, isLoading, error } = useRecording(recordingId);

  // Mutation for updating any config key
  const mutationOptions =
    apiRecordingsRecordingIdConfigUpdateRecordingConfigMutation();

  const updateConfig = useMutation({
    ...mutationOptions,
    onError: (_err, variables) => {
      // Show user-friendly error message
      const displayName =
        variables.body.key === "playbackPosition"
          ? "playback position"
          : variables.body.key === "stems"
            ? "volume settings"
            : variables.body.key;

      toast.error(
        `Failed to save ${displayName}. Your changes may not be persisted.`,
      );
    },
    onSettled: () => {
      // Invalidate to ensure cache is consistent with backend
      // React Query will refetch only if the query is active
      if (recordingId) {
        queryClient.invalidateQueries({
          queryKey: apiRecordingsRecordingIdGetRecordingStatusQueryKey({
            path: { recording_id: recordingId },
          }),
        });
      }
    },
  });

  return {
    config: recording?.config ?? {},
    isLoading,
    error: error as Error | null,
    isSaving: updateConfig.isPending,
    updateConfig: (key: string, value: Record<string, unknown>) => {
      if (!recordingId) {
        console.error("Cannot update config: no recording ID");
        return;
      }
      updateConfig.mutate({
        path: { recording_id: recordingId },
        body: { key, value },
      });
    },
  };
}

/**
 * Compatibility hook that provides the same interface as useConfigPersistence
 * but uses idiomatic React Query patterns under the hood.
 *
 * This allows effect hooks to migrate without changing their implementation.
 */
export function useConfigKey<T>(
  recordingId: string,
  configKey: string,
  defaultValue: T,
  debounceMs = 500,
): {
  config: T;
  setConfig: (value: T | ((prev: T) => T)) => void;
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
} {
  const { config: allConfig, updateConfig, isLoading, isSaving, error } = useRecordingConfig(recordingId);

  // Local state for immediate UI updates
  const [localValue, setLocalValue] = useState<T | null>(null);

  // Get backend value for this config key
  const backendValue = useMemo(() => {
    const value = allConfig[configKey as keyof typeof allConfig] as T | null | undefined;
    return value ?? null;
  }, [allConfig, configKey]);

  // Initialize local state from backend on first load
  useEffect(() => {
    if (!isLoading && localValue === null && backendValue !== null) {
      setLocalValue(backendValue);
    }
  }, [backendValue, isLoading, localValue]);

  // Debounced save
  const debouncedSave = useMemo(
    () =>
      debounce((value: T) => {
        updateConfig(configKey, value as Record<string, unknown>);
      }, debounceMs),
    [updateConfig, configKey, debounceMs],
  );

  // Setter that updates local state and triggers debounced save
  const setConfig = useCallback(
    (value: T | ((prev: T) => T)) => {
      const newValue = typeof value === "function"
        ? (value as (prev: T) => T)(localValue ?? backendValue ?? defaultValue)
        : value;

      setLocalValue(newValue);
      debouncedSave(newValue);
    },
    [localValue, backendValue, defaultValue, debouncedSave],
  );

  // Return local value if set, otherwise backend value, otherwise default
  const config = localValue ?? backendValue ?? defaultValue;

  return {
    config,
    setConfig,
    isLoading,
    isSaving,
    error,
  };
}
