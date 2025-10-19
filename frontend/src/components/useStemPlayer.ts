import { useCallback, useEffect, useRef, useState } from 'react';
import type { StemMetadata } from '../types';
import { getFileMetadata } from '../api';

/**
 * Design goals / patterns for React + Web Audio:
 * 1. AudioContext is the single source of timing truth (never rely on setInterval to advance time).
 * 2. BufferSourceNodes are one-shot; recreate them on play/resume/seek. Keep immutable AudioBuffers cached.
 * 3. Maintain a lightweight state object for UI (isPlaying, currentTime, duration, loading) and store
 *    Web Audio nodes in refs to avoid re-renders on every frame.
 * 4. Use requestAnimationFrame tied to AudioContext.currentTime - startTime for progress.
 * 5. For seek: update offset (pausedAt), then if playing recreate sources starting at new offset.
 * 6. Volume changes apply immediately to GainNode.gain.value; keep initialGain for resetting.
 * 7. Cleanup: stop sources, disconnect nodes, close context only on unmount. Never call close mid-session.
 */

export interface StemSources {
  [stemName: string]: string | undefined;
  vocals?: string;
  drums?: string;
  bass?: string;
  other?: string;
}

interface LoadedStem {
  buffer: AudioBuffer;
  gain: GainNode; // persistent gain node
  initialGain: number; // derived from metadata
  metadata: StemMetadata | null;
}

interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  stems: StemSources;
  sampleRate?: number; // default 44100
}

interface StemStateEntry {
  name: string;
  gain: number; // current linear gain for UI
  initialGain: number;
}

export interface UseStemPlayerResult {
  isLoading: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  stems: StemStateEntry[];
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setStemGain: (stemName: string, gain: number) => void;
  resetStemGain: (stemName: string) => void;
  formatTime: (seconds: number) => string;
}

export function useStemPlayer({ profileName, fileName, stems, sampleRate = 44100 }: UseStemPlayerOptions): UseStemPlayerResult {
  // Public state
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [stemState, setStemState] = useState<StemStateEntry[]>([]);

  // Refs for audio graph & timing
  const audioCtxRef = useRef<AudioContext | null>(null);
  const loadedStemsRef = useRef<Map<string, LoadedStem>>(new Map());
  const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const startTimeRef = useRef<number>(0); // AudioContext.currentTime at play minus offset
  const pausedAtRef = useRef<number>(0); // Seconds position when paused
  const rafRef = useRef<number | null>(null);
  const playbackGenRef = useRef<number>(0); // Incremented each time we start playback to invalidate old loops
  const endedRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false); // authoritative play state for RAF closure
  const manualEndModeRef = useRef<'none' | 'pause' | 'stop'>('none'); // differentiate natural end vs user action

  // Lazy init AudioContext
  const ensureContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext({ sampleRate });
    }
    return audioCtxRef.current;
  }, [sampleRate]);

  // Load metadata + audio buffers
  useEffect(() => {
    let aborted = false;
    const ctx = ensureContext();
    async function load() {
      setIsLoading(true);
      // Tear down previous stems (keep context)
      sourcesRef.current.forEach((src) => { try { src.stop(); } catch {}; });
      sourcesRef.current.clear();
      loadedStemsRef.current.forEach((ls) => { try { ls.gain.disconnect(); } catch {}; });
      loadedStemsRef.current.clear();
      setDuration(0);
      let metadata: Record<string, StemMetadata> = {};
      try {
        metadata = await getFileMetadata(profileName, fileName);
      } catch {}
      const newMap = new Map<string, LoadedStem>();
      for (const [name, url] of Object.entries(stems)) {
        if (aborted) return;
        if (!url) continue;
        try {
          const resp = await fetch(url);
          const arrayBuffer = await resp.arrayBuffer();
          if (aborted) return;
          const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          if (aborted) return;
          const meta = metadata[name] || null;
          let initialGain = 1;
          if (meta && typeof meta.stem_gain_adjustment_db === 'number') {
            initialGain = Math.pow(10, meta.stem_gain_adjustment_db / 20);
          }
            // Guard against closed context (should not happen because we keep it open)
          if (ctx.state === 'closed') return;
          const gainNode = ctx.createGain();
          gainNode.gain.value = initialGain;
          gainNode.connect(ctx.destination);
          newMap.set(name, { buffer, gain: gainNode, initialGain, metadata: meta });
          setDuration((prev) => (prev === 0 ? buffer.duration : prev));
        } catch (e) {
          if (!aborted) console.error('Failed to load stem', name, e);
        }
      }
      if (aborted) return;
      loadedStemsRef.current = newMap;
      setStemState(Array.from(newMap.entries()).map(([n, s]) => ({ name: n, gain: s.gain.gain.value, initialGain: s.initialGain })));
      setIsLoading(false);
      pausedAtRef.current = 0;
      startTimeRef.current = ctx.currentTime;
      setCurrentTime(0);
    }
    load();
    return () => {
      aborted = true;
    };
  }, [profileName, fileName, stems, ensureContext]);

  const updateStemState = useCallback(() => {
    setStemState(Array.from(loadedStemsRef.current.entries()).map(([name, s]) => ({ name, gain: s.gain.gain.value, initialGain: s.initialGain })));
  }, []);

  // Create buffer sources and start playback from offset
  const stopAllSources = useCallback(() => {
    sourcesRef.current.forEach((src) => { try { src.stop(); } catch {}; });
    sourcesRef.current.clear();
  }, []);

  const startSources = useCallback((offsetSeconds: number) => {
    const ctx = ensureContext();
    stopAllSources();
    endedRef.current = false;
    const thisPlaybackGen = playbackGenRef.current + 1;
    playbackGenRef.current = thisPlaybackGen;
    manualEndModeRef.current = 'none';
    loadedStemsRef.current.forEach((stem, name) => {
      const src = ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      src.onended = () => {
        // Ignore if superseded by a newer playback generation OR manually stopped/paused
        if (playbackGenRef.current !== thisPlaybackGen) return;
        if (manualEndModeRef.current !== 'none') return; // user initiated
        sourcesRef.current.delete(name);
        if (sourcesRef.current.size === 0 && !endedRef.current) {
          endedRef.current = true;
          setIsPlaying(false);
          isPlayingRef.current = false;
          pausedAtRef.current = 0;
          startTimeRef.current = ctx.currentTime;
          setCurrentTime(0);
        }
      };
      try {
        src.start(0, offsetSeconds);
      } catch (e) {
        console.error('Failed to start source', name, e);
      }
      sourcesRef.current.set(name, src);
    });
    startTimeRef.current = ctx.currentTime - offsetSeconds;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      if (playbackGenRef.current !== thisPlaybackGen) return; // invalidate old loop
      if (!isPlayingRef.current) return;
      const elapsed = ctx.currentTime - startTimeRef.current;
      setCurrentTime(elapsed >= duration ? duration : elapsed);
      if (elapsed < duration) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [ensureContext, duration, stopAllSources]);

  const play = useCallback(() => {
    if (isPlaying) return;
    if (loadedStemsRef.current.size === 0) return;
    const ctx = ensureContext();
    if (ctx.state === 'suspended') ctx.resume();
    setIsPlaying(true);
    isPlayingRef.current = true;
    startSources(pausedAtRef.current);
  }, [isPlaying, ensureContext, startSources]);

  const pause = useCallback(() => {
    if (!isPlaying) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    pausedAtRef.current = ctx.currentTime - startTimeRef.current;
    manualEndModeRef.current = 'pause';
    isPlayingRef.current = false;
    stopAllSources();
    setIsPlaying(false); // currentTime preserved
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    // Invalidate current playback generation to silence old callbacks
    playbackGenRef.current += 1;
  }, [isPlaying, stopAllSources]);

  const stop = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx) pausedAtRef.current = 0;
    manualEndModeRef.current = 'stop';
    isPlayingRef.current = false;
    stopAllSources();
    setIsPlaying(false);
    setCurrentTime(0);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    playbackGenRef.current += 1; // invalidate old loops
  }, [stopAllSources]);

  const seek = useCallback((seconds: number) => {
    const clamped = Math.max(0, Math.min(seconds, duration));
    pausedAtRef.current = clamped;
    setCurrentTime(clamped);
    if (isPlaying) {
      startSources(clamped);
    }
  }, [duration, isPlaying, startSources]);

  const setStemGain = useCallback((stemName: string, gain: number) => {
    const stem = loadedStemsRef.current.get(stemName);
    if (!stem) return;
    // Clamp gain to a reasonable range (0 - 2 default UI range)
    const clamped = Math.max(0, Math.min(gain, 2));
    stem.gain.gain.value = clamped;
    updateStemState();
  }, [updateStemState]);

  const resetStemGain = useCallback((stemName: string) => {
    const stem = loadedStemsRef.current.get(stemName);
    if (!stem) return;
    stem.gain.gain.value = stem.initialGain;
    updateStemState();
  }, [updateStemState]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    isLoading,
    isPlaying,
    currentTime,
    duration,
    stems: stemState,
    play,
    pause,
    stop,
    seek,
    setStemGain,
    resetStemGain,
    formatTime,
  };
}
