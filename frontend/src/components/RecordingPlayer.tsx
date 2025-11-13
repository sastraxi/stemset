import { forwardRef, useState, useEffect, useRef, useImperativeHandle } from "react";
import type { StemResponse } from "@/api/generated";
import { StemPlayer, type StemPlayerHandle } from "./StemPlayer";
import { RangeSelectionProvider, useRangeSelection } from "../contexts/RangeSelectionContext";
import { CreateClipModal } from "./CreateClipModal";

/**
 * RecordingPlayer - Unified player for recordings and clips.
 *
 * When clip is provided:
 * - Plays time-bounded segment (startTimeSec to endTimeSec)
 * - Disables position persistence
 * - No range selection or clip creation
 *
 * When clip is absent:
 * - Plays full recording
 * - Saves/loads playback position
 * - Includes range selection and clip creation
 */
interface RecordingPlayerProps {
	recordingId: string;
	stemsData: StemResponse[];
	profileName: string;
	fileName: string;
	clip?: {
		id: string;
		startTimeSec: number;
		endTimeSec: number;
	};
	onLoadingChange?: (isLoading: boolean) => void;
	onDurationChange?: (duration: number) => void;
	onCurrentTimeChange?: (currentTime: number) => void;
	onCreateClipChange?: (handler: (() => void) | null, hasSelection: boolean) => void;
}

// Inner component that uses the RangeSelectionContext (only when not a clip)
function RecordingPlayerInner(
	props: RecordingPlayerProps,
	ref: React.ForwardedRef<StemPlayerHandle>
) {
	const { recordingId, profileName, clip } = props;
	const [currentTime, setCurrentTime] = useState(0);
	const [modalOpen, setModalOpen] = useState(false);
	const stemPlayerRef = useRef<StemPlayerHandle>(null);

	// Only use range selection context if not playing a clip
	const rangeSelection = clip ? null : useRangeSelection();

	// Expose StemPlayer handle to parent
	useImperativeHandle(ref, () => stemPlayerRef.current!, []);

	const hasSelection = rangeSelection
		? rangeSelection.selection.startSec !== null && rangeSelection.selection.endSec !== null
		: false;

	const handleCreateClip = () => {
		setModalOpen(true);
	};

	// Expose create clip handler and selection state to parent (only for recordings)
	useEffect(() => {
		if (!clip) {
			props.onCreateClipChange?.(handleCreateClip, hasSelection);
		}
	}, [hasSelection, props.onCreateClipChange, clip]);

	// Keyboard shortcuts for range selection (only for recordings)
	useEffect(() => {
		if (clip || !rangeSelection) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			// Only handle if not typing in an input
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
				return;
			}

			switch (e.key.toLowerCase()) {
				case 'i':
					// Set in-point at current playback position
					rangeSelection.setInPoint(currentTime);
					e.preventDefault();
					break;
				case 'o':
					// Set out-point at current playback position
					rangeSelection.setOutPoint(currentTime);
					e.preventDefault();
					break;
				case 'x':
					// Clear selection
					rangeSelection.clearSelection();
					e.preventDefault();
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [currentTime, rangeSelection, clip]);

	const handleDurationChange = (newDuration: number) => {
		props.onDurationChange?.(newDuration);
	};

	const handleCurrentTimeChange = (newTime: number) => {
		setCurrentTime(newTime);
		props.onCurrentTimeChange?.(newTime);
	};

	return (
		<div className="relative">
			<StemPlayer
				ref={stemPlayerRef}
				{...props}
				onDurationChange={handleDurationChange}
				onCurrentTimeChange={handleCurrentTimeChange}
				// Clip time boundaries or full recording
				startTimeSec={clip?.startTimeSec}
				endTimeSec={clip?.endTimeSec}
				// Disable position persistence for clips
				disablePositionPersistence={!!clip}
			/>

			{/* Create Clip Modal - only for recordings */}
			{!clip && hasSelection && rangeSelection && (
				<CreateClipModal
					open={modalOpen}
					onOpenChange={setModalOpen}
					startSec={rangeSelection.selection.startSec!}
					endSec={rangeSelection.selection.endSec!}
					recordingId={recordingId}
					profileName={profileName}
				/>
			)}
		</div>
	);
}

const RecordingPlayerInnerWithRef = forwardRef(RecordingPlayerInner);

export const RecordingPlayer = forwardRef<
	StemPlayerHandle,
	RecordingPlayerProps
>((props, ref) => {
	const [duration, setDuration] = useState(0);

	// Only wrap in RangeSelectionProvider for recordings (not clips)
	if (props.clip) {
		return <RecordingPlayerInnerWithRef {...props} ref={ref} />;
	}

	return (
		<RangeSelectionProvider duration={duration} enabled={true}>
			<RecordingPlayerInnerWithRef
				{...props}
				ref={ref}
				onDurationChange={(newDuration) => {
					setDuration(newDuration);
					props.onDurationChange?.(newDuration);
				}}
			/>
		</RangeSelectionProvider>
	);
});

RecordingPlayer.displayName = "RecordingPlayer";
