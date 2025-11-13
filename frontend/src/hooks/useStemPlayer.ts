import { useCallback, useEffect, useMemo } from "react";
import type { StemResponse } from "../api/generated/types.gen";
import type {
	EffectsChainConfig,
	StemCompressionLevel,
	StemEqLevel,
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
	startTimeSec?: number; // Clip start time (optional)
	endTimeSec?: number; // Clip end time (optional)
	disablePositionPersistence?: boolean; // Don't persist playback position (for clips)
}

export interface UseStemPlayerResult {
	// Loading state
	isLoading: boolean;
	loadingMetrics: LoadingMetrics | null;

	// Playback state
	isPlaying: boolean;
	currentTime: number;
	duration: number; // Effective duration (clip duration for clips, full duration for recordings)
	fullDuration: number; // Always the full recording duration

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
	cycleStemEqLow: (stemName: string) => void;
	cycleStemEqMid: (stemName: string) => void;
	cycleStemEqHigh: (stemName: string) => void;

	// Master volume
	masterVolume: number;
	setMasterVolume: (volume: number) => void;

	// Effects
	effectsConfig: EffectsChainConfig;
	updateParametricEqBand: (
		band: "lowBand" | "midBand" | "highBand",
		changes: Partial<EffectsChainConfig["parametricEq"]["lowBand"]>,
	) => void;
	setParametricEqEnabled: (enabled: boolean) => void;
	resetParametricEq: () => void;
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
	updateSoftClipper: (changes: Partial<EffectsChainConfig["softClipper"]>) => void;
	setSoftClipperEnabled: (enabled: boolean) => void;
	resetSoftClipper: () => void;
	updateStereoExpander: (
		changes: Partial<EffectsChainConfig["stereoExpander"]>,
	) => void;
	setStereoExpanderEnabled: (enabled: boolean) => void;
	resetStereoExpander: () => void;
	compressorGainReduction: number;
	audioContext: AudioContext | null;
	getMasterOutput: () => GainNode;
}

export function useStemPlayer({
	profileName,
	fileName,
	stemsData,
	sampleRate = 44100,
	recordingId,
	startTimeSec,
	endTimeSec,
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
		duration: fullDuration,
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
				eqLow: savedStem?.eqLow ?? "off",
				eqMid: savedStem?.eqMid ?? "off",
				eqHigh: savedStem?.eqHigh ?? "off",
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

			// Apply compression settings with makeup gain
			const compressor = node.compressorNode;
			let makeupGain = 1.0; // Linear gain multiplier

			switch (state.compression) {
				case "off":
					compressor.threshold.value = 0;
					compressor.knee.value = 0;
					compressor.ratio.value = 1;
					compressor.attack.value = 0;
					compressor.release.value = 0;
					makeupGain = 1.0; // 0 dB
					break;
				case "low":
					compressor.threshold.value = -24;
					compressor.knee.value = 30;
					compressor.ratio.value = 3;
					compressor.attack.value = 0.003;
					compressor.release.value = 0.25;
					// Conservative makeup: compensate for ~60% of expected reduction
					// Expected average reduction: ~4dB, apply ~2.4dB makeup
					makeupGain = Math.pow(10, 2.4 / 20);
					break;
				case "medium":
					compressor.threshold.value = -18;
					compressor.knee.value = 20;
					compressor.ratio.value = 6;
					compressor.attack.value = 0.003;
					compressor.release.value = 0.15;
					// Conservative makeup: compensate for ~60% of expected reduction
					// Expected average reduction: ~6dB, apply ~3.6dB makeup
					makeupGain = Math.pow(10, 3.6 / 20);
					break;
				case "high":
					compressor.threshold.value = -12;
					compressor.knee.value = 10;
					compressor.ratio.value = 12;
					compressor.attack.value = 0.001;
					compressor.release.value = 0.1;
					// Conservative makeup: compensate for ~60% of expected reduction
					// Expected average reduction: ~8dB, apply ~4.8dB makeup
					makeupGain = Math.pow(10, 4.8 / 20);
					break;
			}

			// Apply gain with makeup gain compensation
			node.gainNode.gain.value = state.gain * makeupGain;

			// Apply EQ settings
			// Low-shelf (200 Hz)
			switch (state.eqLow) {
				case "off":
					node.eqLowNode.gain.value = 0;
					break;
				case "low":
					node.eqLowNode.gain.value = 3; // +3 dB
					break;
				case "medium":
					node.eqLowNode.gain.value = 6; // +6 dB
					break;
				case "high":
					node.eqLowNode.gain.value = 9; // +9 dB
					break;
			}

			// Mid-band peaking (1 kHz) - more aggressive than shelves
			switch (state.eqMid) {
				case "off":
					node.eqMidNode.gain.value = 0;
					node.eqMidNode.Q.value = 1.0;
					break;
				case "low":
					node.eqMidNode.gain.value = 6; // +6 dB (more noticeable)
					node.eqMidNode.Q.value = 2.0; // Narrower, more focused
					break;
				case "medium":
					node.eqMidNode.gain.value = 9; // +9 dB
					node.eqMidNode.Q.value = 2.5; // Even narrower
					break;
				case "high":
					node.eqMidNode.gain.value = 12; // +12 dB (very aggressive)
					node.eqMidNode.Q.value = 3.0; // Very narrow, surgical boost
					break;
			}

			// High-shelf (4 kHz)
			switch (state.eqHigh) {
				case "off":
					node.eqHighNode.gain.value = 0;
					break;
				case "low":
					node.eqHighNode.gain.value = 3; // +3 dB
					break;
				case "medium":
					node.eqHighNode.gain.value = 6; // +6 dB
					break;
				case "high":
					node.eqHighNode.gain.value = 9; // +9 dB
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
	const { parametricEq, eq, compressor, reverb, softClipper, stereoExpander } =
		useAudioEffects({
			audioContext,
			masterInput,
			masterOutput,
			recordingId,
		});

	// 8. Calculate effective duration for clips (what we report to UI)
	const duration = useMemo(() => {
		if (startTimeSec !== undefined && endTimeSec !== undefined) {
			// Clip mode: return bounded duration
			return Math.min(endTimeSec, fullDuration) - Math.max(0, startTimeSec);
		}
		// Full recording mode: return full duration
		return fullDuration;
	}, [fullDuration, startTimeSec, endTimeSec]);

	// 9. Playback control (use saved position or 0 if none)
	const { isPlaying, currentTime, play, pause, stop, seek, formatTime } =
		usePlaybackController({
			audioContext,
			duration,
			stemNodes,
			initialPosition: playbackPositionConfig.position,
			startTimeSec,
		});

	// Persist playback position when playback stops or pauses
	useEffect(() => {
		if (isPlaying) return; // Don't save while playing (too many updates)
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

	const cycleStemEqLow = useCallback(
		(stemName: string) => {
			const currentLevel: StemEqLevel = stems[stemName]?.eqLow ?? "off";
			const levels: StemEqLevel[] = ["off", "low", "medium", "high"];
			const currentIndex = levels.indexOf(currentLevel);
			const nextIndex = (currentIndex + 1) % levels.length;
			const nextLevel = levels[nextIndex];

			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], eqLow: nextLevel },
			});
		},
		[stemConfigs, setStemConfigs, stems],
	);

	const cycleStemEqMid = useCallback(
		(stemName: string) => {
			const currentLevel: StemEqLevel = stems[stemName]?.eqMid ?? "off";
			const levels: StemEqLevel[] = ["off", "low", "medium", "high"];
			const currentIndex = levels.indexOf(currentLevel);
			const nextIndex = (currentIndex + 1) % levels.length;
			const nextLevel = levels[nextIndex];

			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], eqMid: nextLevel },
			});
		},
		[stemConfigs, setStemConfigs, stems],
	);

	const cycleStemEqHigh = useCallback(
		(stemName: string) => {
			const currentLevel: StemEqLevel = stems[stemName]?.eqHigh ?? "off";
			const levels: StemEqLevel[] = ["off", "low", "medium", "high"];
			const currentIndex = levels.indexOf(currentLevel);
			const nextIndex = (currentIndex + 1) % levels.length;
			const nextLevel = levels[nextIndex];

			setStemConfigs({
				...stemConfigs,
				[stemName]: { ...stemConfigs[stemName], eqHigh: nextLevel },
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
		fullDuration,

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
		cycleStemEqLow,
		cycleStemEqMid,
		cycleStemEqHigh,

		// Master volume
		masterVolume,
		setMasterVolume,

		// Effects
		effectsConfig: {
			parametricEq: parametricEq.config,
			eq: eq.config,
			compressor: compressor.config,
			reverb: reverb.config,
			softClipper: softClipper.config,
			stereoExpander: stereoExpander.config,
		},
		updateParametricEqBand: parametricEq.updateBand,
		setParametricEqEnabled: parametricEq.setEnabled,
		resetParametricEq: parametricEq.reset,
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
		updateSoftClipper: softClipper.update,
		setSoftClipperEnabled: softClipper.setEnabled,
		resetSoftClipper: softClipper.reset,
		compressorGainReduction: compressor.gainReduction,
		audioContext,
		getMasterOutput,
	};
}
