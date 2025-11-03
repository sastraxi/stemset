import { useCallback, useRef, useState } from "react";

export function useAudioSession(audioContext: AudioContext | null) {
	const [isSessionInitialized, setIsSessionInitialized] = useState(false);
	const isSessionInitializedRef = useRef(false);
	const silentAudioRef = useRef<HTMLAudioElement | null>(null);

	const initializeAudioSession = useCallback(async () => {
		if (isSessionInitializedRef.current || !audioContext) {
			return;
		}

		try {
			// Resume AudioContext
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}

			// iOS 17+ workaround
			if (
				"audioSession" in navigator &&
				navigator.audioSession &&
				typeof navigator.audioSession === "object" &&
				"type" in navigator.audioSession
			) {
				try {
					navigator.audioSession.type = "playback";
				} catch (error) {
					console.error("Failed to set audio session type:", error);
				}
			}

			// iOS silent switch workaround - only needed on iOS
			// On desktop, having an audio element interferes with Media Session API
			const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
			if (isIOS) {
				const silentAudio = document.createElement("audio");
				silentAudio.setAttribute("x-webkit-airplay", "deny");
				silentAudio.setAttribute("preload", "auto");
				silentAudio.volume = 0.01; // Very quiet but not muted
				silentAudio.src = "/silence.wav";
				silentAudio.loop = true;

				await silentAudio.play();
				silentAudioRef.current = silentAudio;
			}

			isSessionInitializedRef.current = true;
			setIsSessionInitialized(true);
			console.log("Audio session initialized.");
		} catch (error) {
			console.error("Failed to initialize audio session:", error);
		}
	}, [audioContext]);

	const syncSilentAudio = useCallback((isPlaying: boolean) => {
		if (!silentAudioRef.current) return;

		if (isPlaying) {
			if (silentAudioRef.current.paused) {
				silentAudioRef.current.play().catch((e) => {
					console.warn("Failed to play silent audio:", e);
				});
			}
		} else {
			if (!silentAudioRef.current.paused) {
				silentAudioRef.current.pause();
			}
		}
	}, []);

	return { initializeAudioSession, isSessionInitialized, syncSilentAudio };
}
