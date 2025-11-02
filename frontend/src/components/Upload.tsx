import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Upload as UploadIcon } from "lucide-react";
import "./Upload.css";

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || "";

interface UploadProps {
	profileName: string;
	onUploadComplete: () => void;
	onNavigateToRecording?: (profileName: string, fileName: string) => void;
	shouldAutoNavigate?: () => boolean;
}

// Helper to poll recording status (used both in component and for resuming)
async function pollRecordingStatus(
	recordingId: string,
	toastId: string | number,
	profileName: string,
	outputName: string,
	filename: string,
	onComplete: () => void,
	onNavigate?: (profileName: string, fileName: string) => void,
	shouldAutoNavigate?: () => boolean,
): Promise<void> {
	while (true) {
		// Poll every 15 seconds
		await new Promise((resolve) => setTimeout(resolve, 15000));

		try {
			// Check recording status (simple polling, no long-poll)
			const response = await fetch(`${API_BASE}/api/recordings/${recordingId}`, {
				credentials: "include",
			});

			if (!response.ok) {
				throw new Error("Failed to check recording status");
			}

			const status = await response.json();

			if (status.status === "complete") {
				// Refresh file list first
				onComplete();

				// Show persistent toast with button to navigate
				toast.success(
					<div>
						<strong>{filename} ready!</strong>
						{onNavigate && (
							<button
								onClick={() => {
									onNavigate(profileName, outputName);
									toast.dismiss(toastId);
								}}
								style={{
									marginTop: "0.5rem",
									padding: "0.375rem 0.75rem",
									backgroundColor: "rgba(255, 255, 255, 0.2)",
									border: "1px solid rgba(255, 255, 255, 0.3)",
									borderRadius: "0.375rem",
									color: "white",
									fontSize: "0.875rem",
									fontWeight: 500,
									cursor: "pointer",
									width: "100%",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.backgroundColor =
										"rgba(255, 255, 255, 0.3)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor =
										"rgba(255, 255, 255, 0.2)";
								}}
							>
								Play Now
							</button>
						)}
					</div>,
					{ id: toastId, duration: Infinity },
				);
				break;
			} else if (status.status === "error") {
				toast.error(status.error || "Processing failed", { id: toastId });
				break;
			}
			// else: status === "processing", continue polling
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to check status",
				{ id: toastId },
			);
			break;
		}
	}
}

export function Upload({
	profileName,
	onUploadComplete,
	onNavigateToRecording,
	shouldAutoNavigate,
}: UploadProps) {
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

			// Upload file (returns immediately)
			const response = await fetch(
				`${API_BASE}/api/upload/${encodeURIComponent(profileName)}`,
				{
					method: "POST",
					body: formData,
					credentials: "include",
				},
			);

			if (!response.ok) {
				const errorData = await response
					.json()
					.catch(() => ({ detail: "Upload failed" }));
				throw new Error(
					errorData.detail || `Upload failed: ${response.statusText}`,
				);
			}

			const result = await response.json();
			const { recording_id, profile_name, output_name, filename } = result;

			// Update toast to show processing (persistent)
			toast.loading(`Processing ${filename}...`, {
				id: toastId,
				duration: Infinity,
			});

			// Start polling (every 15 seconds)
			pollRecordingStatus(
				recording_id,
				toastId,
				profile_name,
				output_name,
				filename,
				onUploadComplete,
				onNavigateToRecording,
				shouldAutoNavigate,
			);

			// Reset file input
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Upload failed", {
				id: toastId,
			});
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
				accept=".wav,.flac,.mp3,.m4a,.aac,.opus,.ogg"
				onChange={handleFileSelect}
				style={{ display: "none" }}
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
						<p className="upload-hint">
							WAV, FLAC, MP3, M4A, AAC, Opus, OGG • Max 150MB
						</p>
					</div>
				</div>
			)}
		</>
	);
}
