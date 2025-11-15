import { format } from "date-fns";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
  FileWithStems,
  RecordingStatusResponse,
} from "@/api/generated/types.gen";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCreateLocation,
  useProfileLocations,
  useRecording,
  useUpdateRecordingMetadata,
} from "@/hooks/queries";
import { MetadataEditor } from "./MetadataEditor";
import "../styles/metadata-editor.css";

interface MetadataPageProps {
  recording: RecordingStatusResponse | FileWithStems;
  profileName: string;
  wasInitiallyProcessing: boolean;
  onContinue?: () => void;
}

export function MetadataPage({
  recording,
  profileName,
  wasInitiallyProcessing,
  onContinue,
}: MetadataPageProps) {
  const recordingId =
    "recording_id" in recording ? recording.recording_id : recording.id;

  // Poll for recording status updates (every 5 seconds if processing)
  const { data: polledRecording } = useRecording(recordingId);

  // Use polled recording if available, otherwise use prop
  const currentRecording = polledRecording || recording;

  const { data: locations = [] } = useProfileLocations(profileName);
  const createLocation = useCreateLocation();
  const updateMetadata = useUpdateRecordingMetadata();

  // Local state for form values
  const [displayName, setDisplayName] = useState(
    "display_name" in recording && recording.display_name
      ? recording.display_name
      : "name" in recording
        ? recording.name
        : "",
  );
  const [selectedSongId, setSelectedSongId] = useState<string | null>(
    "song" in recording && recording.song ? recording.song.id : null,
  );
  const [selectedLocationName, setSelectedLocationName] = useState<
    string | null
  >(
    "location" in recording && recording.location
      ? recording.location.name
      : null,
  );
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    "date_recorded" in recording && recording.date_recorded
      ? new Date(recording.date_recorded)
      : new Date(),
  );

  const isProcessing = currentRecording.status === "processing";
  const isComplete = currentRecording.status === "complete";
  const showContinueButton = wasInitiallyProcessing && isComplete && onContinue;

  const handleSave = async () => {
    try {
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
      await updateMetadata.mutateAsync({
        path: { recording_id: recordingId },
        body: {
          song_id: selectedSongId || undefined,
          location_id: locationId,
          date_recorded: selectedDate
            ? format(selectedDate, "yyyy-MM-dd")
            : undefined,
        },
      });

      // If this is the interstitial page with continue button, navigate
      if (onContinue) {
        onContinue();
      }
    } catch (error) {
      console.error("Failed to save metadata:", error);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recordingId);
      toast.success("Recording ID copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      toast.error(`Could not copy Recording ID. ID: ${recordingId}`);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-4">
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Recording Metadata</CardTitle>
            {isProcessing && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {isComplete && <Check className="h-4 w-4 text-green-500" />}
          </div>
          <CardDescription>
            {isProcessing &&
              "Processing... You can add metadata while waiting."}
            {isComplete &&
              !showContinueButton &&
              "Edit metadata for this recording"}
            {showContinueButton &&
              "Processing complete! Add metadata or continue to playback."}
          </CardDescription>
          <div className="flex items-center space-x-2 mt-4">
            <Input
              type="text"
              value={recordingId}
              readOnly
              className="flex-grow"
            />
            <Button onClick={handleCopy} size="sm">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <MetadataEditor
            profileName={profileName}
            displayName={displayName}
            selectedSongId={selectedSongId}
            selectedLocationName={selectedLocationName}
            selectedDate={selectedDate}
            onDisplayNameChange={setDisplayName}
            onSongChange={setSelectedSongId}
            onLocationChange={setSelectedLocationName}
            onDateChange={setSelectedDate}
            onSave={handleSave}
            mode="inline"
            saveButtonText={
              showContinueButton ? "Continue to Recording" : "Save"
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
