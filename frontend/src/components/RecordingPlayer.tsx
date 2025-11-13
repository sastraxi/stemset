import { forwardRef, useState, useEffect, useRef, useImperativeHandle } from "react";
import type { StemResponse } from "@/api/generated";
import { StemPlayer, type StemPlayerHandle } from "./StemPlayer";
import { RangeSelectionProvider, useRangeSelection } from "../contexts/RangeSelectionContext";
import { CreateClipModal } from "./CreateClipModal";
import { Button } from "./ui/button";

/**
 * RecordingPlayer - Wrapper around StemPlayer for full recording playback (no time bounds).
 *
 * Use this component when playing back entire recordings without clip constraints.
 * Includes range selection and clip creation functionality.
 */
interface RecordingPlayerProps {
	recordingId: string;
	stemsData: StemResponse[];
	profileName: string;
	fileName: string;
	onLoadingChange?: (isLoading: boolean) => void;
	onDurationChange?: (duration: number) => void;
	onCurrentTimeChange?: (currentTime: number) => void;
	onCreateClipChange?: (handler: (() => void) | null, hasSelection: boolean) => void;
}

// Inner component that uses the RangeSelectionContext
function RecordingPlayerInner(
	props: RecordingPlayerProps,
	ref: React.ForwardedRef<StemPlayerHandle>
) {
	const { recordingId, profileName } = props;
	const [currentTime, setCurrentTime] = useState(0);
	const [modalOpen, setModalOpen] = useState(false);
	const stemPlayerRef = useRef<StemPlayerHandle>(null);
	const rangeSelection = useRangeSelection();

	// Expose StemPlayer handle to parent
	useImperativeHandle(ref, () => stemPlayerRef.current!, []);

	const { selection } = rangeSelection;
	const hasSelection = selection.startSec !== null && selection.endSec !== null;

	const handleCreateClip = () => {
		setModalOpen(true);
	};

	// Expose create clip handler and selection state to parent
	useEffect(() => {
		props.onCreateClipChange?.(handleCreateClip, hasSelection);
	}, [hasSelection, props.onCreateClipChange]);

	// Keyboard shortcuts for range selection
	useEffect(() => {
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
	}, [currentTime, rangeSelection]);

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
				// No time bounds - plays entire recording
			/>

			{/* Create Clip Modal */}
			{hasSelection && (
				<CreateClipModal
					open={modalOpen}
					onOpenChange={setModalOpen}
					startSec={selection.startSec!}
					endSec={selection.endSec!}
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
