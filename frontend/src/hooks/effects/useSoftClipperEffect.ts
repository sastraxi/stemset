import { useCallback, useEffect, useRef, useState } from "react";
import type { SoftClipperConfig, SoftClipperCurve } from "@/types";
import { useConfigPersistence } from "../useConfigPersistence";

export interface UseSoftClipperEffectOptions {
	audioContext: AudioContext | null;
	recordingId: string;
}

export interface UseSoftClipperEffectResult {
	isReady: boolean;
	inputNode: AudioWorkletNode | null;
	outputNode: AudioWorkletNode | null;
	config: SoftClipperConfig;
	update: (changes: Partial<SoftClipperConfig>) => void;
	reset: () => void;
	setEnabled: (enabled: boolean) => void;
}

export const DEFAULT_SOFT_CLIPPER_CONFIG: SoftClipperConfig = {
	threshold: 0.8,
	drive: 1.0,
	curve: "tanh",
	mix: 1.0,
	enabled: false,
};

const CURVE_TO_INDEX: Record<SoftClipperCurve, number> = {
	tanh: 0,
	atan: 1,
	cubic: 2,
};

export function useSoftClipperEffect({
	audioContext,
	recordingId,
}: UseSoftClipperEffectOptions): UseSoftClipperEffectResult {
	// Persist config directly to database
	const { config, setConfig } = useConfigPersistence({
		recordingId,
		configKey: "softClipper",
		defaultValue: DEFAULT_SOFT_CLIPPER_CONFIG,
		debounceMs: 500,
	});

	const [isReady, setIsReady] = useState(false);
	const workletNodeRef = useRef<AudioWorkletNode | null>(null);
	const workletLoadedRef = useRef(false);

	useEffect(() => {
		if (!audioContext || workletLoadedRef.current) return;

		async function loadWorklet() {
			try {
				if (!audioContext) {
					throw new Error("AudioContext is null");
				}

				await audioContext.audioWorklet.addModule("/soft-clipper-processor.js");
				workletLoadedRef.current = true;

				const node = new AudioWorkletNode(
					audioContext,
					"soft-clipper-processor",
					{ outputChannelCount: [2] },
				);

				workletNodeRef.current = node;
				setIsReady(true);
			} catch (error) {
				console.error(
					"[useSoftClipperEffect] Failed to load AudioWorklet:",
					error,
				);
				console.error(
					"[useSoftClipperEffect] AudioContext state:",
					audioContext?.state,
				);
				console.error(
					"[useSoftClipperEffect] AudioContext sample rate:",
					audioContext?.sampleRate,
				);
				console.error(
					"[useSoftClipperEffect] Worklet loaded ref:",
					workletLoadedRef.current,
				);
				console.error("[useSoftClipperEffect] Error details:", {
					name: error instanceof Error ? error.name : "Unknown",
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : "No stack trace",
				});
			}
		}

		loadWorklet();

		return () => {
			workletNodeRef.current?.disconnect();
			setIsReady(false);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [audioContext]);

	useEffect(() => {
		if (!audioContext || !isReady || !workletNodeRef.current) return;

		const { threshold, drive, curve, mix, enabled } = config;

		// Set enabled parameter (1 for enabled, 0 for disabled)
		workletNodeRef.current.parameters
			.get("enabled")
			?.setTargetAtTime(enabled ? 1 : 0, audioContext.currentTime, 0.01);

		workletNodeRef.current.parameters
			.get("threshold")
			?.setTargetAtTime(threshold, audioContext.currentTime, 0.01);

		workletNodeRef.current.parameters
			.get("drive")
			?.setTargetAtTime(drive, audioContext.currentTime, 0.01);

		workletNodeRef.current.parameters
			.get("curve")
			?.setTargetAtTime(CURVE_TO_INDEX[curve], audioContext.currentTime, 0.01);

		workletNodeRef.current.parameters
			.get("mix")
			?.setTargetAtTime(mix, audioContext.currentTime, 0.01);
	}, [config, audioContext, isReady]);

	const update = useCallback(
		(changes: Partial<SoftClipperConfig>) => {
			setConfig((prev) => ({ ...prev, ...changes }));
		},
		[setConfig],
	);

	const reset = useCallback(() => {
		setConfig(DEFAULT_SOFT_CLIPPER_CONFIG);
	}, [setConfig]);

	const setEnabled = useCallback(
		(enabled: boolean) => {
			setConfig((prev) => ({ ...prev, enabled }));
		},
		[setConfig],
	);

	return {
		isReady,
		inputNode: workletNodeRef.current,
		outputNode: workletNodeRef.current,
		config,
		update,
		reset,
		setEnabled,
	};
}
