import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { StemResponse } from "../../../api/generated/types.gen";
import {
  useAudioContext,
  useAudioBufferLoader,
  usePlaybackEngine,
  useStemAudioGraph,
  useReadOnlyRecordingConfig,
  useAudioEffects,
  type PlaybackNode,
} from "../../audio";
import { MinimalRuler } from "../rulers/MinimalRuler";
import { CompositeWaveform } from "../waveforms/CompositeWaveform";

export interface ClipData {
  id: string;
  recordingId: string; // NEW: Required for loading saved config
  stems: StemResponse[];
  startTimeSec: number;
  endTimeSec: number;
}

export interface UseClipPlayerOptions {
  clip: ClipData;
}

export interface StemState {
  stemType: string;
  isMuted: boolean;
}

export interface ClipPlayerAPI {
  // Playback state
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  previewTime: number | null;

  // Playback controls
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setPreviewTime: (time: number | null) => void;

  // Stem controls
  stems: StemState[];
  toggleStemMute: (stemType: string) => void;

  // Components
  Waveform: React.FC<WaveformComponentProps>;
  Ruler: React.FC<RulerComponentProps>;
  Controls: React.FC<ControlsComponentProps>;
}

interface WaveformComponentProps {
  mode?: "composite";
  height?: number;
  className?: string;
  showBackground?: boolean;
}

interface RulerComponentProps {
  variant?: "minimal";
  height?: number;
  className?: string;
}

interface ControlsComponentProps {
  compact?: boolean;
  className?: string;
}

// Context for sharing player state with components
const ClipPlayerContext = createContext<ClipPlayerAPI | null>(null);

/**
 * Factory hook for clip player (inline playback).
 *
 * NEW ARCHITECTURE:
 * - Uses shared audio library hooks
 * - Applies saved recording configuration (compression, EQ, master effects)
 * - Supports temporary local mutes (non-persisted)
 * - Matches audio quality from StemPlayer
 *
 * Returns both state/actions and pre-wired components.
 */
export function useClipPlayer({ clip }: UseClipPlayerOptions): ClipPlayerAPI {
  const clipDuration = clip.endTimeSec - clip.startTimeSec;

  // 1. Audio context (dedicated per player, as per user preference)
  const { getContext, getMasterInput, getMasterOutput } = useAudioContext({
    sampleRate: 44100,
  });
  const audioContext = getContext();
  const masterInput = getMasterInput();
  const masterOutput = getMasterOutput();

  // 2. Load saved recording config (read-only, no persistence)
  const { stemConfig, isLoading: isLoadingConfig } =
    useReadOnlyRecordingConfig(clip.recordingId);

  // 3. Load audio buffers
  const {
    isLoading: isLoadingBuffers,
    buffers,
    duration: fullDuration,
  } = useAudioBufferLoader({
    stems: clip.stems,
    audioContext,
    trackMetrics: false, // ClipPlayer doesn't need detailed metrics
  });

  // 4. Local mute state (temporary, non-persisted)
  const [localMutes, setLocalMutes] = useState<Record<string, boolean>>({});

  // 5. Create stem audio graphs with saved config + local mutes
  const { stemNodes } = useStemAudioGraph({
    audioContext,
    masterInput,
    buffers,
    config: stemConfig,
    localMutes,
  });

  // 6. Master effects (uses saved recording config)
  useAudioEffects({
    audioContext,
    masterInput,
    masterOutput,
    recordingId: clip.recordingId,
  });

  // 7. Prepare playback nodes
  const playbackNodes = useMemo((): Map<string, PlaybackNode> => {
    const nodes = new Map<string, PlaybackNode>();
    stemNodes.forEach((node, name) => {
      const loadedStem = buffers.get(name);
      if (loadedStem) {
        nodes.set(name, {
          buffer: loadedStem.buffer,
          entryPoint: node.gainNode, // Source connects to first node in effects chain
        });
      }
    });
    return nodes;
  }, [stemNodes, buffers]);

  // 8. Preview state for cursor visualization while dragging
  const [previewTime, setPreviewTime] = useState<number | null>(null);

  // 9. Playback engine
  const { isPlaying, currentTime, play, pause, seek } = usePlaybackEngine({
    audioContext,
    duration: clipDuration,
    nodes: playbackNodes,
    initialPosition: 0,
    startOffset: clip.startTimeSec, // Offset into the audio buffer
  });

  // 10. Stem controls
  const toggleStemMute = useCallback((stemType: string) => {
    setLocalMutes((prev) => ({
      ...prev,
      [stemType]: !prev[stemType],
    }));
  }, []);

  const stems: StemState[] = useMemo(
    () =>
      clip.stems.map((stem) => ({
        stemType: stem.stem_type,
        isMuted: localMutes[stem.stem_type] || false,
      })),
    [clip.stems, localMutes],
  );

  // 11. Memoize waveform data to prevent re-renders
  const stemWaveforms = useMemo(
    () =>
      clip.stems.map((stem) => ({
        stemType: stem.stem_type,
        waveformUrl: stem.waveform_url,
      })),
    [clip.stems],
  );

  // 12. Components
  const Waveform: React.FC<WaveformComponentProps> = useMemo(
    () =>
      ({ mode = "composite", height, className, showBackground = true }) => {
        const player = useContext(ClipPlayerContext);
        if (!player)
          throw new Error("Waveform must be used within ClipPlayer context");

        if (mode === "composite") {
          return (
            <CompositeWaveform
              stems={stemWaveforms}
              currentTime={player.currentTime}
              duration={clipDuration}
              previewTime={player.previewTime ?? undefined}
              startTimeSec={clip.startTimeSec}
              endTimeSec={clip.endTimeSec}
              fullDuration={fullDuration}
              height={height}
              className={className}
              showBackground={showBackground}
              onSeek={player.seek}
              onPreview={player.setPreviewTime}
              cursorStyle="retrofunk"
            />
          );
        }

        return null;
      },
    [stemWaveforms, clipDuration, clip.startTimeSec, clip.endTimeSec, fullDuration],
  );

  const Ruler: React.FC<RulerComponentProps> = useMemo(
    () =>
      ({ variant = "minimal", height, className }) => {
        const player = useContext(ClipPlayerContext);
        if (!player)
          throw new Error("Ruler must be used within ClipPlayer context");

        if (variant === "minimal") {
          return (
            <MinimalRuler
              currentTime={player.currentTime}
              duration={clipDuration}
              height={height}
              className={className}
              onSeek={player.seek}
              onPreview={player.setPreviewTime}
              previewTime={player.previewTime ?? undefined}
            />
          );
        }

        return null;
      },
    [clipDuration],
  );

  const Controls: React.FC<ControlsComponentProps> = useMemo(
    () =>
      ({ compact, className }) => {
        const player = useContext(ClipPlayerContext);
        if (!player)
          throw new Error("Controls must be used within ClipPlayer context");

        return (
          <div
            className={`clip-controls ${compact ? "compact" : ""} ${className || ""}`}
          >
            <button
              type="button"
              onClick={player.isPlaying ? player.pause : () => player.play()}
              disabled={player.isLoading}
            >
              {player.isPlaying ? "Pause" : "Play"}
            </button>
            {player.stems.map((stem) => (
              <button
                key={stem.stemType}
                type="button"
                onClick={() => player.toggleStemMute(stem.stemType)}
                className={stem.isMuted ? "muted" : ""}
              >
                {stem.stemType}
              </button>
            ))}
          </div>
        );
      },
    [],
  );

  const isLoading = isLoadingConfig || isLoadingBuffers;

  const api: ClipPlayerAPI = {
    isPlaying,
    isLoading,
    currentTime,
    duration: clipDuration,
    previewTime,
    play,
    pause,
    seek,
    setPreviewTime,
    stems,
    toggleStemMute,
    Waveform,
    Ruler,
    Controls,
  };

  return api;
}

/**
 * Provider component to make player state available to child components
 */
export function ClipPlayerProvider({
  player,
  children,
}: {
  player: ClipPlayerAPI;
  children: React.ReactNode;
}) {
  return (
    <ClipPlayerContext.Provider value={player}>
      {children}
    </ClipPlayerContext.Provider>
  );
}
