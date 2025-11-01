import { useEffect, useRef, useState } from "react";

interface WaveformVisualizationProps {
	waveformUrl: string | null;
	stemName: string;
	currentTime: number;
	duration: number;
	previewTime?: number; // Optional preview time for scrubbing visualization
	onSeek?: (seconds: number) => void;
	onPreview?: (seconds: number | null) => void; // Preview callback

	waveformClasses?: string; // Optional additional CSS classes for styling
}

/** Stem color palette matching the dark theme */
const STEM_COLORS: Record<string, string> = {
	vocals: "#ff6b6b", // Red
	drums: "#ff9f43", // Orange
	bass: "#48dbfb", // Cyan
	other: "#a29bfe", // Purple
};

/** Consistent cursor color for all tracks */
const CURSOR_COLOR = "#ffffff";

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
	waveformClasses,
}: WaveformVisualizationProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	// Load waveform image
	useEffect(() => {
		if (!waveformUrl) {
			imageRef.current = null;
			return;
		}

		const img = new Image();
		img.crossOrigin = "anonymous"; // For CORS if needed
		img.onload = () => {
			imageRef.current = img;
			// Defer rendering to next frame to ensure container is properly sized
			requestAnimationFrame(() => renderWaveform());
		};
		img.onerror = (e) => {
			console.error(
				`[WaveformVisualization:${stemName}] Failed to load waveform image`,
				waveformUrl,
				e,
			);
			imageRef.current = null;
		};
		img.src = waveformUrl;
	}, [waveformUrl]);

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
		const dpr = window.devicePixelRatio || 1;
		const rect = container.getBoundingClientRect();

		// Skip rendering if container has no dimensions yet
		if (rect.width === 0 || rect.height === 0) {
			return;
		}

		canvas.width = rect.width * dpr;
		canvas.height = 108 * dpr; // Fixed height for consistent UI
		// Don't set inline styles - let CSS handle sizing to allow responsive shrinking

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Enable high-quality image smoothing for better downscaling
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		// Use preview time if dragging, otherwise use current time
		const displayTime = previewTime !== undefined ? previewTime : currentTime;
		const progress = duration > 0 ? displayTime / duration : 0;
		const cursorX = progress * canvas.width;

		const stemColor = STEM_COLORS[stemName] || "#4a9eff";
		const cursorColor = CURSOR_COLOR;

		// LEFT SIDE: Played portion (dark greyscale)
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, cursorX, canvas.height);
		ctx.clip();

		// Draw waveform image
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

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

		// Draw waveform image
		ctx.globalCompositeOperation = "source-over";
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

		// Apply vibrant stem color
		ctx.globalCompositeOperation = "source-in";
		ctx.fillStyle = stemColor;
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.restore();

		// TIME GRID: Vertical lines for time navigation (DRAWN BEHIND WAVEFORM using destination-over)
		if (duration > 0) {
			ctx.globalCompositeOperation = "destination-over";

			// Helper function to draw vertical grid line
			const drawGridLine = (
				timeSeconds: number,
				opacity: number,
				lineWidth: number = 1,
				dotted: boolean = false,
			) => {
				const x = (timeSeconds / duration) * canvas.width;
				if (x >= 0 && x <= canvas.width) {
					ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
					ctx.lineWidth = lineWidth * dpr;

					// Set dash pattern for dotted lines
					if (dotted) {
						ctx.setLineDash([3 * dpr, 3 * dpr]); // 3px dashes with 3px gaps
					} else {
						ctx.setLineDash([]); // Solid line
					}

					ctx.beginPath();
					ctx.moveTo(x, 0);
					ctx.lineTo(x, canvas.height);
					ctx.stroke();
				}
			};

			// Draw time grid lines
			for (let time = 0; time <= duration; time += 15) {
				if (time % 60 === 0) {
					// Every minute - solid line with 20% opacity
					drawGridLine(time, 0.15, 1, false);
				} else if (time % 30 === 0) {
					// Every 30 seconds - solid line with 12% opacity
					drawGridLine(time, 0.12, 1, false);
				} else {
					// Every 15 seconds - dotted line with 10% opacity
					drawGridLine(time, 0.1, 1, true);
				}
			}
		}

		// CURSOR: Vertical line at playback position
		if (duration > 0) {
			ctx.globalCompositeOperation = "source-over";

			// Vertical line with consistent white color
			ctx.strokeStyle = cursorColor;
			ctx.lineWidth = 2 * dpr;
			ctx.beginPath();
			ctx.moveTo(cursorX, 0);
			ctx.lineTo(cursorX, canvas.height);
			ctx.stroke();
		}
	};

	// Re-render on time change, preview time change, or duration change
	useEffect(() => {
		renderWaveform();
	}, [currentTime, previewTime, duration]);

	// Watch for container size changes using ResizeObserver
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const resizeObserver = new ResizeObserver(() => {
			renderWaveform();
		});

		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

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
		const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
		const seekTime = getSeekTime(clientX);
		if (seekTime !== null) {
			onPreview(seekTime); // Start preview mode
		}
	};

	const handleMouseMove = (
		e:
			| React.MouseEvent<HTMLCanvasElement>
			| React.TouchEvent<HTMLCanvasElement>,
	) => {
		if (!isDragging || !onPreview) return;

		e.preventDefault();
		const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
		const seekTime = getSeekTime(clientX);
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

			const handleGlobalTouchMove = (e: TouchEvent) => {
				if (onPreview) {
					e.preventDefault();
					const seekTime = getSeekTime(e.touches[0].clientX);
					if (seekTime !== null) {
						onPreview(seekTime); // Update preview
					}
				}
			};

			const handleGlobalTouchEnd = () => {
				if (onSeek && onPreview && previewTime !== undefined) {
					onSeek(previewTime);
				}
				if (onPreview) {
					onPreview(null);
				}
				setIsDragging(false);
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
	}, [isDragging, onSeek, onPreview, previewTime, duration]);

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
