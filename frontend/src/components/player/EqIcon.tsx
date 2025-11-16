export type EqBandType = "low" | "mid" | "high";
export type EqLevel = "off" | "low" | "medium" | "high";

interface EqIconProps {
  band: EqBandType;
  level: EqLevel;
  className?: string;
}

/**
 * Custom EQ icon that visualizes frequency response curves.
 * - Off: Shows band initial (L/M/H)
 * - Low: Gentle boost curve
 * - Medium: Moderate boost curve
 * - High: Aggressive boost curve
 */
export function EqIcon({ band, level, className }: EqIconProps) {
  const size = 16;

  if (level === "off") {
    // Show band letter when off
    let letter: string;
    switch (band) {
      case "low":
        letter = "L";
        break;
      case "mid":
        letter = "M";
        break;
      case "high":
        letter = "H";
        break;
    }

    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="currentColor"
          stroke="none"
        >
          {letter}
        </text>
      </svg>
    );
  }

  // Generate frequency response curves based on band type and level
  let curvePath: string;

  switch (band) {
    case "low":
      // Low-shelf: flat low end, then roll-off
      switch (level) {
        case "low":
          curvePath = `
						M 2,6
						L 5,6
						Q 7,6 9,8
						L 14,11
					`;
          break;
        case "medium":
          curvePath = `
						M 2,5
						L 5,5
						Q 7,5 9,8
						L 14,12
					`;
          break;
        case "high":
          curvePath = `
						M 2,4
						L 5,4
						Q 7,4 9,8
						L 14,13
					`;
          break;
      }
      break;

    case "mid":
      // Mid-band: bell curve centered in middle frequencies
      switch (level) {
        case "low":
          curvePath = `
						M 2,10
						L 4,9
						Q 6,7 8,6
						Q 10,7 12,9
						L 14,10
					`;
          break;
        case "medium":
          curvePath = `
						M 2,11
						L 4,9
						Q 6,6 8,5
						Q 10,6 12,9
						L 14,11
					`;
          break;
        case "high":
          curvePath = `
						M 2,12
						L 4,9
						Q 6,5 8,4
						Q 10,5 12,9
						L 14,12
					`;
          break;
      }
      break;

    case "high":
      // High-shelf: roll-off, then flat high end
      switch (level) {
        case "low":
          curvePath = `
						M 2,11
						L 7,8
						Q 9,6 11,6
						L 14,6
					`;
          break;
        case "medium":
          curvePath = `
						M 2,12
						L 7,8
						Q 9,5 11,5
						L 14,5
					`;
          break;
        case "high":
          curvePath = `
						M 2,13
						L 7,8
						Q 9,4 11,4
						L 14,4
					`;
          break;
      }
      break;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Frequency axis (horizontal baseline) */}
      <line x1="2" y1="10" x2="14" y2="10" opacity="0.2" />

      {/* EQ response curve */}
      <path d={curvePath} fill="none" strokeWidth="1.8" />
    </svg>
  );
}
