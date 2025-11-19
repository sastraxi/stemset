import { useState } from "react";
import type { RecordingWithStems } from "@/api/generated";
import { getRelativeTime } from "@/lib/utils";
import type { SortField } from "@/hooks/useSortPreference";
import { ClipsView } from "@/components/views/ClipsView";
import { RecordingsView } from "@/components/views/RecordingsView";
import { SongsView } from "@/components/views/SongsView";
import { DriveView } from "@/components/views/DriveView";
import { Upload } from "@/components/upload/Upload";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SidebarProps {
  selectedProfile: string | null;
  googleDriveFolderId?: string | null;
  initialClip?: string;
  initialSong?: string;
  onNavigateToRecording: (profileName: string, fileName: string) => void;
  selectedFileName: string | null;
  onFileSelect: (file: RecordingWithStems | null) => void;
  isOnDetailView: boolean;
  files: RecordingWithStems[];
  filesLoading: boolean;
  filesError: Error | null;
  refetchFiles: () => void;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  cycleSort: () => void;
}

export function Sidebar({
  selectedProfile,
  googleDriveFolderId,
  initialClip,
  initialSong,
  onNavigateToRecording,
  selectedFileName,
  onFileSelect,
  isOnDetailView,
  files,
  filesLoading,
  filesError,
  refetchFiles,
  sortField,
  sortDirection,
  cycleSort,
}: SidebarProps) {
  const [sidebarTab, setSidebarTab] = useState<string>(() => {
    if (initialSong) return "songs";
    if (initialClip) return "clips";
    return "recordings";
  });

  return (
    <aside
      className={`sidebar flex gap-7 flex-col p-7 ${isOnDetailView ? "hidden md:flex" : "flex"}`}
    >
      {selectedProfile && (
        <Upload
          profileName={selectedProfile}
          onUploadComplete={refetchFiles}
          onNavigateToRecording={onNavigateToRecording}
        />
      )}

      <div className="file-list">
        <Tabs
          value={sidebarTab}
          onValueChange={setSidebarTab}
          className="w-full flex flex-col flex-1 min-h-0"
        >
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="recordings">Recordings</TabsTrigger>
            <TabsTrigger value="clips">Clips</TabsTrigger>
            <TabsTrigger value="songs">Songs</TabsTrigger>
            <TabsTrigger value="drive">Drive</TabsTrigger>
          </TabsList>

          <TabsContent
            value="recordings"
            className="mt-0 flex-1 overflow-y-auto"
          >
            <RecordingsView
              files={files}
              isLoading={filesLoading}
              error={filesError}
              selectedFileName={selectedFileName}
              onFileSelect={onFileSelect}
              onRefresh={refetchFiles}
              getRelativeTime={getRelativeTime}
              sortField={sortField}
              sortDirection={sortDirection}
              onSortCycle={cycleSort}
            />
          </TabsContent>

          <TabsContent value="clips" className="mt-0 flex-1 overflow-y-auto">
            {selectedProfile && (
              <ClipsView
                profileName={selectedProfile}
                onRefresh={refetchFiles}
              />
            )}
          </TabsContent>

          <TabsContent value="songs" className="mt-0 flex-1 overflow-y-auto">
            {selectedProfile && (
              <SongsView
                profileName={selectedProfile}
                onRefresh={refetchFiles}
              />
            )}
          </TabsContent>

          <TabsContent value="drive" className="mt-0 flex-1 overflow-y-auto">
            {selectedProfile && (
              <DriveView
                profileName={selectedProfile}
                googleDriveFolderId={googleDriveFolderId}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* VCR player container for desktop (fixed/sticky to sidebar) */}
      <div id="sidebar-vcr-container" className="sidebar-vcr-container" />
    </aside>
  );
}