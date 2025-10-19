import { useEffect, useRef, useState } from 'react';
import type { StemMetadata } from '../types';
import { getFileMetadata } from '../api';

interface StemPlayerProps {
  stems: {
    vocals?: string;
    drums?: string;
    bass?: string;
    other?: string;
  };
  profileName: string;
  fileName: string;
}

interface LoadedStem {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  metadata: StemMetadata | null;
}

export function StemPlayer({ stems, profileName, fileName }: StemPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const [loadedStems, setLoadedStems] = useState<Map<string, LoadedStem>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [metadata, setMetadata] = useState<Record<string, StemMetadata> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);

  useEffect(() => {
    // Initialize AudioContext
    const audioContext = new AudioContext({ sampleRate: 44100 });
    audioContextRef.current = audioContext;

    loadMetadataAndStems();

    return () => {
      audioContext.close();
    };
  }, []);

  async function loadMetadataAndStems() {
    if (!audioContextRef.current) return;

    setIsLoading(true);
    const audioContext = audioContextRef.current;

    // Load metadata first
    let stemMetadata: Record<string, StemMetadata> = {};
    try {
      stemMetadata = await getFileMetadata(profileName, fileName);
      setMetadata(stemMetadata);
      console.log('Loaded metadata:', stemMetadata);
    } catch (error) {
      console.warn('Could not load metadata, using defaults:', error);
    }

    const stemMap = new Map<string, LoadedStem>();

    for (const [name, url] of Object.entries(stems)) {
      if (!url) continue;

      try {
        // Fetch audio file
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get metadata for this stem
        const stemMeta = stemMetadata[name] || null;

        // Create gain node with default from metadata
        const gainNode = audioContext.createGain();

        // Set initial gain based on stem_gain_adjustment_db from metadata
        // Convert dB to linear gain: gain = 10^(dB/20)
        if (stemMeta && stemMeta.stem_gain_adjustment_db !== undefined) {
          const gainLinear = Math.pow(10, stemMeta.stem_gain_adjustment_db / 20);
          gainNode.gain.value = gainLinear;
          console.log(`${name}: setting initial gain to ${stemMeta.stem_gain_adjustment_db}dB (${gainLinear.toFixed(2)} linear)`);
        } else {
          gainNode.gain.value = 1.0; // Unity gain if no metadata
        }

        gainNode.connect(audioContext.destination);

        stemMap.set(name, {
          buffer: audioBuffer,
          source: null,
          gainNode,
          metadata: stemMeta,
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
