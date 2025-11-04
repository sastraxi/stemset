import { Pencil, QrCode } from "lucide-react";
import type { FileWithStems } from "@/api/generated/types.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface SongMetadataProps {
	recording: FileWithStems;
	onEdit: () => void;
	onShowQR: () => void;
	duration?: number;
}

export function SongMetadata({
	recording,
	onEdit,
	onShowQR,
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
				<div className="flex flex-row justify-baseline gap-1 recording-name-row">
					<Button
						variant="ghost"
						size="icon"
						onClick={onEdit}
						className="h-8 w-8"
						title="Edit metadata"
					>
						<Pencil className="h-4 w-4 mt-1" />
					</Button>
					<h2 className="recording-name">{recording.display_name}</h2>
				</div>
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
			<Button
				variant="outline"
				size="icon"
				onClick={onShowQR}
				className="qr-button-header"
				title="Share & manage recording"
			>
				<QrCode className="h-5 w-5" />
			</Button>
		</div>
	);
}
