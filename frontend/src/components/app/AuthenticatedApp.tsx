import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useProfileFiles, useProfiles } from "@/hooks/queries";
import { useSortPreference } from "@/hooks/useSortPreference";
import { setSessionProfile, setSessionRecording } from "@/lib/storage";
import "@/styles/effects.css";
import "@/styles/layout.css";
import "@/styles/player.css";
import "@/styles/sidebar.css";
import "@/styles/splash.css";
import "@/styles/waveform.css";
import type { RecordingWithStems } from "@/api/generated";
import { Header } from "@/components/app/Header";
import { PlayerView } from "@/components/app/PlayerView";
import { Sidebar } from "@/components/app/Sidebar";
import { QRUploadOverlay } from "@/components/upload/QRUploadOverlay";

interface AuthenticatedAppProps {
  initialProfile?: string;
  initialRecording?: string;
  initialClip?: string;
  initialSong?: string;
  sourceParam?: string;
  initialStateParam?: string;
  timeParam?: number;
}

export function AuthenticatedApp({
  initialProfile,
  initialRecording,
  initialClip,
  initialSong,
  sourceParam,
  initialStateParam,
}: AuthenticatedAppProps) {
  const [selectedProfile, setSelectedProfile] = useState<string | null>(
    initialProfile || null,
  );
  const [selectedFile, setSelectedFile] = useState<RecordingWithStems | null>(
    null,
  );

  const navigate = useNavigate();
  const { data: profiles } = useProfiles();

  const {
    data: files,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useProfileFiles(selectedProfile || undefined);

  const { sortField, sortDirection, cycleSort, sortData } = useSortPreference({
    storageKey: "stemset-sort-recordings",
    defaultField: "date",
    defaultDirection: "desc",
  });

  const sortedFiles = useMemo(() => {
    if (!files) return [];
    return sortData<RecordingWithStems>(
      files,
      (file: RecordingWithStems) => file.date_recorded,
      (file: RecordingWithStems) => file.display_name || file.name,
    );
  }, [files, sortData]);

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
      } else if (!targetFile && initialRecording) {
        setSelectedFile(null);
      }
    }
  }, [files, initialRecording, selectedProfile, initialProfile, selectedFile]);

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

  const handleFileSelect = (file: RecordingWithStems | null) => {
    setSelectedFile(file);
    if (file && selectedProfile) {
      console.log("handleFileSelect:", file);
      navigate({
        to: "/p/$profileName/$recordingName",
        params: {
          profileName: selectedProfile,
          recordingName: file.name,
        },
      });
    }
  };

  return (
    <div className="app">
      <Header
        selectedProfile={selectedProfile}
        profiles={profiles}
        onProfileChange={handleProfileChange}
        onLogoClick={() => {
          setSelectedFile(null);
          if (selectedProfile) {
            navigate({
              to: "/p/$profileName",
              params: { profileName: selectedProfile },
            });
          }
        }}
      />

      <div className="main-content">
        <Sidebar
          selectedProfile={selectedProfile}
          googleDriveFolderId={
            profiles?.find((p) => p.name === selectedProfile)
              ?.google_drive_folder_id
          }
          initialClip={initialClip}
          initialSong={initialSong}
          onNavigateToRecording={handleNavigateToRecording}
          selectedFileName={selectedFile?.name || null}
          onFileSelect={handleFileSelect}
          isOnDetailView={!!initialRecording || !!initialClip || !!initialSong}
          files={sortedFiles}
          filesLoading={filesLoading}
          filesError={filesError}
          refetchFiles={refetchFiles}
          sortField={sortField}
          sortDirection={sortDirection}
          cycleSort={cycleSort}
        />

        <PlayerView
          selectedProfile={selectedProfile}
          selectedFile={selectedFile}
          initialClip={initialClip}
          initialSong={initialSong}
          initialStateParam={initialStateParam}
          onFileSelect={handleFileSelect}
        />
      </div>

      {/* QR Upload Overlay - shown when accessed via QR code */}
      {sourceParam === "qr" && selectedFile && selectedProfile && (
        <QRUploadOverlay
          profileName={selectedProfile}
          recordingName={selectedFile.name}
          onNavigateToRecording={handleNavigateToRecording}
        />
      )}
    </div>
  );
}
