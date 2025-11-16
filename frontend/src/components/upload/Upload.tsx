import { Upload as UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getToken } from "@/lib/storage";
import "./Upload.css";

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || "";

interface UploadProps {
  profileName: string;
  onUploadComplete: () => void;
  onNavigateToRecording?: (profileName: string, fileName: string) => void;
}

export function Upload({
  profileName,
  onUploadComplete,
  onNavigateToRecording,
}: UploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleFile = useCallback(
    async (file: File) => {
      // Validate file size (150MB max)
      const MAX_SIZE = 150 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        toast.error(
          `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 150MB`,
        );
        return;
      }

      // Validate file extension
      const allowedExtensions = [
        ".wav",
        ".flac",
        ".mp3",
        ".m4a",
        ".aac",
        ".opus",
        ".ogg",
        ".wave",
      ];
      const fileExt = file.name
        .substring(file.name.lastIndexOf("."))
        .toLowerCase();
      if (!allowedExtensions.includes(fileExt)) {
        toast.error(
          `Unsupported file type: ${fileExt}. Allowed: ${allowedExtensions.join(", ")}`,
        );
        return;
      }

      // Show uploading toast
      const toastId = toast.loading(`Uploading ${file.name}...`);

      try {
        // Create form data
        const formData = new FormData();
        formData.append("data", file);

        // Get auth token
        const token = getToken();
        const headers: HeadersInit = {};
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        // Upload file (returns immediately)
        const response = await fetch(
          `${API_BASE}/api/upload/${encodeURIComponent(profileName)}`,
          {
            method: "POST",
            body: formData,
            headers,
            credentials: "include",
          },
        );

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ detail: "Upload failed" }));

          // Provide user-friendly error messages
          let errorMessage =
            errorData.detail || `Upload failed: ${response.statusText}`;
          if (response.status === 401) {
            errorMessage = "Authentication failed. Please log in again.";
          }

          throw new Error(errorMessage);
        }

        const result = await response.json();
        const { profile_name, output_name, filename } = result;

        // Dismiss upload toast (transient only)
        toast.success(`Upload complete: ${filename}`, {
          id: toastId,
          duration: 3000,
        });

        // Navigate to recording with initialState=processing query param
        if (onNavigateToRecording) {
          onNavigateToRecording(profile_name, output_name);
        }

        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed", {
          id: toastId,
        });
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

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.flac,.mp3,.m4a,.aac,.opus,.ogg,.wave"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* Simple upload button in sidebar */}
      {/** biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
      {/** biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
      <div className="upload-sidebar-button" onClick={handleClick}>
        <UploadIcon className="h-6 w-6" />
        <span>Recording</span>
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
    </>
  );
}
