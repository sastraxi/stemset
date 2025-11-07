import { Music, Volume2, VolumeX } from "lucide-react";
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
import { useVuMeter } from "../hooks/useVuMeter";
import { CompressionIcon } from "./CompressionIcon";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import { EqIcon } from "./EqIcon";
import { CompressorPanel } from "./effects/CompressorPanel";
import { EqPanel } from "./effects/EqPanel";
import { MasterVolumeControl } from "./effects/MasterVolumeControl";
import { ParametricEqPanel } from "./effects/ParametricEqPanel";
import { ReverbPanel } from "./effects/ReverbPanel";
import { MobileVolumeControl } from "./MobileVolumeControl";
import { Ruler } from "./Ruler";
import { Spinner } from "./Spinner";
import { VCRDisplay } from "./VCRDisplay";
import { VolumeSlider } from "./VolumeSlider";
import { WaveformVisualization } from "./WaveformVisualization";
import "../styles/vcr-display.css";

/**
 * Convert linear volume (0-2) to dB.
 * - volume=0 → -∞ dB
 * - volume=1 → 0 dB (unity gain)
 * - volume=2 → +6.02 dB
 */
function volumeToDb(volume: number): string {
	if (volume === 0) return "-∞";
	const db = 20 * Math.log10(volume);
	return db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
}

interface StemPlayerProps {
	profileName: string;
	fileName: string;
	stemsData: StemResponse[];
	onLoadingChange?: (isLoading: boolean) => void;
	onDurationChange?: (duration: number) => void;
	onCurrentTimeChange?: (currentTime: number) => void;
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
	(
		{
			profileName,
			fileName,
			stemsData,
			onLoadingChange,
			onDurationChange,
			onCurrentTimeChange,
			recordingId,
		},
		ref,
	) => {
		const [previewTime, setPreviewTime] = useState<number | null>(null);
		const [showTimeRemaining, setShowTimeRemaining] = useState(false);
		const [showDeleteModal, setShowDeleteModal] = useState(false);
		const [isDeleting, setIsDeleting] = useState(false);
		const playerRef = useRef<HTMLDivElement>(null);

		useImperativeHandle(ref, () => ({
			focus: () => {
				playerRef.current?.focus();
			},
		}));

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
			cycleStemCompression,
			cycleStemEqLow,
			cycleStemEqMid,
			cycleStemEqHigh,
			formatTime,
			masterVolume,
			setMasterVolume,
			effectsConfig,
			updateParametricEqBand,
			setParametricEqEnabled,
			resetParametricEq,
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
			getMasterOutput,
		} = useStemPlayer({ profileName, fileName, stemsData, recordingId });

		const { initializeAudioSession } = useAudioSession(audioContext);

		// VU Meter for master output
		const vuMeterLevels = useVuMeter(
			audioContext ? getMasterOutput() : null,
			audioContext,
			isPlaying,
		);

		const handlePlay = useCallback(() => {
			initializeAudioSession();
			play();
			// Immediately update MediaSession state
			if ("mediaSession" in navigator) {
				navigator.mediaSession.playbackState = "playing";
			}
		}, [initializeAudioSession, play]);

		const handlePause = useCallback(() => {
			pause();
			// Immediately update MediaSession state
			if ("mediaSession" in navigator) {
				navigator.mediaSession.playbackState = "paused";
			}
		}, [pause]);

		const handleNextTrack = useCallback(() => {
			console.log("Next track not implemented");
		}, []);

		const handlePreviousTrack = useCallback(() => {
			console.log("Previous track not implemented");
		}, []);

		useMediaSession({
			title: fileName,
			artist: profileName,
			album: profileName,
			duration: duration,
			currentTime: currentTime,
			onPlay: handlePlay,
			onPause: handlePause,
			onSeek: seek,
			onNextTrack: handleNextTrack,
			onPreviousTrack: handlePreviousTrack,
		});

		// Remove the useEffect that updates playbackState - it's now handled in the callbacks

		// Notify parent of loading state changes
		useEffect(() => {
			onLoadingChange?.(isLoading);
		}, [isLoading, onLoadingChange]);

		// Notify parent of duration changes
		useEffect(() => {
			onDurationChange?.(duration);
		}, [duration, onDurationChange]);

		// Notify parent of current time changes
		useEffect(() => {
			onCurrentTimeChange?.(currentTime);
		}, [currentTime, onCurrentTimeChange]);

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

		const containerRef = useRef<HTMLDivElement>(null);

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

		// Render VCR display (before loading check so it shows immediately)
		// Mobile: Portal to header (fixed to bottom)
		// Desktop: Will be rendered in sidebar
		const playbackControlsContainer = document.getElementById(
			"playback-controls-container",
		);
		const sidebarVcrContainer = document.getElementById(
			"sidebar-vcr-container",
		);

		// Common VCR props
		const vcrProps = {
			currentTime,
			duration,
			formatTime,
			showTimeRemaining,
			onToggleTimeDisplay: () => setShowTimeRemaining(!showTimeRemaining),
			isPlaying,
			onPlay: handlePlay,
			onPause: handlePause,
			onStop: stop,
			disabled: stemOrder.length === 0 || isLoading,
			vuMeterLevels,
		};

		// Render VCR portals (always render, even during loading)
		const vcrPortals = (
			<>
				{/* Mobile: Portal to header (fixed to bottom) */}
				{playbackControlsContainer &&
					createPortal(
						<div className="block md:hidden">
							<VCRDisplay {...vcrProps} />
						</div>,
						playbackControlsContainer,
					)}
				{/* Desktop: Portal to sidebar */}
				{sidebarVcrContainer &&
					createPortal(
						<div className="hidden md:block">
							<VCRDisplay {...vcrProps} />
						</div>,
						sidebarVcrContainer,
					)}
			</>
		);

		if (isLoading) {
			return (
				<>
					{vcrPortals}
					<div className="stem-player loading">
						<Spinner size="lg" />
						<p style={{ marginTop: "1rem", color: "#888" }}>Loading stems...</p>
					</div>
				</>
			);
		}

		return (
			<>
				{vcrPortals}
				{/* Flex container for waveforms + effects to fill vertical space */}
				<div className="player-content-flex">
					{/** biome-ignore lint/a11y/noNoninteractiveTabindex: Spacebar */}
					<div
						className="stem-player"
						ref={playerRef}
						tabIndex={0}
						style={{ "--stem-count": stemOrder.length } as React.CSSProperties}
					>
						<div className="waveforms-section">
							{/* Ruler row */}
							<div className="waveform-row" ref={containerRef}>
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
												<VolumeSlider
													volume={stem.gain}
													onVolumeChange={(volume) =>
														setStemGain(stemName, volume)
													}
													size="small"
													isMuted={stem.muted}
													onDoubleClick={() => resetStemGain(stemName)}
													showUnityMarker={true}
												/>
												<span className="volume-label">
													{stem.muted ? "Muted" : `${volumeToDb(stem.gain)} dB`}
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
													onClick={() => cycleStemCompression(stemName)}
													className={`compression-button ${stem.compression}`}
													title={`Compression: ${stem.compression}`}
												>
													<CompressionIcon
														level={stem.compression}
														className="h-4 w-4"
													/>
												</button>
												<button
													type="button"
													onClick={() => cycleStemEqLow(stemName)}
													className={`eq-low-button ${stem.eqLow}`}
													title={`Low EQ: ${stem.eqLow}`}
												>
													<EqIcon
														band="low"
														level={stem.eqLow}
														className="h-4 w-4"
													/>
												</button>
												<button
													type="button"
													onClick={() => cycleStemEqMid(stemName)}
													className={`eq-mid-button ${stem.eqMid}`}
													title={`Mid EQ: ${stem.eqMid}`}
												>
													<EqIcon
														band="mid"
														level={stem.eqMid}
														className="h-4 w-4"
													/>
												</button>
												<button
													type="button"
													onClick={() => cycleStemEqHigh(stemName)}
													className={`eq-high-button ${stem.eqHigh}`}
													title={`High EQ: ${stem.eqHigh}`}
												>
													<EqIcon
														band="high"
														level={stem.eqHigh}
														className="h-4 w-4"
													/>
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
						<div className="master-effects-row tweed-purple tweed-subtle">
							<MasterVolumeControl
								volume={masterVolume}
								onVolumeChange={setMasterVolume}
							/>
							<ParametricEqPanel
								config={effectsConfig.parametricEq}
								onUpdate={updateParametricEqBand}
								onSetEnabled={setParametricEqEnabled}
								onReset={resetParametricEq}
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
				</div>

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
