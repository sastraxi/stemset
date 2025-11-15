import { useState, useEffect } from "react";
import type {
  StemAudioNodes,
  StemUserConfig,
  LoadedStem,
  StemCompressionLevel,
  StemEqLevel,
} from "../types";

export interface UseStemAudioGraphOptions {
  audioContext: AudioContext | null;
  masterInput: GainNode | null;
  buffers: Map<string, LoadedStem>;
  config: Record<string, StemUserConfig>; // Saved recording config (read-only for ClipPlayer)
  localMutes?: Record<string, boolean>; // Optional local mute state (for ClipPlayer, non-persisted)
}

export interface UseStemAudioGraphResult {
  stemNodes: Map<string, StemAudioNodes>;
}

/**
 * Creates per-stem audio processing chains and applies saved recording configuration.
 *
 * Audio chain per stem:
 *   source → gainNode → eqLow → eqMid → eqHigh → compressor → outputGain → masterInput
 *
 * Responsibilities:
 * - Create audio node graph for each stem
 * - Apply saved compression settings with makeup gain
 * - Apply saved EQ settings (3-band: low/mid/high)
 * - Apply saved volume/mute/solo state
 * - Handle local mute overrides (for ClipPlayer)
 *
 * Usage:
 * - StemPlayer: config is persisted, can be modified by user
 * - ClipPlayer: config is read-only from recording, localMutes allows temporary mute toggles
 */
export function useStemAudioGraph({
  audioContext,
  masterInput,
  buffers,
  config,
  localMutes = {},
}: UseStemAudioGraphOptions): UseStemAudioGraphResult {
  const [stemNodes, setStemNodes] = useState<Map<string, StemAudioNodes>>(
    new Map(),
  );

  // Create audio graph when buffers/context change
  useEffect(() => {
    if (!audioContext || !masterInput || buffers.size === 0) {
      setStemNodes(new Map());
      return;
    }

    // Disconnect old nodes
    stemNodes.forEach((node) => {
      try {
        node.gainNode?.disconnect();
        node.eqLowNode?.disconnect();
        node.eqMidNode?.disconnect();
        node.eqHighNode?.disconnect();
        node.compressorNode?.disconnect();
        node.outputGainNode?.disconnect();
      } catch (error) {
        // Already disconnected
      }
    });

    // Create new nodes
    const newNodes = new Map<string, StemAudioNodes>();

    buffers.forEach((loadedStem, name) => {
      const { metadata } = loadedStem;

      // Calculate initial gain from metadata (gain adjustment from processing)
      let initialGain = 1;
      const stemGainDb = (metadata as any)?.stem_gain_adjustment_db;
      if (typeof stemGainDb === "number") {
        initialGain = Math.pow(10, stemGainDb / 20);
      }

      // Create nodes
      const gainNode = audioContext.createGain();
      const eqLowNode = audioContext.createBiquadFilter();
      const eqMidNode = audioContext.createBiquadFilter();
      const eqHighNode = audioContext.createBiquadFilter();
      const compressorNode = audioContext.createDynamicsCompressor();
      const outputGainNode = audioContext.createGain();

      // Initialize with defaults
      gainNode.gain.value = initialGain;
      outputGainNode.gain.value = 1;

      // EQ setup (will be configured later based on saved config)
      eqLowNode.type = "lowshelf";
      eqLowNode.frequency.value = 200; // 200 Hz
      eqLowNode.gain.value = 0;

      eqMidNode.type = "peaking";
      eqMidNode.frequency.value = 1000; // 1 kHz
      eqMidNode.Q.value = 1.0;
      eqMidNode.gain.value = 0;

      eqHighNode.type = "highshelf";
      eqHighNode.frequency.value = 4000; // 4 kHz
      eqHighNode.gain.value = 0;

      // Compressor setup (will be configured later based on saved config)
      compressorNode.threshold.value = 0;
      compressorNode.knee.value = 0;
      compressorNode.ratio.value = 1;
      compressorNode.attack.value = 0;
      compressorNode.release.value = 0;

      // Connect the chain
      gainNode.connect(eqLowNode);
      eqLowNode.connect(eqMidNode);
      eqMidNode.connect(eqHighNode);
      eqHighNode.connect(compressorNode);
      compressorNode.connect(outputGainNode);
      outputGainNode.connect(masterInput);

      newNodes.set(name, {
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
          // Already disconnected
        }
      });
    };
  }, [audioContext, masterInput, buffers]);

  // Apply saved configuration to audio nodes
  useEffect(() => {
    if (stemNodes.size === 0) return;

    // Check if any stem is soloed
    const hasSolo = Object.values(config).some((c) => c.soloed);

    stemNodes.forEach((node, name) => {
      const savedConfig = config[name] || {};

      // Apply compression with makeup gain
      const compression: StemCompressionLevel =
        savedConfig.compression || "off";
      let makeupGain = 1.0;

      switch (compression) {
        case "off":
          node.compressorNode.threshold.value = 0;
          node.compressorNode.knee.value = 0;
          node.compressorNode.ratio.value = 1;
          node.compressorNode.attack.value = 0;
          node.compressorNode.release.value = 0;
          makeupGain = 1.0;
          break;
        case "low":
          node.compressorNode.threshold.value = -24;
          node.compressorNode.knee.value = 30;
          node.compressorNode.ratio.value = 3;
          node.compressorNode.attack.value = 0.003;
          node.compressorNode.release.value = 0.25;
          makeupGain = Math.pow(10, 2.4 / 20); // ~2.4dB makeup
          break;
        case "medium":
          node.compressorNode.threshold.value = -18;
          node.compressorNode.knee.value = 20;
          node.compressorNode.ratio.value = 6;
          node.compressorNode.attack.value = 0.003;
          node.compressorNode.release.value = 0.15;
          makeupGain = Math.pow(10, 3.6 / 20); // ~3.6dB makeup
          break;
        case "high":
          node.compressorNode.threshold.value = -12;
          node.compressorNode.knee.value = 10;
          node.compressorNode.ratio.value = 12;
          node.compressorNode.attack.value = 0.001;
          node.compressorNode.release.value = 0.1;
          makeupGain = Math.pow(10, 4.8 / 20); // ~4.8dB makeup
          break;
      }

      // Apply gain (user volume * makeup gain)
      const userGain = savedConfig.gain ?? node.initialGain;
      node.gainNode.gain.value = userGain * makeupGain;

      // Apply EQ settings
      const eqLow: StemEqLevel = savedConfig.eqLow || "off";
      switch (eqLow) {
        case "off":
          node.eqLowNode.gain.value = 0;
          break;
        case "low":
          node.eqLowNode.gain.value = 3;
          break;
        case "medium":
          node.eqLowNode.gain.value = 6;
          break;
        case "high":
          node.eqLowNode.gain.value = 9;
          break;
      }

      const eqMid: StemEqLevel = savedConfig.eqMid || "off";
      switch (eqMid) {
        case "off":
          node.eqMidNode.gain.value = 0;
          node.eqMidNode.Q.value = 1.0;
          break;
        case "low":
          node.eqMidNode.gain.value = 6;
          node.eqMidNode.Q.value = 2.0;
          break;
        case "medium":
          node.eqMidNode.gain.value = 9;
          node.eqMidNode.Q.value = 2.5;
          break;
        case "high":
          node.eqMidNode.gain.value = 12;
          node.eqMidNode.Q.value = 3.0;
          break;
      }

      const eqHigh: StemEqLevel = savedConfig.eqHigh || "off";
      switch (eqHigh) {
        case "off":
          node.eqHighNode.gain.value = 0;
          break;
        case "low":
          node.eqHighNode.gain.value = 3;
          break;
        case "medium":
          node.eqHighNode.gain.value = 6;
          break;
        case "high":
          node.eqHighNode.gain.value = 9;
          break;
      }

      // Apply audibility (mute/solo logic + local mute overrides)
      let audible = true;

      if (hasSolo) {
        // If any stem is soloed, only soloed stems are audible
        audible = savedConfig.soloed || false;
      } else {
        // No solo: check saved mute state
        audible = !savedConfig.muted;
      }

      // Apply local mute override (for ClipPlayer)
      if (localMutes[name]) {
        audible = false;
      }

      node.outputGainNode.gain.value = audible ? 1 : 0;
    });
  }, [stemNodes, config, localMutes]);

  return { stemNodes };
}
