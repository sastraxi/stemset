import { useState, useEffect, useRef } from 'react';
import type { StemMetadata } from '../types';
import { getFileMetadata } from '../api';

export interface RecordingStem {
  name: string;
  audioUrl: string;
  waveformUrl: string;
  initialGain: number;
  metadata: StemMetadata | null;
}

export interface UseRecordingMetadataOptions {
  profileName: string;
  fileName: string;
  metadataUrl: string;
}

export interface UseRecordingMetadataResult {
  isLoading: boolean;
  stems: RecordingStem[];
  baseUrl: string;
}

/**
 * Hook to fetch static recording metadata (stem info, URLs).
 *
 * Responsibilities:
 * - Fetch metadata.json via API
 * - Extract stem names, URLs, initial gains
 * - Never changes after loading (static data)
 *
 * Pattern: Pure data fetcher, no audio processing.
 */
export function useRecordingMetadata({
  profileName,
  fileName,
  metadataUrl,
}: UseRecordingMetadataOptions): UseRecordingMetadataResult {
  const [isLoading, setIsLoading] = useState(true);
  const [stems, setStems] = useState<RecordingStem[]>([]);
  const [baseUrl, setBaseUrl] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Abort any previous loading operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this load
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    async function fetchMetadata() {
      setIsLoading(true);
      setStems([]);
      setBaseUrl('');

      try {
        const response = await getFileMetadata(metadataUrl);
        if (signal.aborted) return;

        // Handle both old format (flat) and new format (nested under "stems")
        const metadata: Record<string, StemMetadata> = response.stems || response;

        // Compute base URL for stems (metadata URL without the filename)
        const computedBaseUrl = metadataUrl.substring(0, metadataUrl.lastIndexOf('/') + 1);
        setBaseUrl(computedBaseUrl);

        // Extract stem information
        const stemArray: RecordingStem[] = Object.entries(metadata).map(([name, meta]) => {
          // Calculate initial gain from metadata
          let initialGain = 1;
          if (meta && typeof meta.stem_gain_adjustment_db === 'number') {
            initialGain = Math.pow(10, meta.stem_gain_adjustment_db / 20);
          }

          return {
            name,
            audioUrl: computedBaseUrl + meta.stem_url,
            waveformUrl: computedBaseUrl + meta.waveform_url,
            initialGain,
            metadata: meta,
          };
        });

        // Sort alphabetically by name
        stemArray.sort((a, b) => a.name.localeCompare(b.name));

        if (!signal.aborted) {
          setStems(stemArray);
          setIsLoading(false);
        }
      } catch (e) {
        if (!signal.aborted) {
          console.error('[useRecordingMetadata] Failed to load metadata', e);
          setIsLoading(false);
        }
      }
    }

    fetchMetadata();

    return () => {
      abortController.abort();
    };
  }, [profileName, fileName, metadataUrl]);

  return {
    isLoading,
    stems,
    baseUrl,
  };
}
