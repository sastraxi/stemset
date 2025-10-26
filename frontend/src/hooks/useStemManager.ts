import { useState, useRef, useCallback, useEffect } from 'react';
import type { StemMetadata } from '../types';
import type { LoadedStemData } from './useAudioLoader';

export interface LoadedStem {
  buffer: AudioBuffer;
  gain: GainNode; // persistent gain node for volume control
  outputGain: GainNode; // final output gain node (handles mute/solo logic)
  initialGain: number; // derived from metadata
  metadata: StemMetadata | null;
  muted: boolean; // mute state
  soloed: boolean; // solo state
}

export interface StemStateEntry {
  name: string;
  gain: number; // current linear gain for UI
  initialGain: number;
  waveformUrl: string | null;
  muted: boolean;
  soloed: boolean;
}

export interface UseStemManagerOptions {
  audioContext: AudioContext | null;
  masterInput: GainNode | null;
  stems: Map<string, LoadedStemData>;
  metadataBaseUrl: string;
  savedState: {
    stemGains: Record<string, number>;
    stemMutes: Record<string, boolean>;
    stemSolos: Record<string, boolean>;
  };
}

export interface UseStemManagerResult {
  // State (for UI)
  stems: StemStateEntry[];
  stemsLength: number; // Primitive for stable dependencies

  // Actions
  setStemGain: (stemName: string, gain: number) => void;
  resetStemGain: (stemName: string) => void;
  toggleMute: (stemName: string) => void;
  toggleSolo: (stemName: string) => void;

  // Utils
  getLoadedStems: () => Map<string, LoadedStem>;
  getStemGainNodes: () => Map<string, GainNode>;
  getCurrentState: () => {
    stemGains: Record<string, number>;
    stemMutes: Record<string, boolean>;
    stemSolos: Record<string, boolean>;
  };
}

/**
 * Manages individual stem state and audio graph connections.
 *
 * Responsibilities:
 * - Create GainNodes for each stem (volume + audibility)
 * - Audio graph: stem.buffer → stem.gain → stem.outputGain → masterInput
 * - Mute/solo logic (solo overrides mute)
 * - Restore saved state from localStorage
 * - Calculate audibility: solo > mute
 *
 * Pattern: Primitive dependency (stemsLength) instead of Map reference.
 * Separate state (UI-triggering) from actions (stable callbacks).
 * All audio nodes in refs, not state.
 */
export function useStemManager({
  audioContext,
  masterInput,
  stems,
  metadataBaseUrl,
  savedState,
}: UseStemManagerOptions): UseStemManagerResult {
  const loadedStemsRef = useRef<Map<string, LoadedStem>>(new Map());
  const [stemState, setStemState] = useState<StemStateEntry[]>([]);
  const [soloedStems, setSoloedStems] = useState<Set<string>>(new Set());

  // Primitive dependencies for stable effect triggers
  const stemsLength = stems.size;
  const soloedStemsSize = soloedStems.size;

  // Build stems when audioContext, masterInput, or source stems change
  useEffect(() => {
    if (!audioContext || !masterInput || stems.size === 0) {
      return;
    }

    // Clear previous stems
    loadedStemsRef.current.forEach(stem => {
      try {
        stem.gain.disconnect();
        stem.outputGain.disconnect();
      } catch {
        // Already disconnected
      }
    });
    loadedStemsRef.current.clear();

    const newMap = new Map<string, LoadedStem>();

    stems.forEach((stemData, name) => {
      const { buffer, metadata } = stemData;

      // Calculate initial gain from metadata
      let initialGain = 1;
      if (metadata && typeof metadata.stem_gain_adjustment_db === 'number') {
        initialGain = Math.pow(10, metadata.stem_gain_adjustment_db / 20);
      }

      // Create gain nodes
      const gainNode = audioContext.createGain();
      const outputGainNode = audioContext.createGain();

      // Apply saved gain or use initial gain
      const savedGain = savedState.stemGains[name];
      gainNode.gain.value = savedGain !== undefined ? savedGain : initialGain;
      outputGainNode.gain.value = 1;

      // Connect audio graph: gain → outputGain → masterInput
      gainNode.connect(outputGainNode);
      outputGainNode.connect(masterInput);

      // Restore mute/solo state
      const muted = savedState.stemMutes[name] || false;
      const soloed = savedState.stemSolos[name] || false;

      newMap.set(name, {
        buffer,
        gain: gainNode,
        outputGain: outputGainNode,
        initialGain,
        metadata,
        muted,
        soloed,
      });

      // Track soloed stems
      if (soloed) {
        setSoloedStems(prev => new Set(prev).add(name));
      }
    });

    loadedStemsRef.current = newMap;

    // Apply mute/solo audibility from saved state
    updateAudibility();

    // Build initial UI state
    updateStemState();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext, masterInput, stemsLength]);

  // Update audibility when solo state changes
  useEffect(() => {
    updateAudibility();
    updateStemState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloedStemsSize]);

  const updateAudibility = useCallback(() => {
    const hasSoloedStems = soloedStems.size > 0;

    loadedStemsRef.current.forEach((stem, stemName) => {
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
    });
  }, [soloedStems]);

  const updateStemState = useCallback(() => {
    const stemArray = Array.from(loadedStemsRef.current.entries()).map(([name, s]) => ({
      name,
      gain: s.gain.gain.value,
      initialGain: s.initialGain,
      waveformUrl: s.metadata ? metadataBaseUrl + s.metadata.waveform_url : null,
      muted: s.muted,
      soloed: s.soloed,
    }));

    stemArray.sort((a, b) => a.name.localeCompare(b.name));
    setStemState(stemArray);
  }, [metadataBaseUrl]);

  const setStemGain = useCallback((stemName: string, gain: number) => {
    const stem = loadedStemsRef.current.get(stemName);
    if (!stem) return;

    // Clamp gain to reasonable range (0 - 2)
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

  const toggleMute = useCallback((stemName: string) => {
    const stem = loadedStemsRef.current.get(stemName);
    if (!stem) return;

    stem.muted = !stem.muted;
    updateAudibility();
    updateStemState();
  }, [updateAudibility, updateStemState]);

  const toggleSolo = useCallback((stemName: string) => {
    const stem = loadedStemsRef.current.get(stemName);
    if (!stem) return;

    stem.soloed = !stem.soloed;

    setSoloedStems(prev => {
      const newSet = new Set(prev);
      if (stem.soloed) {
        newSet.add(stemName);
      } else {
        newSet.delete(stemName);
      }
      return newSet;
    });
  }, []);

  const getLoadedStems = useCallback(() => {
    return loadedStemsRef.current;
  }, []);

  const getStemGainNodes = useCallback(() => {
    const map = new Map<string, GainNode>();
    loadedStemsRef.current.forEach((stem, name) => {
      map.set(name, stem.gain);
    });
    return map;
  }, []);

  const getCurrentState = useCallback(() => {
    const stemGains: Record<string, number> = {};
    const stemMutes: Record<string, boolean> = {};
    const stemSolos: Record<string, boolean> = {};

    loadedStemsRef.current.forEach((stem, name) => {
      stemGains[name] = stem.gain.gain.value;
      stemMutes[name] = stem.muted;
      stemSolos[name] = stem.soloed;
    });

    return { stemGains, stemMutes, stemSolos };
  }, []);

  return {
    // State
    stems: stemState,
    stemsLength,

    // Actions
    setStemGain,
    resetStemGain,
    toggleMute,
    toggleSolo,

    // Utils
    getLoadedStems,
    getStemGainNodes,
    getCurrentState,
  };
}
