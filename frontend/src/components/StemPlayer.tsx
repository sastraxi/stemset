import { useStemPlayer } from './useStemPlayer';
import type { StemSources } from './useStemPlayer';

interface StemPlayerProps {
  stems: StemSources;
  profileName: string;
  fileName: string;
}

/** Simplified StemPlayer using `useStemPlayer` hook.
 * Responsibilities:
 * - UI rendering & user interaction only.
 * - Delegates all audio graph & timing logic to hook.
 */
export function StemPlayer({ stems, profileName, fileName }: StemPlayerProps) {
  const {
    isLoading,
    isPlaying,
    currentTime,
    duration,
    stems: stemEntries,
    play,
    pause,
    stop,
    seek,
    setStemGain,
    resetStemGain,
    formatTime,
  } = useStemPlayer({ profileName, fileName, stems });

  if (isLoading) {
    return <div className="stem-player loading">Loading stems...</div>;
  }

  return (
    <div className="stem-player">
      <div className="playback-controls">
        <button onClick={isPlaying ? pause : play} disabled={stemEntries.length === 0}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={stop} disabled={!isPlaying && currentTime === 0}>
          ⏹ Stop
        </button>
        <div className="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      <div className="seek-bar">
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={currentTime}
          onChange={(e) => seek(parseFloat(e.target.value))}
        />
      </div>

      <div className="stem-controls">
        {stemEntries.map((stem) => (
          <div key={stem.name} className="stem-control">
            <label className="stem-name">{stem.name}</label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={stem.gain}
              onChange={(e) => setStemGain(stem.name, parseFloat(e.target.value))}
              className="volume-slider"
            />
            <span className="volume-label">
              {(stem.gain * 100).toFixed(0)}%
              <button
                onClick={() => resetStemGain(stem.name)}
                className="reset-gain"
                title="Reset to initial gain"
              >
                ↺
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
