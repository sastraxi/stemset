import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { ClipCard } from "./ClipCard";
import { apiProfilesProfileNameClipsGetProfileClips } from "@/api/generated";

interface ClipsViewProps {
	profileName: string;
	onRefresh: () => void;
}

export function ClipsView({ profileName, onRefresh }: ClipsViewProps) {
	const {
		data: clipsResponse,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ["profile-clips", profileName],
		queryFn: () =>
			apiProfilesProfileNameClipsGetProfileClips({
				path: { profile_name: profileName },
			}),
	});

	const handleRefresh = () => {
		refetch();
		onRefresh();
	};

	const clips = clipsResponse?.data || [];

	return (
		<>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-base font-semibold text-white uppercase tracking-wider">
					Clips
				</h2>
				<Button
					onClick={handleRefresh}
					variant="ghost"
					size="icon"
					className="h-8 w-8 p-0 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400"
					title="Refresh clips"
				>
					<RefreshCw className="h-4 w-4" />
				</Button>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-8">
					<Spinner size="md" />
				</div>
			) : error ? (
				<p className="empty-state">Error loading clips. Try refreshing.</p>
			) : clips.length === 0 ? (
				<p className="empty-state">
					No clips yet. Create clips by selecting a range in a recording.
				</p>
			) : (
				<div className="space-y-2">
					{clips.map((clip) => (
						<ClipCard
							key={clip.id}
							clip={clip}
							profileName={profileName}
							showRecordingInfo={true}
						/>
					))}
				</div>
			)}
		</>
	);
}
