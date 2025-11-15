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

      // Silent audio workaround - REQUIRED ON ALL PLATFORMS
      // Desktop: Required for MediaSession controls to appear in system notifications
      // iOS: Required to bypass mute switch AND for MediaSession to work
      const silentAudio = document.createElement("audio");
      silentAudio.setAttribute("preload", "auto");
      silentAudio.volume = 0.01; // Very quiet but not muted
      silentAudio.loop = true; // Loop continuously - never pause

      // iOS-specific attribute
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (isIOS) {
        silentAudio.setAttribute("x-webkit-airplay", "deny");
      }

      silentAudio.src = "/silence.wav";
      await silentAudio.play();
      silentAudioRef.current = silentAudio;

      isSessionInitializedRef.current = true;
      setIsSessionInitialized(true);
      console.log("Audio session initialized.");
    } catch (error) {
      console.error("Failed to initialize audio session:", error);
    }
  }, [audioContext]);

  return { initializeAudioSession, isSessionInitialized };
}
