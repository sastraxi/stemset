import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface VerticalDragControlProps {
  value: number; // Current value
  min: number; // Minimum value
  max: number; // Maximum value
  onChange: (value: number) => void;
  label: string; // Display character (e.g., "Q")
  formatValue?: (value: number) => string; // Optional value formatter
  logarithmic?: boolean; // Use logarithmic scaling
  className?: string;
  filterPosition?: "low" | "mid" | "high"; // Position offset for filter visualization
}

const DRAG_HEIGHT = 90; // pixels for full range

/**
 * Reusable vertical drag control component.
 * Similar to MobileVolumeControl but more generic and larger.
 */
export function VerticalDragControl({
  value,
  min,
  max,
  onChange,
  label,
  formatValue,
  logarithmic = false,
  className = "",
  filterPosition,
}: VerticalDragControlProps) {
  const uniqueId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number>(0);
  const dragStartValueRef = useRef<number>(0);
  const hasDraggedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert linear value to/from logarithmic scale if needed
  const valueToLinear = useCallback(
    (val: number): number => {
      if (!logarithmic) return val;
      // Logarithmic: map [min, max] to [0, 1] logarithmically
      const normalized = (val - min) / (max - min);
      return Math.log10(1 + normalized * 9); // log10(1 to 10) = 0 to 1
    },
    [logarithmic, min, max],
  );

  const linearToValue = useCallback(
    (linear: number): number => {
      if (!logarithmic) return linear;
      // Inverse of above
      const normalized = (10 ** linear - 1) / 9;
      return min + normalized * (max - min);
    },
    [logarithmic, min, max],
  );

  const handleDragStart = useCallback(
    (clientY: number) => {
      setIsDragging(true);
      dragStartYRef.current = clientY;
      dragStartValueRef.current = value;
      hasDraggedRef.current = false;
    },
    [value],
  );

  const handleDragMove = useCallback(
    (clientY: number) => {
      if (!isDragging) return;

      const deltaY = dragStartYRef.current - clientY; // Inverted: drag up = increase
      hasDraggedRef.current = Math.abs(deltaY) > 3;

      if (logarithmic) {
        // Logarithmic scaling
        const startLinear = valueToLinear(dragStartValueRef.current);
        const deltaLinear = deltaY / DRAG_HEIGHT;
        const newLinear = Math.max(0, Math.min(1, startLinear + deltaLinear));
        const newValue = linearToValue(newLinear);
        onChange(Math.max(min, Math.min(max, newValue)));
      } else {
        // Linear scaling
        const deltaValue = (deltaY / DRAG_HEIGHT) * (max - min);
        const newValue = dragStartValueRef.current + deltaValue;
        onChange(Math.max(min, Math.min(max, newValue)));
      }
    },
    [isDragging, logarithmic, min, max, onChange, valueToLinear, linearToValue],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse events
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientY);
    },
    [handleDragStart],
  );

  // Touch events
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        handleDragStart(e.touches[0].clientY);
      }
    },
    [handleDragStart],
  );

  // Document-level event listeners while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleDragMove(e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        handleDragMove(e.touches[0].clientY);
      }
    };

    const handleMouseUp = () => {
      handleDragEnd();
    };

    const handleTouchEnd = () => {
      handleDragEnd();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Calculate fill percentage (0-100)
  const fillPercentage = logarithmic
    ? valueToLinear(value) * 100
    : ((value - min) / (max - min)) * 100;

  // Smooth color transition based on fill percentage
  const getColor = (percentage: number): string => {
    // Smooth gradient from blue (0%) → cyan (25%) → green (50%) → yellow (75%) → orange (100%)
    if (percentage < 25) {
      // Blue to Cyan
      const t = percentage / 25;
      return `rgb(${Math.round(74 + (0 - 74) * t)}, ${Math.round(158 + (206 - 158) * t)}, ${Math.round(255 + (209 - 255) * t)})`;
    }
    if (percentage < 50) {
      // Cyan to Green
      const t = (percentage - 25) / 25;
      return `rgb(${Math.round(0 + (34 - 0) * t)}, ${Math.round(206 + (197 - 206) * t)}, ${Math.round(209 + (94 - 209) * t)})`;
    }
    if (percentage < 75) {
      // Green to Yellow
      const t = (percentage - 50) / 25;
      return `rgb(${Math.round(34 + (234 - 34) * t)}, ${Math.round(197 + (179 - 197) * t)}, ${Math.round(94 + (8 - 94) * t)})`;
    }
    // Yellow to Orange
    const t = (percentage - 75) / 25;
    return `rgb(${Math.round(234 + (255 - 234) * t)}, ${Math.round(179 + (159 - 179) * t)}, ${Math.round(8 + (67 - 8) * t)})`;
  };

  const color = getColor(fillPercentage);
  const displayValue = formatValue ? formatValue(value) : value.toFixed(1);

  // Generate filter curve visualization for Q control
  // Lower Q = wider bell curve, Higher Q = narrower/sharper peak
  const generateFilterCurve = (): { path: string; fillPath: string } => {
    // Normalize Q value (0.3-8) to 0-1 range for easier calculation
    const normalizedQ = logarithmic
      ? valueToLinear(value)
      : (value - min) / (max - min);

    // Wider viewbox to accommodate wider control (200x100 for 2:1 aspect ratio)
    // Offset centerX based on filter position
    let centerX = 100; // Default center
    if (filterPosition === "low") {
      centerX = 70; // Offset left
    } else if (filterPosition === "high") {
      centerX = 130; // Offset right
    }

    const centerY = 80;
    const peakHeight = 70;

    // Width of the bell curve - inverse of Q (lower Q = wider)
    // Map from very wide (low Q) to very narrow (high Q)
    const bandwidth = 80 - normalizedQ * 65; // 80px to 15px width

    // Create bell curve using quadratic bezier curves
    // Symmetrical bell shape
    const points = [];
    const steps = 20;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = centerX + (t - 0.5) * bandwidth * 2;

      // Gaussian-like bell curve
      const variance = bandwidth / 2;
      const distance = (t - 0.5) * bandwidth;
      const y =
        centerY -
        peakHeight *
          Math.exp(-(distance * distance) / ((2 * variance * variance) / 8));

      points.push(`${x},${y}`);
    }

    const path = `M ${points.join(" L ")}`;

    // Create filled path that goes down to baseline
    const firstPoint = points[0].split(",");
    const lastPoint = points[points.length - 1].split(",");
    const fillPath = `${path} L ${lastPoint[0]},${centerY} L ${firstPoint[0]},${centerY} Z`;

    return { path, fillPath };
  };

  const filterCurve =
    label === "Q" && filterPosition ? generateFilterCurve() : null;

  return (
    <div
      ref={containerRef}
      className={`vertical-drag-control ${className}`}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      <div
        className="vertical-drag-button"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{
          borderColor: color,
        }}
      >
        <svg width="100%" height="100%" viewBox="0 0 200 100">
          <defs>
            <linearGradient
              id={`vertical-gradient-${uniqueId}`}
              x1="0%"
              y1="100%"
              x2="0%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#4a9eff" />
              <stop offset="25%" stopColor="#00ced1" />
              <stop offset="50%" stopColor="#22c55e" />
              <stop offset="75%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#ff9f43" />
            </linearGradient>
            <clipPath id={`vertical-clip-${uniqueId}`}>
              <rect
                x="0"
                y={100 - fillPercentage}
                width="200"
                height={fillPercentage}
              />
            </clipPath>
          </defs>
          {/* Background gradient fill (shows current level) */}
          <rect
            x="0"
            y="0"
            width="200"
            height="100"
            fill={`url(#vertical-gradient-${uniqueId})`}
            opacity="0.2"
            clipPath={`url(#vertical-clip-${uniqueId})`}
          />

          {filterCurve ? (
            <>
              {/* Baseline for filter visualization */}
              <line
                x1="20"
                y1="80"
                x2="180"
                y2="80"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.3"
              />

              {/* Fill area below curve - clipped by value */}
              <path
                d={filterCurve.fillPath}
                fill={`url(#vertical-gradient-${uniqueId})`}
                opacity="0.25"
                clipPath={`url(#vertical-clip-${uniqueId})`}
              />

              {/* Filter curve stroke - matches border color */}
              <path
                d={filterCurve.path}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <>
              {/* Background icon (unfilled) */}
              <text
                x="100"
                y="50"
                textAnchor="middle"
                dominantBaseline="central"
                fill="#555"
                fontSize="42"
                fontWeight="bold"
              >
                {label}
              </text>
              {/* Foreground icon (filled from bottom with gradient) */}
              <text
                x="100"
                y="50"
                textAnchor="middle"
                dominantBaseline="central"
                fill={`url(#vertical-gradient-${uniqueId})`}
                fontSize="42"
                fontWeight="bold"
                clipPath={`url(#vertical-clip-${uniqueId})`}
              >
                {label}
              </text>
            </>
          )}
        </svg>
      </div>
      <div className="vertical-drag-value" style={{ color: "#888" }}>
        {displayValue}
      </div>
    </div>
  );
}
