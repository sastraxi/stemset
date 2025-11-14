import { useCallback, useMemo } from "react";
import type { StemAudioNode } from "../types";
import { useAudioPlayback, type PlaybackNode } from "./useAudioPlayback";

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
 * Playback controller for recordings with full effects chain.
 * Wraps useAudioPlayback with StemAudioNode-specific logic.
 */
export function usePlaybackController({
	audioContext,
	duration,
	stemNodes,
	initialPosition = 0,
	startTimeSec = 0,
}: UsePlaybackControllerOptions): UsePlaybackControllerResult {
	// Convert StemAudioNode to generic PlaybackNode
	const nodes = useMemo(() => {
		const map = new Map<string, PlaybackNode>();
		stemNodes.forEach((node, name) => {
			map.set(name, {
				buffer: node.buffer,
				entryPoint: node.gainNode, // Connect to first node in effects chain
			});
		});
		return map;
	}, [stemNodes]);

	const playback = useAudioPlayback({
		audioContext,
		duration,
		nodes,
		initialPosition,
		startOffset: startTimeSec,
	});

	const formatTime = useCallback((seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}, []);

	return { ...playback, formatTime };
}
