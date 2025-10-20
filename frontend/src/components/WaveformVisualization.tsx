import { useEffect, useRef } from 'react';

interface WaveformVisualizationProps {
  waveformUrl: string | null;
  stemName: string;
  currentTime: number;
  duration: number;
  onSeek?: (seconds: number) => void;
}

/** Stem color palette matching the dark theme */
const STEM_COLORS: Record<string, string> = {
  vocals: '#ff6b6b',    // Red
  drums: '#ff9f43',     // Orange
  bass: '#48dbfb',      // Cyan
  other: '#a29bfe',     // Purple
};

/**
 * WaveformVisualization - Renders a clickable waveform display with playback position indicator
 *
 * Backend generates grayscale PNG waveforms (white on transparent). This component:
 * 1. Loads the PNG into an offscreen canvas
 * 2. Colors it via canvas compositing (stem-specific colors)
 * 3. Renders it at full width with responsive scaling
 * 4. Overlays playback position indicator
 * 5. Handles click-to-seek interactions
 */
export function WaveformVisualization({
  waveformUrl,
  stemName,
  currentTime,
  duration,
  onSeek
}: WaveformVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Load waveform image
  useEffect(() => {
    if (!waveformUrl) {
      imageRef.current = null;
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous'; // For CORS if needed
    img.onload = () => {
      imageRef.current = img;
      renderWaveform();
    };
    img.onerror = (e) => {
      console.error('Failed to load waveform image', waveformUrl, e);
      imageRef.current = null;
    };
    img.src = waveformUrl;
  }, [waveformUrl]);

  // Render waveform with coloring
  const renderWaveform = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    // Set canvas size to match container (responsive)
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 128 * dpr; // Fixed height for consistent UI
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = '128px';

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grayscale image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Apply stem-specific color via globalCompositeOperation
    // Backend provides white waveform on transparent background
    // We use 'source-in' to keep shape but fill with color
    ctx.globalCompositeOperation = 'source-in';
    const color = STEM_COLORS[stemName] || '#4a9eff'; // Fallback to accent blue
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Reset composite mode for progress indicator
    ctx.globalCompositeOperation = 'source-over';

    // Draw playback position indicator
    if (duration > 0) {
      const progress = currentTime / duration;
      const x = progress * canvas.width;

      // Vertical line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      // Small circle at top
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, 6 * dpr, 4 * dpr, 0, 2 * Math.PI);
      ctx.fill();
    }
  };

  // Re-render on time change or window resize
  useEffect(() => {
    renderWaveform();
  }, [currentTime, duration]);

  useEffect(() => {
    const handleResize = () => renderWaveform();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Click-to-seek handler
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || duration === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    const seekTime = Math.max(0, Math.min(progress * duration, duration));
    onSeek(seekTime);
  };

  if (!waveformUrl) {
    return (
      <div className="waveform-placeholder">
        <span>No waveform available</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="waveform-container">
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        onClick={handleClick}
      />
    </div>
  );
}
