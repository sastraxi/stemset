import { useCallback, useEffect, useRef } from "react";

/**
 * Hook for DPI-aware canvas rendering with automatic resizing
 */
export interface CanvasRendererOptions {
	onRender: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, dpr: number) => void;
	dependencies?: React.DependencyList;
	height?: number; // Fixed height in CSS pixels, or undefined for container height
}

export function useCanvasRenderer({
	onRender,
	dependencies = [],
	height,
}: CanvasRendererOptions) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const render = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) return;

		// Get dimensions
		const container = containerRef.current || canvas.parentElement;
		if (!container) return;

		const rect = container.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		// Skip if no dimensions yet
		if (rect.width === 0 || (height === undefined && rect.height === 0)) {
			return;
		}

		// Set canvas size (DPI-aware)
		canvas.width = rect.width * dpr;
		canvas.height = (height !== undefined ? height : rect.height) * dpr;

		// Call render function
		onRender(ctx, canvas, dpr);
	}, [onRender, height]);

	// Re-render when dependencies change
	useEffect(() => {
		render();
	}, [render, ...dependencies]);

	// Watch for size changes with ResizeObserver
	useEffect(() => {
		const container = containerRef.current || canvasRef.current?.parentElement;
		if (!container) return;

		const resizeObserver = new ResizeObserver(() => {
			render();
		});

		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
		};
	}, [render]);

	return { canvasRef, containerRef };
}
