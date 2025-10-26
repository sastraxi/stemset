import { useStemPlayer } from './useStemPlayer';
import { WaveformVisualization } from './WaveformVisualization';
import { Ruler } from './Ruler';
import { Spinner } from './Spinner';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';

interface StemPlayerProps {
  profileName: string;
  fileName: string;
  metadataUrl: string;
  onLoadingChange?: (isLoading: boolean) => void;
}

export interface StemPlayerHandle {
  focus: () => void;
}

/** Simplified StemPlayer using `useStemPlayer` hook.
 * Responsibilities:
 * - UI rendering & user interaction only.
 * - Delegates all audio graph & timing logic to hook.
 */
export const StemPlayer = forwardRef<StemPlayerHandle, StemPlayerProps>(
  ({ profileName, fileName, metadataUrl, onLoadingChange }, ref) => {
    const [previewTime, setPreviewTime] = useState<number | null>(null);
    const [showTimeRemaining, setShowTimeRemaining] = useState(false);
    const playerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        playerRef.current?.focus();
      }
    }));

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
      toggleMute,
      toggleSolo,
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
    } = useStemPlayer({ profileName, fileName, metadataUrl });

    // Notify parent of loading state changes
    useEffect(() => {
      onLoadingChange?.(isLoading);
    }, [isLoading, onLoadingChange]);

    // Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Only handle if player is focused or target is the player/body
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return; // Don't interfere with input fields
        }

        switch (e.code) {
          case 'Space':
          case 'KeyK':
            e.preventDefault();
            if (isPlaying) {
              pause();
            } else {
              play();
            }
            break;
          case 'Home':
          case 'Digit0':
          case 'Numpad0':
            e.preventDefault();
            stop();
            break;
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPlaying, play, pause, stop]);

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
          console.table(loadingMetrics.stems.map(t => ({ Stem: t.name, Fetch_ms: t.fetchMs.toFixed(1), Decode_ms: t.decodeMs.toFixed(1), Total_ms: t.totalMs.toFixed(1), KB: (t.bytes / 1024).toFixed(1) })));
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
      return (
        <div className="stem-player loading">
          <Spinner size="lg" />
          <p style={{ marginTop: '1rem', color: '#888' }}>Loading stems...</p>
        </div>
      );
    }

    // Render playback controls in header
    const playbackControlsContainer = document.getElementById('playback-controls-container');
    const playbackControls = (
      <>
        <div
          className="time-display clickable"
          onClick={() => setShowTimeRemaining(!showTimeRemaining)}
          title="Click to toggle time remaining"
        >
          {showTimeRemaining
            ? `-${formatTime(duration - (previewTime !== null ? previewTime : currentTime))} / ${formatTime(duration)}`
            : `${formatTime(previewTime !== null ? previewTime : currentTime)} / ${formatTime(duration)}`
          }
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
          className="playback-button stop-button"
          title="Reset"
        >
          ⏹
        </button>
      </>
    );

    return (
      <>
        {playbackControlsContainer && createPortal(playbackControls, playbackControlsContainer)}
        <div className="stem-player" ref={playerRef} tabIndex={0}>
          <div className="waveforms-section">
            {/* Ruler row - now just ruler without controls */}
            <div className="waveform-row">
              <div className="waveform-controls">
                {/* Empty controls area to maintain alignment */}
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
                      disabled={stem.muted}
                    />
                    <span className="volume-label">
                      {stem.muted ? 'Muted' : `${(stem.gain * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="waveform-control-buttons flex gap-1">
                    <button
                      onClick={() => toggleMute(stem.name)}
                      className={`mute-button ${stem.muted ? 'muted' : ''}`}
                      title={stem.muted ? "Unmute" : "Mute"}
                    >
                      {stem.muted ?
                        <VolumeX className="h-4 w-4" color={stem.muted ? "#ff6666" : "currentColor"} /> :
                        <Volume2 className="h-4 w-4" color="currentColor" />
                      }
                    </button>
                    <button
                      onClick={() => toggleSolo(stem.name)}
                      className={`solo-button ${stem.soloed ? 'soloed' : ''}`}
                      title={stem.soloed ? "Unsolo" : "Solo"}
                    >
                      <Music className="h-4 w-4" color={stem.soloed ? "#ffb347" : "currentColor"} />
                    </button>
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
          <div className="master-effects-row">
            <div className="eq-section">
              <div className="eq-header">
                <h4>Graphic EQ</h4>
                <div className="effect-controls">
                  <label className="effect-toggle">
                    <input type="checkbox" checked={eqEnabled} onChange={e => setEqEnabled(e.target.checked)} />
                    <span>On</span>
                  </label>
                  <button onClick={resetEq} className="reset-gain" title="Reset EQ">↺</button>
                </div>
              </div>
              <div className="eq-bands vertical">
                {eqBands.map(b => (
                  <div key={b.id} className="eq-band-vertical">
                    <label className="eq-band-label">{b.id}<br /><small>{b.frequency}Hz</small></label>
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
                <h4>Limiter</h4>
                <div className="effect-controls">
                  <label className="effect-toggle">
                    <input type="checkbox" checked={limiter.enabled} onChange={e => updateLimiter({ enabled: e.target.checked })} />
                    <span>On</span>
                  </label>
                  <button onClick={resetLimiter} className="reset-gain" title="Reset Limiter">↺</button>
                </div>
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
                <div className="flex-grow" />
                <div className="limiter-reduction">
                  <label className="meter-label">Gain Reduction {gainReduction.toFixed(1)} dB</label>
                  <div className="gr-meter" title={`${gainReduction.toFixed(1)} dB`}>
                    {(() => {
                      // Log-like visualization: map 0-25dB to 0-100% using (value/25)^(0.65)
                      const norm = gainReduction <= 0 ? 0 : Math.pow(Math.min(gainReduction, 25) / 25, 0.65);
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
  });
