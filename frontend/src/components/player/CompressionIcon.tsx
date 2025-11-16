import type { StemCompressionLevel } from "@/types";

interface CompressionIconProps {
  level: StemCompressionLevel;
  className?: string;
}

/**
 * Custom compression icon that visualizes the compression knee curve.
 * - Off: Shows "C" for compression
 * - Low: Gentle knee curve
 * - Medium: Moderate knee curve
 * - High: Sharp knee curve
 */
export function CompressionIcon({ level, className }: CompressionIconProps) {
  const size = 16; // Icon size

  if (level === "off") {
    // Show "C" for compression when off
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
      >
        <title>Compression off</title>
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
          C
        </text>
      </svg>
    );
  }

  // Compression knee visualization with exaggerated curves for visual distinction
  // Shows input vs output level with dramatically different knee curves

  let curvePath: string;

  switch (level) {
    case "low":
      // Very gentle, wide curve - smooth transition
      curvePath = `
				M 2,14
				L 6,10
				Q 7.5,8.5 8.5,8
				L 14,6
			`;
      break;
    case "medium":
      // Moderate curve - noticeable bend
      curvePath = `
				M 2,14
				L 5,11
				Q 7,9 9,8
				L 14,5.5
			`;
      break;
    case "high":
      // Sharp, aggressive knee - dramatic compression
      curvePath = `
				M 2,14
				L 4,12
				Q 7,9 10,9.5
				L 14,9
			`;
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
      <title>
        Compression: {level.charAt(0).toUpperCase() + level.slice(1)}
      </title>
      {/* Axes */}
      <line x1="2" y1="14" x2="2" y2="2" opacity="0.3" />
      <line x1="2" y1="14" x2="14" y2="14" opacity="0.3" />

      {/* Compression curve - exaggerated for visual distinction */}
      <path d={curvePath} fill="none" strokeWidth="1.8" />
    </svg>
  );
}
