/**
 * Shared audio types for stem player audio processing
 */

// Stem compression levels
export type StemCompressionLevel = "off" | "low" | "medium" | "high";

// Stem EQ levels (per-band)
export type StemEqLevel = "off" | "low" | "medium" | "high";

// User-configurable stem settings (persisted in recording config)
export interface StemUserConfig {
  gain?: number;
  muted?: boolean;
  soloed?: boolean;
  compression?: StemCompressionLevel;
  eqLow?: StemEqLevel;
  eqMid?: StemEqLevel;
  eqHigh?: StemEqLevel;
}

// Audio nodes for a single stem
export interface StemAudioNodes {
  gainNode: GainNode;
  eqLowNode: BiquadFilterNode;
  eqMidNode: BiquadFilterNode;
  eqHighNode: BiquadFilterNode;
  compressorNode: DynamicsCompressorNode;
  outputGainNode: GainNode;
  initialGain: number;
}

// Loaded stem with audio buffer and metadata
export interface LoadedStem {
  buffer: AudioBuffer;
  metadata?: {
    stem_type: string;
    waveform_url: string;
  };
}

// Playback node interface (for usePlaybackEngine)
export interface PlaybackNode {
  buffer: AudioBuffer;
  entryPoint: AudioNode; // First node in the audio chain to connect source to
}

// Loading metrics
export interface LoadingMetrics {
  totalFetchTimeMs: number;
  totalDecodeTimeMs: number;
  totalBytes: number;
  stems: Array<{
    name: string;
    fetchTimeMs: number;
    decodeTimeMs: number;
    bytes: number;
  }>;
}
