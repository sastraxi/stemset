import { Pause, Play, Repeat, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClipDetectorState } from "@/hooks/useClipDetector";
import type { VuMeterLevels } from "@/hooks/useVuMeter";
import { VuMeter } from "./VuMeter";

interface VCRDisplayProps {
  currentTime: number;
  duration: number;
  formatTime: (time: number) => string;
  showTimeRemaining: boolean;
  onToggleTimeDisplay: () => void;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  disabled?: boolean;
  vuMeterLevels: VuMeterLevels;
  clipDetector?: ClipDetectorState;
  isLooping?: boolean;
  onToggleLoop?: () => void;
}

export function VCRDisplay({
  currentTime,
  duration,
  formatTime,
  showTimeRemaining,
  onToggleTimeDisplay,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  disabled = false,
  vuMeterLevels,
  clipDetector,
  isLooping,
  onToggleLoop,
}: VCRDisplayProps) {
  return (
    <div className="vcr-display">
      {/* Desktop: Stacked layout */}
      <div className="vcr-desktop-layout">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
        <div
          className="vcr-timecode"
          onClick={onToggleTimeDisplay}
          title="Click to toggle time remaining"
        >
          {showTimeRemaining
            ? `-${formatTime(duration - currentTime)}`
            : formatTime(currentTime)}
        </div>
        <VuMeter
          levels={vuMeterLevels}
          leftClipping={clipDetector?.leftClipping}
          rightClipping={clipDetector?.rightClipping}
          onResetClip={clipDetector?.reset}
        />
        <div className="flex gap-2 justify-stretch pt-1 relative z-[1]">
          <Button
            type="button"
            onClick={isPlaying ? onPause : onPlay}
            disabled={disabled}
            title={isPlaying ? "Pause" : "Play"}
            className="vcr-button"
            variant="outline"
          >
            {isPlaying ? "⏸" : "▶"}
          </Button>
          <Button
            type="button"
            onClick={onStop}
            disabled={disabled || (!isPlaying && currentTime === 0)}
            title="Reset"
            className="vcr-button"
            variant="outline"
          >
            ⏹
          </Button>
          {onToggleLoop && (
            <Button
              type="button"
              onClick={onToggleLoop}
              title={isLooping ? "Disable Loop" : "Enable Loop"}
              className="vcr-button"
              variant="outline"
              data-active={isLooping}
            >
              <Repeat
                className="h-4 w-4"
                color={isLooping ? "hsl(var(--primary))" : "currentColor"}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Mobile: Centered layout with flanking buttons */}
      <div className="vcr-mobile-layout">
        <VuMeter
          levels={vuMeterLevels}
          leftClipping={clipDetector?.leftClipping}
          rightClipping={clipDetector?.rightClipping}
          onResetClip={clipDetector?.reset}
        />
        <Button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled}
          title={isPlaying ? "Pause" : "Play"}
          className="vcr-button-mobile"
          variant="outline"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
        </Button>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
        <div
          className="vcr-timecode-mobile"
          onClick={onToggleTimeDisplay}
          title="Click to toggle time remaining"
        >
          {showTimeRemaining
            ? `-${formatTime(duration - currentTime)}`
            : formatTime(currentTime)}
        </div>
        <Button
          type="button"
          onClick={onStop}
          disabled={disabled || (!isPlaying && currentTime === 0)}
          title="Reset"
          className="vcr-button-mobile"
          variant="outline"
        >
          <Square className="h-4 w-4 fill-current" />
        </Button>
      </div>
    </div>
  );
}
