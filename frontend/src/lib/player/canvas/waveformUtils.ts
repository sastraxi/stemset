import { CURSOR_COLOR, SELECTION_COLOR } from "../audio/constants";

/**
 * Clip bounds for rendering a portion of a waveform image
 */
export interface ClipBounds {
	srcX: number;
	srcWidth: number;
	srcY: number;
	srcHeight: number;
}

/**
 * Calculate source rectangle bounds for rendering clip portions of waveform images
 */
export function calculateClipBounds(
	img: HTMLImageElement,
	startTimeSec?: number,
	endTimeSec?: number,
	fullDuration?: number,
	duration?: number,
): ClipBounds {
	const isClip =
		startTimeSec !== undefined &&
		endTimeSec !== undefined &&
		fullDuration !== undefined;
	const clipStart = isClip ? startTimeSec : 0;
	const clipEnd = isClip ? endTimeSec : fullDuration || duration || 0;
	const clipDuration = clipEnd - clipStart;
	const totalDuration = fullDuration || duration || 0;

	const srcX = isClip ? (clipStart / totalDuration) * img.width : 0;
	const srcWidth = isClip
		? (clipDuration / totalDuration) * img.width
		: img.width;

	return {
		srcX,
		srcWidth,
		srcY: 0,
		srcHeight: img.height,
	};
}

/**
 * Draw time grid lines (60s, 30s, 15s intervals) behind waveform
 */
export function drawTimeGrid(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	duration: number,
	dpr: number,
) {
	if (duration <= 0) return;

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
			ctx.setLineDash(dotted ? [3 * dpr, 3 * dpr] : []);
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, canvas.height);
			ctx.stroke();
		}
	};

	for (let time = 0; time <= duration; time += 15) {
		if (time % 60 === 0) {
			// Every minute - solid line with 15% opacity
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

/**
 * Draw playback cursor as a dashed vertical line
 */
export function drawCursor(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	cursorX: number,
	dpr: number,
	color: string = CURSOR_COLOR,
) {
	ctx.strokeStyle = color;
	ctx.lineWidth = 2 * dpr;
	ctx.setLineDash([3 * dpr, 3 * dpr]);
	ctx.beginPath();
	ctx.moveTo(Math.round(cursorX), 0);
	ctx.lineTo(Math.round(cursorX), canvas.height);
	ctx.stroke();
	ctx.setLineDash([]);
}

/**
 * Draw range selection overlay (dims outside, highlights inside)
 */
export function drawRangeSelection(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	selection: { startSec: number | null; endSec: number | null },
	duration: number,
	dpr: number,
) {
	const { startSec, endSec } = selection;

	if (startSec === null || endSec === null || duration <= 0) return;

	const startX = (startSec / duration) * canvas.width;
	const endX = (endSec / duration) * canvas.width;

	// Dim regions outside the selection
	ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
	if (startX > 0) {
		ctx.fillRect(0, 0, startX, canvas.height);
	}
	if (endX < canvas.width) {
		ctx.fillRect(endX, 0, canvas.width - endX, canvas.height);
	}

	// Highlight the selected region
	const regionWidth = endX - startX;
	ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
	ctx.fillRect(startX, 0, regionWidth, canvas.height);

	// Draw vertical lines at selection boundaries
	ctx.strokeStyle = SELECTION_COLOR;
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
