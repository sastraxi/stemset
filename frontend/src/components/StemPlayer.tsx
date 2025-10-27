import { useStemPlayer } from '../hooks/useStemPlayer';
import { WaveformVisualization } from './WaveformVisualization';
import { Ruler } from './Ruler';
import { Spinner } from './Spinner';
import { Volume2, VolumeX, Music, Share } from 'lucide-react';
import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
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

    // Generate shareable URL with current time (floored to nearest second)
    const generateShareUrl = useCallback((time: number) => {
      const baseUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
      const currentPath = `/p/${profileName}/${fileName}`;
      const url = new URL(currentPath, baseUrl);
      url.searchParams.set('t', Math.floor(time).toString());
      return url.toString();
    }, [profileName, fileName]);

    const {
      isLoading,
      loadingMetrics,
      isPlaying,
      currentTime,
      duration,
      stems,
      stemOrder,
      play,
      pause,
      stop,
      seek,
      setStemGain,
      resetStemGain,
      toggleMute,
      toggleSolo,
      formatTime,
      effectsConfig,
      updateEqBand,
      setEqEnabled,
      resetEq,
      updateCompressor,
      resetCompressor,
      updateReverb,
      resetReverb,
      updateStereoExpander,
      resetStereoExpander,
      compressorGainReduction,
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
      const stemArray = stemOrder.map(name => stems[name]);
      const snapshot = {
        profileName,
        fileName,
        loadingMetrics,
        stemCount: stemOrder.length,
        stems: stemArray.map(s => ({ name: Object.keys(stems).find(k => stems[k] === s), gain: s.gain, initialGain: s.initialGain })),
        effects: effectsConfig,
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
        console.info('Effects', effectsConfig);
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
        <button
          onClick={async () => {
            const shareUrl = generateShareUrl(currentTime);
            try {
              await navigator.clipboard.writeText(shareUrl);
              toast.success(`Share link (${formatTime(currentTime)}) copied to clipboard!`);
            } catch (err) {
              console.error('Failed to copy to clipboard:', err);
              // Fallback - show the URL so user can copy manually
              toast.error('Could not copy to clipboard. Link: ' + shareUrl);
            }
          }}
          className="share-button"
          title="Share at current time"
        >
          <Share className="h-4 w-4" />
        </button>
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
          disabled={stemOrder.length === 0}
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

            {stemOrder.map((stemName, stemIndex) => {
              const stem = stems[stemName];
              return (
                <div key={stemName} className={"waveform-row"}>
                  <div className="waveform-controls">
                    <label className="waveform-stem-label">{stemName}</label>
                    <div className="waveform-volume-control">
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.01}
                        value={stem.gain}
                        onChange={(e) => setStemGain(stemName, parseFloat(e.target.value))}
                        className="volume-slider"
                        disabled={stem.muted}
                      />
                      <span className="volume-label">
                        {stem.muted ? 'Muted' : `${(stem.gain * 100).toFixed(0)}%`}
                      </span>
                    </div>
                    <div className="waveform-control-buttons flex gap-1">
                      <button
                        onClick={() => toggleMute(stemName)}
                        className={`mute-button ${stem.muted ? 'muted' : ''}`}
                        title={stem.muted ? "Unmute" : "Mute"}
                      >
                        {stem.muted ?
                          <VolumeX className="h-4 w-4" color={stem.muted ? "#ff6666" : "currentColor"} /> :
                          <Volume2 className="h-4 w-4" color="currentColor" />
                        }
                      </button>
                      <button
                        onClick={() => toggleSolo(stemName)}
                        className={`solo-button ${stem.soloed ? 'soloed' : ''}`}
                        title={stem.soloed ? "Unsolo" : "Solo"}
                      >
                        <Music className="h-4 w-4" color={stem.soloed ? "#ffb347" : "currentColor"} />
                      </button>
                      <button
                        onClick={() => resetStemGain(stemName)}
                        className="reset-gain"
                        title="Reset to initial gain"
                      >
                        ↺
                      </button>
                    </div>
                  </div>
                  <WaveformVisualization
                    waveformUrl={stem.waveformUrl}
                    stemName={stemName}
                    currentTime={currentTime}
                    duration={duration}
                    previewTime={previewTime || undefined}
                    onSeek={seek}
                    onPreview={setPreviewTime}
                    waveformClasses={stemIndex === stemOrder.length - 1 ? "rounded-b-lg overflow-hidden" : ""}
                  />
                </div>
              );
            })}
          </div>

        </div>
        <div className="player-panel master-effects">
          <div className="master-effects-row">
            <EqPanel
              config={effectsConfig.eq}
              onUpdateBand={updateEqBand}
              onSetEnabled={setEqEnabled}
              onReset={resetEq}
            />
            {/* <StereoExpanderPanel
              config={effectsConfig.stereoExpander}
              onUpdate={updateStereoExpander}
              onReset={resetStereoExpander}
            /> */}
            <ReverbPanel
              config={effectsConfig.reverb}
              onUpdate={updateReverb}
              onReset={resetReverb}
            />
            <CompressorPanel
              config={effectsConfig.compressor}
              gainReduction={compressorGainReduction}
              onUpdate={updateCompressor}
              onReset={resetCompressor}
            />
          </div>
        </div>
      </>
    );
  });
