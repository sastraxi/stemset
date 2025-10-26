import { useCallback, useEffect, useRef, useState } from 'react';
import type { StemMetadata } from '../types';
import { getFileMetadata } from '../api';
import {
  getMasterEq,
  setMasterEq,
  getMasterLimiter,
  setMasterLimiter,
  getMasterEqEnabled,
  setMasterEqEnabled,
  getRecordingState,
  updateRecordingState,
} from '../lib/storage';
import type { MasterEqSettings } from '../lib/storage';

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
  gain: GainNode; // persistent gain node for volume control
  outputGain: GainNode; // final output gain node (handles mute/solo logic)
  initialGain: number; // derived from metadata
  metadata: StemMetadata | null;
  muted: boolean; // mute state (stored here instead of in gain value)
}

interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  metadataUrl: string;
  sampleRate?: number; // default 44100
}

interface StemStateEntry {
  name: string;
  gain: number; // current linear gain for UI
  initialGain: number;
  waveformUrl: string | null;
  muted: boolean;
  soloed: boolean;
}

// Equalizer band representation
interface EqBand {
  id: string;
  frequency: number; // center Hz
  type: BiquadFilterType;
  gain: number; // dB
  q: number; // Q factor
}

interface LimiterSettings {
  thresholdDb: number; // compressor threshold (e.g. -12 to 0 dB)
  release: number; // seconds
  enabled: boolean;
}

interface StemTiming {
  name: string;
  fetchMs: number;
  decodeMs: number;
  totalMs: number;
  bytes: number;
}

interface LoadingMetrics {
  startedAt: number;
  finishedAt: number;
  totalMs: number;
  stems: StemTiming[];
  metadataMs: number;
}

export interface UseStemPlayerResult {
  isLoading: boolean;
  loadingMetrics: LoadingMetrics | null;
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
  toggleMute: (stemName: string) => void;
  toggleSolo: (stemName: string) => void;
  formatTime: (seconds: number) => string;
  eqBands: EqBand[];
  updateEqBand: (id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => void;
  resetEq: () => void;
  limiter: LimiterSettings;
  updateLimiter: (changes: Partial<LimiterSettings>) => void;
  resetLimiter: () => void;
  eqEnabled: boolean;
  setEqEnabled: (enabled: boolean) => void;
  gainReduction: number; // positive dB amount of current gain reduction
}

export function useStemPlayer({ profileName, fileName, metadataUrl, sampleRate = 44100 }: UseStemPlayerOptions): UseStemPlayerResult {
  // Public state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState<LoadingMetrics | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [stemState, setStemState] = useState<StemStateEntry[]>([]);
  const [soloedStems, setSoloedStems] = useState<Set<string>>(new Set());
  const [eqBands, setEqBands] = useState<EqBand[]>(() => {
    const defaults: EqBand[] = [
      { id: 'low', frequency: 80, type: 'lowshelf', gain: 0, q: 1 },
      { id: 'lowmid', frequency: 250, type: 'peaking', gain: 0, q: 1 },
      { id: 'mid', frequency: 1000, type: 'peaking', gain: 0, q: 1 },
      { id: 'highmid', frequency: 3500, type: 'peaking', gain: 0, q: 1 },
      { id: 'high', frequency: 10000, type: 'highshelf', gain: 0, q: 1 },
    ];
    return getMasterEq(defaults) as EqBand[];
  });
  const [limiter, setLimiter] = useState<LimiterSettings>(() => {
    const def: LimiterSettings = { thresholdDb: -6, release: 0.12, enabled: true };
    return getMasterLimiter(def);
  });
  const [eqEnabled, setEqEnabled] = useState<boolean>(() => {
    return getMasterEqEnabled(true);
  });

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
  const metadataBaseUrlRef = useRef<string>(''); // Base URL for resolving relative paths in metadata
  const masterInputRef = useRef<GainNode | null>(null); // stems connect to this instead of context.destination
  const eqFilterRefs = useRef<BiquadFilterNode[]>([]);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const makeupGainRef = useRef<GainNode | null>(null); // post compressor makeup gain
  const [gainReduction, setGainReduction] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Lazy init AudioContext
  const ensureContext = useCallback(() => {
    // Context & master chain initialization should NOT depend on dynamic EQ/limiter settings;
    // changing those caused stem reloads. We build the chain once with default values and
    // subsequent adjustments update nodes directly.
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext({ sampleRate });
    }
    const ctx = audioCtxRef.current;
    if (ctx && !masterInputRef.current) {
      masterInputRef.current = ctx.createGain();
      // Initialize filters with current eqBands snapshot
      eqFilterRefs.current = eqBands.map(b => {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.frequency;
        f.Q.value = b.q;
        f.gain.value = b.gain;
        return f;
      });
      let node: AudioNode = masterInputRef.current;
      eqFilterRefs.current.forEach(f => { node.connect(f); node = f; });
      compressorRef.current = ctx.createDynamicsCompressor();
      compressorRef.current.threshold.value = limiter.thresholdDb;
      compressorRef.current.knee.value = 6;
      compressorRef.current.ratio.value = 20;
      compressorRef.current.attack.value = 0.003;
      compressorRef.current.release.value = limiter.release;
      makeupGainRef.current = ctx.createGain();
      makeupGainRef.current.gain.value = 1;
      if (limiter.enabled) {
        node.connect(compressorRef.current);
        compressorRef.current.connect(makeupGainRef.current);
        makeupGainRef.current.connect(ctx.destination);
      } else {
        node.connect(ctx.destination);
      }
    }
    return audioCtxRef.current;
  }, [sampleRate]);

  // Load metadata + audio buffers (parallel with instrumentation)
  useEffect(() => {
    // Abort any previous loading operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this load
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    const ctx = ensureContext();
    async function load() {
      setIsLoading(true);
      setLoadingMetrics(null);
      // Tear down previous stems (keep context)
      sourcesRef.current.forEach((src) => { try { src.stop(); } catch { }; });
      sourcesRef.current.clear();
      loadedStemsRef.current.forEach((ls) => { try { ls.gain.disconnect(); } catch { }; });
      loadedStemsRef.current.clear();
      setDuration(0);
      const t0 = performance.now();
      const metaStart = performance.now();
      const response = await getFileMetadata(metadataUrl);
      console.log('[useStemPlayer] Fetched metadata:', response);
      // Handle both old format (flat) and new format (nested under "stems")
      const metadata: Record<string, StemMetadata> = response.stems || response;
      const metaEnd = performance.now();

      // Compute base URL for stems (metadata URL without the filename)
      const metadataBaseUrl = metadataUrl.substring(0, metadataUrl.lastIndexOf('/') + 1);
      metadataBaseUrlRef.current = metadataBaseUrl;

      const newMap = new Map<string, LoadedStem>();
      const stemEntries = Object.entries(metadata).map(([name, meta]) => [name, metadataBaseUrl + meta.stem_url]);
      const timingAccumulator: StemTiming[] = [];
      await Promise.all(stemEntries.map(async ([name, url]) => {
        if (signal.aborted || !url) return;
        const fetchStart = performance.now();
        try {
          const resp = await fetch(url, {
            signal,
            // Explicitly allow browser caching for audio files
            cache: 'default'
          });
          const blob = await resp.blob();
          const fetchEnd = performance.now();
          const bytes = blob.size;
          const arrayBuffer = await blob.arrayBuffer();
          if (signal.aborted) return;
          const decodeStart = performance.now();
          const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          const decodeEnd = performance.now();
          if (signal.aborted) return;
          const meta = metadata[name] || null;
          console.log(`[useStemPlayer] Looking up metadata for stem "${name}":`, meta);
          console.log(`[useStemPlayer] Available metadata keys:`, Object.keys(metadata));
          let initialGain = 1;
          if (meta && typeof meta.stem_gain_adjustment_db === 'number') {
            initialGain = Math.pow(10, meta.stem_gain_adjustment_db / 20);
          }
          if (ctx.state === 'closed') return;
          const gainNode = ctx.createGain();
          gainNode.gain.value = initialGain;
          const outputGainNode = ctx.createGain();
          outputGainNode.gain.value = 1;
          // Simplified chain: gainNode (volume) -> outputGainNode (calculated mute/solo) -> masterInput
          if (masterInputRef.current) {
            gainNode.connect(outputGainNode);
            outputGainNode.connect(masterInputRef.current);
          } else {
            gainNode.connect(outputGainNode);
            outputGainNode.connect(ctx.destination);
          }
          newMap.set(name, {
            buffer,
            gain: gainNode,
            outputGain: outputGainNode,
            initialGain,
            metadata: meta,
            muted: false
          });
          setDuration((prev) => (prev === 0 ? buffer.duration : prev));
          timingAccumulator.push({
            name,
            fetchMs: fetchEnd - fetchStart,
            decodeMs: decodeEnd - decodeStart,
            totalMs: decodeEnd - fetchStart,
            bytes,
          });
        } catch (e) {
          if (!signal.aborted) console.error('Failed to load stem', name, e);
        }
      }));
      if (signal.aborted) return;
      loadedStemsRef.current = newMap;

      // Restore per-recording state from localStorage
      const savedState = getRecordingState(profileName, fileName);

      const stemStateArray = Array.from(newMap.entries()).map(([n, s]) => {
        // Restore saved gain and mute state if available
        if (savedState) {
          if (savedState.stemGains[n] !== undefined) {
            s.gain.gain.value = savedState.stemGains[n];
          }
          if (savedState.stemMutes[n] !== undefined) {
            s.muted = savedState.stemMutes[n];
          }
        }
        return {
          name: n,
          gain: s.gain.gain.value,
          initialGain: s.initialGain,
          waveformUrl: s.metadata ? metadataBaseUrl + s.metadata.waveform_url : null,
          muted: s.muted,
          soloed: soloedStems.has(n)
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      console.log('[useStemPlayer] Setting stem state:', stemStateArray);
      setStemState(stemStateArray);
      setIsLoading(false);

      // Restore playback position
      const initialPosition = savedState?.playbackPosition || 0;
      pausedAtRef.current = initialPosition;
      startTimeRef.current = ctx.currentTime - initialPosition;
      setCurrentTime(initialPosition);

      const t1 = performance.now();
      setLoadingMetrics({
        startedAt: t0,
        finishedAt: t1,
        totalMs: t1 - t0,
        stems: timingAccumulator.sort((a, b) => a.name.localeCompare(b.name)),
        metadataMs: metaEnd - metaStart,
      });
    }
    load();
    return () => {
      // Cleanup will abort the current controller when component unmounts
      // or when switching to a different file
    };
  }, [profileName, fileName, metadataUrl, ensureContext]);

  // Persist master settings (global)
  useEffect(() => { setMasterEq(eqBands as MasterEqSettings[]); }, [eqBands]);
  useEffect(() => { setMasterLimiter(limiter); }, [limiter]);
  useEffect(() => { setMasterEqEnabled(eqEnabled); }, [eqEnabled]);

  // Persist per-recording playback position (debounced to avoid excessive writes)
  useEffect(() => {
    if (isLoading) return; // Don't persist during initial load
    const timer = setTimeout(() => {
      updateRecordingState(profileName, fileName, { playbackPosition: currentTime });
    }, 1000); // Debounce 1s
    return () => clearTimeout(timer);
  }, [currentTime, profileName, fileName, isLoading]);

  // Persist per-recording stem gains and mute states (debounced)
  useEffect(() => {
    if (isLoading || stemState.length === 0) return;
    const timer = setTimeout(() => {
      const stemGains: Record<string, number> = {};
      const stemMutes: Record<string, boolean> = {};
      stemState.forEach(s => {
        stemGains[s.name] = s.gain;
        stemMutes[s.name] = s.muted;
      });
      updateRecordingState(profileName, fileName, { stemGains, stemMutes });
    }, 500); // Debounce 500ms (more responsive for UI controls)
    return () => clearTimeout(timer);
  }, [stemState, profileName, fileName, isLoading]);

  // React to eqBands change: update existing filters or rebuild if count changes
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !masterInputRef.current) return;
    if (eqFilterRefs.current.length !== eqBands.length) {
      // Disconnect old
      eqFilterRefs.current.forEach(f => { try { f.disconnect(); } catch { } });
      eqFilterRefs.current = eqBands.map(b => {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.frequency;
        f.Q.value = b.q;
        f.gain.value = b.gain;
        return f;
      });
    } else {
      eqBands.forEach((b, i) => {
        const f = eqFilterRefs.current[i];
        if (!f) return;
        f.type = b.type;
        f.frequency.setTargetAtTime(b.frequency, ctx.currentTime, 0.01);
        f.Q.setTargetAtTime(b.q, ctx.currentTime, 0.01);
        f.gain.setTargetAtTime(b.gain, ctx.currentTime, 0.01);
      });
    }
  }, [eqBands]);

  // Rewire master chain on EQ enable/disable or limiter enable/disable changes
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !masterInputRef.current) return;
    // Disconnect everything first to avoid duplicate parallel paths
    try { masterInputRef.current.disconnect(); } catch { }
    eqFilterRefs.current.forEach(f => { try { f.disconnect(); } catch { } });
    if (compressorRef.current) { try { compressorRef.current.disconnect(); } catch { } }
    if (makeupGainRef.current) { try { makeupGainRef.current.disconnect(); } catch { } }

    if (eqEnabled) {
      // master -> filters -> (compressor?) -> (makeup?) -> destination
      let node: AudioNode = masterInputRef.current;
      eqFilterRefs.current.forEach(f => { node.connect(f); node = f; });
      if (limiter.enabled && compressorRef.current && makeupGainRef.current) {
        node.connect(compressorRef.current);
        compressorRef.current.connect(makeupGainRef.current);
        makeupGainRef.current.connect(ctx.destination);
      } else {
        node.connect(ctx.destination);
      }
    } else {
      // master -> (compressor?) -> destination
      if (limiter.enabled && compressorRef.current && makeupGainRef.current) {
        masterInputRef.current.connect(compressorRef.current);
        compressorRef.current.connect(makeupGainRef.current);
        makeupGainRef.current.connect(ctx.destination);
      } else {
        masterInputRef.current.connect(ctx.destination);
      }
    }
    if (!limiter.enabled) {
      // Ensure visual + gain makeup reset when bypassed
      setGainReduction(0);
      if (makeupGainRef.current) {
        try { makeupGainRef.current.gain.setValueAtTime(1, ctx.currentTime); } catch { }
      }
    }
  }, [eqEnabled, limiter.enabled]);

  // Limiter updates (simple: adjust ceiling gain). Real threshold/release processing would need dynamics analysis.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !compressorRef.current) return;
    compressorRef.current.threshold.setTargetAtTime(limiter.thresholdDb, ctx.currentTime, 0.01);
    compressorRef.current.release.setTargetAtTime(limiter.release, ctx.currentTime, 0.05);
  }, [limiter.thresholdDb, limiter.release]);

  // Poll compressor reduction with auto makeup; bypass when disabled.
  useEffect(() => {
    let raf: number;
    let smooth = 0;
    const alpha = 0.3; // responsiveness (higher = snappier)
    const tick = () => {
      if (compressorRef.current && makeupGainRef.current && audioCtxRef.current) {
        let rawReduction = 0;
        if (limiter.enabled) {
          const r = compressorRef.current.reduction; // negative dB or 0
          rawReduction = r < 0 ? -r : 0;
        }
        smooth = smooth === 0 ? rawReduction : (smooth * (1 - alpha) + rawReduction * alpha);
        // Cap display at 25 dB
        const display = Math.min(smooth, 25);
        setGainReduction(display);
        // Auto makeup gain (compensate 70% of smooth reduction, capped 12 dB)
        const makeupDb = limiter.enabled ? Math.min(smooth * 0.7, 12) : 0;
        const targetLinear = Math.pow(10, makeupDb / 20);
        makeupGainRef.current.gain.setTargetAtTime(targetLinear, audioCtxRef.current.currentTime, 0.02);
        if (!limiter.enabled && smooth !== 0) {
          // Reset smoothing quickly when disabled
          smooth = 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [limiter.enabled]);

  const updateStemState = useCallback(() => {
    setStemState(Array.from(loadedStemsRef.current.entries()).map(([name, s]) => ({
      name,
      gain: s.gain.gain.value,
      initialGain: s.initialGain,
      waveformUrl: s.metadata ? metadataBaseUrlRef.current + s.metadata.waveform_url : null,
      muted: s.muted,
      soloed: soloedStems.has(name)
    })).sort((a, b) => a.name.localeCompare(b.name)));
  }, [soloedStems]);

  // Create buffer sources and start playback from offset
  const stopAllSources = useCallback(() => {
    sourcesRef.current.forEach((src) => { try { src.stop(); } catch { }; });
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

  const updateAudibility = useCallback(() => {
    // Calculate audibility: solo overrides mute
    const hasSoloedStems = soloedStems.size > 0;

    for (const [stemName, stem] of loadedStemsRef.current.entries()) {
      const isSoloed = soloedStems.has(stemName);

      let audible = true;
      if (hasSoloedStems) {
        // If any stems are soloed, only soloed stems are audible
        audible = isSoloed;
      } else {
        // No soloing: audible unless muted
        audible = !stem.muted;
      }

      stem.outputGain.gain.value = audible ? 1 : 0;
    }
    updateStemState();
  }, [soloedStems, updateStemState]);

  const toggleMute = useCallback((stemName: string) => {
    const stem = loadedStemsRef.current.get(stemName);
    if (!stem) return;
    stem.muted = !stem.muted;
    updateAudibility();
  }, [updateAudibility]);

  const toggleSolo = useCallback((stemName: string) => {
    setSoloedStems(prev => {
      const newSoloedStems = new Set(prev);
      if (newSoloedStems.has(stemName)) {
        newSoloedStems.delete(stemName);
      } else {
        newSoloedStems.add(stemName);
      }
      return newSoloedStems;
    });
  }, []);

  // Update audibility whenever soloedStems changes
  useEffect(() => {
    updateAudibility();
  }, [updateAudibility]);

  // EQ management
  const updateEqBand = useCallback((id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => {
    setEqBands(prev => prev.map(b => b.id === id ? { ...b, ...changes } : b));
  }, []);
  const resetEq = useCallback(() => {
    setEqBands([
      { id: 'low', frequency: 80, type: 'lowshelf', gain: 0, q: 1 },
      { id: 'lowmid', frequency: 250, type: 'peaking', gain: 0, q: 1 },
      { id: 'mid', frequency: 1000, type: 'peaking', gain: 0, q: 1 },
      { id: 'highmid', frequency: 3500, type: 'peaking', gain: 0, q: 1 },
      { id: 'high', frequency: 10000, type: 'highshelf', gain: 0, q: 1 },
    ]);
  }, []);

  // Limiter management
  const updateLimiter = useCallback((changes: Partial<LimiterSettings>) => {
    setLimiter(prev => ({ ...prev, ...changes }));
  }, []);
  const resetLimiter = useCallback(() => {
    setLimiter({ thresholdDb: -6, release: 0.12, enabled: true });
  }, []);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    isLoading,
    loadingMetrics,
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
    toggleMute,
    toggleSolo,
    formatTime,
    eqBands,
    updateEqBand,
    resetEq,
    limiter,
    updateLimiter,
    resetLimiter,
    eqEnabled,
    setEqEnabled,
    gainReduction,
  };
}
