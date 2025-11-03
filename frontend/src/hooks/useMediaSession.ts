import { useEffect, useRef } from "react";

interface MediaSessionProps {
	title: string;
	artist: string;
	album: string;
	duration: number;
	currentTime: number;
	onPlay: () => void;
	onPause: () => void;
	onSeek: (time: number) => void;
	onNextTrack: () => void;
	onPreviousTrack: () => void;
}

export function useMediaSession({
	title,
	artist,
	album,
	duration,
	currentTime,
	onPlay,
	onPause,
	onSeek,
	onNextTrack,
	onPreviousTrack,
}: MediaSessionProps) {
	// Store callbacks in refs so they don't cause effect re-runs
	const onPlayRef = useRef(onPlay);
	const onPauseRef = useRef(onPause);
	const onSeekRef = useRef(onSeek);
	const onNextTrackRef = useRef(onNextTrack);
	const onPreviousTrackRef = useRef(onPreviousTrack);

	// Throttle position state updates to avoid excessive calls
	const lastPositionUpdateRef = useRef(0);

	// Keep refs updated
	useEffect(() => {
		onPlayRef.current = onPlay;
		onPauseRef.current = onPause;
		onSeekRef.current = onSeek;
		onNextTrackRef.current = onNextTrack;
		onPreviousTrackRef.current = onPreviousTrack;
	}, [onPlay, onPause, onSeek, onNextTrack, onPreviousTrack]);

	// Register handlers only when metadata changes
	useEffect(() => {
		if (!("mediaSession" in navigator)) {
			return;
		}

		navigator.mediaSession.metadata = new MediaMetadata({
			title,
			artist,
			album,
		});

		navigator.mediaSession.setActionHandler("play", () => onPlayRef.current());
		navigator.mediaSession.setActionHandler("pause", () => onPauseRef.current());
		navigator.mediaSession.setActionHandler("seekto", (details) => {
			if (details.seekTime !== undefined) {
				onSeekRef.current(details.seekTime);
			}
		});
		navigator.mediaSession.setActionHandler("nexttrack", () => onNextTrackRef.current());
		navigator.mediaSession.setActionHandler("previoustrack", () => onPreviousTrackRef.current());

		return () => {
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.setActionHandler("play", null);
			navigator.mediaSession.setActionHandler("pause", null);
			navigator.mediaSession.setActionHandler("seekto", null);
			navigator.mediaSession.setActionHandler("nexttrack", null);
			navigator.mediaSession.setActionHandler("previoustrack", null);
		};
	}, [title, artist, album]);

	// Update position state with throttling (1 second intervals)
	useEffect(() => {
		if (!("mediaSession" in navigator)) return;
		if (duration <= 0) return;

		const now = Date.now();
		if (now - lastPositionUpdateRef.current < 1000) return;
		lastPositionUpdateRef.current = now;

		try {
			navigator.mediaSession.setPositionState({
				duration,
				playbackRate: 1.0,
				position: Math.min(currentTime, duration),
			});
		} catch (error) {
			console.warn("Failed to update position state:", error);
		}
	}, [currentTime, duration]);
}
