import { useState, useEffect } from "react";
import { ChevronRight, FolderOpen, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDriveFolderContents, useUpdateDriveFolder } from "@/hooks/queries";
import {
  getDriveFolderHistory,
  setDriveFolderHistory,
  DriveFolderHistory,
} from "@/lib/storage";
import { DriveFileItem } from "./DriveFileItem";
import { DriveImportModal } from "./DriveImportModal";
import { DriveConnector } from "./DriveConnector";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/utils";
import type { DriveFileInfo } from "@/api/generated/types.gen";

interface DriveNavigatorProps {
  profileName: string;
  rootFolderId: string | null | undefined;
  mode: "column" | "full";
}

export function DriveNavigator({
  profileName,
  rootFolderId,
  mode,
}: DriveNavigatorProps) {
  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    rootFolderId ?? undefined,
  );
  const [breadcrumbs, setBreadcrumbs] = useState<DriveFolderHistory[]>([]);
  const [selectedFile, setSelectedFile] = useState<DriveFileInfo | null>(null);

  // Fetch current folder contents
  const { data, isLoading, error, refetch } = useDriveFolderContents(
    profileName,
    currentFolderId,
  );

  // Mutation for updating Drive folder
  const updateDriveFolderMutation = useUpdateDriveFolder();

  // Load navigation history from storage on mount
  useEffect(() => {
    const history = getDriveFolderHistory(profileName);
    if (history.length > 0) {
      setBreadcrumbs(history);
      setCurrentFolderId(history[history.length - 1].folderId);
    }
  }, [profileName]);

  // Persist navigation history to storage
  useEffect(() => {
    if (breadcrumbs.length > 0) {
      setDriveFolderHistory(profileName, breadcrumbs);
    }
  }, [breadcrumbs, profileName]);

  // Navigate into folder
  const handleNavigateFolder = (folderId: string, folderName: string) => {
    setBreadcrumbs([...breadcrumbs, { folderId, folderName }]);
    setCurrentFolderId(folderId);
  };

  // Navigate back to folder in breadcrumb trail
  const handleNavigateToBreadcrumb = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(newBreadcrumbs[index].folderId);
  };

  // Navigate to root
  const handleNavigateRoot = () => {
    setBreadcrumbs([]);
    setCurrentFolderId(rootFolderId ?? undefined);
  };

  // Handle import request
  const handleRequestImport = (file: DriveFileInfo) => {
    setSelectedFile(file);
  };

  // Handle connecting Drive folder
  const handleConnectFolder = async (folderId: string) => {
    await updateDriveFolderMutation.mutateAsync({
      path: { profile_name: profileName },
      body: { google_drive_folder_id: folderId },
    });
    // After successful update, refetch will happen automatically via query invalidation
    setCurrentFolderId(folderId);
    setBreadcrumbs([]);
  };

  // Render no folder configured state FIRST (before trying to fetch)
  if (!rootFolderId) {
    return <DriveConnector onConnect={handleConnectFolder} />;
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="Unable to load Drive files"
        description="Please ensure you've granted Google Drive access and try again."
        action={{ label: "Retry", onClick: () => refetch() }}
      />
    );
  }

  const files = data?.files || [];

  return (
    <div className={cn("flex flex-col h-full", mode === "column" && "gap-2")}>
      {/* Header: Breadcrumbs + Refresh */}
      <div className="flex items-center gap-2 pb-2 border-b">
        {/* Breadcrumbs */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNavigateRoot}
            className="h-8 px-2"
          >
            <Home className="h-4 w-4" />
          </Button>

          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-1 flex-shrink-0">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleNavigateToBreadcrumb(index)}
                className="h-8 px-2 text-sm"
              >
                {crumb.folderName}
              </Button>
            </div>
          ))}
        </div>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="h-8 px-2 flex-shrink-0"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* File List */}
      <div
        className={cn("flex-1 overflow-y-auto", mode === "column" && "space-y-2")}
      >
        {files.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No files or folders"
            description="This folder is empty or contains no audio files."
          />
        ) : (
          <div
            className={cn(
              mode === "column" ? "space-y-2" : "grid grid-cols-2 gap-3",
            )}
          >
            {files.map((file: DriveFileInfo) => (
              <DriveFileItem
                key={file.id}
                file={file}
                mode={mode}
                onNavigateFolder={handleNavigateFolder}
                onRequestImport={handleRequestImport}
              />
            ))}
          </div>
        )}
      </div>

      {/* Import Modal */}
      <DriveImportModal
        file={selectedFile}
        profileName={profileName}
        onClose={() => setSelectedFile(null)}
      />
    </div>
  );
}
