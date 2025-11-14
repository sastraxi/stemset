import { useCallback, useEffect, useRef, useState } from "react";

export type DragMode = "seek" | "select" | null;

export interface RangeSelectionContext {
	selection: { startSec: number | null; endSec: number | null };
	setRange: (startSec: number, endSec: number) => void;
	setIsSelecting: (isSelecting: boolean) => void;
}

export interface CanvasInteractionOptions {
	canvasRef: React.RefObject<HTMLCanvasElement>;
	duration: number;
	onSeek?: (time: number) => void;
	onPreview?: (time: number | null) => void;
	rangeSelection?: RangeSelectionContext | null;
	dragThreshold?: number; // Pixels to drag before it counts as a drag (default: 5)
}

/**
 * Hook for handling canvas mouse/touch interactions for seeking and range selection
 */
export function useCanvasInteraction({
	canvasRef,
	duration,
	onSeek,
	onPreview,
	rangeSelection,
	dragThreshold = 5,
}: CanvasInteractionOptions) {
	const [isDragging, setIsDragging] = useState(false);
	const [dragMode, setDragMode] = useState<DragMode>(null);
	const dragStartPos = useRef<{ x: number; time: number } | null>(null);

	// Convert client X position to seek time
	const getSeekTime = useCallback(
		(clientX: number): number | null => {
			const canvas = canvasRef.current;
			if (!canvas || duration === 0) return null;

			const rect = canvas.getBoundingClientRect();
			const x = clientX - rect.left;
			const progress = Math.max(0, Math.min(x / rect.width, 1));
			return progress * duration;
		},
		[canvasRef, duration],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			if (!onSeek || !onPreview) return;

			e.preventDefault();
			setIsDragging(true);
			setDragMode(null);

			const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
			const seekTime = getSeekTime(clientX);

			if (seekTime !== null) {
				dragStartPos.current = { x: clientX, time: seekTime };

				// Start selecting if range selection is available
				if (rangeSelection) {
					rangeSelection.setIsSelecting(true);
				} else {
					onPreview(seekTime);
				}
			}
		},
		[onSeek, onPreview, getSeekTime, rangeSelection],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			if (!isDragging) return;

			e.preventDefault();
			const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
			const seekTime = getSeekTime(clientX);

			if (seekTime === null || !dragStartPos.current) return;

			// Determine drag mode if not yet set
			if (dragMode === null) {
				const dragDistance = Math.abs(clientX - dragStartPos.current.x);
				if (dragDistance > dragThreshold) {
					if (rangeSelection) {
						setDragMode("select");
					} else {
						setDragMode("seek");
						onPreview?.(dragStartPos.current.time);
					}
				}
			}

			// Handle based on mode
			if (dragMode === "select" && rangeSelection) {
				rangeSelection.setRange(dragStartPos.current.time, seekTime);
			} else if (dragMode === "seek") {
				onPreview?.(seekTime);
			}
		},
		[isDragging, dragMode, getSeekTime, onPreview, rangeSelection, dragThreshold],
	);

	const handleMouseUp = useCallback(() => {
		if (isDragging) {
			// Click (not drag)
			if (dragMode === null && dragStartPos.current && onSeek) {
				onSeek(dragStartPos.current.time);
				onPreview?.(null);
			}
			// Commit seek
			else if (dragMode === "seek" && onSeek && onPreview) {
				// Preview time should be the last previewed value
				const canvas = canvasRef.current;
				if (canvas) {
					onSeek(dragStartPos.current!.time);
					onPreview(null);
				}
			}
			// End selection
			else if (dragMode === "select" && rangeSelection) {
				rangeSelection.setIsSelecting(false);
			}

			// Reset state
			setIsDragging(false);
			setDragMode(null);
			dragStartPos.current = null;
		}
	}, [isDragging, dragMode, onSeek, onPreview, rangeSelection, canvasRef]);

	// Global event handlers for dragging outside canvas
	useEffect(() => {
		if (!isDragging) return;

		const handleGlobalMouseUp = () => handleMouseUp();

		const handleGlobalMouseMove = (e: MouseEvent) => {
			const seekTime = getSeekTime(e.clientX);
			if (seekTime === null || !dragStartPos.current) return;

			// Determine drag mode
			if (dragMode === null) {
				const dragDistance = Math.abs(e.clientX - dragStartPos.current.x);
				if (dragDistance > dragThreshold) {
					if (rangeSelection) {
						setDragMode("select");
					} else {
						setDragMode("seek");
						onPreview?.(dragStartPos.current.time);
					}
				}
			}

			// Handle based on mode
			if (dragMode === "select" && rangeSelection) {
				rangeSelection.setRange(dragStartPos.current.time, seekTime);
			} else if (dragMode === "seek") {
				onPreview?.(seekTime);
			}
		};

		const handleGlobalTouchMove = (e: TouchEvent) => {
			e.preventDefault();
			const seekTime = getSeekTime(e.touches[0].clientX);
			if (seekTime === null || !dragStartPos.current) return;

			// Determine drag mode
			if (dragMode === null) {
				const dragDistance = Math.abs(
					e.touches[0].clientX - dragStartPos.current.x,
				);
				if (dragDistance > dragThreshold) {
					if (rangeSelection) {
						setDragMode("select");
					} else {
						setDragMode("seek");
						onPreview?.(dragStartPos.current.time);
					}
				}
			}

			// Handle based on mode
			if (dragMode === "select" && rangeSelection) {
				rangeSelection.setRange(dragStartPos.current.time, seekTime);
			} else if (dragMode === "seek") {
				onPreview?.(seekTime);
			}
		};

		const handleGlobalTouchEnd = () => handleMouseUp();

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
	}, [
		isDragging,
		dragMode,
		getSeekTime,
		handleMouseUp,
		onPreview,
		rangeSelection,
		dragThreshold,
	]);

	return {
		isDragging,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
	};
}
