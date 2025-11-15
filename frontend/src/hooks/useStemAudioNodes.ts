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
        node.eqLowNode?.disconnect();
        node.eqMidNode?.disconnect();
        node.eqHighNode?.disconnect();
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

      // Create gain nodes, EQ filters, and compressor
      const gainNode = audioContext.createGain();
      const eqLowNode = audioContext.createBiquadFilter();
      const eqMidNode = audioContext.createBiquadFilter();
      const eqHighNode = audioContext.createBiquadFilter();
      const compressorNode = audioContext.createDynamicsCompressor();
      const outputGainNode = audioContext.createGain();

      gainNode.gain.value = initialGain;
      outputGainNode.gain.value = 1;

      // Initialize EQ filters with "off" settings (flat response)
      // Low-shelf filter
      eqLowNode.type = "lowshelf";
      eqLowNode.frequency.value = 200; // 200 Hz
      eqLowNode.gain.value = 0; // 0 dB (flat)

      // Mid-band peaking filter
      eqMidNode.type = "peaking";
      eqMidNode.frequency.value = 1000; // 1 kHz
      eqMidNode.Q.value = 1.0;
      eqMidNode.gain.value = 0; // 0 dB (flat)

      // High-shelf filter
      eqHighNode.type = "highshelf";
      eqHighNode.frequency.value = 4000; // 4 kHz
      eqHighNode.gain.value = 0; // 0 dB (flat)

      // Initialize compressor with "off" settings (minimal compression)
      compressorNode.threshold.value = 0;
      compressorNode.knee.value = 0;
      compressorNode.ratio.value = 1; // 1:1 = no compression
      compressorNode.attack.value = 0;
      compressorNode.release.value = 0;

      // Connect: gainNode → eqLow → eqMid → eqHigh → compressor → outputGainNode → masterInput
      try {
        gainNode.connect(eqLowNode);
        eqLowNode.connect(eqMidNode);
        eqMidNode.connect(eqHighNode);
        eqHighNode.connect(compressorNode);
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
          eqLowNodeType: eqLowNode.constructor.name,
          eqMidNodeType: eqMidNode.constructor.name,
          eqHighNodeType: eqHighNode.constructor.name,
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
        eqLowNode,
        eqMidNode,
        eqHighNode,
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
          node.eqLowNode?.disconnect();
          node.eqMidNode?.disconnect();
          node.eqHighNode?.disconnect();
          node.compressorNode?.disconnect();
          node.outputGainNode?.disconnect();
        } catch (error) {
          // Already disconnected or invalid node
          console.debug("[useStemAudioNodes] Cleanup disconnect error:", error);
        }
      });
    };
  }, [audioContext, masterInput, stems.size]);

  return { stemNodes };
}
