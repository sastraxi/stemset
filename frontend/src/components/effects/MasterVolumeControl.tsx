import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useState } from "react";
import { VolumeSlider } from "../VolumeSlider";

export interface MasterVolumeControlProps {
	volume: number; // 0 to 1 (linear)
	onVolumeChange: (volume: number) => void;
}

/**
 * Convert linear volume (0-1) to dB.
 * - volume=0 → -∞ dB
 * - volume=1 → 0 dB (unity gain)
 */
function volumeToDb(volume: number): string {
	if (volume === 0) return "-∞";
	const db = 20 * Math.log10(volume);
	return db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
}

/**
 * Master volume control with triangular slider area.
 *
 * Features:
 * - Wide, short triangle shape as range slider area
 * - Exponential volume scaling for better perceptual control
 * - WCAG-compliant with keyboard support and ARIA labels
 * - Mute toggle button
 */
export function MasterVolumeControl({
	volume,
	onVolumeChange,
}: MasterVolumeControlProps) {
	const [volumeBeforeMute, setVolumeBeforeMute] = useState(1);

	// Mute is derived from volume being exactly 0
	const isMuted = volume === 0;

	const handleToggleMute = useCallback(() => {
		if (isMuted) {
			// Unmute: restore previous volume (or default to 0.7 if none saved)
			onVolumeChange(volumeBeforeMute > 0 ? volumeBeforeMute : 0.7);
		} else {
			// Mute: save current volume and set to 0
			setVolumeBeforeMute(volume);
			onVolumeChange(0);
		}
	}, [isMuted, volume, volumeBeforeMute, onVolumeChange]);

	const handleVolumeChange = useCallback(
		(newVolume: number) => {
			// If changing volume from 0 (muted), update volumeBeforeMute
			if (newVolume > 0 && isMuted) {
				setVolumeBeforeMute(newVolume);
			}
			onVolumeChange(newVolume / 2.0); // Convert 0-2 range to 0-1
		},
		[isMuted, onVolumeChange],
	);

	return (
		<div className="master-volume-section">
			<div className="master-volume-header">
				<h4>Master Volume</h4>
				<div className="effect-controls">
					<button
						type="button"
						onClick={handleToggleMute}
						className={`mute-button ${isMuted ? "muted" : ""}`}
						title={isMuted ? "Unmute" : "Mute"}
						aria-label={isMuted ? "Unmute" : "Mute"}
					>
						{isMuted ? (
							<VolumeX className="h-4 w-4" color="#ff6666" />
						) : (
							<Volume2 className="h-4 w-4" />
						)}
					</button>
				</div>
			</div>

			<div className="master-volume-controls">
				<VolumeSlider
					volume={volume * 2.0}
					onVolumeChange={handleVolumeChange}
					size="large"
					isMuted={isMuted}
				/>

				<div className="volume-value">
					{isMuted ? "Muted" : `${volumeToDb(volume)} dB`}
				</div>
			</div>
		</div>
	);
}
