import { useState, useEffect } from "react";
import type { StemResponse } from "../api/generated/types.gen";

export interface RecordingStem {
  name: string;
  audioUrl: string;
  waveformUrl: string;
  initialGain: number;
  metadata: StemResponse | null;
}

export interface UseRecordingMetadataOptions {
  profileName: string;
  fileName: string;
  stemsData: StemResponse[];
}

export interface UseRecordingMetadataResult {
  isLoading: boolean;
  stems: RecordingStem[];
  baseUrl: string;
}

/**
 * Hook to process recording stem metadata from the API response.
 *
 * Responsibilities:
 * - Convert stems data from API to RecordingStem format
 * - Extract stem names, URLs, initial gains
 * - Never changes after loading (static data)
 *
 * Pattern: Pure data processor, no audio processing.
 */
export function useRecordingMetadata({
  profileName,
  fileName,
  stemsData,
}: UseRecordingMetadataOptions): UseRecordingMetadataResult {
  const [isLoading, setIsLoading] = useState(true);
  const [stems, setStems] = useState<RecordingStem[]>([]);
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setStems([]);

    try {
      // Set base URL for compatibility (though not needed with full URLs from API)
      const computedBaseUrl = `/media/${profileName}/${fileName}/`;
      setBaseUrl(computedBaseUrl);

      // Convert API stem responses to RecordingStem format
      const stemArray: RecordingStem[] = stemsData.map((stemData) => {
        // Calculate initial gain from metadata
        let initialGain = 1;
        if (typeof stemData.stem_gain_adjustment_db === "number") {
          initialGain = Math.pow(10, stemData.stem_gain_adjustment_db / 20);
        }

        return {
          name: stemData.stem_type,
          audioUrl: stemData.audio_url,
          waveformUrl: stemData.waveform_url,
          initialGain,
          metadata: stemData,
        };
      });

      // Sort alphabetically by name
      stemArray.sort((a, b) => a.name.localeCompare(b.name));

      setStems(stemArray);
      setIsLoading(false);
    } catch (e) {
      console.error("[useRecordingMetadata] Failed to process stems data", e);
      setIsLoading(false);
    }
  }, [profileName, fileName, stemsData]);

  return {
    isLoading,
    stems,
    baseUrl,
  };
}
