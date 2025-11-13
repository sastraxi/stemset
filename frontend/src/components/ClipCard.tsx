import { Link } from "@tanstack/react-router";
import { Clock, Calendar, MapPin } from "lucide-react";
import type { ClipWithStemsResponse } from "../api/generated";

interface ClipCardProps {
	clip: ClipWithStemsResponse;
	profileName: string;
	showRecordingInfo?: boolean;
}

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(startSec: number, endSec: number): string {
	const duration = endSec - startSec;
	return formatTime(duration);
}

function formatDate(isoString: string): string {
	const date = new Date(isoString);
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function ClipCard({
	clip,
	profileName,
	showRecordingInfo = false,
}: ClipCardProps) {
	return (
		<Link
			to="/p/$profileName/clips/$clipId"
			params={{
				profileName,
				clipId: clip.id,
			}}
			className="block bg-background border rounded-lg hover:border-primary/50 transition-colors p-4"
		>
			<div className="space-y-3">
				{/* Clip name and time range */}
				<div>
					<div className="font-semibold text-base">
						{clip.display_name ||
							`Clip ${formatTime(clip.start_time_sec)} - ${formatTime(
								clip.end_time_sec
							)}`}
					</div>
					<div className="text-sm text-muted-foreground flex items-center gap-4 mt-1">
						<span className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5" />
							{formatTime(clip.start_time_sec)} →{" "}
							{formatTime(clip.end_time_sec)}
							<span className="ml-1 text-muted-foreground/70">
								({formatDuration(clip.start_time_sec, clip.end_time_sec)})
							</span>
						</span>
					</div>
				</div>

				{/* Recording context (shown on song page) */}
				{showRecordingInfo && (
					<div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
						<div className="flex items-center gap-1.5">
							<span className="font-medium">
								Recording: {clip.recording_output_name}
							</span>
						</div>
						<div className="flex items-center gap-3">
							{clip.created_at && (
								<span className="flex items-center gap-1">
									<Calendar className="h-3 w-3" />
									{formatDate(clip.created_at)}
								</span>
							)}
						</div>
					</div>
				)}
			</div>
		</Link>
	);
}
