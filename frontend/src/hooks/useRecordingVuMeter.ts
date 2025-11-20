import { useEffect, useRef, useState } from "react";
import type { VuMeterLevels } from "./useVuMeter";

/**
 * Hook to analyze stereo audio levels from a live MediaStream (microphone input).
 * Returns real-time VU meter levels for left and right channels.
 *
 * Similar to useVuMeter but adapted for recording instead of playback.
 * Uses the same double-loop pattern to avoid re-render cycles.
 */
export function useRecordingVuMeter(
  mediaStream: MediaStream | null,
  isRecording: boolean,
): VuMeterLevels {
  const [levels, setLevels] = useState<VuMeterLevels>({ left: 0, right: 0 });
  const levelsRef = useRef({ left: 0, right: 0 });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const analyserLeftRef = useRef<AnalyserNode | null>(null);
  const analyserRightRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayLeftRef = useRef<Uint8Array | null>(null);
  const dataArrayRightRef = useRef<Uint8Array | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Create audio context and analyzer nodes from MediaStream
  useEffect(() => {
    if (!mediaStream || !isRecording) return;

    // Create AudioContext for analysis
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    const splitter = audioContext.createChannelSplitter(2);

    const analyserLeft = audioContext.createAnalyser();
    analyserLeft.fftSize = 256;
    analyserLeft.smoothingTimeConstant = 0.6;

    const analyserRight = audioContext.createAnalyser();
    analyserRight.fftSize = 256;
    analyserRight.smoothingTimeConstant = 0.6;

    // Connect: MediaStream → Splitter → Analysers
    source.connect(splitter);
    splitter.connect(analyserLeft, 0); // Left channel
    splitter.connect(analyserRight, 1); // Right channel

    audioContextRef.current = audioContext;
    sourceRef.current = source;
    splitterRef.current = splitter;
    analyserLeftRef.current = analyserLeft;
    analyserRightRef.current = analyserRight;
    dataArrayLeftRef.current = new Uint8Array(analyserLeft.frequencyBinCount);
    dataArrayRightRef.current = new Uint8Array(analyserRight.frequencyBinCount);

    return () => {
      // Cleanup audio graph
      source.disconnect();
      splitter.disconnect();
      analyserLeft.disconnect();
      analyserRight.disconnect();
      audioContext.close();

      audioContextRef.current = null;
      sourceRef.current = null;
      splitterRef.current = null;
      analyserLeftRef.current = null;
      analyserRightRef.current = null;
    };
  }, [mediaStream, isRecording]);

  // Analysis loop (RAF) - updates refs
  useEffect(() => {
    if (!isRecording) {
      levelsRef.current = { left: 0, right: 0 };
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const analyse = () => {
      if (
        !analyserLeftRef.current ||
        !analyserRightRef.current ||
        !dataArrayLeftRef.current ||
        !dataArrayRightRef.current
      ) {
        animationFrameRef.current = requestAnimationFrame(analyse);
        return;
      }

      analyserLeftRef.current.getByteTimeDomainData(
        dataArrayLeftRef.current as Uint8Array<ArrayBuffer>,
      );
      analyserRightRef.current.getByteTimeDomainData(
        dataArrayRightRef.current as Uint8Array<ArrayBuffer>,
      );

      const calculateRMS = (data: Uint8Array) => {
        const sum = data.reduce((acc, val) => {
          const normalized = (val - 128) / 128;
          return acc + normalized * normalized;
        }, 0);
        const rms = Math.sqrt(sum / data.length);
        return Math.min(1, rms * 2.5);
      };

      levelsRef.current = {
        left: calculateRMS(dataArrayLeftRef.current),
        right: calculateRMS(dataArrayRightRef.current),
      };

      animationFrameRef.current = requestAnimationFrame(analyse);
    };

    animationFrameRef.current = requestAnimationFrame(analyse);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording]);

  // State update loop (setInterval) - updates state from refs
  useEffect(() => {
    if (!isRecording) {
      setLevels({ left: 0, right: 0 });
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      if (
        levels.left !== levelsRef.current.left ||
        levels.right !== levelsRef.current.right
      ) {
        setLevels(levelsRef.current);
      }
    }, 50); // Update state at ~20fps

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, levels.left, levels.right]);

  return levels;
}
