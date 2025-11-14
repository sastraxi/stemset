import { useState } from "react";

interface TimecodeDisplayProps {
	currentTime: number;
	duration: number;
	formatTime: (time: number) => string;
	className?: string;
}

/**
 * TimecodeDisplay - Clickable VCR-style timecode
 *
 * Toggles between elapsed time and time remaining.
 * Extracted from VCRDisplay for reuse in song clips.
 */
export function TimecodeDisplay({
	currentTime,
	duration,
	formatTime,
	className = "",
}: TimecodeDisplayProps) {
	const [showTimeRemaining, setShowTimeRemaining] = useState(true);

	const handleToggle = () => {
		setShowTimeRemaining((prev) => !prev);
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: WIP
		// biome-ignore lint/a11y/noStaticElementInteractions: WIP
		<div
			className={`timecode-display ${className}`}
			onClick={handleToggle}
			title="Click to toggle time remaining"
		>
			{showTimeRemaining
				? `-${formatTime(duration - currentTime)}`
				: formatTime(currentTime)}
		</div>
	);
}
