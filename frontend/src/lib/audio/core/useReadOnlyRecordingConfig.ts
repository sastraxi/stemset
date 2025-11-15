import { useMemo } from "react";
import { useRecording } from "../../../hooks/queries";
import type { StemUserConfig } from "../types";

export interface UseReadOnlyRecordingConfigResult {
  stemConfig: Record<string, StemUserConfig>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Read-only hook for accessing saved recording configuration.
 *
 * This hook fetches the recording's saved configuration from the backend
 * but does NOT provide any way to modify or persist changes. It's designed
 * for ClipPlayer where we want to reflect the saved mix from edit mode
 * but not allow persistence of any modifications.
 *
 * Usage:
 * - ClipPlayer: Read saved stem compression, EQ, master effects
 * - Any temporary changes (like local mutes) are kept in component state
 *
 * Contrast with useConfigPersistence:
 * - useConfigPersistence: Reads AND writes config (for StemPlayer)
 * - useReadOnlyRecordingConfig: Only reads config (for ClipPlayer)
 */
export function useReadOnlyRecordingConfig(
  recordingId: string,
): UseReadOnlyRecordingConfigResult {
  const { data: recording, isLoading, error } = useRecording(recordingId);

  // Extract stem config from recording
  const stemConfig = useMemo(() => {
    if (!recording?.config?.stems) {
      return {};
    }
    return recording.config.stems as Record<string, StemUserConfig>;
  }, [recording]);

  return {
    stemConfig,
    isLoading,
    error: error as Error | null,
  };
}
