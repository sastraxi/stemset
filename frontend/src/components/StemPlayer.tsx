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
    eqBands,
    updateEqBand,
    resetEq,
    limiter,
    updateLimiter,
    resetLimiter,
    eqEnabled,
    setEqEnabled,
    gainReduction,
  } = useStemPlayer({ profileName, fileName, stems });

  if (isLoading) {
    return <div className="stem-player loading">Loading stems...</div>;
  }

  return (
    <>
      <div className="player-panel stem-player">
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
      <div className="player-panel master-effects">
        <h3>Master Effects</h3>
        <div className="master-effects-row">
          <div className="eq-section">
            <div className="eq-header">
              <span>Graphic EQ (enabled <input type="checkbox" checked={eqEnabled} onChange={e => setEqEnabled(e.target.checked)} />)</span>
              <button onClick={resetEq} className="reset-gain" title="Reset EQ">↺</button>
            </div>
            <div className="eq-bands vertical">
              {eqBands.map(b => (
                <div key={b.id} className="eq-band-vertical">
                  <label className="eq-band-label">{b.id}<br/><small>{b.frequency}Hz</small></label>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={b.gain}
                    onChange={e => updateEqBand(b.id, { gain: parseFloat(e.target.value) })}
                    className="eq-slider-vertical"
                  />
                  <span className="eq-band-value">{b.gain.toFixed(1)}dB</span>
                </div>
              ))}
            </div>  
          </div>
          <div className="limiter-section">
            <div className="limiter-header">
              <span>Limiter (enabled <input type="checkbox" checked={limiter.enabled} onChange={e => updateLimiter({ enabled: e.target.checked })} />)</span>
              <button onClick={resetLimiter} className="reset-gain" title="Reset Limiter">↺</button>
            </div>
            <div className="limiter-controls">
              <div className="limiter-ceiling">
                <label>Threshold {limiter.thresholdDb} dB</label>
                <input
                  type="range"
                  min={-40}
                  max={0}
                  step={1}
                  value={limiter.thresholdDb}
                  onChange={e => updateLimiter({ thresholdDb: parseFloat(e.target.value) })}
                />
              </div>
              <div className="limiter-ceiling">
                <label>Release {Math.floor(limiter.release * 1000).toFixed(0)}ms</label>
                <input
                  type="range"
                  min={0.005}
                  max={0.6}
                  step={0.005}
                  value={limiter.release}
                  onChange={e => updateLimiter({ release: parseFloat(e.target.value) })}
                />
              </div>
              <div style={{ flexGrow: 1 }} />
              <div className="limiter-reduction">
                <label className="meter-label">Gain Reduction {gainReduction.toFixed(1)} dB</label>
                <div className="gr-meter" title={`${gainReduction.toFixed(1)} dB`}>
                  {(() => {
                    // Log-like visualization: map 0-25dB to 0-100% using (value/25)^(0.65)
                    const norm = gainReduction <= 0 ? 0 : Math.pow(Math.min(gainReduction,25)/25, 0.65);
                    const pct = norm * 100;
                    console.log(pct)
                    return <div className="gr-fill" style={{ width: `${pct}%` }} />;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
