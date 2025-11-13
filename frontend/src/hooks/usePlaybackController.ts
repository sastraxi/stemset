import { useState, useRef, useCallback } from "react";
import type { StemAudioNode } from "../types";

export interface UsePlaybackControllerOptions {
	audioContext: AudioContext | null;
	duration: number;
	stemNodes: Map<string, StemAudioNode>;
	initialPosition?: number;
	startTimeSec?: number;
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
 * Unified playback controller for both recordings and clips.
 *
 * Key principle: Single timebase - everything is in "playback time" [0, duration].
 * - For recordings: duration = full file, offset = 0
 * - For clips: duration = endTime - startTime, offset = startTime (applied at audio source)
 * - NO time conversions anywhere - Web Audio API handles the offset
 */
export function usePlaybackController({
	audioContext,
	duration,
	stemNodes,
	initialPosition = 0,
	startTimeSec = 0,
}: UsePlaybackControllerOptions): UsePlaybackControllerResult {
	const audioOffset = startTimeSec; // Offset applied to audio sources

	// State - all in playback time [0, duration]
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(Math.max(0, Math.min(initialPosition, duration)));

	// Refs
	const isPlayingRef = useRef(false);
	const pausedAtRef = useRef(Math.max(0, Math.min(initialPosition, duration)));
	const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
	const startTimeRef = useRef<number>(0);
	const rafRef = useRef<number | null>(null);
	const playbackGenRef = useRef<number>(0);

	const stopAllSources = useCallback(() => {
		sourcesRef.current.forEach((src) => {
			try {
				src.stop();
			} catch {
				// Already stopped
			}
		});
		sourcesRef.current.clear();
	}, []);

	const startSources = useCallback(
		(playbackPosition: number) => {
			if (!audioContext) return;

			stopAllSources();

			// Increment generation to invalidate old RAF loops
			const thisPlaybackGen = ++playbackGenRef.current;

			// Create and start audio sources
			let allSourcesEnded = false;
			stemNodes.forEach((node, name) => {
				const src = audioContext.createBufferSource();
				src.buffer = node.buffer;
				src.connect(node.gainNode);

				// Handle natural end
				src.onended = () => {
					if (playbackGenRef.current !== thisPlaybackGen) return;
					sourcesRef.current.delete(name);
					if (sourcesRef.current.size === 0 && !allSourcesEnded) {
						allSourcesEnded = true;
						setIsPlaying(false);
						isPlayingRef.current = false;
						pausedAtRef.current = 0;
						setCurrentTime(0);
					}
				};

				// Start at offset position in buffer
				const audioPosition = playbackPosition + audioOffset;
				src.start(0, audioPosition);
				sourcesRef.current.set(name, src);
			});

			// Track when playback started
			startTimeRef.current = audioContext.currentTime - playbackPosition;

			// RAF loop to update currentTime
			if (rafRef.current) cancelAnimationFrame(rafRef.current);

			const tick = () => {
				if (playbackGenRef.current !== thisPlaybackGen) return;
				if (!isPlayingRef.current) return;

				const elapsed = audioContext.currentTime - startTimeRef.current;

				// Stop at end
				if (elapsed >= duration) {
					setIsPlaying(false);
					isPlayingRef.current = false;
					pausedAtRef.current = 0;
					stopAllSources();
					setCurrentTime(0);
					return;
				}

				setCurrentTime(elapsed);
				rafRef.current = requestAnimationFrame(tick);
			};

			rafRef.current = requestAnimationFrame(tick);
		},
		[audioContext, stemNodes, duration, audioOffset, stopAllSources],
	);

	const play = useCallback(() => {
		if (isPlayingRef.current || !audioContext || stemNodes.size === 0) return;

		if (audioContext.state === "suspended") {
			audioContext.resume();
		}

		setIsPlaying(true);
		isPlayingRef.current = true;
		startSources(pausedAtRef.current);
	}, [audioContext, stemNodes.size, startSources]);

	const pause = useCallback(() => {
		if (!isPlayingRef.current || !audioContext) return;

		const currentPosition = audioContext.currentTime - startTimeRef.current;
		pausedAtRef.current = currentPosition;
		setCurrentTime(currentPosition);

		isPlayingRef.current = false;
		setIsPlaying(false);
		stopAllSources();

		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
	}, [audioContext, stopAllSources]);

	const stop = useCallback(() => {
		if (!audioContext) return;

		pausedAtRef.current = 0;
		setCurrentTime(0);

		isPlayingRef.current = false;
		setIsPlaying(false);
		stopAllSources();

		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
	}, [audioContext, stopAllSources]);

	const seek = useCallback(
		(playbackPosition: number) => {
			const clamped = Math.max(0, Math.min(playbackPosition, duration));
			pausedAtRef.current = clamped;
			setCurrentTime(clamped);

			if (isPlayingRef.current && audioContext) {
				stopAllSources();
				if (rafRef.current) {
					cancelAnimationFrame(rafRef.current);
					rafRef.current = null;
				}
				startSources(clamped);
			}
		},
		[duration, audioContext, stopAllSources, startSources],
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
