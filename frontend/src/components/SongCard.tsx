import { Link } from "@tanstack/react-router";
import { Music2 } from "lucide-react";

interface SongCardProps {
	song: {
		id: string;
		name: string;
		clip_count: number;
	};
	profileName: string;
}

export function SongCard({ song, profileName }: SongCardProps) {
	return (
		<Link
			to="/p/$profileName/songs/$songId"
			params={{
				profileName,
				songId: song.id,
			}}
			className="block bg-background border rounded-lg hover:border-primary/50 transition-colors p-4"
		>
			<div className="flex items-center gap-3">
				<Music2 className="h-5 w-5 text-primary flex-shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="font-semibold text-base truncate">{song.name}</div>
					<div className="text-xs text-muted-foreground mt-0.5">
						{song.clip_count} {song.clip_count === 1 ? "clip" : "clips"}
					</div>
				</div>
			</div>
		</Link>
	);
}
