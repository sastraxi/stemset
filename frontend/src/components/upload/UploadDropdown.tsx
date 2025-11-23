import { Mic, Upload as UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecordingModal } from "./RecordingModal";
import { uploadAudioFile } from "@/lib/uploadAudioFile";
import "./Upload.css";

export interface UploadDropdownProps {
  profileName: string;
  onUploadComplete: () => void;
  onNavigateToRecording?: (profileName: string, fileName: string) => void;
}

/**
 * Split button dropdown for uploading files or recording audio.
 *
 * Primary action: Upload file (opens file picker)
 * Dropdown action: Record audio (opens recording modal)
 *
 * Features:
 * - File upload via click or drag-and-drop
 * - Audio recording via microphone
 * - Full-screen drag overlay
 * - Reuses upload logic from uploadAudioFile utility
 */
export function UploadDropdown({
  profileName,
  onUploadComplete,
  onNavigateToRecording,
}: UploadDropdownProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await uploadAudioFile(file, file.name, profileName);
        const { profile_name, output_name } = result;

        // Navigate to recording with initialState=processing query param
        if (onNavigateToRecording) {
          onNavigateToRecording(profile_name, output_name);
        }

        // Trigger refresh callback
        onUploadComplete();

        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (err) {
        // Error is already handled and toasted in uploadAudioFile
        console.error("Upload failed:", err);
      }
    },
    [profileName, onNavigateToRecording, onUploadComplete],
  );

  // Full-screen drag handlers with proper enter/leave tracking
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await handleFile(files[0]);
      }
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleFile]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRecordClick = () => {
    setIsRecordingModalOpen(true);
  };

  const handleRecordingUpload = async (audioBlob: Blob, filename: string) => {
    const result = await uploadAudioFile(audioBlob, filename, profileName);
    const { profile_name, output_name } = result;

    // Navigate to recording
    if (onNavigateToRecording) {
      onNavigateToRecording(profile_name, output_name);
    }

    // Trigger refresh
    onUploadComplete();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.flac,.mp3,.m4a,.aac,.opus,.ogg,.wave,.webm"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* Split button with microphone icon */}
      <div className="upload-sidebar-button upload-split-button">
        {/* Main button - Upload file */}
        {/** biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
        {/** biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
        <div className="upload-main-action" onClick={handleUploadClick}>
          <UploadIcon className="h-6 w-6" />
          <span>Recording</span>
        </div>

        {/* Record button */}
        {/** biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
        {/** biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
        <div className="upload-dropdown-trigger" onClick={handleRecordClick}>
          <button type="button">
            <Mic className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Full-screen drop overlay */}
      {isDragging && (
        <div className="upload-fullscreen-overlay">
          <div className="upload-fullscreen-content">
            <UploadIcon className="upload-icon" />
            <p className="upload-message">Drop to upload to {profileName}</p>
            <p className="upload-hint">Any audio file • Max 150MB</p>
          </div>
        </div>
      )}

      {/* Recording Modal */}
      <RecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        profileName={profileName}
        onUpload={handleRecordingUpload}
      />
    </>
  );
}
