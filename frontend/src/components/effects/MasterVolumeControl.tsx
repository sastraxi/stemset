import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useState } from "react";
import { VolumeSlider } from "../VolumeSlider";
import type { SoftClipperConfig, SoftClipperCurve } from "@/types";

export interface MasterVolumeControlProps {
	volume: number; // 0 to 1 (linear)
	onVolumeChange: (volume: number) => void;
	softClipperConfig?: SoftClipperConfig;
	onSoftClipperUpdate?: (changes: Partial<SoftClipperConfig>) => void;
	onSoftClipperReset?: () => void;
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
	softClipperConfig,
	onSoftClipperUpdate,
	onSoftClipperReset,
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

	const curveOptions: { value: SoftClipperCurve; label: string; description: string }[] = [
		{ value: "tanh", label: "Tanh", description: "Smooth, natural tape-like saturation" },
		{ value: "atan", label: "Atan", description: "Gentler, more transparent saturation" },
		{ value: "cubic", label: "Cubic", description: "Classic analog-style with pleasant harmonics" },
	];

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

			{/* Soft Clipper Controls */}
			{softClipperConfig && onSoftClipperUpdate && (
				<div className="soft-clipper-section">
					<div className="effect-header">
						<h5>Soft Clipper</h5>
						<div className="effect-controls">
							<button
								type="button"
								onClick={() => onSoftClipperUpdate({ enabled: !softClipperConfig.enabled })}
								className={`enable-button ${softClipperConfig.enabled ? "enabled" : ""}`}
								title={softClipperConfig.enabled ? "Disable soft clipper" : "Enable soft clipper"}
							>
								{softClipperConfig.enabled ? "ON" : "OFF"}
							</button>
							{onSoftClipperReset && (
								<button
									type="button"
									onClick={onSoftClipperReset}
									className="reset-button"
									title="Reset to defaults"
								>
									Reset
								</button>
							)}
						</div>
					</div>

					{softClipperConfig.enabled && (
						<div className="soft-clipper-controls">
							{/* Threshold */}
							<div className="control-row">
								<div className="control-label">
									Threshold: {(softClipperConfig.threshold * 100).toFixed(0)}%
								</div>
								<input
									type="range"
									min="10"
									max="100"
									step="1"
									value={softClipperConfig.threshold * 100}
									onChange={(e) =>
										onSoftClipperUpdate({ threshold: Number.parseInt(e.target.value, 10) / 100 })
									}
									className="range-slider"
									aria-label="Soft clipper threshold"
								/>
							</div>

							{/* Drive */}
							<div className="control-row">
								<div className="control-label">
									Drive: {softClipperConfig.drive.toFixed(1)}x
								</div>
								<input
									type="range"
									min="10"
									max="100"
									step="1"
									value={(softClipperConfig.drive - 1) * 100 / 9}
									onChange={(e) =>
										onSoftClipperUpdate({ drive: 1 + (Number.parseInt(e.target.value, 10) / 100) * 9 })
									}
									className="range-slider"
									aria-label="Soft clipper drive"
								/>
							</div>

							{/* Mix */}
							<div className="control-row">
								<div className="control-label">
									Mix: {(softClipperConfig.mix * 100).toFixed(0)}%
								</div>
								<input
									type="range"
									min="0"
									max="100"
									step="1"
									value={softClipperConfig.mix * 100}
									onChange={(e) =>
										onSoftClipperUpdate({ mix: Number.parseInt(e.target.value, 10) / 100 })
									}
									className="range-slider"
									aria-label="Soft clipper dry/wet mix"
								/>
							</div>

							{/* Curve selector */}
							<div className="control-row">
								<div className="control-label">Curve</div>
								<div className="curve-selector">
									{curveOptions.map((option) => (
										<button
											key={option.value}
											type="button"
											onClick={() => onSoftClipperUpdate({ curve: option.value })}
											className={`curve-button ${softClipperConfig.curve === option.value ? "active" : ""}`}
											title={option.description}
										>
											{option.label}
										</button>
									))}
								</div>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
