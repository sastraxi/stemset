import { useEffect, useState } from "react";
import { STEM_COLORS } from "../audio/constants";
import { loadWaveformImage } from "../canvas/imageLoader";
import { useCanvasRenderer } from "../canvas/useCanvasRenderer";
import type { RangeSelectionContext } from "../canvas/useCanvasInteraction";
import { useCanvasInteraction } from "../canvas/useCanvasInteraction";
import {
	calculateClipBounds,
	drawCursor,
	drawRangeSelection,
	drawTimeGrid,
} from "../canvas/waveformUtils";

export interface StemWaveformData {
	stemType: string;
	waveformUrl: string;
}

export interface CompositeWaveformProps {
	stems: StemWaveformData[];
	currentTime: number;
	duration: number;
	previewTime?: number;
	onSeek?: (time: number) => void;
	onPreview?: (time: number | null) => void;
	rangeSelection?: RangeSelectionContext | null;
	startTimeSec?: number; // For clips
	endTimeSec?: number;
	fullDuration?: number;
	height?: number; // Fixed height in pixels
	className?: string;
}

/**
 * CompositeWaveform - Renders all stems into a single canvas with blend modes
 * Creates a colorful overlay effect by blending stem waveforms together
 */
export function CompositeWaveform({
	stems,
	currentTime,
	duration,
	previewTime,
	onSeek,
	onPreview,
	rangeSelection,
	startTimeSec,
	endTimeSec,
	fullDuration,
	height,
	className = "",
}: CompositeWaveformProps) {
	const [loadedImages, setLoadedImages] = useState<
		Map<string, HTMLImageElement>
	>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	// Load all waveform images
	// Use stable key based on URLs to prevent reloading
	const stemKey = stems.map((s) => s.waveformUrl).join("|");

	useEffect(() => {
		setIsLoading(true);
		let cancelled = false;

		const imagePromises = stems.map(async (stem) => {
			try {
				const img = await loadWaveformImage(stem.waveformUrl);
				return [stem.stemType, img] as [string, HTMLImageElement];
			} catch (error) {
				console.error(`[CompositeWaveform] Error loading ${stem.stemType}:`, error);
				return null;
			}
		});

		Promise.all(imagePromises).then((results) => {
			if (cancelled) return;

			const imageMap = new Map<string, HTMLImageElement>();
			for (const result of results) {
				if (result) {
					imageMap.set(result[0], result[1]);
				}
			}
			setLoadedImages(imageMap);
			setIsLoading(false);
		});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stemKey]);

	// Render function
	const onRender = (
		ctx: CanvasRenderingContext2D,
		canvas: HTMLCanvasElement,
		dpr: number,
	) => {
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (isLoading || loadedImages.size === 0) return;

		const displayTime = previewTime !== undefined ? previewTime : currentTime;
		const progress = duration > 0 ? displayTime / duration : 0;
		const cursorX = progress * canvas.width;

		// Render each stem waveform with blend mode
		// Use lighten blend mode to sum stems (brighter values win)
		let firstStem = true;
		for (const [stemType, img] of loadedImages) {
			const stemColor = STEM_COLORS[stemType] || "#4a9eff";

			// Calculate clip bounds for this stem
			const { srcX, srcWidth, srcY, srcHeight } = calculateClipBounds(
				img,
				startTimeSec,
				endTimeSec,
				fullDuration,
				duration,
			);

			// Create an offscreen canvas to color the waveform
			const offscreen = document.createElement("canvas");
			offscreen.width = canvas.width;
			offscreen.height = canvas.height;
			const offCtx = offscreen.getContext("2d");
			if (!offCtx) continue;

			// Draw waveform image to offscreen
			offCtx.drawImage(
				img,
				srcX,
				srcY,
				srcWidth,
				srcHeight,
				0,
				0,
				offscreen.width,
				offscreen.height,
			);

			// Apply stem color
			offCtx.globalCompositeOperation = "source-in";
			offCtx.fillStyle = stemColor;
			offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

			// Composite onto main canvas with lighten mode (except first stem)
			ctx.globalCompositeOperation = firstStem ? "source-over" : "lighten";
			ctx.drawImage(offscreen, 0, 0);
			firstStem = false;
		}

		// Reset composite mode for overlays
		ctx.globalCompositeOperation = "source-over";

		// TIME GRID: Vertical lines (drawn behind waveform)
		ctx.globalCompositeOperation = "destination-over";
		drawTimeGrid(ctx, canvas, duration, dpr);

		// Reset for cursor drawing
		ctx.globalCompositeOperation = "source-over";

		// CURSOR: Dashed white vertical line
		drawCursor(ctx, canvas, cursorX, dpr);

		// RANGE SELECTION: Highlight and dim
		if (rangeSelection) {
			drawRangeSelection(ctx, canvas, rangeSelection.selection, duration, dpr);
		}
	};

	const { canvasRef, containerRef } = useCanvasRenderer({
		onRender,
		dependencies: [
			isLoading,
			loadedImages,
			currentTime,
			previewTime,
			duration,
			rangeSelection?.selection,
		],
		height, // Pass fixed height to renderer
	});

	const { handleMouseDown, handleMouseMove, handleMouseUp } =
		useCanvasInteraction({
			canvasRef,
			duration,
			onSeek,
			onPreview,
			rangeSelection,
		});

	if (isLoading) {
		return (
			<div className={`waveform-container ${className}`}>
				<div className="waveform-placeholder">Loading...</div>
			</div>
		);
	}

	return (
		<div ref={containerRef} className={`waveform-container ${className}`}>
			<canvas
				ref={canvasRef}
				className="waveform-canvas"
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onTouchStart={handleMouseDown}
				onTouchMove={handleMouseMove}
				onTouchEnd={handleMouseUp}
				style={{ mixBlendMode: "normal" }} // The blending happens within canvas, not at CSS level
			/>
		</div>
	);
}
