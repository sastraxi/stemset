import { Ruler } from "../../../components/Ruler";
import type { RangeSelectionContext } from "../canvas/useCanvasInteraction";

export interface FullRulerProps {
  currentTime: number;
  duration: number;
  previewTime?: number;
  onSeek?: (time: number) => void;
  onPreview?: (time: number | null) => void;
  rangeSelection?: RangeSelectionContext | null;
  height?: number; // Default: 48px
  className?: string;
}

/**
 * FullRuler - Full-featured ruler for DAW interface
 * Features:
 * - Time codes at 1min and 30s intervals
 * - Click/drag to seek
 * - Range selection support
 * - Grid lines
 * - Playback cursor with preview
 */
export function FullRuler({
  currentTime,
  duration,
  previewTime,
  onSeek,
  onPreview,
  height = 48,
  className = "",
}: FullRulerProps) {
  return (
    <div className={`full-ruler ${className}`}>
      <Ruler
        currentTime={currentTime}
        duration={duration}
        previewTime={previewTime}
        onSeek={onSeek}
        onPreview={onPreview}
        height={height}
      />
    </div>
  );
}
