import React, { createContext, useContext, useMemo, useState } from "react";
import type { StemResponse } from "../../../api/generated/types.gen";
import {
  useStemPlayer,
  type UseStemPlayerResult,
} from "../../../hooks/useStemPlayer";
import { FullRuler } from "../rulers/FullRuler";
import { SplitWaveforms } from "../waveforms/SplitWaveforms";
import type { RangeSelectionContext } from "../canvas/useCanvasInteraction";

export interface UseRecordingPlayerOptions {
  profileName: string;
  fileName: string;
  stemsData: StemResponse[];
  recordingId: string;
  sampleRate?: number;
  startTimeSec?: number;
  endTimeSec?: number;
  disablePositionPersistence?: boolean;
  rangeSelection?: RangeSelectionContext | null;
}

export interface RecordingPlayerAPI extends UseStemPlayerResult {
  // Preview time for scrubbing
  previewTime: number | null;
  setPreviewTime: (time: number | null) => void;

  // Components
  Ruler: React.FC<RulerComponentProps>;
  Waveforms: React.FC<WaveformsComponentProps>;
}

interface RulerComponentProps {
  variant?: "full";
  height?: number;
  className?: string;
}

interface WaveformsComponentProps {
  mode?: "split";
  className?: string;
  renderStemControls?: (stemType: string) => React.ReactNode;
}

// Context for sharing player state with components
const RecordingPlayerContext = createContext<RecordingPlayerAPI | null>(null);

/**
 * Factory hook for full recording player (DAW interface)
 * Returns both state/actions and pre-wired components
 */
export function useRecordingPlayer(
  options: UseRecordingPlayerOptions,
): RecordingPlayerAPI {
  const playerState = useStemPlayer({
    profileName: options.profileName,
    fileName: options.fileName,
    stemsData: options.stemsData,
    recordingId: options.recordingId,
    sampleRate: options.sampleRate,
    startTimeSec: options.startTimeSec,
    endTimeSec: options.endTimeSec,
    disablePositionPersistence: options.disablePositionPersistence,
  });

  const [previewTime, setPreviewTime] = useState<number | null>(null);

  // Memoize components to avoid recreating them
  const Ruler: React.FC<RulerComponentProps> = useMemo(
    () =>
      ({ height, className }) => {
        const player = useContext(RecordingPlayerContext);
        if (!player)
          throw new Error("Ruler must be used within RecordingPlayer context");

        return (
          <FullRuler
            currentTime={player.currentTime}
            duration={player.duration}
            previewTime={player.previewTime ?? undefined}
            onSeek={player.seek}
            onPreview={player.setPreviewTime}
            rangeSelection={options.rangeSelection}
            height={height}
            className={className}
          />
        );
      },
    [options.rangeSelection],
  );

  const Waveforms: React.FC<WaveformsComponentProps> = useMemo(
    () =>
      ({ mode = "split", className, renderStemControls }) => {
        const player = useContext(RecordingPlayerContext);
        if (!player)
          throw new Error(
            "Waveforms must be used within RecordingPlayer context",
          );

        // Build stem waveform data from player state
        const stemWaveforms = player.stemOrder.map((stemName) => {
          const stem = player.stems[stemName];
          return {
            stemType: stemName,
            waveformUrl: stem.waveformUrl,
          };
        });

        if (mode === "split") {
          return (
            <SplitWaveforms
              stems={stemWaveforms}
              currentTime={player.currentTime}
              duration={player.duration}
              previewTime={player.previewTime ?? undefined}
              onSeek={player.seek}
              onPreview={player.setPreviewTime}
              startTimeSec={options.startTimeSec}
              endTimeSec={options.endTimeSec}
              fullDuration={player.fullDuration}
              className={className}
              renderStemControls={renderStemControls}
            />
          );
        }

        return null;
      },
    [options.startTimeSec, options.endTimeSec],
  );

  const api: RecordingPlayerAPI = {
    ...playerState,
    previewTime,
    setPreviewTime,
    Ruler,
    Waveforms,
  };

  return api;
}

/**
 * Provider component to make player state available to child components
 * Usage:
 * const player = useRecordingPlayer(options);
 * return (
 *   <RecordingPlayerProvider player={player}>
 *     <player.Ruler />
 *     <player.Waveforms />
 *   </RecordingPlayerProvider>
 * );
 */
export function RecordingPlayerProvider({
  player,
  children,
}: {
  player: RecordingPlayerAPI;
  children: React.ReactNode;
}) {
  return (
    <RecordingPlayerContext.Provider value={player}>
      {children}
    </RecordingPlayerContext.Provider>
  );
}
