import { useState, useRef, useCallback } from 'react';
import type { LoadedStem } from './useStemManager';

export interface UsePlaybackControllerOptions {
  audioContext: AudioContext | null;
  duration: number;
  getLoadedStems: () => Map<string, LoadedStem>;
}

export interface UsePlaybackControllerResult {
  isPlaying: boolean;
  currentTime: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  formatTime: (seconds: number) => string;
}

/**
 * Manages playback control and timing for multi-stem audio.
 *
 * Responsibilities:
 * - BufferSourceNode lifecycle (recreate on play/resume/seek)
 * - Play/pause/stop/seek operations
 * - RAF-based progress tracking tied to AudioContext.currentTime
 * - Playback generation counter to invalidate old loops
 * - Natural end detection when all sources complete
 *
 * Pattern: Keep current timing model (startTimeRef + pausedAtRef).
 * Refs for imperative operations, state only for UI updates.
 * Playback generation counter prevents race conditions.
 */
export function usePlaybackController({
  audioContext,
  duration,
  getLoadedStems,
}: UsePlaybackControllerOptions): UsePlaybackControllerResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Audio source management
  const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());

  // Timing state
  const startTimeRef = useRef<number>(0); // AudioContext.currentTime - offset when play starts
  const pausedAtRef = useRef<number>(0); // Position in seconds when paused

  // RAF and playback management
  const rafRef = useRef<number | null>(null);
  const playbackGenRef = useRef<number>(0); // Incremented to invalidate old loops
  const endedRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false); // Authoritative state for closures
  const manualEndModeRef = useRef<'none' | 'pause' | 'stop'>('none');

  const stopAllSources = useCallback(() => {
    sourcesRef.current.forEach(src => {
      try {
        src.stop();
      } catch {
        // Ignore errors from already-stopped sources
      }
    });
    sourcesRef.current.clear();
  }, []);

  const startSources = useCallback(
    (offsetSeconds: number) => {
      if (!audioContext) return;

      stopAllSources();
      endedRef.current = false;

      // Increment generation to invalidate old RAF loops
      const thisPlaybackGen = playbackGenRef.current + 1;
      playbackGenRef.current = thisPlaybackGen;
      manualEndModeRef.current = 'none';

      const stems = getLoadedStems();

      stems.forEach((stem, name) => {
        const src = audioContext.createBufferSource();
        src.buffer = stem.buffer;
        src.connect(stem.gain);

        // Handle natural end of playback
        src.onended = () => {
          // Ignore if superseded by newer playback or manually stopped
          if (playbackGenRef.current !== thisPlaybackGen) return;
          if (manualEndModeRef.current !== 'none') return;

          sourcesRef.current.delete(name);

          // If all sources have ended naturally, stop playback
          if (sourcesRef.current.size === 0 && !endedRef.current) {
            endedRef.current = true;
            setIsPlaying(false);
            isPlayingRef.current = false;
            pausedAtRef.current = 0;
            startTimeRef.current = audioContext.currentTime;
            setCurrentTime(0);
          }
        };

        try {
          src.start(0, offsetSeconds);
        } catch (e) {
          console.error('[usePlaybackController] Failed to start source', name, e);
        }

        sourcesRef.current.set(name, src);
      });

      // Set timing reference
      startTimeRef.current = audioContext.currentTime - offsetSeconds;

      // Start RAF-based progress tracking
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      const tick = () => {
        // Bail if this playback generation is superseded
        if (playbackGenRef.current !== thisPlaybackGen) return;
        if (!isPlayingRef.current) return;

        const elapsed = audioContext.currentTime - startTimeRef.current;
        setCurrentTime(elapsed >= duration ? duration : elapsed);

        if (elapsed < duration) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [audioContext, duration, getLoadedStems, stopAllSources]
  );

  const play = useCallback(() => {
    if (isPlaying) return;
    if (!audioContext) return;

    const stems = getLoadedStems();
    if (stems.size === 0) return;

    // Resume context if suspended
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    setIsPlaying(true);
    isPlayingRef.current = true;
    startSources(pausedAtRef.current);
  }, [isPlaying, audioContext, getLoadedStems, startSources]);

  const pause = useCallback(() => {
    if (!isPlaying) return;
    if (!audioContext) return;

    pausedAtRef.current = audioContext.currentTime - startTimeRef.current;
    manualEndModeRef.current = 'pause';
    isPlayingRef.current = false;
    stopAllSources();
    setIsPlaying(false);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Invalidate current playback generation
    playbackGenRef.current += 1;
  }, [isPlaying, audioContext, stopAllSources]);

  const stop = useCallback(() => {
    if (!audioContext) return;

    pausedAtRef.current = 0;
    manualEndModeRef.current = 'stop';
    isPlayingRef.current = false;
    stopAllSources();
    setIsPlaying(false);
    setCurrentTime(0);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    playbackGenRef.current += 1;
  }, [audioContext, stopAllSources]);

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, duration));
      pausedAtRef.current = clamped;
      setCurrentTime(clamped);

      if (isPlaying) {
        startSources(clamped);
      }
    },
    [duration, isPlaying, startSources]
  );

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    isPlaying,
    currentTime,
    play,
    pause,
    stop,
    seek,
    formatTime,
  };
}
