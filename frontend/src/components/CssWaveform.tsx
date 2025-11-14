import { useRef, useState, useEffect } from "react";
import { getToken } from "../lib/storage";
import type { StemResponse } from "@/api/generated";

interface CssWaveformProps {
	stems: StemResponse[];
	currentTime: number;
	duration: number;
	previewTime?: number;
	onSeek?: (seconds: number) => void;
	onPreview?: (seconds: number | null) => void;
	startTimeSec?: number; // Clip start time
	endTimeSec?: number; // Clip end time
	fullDuration?: number; // Full recording duration
	height?: number;
}

/**
 * CssWaveform - Pure CSS-based waveform rendering
 *
 * Uses stacked background images with CSS calculations to show clip portions.
 * Zero canvas operations, GPU accelerated, instant rendering.
 */
export function CssWaveform({
	stems,
	currentTime,
	duration,
	previewTime,
	onSeek,
	onPreview,
	startTimeSec = 0,
	endTimeSec,
	fullDuration,
	height = 100,
}: CssWaveformProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const dragStartPos = useRef<{ x: number; time: number } | null>(null);
	const [waveformBlobUrls, setWaveformBlobUrls] = useState<Map<string, string>>(new Map());

	const displayTime = previewTime !== undefined ? previewTime : currentTime;
	const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

	// Calculate positioning for clip portion of waveform
	const clipDuration = endTimeSec ? endTimeSec - startTimeSec : fullDuration || duration;
	const totalDuration = fullDuration || clipDuration;

	// What percentage of the full recording does this clip start at?
	const clipStartFraction = totalDuration > 0 ? startTimeSec / totalDuration : 0;

	// How much wider than the container should the waveform be?
	// If we're showing 20s of a 244s recording, the waveform should be 244/20 = 12.2x wider
	const waveformScale = totalDuration > 0 ? totalDuration / clipDuration : 1;

	// Load waveform images with authentication
	useEffect(() => {
		let cancelled = false;
		const blobUrls: string[] = [];

		const loadWaveforms = async () => {
			const urlMap = new Map<string, string>();

			await Promise.all(
				stems.map(async (stem) => {
					const { waveform_url, stem_type } = stem;

					try {
						// Check if auth is needed
						const isLocalMedia = waveform_url.startsWith("/media");
						const headers: HeadersInit = {};
						if (isLocalMedia) {
							const token = getToken();
							if (token) {
								headers.Authorization = `Bearer ${token}`;
							}
						}

						const response = await fetch(waveform_url, {
							headers,
							cache: "default",
						});

						if (!response.ok) {
							console.error(`Failed to fetch waveform for ${stem_type}: ${response.status}`);
							return;
						}

						const blob = await response.blob();
						const blobUrl = URL.createObjectURL(blob);
						blobUrls.push(blobUrl);

						if (!cancelled) {
							urlMap.set(stem_type, blobUrl);
						}
					} catch (error) {
						console.error(`Error loading waveform for ${stem_type}:`, error);
					}
				}),
			);

			if (!cancelled) {
				setWaveformBlobUrls(urlMap);
			}
		};

		loadWaveforms();

		return () => {
			cancelled = true;
			blobUrls.forEach((url) => URL.revokeObjectURL(url));
		};
	}, [stems]);

	// Seeking logic
	const getSeekTime = (clientX: number) => {
		const container = containerRef.current;
		if (!container || duration === 0) return null;

		const rect = container.getBoundingClientRect();
		const x = clientX - rect.left;
		const progressValue = Math.max(0, Math.min(x / rect.width, 1));
		return progressValue * duration;
	};

	const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
		if (!onSeek || !onPreview) return;

		e.preventDefault();
		setIsDragging(true);
		const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
		const seekTime = getSeekTime(clientX);

		if (seekTime !== null) {
			dragStartPos.current = { x: clientX, time: seekTime };
			onPreview(seekTime);
		}
	};

	const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
		if (!isDragging || !onPreview) return;

		e.preventDefault();
		const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
		const seekTime = getSeekTime(clientX);

		if (seekTime !== null) {
			onPreview(seekTime);
		}
	};

	const handleMouseUp = () => {
		if (isDragging && dragStartPos.current && onSeek && onPreview) {
			const finalTime = previewTime !== undefined ? previewTime : dragStartPos.current.time;
			onSeek(finalTime);
			onPreview(null);
			setIsDragging(false);
			dragStartPos.current = null;
		}
	};

	// Global mouse handlers for dragging outside container
	useEffect(() => {
		if (isDragging) {
			const handleGlobalMouseMove = (e: MouseEvent) => {
				const seekTime = getSeekTime(e.clientX);
				if (seekTime !== null && onPreview) {
					onPreview(seekTime);
				}
			};

			const handleGlobalMouseUp = () => {
				handleMouseUp();
			};

			document.addEventListener("mousemove", handleGlobalMouseMove);
			document.addEventListener("mouseup", handleGlobalMouseUp);

			return () => {
				document.removeEventListener("mousemove", handleGlobalMouseMove);
				document.removeEventListener("mouseup", handleGlobalMouseUp);
			};
		}
	}, [isDragging, onPreview, previewTime]);

	if (stems.length === 0) {
		return (
			<div className="css-waveform-placeholder" style={{ height: `${height}px` }}>
				<span>No stems available</span>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="css-waveform-container"
			style={{ height: `${height}px` }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onTouchStart={handleMouseDown}
			onTouchMove={handleMouseMove}
			onTouchEnd={handleMouseUp}
		>
			{/* Stacked waveform layers */}
			{stems.map((stem) => {
				const blobUrl = waveformBlobUrls.get(stem.stem_type);
				if (!blobUrl) return null;

				// Position the layer:
				// - Make it waveformScale times wider than the container
				// - Shift it left so that clipStartFraction of its width is hidden to the left
				// - This shows the clip portion aligned to the left edge
				return (
					<div
						key={stem.stem_type}
						className="css-waveform-layer"
						style={{
							width: `${waveformScale * 100}%`,
							left: `${-clipStartFraction * waveformScale * 100}%`,
							backgroundImage: `url(${blobUrl})`,
							backgroundSize: '100% 100%',
							backgroundPosition: '0 0',
						}}
					/>
				);
			})}

			{/* Progress overlay */}
			<div className="css-waveform-progress" style={{ width: `${progress}%` }} />

			{/* Playback cursor */}
			<div className="css-waveform-cursor" style={{ left: `${progress}%` }} />
		</div>
	);
}
