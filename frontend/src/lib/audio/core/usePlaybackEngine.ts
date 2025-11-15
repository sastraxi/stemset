import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaybackNode } from "../types";

export interface UsePlaybackEngineOptions {
  audioContext: AudioContext | null;
  duration: number;
  nodes: Map<string, PlaybackNode>;
  initialPosition?: number;
  startOffset?: number; // For clips: offset into the audio buffer
  onPlaybackEnd?: () => void;
}

export interface UsePlaybackEngineResult {
  isPlaying: boolean;
  currentTime: number;
  play: () => void;
  pause: () => void;
  stop: (seekTime?: number) => void;
  seek: (seconds: number) => void;
  formatTime: (seconds: number) => string;
}

/**
 * Unified playback engine for both StemPlayer and ClipPlayer.
 *
 * Features:
 * - Double-loop pattern for efficient time tracking:
 *   1. requestAnimationFrame loop runs at display refresh rate for accurate timekeeping
 *   2. setInterval loop runs at ~20fps to update React state without excessive re-renders
 * - Playback generation tracking to prevent race conditions with stale callbacks
 * - Automatic reset to beginning when playback ends
 * - Support for offset playback (for clips)
 * - Works with any audio node chain (simple or complex)
 *
 * Usage:
 * - StemPlayer: nodes include full effects chain (gain → EQ → compression → master)
 * - ClipPlayer: nodes include basic chain (gain → master)
 */
export function usePlaybackEngine({
  audioContext,
  duration,
  nodes,
  initialPosition = 0,
  startOffset = 0,
  onPlaybackEnd,
}: UsePlaybackEngineOptions): UsePlaybackEngineResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPosition);

  const isPlayingRef = useRef(false);
  const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const startTimeRef = useRef<number>(0);
  const currentTimeRef = useRef(initialPosition);
  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const playbackGenRef = useRef<number>(0);
  const hasInitializedPosition = useRef(false);

  // Initialize position once duration is loaded
  useEffect(() => {
    if (duration > 0 && !hasInitializedPosition.current) {
      const clampedPosition = Math.max(0, Math.min(initialPosition, duration));
      currentTimeRef.current = clampedPosition;
      setCurrentTime(clampedPosition);
      hasInitializedPosition.current = true;
    }
  }, [duration, initialPosition]);

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

  const startSources = useCallback(
    (playbackPosition: number) => {
      if (!audioContext) return;

      stopAllSources();
      const thisPlaybackGen = ++playbackGenRef.current;

      nodes.forEach((playbackNode, name) => {
        const src = audioContext.createBufferSource();
        src.buffer = playbackNode.buffer;
        // Connect to the first node in the audio chain (e.g., gainNode)
        // The effects chain handles routing to destination
        src.connect(playbackNode.entryPoint);

        src.onended = () => {
          if (playbackGenRef.current !== thisPlaybackGen) return;
          sourcesRef.current.delete(name);
          // Only reset to 0 if we're still playing (natural end, not manual stop)
          if (sourcesRef.current.size === 0 && isPlayingRef.current) {
            setIsPlaying(false);
            isPlayingRef.current = false;
            currentTimeRef.current = 0;
            setCurrentTime(0);
            onPlaybackEnd?.();
          }
        };

        const audioPosition = playbackPosition + startOffset;
        src.start(0, audioPosition);
        sourcesRef.current.set(name, src);
      });

      startTimeRef.current = audioContext.currentTime - playbackPosition;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      const tick = () => {
        if (playbackGenRef.current !== thisPlaybackGen || !isPlayingRef.current)
          return;

        const elapsed = audioContext.currentTime - startTimeRef.current;
        if (elapsed >= duration) {
          setIsPlaying(false);
          isPlayingRef.current = false;
          currentTimeRef.current = 0;
          setCurrentTime(0);
          stopAllSources();
          onPlaybackEnd?.();
          return;
        }
        currentTimeRef.current = elapsed;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [audioContext, nodes, duration, startOffset, stopAllSources, onPlaybackEnd],
  );

  const play = useCallback(() => {
    if (isPlayingRef.current || !audioContext || nodes.size === 0) return;
    if (audioContext.state === "suspended") audioContext.resume();

    setIsPlaying(true);
    isPlayingRef.current = true;
    startSources(currentTimeRef.current);
  }, [audioContext, nodes.size, startSources]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current || !audioContext) return;

    const currentPosition = audioContext.currentTime - startTimeRef.current;
    currentTimeRef.current = currentPosition;
    setCurrentTime(currentPosition);

    isPlayingRef.current = false;
    setIsPlaying(false);
    stopAllSources();

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [audioContext, stopAllSources]);

  const stop = useCallback(
    (seekTime = 0) => {
      if (!audioContext) return;

      const newPosition = Math.max(0, Math.min(seekTime, duration));
      currentTimeRef.current = newPosition;
      setCurrentTime(newPosition);

      isPlayingRef.current = false;
      setIsPlaying(false);
      stopAllSources();

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    },
    [audioContext, stopAllSources, duration],
  );

  const seek = useCallback(
    (playbackPosition: number) => {
      const clamped = Math.max(0, Math.min(playbackPosition, duration));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);

      if (isPlayingRef.current && audioContext) {
        stopAllSources();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        startSources(clamped);
      }
    },
    [duration, audioContext, stopAllSources, startSources],
  );

  const formatTime = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // State update loop (setInterval)
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
    };
  }, [stopAllSources]);

  return { isPlaying, currentTime, play, pause, stop, seek, formatTime };
}
