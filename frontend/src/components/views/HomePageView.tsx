import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RecordingsView } from "@/components/views/RecordingsView";
import { ClipsView } from "@/components/views/ClipsView";
import { SongsView } from "@/components/views/SongsView";
import { DriveView } from "@/components/views/DriveView";
import type { RecordingWithStems } from "@/api/generated";
import type { SortField, SortDirection } from "@/hooks/useSortPreference";
import { getRelativeTime } from "@/lib/utils";
import "@/styles/home-page.css";

// Google Drive SVG Icon
const GoogleDriveIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 87.3 78"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
      fill="#0066da"
    />
    <path
      d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
      fill="#00ac47"
    />
    <path
      d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
      fill="#ea4335"
    />
    <path
      d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
      fill="#00832d"
    />
    <path
      d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
      fill="#2684fc"
    />
    <path
      d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
      fill="#ffba00"
    />
  </svg>
);

interface HomePageViewProps {
  profileName: string;
  googleDriveFolderId?: string | null;
  files: RecordingWithStems[];
  filesLoading: boolean;
  filesError: Error | null;
  refetchFiles: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  cycleSort: () => void;
  selectedFileName: string | null;
  onFileSelect: (file: RecordingWithStems | null) => void;
}

export function HomePageView({
  profileName,
  googleDriveFolderId,
  files,
  filesLoading,
  filesError,
  refetchFiles,
  sortField,
  sortDirection,
  cycleSort,
  selectedFileName,
  onFileSelect,
}: HomePageViewProps) {
  const [activeTab, setActiveTab] = useState<string>("recordings");

  // Generate Google Drive folder URL
  const driveFolderUrl = googleDriveFolderId
    ? `https://drive.google.com/drive/folders/${googleDriveFolderId}`
    : null;

  return (
    <div className="home-page">
      <div className="home-page-content">
        {/* Header with profile name and optional Drive icon */}
        <div className="home-page-header">
          <h1 className="home-page-title">{profileName}</h1>
          {driveFolderUrl && (
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="home-page-drive-button"
              title="View in Google Drive"
            >
              <a href={driveFolderUrl} target="_blank" rel="noopener noreferrer">
                <GoogleDriveIcon />
              </a>
            </Button>
          )}
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="home-page-tabs"
        >
          <TabsList className="inline-flex mb-6">
            <TabsTrigger value="recordings">Recordings</TabsTrigger>
            <TabsTrigger value="clips">Clips</TabsTrigger>
            <TabsTrigger value="songs">Songs</TabsTrigger>
            <TabsTrigger value="drive">Drive</TabsTrigger>
          </TabsList>

          <TabsContent value="recordings" className="home-page-tab-content">
            <RecordingsView
              layout="grid"
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

          <TabsContent value="clips" className="home-page-tab-content">
            <ClipsView
              layout="grid"
              profileName={profileName}
              onRefresh={refetchFiles}
            />
          </TabsContent>

          <TabsContent value="songs" className="home-page-tab-content">
            <SongsView
              layout="grid"
              profileName={profileName}
              onRefresh={refetchFiles}
            />
          </TabsContent>

          <TabsContent value="drive" className="home-page-tab-content">
            <DriveView
              layout="grid"
              profileName={profileName}
              googleDriveFolderId={googleDriveFolderId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
