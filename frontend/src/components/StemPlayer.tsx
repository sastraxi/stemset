import { useStemPlayer } from './useStemPlayer';
import { WaveformVisualization } from './WaveformVisualization';
import { Ruler } from './Ruler';
import { Spinner } from './Spinner';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { EqPanel } from './effects/EqPanel';
import { CompressorPanel } from './effects/CompressorPanel';
import { ReverbPanel } from './effects/ReverbPanel';
import { StereoExpanderPanel } from './effects/StereoExpanderPanel';

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
      eq,
      compressor,
      reverb,
      stereoExpander,
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
        eq: eq.settings,
        compressor: compressor.settings,
        reverb: reverb.settings,
        stereoExpander: stereoExpander.settings,
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
        console.info('EQ', eq.settings);
        console.info('Compressor', compressor.settings);
        console.info('Reverb', reverb.settings);
        console.info('Stereo Expander', stereoExpander.settings);
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
            <EqPanel
              settings={eq.settings}
              onUpdateBand={eq.updateBand}
              onSetEnabled={eq.setEnabled}
              onReset={eq.reset}
            />
            <StereoExpanderPanel
              settings={stereoExpander.settings}
              onUpdate={stereoExpander.update}
              onReset={stereoExpander.reset}
            />
            <ReverbPanel
              settings={reverb.settings}
              onUpdate={reverb.update}
              onReset={reverb.reset}
            />
            <CompressorPanel
              settings={compressor.settings}
              gainReduction={compressor.gainReduction}
              onUpdate={compressor.update}
              onReset={compressor.reset}
            />
          </div>
        </div>
      </>
    );
  });
