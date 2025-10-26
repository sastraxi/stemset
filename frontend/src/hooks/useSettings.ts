import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getMasterEq,
  setMasterEq,
  getMasterLimiter,
  setMasterLimiter,
  getMasterEqEnabled,
  setMasterEqEnabled,
  getRecordingState,
  updateRecordingState,
  type MasterEqSettings,
  type MasterLimiterSettings,
} from '../lib/storage';

// EQ Band representation
export interface EqBand {
  id: string;
  frequency: number; // center Hz
  type: BiquadFilterType;
  gain: number; // dB
  q: number; // Q factor
}

// Limiter settings
export interface LimiterSettings {
  thresholdDb: number;
  release: number;
  enabled: boolean;
}

export interface UseSettingsOptions {
  profileName: string;
  fileName: string;
}

export interface UseSettingsResult {
  // Master settings (global)
  eqBands: EqBand[];
  updateEqBand: (id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => void;
  resetEq: () => void;
  limiter: LimiterSettings;
  updateLimiter: (changes: Partial<LimiterSettings>) => void;
  resetLimiter: () => void;
  eqEnabled: boolean;
  setEqEnabled: (enabled: boolean) => void;

  // Per-recording settings
  getSavedRecordingState: () => {
    playbackPosition: number;
    stemGains: Record<string, number>;
    stemMutes: Record<string, boolean>;
    stemSolos: Record<string, boolean>;
  };
  persistPlaybackPosition: (position: number) => void;
  persistStemSettings: (
    stemGains: Record<string, number>,
    stemMutes: Record<string, boolean>,
    stemSolos: Record<string, boolean>
  ) => void;
}

/**
 * Manages localStorage persistence for all player settings.
 *
 * Responsibilities:
 * - Master settings (EQ bands, limiter, EQ enabled) - global across recordings
 * - Per-recording settings (playback position, stem gains, stem mutes, stem solos)
 * - Debounced writes to prevent excessive localStorage operations
 * - Default value management and initialization
 *
 * Pattern: useState for UI-triggering values, useEffect with debounce for persistence.
 * Separate master (global) from per-recording (profile::file) state.
 */
export function useSettings({
  profileName,
  fileName,
}: UseSettingsOptions): UseSettingsResult {
  // Default values
  const defaultEqBands: EqBand[] = [
    { id: 'low', frequency: 80, type: 'lowshelf', gain: 0, q: 1 },
    { id: 'lowmid', frequency: 250, type: 'peaking', gain: 0, q: 1 },
    { id: 'mid', frequency: 1000, type: 'peaking', gain: 0, q: 1 },
    { id: 'highmid', frequency: 3500, type: 'peaking', gain: 0, q: 1 },
    { id: 'high', frequency: 10000, type: 'highshelf', gain: 0, q: 1 },
  ];

  const defaultLimiter: LimiterSettings = {
    thresholdDb: -6,
    release: 0.12,
    enabled: true,
  };

  // Master settings state (global)
  const [eqBands, setEqBands] = useState<EqBand[]>(() => {
    return getMasterEq(defaultEqBands as MasterEqSettings[]) as EqBand[];
  });

  const [limiter, setLimiter] = useState<LimiterSettings>(() => {
    const savedLimiter = getMasterLimiter(defaultLimiter as MasterLimiterSettings);
    return {
      ...defaultLimiter,
      ...savedLimiter,
    } as LimiterSettings;
  });

  const [eqEnabled, setEqEnabledState] = useState<boolean>(() => {
    return getMasterEqEnabled(true);
  });

  // Debounce timers
  const eqDebounceRef = useRef<number | null>(null);
  const limiterDebounceRef = useRef<number | null>(null);
  const eqEnabledDebounceRef = useRef<number | null>(null);
  const playbackPositionDebounceRef = useRef<number | null>(null);
  const stemSettingsDebounceRef = useRef<number | null>(null);

  // Persist master EQ settings (debounced)
  useEffect(() => {
    if (eqDebounceRef.current) clearTimeout(eqDebounceRef.current);
    eqDebounceRef.current = window.setTimeout(() => {
      setMasterEq(eqBands as MasterEqSettings[]);
    }, 300);

    return () => {
      if (eqDebounceRef.current) clearTimeout(eqDebounceRef.current);
    };
  }, [eqBands]);

  // Persist master limiter settings (debounced)
  useEffect(() => {
    if (limiterDebounceRef.current) clearTimeout(limiterDebounceRef.current);
    limiterDebounceRef.current = window.setTimeout(() => {
      setMasterLimiter(limiter as MasterLimiterSettings);
    }, 300);

    return () => {
      if (limiterDebounceRef.current) clearTimeout(limiterDebounceRef.current);
    };
  }, [limiter]);

  // Persist EQ enabled state (debounced)
  useEffect(() => {
    if (eqEnabledDebounceRef.current) clearTimeout(eqEnabledDebounceRef.current);
    eqEnabledDebounceRef.current = window.setTimeout(() => {
      setMasterEqEnabled(eqEnabled);
    }, 300);

    return () => {
      if (eqEnabledDebounceRef.current) clearTimeout(eqEnabledDebounceRef.current);
    };
  }, [eqEnabled]);

  // EQ management
  const updateEqBand = useCallback((id: string, changes: Partial<Pick<EqBand, 'gain' | 'frequency' | 'q' | 'type'>>) => {
    setEqBands(prev => prev.map(b => b.id === id ? { ...b, ...changes } : b));
  }, []);

  const resetEq = useCallback(() => {
    setEqBands(defaultEqBands);
  }, []);

  // Limiter management
  const updateLimiter = useCallback((changes: Partial<LimiterSettings>) => {
    setLimiter(prev => ({ ...prev, ...changes }));
  }, []);

  const resetLimiter = useCallback(() => {
    setLimiter(defaultLimiter);
  }, []);

  const setEqEnabled = useCallback((enabled: boolean) => {
    setEqEnabledState(enabled);
  }, []);

  // Per-recording state getters and setters
  const getSavedRecordingState = useCallback(() => {
    const saved = getRecordingState(profileName, fileName);
    return {
      playbackPosition: saved?.playbackPosition || 0,
      stemGains: saved?.stemGains || {},
      stemMutes: saved?.stemMutes || {},
      stemSolos: saved?.stemSolos || {},
    };
  }, [profileName, fileName]);

  const persistPlaybackPosition = useCallback((position: number) => {
    if (playbackPositionDebounceRef.current) {
      clearTimeout(playbackPositionDebounceRef.current);
    }
    playbackPositionDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { playbackPosition: position });
    }, 1000);
  }, [profileName, fileName]);

  const persistStemSettings = useCallback((
    stemGains: Record<string, number>,
    stemMutes: Record<string, boolean>,
    stemSolos: Record<string, boolean>
  ) => {
    if (stemSettingsDebounceRef.current) {
      clearTimeout(stemSettingsDebounceRef.current);
    }
    stemSettingsDebounceRef.current = window.setTimeout(() => {
      updateRecordingState(profileName, fileName, { stemGains, stemMutes, stemSolos });
    }, 500);
  }, [profileName, fileName]);

  return {
    // Master settings
    eqBands,
    updateEqBand,
    resetEq,
    limiter,
    updateLimiter,
    resetLimiter,
    eqEnabled,
    setEqEnabled,
    // Per-recording settings
    getSavedRecordingState,
    persistPlaybackPosition,
    persistStemSettings,
  };
}
