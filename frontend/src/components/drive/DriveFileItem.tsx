import { ChevronRight, File, Folder, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DriveFileInfo } from "@/api/generated/types.gen";

interface DriveFileItemProps {
  file: DriveFileInfo;
  profileName?: string;
  onNavigateFolder?: (folderId: string, folderName: string) => void;
  onRequestImport?: (file: DriveFileInfo) => void;
  mode: "column" | "full";
}

export function DriveFileItem({
  file,
  profileName,
  onNavigateFolder,
  onRequestImport,
  mode,
}: DriveFileItemProps) {
  const isFolder = file.is_folder;
  const isImported = file.is_imported;

  const handleClick = () => {
    if (isFolder && onNavigateFolder) {
      onNavigateFolder(file.id, file.name);
    } else if (!isImported && onRequestImport) {
      onRequestImport(file);
    }
  };

  const content = (
    <div className="flex items-center gap-3">
      {/* Icon */}
      <div className="flex-shrink-0">
        {isFolder ? (
          <Folder className="h-5 w-5 text-blue-400" />
        ) : (
          <File className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      {/* File name */}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate text-sm">{file.name}</div>
        {mode === "full" && file.size && (
          <div className="text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </div>
        )}
      </div>

      {/* Import status / action */}
      {!isFolder && (
        <div className="flex-shrink-0">
          {isImported ? (
            <div className="flex items-center text-blue-400">
              <ChevronRight className="h-5 w-5" />
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={(e) => {
                e.stopPropagation();
                onRequestImport?.(file);
              }}
            >
              <Upload className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );

  // Wrap imported files in a Link
  if (isImported && profileName && file.recording_name) {
    return (
      <Link
        to="/p/$profileName/$recordingName"
        params={{ profileName, recordingName: file.recording_name }}
        className={cn(
          "block bg-background border rounded-lg p-3 transition-colors",
          "cursor-pointer hover:border-blue-400",
        )}
      >
        {content}
      </Link>
    );
  }

  // For folders and non-imported files, use a div
  return (
    <div
      className={cn(
        "block bg-background border rounded-lg p-3 transition-colors",
        isFolder && "cursor-pointer hover:border-blue-500",
        !isFolder && !isImported && "cursor-pointer hover:border-blue-400",
      )}
      onClick={isFolder || !isImported ? handleClick : undefined}
    >
      {content}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}
