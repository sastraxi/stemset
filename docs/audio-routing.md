# STEMSET AUDIO GRAPH - COMPLETE WIRING DIAGRAM

```
[AUDIO SOURCES]
┌─────────────────┬─────────────────┬─────────────────┐
│  Stem 1 Buffer  │  Stem 2 Buffer  │  Stem N Buffer  │
└────────┬────────┴────────┬────────┴────────┬────────┘
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────────────────────────────────────────┐
│         Per-Stem GainNodes (useStemAudioNodes)   │
│  gainNode(user volume) → outputGainNode(routing) │
└──────────────────────────────────────────────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                            ▼
                    ┌────────────────┐
                    │  masterInput   │ (GainNode - entry point)
                    └────────┬───────┘
                            │
        ┌────────────────────────────────────────────┐
        │   EFFECTS CHAIN (useAudioEffects)          │
        │   Dynamic wiring based on enabled state    │
        └────────────────────────────────────────────┘
                            │
                    ┌────────▼──────────┐
                    │   EQ Effect       │ (useEqEffect)
                    │ 5x BiquadFilter   │
                    │ [low, lowmid,     │
                    │  mid, highmid,    │
                    │  high]            │
                    └────────┬──────────┘
                            │
                    ┌────────▼──────────────────┐
                    │  Stereo Expander Effect   │ (useStereoExpanderEffect)
                    │  AudioWorkletNode         │ [DISABLED - FIXME]
                    │  multiband-stereo-expand  │
                    └────────┬──────────────────┘
                            │
                    ┌────────▼──────────────────┐
                    │  Reverb Effect            │ (useReverbEffect)
                    │                           │
                    │  inputNode (Gain)         │
                    │    ├─→ dryGain ────────┐  │
                    │    │   └→ outputNode   │  │
                    │    └─→ ConvolverNode   │  │
                    │        (impulse)       │  │
                    │        └→ wetGain ─────┤  │
                    │                        │  │
                    │  wetGain + dryGain ────┘  │
                    └────────┬──────────────────┘
                            │
                    ┌────────▼──────────────────────┐
                    │  Compressor/Limiter Effect    │ (useCompressorEffect)
                    │  AudioWorkletNode             │
                    │  master-limiter-processor     │
                    │  (brick-wall limiter)         │
                    │  • 50ms lookahead buffer      │
                    │  • Attack/Hold/Release        │
                    │  • Auto makeup gain           │
                    │  • Gain reduction metering    │
                    └────────┬──────────────────────┘
                            │
                    ┌────────▼──────────────┐
                    │   masterOutput        │ (GainNode - master volume)
                    └────────┬──────────────┘
                            │
                    ┌────────▼──────────────┐
                    │ AudioContext.dest     │
                    │ (speakers/output)     │
                    └───────────────────────┘
```

# HOOKS DEPENDENCY TREE

```
useStemPlayer (orchestrator)
│
├─ useAudioContext
│  └─ Creates: AudioContext, masterInput, masterOutput
│  └─ Manages: master volume (localStorage)
│
├─ useAudioLoader
│  └─ Loads: audio buffers from API
│  └─ Decodes: compressed audio → raw PCM
│
├─ useStemAudioNodes
│  └─ Creates: per-stem gainNode + outputGainNode pairs
│
├─ useAudioEffects (ORCHESTRATOR)
│  │
│  ├─ useEqEffect
│  │  └─ Creates: 5x BiquadFilterNode chain
│  │  └─ Manages: frequency, gain, Q per band
│  │
│  ├─ useStereoExpanderEffect
│  │  └─ Loads: /multiband-stereo-expander.js worklet
│  │  └─ Parameters: crossovers, expansion, compression (DISABLED)
│  │
│  ├─ useReverbEffect
│  │  └─ Creates: ConvolverNode + wet/dry gain nodes
│  │  └─ Loads: impulse response WAV file
│  │
│  └─ useCompressorEffect
│     └─ Loads: /limiter-processor.js worklet
│     └─ Parameters: threshold, attack, hold, release, makeup gain
│     └─ Metering: gain reduction via MessagePort
│
└─ useConfigPersistence (per effect + per stem)
    └─ eq config
    └─ compressor config
    └─ reverb config
    └─ stereoExpander config
    └─ stems config (volume, mute, solo)
    └─ playbackPosition config
```

# CONFIGURATION STRUCTURE - RecordingUserConfig

```
RecordingUserConfig
├─ playbackPosition: number          (current time in seconds)
│
├─ stems: Record<string, StemUserConfig>
│  └─ StemUserConfig
│     ├─ gain: number                (0-2, user-adjusted volume)
│     ├─ muted: boolean              (mute state)
│     └─ soloed: boolean             (solo state)
│
└─ effects: EffectsChainConfig
    ├─ eq: EqConfig
    │  ├─ bands: EqBand[] (5 bands)
    │  │  └─ EqBand: {id, frequency, type, gain, q}
    │  └─ enabled: boolean
    │
    ├─ compressor: CompressorConfig
    │  ├─ threshold: number            (-48 to 0 dB)
    │  ├─ attack: number               (0.001 to 0.05 seconds)
    │  ├─ hold: number                 (0.001 to 0.1 seconds)
    │  ├─ release: number              (0.01 to 1.0 seconds)
    │  └─ enabled: boolean
    │
    ├─ reverb: ReverbConfig
    │  ├─ impulse: ImpulseName         ('sparkling-hall', etc - 14 total)
    │  ├─ mix: number                  (0 to 1, wet/dry)
    │  └─ enabled: boolean
    │
    └─ stereoExpander: StereoExpanderConfig
        ├─ lowMidCrossover: number      (50 to 2000 Hz)
        ├─ midHighCrossover: number     (800 to 12000 Hz)
        ├─ expLow: number               (0.5 to 2.0)
        ├─ compLow: number              (0 to 1)
        ├─ expMid: number               (0.5 to 2.0)
        ├─ compMid: number              (0 to 1)
        ├─ expHigh: number              (0.5 to 2.0)
        ├─ compHigh: number             (0 to 1)
        └─ enabled: boolean
```

[COMPONENT HIERARCHY - StemPlayer Component Tree]

```
StemPlayer
├─ VCRDisplay                    (transport controls, waveform)
├─ MobileVolumeControl          (mobile-specific volume)
├─ InteractivePanel             (collapsible effect panels)
│  ├─ EqPanel
│  │  └─ 5 frequency/gain/Q sliders
│  │
│  ├─ CompressorPanel
│  │  ├─ threshold slider
│  │  ├─ attack slider
│  │  ├─ hold slider
│  │  ├─ release slider
│  │  └─ gain reduction meter
│  │
│  ├─ ReverbPanel
│  │  ├─ impulse selector dropdown
│  │  └─ mix slider (wet/dry)
│  │
│  └─ StereoExpanderPanel
│     ├─ crossover sliders
│     └─ expansion/compression sliders (disabled)
│
└─ MasterVolumeControl
    └─ master volume slider
```

# PERSISTENCE & SYNC

All configs persist via:
useConfigPersistence → API PATCH /api/recordings/{recordingId}/config
                    → React Query cache update
                    → Automatic multi-tab sync via invalidateQueries


[REAL-TIME DATA FLOW - User Changes EQ Band]

User moves EQ gain slider
    ↓
EqPanel.tsx onChange callback
    ↓
useStemPlayer.updateEqBand(id, {gain})
    ↓
useEqEffect.setConfig()
    ↓
useConfigPersistence.setConfig()
    ↓
[500ms debounce timer starts]
    ↓
useEqEffect useEffect watches config.bands
    ↓
BiquadFilterNode.gain.setTargetAtTime()
    ↓
[Audio immediately changes in browser]
    ↓
[500ms passes...]
    ↓
useConfigPersistence sends PATCH to API
    ↓
React Query updates cache
    ↓
Configuration persisted to database

# FILE LOCATIONS QUICK REFERENCE

Core Audio Hooks:
* /Users/cam/dev/stemset/frontend/src/hooks/useAudioContext.ts
* /Users/cam/dev/stemset/frontend/src/hooks/useStemAudioNodes.ts
* /Users/cam/dev/stemset/frontend/src/hooks/useAudioEffects.ts
* /Users/cam/dev/stemset/frontend/src/hooks/useStemPlayer.ts
* /Users/cam/dev/stemset/frontend/src/hooks/* useConfigPersistence.ts

Effect Hooks:
/Users/cam/dev/stemset/frontend/src/hooks/effects/useEqEffect.ts
/Users/cam/dev/stemset/frontend/src/hooks/effects/useCompressorEffect.ts
/Users/cam/dev/stemset/frontend/src/hooks/effects/useReverbEffect.ts
/Users/cam/dev/stemset/frontend/src/hooks/effects/useStereoExpanderEffect.ts

Effect UI Components:
    /Users/cam/dev/stemset/frontend/src/components/effects/EqPanel.tsx
    /Users/cam/dev/stemset/frontend/src/components/effects/CompressorPanel.tsx
    /Users/cam/dev/stemset/frontend/src/components/effects/ReverbPanel.tsx
    /Users/cam/dev/stemset/frontend/src/components/effects/StereoExpanderPanel.tsx
    /Users/cam/dev/stemset/frontend/src/components/effects/MasterVolumeControl.tsx

AudioWorklet Processors:
    /Users/cam/dev/stemset/frontend/public/limiter-processor.js
    /Users/cam/dev/stemset/frontend/public/multiband-stereo-expander.js

Types:
    /Users/cam/dev/stemset/frontend/src/types.ts

Main Player:
    /Users/cam/dev/stemset/frontend/src/components/StemPlayer.tsx
