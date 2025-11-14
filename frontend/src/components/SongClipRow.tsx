import { Link } from "@tanstack/react-router";
import {
	Drum,
	Edit,
	ExternalLink,
	Loader2,
	Mic2,
	MoreVertical,
	Music2,
	Pause,
	Play,
	QrCode,
} from "lucide-react";
import { GiGuitarBassHead } from "react-icons/gi";
import { useMemo } from "react";
import type { ClipWithStemsResponse } from "@/api/generated";
import { cn } from "@/lib/utils";
import { ClipPlayerProvider, useClipPlayer } from "@/lib/player/factories/useClipPlayer";
import { TimecodeDisplay } from "./TimecodeDisplay";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface SongClipRowProps {
	clip: ClipWithStemsResponse;
	profileName: string;
	onShare?: () => void;
	onEdit?: () => void;
}

/** Get icon for stem type */
const getStemIcon = (stemType: string) => {
	switch (stemType.toLowerCase()) {
		case "vocals":
			return Mic2;
		case "drums":
			return Drum;
		case "bass":
			return GiGuitarBassHead;
		case "other":
		default:
			return Music2;
	}
};

/** Format time in MM:SS */
const formatTime = (seconds: number): string => {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/** Format time in HH:MM:SS or MM:SS (VCR style) */
const formatVcrTime = (seconds: number): string => {
	const hrs = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	if (hrs > 0) {
		return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}
	return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * SongClipRow - A SoundCloud-inspired clip player row
 *
 * Features:
 * - Full-width composite waveform
 * - Play/pause button
 * - Stem mute toggles with icons
 * - Clip metadata
 * - Share/edit menu
 */
export function SongClipRow({
	clip,
	profileName,
	onShare,
	onEdit,
}: SongClipRowProps) {
	// Initialize player for this clip
	const player = useClipPlayer({
		clip: {
			id: clip.id,
			stems: clip.stems,
			startTimeSec: clip.start_time_sec,
			endTimeSec: clip.end_time_sec,
		},
	});

	const duration = clip.end_time_sec - clip.start_time_sec;

	// Clip display name
	const clipName =
		clip.display_name ||
		`Clip ${formatTime(clip.start_time_sec)} - ${formatTime(clip.end_time_sec)}`;

	// Group stems by type
	const stemTypes = useMemo(() => {
		return Array.from(new Set(clip.stems.map((s) => s.stem_type)));
	}, [clip.stems]);

	// Show loading spinner or play/pause icon
	const PlayButtonIcon = player.isLoading
		? Loader2
		: player.isPlaying
			? Pause
			: Play;

	return (
		<ClipPlayerProvider player={player}>
			<div className={cn("song-clip-row", { "song-clip-row-active": player.isPlaying })}>
				{/* Top row: Play button, title, duration, stem mutes, menu */}
				<div className="song-clip-row-header">
					<Button
						onClick={player.isPlaying ? player.pause : player.play}
						variant="ghost"
						size="icon"
						className="song-clip-play-button"
						title={player.isPlaying ? "Pause" : "Play"}
						disabled={player.isLoading}
					>
						<PlayButtonIcon
							className={cn("h-5 w-5", {
								"animate-spin": player.isLoading,
							})}
							fill={player.isPlaying ? "currentColor" : "none"}
						/>
					</Button>

					<div className="song-clip-title-section">
						<h3 className="song-clip-title">{clipName}</h3>
						<div className="song-clip-stem-controls">
							{stemTypes.map((stemType) => {
								const Icon = getStemIcon(stemType);
								const stem = player.stems.find((s) => s.stemType === stemType);
								const muted = stem?.isMuted ?? false;
								return (
									<button
										key={stemType}
										type="button"
										onClick={() => player.toggleStemMute(stemType)}
										className={cn("stem-mute-toggle", {
											muted,
										})}
										title={`${muted ? "Unmute" : "Mute"} ${stemType}`}
									>
										<Icon className="h-4 w-4" />
									</button>
								);
							})}
						</div>
					</div>

					<TimecodeDisplay
						currentTime={player.currentTime}
						duration={duration}
						formatTime={formatVcrTime}
						className="song-clip-duration"
					/>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="song-clip-menu-button"
						>
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{onShare && (
							<DropdownMenuItem onClick={onShare}>
								<QrCode className="mr-2 h-4 w-4" />
								Share
							</DropdownMenuItem>
						)}
						{onEdit && (
							<DropdownMenuItem onClick={onEdit}>
								<Edit className="mr-2 h-4 w-4" />
								Edit name
							</DropdownMenuItem>
						)}
						<DropdownMenuItem asChild>
							<Link
								to="/p/$profileName/clips/$clipId"
								params={{
									profileName,
									clipId: clip.id,
								}}
							>
								<ExternalLink className="mr-2 h-4 w-4" />
								Open clip detail
							</Link>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Waveform */}
			<div className="song-clip-waveform" style={{ height: "76px" }}>
				<player.Waveform mode="composite" height={64} showBackground={false} />
				<player.Ruler variant="minimal" height={12} />
			</div>

			{/* Recording context */}
			<div className="song-clip-context">
				<span className="song-clip-recording-name">
					{clip.recording_output_name}
				</span>
				<span className="song-clip-time-range">
					{formatTime(clip.start_time_sec)} - {formatTime(clip.end_time_sec)}
				</span>
			</div>
		</div>
		</ClipPlayerProvider>
	);
}
