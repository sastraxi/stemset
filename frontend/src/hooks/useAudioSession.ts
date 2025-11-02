import { useCallback, useState } from "react";

export function useAudioSession(audioContext: AudioContext | null) {
	const [isSessionInitialized, setIsSessionInitialized] = useState(false);

	const initializeAudioSession = useCallback(async () => {
		if (isSessionInitialized || !audioContext) {
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

			// iOS silent switch workaround
			const silentAudio = document.createElement("audio");
			silentAudio.setAttribute("x-webkit-airplay", "deny");
			silentAudio.src = "/silence.wav";
			silentAudio.loop = true;

			await silentAudio.play();

			setIsSessionInitialized(true);
			console.log("Audio session initialized.");
		} catch (error) {
			console.error("Failed to initialize audio session:", error);
		}
	}, [audioContext, isSessionInitialized]);

	return { initializeAudioSession, isSessionInitialized };
}
