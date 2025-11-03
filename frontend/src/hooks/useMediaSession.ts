import { useEffect, useRef } from "react";

interface MediaSessionProps {
	title: string;
	artist: string;
	album: string;
	onPlay: () => void;
	onPause: () => void;
	onNextTrack: () => void;
	onPreviousTrack: () => void;
}

export function useMediaSession({
	title,
	artist,
	album,
	onPlay,
	onPause,
	onNextTrack,
	onPreviousTrack,
}: MediaSessionProps) {
	// Store callbacks in refs so they don't cause effect re-runs
	const onPlayRef = useRef(onPlay);
	const onPauseRef = useRef(onPause);
	const onNextTrackRef = useRef(onNextTrack);
	const onPreviousTrackRef = useRef(onPreviousTrack);

	// Keep refs updated
	useEffect(() => {
		onPlayRef.current = onPlay;
		onPauseRef.current = onPause;
		onNextTrackRef.current = onNextTrack;
		onPreviousTrackRef.current = onPreviousTrack;
	}, [onPlay, onPause, onNextTrack, onPreviousTrack]);

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
		navigator.mediaSession.setActionHandler("nexttrack", () => onNextTrackRef.current());
		navigator.mediaSession.setActionHandler("previoustrack", () => onPreviousTrackRef.current());

		return () => {
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.setActionHandler("play", null);
			navigator.mediaSession.setActionHandler("pause", null);
			navigator.mediaSession.setActionHandler("nexttrack", null);
			navigator.mediaSession.setActionHandler("previoustrack", null);
		};
	}, [title, artist, album]);
}
