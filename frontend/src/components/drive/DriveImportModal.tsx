import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportDriveFile } from "@/hooks/queries";
import type { DriveFileInfo } from "@/api/generated/types.gen";

interface DriveImportModalProps {
  file: DriveFileInfo | null;
  profileName: string;
  onClose: () => void;
}

export function DriveImportModal({
  file,
  profileName,
  onClose,
}: DriveImportModalProps) {
  const [isImporting, setIsImporting] = useState(false);
  const importMutation = useImportDriveFile();
  const navigate = useNavigate();

  const handleImport = async () => {
    if (!file) return;

    setIsImporting(true);
    const loadingToast = toast.loading(`Importing ${file.name}...`);

    try {
      const response = await importMutation.mutateAsync({
        path: { profile_name: profileName },
        body: {
          file_id: file.id,
          file_name: file.name,
          file_size: file.size || 0,
          modified_time: file.modifiedTime,
          parent_id: file.parent_id || null,
        },
      });

      // Show success toast with navigation link
      const recordingName = response.output_name;
      toast.success(
        <div className="flex flex-col gap-2">
          <div>Import started! Processing...</div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigate({
                to: "/p/$profileName/$recordingName",
                params: { profileName: profileName, recordingName: recordingName },
              });
            }}
          >
            View Recording
          </Button>
        </div>,
        { id: loadingToast, duration: 5000 },
      );

      onClose();
    } catch (error) {
      toast.error("Import failed. Please try again.", { id: loadingToast });
      console.error("Import error:", error);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={() => !isImporting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from Google Drive</DialogTitle>
          <DialogDescription>
            This will download the file from your Drive and start processing.
          </DialogDescription>
        </DialogHeader>

        {file && (
          <div className="space-y-2 py-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">File:</span>
              <span className="font-medium">{file.name}</span>
            </div>
            {file.size && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Size:</span>
                <span>{formatFileSize(file.size)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Modified:</span>
              <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Import & Process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}
