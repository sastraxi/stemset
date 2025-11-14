import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { StemResponse } from "../../../api/generated/types.gen";
import { useAudioBufferLoader, useAudioGraph, usePlaybackController } from "../audio/core";
import { MinimalRuler } from "../rulers/MinimalRuler";
import { CompositeWaveform } from "../waveforms/CompositeWaveform";

export interface ClipData {
	id: string;
	stems: StemResponse[];
	startTimeSec: number;
	endTimeSec: number;
}

export interface UseClipPlayerOptions {
	clip: ClipData;
}

export interface StemState {
	stemType: string;
	isMuted: boolean;
	gainNode: GainNode | null;
}

export interface ClipPlayerAPI {
	// Playback state
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;

	// Playback controls
	play: () => Promise<void>;
	pause: () => void;
	seek: (time: number) => void;

	// Stem controls
	stems: StemState[];
	toggleStemMute: (stemType: string) => void;

	// Components
	Waveform: React.FC<WaveformComponentProps>;
	Ruler: React.FC<RulerComponentProps>;
	Controls: React.FC<ControlsComponentProps>;
}

interface WaveformComponentProps {
	mode?: "composite";
	height?: number;
	className?: string;
	showBackground?: boolean;
}

interface RulerComponentProps {
	variant?: "minimal";
	height?: number;
	className?: string;
}

interface ControlsComponentProps {
	compact?: boolean;
	className?: string;
}

// Context for sharing player state with components
const ClipPlayerContext = createContext<ClipPlayerAPI | null>(null);

/**
 * Factory hook for clip player (inline playback)
 * Returns both state/actions and pre-wired components
 */
export function useClipPlayer({ clip }: UseClipPlayerOptions): ClipPlayerAPI {
	const { getContext } = useAudioGraph(44100, true); // Use shared context
	const audioContext = getContext();

	const clipDuration = clip.endTimeSec - clip.startTimeSec;

	const { buffers, duration: fullDuration, isLoading } = useAudioBufferLoader({
		stems: clip.stems,
		audioContext,
	});

	const [mutedStems, setMutedStems] = useState<Set<string>>(new Set());
	const stemNodesRef = useRef<Map<string, { gain: GainNode }>>(new Map());
	const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
	const playbackGenRef = useRef(0);

	// Create audio nodes when buffers load
	useMemo(() => {
		if (!audioContext || buffers.size === 0) {
			stemNodesRef.current.clear();
			return;
		}

		const newNodes = new Map<string, { gain: GainNode }>();
		for (const [stemType] of buffers) {
			const gainNode = audioContext.createGain();
			gainNode.connect(audioContext.destination);
			gainNode.gain.value = mutedStems.has(stemType) ? 0 : 1;

			newNodes.set(stemType, { gain: gainNode });
		}
		stemNodesRef.current = newNodes;
	}, [audioContext, buffers, mutedStems]);

	const stopAllSources = useCallback(() => {
		for (const src of sourcesRef.current.values()) {
			try {
				src.stop();
			} catch {
				// Already stopped
			}
		}
		sourcesRef.current.clear();
	}, []);

	const startSources = useCallback(
		(playbackPosition: number) => {
			if (!audioContext || stemNodesRef.current.size === 0) return;

			stopAllSources();
			const thisGen = ++playbackGenRef.current;

			for (const [stemType, stemBuffer] of buffers) {
				const node = stemNodesRef.current.get(stemType);
				if (!node) continue;

				const src = audioContext.createBufferSource();
				src.buffer = stemBuffer.buffer;
				src.connect(node.gain);

				src.onended = () => {
					if (playbackGenRef.current !== thisGen) return;
					sourcesRef.current.delete(stemType);
				};

				const audioPosition = playbackPosition + clip.startTimeSec;
				src.start(0, audioPosition);
				sourcesRef.current.set(stemType, src);
			}
		},
		[audioContext, buffers, clip.startTimeSec, stopAllSources],
	);

	const { isPlaying, currentTime, play: controllerPlay, pause: controllerPause, seek: controllerSeek } =
		usePlaybackController({
			audioContext,
			duration: clipDuration,
		});

	const play = useCallback(async () => {
		if (!audioContext) return;

		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}

		startSources(currentTime);
		controllerPlay();
	}, [audioContext, currentTime, startSources, controllerPlay]);

	const pause = useCallback(() => {
		stopAllSources();
		controllerPause();
	}, [stopAllSources, controllerPause]);

	const seek = useCallback(
		(time: number) => {
			controllerSeek(time);
			if (isPlaying) {
				stopAllSources();
				startSources(time);
			}
		},
		[controllerSeek, isPlaying, stopAllSources, startSources],
	);

	const toggleStemMute = useCallback((stemType: string) => {
		setMutedStems((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(stemType)) {
				newSet.delete(stemType);
			} else {
				newSet.add(stemType);
			}

			// Update gain immediately
			const node = stemNodesRef.current.get(stemType);
			if (node) {
				node.gain.gain.value = newSet.has(stemType) ? 0 : 1;
			}

			return newSet;
		});
	}, []);

	const stems: StemState[] = useMemo(
		() =>
			clip.stems.map((stem) => ({
				stemType: stem.stem_type,
				isMuted: mutedStems.has(stem.stem_type),
				gainNode: stemNodesRef.current.get(stem.stem_type)?.gain || null,
			})),
		[clip.stems, mutedStems],
	);

	// Memoize components
	const Waveform: React.FC<WaveformComponentProps> = useMemo(
		() =>
			({ mode = "composite", height, className, showBackground = true }) => {
				const player = useContext(ClipPlayerContext);
				if (!player) throw new Error("Waveform must be used within ClipPlayer context");

				const stemWaveforms = clip.stems.map((stem) => ({
					stemType: stem.stem_type,
					waveformUrl: stem.waveform_url,
				}));

				if (mode === "composite") {
					return (
						<CompositeWaveform
							stems={stemWaveforms}
							currentTime={player.currentTime}
							duration={clipDuration}
							startTimeSec={clip.startTimeSec}
							endTimeSec={clip.endTimeSec}
							fullDuration={fullDuration}
							height={height}
							className={className}
							showBackground={showBackground}
						/>
					);
				}

				return null;
			},
		[clip.stems, clip.startTimeSec, clip.endTimeSec, clipDuration, fullDuration],
	);

	const Ruler: React.FC<RulerComponentProps> = useMemo(
		() =>
			({ variant = "minimal", height, className }) => {
				const player = useContext(ClipPlayerContext);
				if (!player) throw new Error("Ruler must be used within ClipPlayer context");

				if (variant === "minimal") {
					return (
						<MinimalRuler
							currentTime={player.currentTime}
							duration={clipDuration}
							height={height}
							className={className}
						/>
					);
				}

				return null;
			},
		[clipDuration],
	);

	const Controls: React.FC<ControlsComponentProps> = useMemo(
		() =>
			({ compact, className }) => {
				const player = useContext(ClipPlayerContext);
				if (!player) throw new Error("Controls must be used within ClipPlayer context");

				return (
					<div className={`clip-controls ${compact ? "compact" : ""} ${className || ""}`}>
						<button
							type="button"
							onClick={player.isPlaying ? player.pause : player.play}
							disabled={player.isLoading}
						>
							{player.isPlaying ? "Pause" : "Play"}
						</button>
						{player.stems.map((stem) => (
							<button
								key={stem.stemType}
								type="button"
								onClick={() => player.toggleStemMute(stem.stemType)}
								className={stem.isMuted ? "muted" : ""}
							>
								{stem.stemType}
							</button>
						))}
					</div>
				);
			},
		[],
	);

	const api: ClipPlayerAPI = {
		isPlaying,
		isLoading,
		currentTime,
		duration: clipDuration,
		play,
		pause,
		seek,
		stems,
		toggleStemMute,
		Waveform,
		Ruler,
		Controls,
	};

	return api;
}

/**
 * Provider component to make player state available to child components
 */
export function ClipPlayerProvider({
	player,
	children,
}: {
	player: ClipPlayerAPI;
	children: React.ReactNode;
}) {
	return <ClipPlayerContext.Provider value={player}>{children}</ClipPlayerContext.Provider>;
}
