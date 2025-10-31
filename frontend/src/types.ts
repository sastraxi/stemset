// ============================================================================
// API / Server Metadata Types (immutable, from backend)
// ============================================================================

export interface Profile {
  name: string;
  source_folder: string;
}

export interface StemFile {
  id: string;  // recording UUID
  name: string;
  display_name: string;
  stems: StemResponse[];
  created_at: string;
}

export interface StemResponse {
  stem_type: string;
  measured_lufs: number;
  peak_amplitude: number;
  stem_gain_adjustment_db: number;
  audio_url: string;
  waveform_url: string;
  file_size_bytes: number;
  duration_seconds: number;
}

export interface StemFileWithDisplayName extends StemFile {
  displayName: string; // Computed from display_name or defaults to name
}

export interface StemMetadata {
  stem_type: string;
  measured_lufs: number | null;
  peak_amplitude: number;
  stem_gain_adjustment_db: number;
  stem_url: string;  // Relative URL to audio file
  waveform_url: string;  // Relative URL to waveform PNG
}

export interface StemsMetadata {
  stems: Record<string, StemMetadata>;
  display_name: string;
}

// ============================================================================
// Audio Layer Types (Web Audio API, derived from metadata)
// ============================================================================

export interface StemAudioData {
  buffer: AudioBuffer;
  metadata: StemMetadata;
}

export interface StemAudioNode {
  buffer: AudioBuffer;
  gainNode: GainNode;
  outputGainNode: GainNode;
  initialGain: number;  // Computed from metadata.stem_gain_adjustment_db
}

// ============================================================================
// User Config Types (mutable, persisted to localStorage)
// ============================================================================

export interface StemUserConfig {
  gain: number;      // Volume slider value (0-2)
  muted: boolean;    // Mute button state
  soloed: boolean;   // Solo button state
}

export interface EffectsChainConfig {
  eq: import('./hooks/effects/useEqEffect').EqConfig;
  compressor: import('./hooks/effects/useCompressorEffect').CompressorConfig;
  reverb: import('./hooks/effects/useReverbEffect').ReverbConfig;
  stereoExpander: import('./hooks/effects/useStereoExpanderEffect').StereoExpanderConfig;
  // Future: order: Array<'eq' | 'compressor' | 'reverb' | 'stereoExpander'>;
}

export interface RecordingUserConfig {
  playbackPosition: number;
  stems: Record<string, StemUserConfig>;
  effects: EffectsChainConfig;
}

// ============================================================================
// View Model Types (UI layer, combines metadata + user config)
// ============================================================================

export interface StemViewModel {
  // Identity
  name: string;

  // From metadata (immutable)
  stemType: string;
  waveformUrl: string;
  initialGain: number;

  // From user config (mutable)
  gain: number;
  muted: boolean;
  soloed: boolean;
}
