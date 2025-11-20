import { useEffect, useRef, useState } from "react";

export interface RecordingWaveformProps {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  recordingTime?: number;
  resetSignal?: number; // Increment this to trigger a reset
}

/**
 * Scrolling waveform visualization for audio recording.
 * Uses AnalyserNode to get real-time frequency data and renders
 * a scrolling waveform on a canvas element.
 * Automatically resizes to fit container.
 */
export function RecordingWaveform({
  mediaStream,
  isRecording,
  recordingTime = 0,
  resetSignal = 0,
}: RecordingWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformDataRef = useRef<number[]>([]);
  const savedWaveformRef = useRef<number[]>([]); // Save waveform when recording stops
  const [dimensions, setDimensions] = useState({ width: 600, height: 200 });

  // Clear waveform when reset signal changes
  useEffect(() => {
    if (resetSignal > 0) {
      waveformDataRef.current = [];
      savedWaveformRef.current = [];

      // Clear canvas immediately
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const { width, height } = dimensions;
          ctx.fillStyle = "#191923";
          ctx.fillRect(0, 0, width, height);

          // Draw center line
          const centerY = height / 2;
          ctx.beginPath();
          ctx.strokeStyle = "rgba(100, 120, 180, 0.2)";
          ctx.lineWidth = 1;
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
        }
      }
    }
  }, [resetSignal, dimensions]);

  // Handle responsive sizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width, height: 200 });
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

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

  // Save waveform when recording stops
  useEffect(() => {
    if (!isRecording && waveformDataRef.current.length > 0) {
      savedWaveformRef.current = [...waveformDataRef.current];
    }
  }, [isRecording]);

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

      const { width, height } = dimensions;

      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS amplitude for this frame
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Apply inverse logarithmic scaling for fuller visual representation
      // This makes quieter sounds more visible while preserving dynamic range
      const scaledAmplitude = rms > 0 ? Math.pow(rms, 0.5) : 0;

      // Add to waveform data (scrolling from right)
      waveformDataRef.current.push(scaledAmplitude);

      // Keep only the data that fits on screen
      const maxPoints = width;
      if (waveformDataRef.current.length > maxPoints) {
        waveformDataRef.current.shift();
      }

      // Clear canvas with dark background
      ctx.fillStyle = "#191923";
      ctx.fillRect(0, 0, width, height);

      const centerY = height / 2;
      const amplitudeScale = height * 0.75; // Use 75% of height

      // Draw level zones (LED-style markers)
      const drawZoneLine = (level: number, color: string) => {
        const y1 = centerY - (level * amplitudeScale * 0.5);
        const y2 = centerY + (level * amplitudeScale * 0.5);

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.moveTo(0, y1);
        ctx.lineTo(width, y1);
        ctx.moveTo(0, y2);
        ctx.lineTo(width, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      drawZoneLine(0.6, "rgba(255, 143, 67, 0.15)"); // Orange zone
      drawZoneLine(0.85, "rgba(239, 68, 68, 0.2)"); // Red zone

      // Draw center line
      ctx.beginPath();
      ctx.strokeStyle = "rgba(100, 120, 180, 0.2)";
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Draw waveform with glow effect
      ctx.shadowBlur = 8;
      ctx.shadowColor = "#4a9eff";
      ctx.beginPath();
      ctx.strokeStyle = "#4a9eff";
      ctx.lineWidth = 2.5;

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
      ctx.shadowBlur = 0;

      // Draw time markers every 5 seconds for long recordings
      if (recordingTime >= 5) {
        ctx.font = "10px Share Tech Mono, monospace";
        ctx.fillStyle = "rgba(184, 194, 216, 0.4)";
        ctx.textAlign = "center";

        const totalSeconds = recordingTime;
        const secondsPerPixel = totalSeconds / width;
        const markerInterval = 5; // Mark every 5 seconds

        for (let sec = 0; sec <= totalSeconds; sec += markerInterval) {
          const x = width - (totalSeconds - sec) / secondsPerPixel;
          if (x >= 0 && x <= width) {
            // Draw tick mark
            ctx.beginPath();
            ctx.strokeStyle = "rgba(100, 120, 180, 0.3)";
            ctx.lineWidth = 1;
            ctx.moveTo(x, height - 20);
            ctx.lineTo(x, height - 10);
            ctx.stroke();

            // Draw time label
            const mins = Math.floor(sec / 60);
            const secs = sec % 60;
            const label = `${mins}:${secs.toString().padStart(2, "0")}`;
            ctx.fillText(label, x, height - 3);
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording, dimensions, recordingTime]);

  // Draw saved waveform when not recording
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isRecording && canvas) {
      const { width, height } = dimensions;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Clear canvas
      ctx.fillStyle = "#191923";
      ctx.fillRect(0, 0, width, height);

      const centerY = height / 2;
      const amplitudeScale = height * 0.75;

      // Draw level zones
      const drawZoneLine = (level: number, color: string) => {
        const y1 = centerY - (level * amplitudeScale * 0.5);
        const y2 = centerY + (level * amplitudeScale * 0.5);

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.moveTo(0, y1);
        ctx.lineTo(width, y1);
        ctx.moveTo(0, y2);
        ctx.lineTo(width, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      drawZoneLine(0.6, "rgba(255, 143, 67, 0.15)");
      drawZoneLine(0.85, "rgba(239, 68, 68, 0.2)");

      // Draw center line
      ctx.beginPath();
      ctx.strokeStyle = "rgba(100, 120, 180, 0.2)";
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Draw saved waveform if available
      if (savedWaveformRef.current.length > 0) {
        const maxPoints = width;

        ctx.shadowBlur = 8;
        ctx.shadowColor = "#4a9eff";
        ctx.beginPath();
        ctx.strokeStyle = "#4a9eff";
        ctx.lineWidth = 2.5;

        savedWaveformRef.current.forEach((amplitude, i) => {
          const x = (i / maxPoints) * width;
          const y = centerY + (amplitude * amplitudeScale * 0.5) * (i % 2 === 0 ? 1 : -1);

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });

        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw time markers
        if (recordingTime >= 5) {
          ctx.font = "10px Share Tech Mono, monospace";
          ctx.fillStyle = "rgba(184, 194, 216, 0.4)";
          ctx.textAlign = "center";

          const totalSeconds = recordingTime;
          const secondsPerPixel = totalSeconds / width;
          const markerInterval = 5;

          for (let sec = 0; sec <= totalSeconds; sec += markerInterval) {
            const x = width - (totalSeconds - sec) / secondsPerPixel;
            if (x >= 0 && x <= width) {
              ctx.beginPath();
              ctx.strokeStyle = "rgba(100, 120, 180, 0.3)";
              ctx.lineWidth = 1;
              ctx.moveTo(x, height - 20);
              ctx.lineTo(x, height - 10);
              ctx.stroke();

              const mins = Math.floor(sec / 60);
              const secs = sec % 60;
              const label = `${mins}:${secs.toString().padStart(2, "0")}`;
              ctx.fillText(label, x, height - 3);
            }
          }
        }
      }
    }
  }, [isRecording, dimensions, recordingTime]);

  return (
    <div ref={containerRef} className="recording-waveform-wrapper">
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="recording-waveform"
      />
    </div>
  );
}
