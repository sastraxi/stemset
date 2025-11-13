import { useEffect, useRef, useState } from "react";
import { getToken } from "../lib/storage";
import { useRangeSelection } from "../contexts/RangeSelectionContext";

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
	const dragStartPos = useRef<{x: number; time: number} | null>(null);
	const [dragMode, setDragMode] = useState<'seek' | 'select' | null>(null);

	// Try to use range selection context if available (optional - not all uses need it)
	let rangeSelection = null;
	try {
		rangeSelection = useRangeSelection();
	} catch {
		// Not wrapped in RangeSelectionProvider - that's fine
	}

	// Load waveform image with authentication
	useEffect(() => {
		if (!waveformUrl) {
			imageRef.current = null;
			setIsImageLoaded(false);
			return;
		}

		setIsImageLoaded(false);
		let objectUrl: string | null = null;

		const loadImage = async () => {
			try {
				// Only add auth headers for local /media URLs
				// Presigned R2 URLs have auth in the URL itself
				const isLocalMedia = waveformUrl.startsWith("/media");
				const headers: HeadersInit = {};
				if (isLocalMedia) {
					const token = getToken();
					if (token) {
						headers.Authorization = `Bearer ${token}`;
					}
				}

				const response = await fetch(waveformUrl, {
					headers,
					cache: "default", // Allow browser caching
				});
				if (!response.ok) {
					throw new Error(`Failed to fetch waveform: ${response.status}`);
				}

				const blob = await response.blob();
				objectUrl = URL.createObjectURL(blob);

				// Load into Image element
				const img = new Image();
				img.onload = () => {
					imageRef.current = img;
					setIsImageLoaded(true);
				};
				img.onerror = (e) => {
					console.error(
						`[WaveformVisualization:${stemName}] Failed to load waveform image`,
						waveformUrl,
						e,
					);
					imageRef.current = null;
					setIsImageLoaded(false);
				};
				img.src = objectUrl;
			} catch (error) {
				console.error(
					`[WaveformVisualization:${stemName}] Failed to fetch waveform`,
					waveformUrl,
					error,
				);
				imageRef.current = null;
				setIsImageLoaded(false);
			}
		};

		loadImage();

		// Cleanup blob URL when component unmounts or URL changes
		return () => {
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
		};
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
		const cursorColor = CURSOR_COLOR;

		// Calculate clip bounds for rendering
		const isClip = startTimeSec !== undefined && endTimeSec !== undefined && fullDuration !== undefined;
		const clipStart = isClip ? startTimeSec : 0;
		const clipEnd = isClip ? endTimeSec : fullDuration || duration;
		const clipDuration = clipEnd - clipStart;
		const totalDuration = fullDuration || duration;

		// Source rectangle in the waveform image (what portion to draw)
		const srcX = isClip ? (clipStart / totalDuration) * img.width : 0;
		const srcWidth = isClip ? (clipDuration / totalDuration) * img.width : img.width;
		const srcY = 0;
		const srcHeight = img.height;

		// LEFT SIDE: Played portion (dark greyscale)
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, cursorX, canvas.height);
		ctx.clip();

		// Draw waveform image (only the clip portion)
		ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, canvas.width, canvas.height);

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
		ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, canvas.width, canvas.height);

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
				const x = Math.round((timeSeconds / duration) * canvas.width);
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
			const cursorXRounded = Math.round(cursorX);
			ctx.strokeStyle = cursorColor;
			ctx.lineWidth = 2 * dpr;
			ctx.setLineDash([3 * dpr, 3 * dpr]); // Make the cursor dashed
			ctx.beginPath();
			ctx.moveTo(cursorXRounded, 0);
			ctx.lineTo(cursorXRounded, canvas.height);
			ctx.stroke();
			ctx.setLineDash([]); // Reset line dash after drawing the cursor
		}

		// RANGE SELECTION: Highlight selected region and dim outside regions
		if (rangeSelection && duration > 0) {
			const { selection } = rangeSelection;
			const { startSec, endSec } = selection;

			if (startSec !== null && endSec !== null) {
				const startX = (startSec / duration) * canvas.width;
				const endX = (endSec / duration) * canvas.width;

				// Dim regions outside the selection
				ctx.globalCompositeOperation = "source-over";
				ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; // 60% black overlay

				// Dim left of selection
				if (startX > 0) {
					ctx.fillRect(0, 0, startX, canvas.height);
				}

				// Dim right of selection
				if (endX < canvas.width) {
					ctx.fillRect(endX, 0, canvas.width - endX, canvas.height);
				}

				// Highlight the selected region with subtle blue tint
				const regionWidth = endX - startX;
				ctx.fillStyle = "rgba(59, 130, 246, 0.15)"; // Blue, 15% opacity
				ctx.fillRect(startX, 0, regionWidth, canvas.height);

				// Draw vertical lines at selection boundaries
				ctx.strokeStyle = "#3b82f6"; // Blue
				ctx.lineWidth = 2 * dpr;
				ctx.setLineDash([]);

				// Start boundary
				ctx.beginPath();
				ctx.moveTo(Math.round(startX), 0);
				ctx.lineTo(Math.round(startX), canvas.height);
				ctx.stroke();

				// End boundary
				ctx.beginPath();
				ctx.moveTo(Math.round(endX), 0);
				ctx.lineTo(Math.round(endX), canvas.height);
				ctx.stroke();
			}
		}
	};

	// Re-render when data changes or image loads
	useEffect(() => {
		if (isImageLoaded) {
			// Defer rendering to next frame to ensure container is properly sized
			requestAnimationFrame(() => renderWaveform());
		}
	}, [isImageLoaded, currentTime, previewTime, duration, rangeSelection?.selection]);

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
