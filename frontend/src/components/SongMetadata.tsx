import type { FileWithStems } from "@/api/generated/types.gen";
import { Badge } from "@/components/ui/badge";
import { RecordingMenu } from "./RecordingMenu";

export interface SongMetadataProps {
	recording: FileWithStems;
	onEdit: () => void;
	onShowQR: () => void;
	onDelete: () => void;
	duration?: number;
}

export function SongMetadata({
	recording,
	onEdit,
	onShowQR,
	onDelete,
	duration,
}: SongMetadataProps) {
	const formatDate = (dateString: string | null | undefined) => {
		if (!dateString) return null;
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
		} catch {
			return null;
		}
	};

	const formatDuration = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	};

	const formattedDate = formatDate(recording.date_recorded);

	return (
		<div className="song-metadata">
			<div className="flex flex-col items-start gap-2">
				<h2 className="recording-name">{recording.display_name}</h2>
				<div className="song-metadata-badges">
					{recording.song ? (
						<Badge variant="secondary">{recording.song.name}</Badge>
					) : (
						<Badge variant="outline" className="text-muted-foreground">
							No song
						</Badge>
					)}
					{recording.location ? (
						<Badge variant="secondary">{recording.location.name}</Badge>
					) : (
						<Badge variant="outline" className="text-muted-foreground">
							No location
						</Badge>
					)}
					{formattedDate ? (
						<Badge variant="secondary">{formattedDate}</Badge>
					) : (
						<Badge variant="outline" className="text-muted-foreground">
							No date
						</Badge>
					)}
					{duration !== undefined && duration > 0 ? (
						<Badge variant="secondary">{formatDuration(duration)}</Badge>
					) : null}
				</div>
			</div>
			<RecordingMenu
				onShowQR={onShowQR}
				onEdit={onEdit}
				onDelete={onDelete}
			/>
		</div>
	);
}
