import { forwardRef } from "react";
import type { StemResponse } from "@/api/generated";
import { StemPlayer, type StemPlayerHandle } from "./StemPlayer";

/**
 * ClipPlayer - Wrapper around StemPlayer for time-bounded clip playback.
 *
 * Use this component when playing clips with specific start/end times.
 * Playback will be constrained to [startTimeSec, endTimeSec].
 */
interface ClipPlayerProps {
	clipId: string; // Clip ID (for future use in analytics, etc.)
	recordingId: string; // Recording ID (used for config persistence)
	stemsData: StemResponse[];
	startTimeSec: number;
	endTimeSec: number;
	profileName: string;
	fileName: string;
	onLoadingChange?: (isLoading: boolean) => void;
	onDurationChange?: (duration: number) => void;
	onCurrentTimeChange?: (currentTime: number) => void;
}

export const ClipPlayer = forwardRef<StemPlayerHandle, ClipPlayerProps>(
	({ clipId, ...props }, ref) => {
		// Note: We pass recordingId for config persistence (stem volumes, effects, etc.)
		// but clips don't persist playback position (they always start at 0)
		return (
			<StemPlayer
				ref={ref}
				recordingId={props.recordingId}
				stemsData={props.stemsData}
				profileName={props.profileName}
				fileName={props.fileName}
				startTimeSec={props.startTimeSec}
				endTimeSec={props.endTimeSec}
				onLoadingChange={props.onLoadingChange}
				onDurationChange={props.onDurationChange}
				onCurrentTimeChange={props.onCurrentTimeChange}
				disablePositionPersistence={true}
			/>
		);
	},
);

ClipPlayer.displayName = "ClipPlayer";
