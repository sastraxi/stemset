import { useState, useEffect } from "react";
import type { StemAudioData, StemAudioNode } from "../types";

export interface UseStemAudioNodesOptions {
	audioContext: AudioContext | null;
	masterInput: GainNode | null;
	stems: Map<string, StemAudioData>;
}

export interface UseStemAudioNodesResult {
	stemNodes: Map<string, StemAudioNode>;
}

/**
 * Creates and manages audio nodes for stems.
 *
 * Responsibilities:
 * - Create GainNode pairs for each stem (volume + output)
 * - Connect to master input
 * - Extract initial gain from metadata
 * - Cleanup on unmount
 *
 * Pattern: Pure audio graph management. No UI state, no actions.
 * Returns Map of audio nodes. Parent manages gain values and mute/solo logic.
 */
export function useStemAudioNodes({
	audioContext,
	masterInput,
	stems,
}: UseStemAudioNodesOptions): UseStemAudioNodesResult {
	const [stemNodes, setStemNodes] = useState<Map<string, StemAudioNode>>(
		new Map(),
	);

	useEffect(() => {
		if (!audioContext || !masterInput || stems.size === 0) {
			setStemNodes(new Map());
			return;
		}

		// Disconnect old nodes
		stemNodes.forEach((node, name) => {
			try {
				node.gainNode?.disconnect();
				node.compressorNode?.disconnect();
				node.outputGainNode?.disconnect();
			} catch (error) {
				console.error(
					`[useStemAudioNodes] Failed to disconnect nodes for stem ${name}:`,
					error,
				);
			}
		});

		// Create new nodes
		const newNodes = new Map<string, StemAudioNode>();

		stems.forEach((stemData, name) => {
			const { buffer, metadata } = stemData;

			// Calculate initial gain from metadata
			let initialGain = 1;
			if (metadata && typeof metadata.stem_gain_adjustment_db === "number") {
				initialGain = Math.pow(10, metadata.stem_gain_adjustment_db / 20);
			}

			// Create gain nodes and compressor
			const gainNode = audioContext.createGain();
			const compressorNode = audioContext.createDynamicsCompressor();
			const outputGainNode = audioContext.createGain();

			gainNode.gain.value = initialGain;
			outputGainNode.gain.value = 1;

			// Initialize compressor with "off" settings (minimal compression)
			compressorNode.threshold.value = 0; // No threshold by default
			compressorNode.knee.value = 0;
			compressorNode.ratio.value = 1; // 1:1 = no compression
			compressorNode.attack.value = 0;
			compressorNode.release.value = 0;

			// Connect: gainNode → compressorNode → outputGainNode → masterInput
			try {
				gainNode.connect(compressorNode);
				compressorNode.connect(outputGainNode);
				outputGainNode.connect(masterInput);
			} catch (error) {
				console.error(
					"[useStemAudioNodes] Failed to connect nodes for stem:",
					name,
					error,
				);
				console.error("[useStemAudioNodes] Node details:", {
					gainNodeType: gainNode.constructor.name,
					compressorNodeType: compressorNode.constructor.name,
					outputGainNodeType: outputGainNode.constructor.name,
					masterInputType: masterInput.constructor.name,
					audioContextState: audioContext.state,
				});
				throw error; // Don't continue with broken audio graph
			}

			newNodes.set(name, {
				buffer,
				gainNode,
				compressorNode,
				outputGainNode,
				initialGain,
			});
		});

		setStemNodes(newNodes);

		return () => {
			newNodes.forEach((node) => {
				try {
					node.gainNode?.disconnect();
					node.compressorNode?.disconnect();
					node.outputGainNode?.disconnect();
				} catch (error) {
					// Already disconnected or invalid node
					console.debug("[useStemAudioNodes] Cleanup disconnect error:", error);
				}
			});
		};
	}, [audioContext, masterInput, stems]);

	return { stemNodes };
}
