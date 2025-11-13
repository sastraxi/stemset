import { useEffect, useRef, useState } from "react";

export interface VuMeterLevels {
	left: number; // 0-1 normalized level
	right: number; // 0-1 normalized level
}

/**
 * Hook to analyze stereo audio levels from master output.
 * Returns real-time VU meter levels for left and right channels.
 */
export function useVuMeter(
	masterOutputNode: GainNode | null,
	audioContext: AudioContext | null,
	isPlaying: boolean,
): VuMeterLevels {
	const [levels, setLevels] = useState<VuMeterLevels>({ left: 0, right: 0 });
	const splitterRef = useRef<ChannelSplitterNode | null>(null);
	const analyserLeftRef = useRef<AnalyserNode | null>(null);
	const analyserRightRef = useRef<AnalyserNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const dataArrayLeftRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
	const dataArrayRightRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

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
		analyserLeft.fftSize = 256; // Small FFT for low latency
		analyserLeft.smoothingTimeConstant = 0.6; // Moderate smoothing for VU behavior
		analyserLeftRef.current = analyserLeft;
		dataArrayLeftRef.current = new Uint8Array(analyserLeft.frequencyBinCount);

		// Create analyzer for right channel
		const analyserRight = audioContext.createAnalyser();
		analyserRight.fftSize = 256;
		analyserRight.smoothingTimeConstant = 0.6;
		analyserRightRef.current = analyserRight;
		dataArrayRightRef.current = new Uint8Array(analyserRight.frequencyBinCount);

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

	// RAF loop to update levels
	useEffect(() => {
		if (!isPlaying || !analyserLeftRef.current || !analyserRightRef.current) {
			// Reset levels when not playing
			setLevels({ left: 0, right: 0 });
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
			return;
		}

		let rafId: number | null = null;

		const updateLevels = () => {
			if (!analyserLeftRef.current || !analyserRightRef.current) return;
			if (!dataArrayLeftRef.current || !dataArrayRightRef.current) return;

			// Get time domain data (waveform)
			analyserLeftRef.current.getByteTimeDomainData(dataArrayLeftRef.current);
			analyserRightRef.current.getByteTimeDomainData(dataArrayRightRef.current);

			// Calculate RMS (root mean square) for more accurate level
			const calculateRMS = (data: Uint8Array): number => {
				let sum = 0;
				for (let i = 0; i < data.length; i++) {
					const normalized = (data[i] - 128) / 128; // Convert from 0-255 to -1 to 1
					sum += normalized * normalized;
				}
				const rms = Math.sqrt(sum / data.length);
				// Apply some scaling to make the meter more responsive
				return Math.min(1, rms * 2.5);
			};

			const leftLevel = calculateRMS(dataArrayLeftRef.current);
			const rightLevel = calculateRMS(dataArrayRightRef.current);

			setLevels({
				left: leftLevel,
				right: rightLevel,
			});

			rafId = requestAnimationFrame(updateLevels);
			animationFrameRef.current = rafId;
		};

		rafId = requestAnimationFrame(updateLevels);
		animationFrameRef.current = rafId;

		return () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
			}
			animationFrameRef.current = null;
		};
	}, [isPlaying]);

	return levels;
}
