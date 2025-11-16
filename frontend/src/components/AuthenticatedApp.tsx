import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiClipsClipIdGetClipEndpoint,
  apiSongsSongIdClipsGetSongClips,
} from "@/api/generated";
import {
  useDeleteClip,
  useProfileFiles,
  useProfiles,
  useRecording,
} from "../hooks/queries";
import { useSortPreference } from "../hooks/useSortPreference";
import { setSessionProfile, setSessionRecording } from "../lib/storage";
import { getRelativeTime } from "../lib/utils";
import "../styles/effects.css";
import "../styles/layout.css";
import "../styles/player.css";
import "../styles/sidebar.css";
import "../styles/splash.css";
import "../styles/waveform.css";
import type { RecordingWithStems } from "@/api/generated";
import { apiRecordingsRecordingIdDeleteRecordingEndpoint } from "@/api/generated";
import { ClipsView } from "./ClipsView";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import { MetadataEditorModal } from "./MetadataEditorModal";
import { MetadataPage } from "./MetadataPage";
import { ProfileSelector } from "./ProfileSelector";
import { QRCodeModal } from "./QRCodeModal";
import { QRUploadOverlay } from "./QRUploadOverlay";
import { RecordingPlayer } from "./RecordingPlayer";
import { RecordingsView } from "./RecordingsView";
import { SongMetadata } from "./SongMetadata";
import { SongPageView } from "./SongPageView";
import { SongsView } from "./SongsView";
import type { StemPlayerHandle } from "./StemPlayer";
import { Upload } from "./Upload";
import { UserNav } from "./UserNav";
import { Spinner } from "./ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface AuthenticatedAppProps {
  user: { id: string; name: string; email: string; picture?: string };
  onLogout: () => void;
  initialProfile?: string;
  initialRecording?: string;
  initialClip?: string;
  initialSong?: string;
  sourceParam?: string;
  initialStateParam?: string;
  timeParam?: number;
}

export function AuthenticatedApp({
  user,
  onLogout,
  initialProfile,
  initialRecording,
  initialClip,
  initialSong,
  sourceParam,
  initialStateParam,
}: AuthenticatedAppProps) {
  useEffect(() => {
    const handleResize = () => {
      console.log("Window resized, new width:", window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const [selectedProfile, setSelectedProfile] = useState<string | null>(
    initialProfile || null,
  );
  const [selectedFile, setSelectedFile] = useState<RecordingWithStems | null>(
    null,
  );
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

  // Initialize sidebar tab based on initial route
  const [sidebarTab, setSidebarTab] = useState<string>(() => {
    if (initialSong) return "songs";
    if (initialClip) return "clips";
    return "recordings";
  });

  const stemPlayerRef = useRef<StemPlayerHandle>(null);
  const navigate = useNavigate();

  // Check if we're on a detail view route (recording, clip, or song)
  const isOnRecordingRoute = !!initialRecording;
  const isOnClipRoute = !!initialClip;
  const isOnSongRoute = !!initialSong;

  // Track previous route to detect actual navigation changes
  const prevRouteRef = useRef({
    song: initialSong,
    clip: initialClip,
    recording: initialRecording,
  });

  useEffect(() => {
    const prev = prevRouteRef.current;
    const current = {
      song: initialSong,
      clip: initialClip,
      recording: initialRecording,
    };

    // Only update tab if we actually navigated to a different item
    const routeChanged =
      prev.song !== current.song ||
      prev.clip !== current.clip ||
      prev.recording !== current.recording;

    if (routeChanged) {
      prevRouteRef.current = current;

      // Set tab based on new route
      if (initialSong) {
        setSidebarTab("songs");
      } else if (initialClip) {
        setSidebarTab("clips");
      } else if (initialRecording) {
        setSidebarTab("recordings");
      }
    }
  }, [initialSong, initialClip, initialRecording]);

  const { data: profiles } = useProfiles();

  const {
    data: files,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useProfileFiles(selectedProfile || undefined);

  // Fetch the full recording data (with config) when we have a selected file
  // This primes the React Query cache for useConfigPersistence
  useRecording(selectedFile?.id);

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

  // Set selected profile based on initial or first available
  useEffect(() => {
    if (profiles && !selectedProfile) {
      // Validate initialProfile exists
      const validInitialProfile =
        initialProfile && profiles.some((p) => p.name === initialProfile);
      if (validInitialProfile) {
        setSelectedProfile(initialProfile);
      } else if (profiles.length > 0) {
        setSelectedProfile(profiles[0].name);
        console.log(
          "[AuthenticatedApp] Using fallback profile:",
          profiles[0].name,
        );
      }
    }
  }, [profiles, selectedProfile, initialProfile]);

  // Set selected file based on initial recording
  useEffect(() => {
    if (files && initialRecording && selectedProfile === initialProfile) {
      const targetFile = files.find((f) => f.name === initialRecording);
      if (targetFile && selectedFile?.name !== targetFile.name) {
        setSelectedFile(targetFile);
        // Track if this recording was initially processing
        if (initialStateParam === "processing") {
          setWasInitiallyProcessing(true);
        }
        setTimeout(() => stemPlayerRef.current?.focus(), 100);
      } else if (!targetFile && initialRecording) {
        // Initial recording doesn't exist - clear selection
        setSelectedFile(null);
      }
    }
  }, [
    files,
    initialRecording,
    selectedProfile,
    initialProfile,
    initialStateParam,
  ]);

  // Persist selected profile to localStorage
  useEffect(() => {
    if (selectedProfile) {
      setSessionProfile(selectedProfile);
    }
  }, [selectedProfile]);

  // Persist selected recording to localStorage
  useEffect(() => {
    if (selectedFile && selectedProfile) {
      setSessionRecording(selectedProfile, selectedFile.name);
    }
  }, [selectedFile, selectedProfile]);

  const handleNavigateToRecording = async (
    profileName: string,
    fileName: string,
  ) => {
    // Switch to the profile if needed
    if (selectedProfile !== profileName) {
      setSelectedProfile(profileName);
    }

    console.log("Navigating to recording:", profileName, fileName);

    // Refresh the file list to ensure the new recording appears
    await refetchFiles();

    // Navigate to the recording URL with initialState=processing query param
    navigate({
      to: "/p/$profileName/$recordingName",
      params: { profileName, recordingName: fileName },
      search: { initialState: "processing" },
    });
  };

  const handleProfileChange = (profileName: string) => {
    setSelectedProfile(profileName);
    setSelectedFile(null); // Clear selected file when changing profiles
    navigate({ to: "/p/$profileName", params: { profileName } });
  };

  const handleFileSelect = (file: RecordingWithStems) => {
    setSelectedFile(file);
    if (selectedProfile) {
      console.log("handleFileSelect:", file);
      navigate({
        to: "/p/$profileName/$recordingName",
        params: {
          profileName: selectedProfile,
          recordingName: file.name,
        },
      });
    }
    setTimeout(() => stemPlayerRef.current?.focus(), 100);
  };

  const handleRefresh = async () => {
    try {
      await refetchFiles();
    } catch (error) {
      console.error("Error refreshing files:", error);
      toast.error("Error refreshing file list");
    }
  };

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

  // Sort hook for recordings
  const { sortField, sortDirection, cycleSort, sortData } = useSortPreference({
    storageKey: "stemset-sort-recordings",
    defaultField: "date",
    defaultDirection: "desc",
  });

  // Sort files using the sort hook
  const sortedFiles = useMemo(() => {
    if (!files) return [];
    return sortData<RecordingWithStems>(
      files,
      (file) => file.date_recorded,
      (file) => file.display_name || file.name,
    );
  }, [files, sortData]);

  // Calculate file counts for profile selector
  const fileCountByProfile: Record<string, number> = {};
  if (profiles) {
    profiles.forEach((profile) => {
      // This is a simplified version - in a real app you might want to cache these counts
      fileCountByProfile[profile.name] = 0; // We'll update this as needed
    });
  }
  if (selectedProfile && files) {
    fileCountByProfile[selectedProfile] = files.length;
  }

  return (
    <div className="app">
      <header className="px-3 py-2 flex justify-between items-center md:px-6 md:py-4">
        <div className="flex-1 flex items-center gap-4">
          {selectedProfile ? (
            <Link
              to="/p/$profileName"
              params={{ profileName: selectedProfile }}
              onClick={() => setSelectedFile(null)}
            >
              <img
                src="/logo.png"
                alt="Stemset"
                className="h-10 w-auto cursor-pointer"
              />
            </Link>
          ) : (
            <img src="/logo.png" alt="Stemset" className="h-10 w-auto" />
          )}
          <h1
            className="lowercase text-4xl font-bold tracking-tight m-0 hidden md:block"
            style={{ color: "#e8e8e8" }}
          >
            Stemset
          </h1>
        </div>
        <div className="flex-none ml-auto flex items-center gap-3">
          {profiles && (
            <ProfileSelector
              profiles={profiles}
              selectedProfile={selectedProfile}
              onSelectProfile={handleProfileChange}
              fileCountByProfile={fileCountByProfile}
            />
          )}
          <UserNav user={user} onLogout={onLogout} />
        </div>
      </header>

      <div className="main-content">
        <aside
          className={`sidebar flex gap-7 flex-col p-7 ${isOnRecordingRoute || isOnClipRoute || isOnSongRoute ? "hidden md:flex" : "flex"}`}
        >
          {selectedProfile && (
            <Upload
              profileName={selectedProfile}
              onUploadComplete={handleRefresh}
              onNavigateToRecording={handleNavigateToRecording}
            />
          )}

          <div className="file-list">
            <Tabs
              value={sidebarTab}
              onValueChange={setSidebarTab}
              className="w-full flex flex-col flex-1 min-h-0"
            >
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="recordings">Recordings</TabsTrigger>
                <TabsTrigger value="clips">Clips</TabsTrigger>
                <TabsTrigger value="songs">Songs</TabsTrigger>
              </TabsList>

              <TabsContent
                value="recordings"
                className="mt-0 flex-1 overflow-y-auto"
              >
                <RecordingsView
                  files={sortedFiles}
                  isLoading={filesLoading}
                  error={filesError}
                  selectedFileName={selectedFile?.name || null}
                  onFileSelect={handleFileSelect}
                  onRefresh={handleRefresh}
                  getRelativeTime={getRelativeTime}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSortCycle={cycleSort}
                />
              </TabsContent>

              <TabsContent
                value="clips"
                className="mt-0 flex-1 overflow-y-auto"
              >
                {selectedProfile && (
                  <ClipsView
                    profileName={selectedProfile}
                    onRefresh={handleRefresh}
                  />
                )}
              </TabsContent>

              <TabsContent
                value="songs"
                className="mt-0 flex-1 overflow-y-auto"
              >
                {selectedProfile && (
                  <SongsView
                    profileName={selectedProfile}
                    onRefresh={handleRefresh}
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* VCR player container for desktop (fixed/sticky to sidebar) */}
          <div id="sidebar-vcr-container" className="sidebar-vcr-container" />
        </aside>

        <main
          className={`player-area ${isOnRecordingRoute || isOnClipRoute || isOnSongRoute ? "block" : "md:block hidden"}`}
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
                        clip.data.display_name ||
                        clipRecordingData.display_name,
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
              {clipRecordingData &&
                selectedProfile &&
                profiles &&
                profiles.find((p) => p.name === selectedProfile)?.id && (
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
                        setSelectedFile(updatedRecording);
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
                {/* Clips List */}
                {/* {clips?.data && clips.data.length > 0 && (
									<ClipsList
										clips={clips.data}
										profileName={selectedProfile}
										recordingId={selectedFile.id}
									/>
								)} */}
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
          ) : (
            <div className="empty-state">
              <p>Select a recording to start playing</p>
            </div>
          )}
        </main>
      </div>

      {/* QR Upload Overlay - shown when accessed via QR code */}
      {sourceParam === "qr" && selectedFile && selectedProfile && (
        <QRUploadOverlay
          profileName={selectedProfile}
          recordingName={selectedFile.name}
          onUploadComplete={handleRefresh}
          onNavigateToRecording={handleNavigateToRecording}
        />
      )}
    </div>
  );
}
