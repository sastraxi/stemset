import { useEffect, useRef, useState } from "react";

export interface ClipDetectorState {
	leftClipping: boolean;
	rightClipping: boolean;
	leftPeak: number; // 0-1 normalized peak level
	rightPeak: number; // 0-1 normalized peak level
	clipCount: number;
	reset: () => void;
}

interface ClipDetectorOptions {
	/** Threshold for clipping detection (default: 0.99 to catch near-clips) */
	clipThreshold?: number;
	/** How long to hold the clip indicator in milliseconds (default: 2000) */
	clipHoldTime?: number;
	/** Update interval in milliseconds (default: 16ms ~= 60fps) */
	updateInterval?: number;
}

/**
 * Hook to detect audio clipping with sample-accurate peak detection.
 * Monitors stereo audio from master output and tracks peak levels and clipping events.
 */
export function useClipDetector(
	masterOutputNode: GainNode | null,
	audioContext: AudioContext | null,
	isPlaying: boolean,
	options: ClipDetectorOptions = {},
): ClipDetectorState {
	const {
		clipThreshold = 0.99,
		clipHoldTime = 2000,
		updateInterval = 16,
	} = options;

	const [leftClipping, setLeftClipping] = useState(false);
	const [rightClipping, setRightClipping] = useState(false);
	const [leftPeak, setLeftPeak] = useState(0);
	const [rightPeak, setRightPeak] = useState(0);
	const [clipCount, setClipCount] = useState(0);

	const splitterRef = useRef<ChannelSplitterNode | null>(null);
	const analyserLeftRef = useRef<AnalyserNode | null>(null);
	const analyserRightRef = useRef<AnalyserNode | null>(null);
	const dataArrayLeftRef = useRef<Float32Array | null>(null);
	const dataArrayRightRef = useRef<Float32Array | null>(null);

	const leftClipTimeRef = useRef<number>(0);
	const rightClipTimeRef = useRef<number>(0);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	// Create analyzer nodes when audio context and master output are available
	useEffect(() => {
		if (!audioContext || !masterOutputNode) {
			return;
		}

		// Create channel splitter to separate L/R
		const splitter = audioContext.createChannelSplitter(2);
		splitterRef.current = splitter;

		// Create analyzer for left channel
		const analyserLeft = audioContext.createAnalyser();
		analyserLeft.fftSize = 2048; // Larger buffer for accurate peak detection
		analyserLeft.smoothingTimeConstant = 0; // No smoothing - we want true peaks
		analyserLeft.minDecibels = -90;
		analyserLeft.maxDecibels = 0;
		analyserLeftRef.current = analyserLeft;
		dataArrayLeftRef.current = new Float32Array(analyserLeft.fftSize);

		// Create analyzer for right channel
		const analyserRight = audioContext.createAnalyser();
		analyserRight.fftSize = 2048;
		analyserRight.smoothingTimeConstant = 0;
		analyserRight.minDecibels = -90;
		analyserRight.maxDecibels = 0;
		analyserRightRef.current = analyserRight;
		dataArrayRightRef.current = new Float32Array(analyserRight.fftSize);

		// Connect: masterOutput → splitter → analyzers
		masterOutputNode.connect(splitter);
		splitter.connect(analyserLeft, 0); // Left channel
		splitter.connect(analyserRight, 1); // Right channel

		return () => {
			// Cleanup
			masterOutputNode.disconnect(splitter);
			splitter.disconnect();
			analyserLeftRef.current = null;
			analyserRightRef.current = null;
			splitterRef.current = null;
			dataArrayLeftRef.current = null;
			dataArrayRightRef.current = null;
		};
	}, [audioContext, masterOutputNode]);

	// Interval loop to update peak levels and detect clipping
	useEffect(() => {
		if (!isPlaying || !analyserLeftRef.current || !analyserRightRef.current) {
			// Reset peaks when not playing
			setLeftPeak(0);
			setRightPeak(0);
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			return;
		}

		const updatePeaks = () => {
			if (!analyserLeftRef.current || !analyserRightRef.current) return;
			if (!dataArrayLeftRef.current || !dataArrayRightRef.current) return;

			// Get time domain data (raw waveform samples in Float32)
			analyserLeftRef.current.getFloatTimeDomainData(
				dataArrayLeftRef.current as Float32Array<ArrayBuffer>,
			);
			analyserRightRef.current.getFloatTimeDomainData(
				dataArrayRightRef.current as Float32Array<ArrayBuffer>,
			);

			// Find peak values (sample-accurate)
			const findPeak = (data: Float32Array): number => {
				let peak = 0;
				for (let i = 0; i < data.length; i++) {
					const abs = Math.abs(data[i]);
					if (abs > peak) {
						peak = abs;
					}
				}
				return peak;
			};

			const currentLeftPeak = findPeak(dataArrayLeftRef.current);
			const currentRightPeak = findPeak(dataArrayRightRef.current);

			setLeftPeak(currentLeftPeak);
			setRightPeak(currentRightPeak);

			// Detect clipping
			const now = Date.now();

			if (currentLeftPeak >= clipThreshold) {
				if (!leftClipping) {
					setLeftClipping(true);
					setClipCount((prev) => prev + 1);
				}
				leftClipTimeRef.current = now;
			}

			if (currentRightPeak >= clipThreshold) {
				if (!rightClipping) {
					setRightClipping(true);
					setClipCount((prev) => prev + 1);
				}
				rightClipTimeRef.current = now;
			}

			// Clear clipping indicators after hold time
			if (leftClipping && now - leftClipTimeRef.current > clipHoldTime) {
				setLeftClipping(false);
			}

			if (rightClipping && now - rightClipTimeRef.current > clipHoldTime) {
				setRightClipping(false);
			}
		};

		intervalRef.current = setInterval(updatePeaks, updateInterval);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [
		isPlaying,
		clipThreshold,
		clipHoldTime,
		updateInterval,
		leftClipping,
		rightClipping,
	]);

	const reset = () => {
		setLeftClipping(false);
		setRightClipping(false);
		setLeftPeak(0);
		setRightPeak(0);
		setClipCount(0);
		leftClipTimeRef.current = 0;
		rightClipTimeRef.current = 0;
	};

	return {
		leftClipping,
		rightClipping,
		leftPeak,
		rightPeak,
		clipCount,
		reset,
	};
}
