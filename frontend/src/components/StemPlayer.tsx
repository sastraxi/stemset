import { Music, QrCode, Share, Trash2, Volume2, VolumeX } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { StemResponse } from "@/api/generated";
import { apiRecordingsRecordingIdDeleteRecordingEndpoint } from "@/api/generated";
import { useAudioSession } from "../hooks/useAudioSession";
import { useMediaSession } from "../hooks/useMediaSession";
import { useStemPlayer } from "../hooks/useStemPlayer";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import { CompressorPanel } from "./effects/CompressorPanel";
import { EqPanel } from "./effects/EqPanel";
import { MasterVolumeControl } from "./effects/MasterVolumeControl";
import { ReverbPanel } from "./effects/ReverbPanel";
import { MobileVolumeControl } from "./MobileVolumeControl";
import { QRCodeModal } from "./QRCodeModal";
import { Ruler } from "./Ruler";
import { Spinner } from "./Spinner";
import { WaveformVisualization } from "./WaveformVisualization";

interface StemPlayerProps {
	profileName: string;
	fileName: string;
	stemsData: StemResponse[];
	onLoadingChange?: (isLoading: boolean) => void;
	recordingId: string;
}

export interface StemPlayerHandle {
	focus: () => void;
}

/** Simplified StemPlayer using `useStemPlayer` hook.
 * Responsibilities:
 * - UI rendering & user interaction only.
 * - Delegates all audio graph & timing logic to hook.
 */
export const StemPlayer = forwardRef<StemPlayerHandle, StemPlayerProps>(
	({ profileName, fileName, stemsData, onLoadingChange, recordingId }, ref) => {
		const [previewTime, setPreviewTime] = useState<number | null>(null);
		const [showTimeRemaining, setShowTimeRemaining] = useState(false);
		const [showQRModal, setShowQRModal] = useState(false);
		const [showDeleteModal, setShowDeleteModal] = useState(false);
		const [isDeleting, setIsDeleting] = useState(false);
		const [volumeBeforeMute, setVolumeBeforeMute] = useState(0.8);
		const playerRef = useRef<HTMLDivElement>(null);

		useImperativeHandle(ref, () => ({
			focus: () => {
				playerRef.current?.focus();
			},
		}));

		// Generate shareable URL with current time (floored to nearest second)
		const generateShareUrl = useCallback(
			(time: number) => {
				const baseUrl =
					import.meta.env.VITE_FRONTEND_URL || window.location.origin;
				const currentPath = `/p/${profileName}/${fileName}`;
				const url = new URL(currentPath, baseUrl);
				url.searchParams.set("t", Math.floor(time).toString());
				return url.toString();
			},
			[profileName, fileName],
		);

		// Generate QR URL for social sharing (points to upload page with source=qr)
		const generateQRUrl = useCallback(() => {
			const baseUrl =
				import.meta.env.VITE_FRONTEND_URL || window.location.origin;
			const currentPath = `/p/${profileName}/${fileName}`;
			const url = new URL(currentPath, baseUrl);
			url.searchParams.set("source", "qr");
			return url.toString();
		}, [profileName, fileName]);

		// Handle recording deletion
		const handleDelete = useCallback(async () => {
			try {
				setIsDeleting(true);

				await apiRecordingsRecordingIdDeleteRecordingEndpoint({
					path: {
						recording_id: recordingId,
					},
				});

				toast.success("Recording deleted successfully");

				// Navigate back to profile page
				window.location.href = `/p/${profileName}`;
			} catch (error) {
				console.error("Error deleting recording:", error);
				toast.error("Failed to delete recording");
			} finally {
				setIsDeleting(false);
				setShowDeleteModal(false);
			}
		}, [recordingId, profileName]);
		const {
			isLoading,
			loadingMetrics,
			isPlaying,
			currentTime,
			duration,
			stems,
			stemOrder,
			play,
			pause,
			stop,
			seek,
			setStemGain,
			resetStemGain,
			toggleMute,
			toggleSolo,
			formatTime,
			masterVolume,
			setMasterVolume,
			effectsConfig,
			updateEqBand,
			setEqEnabled,
			resetEq,
			updateCompressor,
			resetCompressor,
			updateReverb,
			resetReverb,
			// updateStereoExpander,
			// resetStereoExpander,
			compressorGainReduction,
			audioContext,
		} = useStemPlayer({ profileName, fileName, stemsData, recordingId });

		const { initializeAudioSession } = useAudioSession(audioContext);

		const handlePlay = useCallback(() => {
			initializeAudioSession();
			play();
		}, [initializeAudioSession, play]);

		useMediaSession({
			title: fileName,
			artist: profileName,
			album: profileName,
			onPlay: handlePlay,
			onPause: pause,
			onNextTrack: () => {
				console.log("Next track not implemented");
			},
			onPreviousTrack: () => {
				console.log("Previous track not implemented");
			},
		});

		useEffect(() => {
			if ("mediaSession" in navigator) {
				navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
			}
		}, [isPlaying]);

		// Master volume mute toggle (like desktop MasterVolumeControl)
		const isMasterMuted = masterVolume === 0;
		const handleToggleMasterMute = useCallback(() => {
			if (isMasterMuted) {
				// Unmute: restore previous volume (or default to 0.7 if none saved)
				setMasterVolume(volumeBeforeMute > 0 ? volumeBeforeMute : 0.7);
			} else {
				// Mute: save current volume and set to 0
				setVolumeBeforeMute(masterVolume);
				setMasterVolume(0);
			}
		}, [isMasterMuted, masterVolume, volumeBeforeMute, setMasterVolume]);

		// Notify parent of loading state changes
		useEffect(() => {
			onLoadingChange?.(isLoading);
		}, [isLoading, onLoadingChange]);

		// Keyboard shortcuts
		useEffect(() => {
			const handleKeyDown = (e: KeyboardEvent) => {
				// Only handle if player is focused or target is the player/body
				const target = e.target as HTMLElement;
				if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
					return; // Don't interfere with input fields
				}

				switch (e.code) {
					case "Space":
					case "KeyK":
						e.preventDefault();
						if (isPlaying) {
							pause();
						} else {
							handlePlay();
						}
						break;
					case "Home":
					case "Digit0":
					case "Numpad0":
						e.preventDefault();
						stop();
						break;
				}
			};

			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}, [isPlaying, play, pause, stop]);

		// Dump profile info once after load completes
		const hasLoggedRef =
			// biome-ignore lint/suspicious/noExplicitAny: WIP
			(window as any).__stemPlayerLoggedRef ||
			// biome-ignore lint/suspicious/noAssignInExpressions: WIP
			// biome-ignore lint/suspicious/noExplicitAny: WIP
			((window as any).__stemPlayerLoggedRef = { current: new Set<string>() });

		const key = `${profileName}::${fileName}`;
		if (!isLoading && !hasLoggedRef.current.has(key)) {
			hasLoggedRef.current.add(key);
			// Assemble snapshot
			const stemArray = stemOrder.map((name) => stems[name]);
			const snapshot = {
				profileName,
				fileName,
				loadingMetrics,
				stemCount: stemOrder.length,
				stems: stemArray.map((s) => ({
					name: Object.keys(stems).find((k) => stems[k] === s),
					gain: s.gain,
					initialGain: s.initialGain,
				})),
				effects: effectsConfig,
				timestamp: new Date().toISOString(),
			};
			// Pretty print
			try {
				// eslint-disable-next-line no-console
				console.groupCollapsed(`StemPlayer Load Profile: ${key}`);
				console.info("Summary", {
					totalMs: loadingMetrics?.totalMs,
					stemCount: snapshot.stemCount,
				});
				if (loadingMetrics) {
					console.table(
						loadingMetrics.stems.map((t) => ({
							Stem: t.name,
							Fetch_ms: t.fetchMs.toFixed(1),
							Decode_ms: t.decodeMs.toFixed(1),
							Total_ms: t.totalMs.toFixed(1),
							KB: (t.bytes / 1024).toFixed(1),
						})),
					);
					console.info(
						"Metadata fetch ms",
						loadingMetrics.metadataMs.toFixed(1),
					);
					console.info("Overall ms", loadingMetrics.totalMs.toFixed(1));
				}
				console.info("Effects", effectsConfig);
				console.info("Stems", snapshot.stems);
				console.groupEnd();
			} catch (e) {
				// eslint-disable-next-line no-console
				console.log("StemPlayer snapshot", snapshot);
			}
		}

		if (isLoading) {
			return (
				<div className="stem-player loading">
					<Spinner size="lg" />
					<p style={{ marginTop: "1rem", color: "#888" }}>Loading stems...</p>
				</div>
			);
		}

		// Render playback controls in header
		const playbackControlsContainer = document.getElementById(
			"playback-controls-container",
		);
		const playbackControls = (
			<>
				<button
					type="button"
					onClick={() => setShowQRModal(true)}
					className="share-button"
					title="Show QR code for social sharing"
				>
					<QrCode className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={async () => {
						const shareUrl = generateShareUrl(currentTime);
						try {
							await navigator.clipboard.writeText(shareUrl);
							toast.success(
								`Share link (${formatTime(currentTime)}) copied to clipboard!`,
							);
						} catch (err) {
							console.error("Failed to copy to clipboard:", err);
							// Fallback - show the URL so user can copy manually
							toast.error("Could not copy to clipboard. Link: " + shareUrl);
						}
					}}
					className="share-button"
					title="Share at current time"
				>
					<Share className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={() => setShowDeleteModal(true)}
					className="share-button"
					title="Delete recording"
				>
					<Trash2 className="h-4 w-4" />
				</button>
				<MobileVolumeControl
					volume={masterVolume}
					onVolumeChange={setMasterVolume}
					isMuted={isMasterMuted}
					onToggleMute={handleToggleMasterMute}
					max={1}
				/>
				{/** biome-ignore lint/a11y/noStaticElementInteractions: WIP */}
				{/** biome-ignore lint/a11y/useKeyWithClickEvents: WIP */}
				<div
					className="time-display clickable"
					onClick={() => setShowTimeRemaining(!showTimeRemaining)}
					title="Click to toggle time remaining"
				>
					{showTimeRemaining
						? `-${formatTime(duration - (previewTime !== null ? previewTime : currentTime))} / ${formatTime(duration)}`
						: `${formatTime(previewTime !== null ? previewTime : currentTime)} / ${formatTime(duration)}`}
				</div>
				<button
					type="button"
					onClick={isPlaying ? pause : handlePlay}
					disabled={stemOrder.length === 0}
					className="playback-button"
					title={isPlaying ? "Pause" : "Play"}
				>
					{isPlaying ? "⏸" : "▶"}
				</button>
				<button
					type="button"
					onClick={stop}
					disabled={!isPlaying && currentTime === 0}
					className="playback-button stop-button"
					title="Reset"
				>
					⏹
				</button>
			</>
		);

		return (
			<>
				{playbackControlsContainer &&
					createPortal(playbackControls, playbackControlsContainer)}
				{/** biome-ignore lint/a11y/noNoninteractiveTabindex: Spacebar */}
				<div className="stem-player" ref={playerRef} tabIndex={0}>
					<div className="waveforms-section">
						{/* Ruler row - now just ruler without controls */}
						<div className="waveform-row">
							<div className="waveform-controls">
								{/* Empty controls area to maintain alignment */}
							</div>
							<Ruler
								currentTime={currentTime}
								duration={duration}
								previewTime={previewTime || undefined}
								onSeek={seek}
								onPreview={setPreviewTime}
								height={48}
							/>
						</div>

						{stemOrder.map((stemName, stemIndex) => {
							const stem = stems[stemName];
							return (
								<div key={stemName} className={"waveform-row"}>
									<div className="waveform-controls">
										<label
											htmlFor={`stem-${stemName}-gain`}
											className="waveform-stem-label"
										>
											{stemName}
										</label>
										<div className="waveform-volume-control">
											<input
												id={`stem-${stemName}-gain`}
												type="range"
												min={0}
												max={2}
												step={0.01}
												value={stem.gain}
												onChange={(e) =>
													setStemGain(stemName, parseFloat(e.target.value))
												}
												className="volume-slider"
												disabled={stem.muted}
											/>
											<span className="volume-label">
												{stem.muted
													? "Muted"
													: `${(stem.gain * 100).toFixed(0)}%`}
											</span>
										</div>
										<div className="waveform-control-buttons flex gap-1">
											<MobileVolumeControl
												volume={stem.gain}
												onVolumeChange={(volume) =>
													setStemGain(stemName, volume)
												}
												isMuted={stem.muted}
												onToggleMute={() => toggleMute(stemName)}
											/>
											<button
												type="button"
												onClick={() => toggleMute(stemName)}
												className={`mute-button ${stem.muted ? "muted" : ""}`}
												title={stem.muted ? "Unmute" : "Mute"}
											>
												{stem.muted ? (
													<VolumeX className="h-4 w-4" color="#ff6666" />
												) : (
													<Volume2 className="h-4 w-4" color="currentColor" />
												)}
											</button>
											<button
												type="button"
												onClick={() => toggleSolo(stemName)}
												className={`solo-button ${stem.soloed ? "soloed" : ""}`}
												title={stem.soloed ? "Unsolo" : "Solo"}
											>
												<Music
													className="h-4 w-4"
													color={stem.soloed ? "#ffb347" : "currentColor"}
												/>
											</button>
											<button
												type="button"
												onClick={() => resetStemGain(stemName)}
												className="reset-gain"
												title="Reset to initial gain"
											>
												↺
											</button>
										</div>
									</div>
									<WaveformVisualization
										waveformUrl={stem.waveformUrl}
										stemName={stemName}
										currentTime={currentTime}
										duration={duration}
										previewTime={previewTime || undefined}
										onSeek={seek}
										onPreview={setPreviewTime}
										waveformClasses={
											stemIndex === stemOrder.length - 1
												? "rounded-b-lg overflow-hidden"
												: ""
										}
									/>
								</div>
							);
						})}
					</div>
				</div>
				<div className="player-panel master-effects">
					<div className="master-effects-row">
						<MasterVolumeControl
							volume={masterVolume}
							onVolumeChange={setMasterVolume}
						/>
						<EqPanel
							config={effectsConfig.eq}
							onUpdateBand={updateEqBand}
							onSetEnabled={setEqEnabled}
							onReset={resetEq}
						/>
						{/* <StereoExpanderPanel
              config={effectsConfig.stereoExpander}
              onUpdate={updateStereoExpander}
              onReset={resetStereoExpander}
            /> */}
						<ReverbPanel
							config={effectsConfig.reverb}
							onUpdate={updateReverb}
							onReset={resetReverb}
						/>
						<CompressorPanel
							config={effectsConfig.compressor}
							gainReduction={compressorGainReduction}
							onUpdate={updateCompressor}
							onReset={resetCompressor}
						/>
					</div>
				</div>

				{/* QR Code Modal */}
				<QRCodeModal
					isOpen={showQRModal}
					onClose={() => setShowQRModal(false)}
					url={generateQRUrl()}
				/>

				{/* Delete Confirmation Modal */}
				<DeleteConfirmationModal
					isOpen={showDeleteModal}
					onClose={() => setShowDeleteModal(false)}
					onConfirm={handleDelete}
					isDeleting={isDeleting}
					recordingTitle={fileName}
				/>
			</>
		);
	},
);
