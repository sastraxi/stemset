import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAudioContext } from './useAudioContext';
import { useRecordingConfig } from './useRecordingConfig';
import { useAudioLoader } from './useAudioLoader';
import type { LoadingMetrics } from './useAudioLoader';
import { useStemAudioNodes } from './useStemAudioNodes';
import { usePlaybackController } from './usePlaybackController';
import { useAudioEffects } from './useAudioEffects';
import type { EqConfig } from './effects/useEqEffect';
import type { CompressorConfig } from './effects/useCompressorEffect';
import type { ReverbConfig } from './effects/useReverbEffect';
import type { StereoExpanderConfig } from './effects/useStereoExpanderEffect';

/**
 * Orchestrator hook for multi-stem audio player.
 *
 * NEW ARCHITECTURE - No getter functions, all state at top level
 *
 * Data flow:
 * 1. Load audio buffers (useAudioLoader)
 * 2. Create audio nodes (useStemAudioNodes)
 * 3. Manage stem state (local state in this hook)
 * 4. Apply stem state to audio nodes (useEffect)
 * 5. Persist changes to localStorage (useRecordingConfig)
 *
 * Key insight: Stem state (gains, mutes, solos) is just React state.
 * Audio nodes react to state changes via useEffect.
 */

export interface UseStemPlayerOptions {
  profileName: string;
  fileName: string;
  metadataUrl: string;
  sampleRate?: number;
}

export interface StemState {
  gain: number;
  muted: boolean;
  soloed: boolean;
  initialGain: number;
  waveformUrl: string;
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
  stems: Record<string, StemState>;
  stemOrder: string[]; // For consistent ordering

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

  // Effects
  eqConfig: EqConfig;
  compressorConfig: CompressorConfig;
  reverbConfig: ReverbConfig;
  stereoExpanderConfig: StereoExpanderConfig;
  updateEqBand: (id: string, changes: Partial<{ gain: number; frequency: number; q: number; type: BiquadFilterType }>) => void;
  setEqEnabled: (enabled: boolean) => void;
  resetEq: () => void;
  updateCompressor: (changes: Partial<CompressorConfig>) => void;
  setCompressorEnabled: (enabled: boolean) => void;
  resetCompressor: () => void;
  updateReverb: (changes: Partial<ReverbConfig>) => void;
  setReverbEnabled: (enabled: boolean) => void;
  resetReverb: () => void;
  updateStereoExpander: (changes: Partial<StereoExpanderConfig>) => void;
  setStereoExpanderEnabled: (enabled: boolean) => void;
  resetStereoExpander: () => void;
  compressorGainReduction: number;
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

  // 2. Recording config (localStorage persistence)
  const { getConfig, savePlaybackPosition, saveStemConfig, saveEffectsConfig } = useRecordingConfig({
    profileName,
    fileName,
  });

  // 3. Load audio buffers
  const { isLoading, loadingMetrics, stems: loadedStems, duration, metadataBaseUrl } = useAudioLoader({
    profileName,
    fileName,
    metadataUrl,
    audioContext,
  });

  // 4. Create audio nodes
  const { stemNodes } = useStemAudioNodes({
    audioContext,
    masterInput,
    stems: loadedStems,
  });

  // 5. Stem state (managed at this level)
  const [stems, setStems] = useState<Record<string, StemState>>({});
  const [stemOrder, setStemOrder] = useState<string[]>([]);

  // Initialize stem state when audio nodes are created
  useEffect(() => {
    if (stemNodes.size === 0) return;

    const config = getConfig();
    const newStems: Record<string, StemState> = {};
    const order: string[] = [];

    stemNodes.forEach((node, name) => {
      const savedGain = config.stemGains[name];
      const loadedStem = loadedStems.get(name);
      const waveformUrl = loadedStem?.metadata?.waveform_url
        ? metadataBaseUrl + loadedStem.metadata.waveform_url
        : '';

      newStems[name] = {
        gain: savedGain !== undefined ? savedGain : node.initialGain,
        muted: config.stemMutes[name] || false,
        soloed: config.stemSolos[name] || false,
        initialGain: node.initialGain,
        waveformUrl,
      };
      order.push(name);
    });

    order.sort((a, b) => a.localeCompare(b));

    setStems(newStems);
    setStemOrder(order);
  }, [stemNodes, metadataBaseUrl, loadedStems, getConfig]);

  // 6. Apply stem state to audio nodes (reactive!)
  useEffect(() => {
    if (stemNodes.size === 0) return;

    const hasSolo = Object.values(stems).some(s => s.soloed);

    stemNodes.forEach((node, name) => {
      const state = stems[name];
      if (!state) return;

      // Apply gain
      node.gainNode.gain.value = state.gain;

      // Apply audibility (mute/solo logic)
      let audible = true;
      if (hasSolo) {
        audible = state.soloed;
      } else {
        audible = !state.muted;
      }
      node.outputGainNode.gain.value = audible ? 1 : 0;
    });
  }, [stems, stemNodes]);

  // 7. Audio effects
  const config = getConfig();
  const { eq, compressor, reverb, stereoExpander } = useAudioEffects({
    audioContext,
    masterInput,
    initialConfig: {
      eqConfig: config.eqConfig,
      compressorConfig: config.compressorConfig,
      reverbConfig: config.reverbConfig,
      stereoExpanderConfig: config.stereoExpanderConfig,
    },
  });

  // 8. Playback control
  const loadedStemsForPlayback = useMemo(() => {
    const map = new Map();
    stemNodes.forEach((node, name) => {
      map.set(name, {
        buffer: node.buffer,
        gain: node.gainNode,
        outputGain: node.outputGainNode,
        initialGain: node.initialGain,
        metadata: null,
        muted: stems[name]?.muted || false,
        soloed: stems[name]?.soloed || false,
      });
    });
    return map;
  }, [stemNodes, stems]);

  const { isPlaying, currentTime, play, pause, stop, seek, formatTime } = usePlaybackController({
    audioContext,
    duration,
    loadedStems: loadedStemsForPlayback,
  });

  // 9. Persist playback position
  useEffect(() => {
    if (!isLoading) {
      savePlaybackPosition(currentTime);
    }
  }, [currentTime, isLoading, savePlaybackPosition]);

  // 10. Persist stem state
  useEffect(() => {
    if (!isLoading && Object.keys(stems).length > 0) {
      const stemGains: Record<string, number> = {};
      const stemMutes: Record<string, boolean> = {};
      const stemSolos: Record<string, boolean> = {};

      Object.entries(stems).forEach(([name, state]) => {
        stemGains[name] = state.gain;
        stemMutes[name] = state.muted;
        stemSolos[name] = state.soloed;
      });

      saveStemConfig(stemGains, stemMutes, stemSolos);
    }
  }, [stems, isLoading, saveStemConfig]);

  // 11. Persist effects config
  useEffect(() => {
    if (!isLoading) {
      saveEffectsConfig({
        eqConfig: eq.config,
        compressorConfig: compressor.config,
        reverbConfig: reverb.config,
        stereoExpanderConfig: stereoExpander.config,
      });
    }
  }, [
    eq.config,
    compressor.config,
    reverb.config,
    stereoExpander.config,
    isLoading,
    saveEffectsConfig,
  ]);

  // Stem control actions
  const setStemGain = useCallback((stemName: string, gain: number) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], gain: Math.max(0, Math.min(gain, 2)) },
    }));
  }, []);

  const resetStemGain = useCallback((stemName: string) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], gain: prev[stemName].initialGain },
    }));
  }, []);

  const toggleMute = useCallback((stemName: string) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], muted: !prev[stemName].muted },
    }));
  }, []);

  const toggleSolo = useCallback((stemName: string) => {
    setStems(prev => ({
      ...prev,
      [stemName]: { ...prev[stemName], soloed: !prev[stemName].soloed },
    }));
  }, []);

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
    stemOrder,

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

    // Effects
    eqConfig: eq.config,
    compressorConfig: compressor.config,
    reverbConfig: reverb.config,
    stereoExpanderConfig: stereoExpander.config,
    updateEqBand: eq.updateBand,
    setEqEnabled: eq.setEnabled,
    resetEq: eq.reset,
    updateCompressor: compressor.update,
    setCompressorEnabled: compressor.setEnabled,
    resetCompressor: compressor.reset,
    updateReverb: reverb.update,
    setReverbEnabled: reverb.setEnabled,
    resetReverb: reverb.reset,
    updateStereoExpander: stereoExpander.update,
    setStereoExpanderEnabled: stereoExpander.setEnabled,
    resetStereoExpander: stereoExpander.reset,
    compressorGainReduction: compressor.gainReduction,
  };
}
