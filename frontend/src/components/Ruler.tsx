import { useEffect, useRef, useState } from 'react';

interface RulerProps {
  currentTime: number;
  duration: number;
  previewTime?: number; // Optional preview time for scrubbing visualization
  onSeek?: (seconds: number) => void;
  onPreview?: (seconds: number | null) => void; // Preview callback
  height?: number; // Optional height, defaults to 48px
}

/**
 * Ruler - A time ruler component with time codes at minute and 30-second marks
 * 
 * Features:
 * - Shows time codes at 1-minute and 30-second intervals
 * - Interactive scrubbing and seeking
 * - Vertical line showing current playback position
 * - Grid lines for time navigation
 * - Same interaction logic as WaveformVisualization
 */
export function Ruler({
  currentTime,
  duration,
  previewTime,
  onSeek,
  onPreview,
  height = 48
}: RulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Format time in MM:SS format
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Render ruler with time codes and grid lines
  const renderRuler = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    // Set canvas size to match container (responsive)
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${height}px`;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use preview time if dragging, otherwise use current time
    const displayTime = previewTime !== undefined ? previewTime : currentTime;
    const progress = duration > 0 ? displayTime / duration : 0;
    const cursorX = progress * canvas.width;

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // TIME GRID: Vertical lines for time navigation
    if (duration > 0) {
      ctx.globalCompositeOperation = 'source-over';
      
      // Helper function to draw vertical grid line
      const drawGridLine = (timeSeconds: number, opacity: number, lineWidth: number = 1) => {
        const x = (timeSeconds / duration) * canvas.width;
        if (x >= 0 && x <= canvas.width) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.lineWidth = lineWidth * dpr;
          ctx.setLineDash([]); // Solid line
          
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
      };

      // Draw time grid lines (60s and 30s only, skip 15s)
      for (let time = 0; time <= duration; time += 30) {
        if (time % 60 === 0) {
          // Every minute - solid line with 25% opacity
          drawGridLine(time, 0.25, 1);
        } else {
          // Every 30 seconds - solid line with 15% opacity
          drawGridLine(time, 0.15, 1);
        }
      }

      // TIME CODES: Draw time labels
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      for (let time = 0; time <= duration; time += 30) {
        const x = (time / duration) * canvas.width;
        if (x >= 20 * dpr && x <= canvas.width - 20 * dpr) { // Avoid edges
          const timeText = formatTime(time);
          
          if (time % 60 === 0) {
            // Every minute - white text, larger
            ctx.fillStyle = '#ffffff';
            ctx.font = `${12 * dpr}px system-ui, sans-serif`;
            ctx.fillText(timeText, x, canvas.height / 2);
          } else {
            // Every 30 seconds - dimmer text, smaller
            ctx.fillStyle = '#999999';
            ctx.font = `${10 * dpr}px system-ui, sans-serif`;
            ctx.fillText(timeText, x, canvas.height / 2);
          }
        }
      }
    }

    // CURSOR: Triangle at bottom indicating playback position
    if (duration > 0) {
      ctx.globalCompositeOperation = 'source-over';

      // Draw triangle pointing down at the bottom of the ruler
      const triangleSize = 6 * dpr;
      const triangleY = canvas.height - triangleSize;
      
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cursorX, canvas.height); // Bottom point
      ctx.lineTo(cursorX - triangleSize, triangleY); // Top left
      ctx.lineTo(cursorX + triangleSize, triangleY); // Top right
      ctx.closePath();
      ctx.fill();
    }
  };

  // Re-render on time change, preview time change, or window resize
  useEffect(() => {
    renderRuler();
  }, [currentTime, previewTime, duration, height]);

  useEffect(() => {
    const handleResize = () => renderRuler();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Real-time scrubbing handlers (same logic as WaveformVisualization)
  const getSeekTime = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return null;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const progress = Math.max(0, Math.min(x / rect.width, 1));
    return progress * duration;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || !onPreview) return;
    
    setIsDragging(true);
    const seekTime = getSeekTime(e.clientX);
    if (seekTime !== null) {
      onPreview(seekTime); // Start preview mode
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !onPreview) return;
    
    const seekTime = getSeekTime(e.clientX);
    if (seekTime !== null) {
      onPreview(seekTime); // Update preview
    }
  };

  const handleMouseUp = () => {
    if (isDragging && onSeek && onPreview) {
      // Get the final seek time and actually seek
      const canvas = canvasRef.current;
      if (canvas && previewTime !== undefined) {
        onSeek(previewTime); // Actually seek to the preview position
      }
      onPreview(null); // End preview mode
    }
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    if (isDragging && onPreview) {
      onPreview(null); // End preview mode if mouse leaves
    }
    setIsDragging(false);
  };

  // Global mouse up handler for when mouse leaves the canvas while dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => {
        if (onSeek && onPreview && previewTime !== undefined) {
          onSeek(previewTime); // Actually seek to preview position
        }
        if (onPreview) {
          onPreview(null); // End preview mode
        }
        setIsDragging(false);
      };
      
      const handleGlobalMouseMove = (e: MouseEvent) => {
        if (onPreview) {
          const seekTime = getSeekTime(e.clientX);
          if (seekTime !== null) {
            onPreview(seekTime); // Update preview
          }
        }
      };

      document.addEventListener('mouseup', handleGlobalMouseUp);
      document.addEventListener('mousemove', handleGlobalMouseMove);
      
      return () => {
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
      };
    }
  }, [isDragging, onSeek, onPreview, previewTime, duration]);

  return (
    <div ref={containerRef} className="ruler-container rounded-t-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="ruler-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}