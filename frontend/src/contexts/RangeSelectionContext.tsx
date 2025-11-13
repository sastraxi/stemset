import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface RangeSelection {
  startSec: number | null;
  endSec: number | null;
}

interface RangeSelectionContextValue {
  selection: RangeSelection;
  setInPoint: (timeSec: number) => void;
  setOutPoint: (timeSec: number) => void;
  setRange: (startSec: number, endSec: number) => void;
  clearSelection: () => void;
  isSelecting: boolean;
  setIsSelecting: (selecting: boolean) => void;
}

const RangeSelectionContext = createContext<RangeSelectionContextValue | null>(null);

interface RangeSelectionProviderProps {
  children: ReactNode;
  duration: number;
  enabled?: boolean;
}

export function RangeSelectionProvider({ children, duration, enabled = true }: RangeSelectionProviderProps) {
  const [selection, setSelection] = useState<RangeSelection>({
    startSec: null,
    endSec: null,
  });
  const [isSelecting, setIsSelecting] = useState(false);

  const setInPoint = useCallback((timeSec: number) => {
    const clampedTime = Math.max(0, Math.min(duration, timeSec));
    setSelection((prev) => {
      // If out-point exists and new in-point is after it, adjust out-point
      if (prev.endSec !== null && clampedTime > prev.endSec) {
        return {
          startSec: clampedTime,
          endSec: null, // Clear out-point if it would be before in-point
        };
      }
      return {
        startSec: clampedTime,
        endSec: prev.endSec,
      };
    });
  }, [duration]);

  const setOutPoint = useCallback((timeSec: number) => {
    const clampedTime = Math.max(0, Math.min(duration, timeSec));
    setSelection((prev) => {
      // If in-point exists and new out-point is before it, adjust in-point
      if (prev.startSec !== null && clampedTime < prev.startSec) {
        return {
          startSec: null, // Clear in-point if it would be after out-point
          endSec: clampedTime,
        };
      }
      // If in-point exists and new out-point equals it, clear both (zero-length selection)
      if (prev.startSec !== null && clampedTime === prev.startSec) {
        return {
          startSec: null,
          endSec: null,
        };
      }
      return {
        startSec: prev.startSec,
        endSec: clampedTime,
      };
    });
  }, [duration]);

  const setRange = useCallback((startSec: number, endSec: number) => {
    const clampedStart = Math.max(0, Math.min(duration, startSec));
    const clampedEnd = Math.max(0, Math.min(duration, endSec));
    setSelection({
      startSec: Math.min(clampedStart, clampedEnd),
      endSec: Math.max(clampedStart, clampedEnd),
    });
  }, [duration]);

  const clearSelection = useCallback(() => {
    setSelection({ startSec: null, endSec: null });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // TODO: Wire up to current playback position when integrating with RecordingPlayer
      // For now, these will be called with the current playback position from the parent
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);

  const value: RangeSelectionContextValue = {
    selection,
    setInPoint,
    setOutPoint,
    setRange,
    clearSelection,
    isSelecting,
    setIsSelecting,
  };

  return (
    <RangeSelectionContext.Provider value={value}>
      {children}
    </RangeSelectionContext.Provider>
  );
}

export function useRangeSelection() {
  const context = useContext(RangeSelectionContext);
  if (!context) {
    throw new Error("useRangeSelection must be used within a RangeSelectionProvider");
  }
  return context;
}
