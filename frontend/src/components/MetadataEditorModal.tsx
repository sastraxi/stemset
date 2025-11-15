import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
  useUpdateClip,
  useUpdateDisplayName,
  useUpdateRecordingMetadata,
} from "@/hooks/queries";
import { MetadataEditor } from "./MetadataEditor";
import "../styles/metadata-editor.css";

interface MetadataEditorModalProps {
  recording: FileWithStems;
  clip?: {
    id: string;
    display_name?: string | null;
    song_id?: string | null;
  };
  profileName: string;
  open: boolean;
  onClose: () => void;
  onUpdate?: (updatedRecording: FileWithStems) => void;
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
  const initialSongId =
    clip?.song_id ?? (recording.song ? recording.song.id : null);

  // Local state for form values
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(
    initialSongId,
  );
  // For OSM, we'll store the location name as a string
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
    setSelectedSongId(
      clip?.song_id ?? (recording.song ? recording.song.id : null),
    );
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
              path: { profile_name: profileName },
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
          date_recorded: selectedDate
            ? format(selectedDate, "yyyy-MM-dd")
            : null,
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
    setSelectedSongId(
      clip?.song_id ?? (recording.song ? recording.song.id : null),
    );
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
          onSongChange={setSelectedSongId}
          onLocationChange={clip ? undefined : setSelectedLocationName}
          onDateChange={clip ? undefined : setSelectedDate}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
