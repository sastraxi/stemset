import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioRecorderState {
  isRecording: boolean;
  recordingTime: number; // seconds
  audioBlob: Blob | null;
  mediaStream: MediaStream | null;
  error: string | null;
}

export interface AudioRecorderControls {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
}

/**
 * Hook for recording audio using the MediaRecorder API.
 *
 * Features:
 * - High-quality stereo recording (48kHz, no processing)
 * - WebM/Opus format (best browser compatibility)
 * - Timer tracking recording duration
 * - Error handling for permissions and browser support
 *
 * Usage:
 * ```tsx
 * const { state, controls } = useAudioRecorder();
 *
 * <button onClick={controls.startRecording}>Start</button>
 * <button onClick={controls.stopRecording}>Stop</button>
 * <button onClick={controls.resetRecording}>Reset</button>
 *
 * {state.isRecording && <div>Recording: {state.recordingTime}s</div>}
 * {state.audioBlob && <div>Ready to upload!</div>}
 * ```
 */
export function useAudioRecorder(): {
  state: AudioRecorderState;
  controls: AudioRecorderControls;
} {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Start recording audio from the user's microphone.
   * Requests permission on first use.
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // Check if MediaRecorder is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Audio recording is not supported in this browser");
      }

      // Request microphone access with high-quality constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2, // Stereo
          sampleRate: 48000, // 48kHz (may be adjusted by browser to device default)
          echoCancellation: false, // Disable for music/high fidelity
          noiseSuppression: false, // Disable for music/high fidelity
          autoGainControl: false, // Disable for consistent levels
        },
      });

      setMediaStream(stream);

      // Determine best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      if (!mimeType) {
        throw new Error("No supported audio format found for recording");
      }

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000, // 128 kbps (high quality)
      });

      chunksRef.current = [];

      // Collect audio data chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setIsRecording(false);

        // Stop timer
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }

        // Stop all tracks in the stream
        stream.getTracks().forEach((track) => track.stop());
        setMediaStream(null);
      };

      // Handle errors
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("Recording error occurred");
        setIsRecording(false);
      };

      // Start recording
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);
      startTimeRef.current = Date.now();

      // Start timer (update every 100ms for smooth UI)
      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);

    } catch (err) {
      console.error("Failed to start recording:", err);

      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setError("Microphone permission denied. Please allow access to record audio.");
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setError("No microphone found. Please connect a microphone and try again.");
        } else {
          setError(err.message || "Failed to start recording");
        }
      } else {
        setError("Failed to start recording");
      }

      setIsRecording(false);
    }
  }, []);

  /**
   * Stop recording and finalize the audio blob.
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      // Note: The actual cleanup happens in the onstop handler
    }
  }, [isRecording]);

  /**
   * Reset the recording state (discard current recording).
   */
  const resetRecording = useCallback(() => {
    // Stop recording if in progress
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }

    // Clear timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // Stop media stream tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }

    // Reset state
    setIsRecording(false);
    setRecordingTime(0);
    setAudioBlob(null);
    setMediaStream(null);
    setError(null);
    chunksRef.current = [];
    mediaRecorderRef.current = null;
  }, [isRecording, mediaStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isRecording, mediaStream]);

  return {
    state: {
      isRecording,
      recordingTime,
      audioBlob,
      mediaStream,
      error,
    },
    controls: {
      startRecording,
      stopRecording,
      resetRecording,
    },
  };
}
