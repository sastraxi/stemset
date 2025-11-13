import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { SongCard } from "./SongCard";
import { apiProfilesProfileNameSongsGetProfileSongsByName } from "@/api/generated";

interface SongsViewProps {
	profileName: string;
	onRefresh: () => void;
}

export function SongsView({ profileName, onRefresh }: SongsViewProps) {
	const {
		data: songsResponse,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ["profile-songs", profileName],
		queryFn: () =>
			apiProfilesProfileNameSongsGetProfileSongsByName({
				path: { profile_name: profileName },
			}),
	});

	const handleRefresh = () => {
		refetch();
		onRefresh();
	};

	const songs = songsResponse?.data || [];

	return (
		<>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-base font-semibold text-white uppercase tracking-wider">
					Songs
				</h2>
				<Button
					onClick={handleRefresh}
					variant="ghost"
					size="icon"
					className="h-8 w-8 p-0 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400"
					title="Refresh songs"
				>
					<RefreshCw className="h-4 w-4" />
				</Button>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-8">
					<Spinner size="md" />
				</div>
			) : error ? (
				<p className="empty-state">Error loading songs. Try refreshing.</p>
			) : songs.length === 0 ? (
				<p className="empty-state">
					No songs yet. Assign songs to recordings to see them here.
				</p>
			) : (
				<div className="space-y-2">
					{songs.map((song) => (
						<SongCard key={song.id} song={song} profileName={profileName} />
					))}
				</div>
			)}
		</>
	);
}
