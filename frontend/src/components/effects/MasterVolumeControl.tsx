import { useState, useRef, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";

export interface MasterVolumeControlProps {
	volume: number; // 0 to 1 (linear)
	onVolumeChange: (volume: number) => void;
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
	const [isDragging, setIsDragging] = useState(false);
	const [volumeBeforeMute, setVolumeBeforeMute] = useState(1);
	const svgRef = useRef<SVGSVGElement>(null);

	// Mute is derived from volume being exactly 0
	const isMuted = volume === 0;

	// Triangle dimensions (wide and short)
	const width = 200;
	const height = 40;
	const padding = 8; // Padding to prevent clipping of stroke and handle
	const cornerRadius = 8; // Rounded corner radius

	/**
	 * Convert linear volume (0-1) to exponential (perceived volume).
	 * Uses power curve: perceived = linear^2
	 * This makes the slider feel more natural to users.
	 */
	const linearToExponential = (linear: number): number => {
		return Math.pow(linear, 2);
	};

	/**
	 * Convert exponential (perceived) volume to linear (0-1).
	 * Inverse of linearToExponential: linear = sqrt(perceived)
	 */
	const exponentialToLinear = (exponential: number): number => {
		return Math.sqrt(Math.max(0, Math.min(1, exponential)));
	};

	// Current position on slider (0-1, where 0 is left/silent, 1 is right/loud)
	const sliderPosition = exponentialToLinear(volume);

	/**
	 * Handle mouse/touch position and convert to volume value.
	 * The triangle is wider at the base (right side = louder).
	 */
	const handlePointerMove = useCallback(
		(clientX: number) => {
			if (!svgRef.current) return;

			const rect = svgRef.current.getBoundingClientRect();
			const x = clientX - rect.left;

			// Clamp position to triangle bounds
			const normalizedX = Math.max(0, Math.min(1, x / width));

			// Convert position to exponential volume
			const newVolume = linearToExponential(normalizedX);
			onVolumeChange(newVolume);
		},
		[onVolumeChange, width],
	);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			setIsDragging(true);
			handlePointerMove(e.clientX);
			// Capture pointer to continue receiving events outside element
			e.currentTarget.setPointerCapture(e.pointerId);
		},
		[handlePointerMove],
	);

	const handlePointerMoveEvent = useCallback(
		(e: React.PointerEvent) => {
			if (isDragging) {
				handlePointerMove(e.clientX);
			}
		},
		[isDragging, handlePointerMove],
	);

	const handlePointerUp = useCallback((e: React.PointerEvent) => {
		setIsDragging(false);
		e.currentTarget.releasePointerCapture(e.pointerId);
	}, []);

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

	// Keyboard support for accessibility
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			let delta = 0;

			switch (e.key) {
				case "ArrowRight":
				case "ArrowUp":
					delta = 0.05; // 5% increase
					e.preventDefault();
					break;
				case "ArrowLeft":
				case "ArrowDown":
					delta = -0.05; // 5% decrease
					e.preventDefault();
					break;
				case "Home":
					onVolumeChange(0);
					e.preventDefault();
					return;
				case "End":
					onVolumeChange(1);
					e.preventDefault();
					return;
				case "m":
				case "M":
					handleToggleMute();
					e.preventDefault();
					return;
			}

			if (delta !== 0) {
				const newPosition = Math.max(0, Math.min(1, sliderPosition + delta));
				const newVolume = linearToExponential(newPosition);
				onVolumeChange(newVolume);
			}
		},
		[sliderPosition, onVolumeChange, handleToggleMute],
	);

	const displayVolume = volume;
	const displayPosition = sliderPosition;

	// Map visual position to 10%-90% of width to keep indicator within triangle bounds
	const visualPosition = 0.1 + displayPosition * 0.85;

	return (
		<div className="master-volume-section">
			<div className="master-volume-header">
				<h4>Master Volume</h4>
				<div className="effect-controls">
					<button
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
				<svg
					ref={svgRef}
					width={width + padding * 2}
					height={height + padding * 2}
					viewBox={`${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`}
					className="volume-triangle"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMoveEvent}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
					onKeyDown={handleKeyDown}
					tabIndex={0}
					role="slider"
					aria-label="Master volume"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(displayVolume * 100)}
					aria-valuetext={`${Math.round(displayVolume * 100)}%`}
					style={{ cursor: isDragging ? "grabbing" : "pointer" }}
				>
					{/* Rounded triangle background (outline) */}
					<path
						d={`
              M ${cornerRadius},${height}
              L ${width - cornerRadius},${height}
              Q ${width},${height} ${width},${height - cornerRadius}
              L ${width},${cornerRadius}
              Q ${width},0 ${width - cornerRadius},0
              L ${cornerRadius},${height - cornerRadius}
              Q 0,${height} ${cornerRadius},${height}
              Z
            `}
						fill="rgba(0, 0, 0, 0.5)"
						stroke="rgba(255, 255, 255, 0.2)"
						strokeWidth="1"
					/>

					{/* Filled portion of triangle (shows current volume) */}
					<defs>
						<clipPath id="volume-clip">
							<rect
								x="0"
								y="0"
								width={visualPosition * width}
								height={height}
							/>
						</clipPath>
						<linearGradient
							id={`line-gradient-${isMuted ? "muted" : "normal"}`}
							x1="0"
							x2="0"
							y1="-8"
							y2="40"
							gradientUnits="userSpaceOnUse"
						>
							<stop
								offset="0%"
								stopColor={isMuted ? "#ff6666" : "#4a9eff"}
								stopOpacity="0"
							/>
							<stop
								offset="25%"
								stopColor={isMuted ? "#ff6666" : "#4a9eff"}
								stopOpacity="0.8"
							/>
							<stop
								offset="100%"
								stopColor={isMuted ? "#ff6666" : "#4a9eff"}
								stopOpacity="0.8"
							/>
						</linearGradient>
						<linearGradient
							id="volume-fill-gradient"
							x1="0"
							x2="1"
							y1="0"
							y2="0"
							gradientUnits="objectBoundingBox"
						>
							<stop offset="0%" stopColor="#1e90ff" stopOpacity="0.2" />
							<stop offset="60%" stopColor="#17ababff" stopOpacity="0.6" />
							<stop offset="80%" stopColor="#009714ff" stopOpacity="0.87" />
							<stop offset="98%" stopColor="#009714ff" stopOpacity="1" />
							<stop offset="100%" stopColor="#c01d17ff" stopOpacity="0.3" />
						</linearGradient>
						<linearGradient
							id="volume-fill-gradient-muted"
							x1="0"
							x2="1"
							y1="0"
							y2="0"
							gradientUnits="objectBoundingBox"
						>
							<stop offset="0%" stopColor="#ff4444" stopOpacity="0.2" />
							<stop offset="100%" stopColor="#ff4444" stopOpacity="0.4" />
						</linearGradient>
					</defs>
					<path
						d={`
              M ${cornerRadius},${height}
              L ${width - cornerRadius},${height}
              Q ${width},${height} ${width},${height - cornerRadius}
              L ${width},${cornerRadius}
              Q ${width},0 ${width - cornerRadius},0
              L ${cornerRadius},${height - cornerRadius}
              Q 0,${height} ${cornerRadius},${height}
              Z
            `}
						fill={
							isMuted
								? "url(#volume-fill-gradient-muted)"
								: "url(#volume-fill-gradient)"
						}
						clipPath="url(#volume-clip)"
					/>

					{/* Volume indicator line - extends above and fades out */}
					<line
						x1={visualPosition * width}
						y1={-padding}
						x2={visualPosition * width}
						y2={height}
						stroke={`url(#line-gradient-${isMuted ? "muted" : "normal"})`}
						strokeWidth="2"
					/>

					{/* Draggable handle */}
					<circle
						cx={visualPosition * width}
						cy={height - displayPosition * height}
						r="6"
						fill={isMuted ? "#ff6666" : "#4a9eff"}
						stroke="#fff"
						strokeWidth="1.5"
						style={{ cursor: isDragging ? "grabbing" : "grab" }}
					/>
				</svg>

				<div className="volume-value">
					{isMuted ? "Muted" : `${Math.round(displayVolume * 100)}%`}
				</div>
			</div>
		</div>
	);
}
