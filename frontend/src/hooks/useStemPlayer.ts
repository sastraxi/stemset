import { useCallback, useEffect, useMemo, useRef } from "react";
import type { StemResponse } from "../api/generated/types.gen";
import type {
	EffectsChainConfig,
	StemCompressionLevel,
	StemUserConfig,
	StemViewModel,
} from "../types";
import { useAudioContext } from "./useAudioContext";
import { useAudioEffects } from "./useAudioEffects";
import type { LoadingMetrics } from "./useAudioLoader";
import { useAudioLoader } from "./useAudioLoader";
import { useConfigPersistence } from "./useConfigPersistence";
import { usePlaybackController } from "./usePlaybackController";
import { useStemAudioNodes } from "./useStemAudioNodes";

/**
 * Orchestrator hook for multi-stem audio player.
 */
export interface UseStemPlayerOptions {
	profileName: string;
	fileName: string;
	stemsData: StemResponse[];
	sampleRate?: number;
	recordingId: string;
}

export interface UseStemPlayerResult {
	// Loading state
	isLoading: boolean;
	loadingMetrics: LoadingMetrics | null;

	// Playback state
	isPlaying: boolean;
	currentTime: number;
	duration: number;

	// Stem view models (merged metadata + user config)
	stems: Record<string, StemViewModel>;
	stemOrder: string[]; // For consistent ordering

	// Playback controls
	play: () => void;
	pause: () => void;
	stop: () => void;
	seek: (seconds: number) => void;
	formatTime: (seconds: number) => string;

	// Stem controls
	setStemGain: (stemName: string, gain: number) => void;
	resetStemGain: (stemName: string) => void;
	toggleMute: (stemName: string) => void;
	toggleSolo: (stemName: string) => void;
	cycleStemCompression: (stemName: string) => void;

	// Master volume
	masterVolume: number;
	setMasterVolume: (volume: number) => void;

	// Effects
	effectsConfig: EffectsChainConfig;
	updateEqBand: (
		id: string,
		changes: Partial<{
			gain: number;
			frequency: number;
			q: number;
			type: BiquadFilterType;
		}>,
	) => void;
	setEqEnabled: (enabled: boolean) => void;
	resetEq: () => void;
	updateCompressor: (
		changes: Partial<EffectsChainConfig["compressor"]>,
	) => void;
	setCompressorEnabled: (enabled: boolean) => void;
	resetCompressor: () => void;
	updateReverb: (changes: Partial<EffectsChainConfig["reverb"]>) => void;
	setReverbEnabled: (enabled: boolean) => void;
	resetReverb: () => void;
	updateStereoExpander: (
		changes: Partial<EffectsChainConfig["stereoExpander"]>,
	) => void;
	setStereoExpanderEnabled: (enabled: boolean) => void;
	resetStereoExpander: () => void;
	compressorGainReduction: number;
	audioContext: AudioContext | null;
}

export function useStemPlayer({
	profileName,
	fileName,
	stemsData,
	sampleRate = 44100,
	recordingId,
}: UseStemPlayerOptions): UseStemPlayerResult {
	// 1. Audio context and master gain
	const {
		getContext,
		getMasterInput,
		getMasterOutput,
		masterVolume,
		setMasterVolume,
	} = useAudioContext({ sampleRate });
	const audioContext = getContext();
	const masterInput = getMasterInput();
	const masterOutput = getMasterOutput();

	// 2. Persist stem configs (volume, mute, solo) and playback position independently
	const { config: stemConfigs, setConfig: setStemConfigs } =
		useConfigPersistence<Record<string, StemUserConfig>>({
			recordingId,
			configKey: "stems",
			defaultValue: {},
			debounceMs: 500,
		});

	const {
		config: playbackPositionConfig,
		setConfig: setPlaybackPositionConfig,
	} = useConfigPersistence<{ position: number }>({
		recordingId,
		configKey: "playbackPosition",
		defaultValue: { position: 0 },
		debounceMs: 1000, // Longer debounce for playback position
	});

	// 3. Load audio buffers
	const {
		isLoading,
		loadingMetrics,
		stems: loadedStems,
		duration,
	} = useAudioLoader({
		profileName,
		fileName,
		stemsData,
		audioContext,
	});

	// 4. Create audio nodes
	const { stemNodes } = useStemAudioNodes({
		audioContext,
		masterInput,
		stems: loadedStems,
	});

	// 5. Stem view models (derived from nodes and persisted config)
	const stemOrder = useMemo(() => {
		if (stemNodes.size === 0) return [];
		const order = Array.from(stemNodes.keys());
		order.sort((a, b) => a.localeCompare(b));
		return order;
	}, [stemNodes]);

	const stems: Record<string, StemViewModel> = useMemo(() => {
		const newStems: Record<string, StemViewModel> = {};
		stemNodes.forEach((node, name) => {
			const savedStem = stemConfigs[name];
			const loadedStem = loadedStems.get(name);
			const metadata = loadedStem?.metadata;

			newStems[name] = {
				name,
				stemType: metadata?.stem_type || "unknown",
				waveformUrl: metadata?.waveform_url || "",
				initialGain: node.initialGain,
				gain: savedStem?.gain ?? node.initialGain,
				muted: savedStem?.muted ?? false,
				soloed: savedStem?.soloed ?? false,
				compression: savedStem?.compression ?? "off",
			};
		});
		return newStems;
	}, [stemNodes, loadedStems, stemConfigs]);

	// 6. Apply stem state to audio nodes (reactive!)
	useEffect(() => {
		if (stemNodes.size === 0 || Object.keys(stems).length === 0) return;

		const hasSolo = Object.values(stems).some((s) => s.soloed);

		stemNodes.forEach((node, name) => {
			const state = stems[name];
			if (!state) return;

			// Apply gain
			node.gainNode.gain.value = state.gain;

			// Apply compression settings
			const compressor = node.compressorNode;
			switch (state.compression) {
				case "off":
					compressor.threshold.value = 0;
					compressor.knee.value = 0;
					compressor.ratio.value = 1;
					compressor.attack.value = 0;
					compressor.release.value = 0;
					break;
				case "low":
					compressor.threshold.value = -24;
					compressor.knee.value = 30;
					compressor.ratio.value = 3;
					compressor.attack.value = 0.003;
					compressor.release.value = 0.25;
					break;
				case "medium":
					compressor.threshold.value = -18;
					compressor.knee.value = 20;
					compressor.ratio.value = 6;
					compressor.attack.value = 0.003;
					compressor.release.value = 0.15;
					break;
				case "high":
					compressor.threshold.value = -12;
					compressor.knee.value = 10;
					compressor.ratio.value = 12;
					compressor.attack.value = 0.001;
					compressor.release.value = 0.1;
					break;
			}

			// Apply audibility (mute/solo logic)
			let audible = true;
			if (hasSolo) {
				audible = state.soloed;
			} else {
				audible = !state.muted;
			}
			node.outputGainNode.gain.value = audible ? 1 : 0;
		});
	}, [stems, stemNodes]);

	// 7. Audio effects (each effect persists its own config independently)
	const { eq, compressor, reverb, stereoExpander } = useAudioEffects({
		audioContext,
		masterInput,
		masterOutput,
		recordingId,
	});

	// 8. Playback control (use saved position or 0 if none)
	const { isPlaying, currentTime, play, pause, stop, seek, formatTime } =
		usePlaybackController({
			audioContext,
			duration,
			stemNodes,
			initialPosition: playbackPositionConfig.position,
		});

	const playbackPositionInitializedRef = useRef(false);
	// Mark playback position as initialized after first render to avoid saving initial state
	useEffect(() => {
		// Wait one tick to ensure currentTime has been updated from initialPosition
		const timer = setTimeout(() => {
			playbackPositionInitializedRef.current = true;
		}, 100);
		return () => clearTimeout(timer);
	}, []);

	// Persist playback position when playback stops or pauses (not during continuous playback)
	useEffect(() => {
		if (!playbackPositionInitializedRef.current) return; // Don't save until initialized
		if (isPlaying) return; // Don't save while playing (too many updates)

		// Save when paused/stopped or when user seeks while paused
		setPlaybackPositionConfig({ position: currentTime });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isPlaying, currentTime]); // Intentionally omit setPlaybackPositionConfig to avoid infinite loop

	// Validate and correct playback position once duration is loaded
	useEffect(() => {
		if ((duration > 0 && currentTime > duration) || currentTime < 0) {
			// If current position is beyond song length, reset to beginning
			stop();
		}
	}, [duration, currentTime, stop]);

	// Stem control actions
	const setStemGain = useCallback(
		(stemName: string, gain: number) => {
			const newGain = Math.max(0, Math.min(gain, 2));
			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], gain: newGain },
			});
		},
		[stemConfigs, setStemConfigs],
	);

	const resetStemGain = useCallback(
		(stemName: string) => {
			setStemConfigs({
				...stemConfigs,
				[stemName]: {
					...stemConfigs[stemName],
					gain: stems[stemName]?.initialGain ?? 1,
				},
			});
		},
		[stemConfigs, setStemConfigs, stems],
	);

	const toggleMute = useCallback(
		(stemName: string) => {
			const currentMuted = stems[stemName]?.muted ?? false;
			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], muted: !currentMuted },
			});
		},
		[stemConfigs, setStemConfigs, stems],
	);

	const toggleSolo = useCallback(
		(stemName: string) => {
			const currentSoloed = stems[stemName]?.soloed ?? false;
			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], soloed: !currentSoloed },
			});
		},
		[stemConfigs, setStemConfigs, stems],
	);

	const cycleStemCompression = useCallback(
		(stemName: string) => {
			const currentCompression: StemCompressionLevel =
				stems[stemName]?.compression ?? "off";
			const compressionLevels: StemCompressionLevel[] = [
				"off",
				"low",
				"medium",
				"high",
			];
			const currentIndex = compressionLevels.indexOf(currentCompression);
			const nextIndex = (currentIndex + 1) % compressionLevels.length;
			const nextCompression = compressionLevels[nextIndex];

			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], compression: nextCompression },
			});
		},
		[stemConfigs, setStemConfigs, stems],
	);

	return {
		// Loading
		isLoading,
		loadingMetrics,

		// Playback
		isPlaying,
		currentTime,
		duration,

		// Stems
		stems,
		stemOrder,

		// Playback controls
		play,
		pause,
		stop,
		seek,
		formatTime,

		// Stem controls
		setStemGain,
		resetStemGain,
		toggleMute,
		toggleSolo,
		cycleStemCompression,

		// Master volume
		masterVolume,
		setMasterVolume,

		// Effects
		effectsConfig: {
			eq: eq.config,
			compressor: compressor.config,
			reverb: reverb.config,
			stereoExpander: stereoExpander.config,
		},
		updateEqBand: eq.updateBand,
		setEqEnabled: eq.setEnabled,
		resetEq: eq.reset,
		updateCompressor: compressor.update,
		setCompressorEnabled: compressor.setEnabled,
		resetCompressor: compressor.reset,
		updateReverb: reverb.update,
		setReverbEnabled: reverb.setEnabled,
		resetReverb: reverb.reset,
		updateStereoExpander: stereoExpander.update,
		setStereoExpanderEnabled: stereoExpander.setEnabled,
		resetStereoExpander: stereoExpander.reset,
		compressorGainReduction: compressor.gainReduction,
		audioContext,
	};
}
