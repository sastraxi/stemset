import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { apiRecordingsRecordingIdDeleteRecordingEndpoint } from "@/api/generated";
import type { FileWithStems } from "@/api/generated/types.gen";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useCreateLocation,
	useProfileLocations,
	useUpdateDisplayName,
	useUpdateRecordingMetadata,
} from "@/hooks/queries";
import { MetadataEditor } from "./MetadataEditor";
import "../styles/metadata-editor.css";

interface MetadataEditorModalProps {
	recording: FileWithStems;
	profileId: string;
	profileName: string;
	open: boolean;
	onClose: () => void;
	onUpdate?: (updatedRecording: FileWithStems) => void;
}

export function MetadataEditorModal({
	recording,
	profileId,
	profileName,
	open,
	onClose,
	onUpdate,
}: MetadataEditorModalProps) {
	// Local state for form values
	const [displayName, setDisplayName] = useState(recording.display_name);
	const [selectedSongId, setSelectedSongId] = useState<string | null>(
		recording.song ? recording.song.id : null,
	);
	// For OSM, we'll store the location name as a string
	const [selectedLocationName, setSelectedLocationName] = useState<
		string | null
	>(recording.location ? recording.location.name : null);
	const [selectedDate, setSelectedDate] = useState<Date | undefined>(
		recording.date_recorded ? new Date(recording.date_recorded) : new Date(),
	);
	const [isDeleting, setIsDeleting] = useState(false);

	const queryClient = useQueryClient();
	const { data: locations = [] } = useProfileLocations(profileId);
	const updateDisplayNameMutation = useUpdateDisplayName();
	const updateMetadata = useUpdateRecordingMetadata();
	const createLocation = useCreateLocation();

	const handleSave = async () => {
		try {
			// Update display name
			if (displayName !== recording.display_name) {
				await updateDisplayNameMutation.mutateAsync({
					path: {
						profile_name: profileName,
						output_name: recording.name,
					},
					body: { display_name: displayName },
				});
			}

			// Handle location: find or create from LocationIQ name
			let locationId: string | undefined;
			if (selectedLocationName) {
				// Check if location already exists
				const existingLocation = locations.find(
					(loc) => loc.name === selectedLocationName,
				);
				if (existingLocation) {
					locationId = existingLocation.id;
				} else {
					// Create new location from LocationIQ result
					const newLocation = await createLocation.mutateAsync({
						path: { profile_id: profileId },
						body: { name: selectedLocationName },
					});
					locationId = newLocation.id;
				}
			}

			// Update metadata
			// FIXME: return song and location in response
			await updateMetadata.mutateAsync({
				path: { recording_id: recording.id },
				body: {
					song_id: selectedSongId || undefined,
					location_id: locationId,
					date_recorded: selectedDate
						? format(selectedDate, "yyyy-MM-dd")
						: undefined,
				},
			});

			// Build updated recording object
			const updatedRecordingData: FileWithStems = {
				...recording,
				display_name: displayName,
				// song: updatedRecording.song,
				// location: updatedRecording.location,
				date_recorded: selectedDate ? format(selectedDate, "yyyy-MM-dd") : null,
			};

			// Update React Query cache with new data
			queryClient.setQueryData(
				["recording", recording.id],
				updatedRecordingData,
			);

			// Also invalidate the profile files query to refresh the list
			queryClient.invalidateQueries({
				queryKey: ["profile-files", profileName],
			});

			// Notify parent component of the update
			if (onUpdate) {
				onUpdate(updatedRecordingData);
			}

			toast.success("Metadata updated successfully");
			onClose();
		} catch (error) {
			console.error("Failed to save metadata:", error);
			toast.error("Failed to update metadata");
		}
	};

	const handleCancel = () => {
		// Reset to original values
		setDisplayName(recording.display_name);
		setSelectedSongId(recording.song ? recording.song.id : null);
		setSelectedLocationName(
			recording.location ? recording.location.name : null,
		);
		setSelectedDate(
			recording.date_recorded ? new Date(recording.date_recorded) : new Date(),
		);
		onClose();
	};

	const handleDelete = async () => {
		try {
			setIsDeleting(true);

			await apiRecordingsRecordingIdDeleteRecordingEndpoint({
				path: {
					recording_id: recording.id,
				},
			});

			toast.success("Recording deleted successfully");

			// Navigate back to profile page
			window.location.href = `/p/${profileName}`;
		} catch (error) {
			console.error("Failed to delete recording:", error);
			toast.error("Failed to delete recording");
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(newOpen) => {
				// Prevent closing via escape/backdrop click
				if (!newOpen) {
					// User tried to close - do nothing
					return;
				}
			}}
		>
			<DialogContent
				className="sm:max-w-[700px] metadata-editor-modal-content"
				onEscapeKeyDown={(e) => e.preventDefault()}
				onPointerDownOutside={(e) => e.preventDefault()}
				onInteractOutside={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Edit Recording Metadata</DialogTitle>
				</DialogHeader>
				<MetadataEditor
					profileId={profileId}
					displayName={displayName}
					selectedSongId={selectedSongId}
					selectedLocationName={selectedLocationName}
					selectedDate={selectedDate}
					onDisplayNameChange={setDisplayName}
					onSongChange={setSelectedSongId}
					onLocationChange={setSelectedLocationName}
					onDateChange={setSelectedDate}
					onSave={handleSave}
					onCancel={handleCancel}
					onDelete={handleDelete}
					isDeleting={isDeleting}
				/>
			</DialogContent>
		</Dialog>
	);
}
