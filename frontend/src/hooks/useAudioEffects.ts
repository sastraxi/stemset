import { useEffect } from 'react';
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
  eq: Omit<UseEqEffectResult, 'inputNode' | 'outputNode' | 'nodes' | 'isReady'>;
  compressor: Omit<UseCompressorEffectResult, 'inputNode' | 'outputNode' | 'isReady'>;
  reverb: Omit<UseReverbEffectResult, 'inputNode' | 'outputNode' | 'isReady'>;
  stereoExpander: Omit<UseStereoExpanderEffectResult, 'inputNode' | 'outputNode' | 'isReady'>;
  getCurrentEffectsConfig: () => AudioEffectsConfig;
}

/**
 * Audio effects orchestrator hook.
 *
 * Composes all effect hooks and manages the audio graph routing:
 * masterInput → EQ → stereoExpander → reverb → compressor → destination
 */
export function useAudioEffects({
  audioContext,
  masterInput,
  savedEffectsConfig,
}: UseAudioEffectsOptions): UseAudioEffectsResult {

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

  const allEffects = [eq, stereoExpander, reverb, compressor];

  // The Grand Central Wiring Effect
  useEffect(() => {
    const allReady = allEffects.every(e => e.isReady);
    if (!audioContext || !masterInput || !allReady) {
      return;
    }

    // 1. Disconnect EVERYTHING. This is the brute-force, but reliable, way to start fresh.
    masterInput.disconnect();
    allEffects.forEach(effect => {
      effect.outputNode?.disconnect();
    });

    // 2. Build the new chain, connecting nodes in series.
    let currentNode: AudioNode = masterInput;

    allEffects.forEach(effect => {
      if (effect.settings.enabled) {
        // Connect the previous node to this effect's input
        currentNode.connect(effect.inputNode!);
        // The new current node is this effect's output
        currentNode = effect.outputNode!;
      } // If disabled, currentNode just passes through to the next iteration.
    });

    // 3. Connect the final node in the chain to the destination.
    currentNode.connect(audioContext.destination);

  }, [
    audioContext,
    masterInput,
    eq.isReady, eq.settings.enabled,
    stereoExpander.isReady, stereoExpander.settings.enabled,
    reverb.isReady, reverb.settings.enabled,
    compressor.isReady, compressor.settings.enabled,
    // Note: We don't need the nodes themselves in the dependency array because
    // they are stored in refs and never change. This effect only re-runs when
    // readiness or enabled status changes.
  ]);

  const getCurrentEffectsConfig = (): AudioEffectsConfig => {
    return {
      eqConfig: eq.settings,
      compressorConfig: compressor.settings,
      reverbConfig: reverb.settings,
      stereoExpanderConfig: stereoExpander.settings,
    };
  };

  return {
    eq,
    compressor,
    reverb,
    stereoExpander,
    getCurrentEffectsConfig,
  };
}
