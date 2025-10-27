# StemPlayer Architecture - Type System & Data Flow

## Overview

This document describes the complete type architecture for the StemPlayer system after the refactor to eliminate type duplication and establish clear separation of concerns between server metadata, user preferences, and UI state.

## Design Principles

### 1. Clear Separation of Concerns
- **Server Metadata**: Immutable data from the backend API
- **User Configuration**: Mutable preferences stored in localStorage
- **Audio Layer**: Web Audio API nodes and buffers
- **View Models**: UI-layer types that combine metadata + config

### 2. No Tight Coupling
The architecture allows you to use any layer independently:
- Build metadata-only views (e.g., waveform gallery)
- Export/import user settings without metadata
- Create headless audio players without UI state
- Build full players that combine everything

### 3. Single Source of Truth
- Each piece of data lives in exactly one place
- No duplicate state across types
- No getter functions that can become stale
- Direct state values flow through props

## Type System Architecture

### Layer 1: Server Metadata (Immutable)

Located in: `frontend/src/types.ts`

```typescript
// API response types
export interface Profile {
  name: string;
  source_folder: string;
}

export interface StemFile {
  name: string;
  metadata_url: string;
}

export interface StemFileWithDisplayName extends StemFile {
  displayName: string;
}

export interface StemMetadata {
  stem_type: string;
  measured_lufs: number | null;
  peak_amplitude: number;
  stem_gain_adjustment_db: number;  // Used to compute initialGain
  stem_url: string;
  waveform_url: string;
}

export interface StemsMetadata {
  stems: Record<string, StemMetadata>;
  display_name: string;
}
```

**Source**: Backend API (read-only)
**Used by**: `useAudioLoader` to fetch and parse recording metadata

### Layer 2: Audio Layer (Web Audio API)

Located in: `frontend/src/types.ts`

```typescript
// Audio data loaded from network
export interface StemAudioData {
  buffer: AudioBuffer;
  metadata: StemMetadata;  // Always present after successful load
}

// Audio graph nodes (Web Audio API)
export interface StemAudioNode {
  buffer: AudioBuffer;
  gainNode: GainNode;        // Volume control
  outputGainNode: GainNode;  // Mute/solo control
  initialGain: number;       // Computed from metadata.stem_gain_adjustment_db
}
```

**Source**: Created by hooks from StemMetadata
**Used by**:
- `useAudioLoader` → Returns `Map<string, StemAudioData>`
- `useStemAudioNodes` → Converts to `Map<string, StemAudioNode>`
- `usePlaybackController` → Plays audio using nodes

### Layer 3: User Configuration (Mutable, localStorage)

Located in: `frontend/src/types.ts`

```typescript
// Per-stem user settings
export interface StemUserConfig {
  gain: number;      // Volume slider value (0-2)
  muted: boolean;    // Mute button state
  soloed: boolean;   // Solo button state
}

// Effects chain configuration
// Future: Will support reordering via `order: string[]` field
export interface EffectsChainConfig {
  eq: EqConfig;
  compressor: CompressorConfig;
  reverb: ReverbConfig;
  stereoExpander: StereoExpanderConfig;
  // Future: order: Array<'eq' | 'compressor' | 'reverb' | 'stereoExpander'>;
}

// Complete per-recording user preferences
export interface RecordingUserConfig {
  playbackPosition: number;
  stems: Record<string, StemUserConfig>;  // Per-stem configs
  effects: EffectsChainConfig;            // Master effects chain
}
```

**Source**: localStorage (managed by `useRecordingConfig`)
**Used by**: `useStemPlayer` to initialize and persist user preferences

**Effect Config Types**: Defined in respective effect hooks:
- `EqConfig` in `useEqEffect.ts`
- `CompressorConfig` in `useCompressorEffect.ts`
- `ReverbConfig` in `useReverbEffect.ts`
- `StereoExpanderConfig` in `useStereoExpanderEffect.ts`

### Layer 4: View Models (UI Layer)

Located in: `frontend/src/types.ts`

```typescript
// Everything the UI needs for one stem (merged from metadata + user config)
export interface StemViewModel {
  // Identity
  name: string;

  // From metadata (immutable)
  stemType: string;
  waveformUrl: string;
  initialGain: number;

  // From user config (mutable)
  gain: number;
  muted: boolean;
  soloed: boolean;
}
```

**Source**: Created by `useStemPlayer` by merging metadata + user config
**Used by**: UI components (`StemPlayer.tsx`) for rendering

## Data Flow Architecture

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. LOADING PHASE                                                    │
└─────────────────────────────────────────────────────────────────────┘

API (metadata.json)
    ↓
useAudioLoader
    ↓ Map<string, StemAudioData>
    │   { buffer: AudioBuffer, metadata: StemMetadata }
    ↓
useStemAudioNodes
    ↓ Map<string, StemAudioNode>
    │   { buffer, gainNode, outputGainNode, initialGain }
    ↓
[Ready for playback]


┌─────────────────────────────────────────────────────────────────────┐
│ 2. INITIALIZATION PHASE                                             │
└─────────────────────────────────────────────────────────────────────┘

localStorage
    ↓
useRecordingConfig.getConfig()
    ↓ RecordingUserConfig
    │   { playbackPosition, stems: {...}, effects: {...} }
    ↓
useStemPlayer (merges with audio data)
    ↓ Record<string, StemViewModel>
    │   { name, stemType, waveformUrl, initialGain, gain, muted, soloed }
    ↓
StemPlayer component (renders UI)


┌─────────────────────────────────────────────────────────────────────┐
│ 3. PLAYBACK PHASE                                                   │
└─────────────────────────────────────────────────────────────────────┘

usePlaybackController
    ← Map<string, StemAudioNode> (directly from useStemAudioNodes)
    ↓
Creates BufferSourceNodes
    ↓
Connects to gainNode → outputGainNode → masterInput
    ↓
Audio plays through Web Audio graph


┌─────────────────────────────────────────────────────────────────────┐
│ 4. USER INTERACTION PHASE                                           │
└─────────────────────────────────────────────────────────────────────┘

User adjusts volume slider
    ↓
StemPlayer.tsx calls setStemGain()
    ↓
useStemPlayer updates StemViewModel.gain
    ↓
useEffect applies to StemAudioNode.gainNode.gain.value
    ↓
useEffect persists to localStorage via saveStemConfigs()
```

## Key Architectural Decisions

### 1. Eliminated `LoadedStem` Type
**Problem**: `LoadedStem` duplicated fields from `StemAudioNode` with inconsistent naming (`gain` vs `gainNode`) and mixed UI state (`muted`, `soloed`) with audio node data.

**Solution**: `usePlaybackController` now accepts `Map<string, StemAudioNode>` directly. No intermediate conversion needed.

**Before**:
```typescript
const loadedStemsForPlayback = useMemo(() => {
  const map = new Map();
  stemNodes.forEach((node, name) => {
    map.set(name, {
      buffer: node.buffer,           // Copying...
      gain: node.gainNode,            // Renaming...
      outputGain: node.outputGainNode,
      initialGain: node.initialGain,
      metadata: null,                 // Unused!
      muted: stems[name]?.muted,      // Duplicate state!
      soloed: stems[name]?.soloed,    // Duplicate state!
    });
  });
  return map;
}, [stemNodes, stems]);
```

**After**:
```typescript
const { isPlaying, currentTime, play, pause, stop, seek, formatTime } = usePlaybackController({
  audioContext,
  duration,
  stemNodes,  // Pass directly!
});
```

### 2. Renamed Types for Clarity
- `LoadedStemData` → `StemAudioData` (emphasizes it's audio data)
- `StemState` → `StemViewModel` (emphasizes it's a UI view model)
- Individual effect configs grouped into `EffectsChainConfig`

### 3. Structured Effects Configuration
**Before**: Flat structure in RecordingConfig
```typescript
interface RecordingConfig {
  playbackPosition: number;
  stemGains: Record<string, number>;
  stemMutes: Record<string, boolean>;
  stemSolos: Record<string, boolean>;
  eqConfig?: EqConfig;
  compressorConfig?: CompressorConfig;
  reverbConfig?: ReverbConfig;
  stereoExpanderConfig?: StereoExpanderConfig;
}
```

**After**: Nested structure ready for reordering
```typescript
interface RecordingUserConfig {
  playbackPosition: number;
  stems: Record<string, StemUserConfig>;
  effects: EffectsChainConfig;  // Can add `order` field later
}
```

### 4. Fixed Metadata Type Safety
**Before**: `metadata: StemMetadata | null` (could be null)
**After**: `metadata: StemMetadata` (guaranteed present after load)

This eliminates unnecessary null checks throughout the codebase.

## Hook Responsibilities

### `useAudioLoader`
- Fetches `StemsMetadata` from API
- Loads audio buffers in parallel
- **Returns**: `Map<string, StemAudioData>`
- **Does NOT**: Manage user config or create audio nodes

### `useStemAudioNodes`
- Creates Web Audio API nodes
- Calculates `initialGain` from `metadata.stem_gain_adjustment_db`
- Connects gain nodes to master input
- **Returns**: `Map<string, StemAudioNode>`
- **Does NOT**: Apply volume/mute state (purely audio graph)

### `useRecordingConfig`
- Loads/saves user config from localStorage
- Provides defaults for missing configs
- Debounces writes to prevent excessive localStorage access
- **Returns**: `getConfig()`, `savePlaybackPosition()`, `saveStemConfigs()`, `saveEffectsConfig()`
- **Does NOT**: Know about audio nodes or metadata

### `useStemPlayer` (Orchestrator)
- Combines all layers into view models
- Manages stem state (volume, mute, solo)
- Applies state to audio nodes reactively
- Persists changes to localStorage
- **Returns**: `stems: Record<string, StemViewModel>` + controls + effects
- **Responsibility**: Merge metadata + user config → view models

### `usePlaybackController`
- Manages playback timing and BufferSourceNode lifecycle
- **Accepts**: `Map<string, StemAudioNode>` (no UI state!)
- **Returns**: Playback controls (play, pause, stop, seek)
- **Does NOT**: Know about mute/solo logic (handled by gain nodes)

### `useAudioEffects`
- Creates and manages effect nodes
- Connects effects in chain
- **Returns**: Individual effect configs and controls
- **Future**: Will respect `EffectsChainConfig.order` for reordering

## Use Cases Enabled by This Architecture

### 1. Metadata-Only Waveform Gallery
```typescript
function WaveformGallery({ metadata }: { metadata: StemsMetadata }) {
  return Object.entries(metadata.stems).map(([name, stem]) => (
    <img
      key={name}
      src={stem.waveform_url}
      alt={`${stem.stem_type} waveform`}
    />
  ));
}
```
**No localStorage, no audio nodes, just metadata.**

### 2. User Settings Export/Import
```typescript
function exportUserSettings(profile: string, file: string): RecordingUserConfig {
  return getRecordingState(profile, file);
}

function importUserSettings(config: RecordingUserConfig, profile: string, file: string) {
  setRecordingState(profile, file, config);
}
```
**No metadata needed, pure user preferences.**

### 3. Headless Audio Player
```typescript
function HeadlessPlayer({ metadata }: { metadata: StemsMetadata }) {
  const audioContext = useAudioContext();
  const { stems } = useAudioLoader({ metadata, audioContext });
  const { stemNodes } = useStemAudioNodes({ audioContext, stems });
  const { play, pause } = usePlaybackController({ audioContext, stemNodes });

  return <button onClick={play}>Play</button>;
}
```
**No localStorage, no UI state, pure audio.**

### 4. Full StemPlayer (Current Implementation)
Combines all layers: metadata → audio → user config → view models → UI

## Future: Reorderable Effects Chain

The `EffectsChainConfig` is designed to support effect reordering:

```typescript
export interface EffectsChainConfig {
  effects: {
    eq: EqConfig;
    compressor: CompressorConfig;
    reverb: ReverbConfig;
    stereoExpander: StereoExpanderConfig;
  };
  order: Array<'eq' | 'compressor' | 'reverb' | 'stereoExpander'>;
}
```

Implementation in `useAudioEffects`:
```typescript
// Build effect chain dynamically based on order
let previousNode = masterInput;
config.order.forEach(effectId => {
  const effectNode = getEffectNode(effectId);
  previousNode.connect(effectNode);
  previousNode = effectNode;
});
```

## File Organization

```
frontend/src/
├── types.ts                          # All types in one file (organized by layer)
├── hooks/
│   ├── useAudioLoader.ts            # Layer 1 → 2: Metadata → Audio data
│   ├── useStemAudioNodes.ts         # Layer 2 → Audio nodes
│   ├── useRecordingConfig.ts        # Layer 3: User config (localStorage)
│   ├── useStemPlayer.ts             # Layer 2+3 → 4: Orchestrator (view models)
│   ├── usePlaybackController.ts     # Playback using audio nodes
│   ├── useAudioEffects.ts           # Effects chain management
│   └── effects/
│       ├── index.ts                 # Barrel export with defaults
│       ├── useEqEffect.ts           # + DEFAULT_EQ_CONFIG
│       ├── useCompressorEffect.ts   # + DEFAULT_COMPRESSOR_CONFIG
│       ├── useReverbEffect.ts       # + DEFAULT_REVERB_CONFIG
│       └── useStereoExpanderEffect.ts # + DEFAULT_STEREO_EXPANDER_CONFIG
├── components/
│   └── StemPlayer.tsx               # UI layer (uses view models)
└── lib/
    └── storage.ts                   # localStorage wrapper (RecordingUserConfig)
```

## Testing Checklist

To verify the architecture works correctly:

- [x] ✅ Build succeeds with no TypeScript errors
- [ ] ⏳ Load a recording and verify metadata displays correctly
- [ ] ⏳ Adjust stem volumes and verify they persist to localStorage
- [ ] ⏳ Toggle mute/solo and verify audio behavior
- [ ] ⏳ Adjust effects and verify they persist
- [ ] ⏳ Switch recordings and verify configs don't cross-contaminate
- [ ] ⏳ Refresh page and verify all settings restore correctly
- [ ] ⏳ Clear localStorage and verify defaults load properly

## Migration Notes

### Breaking Changes
None for end users. localStorage keys changed structure but old data is handled gracefully with defaults.

### For Developers
- **Removed type**: `LoadedStem` (replaced by direct use of `StemAudioNode`)
- **Renamed types**: Better semantic naming throughout
- **No getter functions**: All hooks return direct state values
- **Effects config**: Now nested under `effects` object instead of flat

### localStorage Migration
Old format data is automatically handled:
- Missing `stems` field → defaults to `{}`
- Missing `effects` field → defaults to effect defaults
- Old flat structure → converted to nested structure on read

## Summary

This architecture achieves:

1. ✅ **Zero type duplication** - Each concept has exactly one type
2. ✅ **Clear separation** - Metadata, user config, and audio are independent
3. ✅ **No tight coupling** - Can use any layer independently
4. ✅ **Type safety** - No `unknown`, no `| null` where not needed
5. ✅ **Future-proof** - Ready for effect reordering
6. ✅ **Maintainable** - Single source of truth for all data

The refactor eliminated ~15 lines of duplicate type definitions, removed an unnecessary `useMemo`, and established clear boundaries between concerns.
