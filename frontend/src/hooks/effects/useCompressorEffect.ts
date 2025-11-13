import { useCallback, useEffect, useRef, useState } from "react";
import type { CompressorConfig } from "@/types";
import { useConfigPersistence } from "../useConfigPersistence";

export interface UseCompressorEffectOptions {
	audioContext: AudioContext | null;
	recordingId: string;
}

export interface UseCompressorEffectResult {
	isReady: boolean;
	inputNode: AudioWorkletNode | null;
	outputNode: AudioWorkletNode | null;
	config: CompressorConfig;
	update: (changes: Partial<CompressorConfig>) => void;
	reset: () => void;
	setEnabled: (enabled: boolean) => void;
	gainReduction: number;
}

export const DEFAULT_COMPRESSOR_CONFIG: CompressorConfig = {
	preGain: 0,
	threshold: -6,
	attack: 0.005,
	hold: 0.02,
	release: 0.1,
	enabled: false,
};

/**
 * This hook is refactored to use a double-loop pattern to avoid re-render cycles:
 * 1. The AudioWorklet's `onmessage` handler receives high-frequency gain reduction
 *    updates and stores them in a `useRef`, avoiding state changes.
 * 2. A `requestAnimationFrame` loop runs at the display refresh rate to update React state
 *    from the ref, ensuring smooth UI updates without triggering re-renders on every message.
 */
export function useCompressorEffect({
	audioContext,
	recordingId,
}: UseCompressorEffectOptions): UseCompressorEffectResult {
	// Persist config directly to database
	const { config, setConfig } = useConfigPersistence({
		recordingId,
		configKey: "compressor",
		defaultValue: DEFAULT_COMPRESSOR_CONFIG,
		debounceMs: 500,
	});

	const [isReady, setIsReady] = useState(false);
	const workletNodeRef = useRef<AudioWorkletNode | null>(null);
	const workletLoadedRef = useRef(false);
	const [gainReduction, setGainReduction] = useState(0);
	const gainReductionRef = useRef(0);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		if (!audioContext || workletLoadedRef.current) return;

		let node: AudioWorkletNode | null = null;

		async function loadWorklet() {
			try {
				if (!audioContext) {
					throw new Error("AudioContext is null");
				}

				await audioContext.audioWorklet.addModule("/limiter-processor.js");
				workletLoadedRef.current = true;

				node = new AudioWorkletNode(
					audioContext,
					"master-limiter-processor",
					{ outputChannelCount: [2] },
				);

				node.port.onmessage = (event) => {
					if (event.data.type === "gainReduction") {
						// Update ref, not state
						gainReductionRef.current = event.data.value;
					}
				};

				workletNodeRef.current = node;
				setIsReady(true);
			} catch (error) {
				console.error(
					"[useCompressorEffect] Failed to load AudioWorklet:",
					error,
				);
			}
		}

		loadWorklet();

		return () => {
			node?.port.close();
			node?.disconnect();
			setIsReady(false);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [audioContext]);

	// Render loop (requestAnimationFrame) to update state from ref
	useEffect(() => {
		if (!config.enabled) {
			setGainReduction(0);
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			return;
		}

		const render = () => {
			if (gainReductionRef.current !== gainReduction) {
				setGainReduction(gainReductionRef.current);
			}
			rafRef.current = requestAnimationFrame(render);
		};

		rafRef.current = requestAnimationFrame(render);

		return () => {
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [config.enabled, gainReduction]);

	useEffect(() => {
		if (!audioContext || !isReady || !workletNodeRef.current) return;

		const { preGain, threshold, attack, hold, release } = config;
		// Clamp -Infinity to -96 dB for AudioParam (can't accept non-finite values)
		const preGainClamped = !isFinite(preGain) || preGain <= -96 ? -96 : preGain;
		workletNodeRef.current.parameters
			.get("preGain")
			?.setTargetAtTime(preGainClamped, audioContext.currentTime, 0.01);
		workletNodeRef.current.parameters
			.get("threshold")
			?.setTargetAtTime(threshold, audioContext.currentTime, 0.01);
		workletNodeRef.current.parameters
			.get("attack")
			?.setTargetAtTime(attack, audioContext.currentTime, 0.01);
		workletNodeRef.current.parameters
			.get("hold")
			?.setTargetAtTime(hold, audioContext.currentTime, 0.01);
		workletNodeRef.current.parameters
			.get("release")
			?.setTargetAtTime(release, audioContext.currentTime, 0.01);

		if (!config.enabled) {
			setGainReduction(0);
		}
	}, [config, audioContext, isReady]);

	const update = useCallback((changes: Partial<CompressorConfig>) => {
		setConfig((prev) => ({ ...prev, ...changes }));
	}, []);

	const reset = useCallback(() => {
		setConfig(DEFAULT_COMPRESSOR_CONFIG);
	}, []);

	const setEnabled = useCallback((enabled: boolean) => {
		setConfig((prev) => ({ ...prev, enabled }));
	}, []);

	return {
		isReady,
		inputNode: workletNodeRef.current,
		outputNode: workletNodeRef.current,
		config,
		update,
		reset,
		setEnabled,
		gainReduction,
	};
}
