import { useEffect, useRef, useState } from 'react';
import type { StemMetadata } from '../types';

interface StemPlayerProps {
  stems: {
    vocals?: string;
    drums?: string;
    bass?: string;
    other?: string;
  };
}

interface LoadedStem {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  metadata: StemMetadata | null;
}

export function StemPlayer({ stems }: StemPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const [loadedStems, setLoadedStems] = useState<Map<string, LoadedStem>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);

  useEffect(() => {
    // Initialize AudioContext
    const audioContext = new AudioContext({ sampleRate: 44100 });
    audioContextRef.current = audioContext;

    loadStems();

    return () => {
      audioContext.close();
    };
  }, []);

  async function loadStems() {
    if (!audioContextRef.current) return;

    setIsLoading(true);
    const audioContext = audioContextRef.current;
    const stemMap = new Map<string, LoadedStem>();

    for (const [name, url] of Object.entries(stems)) {
      if (!url) continue;

      try {
        // Fetch audio file
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Try to extract metadata from WAV file
        // For now, we'll start with default gain (the metadata is embedded in WAV,
        // but reading it requires parsing RIFF chunks which is complex in browser)
        const metadata: StemMetadata | null = null;

        // Create gain node
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0; // Start at unity gain
        gainNode.connect(audioContext.destination);

        stemMap.set(name, {
          buffer: audioBuffer,
          source: null,
          gainNode,
          metadata,
        });

        // Set duration from first stem
        if (duration === 0) {
          setDuration(audioBuffer.duration);
        }
      } catch (error) {
        console.error(`Error loading stem ${name}:`, error);
      }
    }

    setLoadedStems(stemMap);
    setIsLoading(false);
  }

  function play() {
    if (!audioContextRef.current || loadedStems.size === 0) return;

    const audioContext = audioContextRef.current;

    // Resume audio context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const offset = pauseTimeRef.current;
    startTimeRef.current = audioContext.currentTime - offset;

    // Create and start source for each stem
    loadedStems.forEach((stem, name) => {
      const source = audioContext.createBufferSource();
      source.buffer = stem.buffer;
      source.connect(stem.gainNode);
      source.start(0, offset);

      // Handle playback end
      source.onended = () => {
        if (isPlaying) {
          setIsPlaying(false);
          pauseTimeRef.current = 0;
          setCurrentTime(0);
        }
      };

      stem.source = source;
    });

    setIsPlaying(true);

    // Update current time
    const updateTime = () => {
      if (audioContextRef.current && isPlaying) {
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        setCurrentTime(Math.min(elapsed, duration));
        if (elapsed < duration) {
          requestAnimationFrame(updateTime);
        }
      }
    };
    requestAnimationFrame(updateTime);
  }

  function pause() {
    if (!audioContextRef.current) return;

    loadedStems.forEach((stem) => {
      if (stem.source) {
        stem.source.stop();
        stem.source.disconnect();
        stem.source = null;
      }
    });

    pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
    setIsPlaying(false);
  }

  function stop() {
    pause();
    pauseTimeRef.current = 0;
    setCurrentTime(0);
  }

  function seek(time: number) {
    const wasPlaying = isPlaying;
    if (wasPlaying) {
      pause();
    }
    pauseTimeRef.current = time;
    setCurrentTime(time);
    if (wasPlaying) {
      play();
    }
  }

  function handleVolumeChange(stemName: string, value: number) {
    const stem = loadedStems.get(stemName);
    if (stem) {
      stem.gainNode.gain.value = value;
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  if (isLoading) {
    return <div className="stem-player loading">Loading stems...</div>;
  }

  return (
    <div className="stem-player">
      <div className="playback-controls">
        <button onClick={isPlaying ? pause : play} disabled={loadedStems.size === 0}>
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
          min="0"
          max={duration}
          step="0.1"
          value={currentTime}
          onChange={(e) => seek(parseFloat(e.target.value))}
        />
      </div>

      <div className="stem-controls">
        {Array.from(loadedStems.entries()).map(([name, stem]) => (
          <div key={name} className="stem-control">
            <label className="stem-name">{name}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              defaultValue="1"
              onChange={(e) => handleVolumeChange(name, parseFloat(e.target.value))}
              className="volume-slider"
            />
            <span className="volume-label">
              {((stem.gainNode.gain.value) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
