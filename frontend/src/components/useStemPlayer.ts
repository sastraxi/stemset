import { useEffect, useRef, useState } from 'react';
import { useAudioContext } from '../hooks/useAudioContext';
import { useSettings } from '../hooks/useSettings';
import type { EqBand, LimiterSettings } from '../hooks/useSettings';
import { useAudioLoader } from '../hooks/useAudioLoader';
import type { LoadingMetrics } from '../hooks/useAudioLoader';
import { useStemManager } from '../hooks/useStemManager';
import type { StemStateEntry } from '../hooks/useStemManager';
import { usePlaybackController } from '../hooks/usePlaybackController';

/**
 * Orchestrator hook for multi-stem audio player.
 *
 * This hook composes focused hooks to provide a complete audio player:
 * - useAudioContext: AudioContext + master gain
 * - useSettings: localStorage persistence (master + per-recording)
 * - useAudioLoader: Metadata fetching + buffer loading
 * - useStemManager: Individual stem state + mute/solo logic
 * - usePlaybackController: Play/pause/stop/seek + RAF timing
 *
 * Responsibilities:
 * - Data flow between focused hooks
 * - EQ/limiter audio graph routing
 * - Persist stem state changes
 * - Persist playback position
 *
 * Pattern: Thin composition layer. No business logic here - just wiring.
 */

export interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  metadataUrl: string;
  sampleRate?: number;
}

export interface UseStemPlayerResult {
  // Loading state
  isLoading: boolean;
  loadingMetrics: LoadingMetrics | null;

  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Stem state
  stems: StemStateEntry[];

  // Playback controls
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  formatTime: (seconds: number) => string;

  // Stem controls
  setStemGain: (stemName: string, gain: number) => void;
  resetStemGain: (stemName: string) => void;
  toggleMute: (stemName: string) => void;
  toggleSolo: (stemName: string) => void;

  // Master effects
  eqBands: EqBand[];
  updateEqBand: (id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => void;
  resetEq: () => void;
  limiter: LimiterSettings;
  updateLimiter: (changes: Partial<LimiterSettings>) => void;
  resetLimiter: () => void;
  eqEnabled: boolean;
  setEqEnabled: (enabled: boolean) => void;
  gainReduction: number;
}

export function useStemPlayer({
  profileName,
  fileName,
  metadataUrl,
  sampleRate = 44100,
}: UseStemPlayerOptions): UseStemPlayerResult {
  // 1. Audio context and master gain
  const { getContext, getMasterInput } = useAudioContext({ sampleRate });
  const audioContext = getContext();
  const masterInput = getMasterInput();

  // 2. Settings (master + per-recording)
  const {
    eqBands,
    updateEqBand,
    resetEq,
    limiter,
    updateLimiter,
    resetLimiter,
    eqEnabled,
    setEqEnabled,
    getSavedRecordingState,
    persistPlaybackPosition,
    persistStemSettings,
  } = useSettings({ profileName, fileName });

  // 3. Load audio buffers
  const { isLoading, loadingMetrics, stems: loadedStems, duration, metadataBaseUrl } = useAudioLoader({
    profileName,
    fileName,
    metadataUrl,
    audioContext,
  });

  // 4. Stem management (gain, mute, solo)
  const {
    stems,
    setStemGain,
    resetStemGain,
    toggleMute,
    toggleSolo,
    getLoadedStems,
    getCurrentState,
  } = useStemManager({
    audioContext,
    masterInput,
    stems: loadedStems,
    metadataBaseUrl,
    savedState: getSavedRecordingState(),
  });

  // 5. Playback control
  const { isPlaying, currentTime, play, pause, stop, seek, formatTime } = usePlaybackController({
    audioContext,
    duration,
    getLoadedStems,
  });

  // 6. EQ/Limiter audio graph routing
  const eqFilterRefs = useRef<BiquadFilterNode[]>([]);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const makeupGainRef = useRef<GainNode | null>(null);
  const [gainReduction, setGainReduction] = useState<number>(0);

  // Initialize EQ/limiter chain
  useEffect(() => {
    if (!audioContext || !masterInput) return;

    // Create filters if not already created
    if (eqFilterRefs.current.length === 0) {
      eqFilterRefs.current = eqBands.map(b => {
        const f = audioContext.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.frequency;
        f.Q.value = b.q;
        f.gain.value = b.gain;
        return f;
      });
    }

    // Create compressor and makeup gain if not already created
    if (!compressorRef.current) {
      compressorRef.current = audioContext.createDynamicsCompressor();
      compressorRef.current.threshold.value = limiter.thresholdDb;
      compressorRef.current.knee.value = 6;
      compressorRef.current.ratio.value = 20;
      compressorRef.current.attack.value = 0.003;
      compressorRef.current.release.value = limiter.release;
    }

    if (!makeupGainRef.current) {
      makeupGainRef.current = audioContext.createGain();
      makeupGainRef.current.gain.value = 1;
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext, masterInput]);

  // Update EQ filter parameters when bands change
  useEffect(() => {
    if (!audioContext) return;

    eqBands.forEach((b, i) => {
      const f = eqFilterRefs.current[i];
      if (!f) return;
      f.type = b.type;
      f.frequency.setTargetAtTime(b.frequency, audioContext.currentTime, 0.01);
      f.Q.setTargetAtTime(b.q, audioContext.currentTime, 0.01);
      f.gain.setTargetAtTime(b.gain, audioContext.currentTime, 0.01);
    });
  }, [eqBands, audioContext]);

  // Rewire master chain when EQ enabled/disabled or limiter enabled/disabled
  useEffect(() => {
    if (!audioContext || !masterInput) return;
    if (!compressorRef.current || !makeupGainRef.current) return;

    // Disconnect everything first
    try {
      masterInput.disconnect();
    } catch {}
    eqFilterRefs.current.forEach(f => {
      try {
        f.disconnect();
      } catch {}
    });
    try {
      compressorRef.current.disconnect();
    } catch {}
    try {
      makeupGainRef.current.disconnect();
    } catch {}

    if (eqEnabled) {
      // master -> filters -> (compressor?) -> (makeup?) -> destination
      let node: AudioNode = masterInput;
      eqFilterRefs.current.forEach(f => {
        node.connect(f);
        node = f;
      });
      if (limiter.enabled) {
        node.connect(compressorRef.current);
        compressorRef.current.connect(makeupGainRef.current);
        makeupGainRef.current.connect(audioContext.destination);
      } else {
        node.connect(audioContext.destination);
      }
    } else {
      // master -> (compressor?) -> destination
      if (limiter.enabled) {
        masterInput.connect(compressorRef.current);
        compressorRef.current.connect(makeupGainRef.current);
        makeupGainRef.current.connect(audioContext.destination);
      } else {
        masterInput.connect(audioContext.destination);
      }
    }

    if (!limiter.enabled) {
      setGainReduction(0);
      if (makeupGainRef.current) {
        try {
          makeupGainRef.current.gain.setValueAtTime(1, audioContext.currentTime);
        } catch {}
      }
    }
  }, [eqEnabled, limiter.enabled, audioContext, masterInput]);

  // Update limiter parameters
  useEffect(() => {
    if (!audioContext || !compressorRef.current) return;
    compressorRef.current.threshold.setTargetAtTime(limiter.thresholdDb, audioContext.currentTime, 0.01);
    compressorRef.current.release.setTargetAtTime(limiter.release, audioContext.currentTime, 0.05);
  }, [limiter.thresholdDb, limiter.release, audioContext]);

  // Poll compressor reduction with auto makeup
  useEffect(() => {
    let raf: number;
    let smooth = 0;
    const alpha = 0.3;

    const tick = () => {
      if (compressorRef.current && makeupGainRef.current && audioContext) {
        let rawReduction = 0;
        if (limiter.enabled) {
          const r = compressorRef.current.reduction;
          rawReduction = r < 0 ? -r : 0;
        }
        smooth = smooth === 0 ? rawReduction : smooth * (1 - alpha) + rawReduction * alpha;
        const display = Math.min(smooth, 25);
        setGainReduction(display);

        // Auto makeup gain
        const makeupDb = limiter.enabled ? Math.min(smooth * 0.7, 12) : 0;
        const targetLinear = Math.pow(10, makeupDb / 20);
        makeupGainRef.current.gain.setTargetAtTime(targetLinear, audioContext.currentTime, 0.02);

        if (!limiter.enabled && smooth !== 0) {
          smooth = 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [limiter.enabled, audioContext]);

  // Persist playback position (debounced by useSettings)
  useEffect(() => {
    if (!isLoading) {
      persistPlaybackPosition(currentTime);
    }
  }, [currentTime, isLoading, persistPlaybackPosition]);

  // Persist stem settings (debounced by useSettings)
  useEffect(() => {
    if (!isLoading && stems.length > 0) {
      const state = getCurrentState();
      persistStemSettings(state.stemGains, state.stemMutes, state.stemSolos);
    }
  }, [stems, isLoading, getCurrentState, persistStemSettings]);

  return {
    // Loading
    isLoading,
    loadingMetrics,

    // Playback
    isPlaying,
    currentTime,
    duration,

    // Stems
    stems,

    // Playback controls
    play,
    pause,
    stop,
    seek,
    formatTime,

    // Stem controls
    setStemGain,
    resetStemGain,
    toggleMute,
    toggleSolo,

    // Master effects
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
