import { useState, useRef, useCallback, useEffect } from "react";
import type { StemAudioNode } from "../types";

export interface UsePlaybackControllerOptions {
	audioContext: AudioContext | null;
	duration: number;
	stemNodes: Map<string, StemAudioNode>;
	initialPosition?: number; // Initial playback position in seconds
	startTimeSec?: number; // Clip start time (default: 0)
	endTimeSec?: number; // Clip end time (default: duration)
}

export interface UsePlaybackControllerResult {
	isPlaying: boolean;
	currentTime: number;
	play: () => void;
	pause: () => void;
	stop: () => void;
	seek: (seconds: number) => void;
	formatTime: (seconds: number) => string;
}

/**
 * Manages playback control and timing for multi-stem audio.
 *
 * Responsibilities:
 * - BufferSourceNode lifecycle (recreate on play/resume/seek)
 * - Play/pause/stop/seek operations
 * - RAF-based progress tracking tied to AudioContext.currentTime
 * - Playback generation counter to invalidate old loops
 * - Natural end detection when all sources complete
 *
 * Pattern: Keep current timing model (startTimeRef + pausedAtRef).
 * Refs for imperative operations, state only for UI updates.
 * Playback generation counter prevents race conditions.
 */
export function usePlaybackController({
	audioContext,
	duration,
	stemNodes,
	initialPosition = 0,
	startTimeSec = 0,
	endTimeSec,
}: UsePlaybackControllerOptions): UsePlaybackControllerResult {
	// Calculate effective bounds
	const effectiveStart = Math.max(0, startTimeSec);
	const effectiveEnd = Math.min(endTimeSec ?? duration, duration);

	// Clamp initial position to clip bounds
	const clampedInitialPosition = Math.max(
		effectiveStart,
		Math.min(initialPosition, effectiveEnd),
	);

	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(clampedInitialPosition);
	const lastInitialPositionRef = useRef(clampedInitialPosition);

	// Update currentTime when initialPosition changes (e.g., loaded from config)
	useEffect(() => {
		const newClampedPosition = Math.max(
			effectiveStart,
			Math.min(initialPosition, effectiveEnd),
		);
		if (newClampedPosition !== lastInitialPositionRef.current) {
			setCurrentTime(newClampedPosition);
			pausedAtRef.current = newClampedPosition;
			lastInitialPositionRef.current = newClampedPosition;
		}
	}, [initialPosition, effectiveStart, effectiveEnd]);

	// Audio source management
	const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());

	// Timing state
	const startTimeRef = useRef<number>(0); // AudioContext.currentTime - offset when play starts
	const pausedAtRef = useRef<number>(clampedInitialPosition); // Position in seconds when paused

	// RAF and playback management
	const rafRef = useRef<number | null>(null);
	const playbackGenRef = useRef<number>(0); // Incremented to invalidate old loops
	const endedRef = useRef<boolean>(false);
	const isPlayingRef = useRef<boolean>(false); // Authoritative state for closures
	const manualEndModeRef = useRef<"none" | "pause" | "stop">("none");

	const stopAllSources = useCallback(() => {
		sourcesRef.current.forEach((src) => {
			try {
				src.stop();
			} catch {
				// Ignore errors from already-stopped sources
			}
		});
		sourcesRef.current.clear();
	}, []);

	const startSources = useCallback(
		(offsetSeconds: number) => {
			if (!audioContext) return;

			stopAllSources();
			endedRef.current = false;

			// Increment generation to invalidate old RAF loops
			const thisPlaybackGen = playbackGenRef.current + 1;
			playbackGenRef.current = thisPlaybackGen;
			manualEndModeRef.current = "none";

			stemNodes.forEach((node, name) => {
				const src = audioContext.createBufferSource();
				src.buffer = node.buffer;

				try {
					src.connect(node.gainNode);
				} catch (error) {
					console.error(
						"[usePlaybackController] Failed to connect source for stem:",
						name,
						error,
					);
					console.error("[usePlaybackController] Source details:", {
						bufferLength: src.buffer?.length,
						bufferChannels: src.buffer?.numberOfChannels,
						gainNodeType: node.gainNode?.constructor.name,
						audioContextState: audioContext.state,
					});
					throw error; // Don't continue with broken playback
				}

				// Handle natural end of playback
				src.onended = () => {
					// Ignore if superseded by newer playback or manually stopped
					if (playbackGenRef.current !== thisPlaybackGen) return;
					if (manualEndModeRef.current !== "none") return;

					sourcesRef.current.delete(name);

					// If all sources have ended naturally, stop playback
					if (sourcesRef.current.size === 0 && !endedRef.current) {
						endedRef.current = true;
						setIsPlaying(false);
						isPlayingRef.current = false;
						pausedAtRef.current = effectiveStart; // Reset to clip start
						startTimeRef.current = audioContext.currentTime;
						setCurrentTime(effectiveStart);
					}
				};

				try {
					src.start(0, offsetSeconds);
				} catch (e) {
					console.error(
						"[usePlaybackController] Failed to start source",
						name,
						e,
					);
				}

				sourcesRef.current.set(name, src);
			});

			// Set timing reference
			startTimeRef.current = audioContext.currentTime - offsetSeconds;

			// Start RAF-based progress tracking
			if (rafRef.current) cancelAnimationFrame(rafRef.current);

			const tick = () => {
				// Bail if this playback generation is superseded
				if (playbackGenRef.current !== thisPlaybackGen) return;
				if (!isPlayingRef.current) return;

				const elapsed = audioContext.currentTime - startTimeRef.current;

				// Stop at clip end
				if (elapsed >= effectiveEnd) {
					setCurrentTime(effectiveEnd);
					setIsPlaying(false);
					isPlayingRef.current = false;
					pausedAtRef.current = effectiveStart; // Loop back to start
					return;
				}

				setCurrentTime(elapsed);

				rafRef.current = requestAnimationFrame(tick);
			};

			rafRef.current = requestAnimationFrame(tick);
		},
		[
			audioContext,
			duration,
			stemNodes,
			stopAllSources,
			effectiveEnd,
			effectiveStart,
		],
	);

	const play = useCallback(() => {
		if (isPlayingRef.current) return;
		if (!audioContext) return;
		if (stemNodes.size === 0) return;

		// Resume context if suspended
		if (audioContext.state === "suspended") {
			audioContext.resume();
		}

		setIsPlaying(true);
		isPlayingRef.current = true;
		startSources(pausedAtRef.current);
	}, [audioContext, stemNodes.size, startSources]);

	const pause = useCallback(() => {
		if (!isPlayingRef.current) return;
		if (!audioContext) return;

		pausedAtRef.current = audioContext.currentTime - startTimeRef.current;
		manualEndModeRef.current = "pause";
		isPlayingRef.current = false;
		stopAllSources();
		setIsPlaying(false);

		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}

		// Invalidate current playback generation
		playbackGenRef.current += 1;
	}, [audioContext, stopAllSources]);

	const stop = useCallback(() => {
		if (!audioContext) return;

		pausedAtRef.current = effectiveStart; // Reset to clip start
		manualEndModeRef.current = "stop";
		isPlayingRef.current = false;
		stopAllSources();
		setIsPlaying(false);
		setCurrentTime(effectiveStart);

		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}

		playbackGenRef.current += 1;
	}, [audioContext, stopAllSources, effectiveStart]);

	const seek = useCallback(
		(seconds: number) => {
			// Clamp to clip bounds
			const clamped = Math.max(effectiveStart, Math.min(seconds, effectiveEnd));
			pausedAtRef.current = clamped;
			setCurrentTime(clamped);

			if (isPlayingRef.current) {
				startSources(clamped);
			}
		},
		[effectiveStart, effectiveEnd, startSources],
	);

	const formatTime = useCallback((seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}, []);

	return {
		isPlaying,
		currentTime,
		play,
		pause,
		stop,
		seek,
		formatTime,
	};
}
