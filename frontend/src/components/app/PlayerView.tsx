import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { RecordingWithStems } from "@/api/generated";
import {
  apiClipsClipIdGetClipEndpoint,
  apiRecordingsRecordingIdDeleteRecordingEndpoint,
  apiSongsSongIdClipsGetSongClips,
} from "@/api/generated";
import { useDeleteClip, useRecording } from "@/hooks/queries";
import { DeleteConfirmationModal } from "@/components/modals/DeleteConfirmationModal";
import { MetadataEditorModal } from "@/components/modals/MetadataEditorModal";
import { MetadataPage } from "@/components/common/MetadataPage";
import { QRCodeModal } from "@/components/modals/QRCodeModal";
import { RecordingPlayer } from "@/components/player/RecordingPlayer";
import { SongMetadata } from "@/components/common/SongMetadata";
import { SongPageView } from "@/components/views/SongPageView";
import { HomePageView } from "@/components/views/HomePageView";
import type { StemPlayerHandle } from "@/components/player/StemPlayer";
import type { SortField, SortDirection } from "@/hooks/useSortPreference";
import { Spinner } from "@/components/ui/spinner";

interface PlayerViewProps {
  isHomePage?: boolean;
  selectedProfile: string | null;
  selectedFile: RecordingWithStems | null;
  initialClip?: string;
  initialSong?: string;
  initialStateParam?: string;
  onFileSelect: (file: RecordingWithStems | null) => void;
  googleDriveFolderId?: string | null;
  files?: RecordingWithStems[];
  filesLoading?: boolean;
  filesError?: Error | null;
  refetchFiles?: () => void;
  sortField?: SortField;
  sortDirection?: SortDirection;
  cycleSort?: () => void;
}

export function PlayerView({
  isHomePage = false,
  selectedProfile,
  selectedFile,
  initialClip,
  initialSong,
  initialStateParam,
  onFileSelect,
  googleDriveFolderId,
  files = [],
  filesLoading = false,
  filesError = null,
  refetchFiles = () => {},
  sortField = "date",
  sortDirection = "desc",
  cycleSort = () => {},
}: PlayerViewProps) {
  const [isLoadingStems, setIsLoadingStems] = useState(false);
  const [wasInitiallyProcessing, setWasInitiallyProcessing] = useState(false);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Clip-specific modal states
  const [isClipMetadataEditorOpen, setIsClipMetadataEditorOpen] =
    useState(false);
  const [isClipQRModalOpen, setIsClipQRModalOpen] = useState(false);
  const [isClipDeleteModalOpen, setIsClipDeleteModalOpen] = useState(false);
  const [isDeletingClip, setIsDeletingClip] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [createClipHandler, setCreateClipHandler] = useState<
    (() => void) | null
  >(null);
  const [hasClipSelection, setHasClipSelection] = useState(false);

  const stemPlayerRef = useRef<StemPlayerHandle>(null);
  const navigate = useNavigate();

  const isOnClipRoute = !!initialClip;
  const isOnSongRoute = !!initialSong;

  // Fetch clip data when on clip route
  const { data: clip, isLoading: clipLoading } = useQuery({
    queryKey: ["clip", initialClip],
    queryFn: () =>
      apiClipsClipIdGetClipEndpoint({
        path: { clip_id: initialClip! },
      }),
    enabled: !!initialClip,
  });

  // Fetch the recording status for the clip to get location/date metadata
  const clipRecordingStatus = useRecording(clip?.data?.recording_id);

  // Build a RecordingWithStems from clip data and recording status
  const clipRecordingData: RecordingWithStems | null = useMemo(() => {
    if (!clip?.data || !clipRecordingStatus.data) return null;

    return {
      id: clip.data.recording_id,
      name: clip.data.recording_output_name,
      display_name: clipRecordingStatus.data.display_name,
      date_recorded: clipRecordingStatus.data.date_recorded || null,
      status: "complete" as const,
      stems: clip.data.stems,
      created_at: clip.data.created_at,
      song: clip.data.song || null,
      location: clipRecordingStatus.data.location || null,
    };
  }, [clip?.data, clipRecordingStatus.data]);

  // Fetch song clips when on song route
  const {
    data: songClips,
    isLoading: songClipsLoading,
    error: songClipsError,
  } = useQuery({
    queryKey: ["song-clips", initialSong],
    queryFn: () =>
      apiSongsSongIdClipsGetSongClips({
        path: { song_id: initialSong! },
      }),
    enabled: !!initialSong,
  });

  useEffect(() => {
    if (selectedFile && initialStateParam === "processing") {
      setWasInitiallyProcessing(true);
    }
  }, [selectedFile, initialStateParam]);

  const deleteClipMutation = useDeleteClip();

  const handleDeleteRecording = async () => {
    if (!selectedFile || !selectedProfile) return;

    try {
      setIsDeleting(true);

      await apiRecordingsRecordingIdDeleteRecordingEndpoint({
        path: {
          recording_id: selectedFile.id,
        },
      });

      toast.success("Recording deleted successfully");
      setIsDeleteModalOpen(false);
      onFileSelect(null);

      // Navigate back to profile page
      navigate({
        to: "/p/$profileName",
        params: { profileName: selectedProfile },
      });
    } catch (error) {
      console.error("Failed to delete recording:", error);
      toast.error("Failed to delete recording");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteClip = async () => {
    if (!clip?.data || !selectedProfile) return;

    try {
      setIsDeletingClip(true);

      await deleteClipMutation.mutateAsync({
        path: {
          clip_id: clip.data.id,
        },
      });

      toast.success("Clip deleted successfully");
      setIsClipDeleteModalOpen(false);

      // Navigate back to profile page
      navigate({
        to: "/p/$profileName",
        params: { profileName: selectedProfile },
      });
    } catch (error) {
      console.error("Failed to delete clip:", error);
      toast.error("Failed to delete clip");
    } finally {
      setIsDeletingClip(false);
    }
  };

  const handleCreateClipChange = useCallback(
    (handler: (() => void) | null, hasSelection: boolean) => {
      setCreateClipHandler(() => handler);
      setHasClipSelection(hasSelection);
    },
    [],
  );

  const isOnDetailView = isOnSongRoute || isOnClipRoute || !!selectedFile;
  const showPlayerArea = isOnDetailView || isHomePage;

  return (
    <main
      className={`player-area ${showPlayerArea ? "block" : "md:block hidden"}`}
    >
      {isOnSongRoute ? (
        songClipsLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size="md" />
          </div>
        ) : songClipsError ? (
          <div className="empty-state">
            <p className="text-2xl font-bold mb-2">Song Not Found</p>
            <p>The requested song does not exist or has been deleted.</p>
          </div>
        ) : selectedProfile && initialSong && songClips?.data ? (
          <SongPageView
            songId={initialSong}
            songName={songClips.data[0]?.song?.name || "Untitled Song"}
            profileName={selectedProfile}
          />
        ) : null
      ) : isOnClipRoute && clip?.data && clipRecordingData ? (
        <>
          <div className="recording-header">
            {!clipLoading && !clipRecordingStatus.isLoading && (
              <SongMetadata
                recording={{
                  ...clipRecordingData,
                  display_name:
                    clip.data.display_name || clipRecordingData.display_name,
                }}
                onEdit={() => setIsClipMetadataEditorOpen(true)}
                onShowQR={() => setIsClipQRModalOpen(true)}
                onDelete={() => setIsClipDeleteModalOpen(true)}
                duration={clip.data.end_time_sec - clip.data.start_time_sec}
              />
            )}
            <div
              id="playback-controls-container"
              className="playback-controls-header"
            >
              {/* Playback controls will be rendered here by StemPlayer */}
            </div>
          </div>

          {/* Modals for clip */}
          {clipRecordingData && selectedProfile && (
            <>
              <MetadataEditorModal
                recording={clipRecordingData}
                clip={{
                  id: clip.data.id,
                  display_name: clip.data.display_name,
                  song_id: clip.data.song_id,
                }}
                profileName={selectedProfile}
                open={isClipMetadataEditorOpen}
                onClose={() => setIsClipMetadataEditorOpen(false)}
              />
              <QRCodeModal
                isOpen={isClipQRModalOpen}
                onClose={() => setIsClipQRModalOpen(false)}
                url={encodeURI(
                  `${import.meta.env.VITE_FRONTEND_URL || window.location.origin}/p/${selectedProfile}/clips/${clip.data.id}`,
                )}
                currentTime={audioCurrentTime}
              />
              <DeleteConfirmationModal
                isOpen={isClipDeleteModalOpen}
                onClose={() => setIsClipDeleteModalOpen(false)}
                onConfirm={handleDeleteClip}
                recordingTitle={clip.data.display_name || "this clip"}
                isDeleting={isDeletingClip}
              />
            </>
          )}

          <RecordingPlayer
            recordingId={clip.data.recording_id}
            stemsData={clip.data.stems}
            profileName={selectedProfile!}
            fileName={clip.data.recording_output_name}
            clip={{
              id: clip.data.id,
              startTimeSec: clip.data.start_time_sec,
              endTimeSec: clip.data.end_time_sec,
            }}
            onLoadingChange={setIsLoadingStems}
            onDurationChange={setAudioDuration}
            onCurrentTimeChange={setAudioCurrentTime}
          />
        </>
      ) : selectedFile && selectedProfile ? (
        selectedFile.status === "processing" ||
        selectedFile.status === "error" ||
        (wasInitiallyProcessing && selectedFile.status === "complete") ? (
          <MetadataPage
            recording={selectedFile}
            profileName={selectedProfile}
            wasInitiallyProcessing={wasInitiallyProcessing}
            onContinue={() => {
              setWasInitiallyProcessing(false);
              // Clear the initialState query param to show the player
              navigate({
                to: "/p/$profileName/$recordingName",
                params: {
                  profileName: selectedProfile,
                  recordingName: selectedFile.name,
                },
                search: {},
              });
            }}
          />
        ) : (
          <>
            <div className="recording-header">
              {!isLoadingStems && (
                <SongMetadata
                  recording={selectedFile}
                  onEdit={() => setIsMetadataEditorOpen(true)}
                  onShowQR={() => setIsQRModalOpen(true)}
                  onDelete={() => setIsDeleteModalOpen(true)}
                  onCreateClip={createClipHandler || undefined}
                  hasSelection={hasClipSelection}
                  duration={audioDuration}
                />
              )}
              <div
                id="playback-controls-container"
                className="playback-controls-header"
              >
                {/* Playback controls will be rendered here by StemPlayer */}
              </div>
            </div>
            {selectedFile && selectedProfile && (
              <>
                <MetadataEditorModal
                  recording={selectedFile}
                  profileName={selectedProfile}
                  open={isMetadataEditorOpen}
                  onClose={() => setIsMetadataEditorOpen(false)}
                  onUpdate={(updatedRecording) => {
                    onFileSelect(updatedRecording);
                  }}
                />
                <QRCodeModal
                  isOpen={isQRModalOpen}
                  onClose={() => setIsQRModalOpen(false)}
                  url={encodeURI(
                    `${import.meta.env.VITE_FRONTEND_URL || window.location.origin}/p/${selectedProfile}/${selectedFile.name}`,
                  )}
                  currentTime={audioCurrentTime}
                />
                <DeleteConfirmationModal
                  isOpen={isDeleteModalOpen}
                  onClose={() => setIsDeleteModalOpen(false)}
                  onConfirm={handleDeleteRecording}
                  recordingTitle={selectedFile.display_name}
                  isDeleting={isDeleting}
                />
              </>
            )}
            <RecordingPlayer
              key={`${selectedProfile}::${selectedFile.name}`}
              ref={stemPlayerRef}
              profileName={selectedProfile}
              fileName={selectedFile.name}
              stemsData={selectedFile.stems}
              onLoadingChange={setIsLoadingStems}
              onDurationChange={setAudioDuration}
              onCurrentTimeChange={setAudioCurrentTime}
              onCreateClipChange={handleCreateClipChange}
              recordingId={selectedFile.id}
            />
          </>
        )
      ) : isHomePage && selectedProfile ? (
        <HomePageView
          profileName={selectedProfile}
          googleDriveFolderId={googleDriveFolderId}
          files={files}
          filesLoading={filesLoading}
          filesError={filesError}
          refetchFiles={refetchFiles}
          sortField={sortField}
          sortDirection={sortDirection}
          cycleSort={cycleSort}
          selectedFileName={selectedFile?.name || null}
          onFileSelect={onFileSelect}
        />
      ) : (
        <div className="empty-state">
          <p>Select a recording to start playing</p>
        </div>
      )}
    </main>
  );
}
