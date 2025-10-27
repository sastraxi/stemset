import { useState, useEffect, useRef } from 'react';
import type { StemMetadata, LoadedStemData } from '../types';
import { getFileMetadata } from '../api';

export interface StemTiming {
  name: string;
  fetchMs: number;
  decodeMs: number;
  totalMs: number;
  bytes: number;
}

export interface LoadingMetrics {
  startedAt: number;
  finishedAt: number;
  totalMs: number;
  stems: StemTiming[];
  metadataMs: number;
}

export interface UseAudioLoaderOptions {
  profileName: string;
  fileName: string;
  metadataUrl: string;
  audioContext: AudioContext | null;
}

export interface UseAudioLoaderResult {
  isLoading: boolean;
  loadingMetrics: LoadingMetrics | null;
  stems: Map<string, LoadedStemData>;
  duration: number;
  metadataBaseUrl: string;
}

/**
 * Manages metadata fetching and parallel audio buffer loading.
 *
 * Responsibilities:
 * - Fetch metadata with AbortController (handles StrictMode double-render)
 * - Parallel audio buffer loading with performance metrics
 * - Audio buffer decoding
 * - Duration extraction from first loaded buffer
 *
 * Pattern: useEffect with AbortController for async operations.
 * All audio data stored in Map (no individual state per stem).
 * Returns immutable AudioBuffers (can be reused for source nodes).
 */
export function useAudioLoader({
  profileName,
  fileName,
  metadataUrl,
  audioContext,
}: UseAudioLoaderOptions): UseAudioLoaderResult {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState<LoadingMetrics | null>(null);
  const [stems, setStems] = useState<Map<string, LoadedStemData>>(new Map());
  const [duration, setDuration] = useState(0);
  const [metadataBaseUrl, setMetadataBaseUrl] = useState('');

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

    if (!audioContext) {
      setIsLoading(false);
      return;
    }

    async function load() {
      setIsLoading(true);
      setLoadingMetrics(null);
      setStems(new Map());
      setDuration(0);

      const t0 = performance.now();
      const metaStart = performance.now();

      try {
        const response = await getFileMetadata(metadataUrl);
        if (signal.aborted) return;

        console.log('[useAudioLoader] Fetched metadata:', response);

        // Handle both old format (flat) and new format (nested under "stems")
        const metadata: Record<string, StemMetadata> = response.stems || response;
        const metaEnd = performance.now();

        // Compute base URL for stems (metadata URL without the filename)
        const baseUrl = metadataUrl.substring(0, metadataUrl.lastIndexOf('/') + 1);
        setMetadataBaseUrl(baseUrl);

        const newMap = new Map<string, LoadedStemData>();
        const stemEntries = Object.entries(metadata).map(([name, meta]) => [
          name,
          baseUrl + meta.stem_url,
          meta,
        ]);
        const timingAccumulator: StemTiming[] = [];

        await Promise.all(
          stemEntries.map(async ([name, url, meta]) => {
            if (signal.aborted || !url) return;

            const fetchStart = performance.now();
            try {
              const resp = await fetch(url as string, {
                signal,
                cache: 'default', // Allow browser caching
              });
              const blob = await resp.blob();
              const fetchEnd = performance.now();
              const bytes = blob.size;

              const arrayBuffer = await blob.arrayBuffer();
              if (signal.aborted) return;

              const decodeStart = performance.now();
              const buffer = await audioContext!.decodeAudioData(arrayBuffer.slice(0));
              const decodeEnd = performance.now();
              if (signal.aborted) return;

              newMap.set(name as string, {
                buffer,
                metadata: meta as StemMetadata | null,
              });

              // Set duration from first loaded buffer
              setDuration(prev => (prev === 0 ? buffer.duration : prev));

              timingAccumulator.push({
                name: name as string,
                fetchMs: fetchEnd - fetchStart,
                decodeMs: decodeEnd - decodeStart,
                totalMs: decodeEnd - fetchStart,
                bytes,
              });
            } catch (e) {
              if (!signal.aborted) {
                console.error('[useAudioLoader] Failed to load stem', name, e);
              }
            }
          })
        );

        if (signal.aborted) return;

        setStems(newMap);
        setIsLoading(false);

        const t1 = performance.now();
        setLoadingMetrics({
          startedAt: t0,
          finishedAt: t1,
          totalMs: t1 - t0,
          stems: timingAccumulator.sort((a, b) => a.name.localeCompare(b.name)),
          metadataMs: metaEnd - metaStart,
        });
      } catch (e) {
        if (!signal.aborted) {
          console.error('[useAudioLoader] Failed to load audio', e);
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileName, fileName, metadataUrl]);

  return {
    isLoading,
    loadingMetrics,
    stems,
    duration,
    metadataBaseUrl,
  };
}
