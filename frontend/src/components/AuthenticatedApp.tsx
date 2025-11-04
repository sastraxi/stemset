import { Link, useNavigate } from "@tanstack/react-router";
import { Music, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProfileFiles, useProfiles, useRecording } from "../hooks/queries";
import { setSessionProfile, setSessionRecording } from "../lib/storage";
import { cn, getRelativeTime } from "../lib/utils";
import "../styles/effects.css";
import "../styles/layout.css";
import "../styles/player.css";
import "../styles/sidebar.css";
import "../styles/splash.css";
import "../styles/waveform.css";
import type { FileWithStems } from "@/api/generated";
import { apiRecordingsRecordingIdDeleteRecordingEndpoint } from "@/api/generated";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import { MetadataEditorModal } from "./MetadataEditorModal";
import { MetadataPage } from "./MetadataPage";
import { ProfileSelector } from "./ProfileSelector";
import { QRCodeModal } from "./QRCodeModal";
import { QRUploadOverlay } from "./QRUploadOverlay";
import { SongMetadata } from "./SongMetadata";
import { Spinner } from "./Spinner";
import { StemPlayer, type StemPlayerHandle } from "./StemPlayer";
import { Upload } from "./Upload";
import { UserNav } from "./UserNav";
import { Button } from "./ui/button";

interface AuthenticatedAppProps {
	user: { id: string; name: string; email: string; picture?: string };
	onLogout: () => void;
	initialProfile?: string;
	initialRecording?: string;
	sourceParam?: string;
	initialStateParam?: string;
}

export function AuthenticatedApp({
	user,
	onLogout,
	initialProfile,
	initialRecording,
	sourceParam,
	initialStateParam,
}: AuthenticatedAppProps) {
	const [selectedProfile, setSelectedProfile] = useState<string | null>(
		initialProfile || null,
	);
	const [selectedFile, setSelectedFile] = useState<FileWithStems | null>(null);
	const [isLoadingStems, setIsLoadingStems] = useState(false);
	const [wasInitiallyProcessing, setWasInitiallyProcessing] = useState(false);
	const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);
	const [isQRModalOpen, setIsQRModalOpen] = useState(false);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [audioDuration, setAudioDuration] = useState<number>(0);
	const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
	const stemPlayerRef = useRef<StemPlayerHandle>(null);
	const navigate = useNavigate();

	// Check if we're on the recording route
	const isOnRecordingRoute = !!initialRecording;

	const { data: profiles, error: profilesError } = useProfiles();

	const {
		data: files,
		isLoading: filesLoading,
		error: filesError,
		refetch: refetchFiles,
	} = useProfileFiles(selectedProfile || undefined);

	// Fetch the full recording data (with config) when we have a selected file
	// This primes the React Query cache for useConfigPersistence
	useRecording(selectedFile?.id);

	// Set selected profile based on initial or first available
	useEffect(() => {
		if (profiles && !selectedProfile) {
			// Validate initialProfile exists
			const validInitialProfile =
				initialProfile && profiles.some((p) => p.name === initialProfile);
			if (validInitialProfile) {
				setSelectedProfile(initialProfile);
			} else if (profiles.length > 0) {
				setSelectedProfile(profiles[0].name);
				console.log(
					"[AuthenticatedApp] Using fallback profile:",
					profiles[0].name,
				);
			}
		}
	}, [profiles, selectedProfile, initialProfile]);

	// Set selected file based on initial recording
	useEffect(() => {
		if (files && initialRecording && selectedProfile === initialProfile) {
			const targetFile = files.find((f) => f.name === initialRecording);
			if (targetFile && selectedFile?.name !== targetFile.name) {
				setSelectedFile(targetFile);
				// Track if this recording was initially processing
				if (initialStateParam === "processing") {
					setWasInitiallyProcessing(true);
				}
				setTimeout(() => stemPlayerRef.current?.focus(), 100);
			} else if (!targetFile && initialRecording) {
				// Initial recording doesn't exist - clear selection
				setSelectedFile(null);
			}
		}
	}, [
		files,
		initialRecording,
		selectedProfile,
		initialProfile,
		initialStateParam,
	]);

	// Persist selected profile to localStorage
	useEffect(() => {
		if (selectedProfile) {
			setSessionProfile(selectedProfile);
		}
	}, [selectedProfile]);

	// Persist selected recording to localStorage
	useEffect(() => {
		if (selectedFile && selectedProfile) {
			setSessionRecording(selectedProfile, selectedFile.name);
		}
	}, [selectedFile, selectedProfile]);

	const handleNavigateToRecording = async (
		profileName: string,
		fileName: string,
	) => {
		// Switch to the profile if needed
		if (selectedProfile !== profileName) {
			setSelectedProfile(profileName);
		}

		console.log("Navigating to recording:", profileName, fileName);

		// Refresh the file list to ensure the new recording appears
		await refetchFiles();

		// Navigate to the recording URL with initialState=processing query param
		navigate({
			to: "/p/$profileName/$recordingName",
			params: { profileName, recordingName: fileName },
			search: { initialState: "processing" },
		});
	};

	const handleProfileChange = (profileName: string) => {
		setSelectedProfile(profileName);
		setSelectedFile(null); // Clear selected file when changing profiles
		navigate({ to: "/p/$profileName", params: { profileName } });
	};

	const handleFileSelect = (file: FileWithStems) => {
		setSelectedFile(file);
		if (selectedProfile) {
			console.log("handleFileSelect:", file);
			navigate({
				to: "/p/$profileName/$recordingName",
				params: {
					profileName: selectedProfile,
					recordingName: file.name,
				},
			});
		}
		setTimeout(() => stemPlayerRef.current?.focus(), 100);
	};

	const handleRefresh = async () => {
		try {
			await refetchFiles();
		} catch (error) {
			console.error("Error refreshing files:", error);
			toast.error("Error refreshing file list");
		}
	};

	const handleDeleteRecording = async () => {
		if (!selectedFile || !selectedProfile) return;

		try {
			setIsDeleting(true);

			await apiRecordingsRecordingIdDeleteRecordingEndpoint({
				path: {
					recording_id: selectedFile.id,
				},
			});

			toast.success("Recording deleted successfully");
			setIsDeleteModalOpen(false);

			// Navigate back to profile page
			navigate({
				to: "/p/$profileName",
				params: { profileName: selectedProfile },
			});
		} catch (error) {
			console.error("Failed to delete recording:", error);
			toast.error("Failed to delete recording");
		} finally {
			setIsDeleting(false);
		}
	};

	// Show backend connection error
	if (profilesError) {
		return (
			<div className="splash-screen">
				<div className="splash-content">
					<h1>Stemset</h1>
					<p className="splash-subtitle">Backend not running</p>
					<div className="splash-instructions">
						<p>Please start the backend server:</p>
						<pre>
							<code>python -m src.main</code>
						</pre>
						<p className="splash-hint">
							The frontend will automatically connect when the backend is ready.
						</p>
					</div>
				</div>
			</div>
		);
	}

	// Sort files by date_recorded descending, with nulls at top
	const sortedFiles = useMemo(() => {
		if (!files) return [];
		return [...files].sort((a, b) => {
			// Nulls first
			if (!a.date_recorded && !b.date_recorded) return 0;
			if (!a.date_recorded) return -1;
			if (!b.date_recorded) return 1;
			// Descending (most recent first)
			return (
				new Date(b.date_recorded).getTime() -
				new Date(a.date_recorded).getTime()
			);
		});
	}, [files]);

	// Calculate file counts for profile selector
	const fileCountByProfile: Record<string, number> = {};
	if (profiles) {
		profiles.forEach((profile) => {
			// This is a simplified version - in a real app you might want to cache these counts
			fileCountByProfile[profile.name] = 0; // We'll update this as needed
		});
	}
	if (selectedProfile && files) {
		fileCountByProfile[selectedProfile] = files.length;
	}

	return (
		<div className="app">
			<header className="px-3 py-2 flex justify-between items-center md:px-6 md:py-4">
				<div className="flex-1 flex items-center gap-4">
					{selectedProfile ? (
						<Link
							to="/p/$profileName"
							params={{ profileName: selectedProfile }}
							onClick={() => setSelectedFile(null)}
						>
							<img
								src="/logo.png"
								alt="Stemset"
								className="h-10 w-auto cursor-pointer"
							/>
						</Link>
					) : (
						<img src="/logo.png" alt="Stemset" className="h-10 w-auto" />
					)}
					<h1
						className="lowercase text-4xl font-bold tracking-tight m-0 hidden md:block"
						style={{ color: "#e8e8e8" }}
					>
						Stemset
					</h1>
				</div>
				<div className="flex-none ml-auto flex items-center gap-3">
					{profiles && (
						<ProfileSelector
							profiles={profiles}
							selectedProfile={selectedProfile}
							onSelectProfile={handleProfileChange}
							fileCountByProfile={fileCountByProfile}
						/>
					)}
					<UserNav user={user} onLogout={onLogout} />
				</div>
			</header>

			<div className="main-content">
				<aside
					className={`sidebar flex gap-7 flex-col p-7 ${isOnRecordingRoute ? "hidden md:flex" : "flex"}`}
				>
					{selectedProfile && (
						<Upload
							profileName={selectedProfile}
							onUploadComplete={handleRefresh}
							onNavigateToRecording={handleNavigateToRecording}
						/>
					)}

					<div className="file-list">
						<div className="flex items-center justify-between mb-3">
							<h2 className="text-base font-semibold text-white uppercase tracking-wider">
								Recordings
							</h2>
							<Button
								onClick={handleRefresh}
								disabled={!selectedProfile}
								variant="ghost"
								size="icon"
								className="h-8 w-8 p-0 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400"
								title="Refresh file list"
							>
								<RefreshCw className="h-4 w-4" />
							</Button>
						</div>

						{filesLoading ? (
							<div className="flex items-center justify-center py-8">
								<Spinner size="md" />
							</div>
						) : filesError ? (
							<p className="empty-state">
								Error loading files. Try refreshing.
							</p>
						) : !sortedFiles || sortedFiles.length === 0 ? (
							<p className="empty-state">
								No processed files yet. Upload a file above or use the CLI.
							</p>
						) : (
							<ul className="list-none">
								{sortedFiles.map((file) => {
									const relativeTime = getRelativeTime(file.date_recorded);
									return (
										// biome-ignore lint/a11y/useKeyWithClickEvents: FIXME
										<li
											key={file.name}
											className={cn("recording-list-item", {
												"recording-list-item-selected":
													selectedFile?.name === file.name,
											})}
											onClick={() => handleFileSelect(file)}
										>
											<span
												className={`truncate ${selectedFile?.name === file.name ? "font-medium" : ""}`}
											>
												{file.display_name || file.name}
											</span>
											<div className="flex items-center gap-2 flex-shrink-0">
												{relativeTime && (
													<span className="recording-time">{relativeTime}</span>
												)}
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</aside>

				<main
					className={`player-area ${isOnRecordingRoute ? "block" : "md:block hidden"}`}
				>
					{selectedFile && selectedProfile ? (
						selectedFile.status === "processing" ||
						selectedFile.status === "error" ||
						(wasInitiallyProcessing && selectedFile.status === "complete") ? (
							<MetadataPage
								recording={selectedFile}
								profileId={
									profiles?.find((p) => p.name === selectedProfile)?.id || ""
								}
								wasInitiallyProcessing={wasInitiallyProcessing}
								onContinue={() => {
									setWasInitiallyProcessing(false);
									// Clear the initialState query param to show the player
									navigate({
										to: "/p/$profileName/$recordingName",
										params: {
											profileName: selectedProfile,
											recordingName: selectedFile.name,
										},
										search: {},
									});
								}}
							/>
						) : (
							<>
								<div className="recording-header">
									{!isLoadingStems && (
										<SongMetadata
											recording={selectedFile}
											onEdit={() => setIsMetadataEditorOpen(true)}
											onShowQR={() => setIsQRModalOpen(true)}
											onDelete={() => setIsDeleteModalOpen(true)}
											duration={audioDuration}
										/>
									)}
									<div
										id="playback-controls-container"
										className="playback-controls-header"
									>
										{/* Playback controls will be rendered here by StemPlayer */}
									</div>
								</div>
								{selectedFile && selectedProfile && (
									<>
										<MetadataEditorModal
											recording={selectedFile}
											profileId={
												profiles?.find((p) => p.name === selectedProfile)?.id ||
												""
											}
											profileName={selectedProfile}
											open={isMetadataEditorOpen}
											onClose={() => setIsMetadataEditorOpen(false)}
											onUpdate={(updatedRecording) => {
												setSelectedFile(updatedRecording);
											}}
										/>
										<QRCodeModal
											isOpen={isQRModalOpen}
											onClose={() => setIsQRModalOpen(false)}
											url={encodeURI(
												`${import.meta.env.VITE_FRONTEND_URL || window.location.origin}/p/${selectedProfile}/${selectedFile.name}`,
											)}
											currentTime={audioCurrentTime}
										/>
										<DeleteConfirmationModal
											isOpen={isDeleteModalOpen}
											onClose={() => setIsDeleteModalOpen(false)}
											onConfirm={handleDeleteRecording}
											recordingTitle={selectedFile.display_name}
											isDeleting={isDeleting}
										/>
									</>
								)}
								<StemPlayer
									key={`${selectedProfile}::${selectedFile.name}`}
									ref={stemPlayerRef}
									profileName={selectedProfile}
									fileName={selectedFile.name}
									stemsData={selectedFile.stems}
									onLoadingChange={setIsLoadingStems}
									onDurationChange={setAudioDuration}
									onCurrentTimeChange={setAudioCurrentTime}
									recordingId={selectedFile.id}
								/>
							</>
						)
					) : (
						<div className="empty-state">
							<p>Select a recording to start playing</p>
						</div>
					)}
				</main>
			</div>

			{/* QR Upload Overlay - shown when accessed via QR code */}
			{sourceParam === "qr" && selectedFile && selectedProfile && (
				<QRUploadOverlay
					profileName={selectedProfile}
					recordingName={selectedFile.name}
					onUploadComplete={handleRefresh}
					onNavigateToRecording={handleNavigateToRecording}
				/>
			)}
		</div>
	);
}
