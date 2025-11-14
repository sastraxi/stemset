import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";
import { getToken } from "../lib/storage";
import type { StemResponse } from "@/api/generated";

interface ClipData {
	id: string;
	stems: StemResponse[];
	startTimeSec: number;
	endTimeSec: number;
}

interface StemAudioNode {
	source: AudioBufferSourceNode | null;
	gain: GainNode;
	buffer: AudioBuffer | null;
}

interface SongPlayerContextValue {
	currentClipId: string | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	play: (clip: ClipData) => Promise<void>;
	pause: () => void;
	seek: (time: number) => void;
	toggleStemMute: (stemType: string) => void;
	isStemMuted: (stemType: string) => boolean;
}

const SongPlayerContext = createContext<SongPlayerContextValue | null>(null);

export function useSongPlayer() {
	const context = useContext(SongPlayerContext);
	if (!context) {
		throw new Error("useSongPlayer must be used within SongPlayerProvider");
	}
	return context;
}

export function SongPlayerProvider({ children }: { children: React.ReactNode }) {
	const [currentClipId, setCurrentClipId] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [mutedStems, setMutedStems] = useState<Set<string>>(new Set());

	// Refs for stable state
	const audioContextRef = useRef<AudioContext | null>(null);
	const stemNodesRef = useRef<Map<string, StemAudioNode>>(new Map());
	const loadedClipsRef = useRef<Map<string, Map<string, AudioBuffer>>>(new Map());
	const currentClipDataRef = useRef<ClipData | null>(null);
	const startTimeRef = useRef<number>(0);
	const pausedAtRef = useRef<number>(0);
	const animationFrameRef = useRef<number | null>(null);

	// Initialize audio context
	const getAudioContext = useCallback(() => {
		if (!audioContextRef.current) {
			audioContextRef.current = new AudioContext();
		}
		return audioContextRef.current;
	}, []);

	// Stop playback and cleanup sources
	const stopPlayback = useCallback(() => {
		stemNodesRef.current.forEach((node) => {
			if (node.source) {
				try {
					node.source.stop();
					node.source.disconnect();
				} catch (e) {
					// Already stopped
				}
				node.source = null;
			}
		});

		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
	}, []);

	// Load audio buffers for a clip
	const loadClipStems = useCallback(async (clip: ClipData): Promise<Map<string, AudioBuffer>> => {
		// Check cache first
		const cached = loadedClipsRef.current.get(clip.id);
		if (cached) {
			return cached;
		}

		const context = getAudioContext();
		const buffers = new Map<string, AudioBuffer>();

		await Promise.all(
			clip.stems.map(async (stem) => {
				const { audio_url, stem_type } = stem;

				// Fetch with auth
				const isLocalMedia = audio_url.startsWith("/media");
				const headers: HeadersInit = {};
				if (isLocalMedia) {
					const token = getToken();
					if (token) {
						headers.Authorization = `Bearer ${token}`;
					}
				}

				const response = await fetch(audio_url, { headers, cache: "default" });
				if (!response.ok) {
					throw new Error(`Failed to fetch ${stem_type}: ${response.status}`);
				}

				const arrayBuffer = await response.arrayBuffer();
				const audioBuffer = await context.decodeAudioData(arrayBuffer);
				buffers.set(stem_type, audioBuffer);
			}),
		);

		// Cache the buffers
		loadedClipsRef.current.set(clip.id, buffers);
		return buffers;
	}, [getAudioContext]);

	// Start playback from a position
	const startPlayback = useCallback((fromPosition: number) => {
		const clip = currentClipDataRef.current;
		const context = audioContextRef.current;
		if (!clip || !context) return;

		stopPlayback();

		const clipDuration = clip.endTimeSec - clip.startTimeSec;
		const remainingDuration = clipDuration - fromPosition;

		if (remainingDuration <= 0) {
			setIsPlaying(false);
			pausedAtRef.current = clipDuration;
			setCurrentTime(clipDuration);
			return;
		}

		// Create source nodes for each stem
		stemNodesRef.current.forEach((node) => {
			if (!node.buffer) return;

			const source = context.createBufferSource();
			source.buffer = node.buffer;
			source.connect(node.gain);

			// Start from clip.startTimeSec + current position
			const offset = clip.startTimeSec + fromPosition;
			source.start(0, offset, remainingDuration);

			// Auto-stop at clip end and reset to beginning
			source.onended = () => {
				if (source === node.source) {
					setIsPlaying(false);
					pausedAtRef.current = 0;
					setCurrentTime(0);
				}
			};

			node.source = source;
		});

		startTimeRef.current = context.currentTime;
		pausedAtRef.current = fromPosition;

		// Update current time via animation frame
		const updateTime = () => {
			if (!context) return;

			const elapsed = context.currentTime - startTimeRef.current;
			const currentPos = pausedAtRef.current + elapsed;

			if (currentPos >= clipDuration) {
				// Reset to beginning at end of clip
				setCurrentTime(0);
				pausedAtRef.current = 0;
				setIsPlaying(false);
			} else {
				setCurrentTime(currentPos);
				animationFrameRef.current = requestAnimationFrame(updateTime);
			}
		};

		animationFrameRef.current = requestAnimationFrame(updateTime);
	}, [stopPlayback]);

	// Play a clip
	const play = useCallback(async (clip: ClipData) => {
		try {
			setIsLoading(true);

			// If different clip, load it
			if (currentClipId !== clip.id) {
				stopPlayback();
				setCurrentClipId(clip.id);
				currentClipDataRef.current = clip;
				pausedAtRef.current = 0;
				setCurrentTime(0);

				// Load stems
				const buffers = await loadClipStems(clip);

				// Create audio nodes
				const context = getAudioContext();
				const newNodes = new Map<string, StemAudioNode>();

				clip.stems.forEach((stem) => {
					const buffer = buffers.get(stem.stem_type);
					if (!buffer) return;

					const gainNode = context.createGain();
					gainNode.connect(context.destination);
					gainNode.gain.value = mutedStems.has(stem.stem_type) ? 0 : 1;

					newNodes.set(stem.stem_type, {
						source: null,
						gain: gainNode,
						buffer,
					});
				});

				stemNodesRef.current = newNodes;
			}

			setIsLoading(false);
			setIsPlaying(true);
			startPlayback(pausedAtRef.current);
		} catch (error) {
			console.error("[SongPlayer] Failed to play clip", error);
			setIsLoading(false);
			setIsPlaying(false);
		}
	}, [currentClipId, loadClipStems, getAudioContext, mutedStems, startPlayback, stopPlayback]);

	// Pause playback
	const pause = useCallback(() => {
		// Save current playback position before stopping
		const context = audioContextRef.current;
		if (context && currentClipDataRef.current) {
			const elapsed = context.currentTime - startTimeRef.current;
			const currentPos = pausedAtRef.current + elapsed;
			const clipDuration =
				currentClipDataRef.current.endTimeSec - currentClipDataRef.current.startTimeSec;

			// Clamp to clip duration
			pausedAtRef.current = Math.min(currentPos, clipDuration);
			setCurrentTime(pausedAtRef.current);
		}

		stopPlayback();
		setIsPlaying(false);
	}, [stopPlayback]);

	// Seek to a position
	const seek = useCallback((time: number) => {
		pausedAtRef.current = time;
		setCurrentTime(time);

		if (isPlaying) {
			startPlayback(time);
		}
	}, [isPlaying, startPlayback]);

	// Toggle stem mute
	const toggleStemMute = useCallback((stemType: string) => {
		setMutedStems((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(stemType)) {
				newSet.delete(stemType);
			} else {
				newSet.add(stemType);
			}

			// Update gain immediately if this stem is loaded
			const node = stemNodesRef.current.get(stemType);
			if (node) {
				node.gain.gain.value = newSet.has(stemType) ? 0 : 1;
			}

			return newSet;
		});
	}, []);

	const isStemMuted = useCallback((stemType: string) => {
		return mutedStems.has(stemType);
	}, [mutedStems]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			stopPlayback();
			stemNodesRef.current.forEach((node) => {
				node.gain.disconnect();
			});
			if (audioContextRef.current) {
				audioContextRef.current.close();
			}
		};
	}, [stopPlayback]);

	const value: SongPlayerContextValue = {
		currentClipId,
		isPlaying,
		isLoading,
		currentTime,
		play,
		pause,
		seek,
		toggleStemMute,
		isStemMuted,
	};

	return <SongPlayerContext.Provider value={value}>{children}</SongPlayerContext.Provider>;
}
