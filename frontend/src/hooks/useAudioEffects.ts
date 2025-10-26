import { useEffect, useCallback } from 'react';
import { useEqEffect } from './effects/useEqEffect';
import type { UseEqEffectResult } from './effects/useEqEffect';
import { useCompressorEffect } from './effects/useCompressorEffect';
import type { UseCompressorEffectResult } from './effects/useCompressorEffect';
import { useReverbEffect } from './effects/useReverbEffect';
import type { UseReverbEffectResult } from './effects/useReverbEffect';
import { useStereoExpanderEffect } from './effects/useStereoExpanderEffect';
import type { UseStereoExpanderEffectResult } from './effects/useStereoExpanderEffect';

export interface AudioEffectsConfig {
  eqConfig?: unknown;
  compressorConfig?: unknown;
  reverbConfig?: unknown;
  stereoExpanderConfig?: unknown;
}

export interface UseAudioEffectsOptions {
  audioContext: AudioContext | null;
  masterInput: GainNode | null;
  savedEffectsConfig: AudioEffectsConfig;
}

export interface UseAudioEffectsResult {
  eq: UseEqEffectResult;
  compressor: UseCompressorEffectResult;
  reverb: UseReverbEffectResult;
  stereoExpander: UseStereoExpanderEffectResult;
  getCurrentEffectsConfig: () => AudioEffectsConfig;
}

/**
 * Audio effects orchestrator hook.
 *
 * Composes all effect hooks and manages the audio graph routing:
 * masterInput → EQ → stereoExpander → reverb → compressor → destination
 *
 * Each effect can be enabled/disabled independently, and disabled effects
 * are bypassed in the audio graph.
 */
export function useAudioEffects({
  audioContext,
  masterInput,
  savedEffectsConfig,
}: UseAudioEffectsOptions): UseAudioEffectsResult {
  // Initialize all effects
  const eq = useEqEffect({
    audioContext,
    initialConfig: savedEffectsConfig.eqConfig,
  });

  const stereoExpander = useStereoExpanderEffect({
    audioContext,
    initialConfig: savedEffectsConfig.stereoExpanderConfig,
  });

  const reverb = useReverbEffect({
    audioContext,
    initialConfig: savedEffectsConfig.reverbConfig,
  });

  const compressor = useCompressorEffect({
    audioContext,
    initialConfig: savedEffectsConfig.compressorConfig,
  });

  // Wire audio graph when any effect enabled state changes
  useEffect(() => {
    if (!audioContext || !masterInput) return;

    // Wait for nodes to be ready - check if we have any nodes at all
    const eqNodesReady = eq.nodes.length > 0;
    const compressorReady = compressor.inputNode && compressor.outputNode;
    const hasWorkletNodes = stereoExpander.node || reverb.node || compressorReady;

    // If no nodes are ready yet, don't try to wire the graph
    if (!eqNodesReady && !hasWorkletNodes) {
      console.log('[useAudioEffects] Waiting for effect nodes to be created...');
      return;
    }

    console.log('[useAudioEffects] Wiring audio graph...', {
      eqEnabled: eq.settings.enabled,
      eqNodes: eq.nodes.length,
      stereoExpanderEnabled: stereoExpander.settings.enabled,
      stereoExpanderNode: !!stereoExpander.node,
      reverbEnabled: reverb.settings.enabled,
      reverbNode: !!reverb.node,
      compressorEnabled: compressor.settings.enabled,
      compressorInputNode: !!compressor.inputNode,
      compressorOutputNode: !!compressor.outputNode,
    });

    // Disconnect everything first
    try {
      masterInput.disconnect();
    } catch { }
    eq.nodes.forEach(node => {
      try {
        node.disconnect();
      } catch { }
    });
    if (stereoExpander.node) {
      try {
        stereoExpander.node.disconnect();
      } catch { }
    }
    if (reverb.node) {
      try {
        reverb.node.disconnect();
      } catch { }
    }
    if (compressor.inputNode) {
      try {
        compressor.inputNode.disconnect();
      } catch { }
    }
    if (compressor.outputNode) {
      try {
        compressor.outputNode.disconnect();
      } catch { }
    }

    // Build the chain: masterInput → EQ → stereoExpander → reverb → compressor → destination
    let currentNode: AudioNode = masterInput;

    // EQ
    if (eq.settings.enabled && eq.nodes.length > 0) {
      eq.nodes.forEach(node => {
        currentNode.connect(node);
        currentNode = node;
      });
    }

    // Stereo Expander
    if (stereoExpander.settings.enabled && stereoExpander.node) {
      currentNode.connect(stereoExpander.node);
      currentNode = stereoExpander.node;
    }

    // Reverb
    if (reverb.settings.enabled && reverb.node) {
      currentNode.connect(reverb.node);
      currentNode = reverb.node;
    }

    // Compressor (has both input and output nodes)
    if (compressor.settings.enabled && compressor.inputNode && compressor.outputNode) {
      currentNode.connect(compressor.inputNode);
      currentNode = compressor.inputNode;
    }

    // Connect final node to destination
    currentNode.connect(audioContext.destination);

    console.log('[useAudioEffects] Audio graph wired successfully');
  }, [
    audioContext,
    masterInput,
    eq.settings.enabled,
    eq.nodes.length, // Use length instead of array reference
    stereoExpander.settings.enabled,
    stereoExpander.node,
    reverb.settings.enabled,
    reverb.node,
    compressor.settings.enabled,
    compressor.inputNode, // These are refs, but changes trigger via parent re-render
    compressor.outputNode,
  ]);

  const getCurrentEffectsConfig = useCallback((): AudioEffectsConfig => {
    return {
      eqConfig: eq.getConfig(),
      compressorConfig: compressor.getConfig(),
      reverbConfig: reverb.getConfig(),
      stereoExpanderConfig: stereoExpander.getConfig(),
    };
  }, [eq, compressor, reverb, stereoExpander]);

  return {
    eq,
    compressor,
    reverb,
    stereoExpander,
    getCurrentEffectsConfig,
  };
}
