# StemPlayer Refactor - Solution

## The Bug

When switching from Recording A to Recording B, effects configs from Recording A were overwriting Recording B's saved configs. This happened because:

1. Effects initialized once with Recording A's config
2. When switching to Recording B, `isLoading` transitions triggered saves
3. Effects never reloaded Recording B's config - they kept stale Recording A config
4. Recording A's stale config was saved to Recording B's localStorage

## Root Cause

**Violation of React principles**: Hooks were returning getter functions instead of direct state.

```typescript
// ❌ OLD - Anti-pattern
const { getCurrentEffectsConfig } = useAudioEffects(...);
useEffect(() => {
  const config = getCurrentEffectsConfig(); // Stale closure!
  saveConfig(config);
}, [isLoading]);
```

The `getCurrentEffectsConfig` function closes over stale effect state and never re-reads fresh config when recording changes.

## The Solution

### 1. Eliminate All Getter Functions

**New principle**: Hooks return primitive state values or stable callbacks, never getter functions.

```typescript
// ✅ NEW - Proper React
const { config } = useEqEffect(...);
useEffect(() => {
  saveConfig(config); // Fresh value every render!
}, [config, isLoading]);
```

### 2. Simplify Architecture

**Old (complex)**:
- `useStemManager` mixed audio graph + UI state + actions
- State buried in refs
- Getter functions everywhere

**New (simple)**:
- `useStemAudioNodes` - Pure audio graph (gain nodes only)
- Stem state is plain React state in `useStemPlayer`
- Audio nodes **react** to state changes via `useEffect`

```typescript
// Stem state lives at top level
const [stems, setStems] = useState<Record<string, StemState>>({});

// Audio nodes react to state
useEffect(() => {
  stemNodes.forEach((node, name) => {
    node.gainNode.gain.value = stems[name].gain;
  });
}, [stems, stemNodes]);
```

### 3. Force Remount on Recording Change

Add a `key` prop to `StemPlayer` component:

```typescript
<StemPlayer
  key={`${profileName}::${fileName}`}
  profileName={profileName}
  fileName={fileName}
  metadataUrl={metadataUrl}
/>
```

When `key` changes, React completely unmounts and remounts the component with fresh state. This ensures:
- Effects initialize with the NEW recording's saved config
- No stale state persists between recordings
- Clean slate for every recording switch

## New File Structure

```
hooks/
├── useRecordingMetadata.ts      # NEW: Fetches static metadata
├── useRecordingConfig.ts        # NEW: localStorage persistence
├── useStemAudioNodes.ts         # NEW: Pure audio graph
├── useStemPlayer-new.ts         # NEW: Orchestration with direct state
├── useAudioEffects.ts           # REFACTORED: No getCurrentEffectsConfig()
├── usePlaybackController.ts     # REFACTORED: Takes stems directly, no getLoadedStems()
├── effects/
│   ├── useEqEffect.ts           # REFACTORED: settings → config
│   ├── useCompressorEffect.ts   # REFACTORED: settings → config
│   ├── useReverbEffect.ts       # REFACTORED: settings → config
│   └── useStereoExpanderEffect.ts # REFACTORED: settings → config
└── [DELETE]
    ├── useSettings.ts           # DELETE: Replaced by useRecordingConfig
    └── useStemManager.ts        # DELETE: Split into useStemAudioNodes + state in useStemPlayer
```

## Key Insights

1. **SSOT (Single Source of Truth)**: State lives in one place, flows down
2. **Dependency Tree**: Callbacks go down, state changes trigger re-renders
3. **Never Return Functions**: Return primitives and stable callbacks only
4. **Reactive Audio**: Audio nodes react to state via `useEffect`, not imperative updates

## Testing the Fix

1. Load Recording A, adjust EQ/reverb/stems
2. Switch to Recording B (should load B's saved config, not A's)
3. Verify B has its own config
4. Switch back to A (should restore A's config)
5. Configs never cross-contaminate

## Migration Checklist

- [x] Rename Settings → Config in all effect hooks
- [x] Create useRecordingMetadata for static data
- [x] Create useRecordingConfig for mutable state
- [x] Create useStemAudioNodes for audio graph
- [x] Refactor useAudioEffects to remove getCurrentEffectsConfig
- [x] Refactor usePlaybackController to take stems directly
- [x] Create new useStemPlayer with direct state
- [ ] Add key prop to StemPlayer component
- [ ] Update StemPlayer.tsx to use new hook
- [ ] Update effect panels to use 'config' prop
- [ ] Test recording switching
- [ ] Delete old files
