import { useCallback, useEffect, useRef, useState } from "react";
import { useRangeSelection } from "../contexts/RangeSelectionContext";

interface RulerProps {
	currentTime: number;
	duration: number;
	previewTime?: number; // Optional preview time for scrubbing visualization
	onSeek?: (seconds: number) => void;
	onPreview?: (seconds: number | null) => void; // Preview callback
	height?: number; // Optional height, defaults to 48px
	disableSelection?: boolean; // Disable selection functionality
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
	height = 48,
	disableSelection,
}: RulerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const dragStartPos = useRef<{x: number; time: number} | null>(null);
	const [dragMode, setDragMode] = useState<'seek' | 'select' | null>(null);

	// Try to use range selection context if available (optional - not all uses of Ruler need it)
	let rangeSelection = null;
	if (!disableSelection) {
		try {
			rangeSelection = useRangeSelection();
		} catch {
			// Not wrapped in RangeSelectionProvider - that's fine
		}
	}

	// Format time in MM:SS format
	const formatTime = (seconds: number): string => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	};

	// Render ruler with time codes and grid lines
	const renderRuler = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) return;

		// Set canvas size to match its own dimensions (responsive)
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		canvas.width = rect.width * dpr * 1;
		canvas.height = height * dpr;
		// Set CSS dimensions to maintain proper display size
		// canvas.style.width = `${rect.width}px`;
		// canvas.style.height = `${height}px`;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Use preview time if dragging, otherwise use current time
		const displayTime = previewTime !== undefined ? previewTime : currentTime;
		const progress = duration > 0 ? displayTime / duration : 0;
		const cursorX = progress * canvas.width;

		// Background
		// ctx.scale(canvas.width / (2 * rect.width), 1);
		ctx.fillStyle = "#1a1a1a";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// TIME GRID: Vertical lines for time navigation
		if (duration > 0) {
			ctx.globalCompositeOperation = "source-over";

			// Helper function to draw vertical grid line
			const drawGridLine = (
				timeSeconds: number,
				opacity: number,
				lineWidth: number = 1,
			) => {
				const x = Math.round((timeSeconds / duration) * canvas.width);
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
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";

			for (let time = 0; time <= duration; time += 30) {
				const x = Math.round((time / duration) * canvas.width);
				if (x >= 20 * dpr && x <= canvas.width - 20 * dpr) {
					// Avoid edges
					const timeText = formatTime(time);

					if (time % 60 === 0) {
						// Every minute - white text, larger
						ctx.fillStyle = "#ffffff";
						ctx.font = `${12 * dpr}px system-ui, sans-serif`;
						ctx.fillText(timeText, x, Math.round(canvas.height / 2));
					} else {
						// Every 30 seconds - dimmer text, smaller
						ctx.fillStyle = "#999999";
						ctx.font = `${10 * dpr}px system-ui, sans-serif`;
						ctx.fillText(timeText, x, Math.round(canvas.height / 2));
					}
				}
			}
		}

		// CURSOR: Triangle at bottom indicating playback position
		if (duration > 0) {
			ctx.globalCompositeOperation = "source-over";

			// Draw triangle pointing down at the bottom of the ruler
			const triangleSize = 6 * dpr;
			const triangleY = canvas.height - triangleSize;
			const cursorXRounded = Math.round(cursorX);

			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.moveTo(cursorXRounded, canvas.height); // Bottom point
			ctx.lineTo(cursorXRounded - triangleSize, triangleY); // Top left
			ctx.lineTo(cursorXRounded + triangleSize, triangleY); // Top right
			ctx.closePath();
			ctx.fill();
		}

		// RANGE SELECTION: Highlight selected region if range selection is active
		if (rangeSelection && duration > 0) {
			const { selection } = rangeSelection;
			const { startSec, endSec } = selection;

			if (startSec !== null && endSec !== null) {
				const startX = (startSec / duration) * canvas.width;
				const endX = (endSec / duration) * canvas.width;
				const regionWidth = endX - startX;

				// Semi-transparent blue highlight
				ctx.globalCompositeOperation = "source-over";
				ctx.fillStyle = "rgba(59, 130, 246, 0.2)"; // Blue, 20% opacity
				ctx.fillRect(startX, 0, regionWidth, canvas.height);

				// Draw handles (circles) at start and end
				const handleRadius = 8 * dpr;
				const handleY = canvas.height / 2;

				// Start handle
				ctx.fillStyle = "#3b82f6"; // Blue
				ctx.strokeStyle = "#ffffff"; // White border
				ctx.lineWidth = 2 * dpr;
				ctx.beginPath();
				ctx.arc(startX, handleY, handleRadius, 0, 2 * Math.PI);
				ctx.fill();
				ctx.stroke();

				// End handle
				ctx.beginPath();
				ctx.arc(endX, handleY, handleRadius, 0, 2 * Math.PI);
				ctx.fill();
				ctx.stroke();
			}
		}
	}, [currentTime, previewTime, duration, height, rangeSelection?.selection]);

	// Re-render on time change, preview time change, or window resize
	useEffect(() => {
		renderRuler();
	}, [currentTime, previewTime, duration, height]);

	// Watch for canvas parent size changes using ResizeObserver
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !canvas.parentElement) return;

		const resizeObserver = new ResizeObserver(() => {
			renderRuler();
		});

		resizeObserver.observe(canvas.parentElement);

		return () => {
			resizeObserver.disconnect();
		};
	}, [renderRuler]);

	// Real-time scrubbing handlers (same logic as WaveformVisualization)
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
					setDragMode('select');
				} else {
					setDragMode('seek');
					if (onPreview) onPreview(dragStartPos.current.time);
				}
			}
		}

		// Handle based on mode
		if (dragMode === 'select' && rangeSelection) {
			// Update range selection
			rangeSelection.setRange(dragStartPos.current.time, seekTime);
		} else if (dragMode === 'seek' && onPreview) {
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
			} else if (dragMode === 'seek' && onSeek && onPreview && previewTime !== undefined) {
				// Drag was for seeking - commit the seek
				onSeek(previewTime);
				onPreview(null);
			} else if (dragMode === 'select' && rangeSelection) {
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
							setDragMode('select');
						} else {
							setDragMode('seek');
							if (onPreview) onPreview(dragStartPos.current.time);
						}
					}
				}

				// Handle based on mode
				if (dragMode === 'select' && rangeSelection) {
					rangeSelection.setRange(dragStartPos.current.time, seekTime);
				} else if (dragMode === 'seek' && onPreview) {
					onPreview(seekTime);
				}
			};

			const handleGlobalTouchMove = (e: TouchEvent) => {
				e.preventDefault();
				const seekTime = getSeekTime(e.touches[0].clientX);
				if (seekTime === null || !dragStartPos.current) return;

				// Determine drag mode if not yet set
				if (dragMode === null) {
					const dragDistance = Math.abs(e.touches[0].clientX - dragStartPos.current.x);
					if (dragDistance > 5) {
						if (rangeSelection) {
							setDragMode('select');
						} else {
							setDragMode('seek');
							if (onPreview) onPreview(dragStartPos.current.time);
						}
					}
				}

				// Handle based on mode
				if (dragMode === 'select' && rangeSelection) {
					rangeSelection.setRange(dragStartPos.current.time, seekTime);
				} else if (dragMode === 'seek' && onPreview) {
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
	}, [isDragging, onSeek, onPreview, previewTime, duration, dragMode, rangeSelection]);

	return (
		<div className="ruler-container overflow-hidden">
			<canvas
				ref={canvasRef}
				className="ruler-canvas"
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
