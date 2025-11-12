import { useState, useRef, useEffect, useCallback } from "react";
import { useConfigPersistence } from "../useConfigPersistence";
import type { ParametricEqConfig, ParametricEqBandConfig } from "@/types";

export interface UseParametricEqEffectOptions {
	audioContext: AudioContext | null;
	recordingId: string;
}

export interface UseParametricEqEffectResult {
	isReady: boolean;
	inputNode: BiquadFilterNode | null; // First filter in the chain
	outputNode: BiquadFilterNode | null; // Last filter in the chain
	nodes: BiquadFilterNode[];
	config: ParametricEqConfig;
	updateBand: (
		band: "lowBand" | "midBand" | "highBand",
		changes: Partial<ParametricEqBandConfig>,
	) => void;
	setEnabled: (enabled: boolean) => void;
	reset: () => void;
}

export const DEFAULT_PARAMETRIC_EQ_CONFIG: ParametricEqConfig = {
	lowBand: {
		frequency: 100, // 20-500Hz range
		gain: 0, // -12 to +12 dB
		q: 1.0, // 0.3 to 8
	},
	midBand: {
		frequency: 1000, // 200-5000Hz range
		gain: 0,
		q: 1.0,
	},
	highBand: {
		frequency: 8000, // 1000-20000Hz range
		gain: 0,
		q: 1.0,
	},
	enabled: true,
};

/**
 * Hook for 3-band parametric EQ.
 * Creates three peaking filters connected in series.
 * Each band has adjustable frequency, gain, and Q.
 */
export function useParametricEqEffect({
	audioContext,
	recordingId,
}: UseParametricEqEffectOptions): UseParametricEqEffectResult {
	// Persist config directly to database
	const { config, setConfig } = useConfigPersistence({
		recordingId,
		configKey: "parametricEq",
		defaultValue: DEFAULT_PARAMETRIC_EQ_CONFIG,
		debounceMs: 500,
	});

	const [isReady, setIsReady] = useState(false);
	const nodesRef = useRef<BiquadFilterNode[]>([]);

	// Create filter nodes once when audioContext is available
	useEffect(() => {
		if (!audioContext || nodesRef.current.length > 0) return;

		// Create three peaking filters with default values
		const lowFilter = audioContext.createBiquadFilter();
		lowFilter.type = "peaking";
		lowFilter.frequency.value = 100;
		lowFilter.Q.value = 1.0;
		lowFilter.gain.value = 0;

		const midFilter = audioContext.createBiquadFilter();
		midFilter.type = "peaking";
		midFilter.frequency.value = 1000;
		midFilter.Q.value = 1.0;
		midFilter.gain.value = 0;

		const highFilter = audioContext.createBiquadFilter();
		highFilter.type = "peaking";
		highFilter.frequency.value = 8000;
		highFilter.Q.value = 1.0;
		highFilter.gain.value = 0;

		const createdNodes = [lowFilter, midFilter, highFilter];

		// Chain the filters together: low → mid → high
		lowFilter.connect(midFilter);
		midFilter.connect(highFilter);

		nodesRef.current = createdNodes;
		setIsReady(true);

		return () => {
			createdNodes.forEach((f) => {
				try {
					f.disconnect();
				} catch {}
			});
			setIsReady(false);
			nodesRef.current = [];
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [audioContext]);

	// Update filter parameters when config changes
	useEffect(() => {
		if (!audioContext || !isReady || nodesRef.current.length !== 3) return;

		const [lowFilter, midFilter, highFilter] = nodesRef.current;
		const bands = [config.lowBand, config.midBand, config.highBand];
		const filters = [lowFilter, midFilter, highFilter];

		filters.forEach((filter, i) => {
			const band = bands[i];
			// Smooth parameter transitions
			filter.frequency.setTargetAtTime(
				band.frequency,
				audioContext.currentTime,
				0.01,
			);
			filter.Q.setTargetAtTime(band.q, audioContext.currentTime, 0.01);
			filter.gain.setTargetAtTime(band.gain, audioContext.currentTime, 0.01);
		});
	}, [config, audioContext, isReady]);

	const updateBand = useCallback(
		(
			band: "lowBand" | "midBand" | "highBand",
			changes: Partial<ParametricEqBandConfig>,
		) => {
			setConfig((prev) => ({
				...prev,
				[band]: { ...prev[band], ...changes },
			}));
		},
		[],
	);

	const setEnabled = useCallback((enabled: boolean) => {
		setConfig((prev) => ({ ...prev, enabled }));
	}, []);

	const reset = useCallback(() => {
		setConfig(DEFAULT_PARAMETRIC_EQ_CONFIG);
	}, []);

	return {
		isReady,
		inputNode: nodesRef.current[0] || null,
		outputNode: nodesRef.current[2] || null,
		nodes: nodesRef.current,
		config,
		updateBand,
		setEnabled,
		reset,
	};
}
