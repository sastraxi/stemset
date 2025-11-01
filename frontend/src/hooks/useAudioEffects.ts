import { useEffect } from 'react';
import { useEqEffect } from './effects/useEqEffect';
import type { UseEqEffectResult, EqConfig } from './effects/useEqEffect';
import { useCompressorEffect } from './effects/useCompressorEffect';
import type { UseCompressorEffectResult, CompressorConfig } from './effects/useCompressorEffect';
import { useReverbEffect } from './effects/useReverbEffect';
import type { UseReverbEffectResult, ReverbConfig } from './effects/useReverbEffect';
import { useStereoExpanderEffect } from './effects/useStereoExpanderEffect';
import type { UseStereoExpanderEffectResult, StereoExpanderConfig } from './effects/useStereoExpanderEffect';

export interface AudioEffectsConfig {
  eqConfig?: EqConfig;
  compressorConfig?: CompressorConfig;
  reverbConfig?: ReverbConfig;
  stereoExpanderConfig?: StereoExpanderConfig;
}

export interface UseAudioEffectsOptions {
  audioContext: AudioContext | null;
  masterInput: GainNode | null;
  masterOutput: GainNode | null;
  recordingId: string;
}

export interface UseAudioEffectsResult {
  eq: Omit<UseEqEffectResult, 'inputNode' | 'outputNode' | 'nodes' | 'isReady'>;
  compressor: Omit<UseCompressorEffectResult, 'inputNode' | 'outputNode' | 'isReady'>;
  reverb: Omit<UseReverbEffectResult, 'inputNode' | 'outputNode' | 'isReady'>;
  stereoExpander: Omit<UseStereoExpanderEffectResult, 'inputNode' | 'outputNode' | 'isReady'>;
}

/**
 * Audio effects orchestrator hook.
 *
 * Composes all effect hooks and manages the audio graph routing:
 * masterInput → EQ → stereoExpander → reverb → compressor → masterOutput
 *
 * Each effect now manages its own persistence directly via useConfigPersistence.
 */
export function useAudioEffects({
  audioContext,
  masterInput,
  masterOutput,
  recordingId,
}: UseAudioEffectsOptions): UseAudioEffectsResult {

  const eq = useEqEffect({
    audioContext,
    recordingId,
  });

  const stereoExpander = useStereoExpanderEffect({
    audioContext,
    recordingId,
  });

  const reverb = useReverbEffect({
    audioContext,
    recordingId,
  });

  const compressor = useCompressorEffect({
    audioContext,
    recordingId,
  });

  const allEffects = [eq, stereoExpander, reverb, compressor];

  // The Grand Central Wiring Effect
  useEffect(() => {
    // console.log('[useAudioEffects] Wiring effect chain...');
    // console.log('[useAudioEffects] AudioContext:', audioContext);
    // console.log('[useAudioEffects] Master input:', masterInput);
    // console.log('[useAudioEffects] Master output:', masterOutput);

    const allReady = allEffects.every(e => e.isReady);
    // console.log('[useAudioEffects] All effects ready:', allReady);
    // console.log('[useAudioEffects] Effect ready states:', {
    //   eq: eq.isReady,
    //   stereoExpander: stereoExpander.isReady,
    //   reverb: reverb.isReady,
    //   compressor: compressor.isReady
    // });

    if (!audioContext || !masterInput || !masterOutput || !allReady) {
      // console.log('[useAudioEffects] Skipping wiring - missing dependencies');
      return;
    }

    // 1. Disconnect EVERYTHING. This is the brute-force, but reliable, way to start fresh.
    try {
      masterInput.disconnect();
      // console.log('[useAudioEffects] Disconnected master input');
    } catch (e) {
      console.debug('[useAudioEffects] Master input already disconnected');
    }

    allEffects.forEach((effect, index) => {
      try {
        effect.outputNode?.disconnect();
        // console.log(`[useAudioEffects] Disconnected effect ${index} output`);
      } catch (e) {
        console.debug(`[useAudioEffects] Effect ${index} output already disconnected`);
      }
    });

    // 2. Build the new chain, connecting nodes in series.
    let currentNode: AudioNode = masterInput;
    // console.log('[useAudioEffects] Starting chain with master input');

    allEffects.forEach((effect, index) => {
      // console.log(`[useAudioEffects] Processing effect ${index}:`, {
      //   enabled: effect.config.enabled,
      //   hasInput: !!effect.inputNode,
      //   hasOutput: !!effect.outputNode,
      //   inputNode: effect.inputNode,
      //   outputNode: effect.outputNode
      // });

      if (effect.config.enabled && effect.inputNode && effect.outputNode) {
        try {
          // Connect the previous node to this effect's input
          currentNode.connect(effect.inputNode);
          // The new current node is this effect's output
          currentNode = effect.outputNode;
        } catch (e) {
          console.error(`[useAudioEffects] Failed to connect effect ${index}:`, e);
          console.error(`[useAudioEffects] Effect ${index} details:`, {
            currentNodeType: currentNode.constructor.name,
            inputNodeType: effect.inputNode?.constructor.name,
            outputNodeType: effect.outputNode?.constructor.name,
            audioContextState: audioContext.state
          });
          throw e; // Don't continue with broken chain
        }
      } else {
        console.log(`[useAudioEffects] Skipping effect ${index} - disabled or missing nodes`);
      } // If disabled, currentNode just passes through to the next iteration.
    });

    // 3. Connect the final node in the chain to the master output.
    try {
      currentNode.connect(masterOutput);
    } catch (e) {
      console.error('[useAudioEffects] Failed to connect to master output:', e);
      console.error('[useAudioEffects] Final node details:', {
        nodeType: currentNode.constructor.name,
        audioContextState: audioContext.state,
        masterOutputType: masterOutput.constructor.name
      });
      throw e;
    }

  }, [
    audioContext,
    masterInput,
    masterOutput,
    eq.isReady, eq.config.enabled,
    stereoExpander.isReady, stereoExpander.config.enabled,
    reverb.isReady, reverb.config.enabled,
    compressor.isReady, compressor.config.enabled,
    // Note: We don't need the nodes themselves in the dependency array because
    // they are stored in refs and never change. This effect only re-runs when
    // readiness or enabled status changes.
  ]);

  return {
    eq,
    compressor,
    reverb,
    stereoExpander,
  };
}
