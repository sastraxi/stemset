import { forwardRef } from "react";
import type { StemResponse } from "@/api/generated";
import { StemPlayer, type StemPlayerHandle } from "./StemPlayer";

/**
 * RecordingPlayer - Wrapper around StemPlayer for full recording playback (no time bounds).
 *
 * Use this component when playing back entire recordings without clip constraints.
 */
interface RecordingPlayerProps {
	recordingId: string;
	stemsData: StemResponse[];
	profileName: string;
	fileName: string;
	onLoadingChange?: (isLoading: boolean) => void;
	onDurationChange?: (duration: number) => void;
	onCurrentTimeChange?: (currentTime: number) => void;
}

export const RecordingPlayer = forwardRef<
	StemPlayerHandle,
	RecordingPlayerProps
>((props, ref) => {
	return (
		<StemPlayer
			ref={ref}
			{...props}
			// No time bounds - plays entire recording
		/>
	);
});

RecordingPlayer.displayName = "RecordingPlayer";
