import { Pause, Play, Square } from "lucide-react";
import { Button } from "./ui/button";
import { VuMeter } from "./VuMeter";
import type { VuMeterLevels } from "../hooks/useVuMeter";

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
	disabled?: boolean;
	vuMeterLevels: VuMeterLevels;
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
	disabled = false,
	vuMeterLevels,
}: VCRDisplayProps) {
	return (
		<div className="vcr-display">
			{/* Desktop: Stacked layout */}
			<div className="vcr-desktop-layout">
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
				<VuMeter levels={vuMeterLevels} />
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
				</div>
			</div>

			{/* Mobile: Centered layout with flanking buttons */}
			<div className="vcr-mobile-layout">
				<VuMeter levels={vuMeterLevels} />
				<Button
					type="button"
					onClick={isPlaying ? onPause : onPlay}
					disabled={disabled}
					title={isPlaying ? "Pause" : "Play"}
					className="vcr-button-mobile"
					variant="outline"
				>
					{isPlaying ? (
						<Pause className="h-4 w-4 fill-current" />
					) : (
						<Play className="h-4 w-4 fill-current" />
					)}
				</Button>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
				<div
					className="vcr-timecode-mobile"
					onClick={onToggleTimeDisplay}
					title="Click to toggle time remaining"
				>
					{showTimeRemaining
						? `-${formatTime(duration - currentTime)}`
						: formatTime(currentTime)}
				</div>
				<Button
					type="button"
					onClick={onStop}
					disabled={disabled || (!isPlaying && currentTime === 0)}
					title="Reset"
					className="vcr-button-mobile"
					variant="outline"
				>
					<Square className="h-4 w-4 fill-current" />
				</Button>
			</div>
		</div>
	);
}
