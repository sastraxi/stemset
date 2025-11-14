// Factory hooks
export { useRecordingPlayer, RecordingPlayerProvider } from "./factories/useRecordingPlayer";
export type { UseRecordingPlayerOptions, RecordingPlayerAPI } from "./factories/useRecordingPlayer";

export { useClipPlayer, ClipPlayerProvider } from "./factories/useClipPlayer";
export type { UseClipPlayerOptions, ClipPlayerAPI, ClipData, StemState } from "./factories/useClipPlayer";

// Core audio utilities
export { formatTime } from "./audio/core";
export { STEM_COLORS, CURSOR_COLOR, SELECTION_COLOR } from "./audio/constants";

// Waveform components
export { CompositeWaveform } from "./waveforms/CompositeWaveform";
export type { CompositeWaveformProps, StemWaveformData } from "./waveforms/CompositeWaveform";

export { SplitWaveforms } from "./waveforms/SplitWaveforms";
export type { SplitWaveformsProps } from "./waveforms/SplitWaveforms";

// Ruler components
export { MinimalRuler } from "./rulers/MinimalRuler";
export type { MinimalRulerProps } from "./rulers/MinimalRuler";

export { FullRuler } from "./rulers/FullRuler";
export type { FullRulerProps } from "./rulers/FullRuler";

// Canvas utilities
export { useCanvasRenderer } from "./canvas/useCanvasRenderer";
export { useCanvasInteraction } from "./canvas/useCanvasInteraction";
export type { RangeSelectionContext, DragMode } from "./canvas/useCanvasInteraction";
