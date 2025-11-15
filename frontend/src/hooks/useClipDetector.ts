import { useEffect, useRef, useState, useCallback } from "react";

export interface ClipDetectorState {
  leftClipping: boolean;
  rightClipping: boolean;
  leftPeak: number; // 0-1 normalized peak level
  rightPeak: number; // 0-1 normalized peak level
  clipCount: number;
  reset: () => void;
}

interface ClipDetectorOptions {
  /** Threshold for clipping detection (default: 0.99 to catch near-clips) */
  clipThreshold?: number;
  /** How long to hold the clip indicator in milliseconds (default: 2000) */
  clipHoldTime?: number;
  /** Update interval in milliseconds (default: 50ms) */
  processingInterval?: number;
}

/**
 * Hook to detect audio clipping with sample-accurate peak detection.
 * Monitors stereo audio from master output and tracks peak levels and clipping events.
 *
 * This hook is refactored to use a double-loop pattern to avoid re-render cycles:
 * 1. A `setInterval` loop runs at a lower frequency to perform the expensive audio analysis
 *    and updates values stored in `useRef`s, avoiding state changes.
 * 2. A `requestAnimationFrame` loop runs at the display refresh rate to update React state
 *    from the refs, ensuring smooth UI updates without triggering the analysis loop.
 */
export function useClipDetector(
  masterOutputNode: GainNode | null,
  audioContext: AudioContext | null,
  isPlaying: boolean,
  options: ClipDetectorOptions = {},
): ClipDetectorState {
  const {
    clipThreshold = 0.99,
    clipHoldTime = 2000,
    processingInterval = 50, // Slower interval for analysis
  } = options;

  const [leftClipping, setLeftClipping] = useState(false);
  const [rightClipping, setRightClipping] = useState(false);
  const [leftPeak, setLeftPeak] = useState(0);
  const [rightPeak, setRightPeak] = useState(0);
  const [clipCount, setClipCount] = useState(0);

  // Refs for audio nodes and data arrays
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const analyserLeftRef = useRef<AnalyserNode | null>(null);
  const analyserRightRef = useRef<AnalyserNode | null>(null);
  const dataArrayLeftRef = useRef<Float32Array | null>(null);
  const dataArrayRightRef = useRef<Float32Array | null>(null);

  // Refs to hold the latest analysis data, updated by the processing loop
  const analysisData = useRef({
    leftPeak: 0,
    rightPeak: 0,
    leftClipping: false,
    rightClipping: false,
    clipCount: 0,
    leftClipTime: 0,
    rightClipTime: 0,
  });

  // Refs for managing loops
  const processingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const rafRef = useRef<number | null>(null);

  // Create analyzer nodes
  useEffect(() => {
    if (!audioContext || !masterOutputNode) return;

    const splitter = audioContext.createChannelSplitter(2);
    const analyserLeft = audioContext.createAnalyser();
    analyserLeft.fftSize = 2048;
    analyserLeft.smoothingTimeConstant = 0;
    const analyserRight = audioContext.createAnalyser();
    analyserRight.fftSize = 2048;
    analyserRight.smoothingTimeConstant = 0;

    masterOutputNode.connect(splitter);
    splitter.connect(analyserLeft, 0);
    splitter.connect(analyserRight, 1);

    splitterRef.current = splitter;
    analyserLeftRef.current = analyserLeft;
    analyserRightRef.current = analyserRight;
    dataArrayLeftRef.current = new Float32Array(analyserLeft.fftSize);
    dataArrayRightRef.current = new Float32Array(analyserRight.fftSize);

    return () => {
      masterOutputNode.disconnect(splitter);
      splitter.disconnect();
    };
  }, [audioContext, masterOutputNode]);

  // Processing loop (setInterval) - performs analysis, updates refs
  useEffect(() => {
    if (!isPlaying) {
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
        processingIntervalRef.current = null;
      }
      return;
    }

    const processAudio = () => {
      if (
        !analyserLeftRef.current ||
        !analyserRightRef.current ||
        !dataArrayLeftRef.current ||
        !dataArrayRightRef.current
      ) {
        return;
      }

      analyserLeftRef.current.getFloatTimeDomainData(
        dataArrayLeftRef.current as Float32Array<ArrayBuffer>,
      );
      analyserRightRef.current.getFloatTimeDomainData(
        dataArrayRightRef.current as Float32Array<ArrayBuffer>,
      );

      const findPeak = (data: Float32Array) => {
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const abs = Math.abs(data[i]);
          if (abs > peak) peak = abs;
        }
        return peak;
      };

      const currentLeftPeak = findPeak(dataArrayLeftRef.current);
      const currentRightPeak = findPeak(dataArrayRightRef.current);
      const now = Date.now();

      analysisData.current.leftPeak = currentLeftPeak;
      analysisData.current.rightPeak = currentRightPeak;

      if (currentLeftPeak >= clipThreshold) {
        if (!analysisData.current.leftClipping) {
          analysisData.current.leftClipping = true;
          analysisData.current.clipCount++;
        }
        analysisData.current.leftClipTime = now;
      }

      if (currentRightPeak >= clipThreshold) {
        if (!analysisData.current.rightClipping) {
          analysisData.current.rightClipping = true;
          analysisData.current.clipCount++;
        }
        analysisData.current.rightClipTime = now;
      }

      if (
        analysisData.current.leftClipping &&
        now - analysisData.current.leftClipTime > clipHoldTime
      ) {
        analysisData.current.leftClipping = false;
      }

      if (
        analysisData.current.rightClipping &&
        now - analysisData.current.rightClipTime > clipHoldTime
      ) {
        analysisData.current.rightClipping = false;
      }
    };

    processingIntervalRef.current = setInterval(
      processAudio,
      processingInterval,
    );

    return () => {
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
        processingIntervalRef.current = null;
      }
    };
  }, [isPlaying, processingInterval, clipThreshold, clipHoldTime]);

  // Render loop (requestAnimationFrame) - updates state from refs
  useEffect(() => {
    if (!isPlaying) {
      // When playback stops, do one final update to reset peaks to 0
      setLeftPeak(0);
      setRightPeak(0);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const render = () => {
      setLeftPeak(analysisData.current.leftPeak);
      setRightPeak(analysisData.current.rightPeak);
      setLeftClipping(analysisData.current.leftClipping);
      setRightClipping(analysisData.current.rightClipping);
      setClipCount(analysisData.current.clipCount);

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying]);

  const reset = useCallback(() => {
    analysisData.current = {
      leftPeak: 0,
      rightPeak: 0,
      leftClipping: false,
      rightClipping: false,
      clipCount: 0,
      leftClipTime: 0,
      rightClipTime: 0,
    };
    // Immediately update state
    setLeftPeak(0);
    setRightPeak(0);
    setLeftClipping(false);
    setRightClipping(false);
    setClipCount(0);
  }, []);

  return {
    leftClipping,
    rightClipping,
    leftPeak,
    rightPeak,
    clipCount,
    reset,
  };
}
