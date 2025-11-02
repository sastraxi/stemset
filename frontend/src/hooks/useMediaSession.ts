import { useEffect } from "react";

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
	useEffect(() => {
		if (!("mediaSession" in navigator)) {
			return;
		}

		navigator.mediaSession.metadata = new MediaMetadata({
			title,
			artist,
			album,
		});

		navigator.mediaSession.setActionHandler("play", onPlay);
		navigator.mediaSession.setActionHandler("pause", onPause);
		navigator.mediaSession.setActionHandler("nexttrack", onNextTrack);
		navigator.mediaSession.setActionHandler("previoustrack", onPreviousTrack);

		return () => {
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.setActionHandler("play", null);
			navigator.mediaSession.setActionHandler("pause", null);
			navigator.mediaSession.setActionHandler("nexttrack", null);
			navigator.mediaSession.setActionHandler("previoustrack", null);
		};
	}, [title, artist, album, onPlay, onPause, onNextTrack, onPreviousTrack]);
}
