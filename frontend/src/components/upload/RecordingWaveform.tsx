import { useEffect, useRef } from "react";

export interface RecordingWaveformProps {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  width?: number;
  height?: number;
}

/**
 * Scrolling waveform visualization for audio recording.
 * Uses AnalyserNode to get real-time frequency data and renders
 * a scrolling waveform on a canvas element.
 */
export function RecordingWaveform({
  mediaStream,
  isRecording,
  width = 600,
  height = 100,
}: RecordingWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformDataRef = useRef<number[]>([]);

  // Create audio context and analyser
  useEffect(() => {
    if (!mediaStream || !isRecording) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    const analyser = audioContext.createAnalyser();

    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    sourceRef.current = source;
    waveformDataRef.current = [];

    return () => {
      source.disconnect();
      analyser.disconnect();
      audioContext.close();

      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [mediaStream, isRecording]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isRecording || !analyserRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isRecording) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }

      analyser.getByteTimeDomainData(dataArray);

      // Calculate average amplitude for this frame
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += Math.abs(normalized);
      }
      const average = sum / bufferLength;

      // Add to waveform data (scrolling from right)
      waveformDataRef.current.push(average);

      // Keep only the data that fits on screen
      const maxPoints = width;
      if (waveformDataRef.current.length > maxPoints) {
        waveformDataRef.current.shift();
      }

      // Clear canvas
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, width, height);

      // Draw waveform
      const centerY = height / 2;
      const amplitudeScale = height * 0.8; // Use 80% of height

      ctx.beginPath();
      ctx.strokeStyle = "#4a9eff";
      ctx.lineWidth = 2;

      waveformDataRef.current.forEach((amplitude, i) => {
        const x = (i / maxPoints) * width;
        const y = centerY + (amplitude * amplitudeScale * 0.5) * (i % 2 === 0 ? 1 : -1);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw center line
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Color zones (optional - show level zones)
      const drawZoneLine = (level: number, color: string) => {
        const y1 = centerY - (level * amplitudeScale * 0.5);
        const y2 = centerY + (level * amplitudeScale * 0.5);

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.moveTo(0, y1);
        ctx.lineTo(width, y1);
        ctx.moveTo(0, y2);
        ctx.lineTo(width, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // Draw level zones
      drawZoneLine(0.6, "rgba(234, 179, 8, 0.2)"); // Yellow zone
      drawZoneLine(0.9, "rgba(239, 68, 68, 0.2)"); // Red zone

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording, width, height]);

  // Clear canvas when not recording
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isRecording && canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, width, height);

        // Draw center line
        const centerY = height / 2;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 1;
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
      }
      waveformDataRef.current = [];
    }
  }, [isRecording, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="recording-waveform"
      style={{
        width: "100%",
        height: "auto",
        borderRadius: "4px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
      }}
    />
  );
}
