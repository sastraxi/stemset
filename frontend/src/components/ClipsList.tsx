import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ClipResponse } from "../api/generated";
import {
  apiClipsClipIdDeleteClipEndpoint,
  apiClipsClipIdUpdateClipEndpoint,
  apiRecordingsRecordingIdClipsCreateClipEndpoint,
} from "../api/generated";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Pencil, Trash2, Copy, Clock } from "lucide-react";

interface ClipsListProps {
  clips: ClipResponse[];
  profileName: string;
  recordingId: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(startSec: number, endSec: number): string {
  const duration = endSec - startSec;
  return formatTime(duration);
}

export function ClipsList({ clips, profileName, recordingId }: ClipsListProps) {
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteClipId, setDeleteClipId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const handleStartEdit = (clip: ClipResponse) => {
    setEditingClipId(clip.id);
    setEditingName(clip.display_name || "");
  };

  const handleCancelEdit = () => {
    setEditingClipId(null);
    setEditingName("");
  };

  const handleSaveEdit = async (clipId: string) => {
    try {
      await apiClipsClipIdUpdateClipEndpoint({
        path: { clip_id: clipId },
        body: {
          display_name: editingName || null,
        },
      });

      await queryClient.invalidateQueries({
        queryKey: ["recording-clips", recordingId],
      });

      setEditingClipId(null);
      setEditingName("");
    } catch (error) {
      console.error("Failed to rename clip:", error);
    }
  };

  const handleDelete = async () => {
    if (!deleteClipId) return;

    setIsDeleting(true);
    try {
      await apiClipsClipIdDeleteClipEndpoint({
        path: { clip_id: deleteClipId },
      });

      await queryClient.invalidateQueries({
        queryKey: ["recording-clips", recordingId],
      });

      setDeleteClipId(null);
    } catch (error) {
      console.error("Failed to delete clip:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async (clip: ClipResponse) => {
    try {
      await apiRecordingsRecordingIdClipsCreateClipEndpoint({
        path: { recording_id: recordingId },
        body: {
          recording_id: recordingId,
          start_time_sec: clip.start_time_sec,
          end_time_sec: clip.end_time_sec,
          display_name: clip.display_name
            ? `${clip.display_name} (copy)`
            : null,
        },
      });

      await queryClient.invalidateQueries({
        queryKey: ["recording-clips", recordingId],
      });
    } catch (error) {
      console.error("Failed to duplicate clip:", error);
    }
  };

  if (clips.length === 0) {
    return null;
  }

  return (
    <div className="border-b bg-muted/30 p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Clips ({clips.length})
      </h3>

      <div className="space-y-2">
        {clips.map((clip) => (
          <div
            key={clip.id}
            className="group bg-background border rounded-md hover:border-primary/50 transition-colors"
          >
            {editingClipId === clip.id ? (
              // Edit mode
              <div className="p-3 space-y-2">
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  placeholder="Clip name"
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveEdit(clip.id);
                    } else if (e.key === "Escape") {
                      handleCancelEdit();
                    }
                  }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEdit}
                    className="flex-1 h-7 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSaveEdit(clip.id)}
                    className="flex-1 h-7 text-xs"
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              // View mode
              <div className="flex items-center">
                <Link
                  to="/p/$profileName/clips/$clipId"
                  params={{
                    profileName,
                    clipId: clip.id,
                  }}
                  className="flex-1 p-3 min-w-0"
                >
                  <div className="font-medium text-sm truncate">
                    {clip.display_name ||
                      `Clip ${formatTime(clip.start_time_sec)} - ${formatTime(clip.end_time_sec)}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatTime(clip.start_time_sec)} →{" "}
                    {formatTime(clip.end_time_sec)}
                    <span className="ml-2">
                      ({formatDuration(clip.start_time_sec, clip.end_time_sec)})
                    </span>
                  </div>
                </Link>

                {/* Action buttons - shown on hover */}
                <div className="flex items-center gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleStartEdit(clip)}
                    title="Rename clip"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleDuplicate(clip)}
                    title="Duplicate clip"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setDeleteClipId(clip.id)}
                    title="Delete clip"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteClipId !== null}
        onOpenChange={(open) => !open && setDeleteClipId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clip</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this clip? This action cannot be
              undone. The recording and stems will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
