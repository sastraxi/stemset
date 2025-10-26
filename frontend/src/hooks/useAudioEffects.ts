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

  // Wire audio graph when any effect enabled state or readiness changes.
  useEffect(() => {
    if (!audioContext || !masterInput) {
      return;
    }

    // Disconnect master input to start the chain fresh.
    // This is the key to avoiding breaking internal effect connections.
    masterInput.disconnect();

    // Build the chain of active effects.
    const effects: (UseEqEffectResult | UseStereoExpanderEffectResult | UseReverbEffectResult | UseCompressorEffectResult)[] = [eq, stereoExpander, reverb, compressor];
    let currentNode: AudioNode = masterInput;

    for (const effect of effects) {
      if (effect.settings.enabled && effect.isReady && effect.inputNode && effect.outputNode) {
        currentNode.connect(effect.inputNode);
        currentNode = effect.outputNode;
      }
    }

    // Connect the end of the chain to the destination.
    currentNode.connect(audioContext.destination);

    // The cleanup function only needs to disconnect the master input on unmount.
    return () => {
      if (masterInput) {
        try {
          masterInput.disconnect();
        } catch {}
      }
    };
  }, [
    audioContext,
    masterInput,
    eq.settings.enabled,
    eq.isReady,
    stereoExpander.settings.enabled,
    stereoExpander.isReady,
    reverb.settings.enabled,
    reverb.isReady,
    compressor.settings.enabled,
    compressor.isReady,
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
