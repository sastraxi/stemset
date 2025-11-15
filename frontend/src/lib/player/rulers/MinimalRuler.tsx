import { useCanvasRenderer } from "../canvas/useCanvasRenderer";
import { formatTime } from "../../../lib/utils";
import { useCanvasInteraction } from "../canvas/useCanvasInteraction";

export interface MinimalRulerProps {
  currentTime: number;
  duration: number;
  height?: number; // Default: 24px for enhanced look
  className?: string;
  onSeek?: (time: number) => void;
  onPreview?: (time: number | null) => void;
}

/**
 * MinimalRuler - A visually enhanced, compact ruler for inline clip playback.
 * Inspired by high-tech 80s Japanese retrofunk citypop visuals.
 *
 * Features:
 * - Transparent background
 * - Multi-level tick marks for precision with a vibrant, retro color palette
 * - Dynamic time labels that appear at wider zoom levels
 * - Glowing playback cursor for high visibility
 */
export function MinimalRuler({
  currentTime,
  duration,
  height = 24, // Increased height for better visuals
  className = "",
  onSeek,
  onPreview,
}: MinimalRulerProps) {
  const onRender = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    dpr: number,
  ) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. TRANSPARENT BACKGROUND
    // No background is drawn.

    const progress = duration > 0 ? currentTime / duration : 0;
    const cursorX = progress * canvas.width;

    // 2. REFINED TICK MARKS (Retrofunk Citypop Edition)
    if (duration > 0) {
      const pxPerSecond = canvas.width / duration;

      // Dynamic intervals for a clean, responsive look
      let majorInterval: number;
      let midInterval: number;
      let minorInterval: number;

      if (pxPerSecond > 40) {
        // Highest zoom: 1s major, 0.5s mid, 0.1s minor
        majorInterval = 1;
        midInterval = 0.5;
        minorInterval = 0.1;
      } else if (pxPerSecond > 15) {
        // High zoom: 5s major, 1s mid, 0.5s minor
        majorInterval = 5;
        midInterval = 1;
        minorInterval = 0.5;
      } else if (pxPerSecond > 5) {
        // Medium zoom: 10s major, 5s mid, 1s minor
        majorInterval = 10;
        midInterval = 5;
        minorInterval = 1;
      } else if (pxPerSecond > 2) {
        // Low zoom: 30s major, 10s mid, 2s minor
        majorInterval = 30;
        midInterval = 10;
        minorInterval = 2;
      } else {
        // Lowest zoom: 60s major, 30s mid, 5s minor
        majorInterval = 60;
        midInterval = 30;
        minorInterval = 5;
      }

      // Draw minor ticks (subtle cyan)
      ctx.strokeStyle = "rgba(0, 255, 255, 0.3)";
      ctx.lineWidth = 1 * dpr;
      const minorTickHeight = 4 * dpr;
      for (let time = 0; time <= duration; time += minorInterval) {
        if (time % midInterval !== 0) {
          const x = (time / duration) * canvas.width;
          ctx.beginPath();
          ctx.moveTo(x, canvas.height);
          ctx.lineTo(x, canvas.height - minorTickHeight);
          ctx.stroke();
        }
      }

      // Draw mid-level ticks (brighter magenta)
      ctx.strokeStyle = "rgba(255, 0, 255, 0.5)";
      ctx.lineWidth = 1.5 * dpr;
      const midTickHeight = 7 * dpr;
      for (let time = 0; time <= duration; time += midInterval) {
        if (time % majorInterval !== 0) {
          const x = (time / duration) * canvas.width;
          ctx.beginPath();
          ctx.moveTo(x, canvas.height);
          ctx.lineTo(x, canvas.height - midTickHeight);
          ctx.stroke();
        }
      }

      // Draw major ticks (bright yellow)
      ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
      ctx.lineWidth = 2 * dpr;
      const majorTickHeight = 12 * dpr;
      for (let time = 0; time <= duration; time += majorInterval) {
        const x = (time / duration) * canvas.width;
        ctx.beginPath();
        ctx.moveTo(x, canvas.height);
        ctx.lineTo(x, canvas.height - majorTickHeight);
        ctx.stroke();

        // 3. DYNAMIC TIME LABELS
        if (majorInterval * pxPerSecond > 60) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
          ctx.font = `${10 * dpr}px 'Inter', sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(
            formatTime(time),
            x,
            canvas.height - majorTickHeight - 4 * dpr,
          );
        }
      }
    }

    // 4. ENHANCED CURSOR
    if (duration > 0) {
      const cursorXRounded = Math.round(cursorX);

      // Glowing effect for the cursor line (hot pink)
      ctx.shadowColor = "rgba(255, 105, 180, 0.7)";
      ctx.shadowBlur = 8 * dpr;

      // Main cursor line
      ctx.strokeStyle = "rgba(255, 105, 180, 1)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(cursorXRounded, 0);
      ctx.lineTo(cursorXRounded, canvas.height);
      ctx.stroke();

      // Reset shadow for other elements
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      // Modern top pointer
      const pointerWidth = 8 * dpr;
      const pointerHeight = 6 * dpr;
      ctx.fillStyle = "rgba(255, 105, 180, 1)";
      ctx.beginPath();
      ctx.moveTo(cursorXRounded, 0);
      ctx.lineTo(cursorXRounded - pointerWidth / 2, pointerHeight);
      ctx.lineTo(cursorXRounded + pointerWidth / 2, pointerHeight);
      ctx.closePath();
      ctx.fill();
    }
  };

  const { canvasRef, containerRef } = useCanvasRenderer({
    onRender,
    dependencies: [currentTime, duration],
    height,
  });

  const { handleMouseDown, handleMouseMove, handleMouseUp } =
    useCanvasInteraction({
      canvasRef,
      duration,
      onSeek,
      onPreview,
    });

  return (
    <div ref={containerRef} className={`minimal-ruler ${className}`}>
      <canvas
        ref={canvasRef}
        className="ruler-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      />
    </div>
  );
}
