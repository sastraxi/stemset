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
	gain: GainNode;
	buffer: AudioBuffer;
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

	// Playback state refs
	const isPlayingRef = useRef(false);
	const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
	const startTimeRef = useRef<number>(0);
	const currentTimeRef = useRef<number>(0);
	const rafRef = useRef<number | null>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);
	const playbackGenRef = useRef<number>(0); // KEY: Playback generation tracking

	// Initialize audio context
	const getAudioContext = useCallback(() => {
		if (!audioContextRef.current) {
			audioContextRef.current = new AudioContext();
		}
		return audioContextRef.current;
	}, []);

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

	const startSources = useCallback((playbackPosition: number) => {
		const clip = currentClipDataRef.current;
		const context = audioContextRef.current;
		if (!clip || !context || stemNodesRef.current.size === 0) return;

		stopAllSources();
		const thisPlaybackGen = ++playbackGenRef.current;

		const clipDuration = clip.endTimeSec - clip.startTimeSec;

		stemNodesRef.current.forEach((node, name) => {
			const src = context.createBufferSource();
			src.buffer = node.buffer;
			src.connect(node.gain);

			src.onended = () => {
				if (playbackGenRef.current !== thisPlaybackGen) return; // Guard against stale handlers
				sourcesRef.current.delete(name);
				if (sourcesRef.current.size === 0) {
					setIsPlaying(false);
					isPlayingRef.current = false;
					currentTimeRef.current = 0;
					setCurrentTime(0);
				}
			};

			const audioPosition = playbackPosition + clip.startTimeSec;
			src.start(0, audioPosition);
			sourcesRef.current.set(name, src);
		});

		startTimeRef.current = context.currentTime - playbackPosition;

		if (rafRef.current) cancelAnimationFrame(rafRef.current);

		const tick = () => {
			if (playbackGenRef.current !== thisPlaybackGen || !isPlayingRef.current) return;

			const elapsed = context.currentTime - startTimeRef.current;
			if (elapsed >= clipDuration) {
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
	}, [stopAllSources]);

	// Play a clip
	const play = useCallback(async (clip: ClipData) => {
		try {
			setIsLoading(true);

			// If different clip, load it
			if (currentClipId !== clip.id) {
				stopAllSources();
				setCurrentClipId(clip.id);
				currentClipDataRef.current = clip;
				currentTimeRef.current = 0;
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
						gain: gainNode,
						buffer,
					});
				});

				stemNodesRef.current = newNodes;
			}

			if (audioContextRef.current?.state === "suspended") {
				await audioContextRef.current.resume();
			}

			setIsLoading(false);
			setIsPlaying(true);
			isPlayingRef.current = true;
			startSources(currentTimeRef.current);
		} catch (error) {
			console.error("[SongPlayer] Failed to play clip", error);
			setIsLoading(false);
			setIsPlaying(false);
		}
	}, [currentClipId, loadClipStems, getAudioContext, mutedStems, stopAllSources, startSources]);

	const pause = useCallback(() => {
		if (!isPlayingRef.current || !audioContextRef.current) return;

		const currentPosition = audioContextRef.current.currentTime - startTimeRef.current;
		currentTimeRef.current = currentPosition;
		setCurrentTime(currentPosition);

		isPlayingRef.current = false;
		setIsPlaying(false);
		stopAllSources();

		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		if (intervalRef.current) clearInterval(intervalRef.current);
	}, [stopAllSources]);

	const seek = useCallback((playbackPosition: number) => {
		const clip = currentClipDataRef.current;
		if (!clip) return;

		const clipDuration = clip.endTimeSec - clip.startTimeSec;
		const clamped = Math.max(0, Math.min(playbackPosition, clipDuration));
		currentTimeRef.current = clamped;
		setCurrentTime(clamped);

		if (isPlayingRef.current && audioContextRef.current) {
			stopAllSources();
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			startSources(clamped);
		}
	}, [stopAllSources, startSources]);

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

	// State update loop (setInterval) for smooth UI updates
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

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			stopAllSources();
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			if (intervalRef.current) clearInterval(intervalRef.current);
			stemNodesRef.current.forEach((node) => {
				node.gain.disconnect();
			});
			if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
				audioContextRef.current.close();
			}
		};
	}, [stopAllSources]);

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
