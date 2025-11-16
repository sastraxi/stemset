import { useEffect, useRef, useState } from "react";
import {
  type RangeSelectionContextValue,
  useRangeSelection,
} from "@/contexts/RangeSelectionContext";
import { STEM_COLORS } from "@/lib/player/audio/constants";
import { loadWaveformImage } from "@/lib/player/canvas/imageLoader";
import {
  calculateClipBounds,
  drawCursor,
  drawRangeSelection,
  drawTimeGrid,
} from "@/lib/player/canvas/waveformUtils";

interface WaveformVisualizationProps {
  waveformUrl: string | null;
  stemName: string;
  currentTime: number;
  duration: number;
  previewTime?: number; // Optional preview time for scrubbing visualization
  onSeek?: (seconds: number) => void;
  onPreview?: (seconds: number | null) => void; // Preview callback
  startTimeSec?: number; // Clip start time (for rendering clip portion of waveform)
  endTimeSec?: number; // Clip end time (for rendering clip portion of waveform)
  fullDuration?: number; // Full recording duration (needed for clip rendering)
  waveformClasses?: string; // Optional additional CSS classes for styling
}

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
  previewTime,
  onSeek,
  onPreview,
  startTimeSec,
  endTimeSec,
  fullDuration,
  waveformClasses,
}: WaveformVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const dragStartPos = useRef<{ x: number; time: number } | null>(null);
  const [dragMode, setDragMode] = useState<"seek" | "select" | null>(null);

  // Try to use range selection context if available (optional - not all uses need it)
  const rangeSelection: RangeSelectionContextValue | null = useRangeSelection();

  // Load waveform image with authentication
  useEffect(() => {
    if (!waveformUrl) {
      imageRef.current = null;
      setIsImageLoaded(false);
      return;
    }

    setIsImageLoaded(false);

    loadWaveformImage(waveformUrl)
      .then((img) => {
        imageRef.current = img;
        setIsImageLoaded(true);
      })
      .catch((error) => {
        console.error(
          `[WaveformVisualization:${stemName}] Failed to load waveform`,
          waveformUrl,
          error,
        );
        imageRef.current = null;
        setIsImageLoaded(false);
      });
  }, [waveformUrl, stemName]);

  // Render waveform with dual-tone coloring (greyscale left, vibrant right)
  const renderWaveform = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    // Set canvas size to match container (responsive)
    const rect = container.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Skip rendering if container has no dimensions yet
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    canvas.width = rect.width * dpr * 1;
    canvas.height = rect.height * dpr * 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use preview time if dragging, otherwise use current time
    const displayTime = previewTime !== undefined ? previewTime : currentTime;
    const progress = duration > 0 ? displayTime / duration : 0;
    const cursorX = progress * canvas.width;

    const stemColor = STEM_COLORS[stemName] || "#4a9eff";

    // Calculate clip bounds for rendering
    const { srcX, srcWidth, srcY, srcHeight } = calculateClipBounds(
      img,
      startTimeSec,
      endTimeSec,
      fullDuration,
      duration,
    );

    // LEFT SIDE: Played portion (dark greyscale)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cursorX, canvas.height);
    ctx.clip();

    // Draw waveform image (only the clip portion)
    ctx.drawImage(
      img,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    // Apply dark greyscale using source-in + dark grey fill
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#3a3a3a"; // Dark grey for played portion
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.restore();

    // RIGHT SIDE: Unplayed portion (vibrant stem color)
    ctx.save();
    ctx.beginPath();
    ctx.rect(cursorX, 0, canvas.width - cursorX, canvas.height);
    ctx.clip();

    // Draw waveform image (only the clip portion)
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(
      img,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    // Apply vibrant stem color
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = stemColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.restore();

    // TIME GRID: Vertical lines for time navigation (DRAWN BEHIND WAVEFORM using destination-over)
    ctx.globalCompositeOperation = "destination-over";
    drawTimeGrid(ctx, canvas, duration, dpr);

    // CURSOR: Vertical line at playback position
    ctx.globalCompositeOperation = "source-over";
    drawCursor(ctx, canvas, cursorX, dpr);

    // RANGE SELECTION: Highlight selected region and dim outside regions
    if (rangeSelection) {
      drawRangeSelection(ctx, canvas, rangeSelection.selection, duration, dpr);
    }
  };

  // Re-render when data changes or image loads
  useEffect(() => {
    if (isImageLoaded) {
      // Defer rendering to next frame to ensure container is properly sized
      requestAnimationFrame(() => renderWaveform());
    }
  }, [
    isImageLoaded,
    currentTime,
    previewTime,
    duration,
    rangeSelection?.selection,
  ]);

  // Watch for container size changes using ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isImageLoaded) {
        renderWaveform();
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isImageLoaded]);

  // Real-time scrubbing handlers
  const getSeekTime = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return null;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const progress = Math.max(0, Math.min(x / rect.width, 1));
    return progress * duration;
  };

  const handleMouseDown = (
    e:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (!onSeek || !onPreview) return;

    e.preventDefault();
    setIsDragging(true);
    setDragMode(null); // Will be determined on move
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const seekTime = getSeekTime(clientX);

    if (seekTime !== null) {
      dragStartPos.current = { x: clientX, time: seekTime };

      // If range selection is available, start in selecting mode
      if (rangeSelection) {
        rangeSelection.setIsSelecting(true);
      } else {
        // No range selection context - default to seek mode
        onPreview(seekTime);
      }
    }
  };

  const handleMouseMove = (
    e:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (!isDragging) return;

    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const seekTime = getSeekTime(clientX);

    if (seekTime === null || !dragStartPos.current) return;

    // Determine drag mode if not yet set (threshold: 5px)
    if (dragMode === null) {
      const dragDistance = Math.abs(clientX - dragStartPos.current.x);
      if (dragDistance > 5) {
        // User is dragging - determine mode based on context
        if (rangeSelection) {
          setDragMode("select");
        } else {
          setDragMode("seek");
          if (onPreview) onPreview(dragStartPos.current.time);
        }
      }
    }

    // Handle based on mode
    if (dragMode === "select" && rangeSelection) {
      // Update range selection
      rangeSelection.setRange(dragStartPos.current.time, seekTime);
    } else if (dragMode === "seek" && onPreview) {
      // Update preview for seeking
      onPreview(seekTime);
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      // If drag mode was never set, this was a click (not a drag)
      if (dragMode === null && dragStartPos.current && onSeek) {
        // Click to seek
        onSeek(dragStartPos.current.time);
        // Clear preview after seeking
        if (onPreview) {
          onPreview(null);
        }
      } else if (
        dragMode === "seek" &&
        onSeek &&
        onPreview &&
        previewTime !== undefined
      ) {
        // Drag was for seeking - commit the seek
        onSeek(previewTime);
        onPreview(null);
      } else if (dragMode === "select" && rangeSelection) {
        // Drag was for range selection - selection already set, just end selecting mode
        rangeSelection.setIsSelecting(false);
      }

      // Reset state
      setIsDragging(false);
      setDragMode(null);
      dragStartPos.current = null;
    }
  };

  const handleMouseLeave = () => {
    // Don't reset on mouse leave - global handlers will take care of this
    // This allows dragging outside the canvas
  };

  // Global mouse up handler for when mouse leaves the canvas while dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => {
        handleMouseUp();
      };

      const handleGlobalMouseMove = (e: MouseEvent) => {
        const seekTime = getSeekTime(e.clientX);
        if (seekTime === null || !dragStartPos.current) return;

        // Determine drag mode if not yet set
        if (dragMode === null) {
          const dragDistance = Math.abs(e.clientX - dragStartPos.current.x);
          if (dragDistance > 5) {
            if (rangeSelection) {
              setDragMode("select");
            } else {
              setDragMode("seek");
              if (onPreview) onPreview(dragStartPos.current.time);
            }
          }
        }

        // Handle based on mode
        if (dragMode === "select" && rangeSelection) {
          rangeSelection.setRange(dragStartPos.current.time, seekTime);
        } else if (dragMode === "seek" && onPreview) {
          onPreview(seekTime);
        }
      };

      const handleGlobalTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        const seekTime = getSeekTime(e.touches[0].clientX);
        if (seekTime === null || !dragStartPos.current) return;

        // Determine drag mode if not yet set
        if (dragMode === null) {
          const dragDistance = Math.abs(
            e.touches[0].clientX - dragStartPos.current.x,
          );
          if (dragDistance > 5) {
            if (rangeSelection) {
              setDragMode("select");
            } else {
              setDragMode("seek");
              if (onPreview) onPreview(dragStartPos.current.time);
            }
          }
        }

        // Handle based on mode
        if (dragMode === "select" && rangeSelection) {
          rangeSelection.setRange(dragStartPos.current.time, seekTime);
        } else if (dragMode === "seek" && onPreview) {
          onPreview(seekTime);
        }
      };

      const handleGlobalTouchEnd = () => {
        handleMouseUp();
      };

      document.addEventListener("mouseup", handleGlobalMouseUp);
      document.addEventListener("mousemove", handleGlobalMouseMove);
      document.addEventListener("touchend", handleGlobalTouchEnd);
      document.addEventListener("touchmove", handleGlobalTouchMove, {
        passive: false,
      });

      return () => {
        document.removeEventListener("mouseup", handleGlobalMouseUp);
        document.removeEventListener("mousemove", handleGlobalMouseMove);
        document.removeEventListener("touchend", handleGlobalTouchEnd);
        document.removeEventListener("touchmove", handleGlobalTouchMove);
      };
    }
  }, [
    isDragging,
    onSeek,
    onPreview,
    previewTime,
    duration,
    dragMode,
    rangeSelection,
  ]);

  if (!waveformUrl) {
    return (
      <div className="waveform-placeholder">
        <span>No waveform available</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`waveform-container ${waveformClasses || ""}`}
    >
      <div className="waveform-stem-label-floating">{stemName}</div>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      />
    </div>
  );
}
