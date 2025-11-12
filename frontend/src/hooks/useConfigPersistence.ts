import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { useRecording } from "./queries";

const API_BASE = import.meta.env.VITE_API_URL || "";

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

	// Track if we've loaded the initial config (to prevent overwriting local changes)
	const hasLoadedInitialConfigRef = useRef(false);

	// Track if this is the first render (to skip saving the initial fetched config)
	const isFirstRenderRef = useRef(skipFirstSave);

	// Track if there are unsaved changes pending
	const hasUnsavedChangesRef = useRef(false);

	// Debounce timer
	const debounceTimerRef = useRef<number | null>(null);

	// Ref to always have latest config value (prevents stale closures in debounce timer)
	const configRef = useRef<T>(defaultValue);

	// Stable reference to defaultValue to avoid stale closures while preventing infinite loops
	const defaultValueRef = useRef(defaultValue);
	defaultValueRef.current = defaultValue;

	// Fetch config from recording (uses cached recording data from useRecording)
	const { data: recording, isLoading, error } = useRecording(recordingId);

	// Extract the specific config key from the recording
	const fetchedConfig = recording?.config?.[
		configKey as keyof typeof recording.config
	] as T | null | undefined;

	// Keep configRef in sync with config state (ensures timer always has latest value)
	useEffect(() => {
		configRef.current = config;
	}, [config]);

	// Stable mutation function (doesn't recreate on auth re-renders)
	const mutationFn = useCallback(
		async (value: T) => {
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

			// Server returns 204 No Content, no need to parse response
			return;
		},
		[getToken, recordingId, configKey],
	);

	// Mutation for saving config
	const mutation = useMutation({
		mutationFn,
		onSuccess: (_data, newValue) => {
			// Clear unsaved changes flag (save completed successfully)
			hasUnsavedChangesRef.current = false;

			// Manually update the recording cache with the new config value
			queryClient.setQueryData(["recording", recordingId], (old: unknown) => {
				if (!old || typeof old !== "object") return old;

				return {
					...old,
					config: {
						...(old as { config?: Record<string, unknown> }).config,
						[configKey]: newValue,
					},
				};
			});

			// Don't invalidate - we've already updated the cache manually
			// Invalidating causes unnecessary refetches
		},
		onError: () => {
			// Also clear flag on error (don't block navigation if save failed)
			hasUnsavedChangesRef.current = false;

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

			// Note: React Query will automatically roll back optimistic update
		},
	});

	// Initialize config from fetched data (only on first load)
	useEffect(() => {
		// Skip if we've already loaded the initial config
		if (hasLoadedInitialConfigRef.current) {
			return;
		}

		// Wait until loading is complete
		if (isLoading) {
			return;
		}

		if (fetchedConfig !== null && fetchedConfig !== undefined) {
			// Merge fetched config with defaults to handle missing fields (backward compatibility)
			// Use ref to get latest defaultValue without adding it to deps (prevents infinite loops)
			setConfigState({ ...defaultValueRef.current, ...fetchedConfig });
		}

		// Mark as loaded - this prevents this effect from running again
		hasLoadedInitialConfigRef.current = true;
		// Note: Don't set isFirstRenderRef to false here! That would cause the loaded config
		// to trigger a save. Let it remain true until the next user-initiated change.
	}, [fetchedConfig, isLoading, configKey]);

	// Prevent navigation/tab close when there are unsaved changes
	useEffect(() => {
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			// Only block if there's an active debounce timer (unsaved changes waiting to be sent)
			if (debounceTimerRef.current) {
				// Clear the timer and trigger immediate save
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
				// Send save using fetch with keepalive (sendBeacon doesn't support PATCH)
				const token = getToken();
				if (token) {
					fetch(`${API_BASE}/api/recordings/${recordingId}/config`, {
						method: "PATCH",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({ key: configKey, value: configRef.current }),
						keepalive: true, // Ensures request completes even if page unloads
					}).catch(() => {
						// Ignore errors during unload
					});
				}

				// Show browser's native warning dialog
				e.preventDefault();
				return "";
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [getToken, recordingId, configKey]); // Removed mutation.isPending to prevent infinite re-renders

	// Debounced save when config changes
	useEffect(() => {
		// Skip save until initial fetch completes (prevents race conditions)
		if (isLoading) {
			return;
		}

		// Skip the first change after initial load (that's the fetched config being set)
		if (isFirstRenderRef.current) {
			isFirstRenderRef.current = false; // Next change will be a real user edit
			return;
		}

		// Mark as having unsaved changes (pending timer)
		hasUnsavedChangesRef.current = true;

		// Clear existing timer
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		// Start new debounce timer
		debounceTimerRef.current = window.setTimeout(() => {
			// Clear timer ref first
			debounceTimerRef.current = null;
			// Use configRef to get the latest value (prevents stale closures)
			mutation.mutate(configRef.current);
		}, debounceMs);

		// Cleanup timer on unmount or config change
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null; // Clear ref so beforeunload doesn't fire
			}
		};
	}, [config, debounceMs, isLoading, mutation]);

	// Wrapper for setState that handles both direct values and updater functions
	const setConfig = useCallback((value: T | ((prev: T) => T)) => {
		if (typeof value === "function") {
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
