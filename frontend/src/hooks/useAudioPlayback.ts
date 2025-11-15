import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic audio node interface for playback.
 * Only requires a buffer and an entry point to connect the source.
 */
export interface PlaybackNode {
  buffer: AudioBuffer;
  entryPoint: AudioNode;
}

export interface UseAudioPlaybackOptions {
  audioContext: AudioContext | null;
  duration: number;
  nodes: Map<string, PlaybackNode>;
  initialPosition?: number;
  startOffset?: number;
  onPlaybackEnd?: () => void;
}

export interface UseAudioPlaybackResult {
  isPlaying: boolean;
  currentTime: number;
  play: () => void;
  pause: () => void;
  stop: (seekTime?: number) => void;
  seek: (seconds: number) => void;
}

/**
 * Core audio playback controller using Web Audio API.
 *
 * Uses a double-loop pattern for efficient time tracking:
 * 1. requestAnimationFrame loop runs at display refresh rate for accurate timekeeping
 * 2. setInterval loop runs at ~20fps to update React state without excessive re-renders
 *
 * Features:
 * - Playback generation tracking to prevent race conditions with stale callbacks
 * - Automatic reset to beginning when playback ends
 * - Support for offset playback (e.g., for clips)
 */
export function useAudioPlayback({
  audioContext,
  duration,
  nodes,
  initialPosition = 0,
  startOffset = 0,
  onPlaybackEnd,
}: UseAudioPlaybackOptions): UseAudioPlaybackResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(
    Math.max(0, Math.min(initialPosition, duration)),
  );

  const isPlayingRef = useRef(false);
  const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const startTimeRef = useRef<number>(0);
  const currentTimeRef = useRef(
    Math.max(0, Math.min(initialPosition, duration)),
  );
  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const playbackGenRef = useRef<number>(0);

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

      nodes.forEach((node, name) => {
        const src = audioContext.createBufferSource();
        src.buffer = node.buffer;
        src.connect(node.entryPoint);
        src.onended = () => {
          if (playbackGenRef.current !== thisPlaybackGen) return;
          sourcesRef.current.delete(name);
          if (sourcesRef.current.size === 0) {
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

  return { isPlaying, currentTime, play, pause, stop, seek };
}
