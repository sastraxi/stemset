import { useCanvasRenderer } from "../canvas/useCanvasRenderer";

export interface MinimalRulerProps {
	currentTime: number;
	duration: number;
	height?: number; // Default: 12px for minimal
	className?: string;
}

/**
 * MinimalRuler - Compact ruler for inline clip playback
 * Features:
 * - Tick marks like a tape measure
 * - Sparse time codes (every 30-60s)
 * - Playback cursor
 * - No interaction (read-only)
 */
export function MinimalRuler({
	currentTime,
	duration,
	height = 12,
	className = "",
}: MinimalRulerProps) {
	const onRender = (
		ctx: CanvasRenderingContext2D,
		canvas: HTMLCanvasElement,
		dpr: number,
	) => {
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// No background - transparent
		const progress = duration > 0 ? currentTime / duration : 0;
		const cursorX = progress * canvas.width;

		// TICK MARKS: Dynamic intervals based on duration and canvas width
		// High-tech SLR lens-style tick marks
		if (duration > 0) {
			// Calculate pixels per second
			const pxPerSecond = canvas.width / duration;

			// Choose tick intervals dynamically
			// Target: major ticks every 30-50px, minor ticks every 10-20px
			let majorInterval: number;
			let minorInterval: number;

			if (pxPerSecond > 10) {
				// High zoom: 5s major, 1s minor
				majorInterval = 5;
				minorInterval = 1;
			} else if (pxPerSecond > 3) {
				// Medium zoom: 10s major, 2s minor
				majorInterval = 10;
				minorInterval = 2;
			} else if (pxPerSecond > 1) {
				// Low zoom: 15s major, 5s minor
				majorInterval = 15;
				minorInterval = 5;
			} else if (pxPerSecond > 0.5) {
				// Very low zoom: 30s major, 10s minor
				majorInterval = 30;
				minorInterval = 10;
			} else {
				// Ultra low zoom: 60s major, 15s minor
				majorInterval = 60;
				minorInterval = 15;
			}

			// Draw minor ticks first (bottom)
			ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
			ctx.lineWidth = 1.5 * dpr;
			for (let time = minorInterval; time <= duration; time += minorInterval) {
				if (time % majorInterval !== 0) {
					const x = Math.round((time / duration) * canvas.width);
					const tickHeight = 3 * dpr;

					ctx.beginPath();
					ctx.moveTo(x, canvas.height);
					ctx.lineTo(x, canvas.height - tickHeight);
					ctx.stroke();
				}
			}

			// Draw major ticks (taller, brighter - like SLR lens markings)
			ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
			ctx.lineWidth = 2 * dpr;
			for (let time = 0; time <= duration; time += majorInterval) {
				const x = Math.round((time / duration) * canvas.width);
				const tickHeight = 8 * dpr;

				ctx.beginPath();
				ctx.moveTo(x, canvas.height);
				ctx.lineTo(x, canvas.height - tickHeight);
				ctx.stroke();
			}
		}

		// CURSOR: Precision indicator line (like focus indicator on lens)
		if (duration > 0) {
			const cursorXRounded = Math.round(cursorX);

			// Sharp vertical line
			ctx.strokeStyle = "rgba(255, 100, 100, 0.9)"; // Red accent like focus indicator
			ctx.lineWidth = 2 * dpr;
			ctx.beginPath();
			ctx.moveTo(cursorXRounded, 0);
			ctx.lineTo(cursorXRounded, canvas.height);
			ctx.stroke();

			// Triangle indicator at top (like lens position marker)
			const triangleSize = 4 * dpr;
			ctx.fillStyle = "rgba(255, 100, 100, 0.9)";
			ctx.beginPath();
			ctx.moveTo(cursorXRounded, 0);
			ctx.lineTo(cursorXRounded - triangleSize, triangleSize);
			ctx.lineTo(cursorXRounded + triangleSize, triangleSize);
			ctx.closePath();
			ctx.fill();
		}
	};

	const { canvasRef, containerRef } = useCanvasRenderer({
		onRender,
		dependencies: [currentTime, duration],
		height,
	});

	return (
		<div ref={containerRef} className={`minimal-ruler ${className}`}>
			<canvas ref={canvasRef} className="ruler-canvas" />
		</div>
	);
}
