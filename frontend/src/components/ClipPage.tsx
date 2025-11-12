import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClipsClipIdGetClipEndpoint } from "@/api/generated";
import { ClipPlayer } from "./ClipPlayer";
import { Spinner } from "./Spinner";

/**
 * ClipPage - Displays a single clip with its player.
 *
 * Fetches clip data from the API and renders the ClipPlayer component.
 */
export function ClipPage() {
	const { profileName, clipId } = useParams({ strict: false });

	const { data: clip, isLoading, error } = useQuery({
		queryKey: ["clip", clipId],
		queryFn: () =>
			apiClipsClipIdGetClipEndpoint({
				path: { clip_id: clipId! },
			}),
		enabled: !!clipId,
	});

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<h2 className="text-2xl font-bold text-red-500">Error loading clip</h2>
					<p className="text-gray-600 mt-2">{String(error)}</p>
				</div>
			</div>
		);
	}

	if (!clip?.data) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<h2 className="text-2xl font-bold text-gray-700">Clip not found</h2>
					<p className="text-gray-600 mt-2">The requested clip does not exist.</p>
				</div>
			</div>
		);
	}

	const clipData = clip.data;

	return (
		<div className="h-screen flex flex-col">
			<ClipPlayer
				clipId={clipData.id}
				recordingId={clipData.recording_id}
				stemsData={clipData.stems}
				startTimeSec={clipData.start_time_sec}
				endTimeSec={clipData.end_time_sec}
				profileName={profileName!}
				fileName={clipData.recording_output_name}
			/>
		</div>
	);
}
