import { useStemPlayer } from './useStemPlayer';
import type { StemSources } from './useStemPlayer';
import { WaveformVisualization } from './WaveformVisualization';
import { Ruler } from './Ruler';
import { useState } from 'react';

interface StemPlayerProps {
  stems: StemSources;
  profileName: string;
  fileName: string;
  metadataUrl: string;
}

/** Simplified StemPlayer using `useStemPlayer` hook.
 * Responsibilities:
 * - UI rendering & user interaction only.
 * - Delegates all audio graph & timing logic to hook.
 */
export function StemPlayer({ stems, profileName, fileName, metadataUrl }: StemPlayerProps) {
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  
  const {
    isLoading,
    loadingMetrics,
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
  } = useStemPlayer({ profileName, fileName, stems, metadataUrl });

  // Dump profile info once after load completes
  const hasLoggedRef = (window as any).__stemPlayerLoggedRef || ((window as any).__stemPlayerLoggedRef = { current: new Set<string>() });
  const key = `${profileName}::${fileName}`;
  if (!isLoading && !hasLoggedRef.current.has(key)) {
    hasLoggedRef.current.add(key);
    // Assemble snapshot
    const snapshot = {
      profileName,
      fileName,
      loadingMetrics,
      stemCount: stemEntries.length,
      stems: stemEntries.map(s => ({ name: s.name, gain: s.gain, initialGain: s.initialGain })),
      eqEnabled,
      eqBands,
      limiter,
      timestamp: new Date().toISOString(),
    };
    // Pretty print
    try {
      // eslint-disable-next-line no-console
      console.groupCollapsed(`StemPlayer Load Profile: ${key}`);
      console.info('Summary', { totalMs: loadingMetrics?.totalMs, stemCount: snapshot.stemCount });
      if (loadingMetrics) {
        console.table(loadingMetrics.stems.map(t => ({ Stem: t.name, Fetch_ms: t.fetchMs.toFixed(1), Decode_ms: t.decodeMs.toFixed(1), Total_ms: t.totalMs.toFixed(1), KB: (t.bytes/1024).toFixed(1) })));
        console.info('Metadata fetch ms', loadingMetrics.metadataMs.toFixed(1));
        console.info('Overall ms', loadingMetrics.totalMs.toFixed(1));
      }
      console.info('EQ', { enabled: eqEnabled, bands: eqBands });
      console.info('Limiter', limiter);
      console.info('Stems', snapshot.stems);
      console.groupEnd();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('StemPlayer snapshot', snapshot);
    }
  }

  if (isLoading) {
    return <div className="stem-player loading">Loading stems...</div>;
  }

  return (
    <>
      <div className="stem-player">
        <div className="waveforms-section">
          {/* Ruler row with controls alignment */}
          <div className="waveform-row">
            <div className="waveform-controls playback-controls">
              <div className="time-display">
                {formatTime(previewTime !== null ? previewTime : currentTime)} / {formatTime(duration)}
              </div>
              <button 
                onClick={isPlaying ? pause : play} 
                disabled={stemEntries.length === 0}
                className="playback-button"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button 
                onClick={stop} 
                disabled={!isPlaying && currentTime === 0}
                className="playback-button"
                title="Reset"
              >
                ⏹
              </button>
            </div>
            <Ruler
              currentTime={currentTime}
              duration={duration}
              previewTime={previewTime || undefined}
              onSeek={seek}
              onPreview={setPreviewTime}
              height={48}
            />
          </div>

          {stemEntries.map((stem, stemIndex) => (
            <div key={stem.name} className={"waveform-row"}>
              <div className="waveform-controls">
                <label className="waveform-stem-label">{stem.name}</label>
                <div className="waveform-volume-control">
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
                  </span>
                </div>
                <div className="waveform-control-buttons">
                  <button
                    onClick={() => resetStemGain(stem.name)}
                    className="reset-gain"
                    title="Reset to initial gain"
                  >
                    ↺
                  </button>
                </div>
              </div>
              <WaveformVisualization
                waveformUrl={stem.waveformUrl}
                stemName={stem.name}
                currentTime={currentTime}
                duration={duration}
                previewTime={previewTime || undefined}
                onSeek={seek}
                onPreview={setPreviewTime}
                waveformClasses={stemIndex === stemEntries.length - 1 ? "rounded-b-lg overflow-hidden" : ""}
              />
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
