import { useCallback, useEffect, useRef, useState } from "react";
import type { StemResponse } from "../../../api/generated/types.gen";
import { getToken } from "../../../lib/storage";
import { DEFAULT_SAMPLE_RATE } from "./constants";

/**
 * Audio buffer with metadata
 */
export interface StemAudioBuffer {
	buffer: AudioBuffer;
	stemType: string;
	metadata?: StemResponse;
}

// Shared audio context for all clip players (avoid creating multiple contexts)
let sharedAudioContext: AudioContext | null = null;

/**
 * Hook for managing Web Audio context
 * For clip players, uses a shared context to avoid creation/closure issues
 */
export function useAudioGraph(sampleRate: number = DEFAULT_SAMPLE_RATE, shared: boolean = false) {
	const audioContextRef = useRef<AudioContext | null>(null);

	const getContext = useCallback(() => {
		if (shared) {
			// Use shared context for clip players
			if (!sharedAudioContext || sharedAudioContext.state === "closed") {
				sharedAudioContext = new AudioContext({ sampleRate });
			}
			return sharedAudioContext;
		}

		// Use dedicated context for recording players
		if (!audioContextRef.current) {
			audioContextRef.current = new AudioContext({ sampleRate });
		}
		return audioContextRef.current;
	}, [sampleRate, shared]);

	// Cleanup on unmount (only for dedicated contexts)
	useEffect(() => {
		if (shared) return; // Don't close shared context

		return () => {
			const ctx = audioContextRef.current;
			if (ctx && ctx.state !== "closed") {
				ctx.close();
			}
		};
	}, [shared]);

	return { getContext };
}

/**
 * Hook for loading audio buffers from URLs
 */
export interface AudioLoaderOptions {
	stems: StemResponse[];
	audioContext: AudioContext | null;
	onProgress?: (loaded: number, total: number) => void;
}

export function useAudioBufferLoader({
	stems,
	audioContext,
	onProgress,
}: AudioLoaderOptions) {
	const [isLoading, setIsLoading] = useState(false);
	const [buffers, setBuffers] = useState<Map<string, StemAudioBuffer>>(new Map());
	const [duration, setDuration] = useState(0);

	useEffect(() => {
		if (!audioContext || stems.length === 0) {
			setBuffers(new Map());
			return;
		}

		let cancelled = false;
		setIsLoading(true);

		const loadBuffers = async () => {
			const newBuffers = new Map<string, StemAudioBuffer>();
			let maxDuration = 0;
			let loaded = 0;

			await Promise.all(
				stems.map(async (stem) => {
					try {
						// Fetch with auth for local media
						const isLocalMedia = stem.audio_url.startsWith("/media");
						const headers: HeadersInit = {};
						if (isLocalMedia) {
							const token = getToken();
							if (token) {
								headers.Authorization = `Bearer ${token}`;
							}
						}

						const response = await fetch(stem.audio_url, {
							headers,
							cache: "default",
						});

						if (!response.ok) {
							throw new Error(
								`Failed to fetch ${stem.stem_type}: ${response.status}`,
							);
						}

						const arrayBuffer = await response.arrayBuffer();
						const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

						if (!cancelled) {
							newBuffers.set(stem.stem_type, {
								buffer: audioBuffer,
								stemType: stem.stem_type,
								metadata: stem,
							});

							maxDuration = Math.max(maxDuration, audioBuffer.duration);
							loaded++;
							onProgress?.(loaded, stems.length);
						}
					} catch (error) {
						console.error(
							`[AudioLoader] Failed to load stem ${stem.stem_type}:`,
							error,
						);
					}
				}),
			);

			if (!cancelled) {
				setBuffers(newBuffers);
				setDuration(maxDuration);
				setIsLoading(false);
			}
		};

		loadBuffers();

		return () => {
			cancelled = true;
		};
	}, [audioContext, stems, onProgress]);

	return { buffers, duration, isLoading };
}

/**
 * Basic playback controller for managing play/pause/seek state
 */
export interface PlaybackControllerOptions {
	audioContext: AudioContext | null;
	duration: number;
	onTimeUpdate?: (time: number) => void;
}

export function usePlaybackController({
	audioContext,
	duration,
	onTimeUpdate,
}: PlaybackControllerOptions) {
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);

	const isPlayingRef = useRef(false);
	const currentTimeRef = useRef(0);
	const startTimeRef = useRef(0);
	const rafRef = useRef<number | null>(null);

	// Update loop
	useEffect(() => {
		if (!isPlaying || !audioContext) {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			return;
		}

		const tick = () => {
			if (!isPlayingRef.current) return;

			const elapsed = audioContext.currentTime - startTimeRef.current;

			if (elapsed >= duration) {
				// Playback finished
				currentTimeRef.current = 0;
				setCurrentTime(0);
				setIsPlaying(false);
				isPlayingRef.current = false;
				onTimeUpdate?.(0);
				return;
			}

			currentTimeRef.current = elapsed;
			setCurrentTime(elapsed);
			onTimeUpdate?.(elapsed);

			rafRef.current = requestAnimationFrame(tick);
		};

		rafRef.current = requestAnimationFrame(tick);

		return () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
		};
	}, [isPlaying, audioContext, duration, onTimeUpdate]);

	const play = useCallback(
		(fromTime?: number) => {
			if (!audioContext) return;

			if (fromTime !== undefined) {
				currentTimeRef.current = fromTime;
				setCurrentTime(fromTime);
			}

			startTimeRef.current = audioContext.currentTime - currentTimeRef.current;
			isPlayingRef.current = true;
			setIsPlaying(true);
		},
		[audioContext],
	);

	const pause = useCallback(() => {
		isPlayingRef.current = false;
		setIsPlaying(false);
	}, []);

	const seek = useCallback(
		(time: number) => {
			const clamped = Math.max(0, Math.min(time, duration));
			currentTimeRef.current = clamped;
			setCurrentTime(clamped);
			onTimeUpdate?.(clamped);

			if (isPlayingRef.current && audioContext) {
				startTimeRef.current = audioContext.currentTime - clamped;
			}
		},
		[duration, audioContext, onTimeUpdate],
	);

	const stop = useCallback(() => {
		isPlayingRef.current = false;
		setIsPlaying(false);
		currentTimeRef.current = 0;
		setCurrentTime(0);
		onTimeUpdate?.(0);
	}, [onTimeUpdate]);

	return {
		isPlaying,
		currentTime,
		play,
		pause,
		seek,
		stop,
	};
}

/**
 * Format time in MM:SS or HH:MM:SS format
 */
export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

	const hrs = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	if (hrs > 0) {
		return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}
