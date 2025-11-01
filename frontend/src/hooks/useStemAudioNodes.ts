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

			// Create gain nodes
			const gainNode = audioContext.createGain();
			const outputGainNode = audioContext.createGain();

			gainNode.gain.value = initialGain;
			outputGainNode.gain.value = 1;

			// Connect: gainNode → outputGainNode → masterInput
			try {
				gainNode.connect(outputGainNode);
				outputGainNode.connect(masterInput);
			} catch (error) {
				console.error(
					"[useStemAudioNodes] Failed to connect nodes for stem:",
					name,
					error,
				);
				console.error("[useStemAudioNodes] Node details:", {
					gainNodeType: gainNode.constructor.name,
					outputGainNodeType: outputGainNode.constructor.name,
					masterInputType: masterInput.constructor.name,
					audioContextState: audioContext.state,
				});
				throw error; // Don't continue with broken audio graph
			}

			newNodes.set(name, {
				buffer,
				gainNode,
				outputGainNode,
				initialGain,
			});
		});

		setStemNodes(newNodes);

		return () => {
			newNodes.forEach((node) => {
				try {
					node.gainNode?.disconnect();
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
