import type { VuMeterLevels } from "../hooks/useVuMeter";

export interface VuMeterProps {
	levels: VuMeterLevels;
}

const SEGMENT_COUNT = 6;

/**
 * Classic 90s bookshelf stereo-style VU meter with LED segments.
 * 6 segments per channel growing outward from center (L to left, R to right).
 */
export function VuMeter({ levels }: VuMeterProps) {
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
			<div className="vu-meter-channel vu-meter-left">
				<div className="vu-meter-segments">
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

			<div className="vu-meter-channel vu-meter-right">
				<div className="vu-meter-segments">
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
			</div>
		</div>
	);
}
