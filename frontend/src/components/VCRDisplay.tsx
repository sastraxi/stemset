import { QrCode } from "lucide-react";
import { Button } from "./ui/button";

interface VCRDisplayProps {
	currentTime: number;
	duration: number;
	formatTime: (time: number) => string;
	showTimeRemaining: boolean;
	onToggleTimeDisplay: () => void;
	isPlaying: boolean;
	onPlay: () => void;
	onPause: () => void;
	onStop: () => void;
	onShowQR?: () => void;
	disabled?: boolean;
}

export function VCRDisplay({
	currentTime,
	duration,
	formatTime,
	showTimeRemaining,
	onToggleTimeDisplay,
	isPlaying,
	onPlay,
	onPause,
	onStop,
	onShowQR,
	disabled = false,
}: VCRDisplayProps) {
	return (
		<div className="vcr-display">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
			<div
				className="vcr-timecode"
				onClick={onToggleTimeDisplay}
				title="Click to toggle time remaining"
			>
				{showTimeRemaining
					? `-${formatTime(duration - currentTime)}`
					: formatTime(currentTime)}
			</div>
			<div className="vcr-actions">
				<Button
					type="button"
					onClick={isPlaying ? onPause : onPlay}
					disabled={disabled}
					title={isPlaying ? "Pause" : "Play"}
					className="vcr-button"
					variant="outline"
				>
					{isPlaying ? "⏸" : "▶"}
				</Button>
				<Button
					type="button"
					onClick={onStop}
					disabled={disabled || (!isPlaying && currentTime === 0)}
					title="Reset"
					className="vcr-button"
					variant="outline"
				>
					⏹
				</Button>
				{onShowQR && (
					<Button
						type="button"
						onClick={onShowQR}
						disabled={disabled}
						title="Share track"
						className="vcr-button"
						variant="outline"
					>
						<QrCode className="h-4 w-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
