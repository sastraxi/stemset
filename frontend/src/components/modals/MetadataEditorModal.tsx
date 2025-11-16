import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { RecordingWithStems } from "@/api/generated/types.gen";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCreateLocation,
  useProfileLocations,
  useUpdateClip,
  useUpdateDisplayName,
  useUpdateRecordingMetadata,
} from "@/hooks/queries";
import { MetadataEditor } from "@/components/common/MetadataEditor";
import "@/styles/metadata-editor.css";

interface MetadataEditorModalProps {
  recording: RecordingWithStems;
  clip?: {
    id: string;
    display_name?: string | null;
    song_id?: string | null;
  };
  profileName: string;
  open: boolean;
  onClose: () => void;
  onUpdate?: (updatedRecording: RecordingWithStems) => void;
}

export function MetadataEditorModal({
  recording,
  clip,
  profileName,
  open,
  onClose,
  onUpdate,
}: MetadataEditorModalProps) {
  // Determine initial values from clip or recording
  const initialDisplayName = clip?.display_name ?? recording.display_name;

  // Local state for form values
  const [displayName, setDisplayName] = useState(initialDisplayName);
  // Song is only for clips now
  const [selectedSongId, setSelectedSongId] = useState<string | null>(
    clip?.song_id ?? null,
  );
  const [selectedLocationName, setSelectedLocationName] = useState<
    string | null
  >(recording.location ? recording.location.name : null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    recording.date_recorded ? new Date(recording.date_recorded) : new Date(),
  );

  const queryClient = useQueryClient();
  const { data: locations = [] } = useProfileLocations(profileName);
  const updateDisplayNameMutation = useUpdateDisplayName();
  const updateMetadata = useUpdateRecordingMetadata();
  const updateClipMutation = useUpdateClip();
  const createLocation = useCreateLocation();

  // Sync local state with recording/clip props when they change
  useEffect(() => {
    setDisplayName(clip?.display_name ?? recording.display_name);
    setSelectedSongId(clip?.song_id ?? null);
    setSelectedLocationName(
      recording.location ? recording.location.name : null,
    );
    setSelectedDate(
      recording.date_recorded ? new Date(recording.date_recorded) : new Date(),
    );
  }, [recording, clip]);

  const handleSave = async () => {
    try {
      if (clip) {
        // For clips: only update clip-specific fields (name and song)
        await updateClipMutation.mutateAsync({
          path: { clip_id: clip.id },
          body: {
            display_name: displayName || null,
            song_id: selectedSongId || null,
          },
        });

        toast.success("Clip metadata updated successfully");
      } else {
        // For recordings: update display name
        if (displayName !== recording.display_name) {
          await updateDisplayNameMutation.mutateAsync({
            path: {
              profile_name: profileName,
              output_name: recording.name,
            },
            body: { display_name: displayName },
          });
        }

        // Handle location: find or create from name
        let locationId: string | undefined;
        if (selectedLocationName) {
          // Check if location already exists
          const existingLocation = locations.find(
            (loc) => loc.name === selectedLocationName,
          );
          if (existingLocation) {
            locationId = existingLocation.id;
          } else {
            // Create new location
            const newLocation = await createLocation.mutateAsync({
              path: { profile_name: profileName },
              body: { name: selectedLocationName },
            });
            locationId = newLocation.id;
          }
        }

        // Update metadata - API now returns location and date_recorded
        const updatedRecording = await updateMetadata.mutateAsync({
          path: { recording_id: recording.id },
          body: {
            location_id: locationId,
            date_recorded: selectedDate
              ? format(selectedDate, "yyyy-MM-dd")
              : undefined,
          },
        });

        // Build updated recording object with response data
        const updatedRecordingData: RecordingWithStems = {
          ...recording,
          display_name: displayName,
          location: updatedRecording.location,
          date_recorded: updatedRecording.date_recorded,
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
      }

      onClose();
    } catch (error) {
      console.error("Failed to save metadata:", error);
      toast.error("Failed to update metadata");
    }
  };

  const handleCancel = () => {
    // Reset to original values
    setDisplayName(clip?.display_name ?? recording.display_name);
    setSelectedSongId(clip?.song_id ?? null);
    setSelectedLocationName(
      recording.location ? recording.location.name : null,
    );
    setSelectedDate(
      recording.date_recorded ? new Date(recording.date_recorded) : new Date(),
    );
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) handleCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-[700px] metadata-editor-modal-content"
        onEscapeKeyDown={handleCancel}
        onPointerDownOutside={handleCancel}
        onInteractOutside={handleCancel}
      >
        <DialogHeader>
          <DialogTitle>
            {clip ? "Edit Clip Metadata" : "Edit Recording Metadata"}
          </DialogTitle>
        </DialogHeader>
        <MetadataEditor
          profileName={profileName}
          displayName={displayName}
          selectedSongId={selectedSongId}
          selectedLocationName={selectedLocationName}
          selectedDate={selectedDate}
          onDisplayNameChange={setDisplayName}
          onSongChange={clip ? setSelectedSongId : undefined}
          onLocationChange={clip ? undefined : setSelectedLocationName}
          onDateChange={clip ? undefined : setSelectedDate}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
