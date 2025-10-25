import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Upload as UploadIcon } from 'lucide-react';
import './Upload.css';

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || '';

interface UploadProps {
  profileName: string;
  onUploadComplete: () => void;
}

export function Upload({ profileName, onUploadComplete }: UploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [profileName]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = async (file: File) => {
    // Validate file size (150MB max)
    const MAX_SIZE = 150 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast.error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 150MB`);
      return;
    }

    // Validate file extension
    const allowedExtensions = ['.wav', '.flac', '.mp3', '.m4a', '.aac', '.opus', '.ogg', '.wave'];
    const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      toast.error(`Unsupported file type: ${fileExt}. Allowed: ${allowedExtensions.join(', ')}`);
      return;
    }

    // Show processing toast
    const toastId = toast.loading(`Uploading ${file.name}...`);

    try {
      // Create form data
      const formData = new FormData();
      formData.append('data', file);

      // Upload file
      const response = await fetch(`${API_BASE}/api/upload/${encodeURIComponent(profileName)}`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(errorData.detail || `Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      const jobId = result.job_id;

      // Update toast to show processing
      toast.loading(`Processing ${file.name}...`, { id: toastId });

      // Poll for completion
      await pollJobStatus(jobId);

      // Success!
      toast.success(`${file.name} processed successfully!`, { id: toastId });
      onUploadComplete();

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed', { id: toastId });
    }
  };

  const pollJobStatus = async (jobId: string): Promise<void> => {
    const maxAttempts = 300; // 10 minutes max (2 second intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await fetch(`${API_BASE}/api/jobs/${jobId}/status`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to check job status');
      }

      const status = await response.json();

      if (status.status === 'complete') {
        return; // Done!
      } else if (status.status === 'error') {
        throw new Error(status.error || 'Processing failed');
      }

      attempts++;
    }

    throw new Error('Processing timeout');
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.flac,.mp3,.m4a,.aac,.opus,.ogg"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* Simple upload button in sidebar */}
      <div className="upload-sidebar-button" onClick={handleClick}>
        <UploadIcon className="h-4 w-4" />
        <span>Upload Audio</span>
      </div>

      {/* Full-screen drop overlay */}
      {isDragging && (
        <div className="upload-fullscreen-overlay">
          <div className="upload-fullscreen-content">
            <UploadIcon className="upload-icon" />
            <p className="upload-message">Drop to upload to {profileName}</p>
            <p className="upload-hint">WAV, FLAC, MP3, M4A, AAC, Opus, OGG • Max 150MB</p>
          </div>
        </div>
      )}
    </>
  );
}
