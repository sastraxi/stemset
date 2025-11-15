import { useState, useEffect, useRef } from "react";
import type { StemResponse } from "../../../api/generated/types.gen";
import type { LoadedStem, LoadingMetrics } from "../types";
import { getToken } from "../../storage";

export interface UseAudioBufferLoaderOptions {
  stems: StemResponse[];
  audioContext: AudioContext | null;
  trackMetrics?: boolean; // Enable detailed performance metrics
}

export interface UseAudioBufferLoaderResult {
  isLoading: boolean;
  loadingMetrics: LoadingMetrics | null;
  buffers: Map<string, LoadedStem>;
  duration: number;
}

/**
 * Unified audio buffer loader for both StemPlayer and ClipPlayer.
 *
 * Features:
 * - Parallel fetch and decode of all stems
 * - Auth headers for local /media URLs
 * - Browser caching support
 * - Optional performance metrics tracking
 * - Abort controller for cleanup
 *
 * Usage:
 * - StemPlayer: trackMetrics=true for detailed profiling
 * - ClipPlayer: trackMetrics=false for lightweight operation
 */
export function useAudioBufferLoader({
  stems,
  audioContext,
  trackMetrics = false,
}: UseAudioBufferLoaderOptions): UseAudioBufferLoaderResult {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState<LoadingMetrics | null>(
    null,
  );
  const [buffers, setBuffers] = useState<Map<string, LoadedStem>>(new Map());
  const [duration, setDuration] = useState(0);

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

    if (!audioContext || !stems.length) {
      setIsLoading(false);
      return;
    }

    async function load() {
      setIsLoading(true);
      setLoadingMetrics(null);
      setBuffers(new Map());
      setDuration(0);

      try {
        const newMap = new Map<string, LoadedStem>();
        const metrics: Array<{
          name: string;
          fetchTimeMs: number;
          decodeTimeMs: number;
          bytes: number;
        }> = [];

        await Promise.all(
          stems.map(async (stem) => {
            if (signal.aborted) return;

            const fetchStart = performance.now();
            try {
              // Only add auth headers for local /media URLs
              // Presigned R2 URLs have auth in the URL itself
              const isLocalMedia = stem.audio_url.startsWith("/media");
              const headers: HeadersInit = {};
              if (isLocalMedia) {
                const token = getToken();
                if (token) {
                  headers.Authorization = `Bearer ${token}`;
                }
              }

              const resp = await fetch(stem.audio_url, {
                signal,
                cache: "default", // Allow browser caching
                headers,
              });

              if (!resp.ok) {
                throw new Error(
                  `Failed to fetch ${stem.stem_type}: ${resp.status}`,
                );
              }

              const blob = await resp.blob();
              const fetchEnd = performance.now();
              const bytes = blob.size;

              const arrayBuffer = await blob.arrayBuffer();
              if (signal.aborted) return;

              const decodeStart = performance.now();
              const buffer = await audioContext!.decodeAudioData(
                arrayBuffer.slice(0),
              );
              const decodeEnd = performance.now();
              if (signal.aborted) return;

              newMap.set(stem.stem_type, {
                buffer,
                metadata: {
                  stem_type: stem.stem_type,
                  waveform_url: stem.waveform_url || "",
                },
              });

              // Set duration from longest buffer
              setDuration((prev) => Math.max(prev, buffer.duration));

              if (trackMetrics) {
                metrics.push({
                  name: stem.stem_type,
                  fetchTimeMs: fetchEnd - fetchStart,
                  decodeTimeMs: decodeEnd - decodeStart,
                  bytes,
                });
              }
            } catch (e) {
              if (!signal.aborted) {
                console.error(
                  "[useAudioBufferLoader] Failed to load stem",
                  stem.stem_type,
                  e,
                );
              }
            }
          }),
        );

        if (signal.aborted) return;

        setBuffers(newMap);
        setIsLoading(false);

        if (trackMetrics) {
          setLoadingMetrics({
            totalFetchTimeMs: metrics.reduce(
              (sum, m) => sum + m.fetchTimeMs,
              0,
            ),
            totalDecodeTimeMs: metrics.reduce(
              (sum, m) => sum + m.decodeTimeMs,
              0,
            ),
            totalBytes: metrics.reduce((sum, m) => sum + m.bytes, 0),
            stems: metrics.sort((a, b) => a.name.localeCompare(b.name)),
          });
        }
      } catch (e) {
        if (!signal.aborted) {
          console.error("[useAudioBufferLoader] Failed to load audio", e);
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      abortController.abort();
    };
  }, [stems, audioContext, trackMetrics]);

  return {
    isLoading,
    loadingMetrics,
    buffers,
    duration,
  };
}
