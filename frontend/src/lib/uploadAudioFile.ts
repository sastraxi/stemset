import { toast } from "sonner";
import { getToken } from "@/lib/storage";

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || "";

export interface UploadResponse {
  profile_name: string;
  output_name: string;
  filename: string;
}

/**
 * Upload an audio file (from file picker or recorded blob) to the backend.
 *
 * This function handles:
 * - File validation (size, extension)
 * - FormData creation
 * - Authentication headers
 * - Progress toasts
 * - Error handling
 *
 * @param file - File or Blob to upload
 * @param filename - Filename to use (for Blob uploads)
 * @param profileName - Profile to upload to
 * @returns Upload response with output_name for navigation
 */
export async function uploadAudioFile(
  file: File | Blob,
  filename: string,
  profileName: string,
): Promise<UploadResponse> {
  // Validate file size (150MB max)
  const MAX_SIZE = 150 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 150MB`,
    );
  }

  // Validate file extension (if it's a File with a name)
  const allowedExtensions = [
    ".wav",
    ".flac",
    ".mp3",
    ".m4a",
    ".aac",
    ".opus",
    ".ogg",
    ".wave",
    ".webm",
  ];

  const fileExt = filename
    .substring(filename.lastIndexOf("."))
    .toLowerCase();

  if (!allowedExtensions.includes(fileExt)) {
    throw new Error(
      `Unsupported file type: ${fileExt}. Allowed: ${allowedExtensions.join(", ")}`,
    );
  }

  // Show uploading toast
  const toastId = toast.loading(`Uploading ${filename}...`);

  try {
    // Create form data
    const formData = new FormData();
    // If it's a Blob, convert to File with proper name
    const fileToUpload = file instanceof File ? file : new File([file], filename, { type: file.type });
    formData.append("data", fileToUpload);

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

    // Dismiss upload toast (transient only)
    toast.success(`Upload complete: ${filename}`, {
      id: toastId,
      duration: 3000,
    });

    return result;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Upload failed", {
      id: toastId,
    });
    throw err;
  }
}
