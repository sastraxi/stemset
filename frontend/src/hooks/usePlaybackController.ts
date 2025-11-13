import { useCallback, useEffect, useRef, useState } from "react";
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
	stop: (seekTime?: number) => void;
	seek: (seconds: number) => void;
	formatTime: (seconds: number) => string;
}

/**
 * This hook is refactored to use a double-loop pattern to avoid re-render cycles:
 * 1. A `requestAnimationFrame` loop runs at the display refresh rate for accurate timekeeping,
 *    updating the current time in a `useRef` to avoid state changes.
 * 2. A `setInterval` loop runs at a slower frequency to update React state from the ref,
 *    ensuring smooth UI updates without triggering re-renders on every frame.
 */
export function usePlaybackController({
	audioContext,
	duration,
	stemNodes,
	initialPosition = 0,
	startTimeSec = 0,
}: UsePlaybackControllerOptions): UsePlaybackControllerResult {
	const audioOffset = startTimeSec;

	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(
		Math.max(0, Math.min(initialPosition, duration)),
	);

	const isPlayingRef = useRef(false);
	const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
	const startTimeRef = useRef<number>(0);
	const currentTimeRef = useRef(
		Math.max(0, Math.min(initialPosition, duration)),
	);
	const rafRef = useRef<number | null>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);
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
			const thisPlaybackGen = ++playbackGenRef.current;

			stemNodes.forEach((node, name) => {
				const src = audioContext.createBufferSource();
				src.buffer = node.buffer;
				src.connect(node.gainNode);
				src.onended = () => {
					if (playbackGenRef.current !== thisPlaybackGen) return;
					sourcesRef.current.delete(name);
					if (sourcesRef.current.size === 0) {
						setIsPlaying(false);
						isPlayingRef.current = false;
						currentTimeRef.current = 0;
						setCurrentTime(0);
					}
				};
				const audioPosition = playbackPosition + audioOffset;
				src.start(0, audioPosition);
				sourcesRef.current.set(name, src);
			});

			startTimeRef.current = audioContext.currentTime - playbackPosition;

			if (rafRef.current) cancelAnimationFrame(rafRef.current);

			const tick = () => {
				if (playbackGenRef.current !== thisPlaybackGen || !isPlayingRef.current)
					return;

				const elapsed = audioContext.currentTime - startTimeRef.current;
				if (elapsed >= duration) {
					setIsPlaying(false);
					isPlayingRef.current = false;
					currentTimeRef.current = 0;
					setCurrentTime(0);
					stopAllSources();
					return;
				}
				currentTimeRef.current = elapsed;
				rafRef.current = requestAnimationFrame(tick);
			};
			rafRef.current = requestAnimationFrame(tick);
		},
		[audioContext, stemNodes, duration, audioOffset, stopAllSources],
	);

	const play = useCallback(() => {
		if (isPlayingRef.current || !audioContext || stemNodes.size === 0) return;
		if (audioContext.state === "suspended") audioContext.resume();

		setIsPlaying(true);
		isPlayingRef.current = true;
		startSources(currentTimeRef.current);
	}, [audioContext, stemNodes.size, startSources]);

	const pause = useCallback(() => {
		if (!isPlayingRef.current || !audioContext) return;

		const currentPosition = audioContext.currentTime - startTimeRef.current;
		currentTimeRef.current = currentPosition;
		setCurrentTime(currentPosition);

		isPlayingRef.current = false;
		setIsPlaying(false);
		stopAllSources();

		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		if (intervalRef.current) clearInterval(intervalRef.current);
	}, [audioContext, stopAllSources]);

	const stop = useCallback(
		(seekTime = 0) => {
			if (!audioContext) return;

			const newPosition = Math.max(0, Math.min(seekTime, duration));
			currentTimeRef.current = newPosition;
			setCurrentTime(newPosition);

			isPlayingRef.current = false;
			setIsPlaying(false);
			stopAllSources();

			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			if (intervalRef.current) clearInterval(intervalRef.current);
		},
		[audioContext, stopAllSources, duration],
	);

	const seek = useCallback(
		(playbackPosition: number) => {
			const clamped = Math.max(0, Math.min(playbackPosition, duration));
			currentTimeRef.current = clamped;
			setCurrentTime(clamped);

			if (isPlayingRef.current && audioContext) {
				stopAllSources();
				if (rafRef.current) cancelAnimationFrame(rafRef.current);
				startSources(clamped);
			}
		},
		[duration, audioContext, stopAllSources, startSources],
	);

	// State update loop (setInterval)
	useEffect(() => {
		if (!isPlaying) {
			if (intervalRef.current) clearInterval(intervalRef.current);
			return;
		}
		intervalRef.current = setInterval(() => {
			if (currentTime !== currentTimeRef.current) {
				setCurrentTime(currentTimeRef.current);
			}
		}, 50); // ~20fps state updates

		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [isPlaying, currentTime]);

	const formatTime = useCallback((seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}, []);

	return { isPlaying, currentTime, play, pause, stop, seek, formatTime };
}
