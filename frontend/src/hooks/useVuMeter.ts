import { useEffect, useRef, useState } from "react";

export interface VuMeterLevels {
	left: number; // 0-1 normalized level
	right: number; // 0-1 normalized level
}

/**
 * Hook to analyze stereo audio levels from master output.
 * Returns real-time VU meter levels for left and right channels.
 *
 * This hook is refactored to use a double-loop pattern to avoid re-render cycles:
 * 1. A `requestAnimationFrame` loop runs at the display refresh rate to perform the
 *    expensive audio analysis and updates values stored in `useRef`s, avoiding state changes.
 * 2. A `setInterval` loop runs at a slower frequency to update React state from the refs,
 *    ensuring smooth UI updates without triggering the analysis loop.
 */
export function useVuMeter(
	masterOutputNode: GainNode | null,
	audioContext: AudioContext | null,
	isPlaying: boolean,
): VuMeterLevels {
	const [levels, setLevels] = useState<VuMeterLevels>({ left: 0, right: 0 });
	const levelsRef = useRef({ left: 0, right: 0 });

	const splitterRef = useRef<ChannelSplitterNode | null>(null);
	const analyserLeftRef = useRef<AnalyserNode | null>(null);
	const analyserRightRef = useRef<AnalyserNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const dataArrayLeftRef = useRef<Uint8Array | null>(null);
	const dataArrayRightRef = useRef<Uint8Array | null>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	// Create analyzer nodes
	useEffect(() => {
		if (!audioContext || !masterOutputNode) return;

		const splitter = audioContext.createChannelSplitter(2);
		const analyserLeft = audioContext.createAnalyser();
		analyserLeft.fftSize = 256;
		analyserLeft.smoothingTimeConstant = 0.6;
		const analyserRight = audioContext.createAnalyser();
		analyserRight.fftSize = 256;
		analyserRight.smoothingTimeConstant = 0.6;

		masterOutputNode.connect(splitter);
		splitter.connect(analyserLeft, 0);
		splitter.connect(analyserRight, 1);

		splitterRef.current = splitter;
		analyserLeftRef.current = analyserLeft;
		analyserRightRef.current = analyserRight;
		dataArrayLeftRef.current = new Uint8Array(analyserLeft.frequencyBinCount);
		dataArrayRightRef.current = new Uint8Array(analyserRight.frequencyBinCount);

		return () => {
			masterOutputNode.disconnect(splitter);
			splitter.disconnect();
		};
	}, [audioContext, masterOutputNode]);

	// Analysis loop (RAF) - updates refs
	useEffect(() => {
		if (!isPlaying) {
			levelsRef.current = { left: 0, right: 0 };
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
			return;
		}

		const analyse = () => {
			if (
				!analyserLeftRef.current ||
				!analyserRightRef.current ||
				!dataArrayLeftRef.current ||
				!dataArrayRightRef.current
			) {
				animationFrameRef.current = requestAnimationFrame(analyse);
				return;
			}

			analyserLeftRef.current.getByteTimeDomainData(
				dataArrayLeftRef.current as Uint8Array<ArrayBuffer>,
			);
			analyserRightRef.current.getByteTimeDomainData(
				dataArrayRightRef.current as Uint8Array<ArrayBuffer>,
			);

			const calculateRMS = (data: Uint8Array) => {
				const sum = data.reduce((acc, val) => {
					const normalized = (val - 128) / 128;
					return acc + normalized * normalized;
				}, 0);
				const rms = Math.sqrt(sum / data.length);
				return Math.min(1, rms * 2.5);
			};

			levelsRef.current = {
				left: calculateRMS(dataArrayLeftRef.current),
				right: calculateRMS(dataArrayRightRef.current),
			};

			animationFrameRef.current = requestAnimationFrame(analyse);
		};

		animationFrameRef.current = requestAnimationFrame(analyse);

		return () => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
		};
	}, [isPlaying]);

	// State update loop (setInterval) - updates state from refs
	useEffect(() => {
		if (!isPlaying) {
			setLevels({ left: 0, right: 0 });
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			return;
		}

		intervalRef.current = setInterval(() => {
			if (
				levels.left !== levelsRef.current.left ||
				levels.right !== levelsRef.current.right
			) {
				setLevels(levelsRef.current);
			}
		}, 50); // Update state at ~20fps

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [isPlaying, levels.left, levels.right]);

	return levels;
}
