import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SongCard } from "@/components/common/SongCard";
import { apiProfilesProfileNameSongsGetProfileSongsByName } from "@/api/generated";
import { useSortPreference } from "@/hooks/useSortPreference";
import { cn } from "@/lib/utils";
import type { SongWithClipCount } from "@/api/generated";

interface SongsViewProps {
  layout?: "sidebar" | "grid";
  profileName: string;
  onRefresh: () => void;
}

export function SongsView({
  layout = "sidebar",
  profileName,
  onRefresh,
}: SongsViewProps) {
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

  const { sortField, sortDirection, cycleSort, sortData } = useSortPreference({
    storageKey: "stemset-sort-songs",
    defaultField: "date",
    defaultDirection: "desc",
  });

  const handleRefresh = () => {
    refetch();
    onRefresh();
  };

  const songs = songsResponse?.data || [];

  // Sort songs based on current sort preference
  const sortedSongs = useMemo(() => {
    return sortData<SongWithClipCount>(
      songs,
      (song) => song.created_at,
      (song) => song.name,
    );
  }, [songs, sortData]);

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
      ) : sortedSongs.length === 0 ? (
        <p className="empty-state">
          No songs yet. Assign songs to recordings to see them here.
        </p>
      ) : (
        <div
          className={cn(
            layout === "sidebar" && "space-y-2",
            layout === "grid" && "grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {sortedSongs.map((song) => (
            <SongCard key={song.id} song={song} profileName={profileName} />
          ))}
        </div>
      )}
    </>
  );
}
