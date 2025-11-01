import { useState, useRef, useEffect } from "react";

interface MobileVolumeControlProps {
	volume: number; // Linear volume
	onVolumeChange: (volume: number) => void;
	isMuted: boolean;
	onToggleMute: () => void; // Toggle mute callback
	max?: number; // Maximum volume value (default: 2 for stems, use 1 for master volume)
}

// Constants for drag behavior
const DRAG_HEIGHT = 160; // Total vertical drag distance in pixels
const MIN_LINEAR = 0;

// Convert linear volume to logarithmic (for display)
function linearToLog(linear: number, max: number): number {
	if (linear <= 0) return 0;
	// Map linear 0-max to log scale 0-1
	// Normalize to 0-1 range first
	const normalized = linear / max;
	// Apply logarithmic scaling
	return Math.log10(normalized * 9 + 1);
}

// Get gradient color based on volume level (log scale)
function getVolumeColor(volume: number, max: number): string {
	const logVolume = linearToLog(volume, max);

	if (logVolume <= 0.5) {
		// Blue to cyan (0% - 50%)
		const t = logVolume * 2;
		return `rgb(${74 + (58 - 74) * t}, ${158 + (180 - 158) * t}, 255)`;
	} else {
		// Cyan to orange (50% - 100%)
		const t = (logVolume - 0.5) * 2;
		return `rgb(${58 + (255 - 58) * t}, ${180 + (140 - 180) * t}, ${255 + (60 - 255) * t})`;
	}
}

const BUTTON_HEIGHT = 22;
const ICON_HEIGHT = 16;

const UNUSED_PORTION = ICON_HEIGHT / (2 * BUTTON_HEIGHT); // Portion of icon height that is not filled

export function MobileVolumeControl({
	volume,
	onVolumeChange,
	isMuted,
	onToggleMute,
	max = 2,
}: MobileVolumeControlProps) {
	const [isDragging, setIsDragging] = useState(false);
	const buttonRef = useRef<HTMLDivElement>(null);
	const dragStartY = useRef<number>(0);
	const dragStartVolume = useRef<number>(0);
	const hasDraggedRef = useRef<boolean>(false);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent | TouchEvent) => {
			const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
			const deltaY = dragStartY.current - clientY; // Inverted: drag up = increase

			// If we've moved more than a few pixels, consider it a drag
			if (Math.abs(deltaY) > 3) {
				hasDraggedRef.current = true;
			}

			const deltaVolume = (deltaY / DRAG_HEIGHT) * (max - MIN_LINEAR);
			const newVolume = Math.max(
				MIN_LINEAR,
				Math.min(max, dragStartVolume.current + deltaVolume),
			);
			onVolumeChange(newVolume);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
		document.addEventListener("touchmove", handleMouseMove);
		document.addEventListener("touchend", handleMouseUp);

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
			document.removeEventListener("touchmove", handleMouseMove);
			document.removeEventListener("touchend", handleMouseUp);
		};
	}, [isDragging, onVolumeChange, max]);

	const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
		setIsDragging(true);
		hasDraggedRef.current = false;
		dragStartY.current = "touches" in e ? e.touches[0].clientY : e.clientY;
		dragStartVolume.current = volume;
	};

	const handleClick = () => {
		// Only trigger mute if we didn't drag
		if (!hasDraggedRef.current) {
			onToggleMute();
		}
		hasDraggedRef.current = false;
	};

	const logVolume = linearToLog(volume, max);
	const fillPercentage = logVolume * 100;
	const iconPercentage =
		(Math.max(0, logVolume - 0.5 * UNUSED_PORTION) / (1 - UNUSED_PORTION)) *
		100;
	const color = isMuted ? "#ff6666" : getVolumeColor(volume, max);
	const volumePercentage = Math.round((volume / max) * 100);

	const volumeIcon = (
		<>
			<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
			{!isMuted && volume > 0 && (
				<>
					<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
					{volume > max * 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
				</>
			)}
		</>
	);

	return (
		<div
			ref={buttonRef}
			className="mobile-volume-button"
			onMouseDown={handleMouseDown}
			onTouchStart={handleMouseDown}
			onClick={handleClick}
			style={{
				borderColor: color,
				background: isMuted
					? "rgba(255, 102, 102, 0.2)"
					: `linear-gradient(to top, ${color.replace("rgb", "rgba").replace(")", ", 0.75)")} ${fillPercentage}%, transparent ${fillPercentage}%)`,
				cursor: isDragging ? "grabbing" : "grab",
				touchAction: "none",
				userSelect: "none",
				position: "relative",
				overflow: "hidden",
			}}
			title={
				isMuted
					? "Muted (click to unmute)"
					: `Volume: ${volumePercentage}% (click to mute)`
			}
		>
			{isMuted ? (
				/* When muted, show single bright red icon */
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{
						color: "#ff6666",
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						pointerEvents: "none",
					}}
				>
					{volumeIcon}
				</svg>
			) : (
				<>
					{/* Non-filled icon (visible in unfilled area) */}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{
							color: "rgb(136, 136, 136)",
							position: "absolute",
							top: "50%",
							left: "50%",
							transform: "translate(-50%, -50%)",
							pointerEvents: "none",
						}}
					>
						{volumeIcon}
					</svg>
					{/* Filled icon (clipped) - uses background color for contrast */}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{
							color: "#000",
							position: "absolute",
							top: "50%",
							left: "50%",
							transform: "translate(-50%, -50%)",
							clipPath: `inset(${100 - iconPercentage}% 0 0 0)`,
							pointerEvents: "none",
						}}
					>
						{volumeIcon}
					</svg>
				</>
			)}
		</div>
	);
}
