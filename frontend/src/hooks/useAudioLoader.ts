import { useState, useEffect, useRef } from "react";
import type { StemAudioData } from "../types";
import type { StemResponse } from "../api/generated/types.gen";
import { getToken } from "../lib/storage";

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
	stemsData: StemResponse[];
	audioContext: AudioContext | null;
}

export interface UseAudioLoaderResult {
	isLoading: boolean;
	loadingMetrics: LoadingMetrics | null;
	stems: Map<string, StemAudioData>;
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
	stemsData,
	audioContext,
}: UseAudioLoaderOptions): UseAudioLoaderResult {
	const [isLoading, setIsLoading] = useState(true);
	const [loadingMetrics, setLoadingMetrics] = useState<LoadingMetrics | null>(
		null,
	);
	const [stems, setStems] = useState<Map<string, StemAudioData>>(new Map());
	const [duration, setDuration] = useState(0);
	const [metadataBaseUrl, setMetadataBaseUrl] = useState("");

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

		if (!audioContext || !stemsData.length) {
			setIsLoading(false);
			return;
		}

		async function load() {
			setIsLoading(true);
			setLoadingMetrics(null);
			setStems(new Map());
			setDuration(0);

			const t0 = performance.now();

			try {
				// Set base URL for media files
				const baseUrl = `/media/${profileName}/${fileName}/`;
				setMetadataBaseUrl(baseUrl);

				console.log("[useAudioLoader] Loading stems:", stemsData);

				const newMap = new Map<string, StemAudioData>();
				const timingAccumulator: StemTiming[] = [];

				// Get auth token for media requests
				const token = getToken();
				const headers: HeadersInit = {};
				if (token) {
					headers.Authorization = `Bearer ${token}`;
				}

				await Promise.all(
					stemsData.map(async (stemResponse) => {
						if (signal.aborted) return;

						const fetchStart = performance.now();
						try {
							const resp = await fetch(stemResponse.audio_url, {
								signal,
								cache: "default", // Allow browser caching
								headers,
							});
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

							newMap.set(stemResponse.stem_type, {
								buffer,
								metadata: stemResponse,
							});

							// Set duration from first loaded buffer
							setDuration((prev) => (prev === 0 ? buffer.duration : prev));

							timingAccumulator.push({
								name: stemResponse.stem_type,
								fetchMs: fetchEnd - fetchStart,
								decodeMs: decodeEnd - decodeStart,
								totalMs: decodeEnd - fetchStart,
								bytes,
							});
						} catch (e) {
							if (!signal.aborted) {
								console.error(
									"[useAudioLoader] Failed to load stem",
									stemResponse.stem_type,
									e,
								);
							}
						}
					}),
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
					metadataMs: 0, // No metadata fetching needed anymore
				});
			} catch (e) {
				if (!signal.aborted) {
					console.error("[useAudioLoader] Failed to load audio", e);
					setIsLoading(false);
				}
			}
		}

		load();

		return () => {
			abortController.abort();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profileName, fileName, stemsData]);

	return {
		isLoading,
		loadingMetrics,
		stems,
		duration,
		metadataBaseUrl,
	};
}
