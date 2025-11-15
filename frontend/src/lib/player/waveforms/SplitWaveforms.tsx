import { WaveformVisualization } from "../../../components/WaveformVisualization";
import type { RangeSelectionContext } from "../canvas/useCanvasInteraction";

export interface StemWaveformData {
  stemType: string;
  waveformUrl: string;
}

export interface SplitWaveformsProps {
  stems: StemWaveformData[];
  currentTime: number;
  duration: number;
  previewTime?: number;
  onSeek?: (time: number) => void;
  onPreview?: (time: number | null) => void;
  rangeSelection?: RangeSelectionContext | null;
  startTimeSec?: number;
  endTimeSec?: number;
  fullDuration?: number;
  className?: string;
  renderStemControls?: (stemType: string) => React.ReactNode;
}

/**
 * SplitWaveforms - Renders each stem in its own row with individual waveforms
 * Allows for per-stem controls and independent visualization
 */
export function SplitWaveforms({
  stems,
  currentTime,
  duration,
  previewTime,
  onSeek,
  onPreview,
  startTimeSec,
  endTimeSec,
  fullDuration,
  className = "",
  renderStemControls,
}: SplitWaveformsProps) {
  return (
    <div className={`split-waveforms ${className}`}>
      {stems.map((stem) => (
        <div key={stem.stemType} className="waveform-row">
          {renderStemControls && (
            <div className="waveform-controls">
              {renderStemControls(stem.stemType)}
            </div>
          )}
          <WaveformVisualization
            waveformUrl={stem.waveformUrl}
            stemName={stem.stemType}
            currentTime={currentTime}
            duration={duration}
            previewTime={previewTime}
            onSeek={onSeek}
            onPreview={onPreview}
            startTimeSec={startTimeSec}
            endTimeSec={endTimeSec}
            fullDuration={fullDuration}
          />
        </div>
      ))}
    </div>
  );
}
