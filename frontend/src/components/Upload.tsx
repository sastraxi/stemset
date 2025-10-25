import { useState, useRef } from 'react';
import './Upload.css';

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || '';

interface UploadProps {
  profileName: string;
  onUploadComplete: () => void;
}

export function Upload({ profileName, onUploadComplete }: UploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

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
      setError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 150MB`);
      return;
    }

    // Validate file extension
    const allowedExtensions = ['.wav', '.flac', '.mp3', '.m4a', '.aac', '.opus', '.ogg', '.wave'];
    const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      setError(`Unsupported file type: ${fileExt}. Allowed: ${allowedExtensions.join(', ')}`);
      return;
    }

    setError(null);
    setIsUploading(true);
    setUploadProgress(0);

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

      // Poll for completion
      await pollJobStatus(jobId);

      // Success!
      setIsUploading(false);
      setUploadProgress(100);
      onUploadComplete();

      // Reset after a moment
      setTimeout(() => {
        setUploadProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setIsUploading(false);
      setUploadProgress(0);
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

      // Update progress (simulate based on time elapsed)
      const progress = Math.min(90, (attempts / maxAttempts) * 100);
      setUploadProgress(progress);

      attempts++;
    }

    throw new Error('Processing timeout');
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="upload-container">
      <div
        className={`upload-drop-zone ${isDragging ? 'dragging' : ''} ${isUploading ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.flac,.mp3,.m4a,.aac,.opus,.ogg"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {isUploading ? (
          <div className="upload-progress">
            <div className="spinner"></div>
            <p>Processing... {uploadProgress.toFixed(0)}%</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        ) : (
          <div className="upload-prompt">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -4 24 26" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <div>
              <p><strong>Drop</strong> to add new audio</p>
              <p className="upload-hint">WAV, FLAC, MP3, M4A, AAC, Opus, OGG</p>
              <p className="upload-hint">Max size: 150MB</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="upload-error">
          {error}
        </div>
      )}
    </div>
  );
}
