import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { ClipCard } from "./ClipCard";
import { apiProfilesProfileNameClipsGetProfileClips } from "@/api/generated";
import { useSortPreference } from "@/hooks/useSortPreference";
import type { ClipWithStemsResponse } from "@/api/generated";

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

	const { sortField, sortDirection, cycleSort, sortData } = useSortPreference({
		storageKey: "stemset-sort-clips",
		defaultField: "date",
		defaultDirection: "desc",
	});

	const handleRefresh = () => {
		refetch();
		onRefresh();
	};

	const clips = clipsResponse?.data || [];

	// Sort clips based on current sort preference
	const sortedClips = useMemo(() => {
		return sortData<ClipWithStemsResponse>(
			clips,
			(clip) => clip.created_at,
			(clip) => clip.display_name || `Clip ${clip.id}`,
		);
	}, [clips, sortData]);

	const sortLabel = `${sortField === "name" ? "NAME" : "DATE"} ${sortDirection === "asc" ? "↑" : "↓"}`;

	return (
		<>
			<div className="flex items-center justify-between mb-3 gap-2">
				<Button
					onClick={cycleSort}
					variant="ghost"
					className="h-8 px-3 py-0 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400 text-xs font-semibold uppercase tracking-wider flex-1"
					title="Cycle sort order"
				>
					{sortLabel}
				</Button>
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
			) : sortedClips.length === 0 ? (
				<p className="empty-state">
					No clips yet. Create clips by selecting a range in a recording.
				</p>
			) : (
				<div className="space-y-2">
					{sortedClips.map((clip) => (
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
