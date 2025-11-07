import type { VuMeterLevels } from "../hooks/useVuMeter";

export interface VuMeterProps {
	levels: VuMeterLevels;
	leftClipping?: boolean;
	rightClipping?: boolean;
	onResetClip?: () => void;
}

const SEGMENT_COUNT = 6;

/**
 * Classic 90s bookshelf stereo-style VU meter with LED segments.
 * 6 segments per channel growing outward from center (L to left, R to right).
 * Includes LED-style clip indicators that light up when clipping is detected.
 */
export function VuMeter({ levels, leftClipping = false, rightClipping = false, onResetClip }: VuMeterProps) {
	// Calculate which segments should be lit for a given level (0-1)
	const getLitSegments = (level: number): number => {
		return Math.floor(level * SEGMENT_COUNT);
	};

	// Get color for segment based on its position (0-5)
	const getSegmentColor = (index: number, isLit: boolean): string => {
		if (!isLit) {
			return "#2a2a2a"; // Dark grey when off
		}

		// 0-2: Green
		if (index < 3) {
			return "#22c55e";
		}
		// 3-4: Yellow/Orange
		if (index < 5) {
			return "#eab308";
		}
		// 5: Red/Hot orange
		return "#ff6b35";
	};

	const leftLit = getLitSegments(levels.left);
	const rightLit = getLitSegments(levels.right);

	return (
		<div className="vu-meter">
			<div className="flex items-center gap-2">
				{/* Left clip indicator */}
				<button
					type="button"
					onClick={onResetClip}
					className={`clip-indicator ${leftClipping ? "clipping" : ""}`}
					style={{
						"--clip-bg": leftClipping ? "#ef4444" : "#2a2a2a",
						"--clip-shadow": leftClipping ? "0 0 12px #ef4444" : "none",
						cursor: onResetClip ? "pointer" : "default",
					} as React.CSSProperties}
					title={leftClipping ? "Left channel clipping! Click to reset" : "Left channel OK"}
					disabled={!onResetClip}
				/>

				<div className="flex gap-[3px] items-center">
					{Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
						// Left channel goes from center outward (reverse order)
						const segmentIndex = SEGMENT_COUNT - 1 - i;
						const isLit = segmentIndex < leftLit;
						return (
							<div
								key={i}
								className={`vu-meter-segment ${isLit ? "lit" : ""}`}
								style={{
									backgroundColor: getSegmentColor(segmentIndex, isLit),
									boxShadow: isLit
										? `0 0 8px ${getSegmentColor(segmentIndex, true)}`
										: "none",
								}}
							/>
						);
					})}
				</div>
			</div>

			<div className="flex items-center gap-2">
				<div className="flex gap-[3px] items-center">
					{Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
						const isLit = i < rightLit;
						return (
							<div
								key={i}
								className={`vu-meter-segment ${isLit ? "lit" : ""}`}
								style={{
									backgroundColor: getSegmentColor(i, isLit),
									boxShadow: isLit
										? `0 0 8px ${getSegmentColor(i, true)}`
										: "none",
								}}
							/>
						);
					})}
				</div>

				{/* Right clip indicator */}
				<button
					type="button"
					onClick={onResetClip}
					className={`clip-indicator ${rightClipping ? "clipping" : ""}`}
					style={{
						"--clip-bg": rightClipping ? "#ef4444" : "#2a2a2a",
						"--clip-shadow": rightClipping ? "0 0 12px #ef4444" : "none",
						cursor: onResetClip ? "pointer" : "default",
					} as React.CSSProperties}
					title={rightClipping ? "Right channel clipping! Click to reset" : "Right channel OK"}
					disabled={!onResetClip}
				/>
			</div>
		</div>
	);
}
