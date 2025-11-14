import { Link } from "@tanstack/react-router";
import {
	Activity,
	Edit,
	ExternalLink,
	Loader2,
	Mic2,
	MoreVertical,
	Music2,
	Pause,
	Play,
	QrCode,
	Volume2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ClipWithStemsResponse } from "@/api/generated";
import { cn } from "@/lib/utils";
import { CssWaveform } from "./CssWaveform";
import { TimecodeDisplay } from "./TimecodeDisplay";
import { useSongPlayer } from "../contexts/SongPlayerContext";
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
			return Activity;
		case "bass":
			return Volume2;
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
	const [previewTime, setPreviewTime] = useState<number | null>(null);
	const {
		currentClipId,
		isPlaying,
		isLoading,
		currentTime,
		play,
		pause,
		seek,
		toggleStemMute,
		isStemMuted,
	} = useSongPlayer();

	const duration = clip.end_time_sec - clip.start_time_sec;
	const isCurrentClip = currentClipId === clip.id;
	const displayTime = previewTime !== null ? previewTime : (isCurrentClip ? currentTime : 0);

	// Clip display name
	const clipName =
		clip.display_name ||
		`Clip ${formatTime(clip.start_time_sec)} - ${formatTime(clip.end_time_sec)}`;

	// Handle play/pause
	const handlePlayPause = () => {
		if (isCurrentClip && isPlaying) {
			pause();
		} else {
			play({
				id: clip.id,
				stems: clip.stems,
				startTimeSec: clip.start_time_sec,
				endTimeSec: clip.end_time_sec,
			});
		}
	};

	// Handle seeking
	const handleSeek = (time: number) => {
		if (isCurrentClip) {
			seek(time);
		} else {
			// Start playing from this position
			play({
				id: clip.id,
				stems: clip.stems,
				startTimeSec: clip.start_time_sec,
				endTimeSec: clip.end_time_sec,
			}).then(() => {
				seek(time);
			});
		}
	};

	// Group stems by type
	const stemTypes = useMemo(() => {
		return Array.from(new Set(clip.stems.map((s) => s.stem_type)));
	}, [clip.stems]);

	// Show loading spinner or play/pause icon
	const PlayButtonIcon = isCurrentClip && isLoading
		? Loader2
		: isCurrentClip && isPlaying
			? Pause
			: Play;

	return (
		<div className={cn("song-clip-row", { "song-clip-row-active": isCurrentClip && isPlaying })}>
			{/* Top row: Play button, title, duration, stem mutes, menu */}
			<div className="song-clip-row-header">
				<Button
					onClick={handlePlayPause}
					variant="ghost"
					size="icon"
					className="song-clip-play-button"
					title={isCurrentClip && isPlaying ? "Pause" : "Play"}
					disabled={isCurrentClip && isLoading}
				>
					<PlayButtonIcon
						className={cn("h-5 w-5", {
							"animate-spin": isCurrentClip && isLoading,
						})}
						fill={isCurrentClip && isPlaying ? "currentColor" : "none"}
					/>
				</Button>

				<div className="song-clip-title-section">
					<h3 className="song-clip-title">{clipName}</h3>
					<div className="song-clip-stem-controls">
						{stemTypes.map((stemType) => {
							const Icon = getStemIcon(stemType);
							const muted = isStemMuted(stemType);
							return (
								<button
									key={stemType}
									type="button"
									onClick={() => toggleStemMute(stemType)}
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
					currentTime={displayTime}
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
			<div className="song-clip-waveform">
				<CssWaveform
					stems={clip.stems}
					currentTime={displayTime}
					duration={duration}
					previewTime={previewTime ?? undefined}
					onSeek={handleSeek}
					onPreview={setPreviewTime}
					startTimeSec={clip.start_time_sec}
					endTimeSec={clip.end_time_sec}
					fullDuration={clip.stems[0]?.duration_seconds}
					height={100}
				/>
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
	);
}
