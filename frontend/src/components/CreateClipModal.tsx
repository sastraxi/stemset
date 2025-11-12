import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { apiRecordingsRecordingIdClipsCreateClipEndpoint } from "../api/generated";

interface CreateClipModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	startSec: number;
	endSec: number;
	recordingId: string;
	profileName: string;
}

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 100);
	return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

export function CreateClipModal({
	open,
	onOpenChange,
	startSec,
	endSec,
	recordingId,
	profileName,
}: CreateClipModalProps) {
	const [displayName, setDisplayName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const duration = endSec - startSec;

	const handleCreate = async () => {
		setIsCreating(true);
		try {
			const response = await apiRecordingsRecordingIdClipsCreateClipEndpoint({
				path: { recording_id: recordingId },
				body: {
					recording_id: recordingId,
					start_time_sec: startSec,
					end_time_sec: endSec,
					display_name: displayName || null,
				},
			});

			// Invalidate clips query to refresh sidebar
			await queryClient.invalidateQueries({
				queryKey: ["recording-clips", recordingId],
			});

			// Close modal
			onOpenChange(false);

			// Navigate to the new clip
			if (response.data) {
				await navigate({
					to: "/p/$profileName/clips/$clipId",
					params: { profileName, clipId: response.data.id },
				});
			}

			// Reset form
			setDisplayName("");
		} catch (error) {
			console.error("Failed to create clip:", error);
			// TODO: Show error toast
		} finally {
			setIsCreating(false);
		}
	};

	const handleCancel = () => {
		onOpenChange(false);
		setDisplayName("");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Create Clip</DialogTitle>
					<DialogDescription>
						Create a new clip from the selected time range.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid grid-cols-4 items-center gap-4">
						<label htmlFor="duration" className="text-right text-sm font-medium">
							Duration
						</label>
						<div id="duration" className="col-span-3 text-sm text-muted-foreground">
							{formatTime(duration)}
						</div>
					</div>

					<div className="grid grid-cols-4 items-center gap-4">
						<label htmlFor="range" className="text-right text-sm font-medium">
							Range
						</label>
						<div id="range" className="col-span-3 text-sm text-muted-foreground">
							{formatTime(startSec)} → {formatTime(endSec)}
						</div>
					</div>

					<div className="grid grid-cols-4 items-center gap-4">
						<label htmlFor="name" className="text-right text-sm font-medium">
							Name
						</label>
						<Input
							id="name"
							placeholder="Clip name (optional)"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
							className="col-span-3"
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleCreate();
								}
							}}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={handleCancel}
						disabled={isCreating}
					>
						Cancel
					</Button>
					<Button type="button" onClick={handleCreate} disabled={isCreating}>
						{isCreating ? "Creating..." : "Create Clip"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
