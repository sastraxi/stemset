/**
 * Shared audio library for stem players.
 *
 * Provides composable hooks for building audio players with effects processing.
 * Used by both StemPlayer (full-featured) and ClipPlayer (simplified).
 */

// Core audio hooks
export { useAudioContext } from "./core/useAudioContext";
export type {
  UseAudioContextOptions,
  UseAudioContextResult,
} from "./core/useAudioContext";

export { useAudioBufferLoader } from "./core/useAudioBufferLoader";
export type {
  UseAudioBufferLoaderOptions,
  UseAudioBufferLoaderResult,
} from "./core/useAudioBufferLoader";

export { usePlaybackEngine } from "./core/usePlaybackEngine";
export type {
  UsePlaybackEngineOptions,
  UsePlaybackEngineResult,
} from "./core/usePlaybackEngine";

export { useReadOnlyRecordingConfig } from "./core/useReadOnlyRecordingConfig";
export type { UseReadOnlyRecordingConfigResult } from "./core/useReadOnlyRecordingConfig";

// Effects hooks
export { useStemAudioGraph } from "./effects/useStemAudioGraph";
export type {
  UseStemAudioGraphOptions,
  UseStemAudioGraphResult,
} from "./effects/useStemAudioGraph";

// Master effects - re-export from existing hooks
// These already handle persistence correctly
export { useAudioEffects } from "../../hooks/useAudioEffects";
export type {
  UseAudioEffectsOptions,
  UseAudioEffectsResult,
} from "../../hooks/useAudioEffects";

// Types
export type {
  StemCompressionLevel,
  StemEqLevel,
  StemUserConfig,
  StemAudioNodes,
  LoadedStem,
  PlaybackNode,
  LoadingMetrics,
} from "./types";
