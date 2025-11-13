import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { apiRecordingsRecordingIdClipsGetRecordingClips, apiClipsClipIdGetClipEndpoint, apiSongsSongIdClipsGetSongClips } from "@/api/generated";
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
import { Spinner } from "./ui/spinner";
import { RecordingPlayer } from "./RecordingPlayer";
import { ClipPlayer } from "./ClipPlayer";
import type { StemPlayerHandle } from "./StemPlayer";
import { Upload } from "./Upload";
import { ClipsList } from "./ClipsList";
import { UserNav } from "./UserNav";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { RecordingsView } from "./RecordingsView";
import { ClipsView } from "./ClipsView";
import { SongsView } from "./SongsView";
import { ClipCard } from "./ClipCard";
import { Music2 } from "lucide-react";

interface AuthenticatedAppProps {
	user: { id: string; name: string; email: string; picture?: string };
	onLogout: () => void;
	initialProfile?: string;
	initialRecording?: string;
	initialClip?: string;
	initialSong?: string;
	sourceParam?: string;
	initialStateParam?: string;
	timeParam?: number;
}

export function AuthenticatedApp({
	user,
	onLogout,
	initialProfile,
	initialRecording,
	initialClip,
	initialSong,
	sourceParam,
	initialStateParam,
	timeParam,
}: AuthenticatedAppProps) {
	useEffect(() => {
		const handleResize = () => {
			console.log("Window resized, new width:", window.innerWidth);
		};
		window.addEventListener("resize", handleResize);
		return () => {
			window.removeEventListener("resize", handleResize);
		};
	}, []);

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
	const [createClipHandler, setCreateClipHandler] = useState<(() => void) | null>(null);
	const [hasClipSelection, setHasClipSelection] = useState(false);
	const stemPlayerRef = useRef<StemPlayerHandle>(null);
	const navigate = useNavigate();

	// Check if we're on a detail view route (recording, clip, or song)
	const isOnRecordingRoute = !!initialRecording;
	const isOnClipRoute = !!initialClip;
	const isOnSongRoute = !!initialSong;

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

	// Fetch clips for the selected recording
	const { data: clips } = useQuery({
		queryKey: ["recording-clips", selectedFile?.id],
		queryFn: () =>
			apiRecordingsRecordingIdClipsGetRecordingClips({
				path: { recording_id: selectedFile!.id },
			}),
		enabled: !!selectedFile?.id,
	});

	// Fetch clip data when on clip route
	const { data: clip, isLoading: clipLoading } = useQuery({
		queryKey: ["clip", initialClip],
		queryFn: () =>
			apiClipsClipIdGetClipEndpoint({
				path: { clip_id: initialClip! },
			}),
		enabled: !!initialClip,
	});

	// Fetch song clips when on song route
	const { data: songClips, isLoading: songLoading } = useQuery({
		queryKey: ["song-clips", initialSong],
		queryFn: () =>
			apiSongsSongIdClipsGetSongClips({
				path: { song_id: initialSong! },
			}),
		enabled: !!initialSong,
	});

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
					className={`sidebar flex gap-7 flex-col p-7 ${isOnRecordingRoute || isOnClipRoute || isOnSongRoute ? "hidden md:flex" : "flex"}`}
				>
					{selectedProfile && (
						<Upload
							profileName={selectedProfile}
							onUploadComplete={handleRefresh}
							onNavigateToRecording={handleNavigateToRecording}
						/>
					)}

					<div className="file-list">
						<Tabs defaultValue="recordings" className="w-full">
							<TabsList className="grid w-full grid-cols-3 mb-4">
								<TabsTrigger value="recordings">Recordings</TabsTrigger>
								<TabsTrigger value="clips">Clips</TabsTrigger>
								<TabsTrigger value="songs">Songs</TabsTrigger>
							</TabsList>

							<TabsContent value="recordings" className="mt-0">
								<RecordingsView
									files={sortedFiles}
									isLoading={filesLoading}
									error={filesError}
									selectedFileName={selectedFile?.name || null}
									onFileSelect={handleFileSelect}
									onRefresh={handleRefresh}
									getRelativeTime={getRelativeTime}
								/>
							</TabsContent>

							<TabsContent value="clips" className="mt-0">
								{selectedProfile && (
									<ClipsView
										profileName={selectedProfile}
										onRefresh={handleRefresh}
									/>
								)}
							</TabsContent>

							<TabsContent value="songs" className="mt-0">
								{selectedProfile && (
									<SongsView
										profileName={selectedProfile}
										onRefresh={handleRefresh}
									/>
								)}
							</TabsContent>
						</Tabs>
					</div>

					{/* VCR player container for desktop (fixed/sticky to sidebar) */}
					<div id="sidebar-vcr-container" className="sidebar-vcr-container" />
				</aside>

				<main
					className={`player-area ${isOnRecordingRoute || isOnClipRoute || isOnSongRoute ? "block" : "md:block hidden"}`}
				>
					{isOnSongRoute && songClips?.data ? (
						<div className="container mx-auto p-6">
							{/* Song header */}
							<div className="mb-6">
								<div className="flex items-center gap-3 mb-2">
									<Music2 className="h-6 w-6 text-primary" />
									<h1 className="text-3xl font-bold">
										{songClips.data[0]?.song?.name || "Untitled Song"}
									</h1>
								</div>
								<p className="text-muted-foreground">
									{songClips.data.length}{" "}
									{songClips.data.length === 1 ? "clip" : "clips"} across recordings
								</p>
							</div>

							{/* Clips list */}
							{songClips.data.length > 0 ? (
								<div className="space-y-3">
									{songClips.data.map((clip) => (
										<ClipCard
											key={clip.id}
											clip={clip}
											profileName={selectedProfile!}
											showRecordingInfo={true}
										/>
									))}
								</div>
							) : (
								<div className="text-center py-12 text-muted-foreground">
									No clips found for this song.
								</div>
							)}
						</div>
					) : isOnClipRoute && clip?.data ? (
						<>
							<div className="recording-header">
								{!clipLoading && (
									<SongMetadata
										recording={{
											id: clip.data.recording_id,
											name: clip.data.recording_output_name,
											display_name: clip.data.display_name || clip.data.recording_output_name,
											date_recorded: null,
											status: "complete",
											stems: clip.data.stems,
											song: clip.data.song || null,
											location: clip.data.location || null,
										}}
										profileName={selectedProfile!}
										onEdit={() => {}}
										onShowQR={() => {}}
										onDelete={() => {}}
										duration={clip.data.end_time_sec - clip.data.start_time_sec}
									/>
								)}
								<div
									id="playback-controls-container"
									className="playback-controls-header"
								>
									{/* Playback controls will be rendered here by StemPlayer */}
								</div>
							</div>
							<ClipPlayer
								clipId={clip.data.id}
								recordingId={clip.data.recording_id}
								stemsData={clip.data.stems}
								startTimeSec={clip.data.start_time_sec}
								endTimeSec={clip.data.end_time_sec}
								profileName={selectedProfile!}
								fileName={clip.data.recording_output_name}
								onLoadingChange={setIsLoadingStems}
								onDurationChange={setAudioDuration}
								onCurrentTimeChange={setAudioCurrentTime}
							/>
						</>
					) : selectedFile && selectedProfile ? (
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
											profileName={selectedProfile}
											onEdit={() => setIsMetadataEditorOpen(true)}
											onShowQR={() => setIsQRModalOpen(true)}
											onDelete={() => setIsDeleteModalOpen(true)}
											onCreateClip={createClipHandler || undefined}
											hasSelection={hasClipSelection}
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
								{/* Clips List */}
								{clips?.data && clips.data.length > 0 && (
									<ClipsList
										clips={clips.data}
										profileName={selectedProfile}
										recordingId={selectedFile.id}
									/>
								)}
								<RecordingPlayer
									key={`${selectedProfile}::${selectedFile.name}`}
									ref={stemPlayerRef}
									profileName={selectedProfile}
									fileName={selectedFile.name}
									stemsData={selectedFile.stems}
									onLoadingChange={setIsLoadingStems}
									onDurationChange={setAudioDuration}
									onCurrentTimeChange={setAudioCurrentTime}
									onCreateClipChange={(handler, hasSelection) => {
										setCreateClipHandler(() => handler);
										setHasClipSelection(hasSelection);
									}}
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
