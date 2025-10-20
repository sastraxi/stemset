# Stemset Architecture

## Overview

Stemset is a static site generator for AI-separated audio stems. It processes audio files locally via CLI, generates static manifests, and deploys to Cloudflare Pages for global CDN delivery.

## Architecture Components

### Backend (Python)

**Processing Pipeline:**
```
Audio File → Stem Separation → LUFS Analysis → Waveform Generation → Static Files
```

**Key Files:**
- `src/modern_separator.py` - Orchestrates separation pipeline
- `src/models/strategy_executor.py` - Executes strategy trees
- `src/models/metadata.py` - LUFS analysis and waveform generation
- `src/scanner.py` - Content-based deduplication via SHA256
- `src/cli.py` - Typer-based CLI commands

### Frontend (React + TypeScript)

**Stack:**
- React 18 with TypeScript
- Vite for bundling
- Web Audio API for playback
- Bun as package manager

**Static Site Structure:**
```
media/
├── profiles.json              # All profiles manifest
├── {profile}/
│   ├── tracks.json            # Profile tracks list
│   └── {track}/
│       ├── vocals.opus
│       ├── drums.opus
│       ├── bass.opus
│       ├── other.opus
│       ├── {stem}_waveform.png
│       └── metadata.json      # Track manifest
```

## Frontend Audio Implementation

The stem player uses Web Audio API with React. Key patterns:

### 1. AudioContext as Time Authority

Progress time derives from `audioContext.currentTime - startTimeRef`. No manual timers to advance playback.

### 2. Persistent AudioContext

We keep a single context instance alive across stem loads to avoid creating nodes against a closed context (removing prior warnings).

### 3. One-Shot BufferSources

On play/seek we recreate sources starting at an offset. Decoded `AudioBuffer`s are cached and never mutated.

### 4. Playback Generation Token

Each new playback gets a generation number. Old `onended` callbacks and RAF loops ignore updates if their generation is stale—prevents overlapping streams after rapid seeks.

### 5. Ref Storage for Nodes

`Map` refs hold Gain nodes & sources. State only reflects lightweight UI fields (time, play status, gains) reducing render churn.

### 6. requestAnimationFrame Loop

Single loop per playback generation updates `currentTime` until completion or invalidation.

### 7. Seek Semantics

Seek adjusts `pausedAt`. If currently playing we restart sources at the new offset atomically (stopAllSources + startSources) ensuring no double audio.

### 8. Volume Management

Gain clamped (0–2 UI range) and applied directly. Initial gain (metadata dB converted to linear) stored for reset.

### 9. Cleanup

On file/profile change we tear down stems & sources but keep the context. Full context close only occurs when the hook unmounts.

### Master Effects Chain

Below the stem controls the player provides a master processing "island":

**5-Band Musical Graphic EQ:**
- Low Shelf 80Hz, Low Mid 250Hz, Mid 1kHz, High Mid 3.5kHz, High Shelf 10kHz
- Implemented via `BiquadFilterNode`s in series
- Adjustable gain per band (-12dB to +12dB)
- Persisted in `localStorage` under key `stemset.master.eq.v1`

**Simple Limiter:**
- Ceiling control 50–100%, enable toggle
- Currently a soft ceiling using a final `GainNode` (placeholder for true dynamics processing)
- Persisted in `localStorage` under key `stemset.master.limiter.v1`

**Routing:**
```
Each Stem → Gain Node → Master Input Gain → EQ Filters → Limiter Gain → destination
```

**Persistence:** Settings are loaded on hook initialization. Updates trigger writes to `localStorage` immediately (no debounce needed due to small payload).

### Why Not Single Source Pause?

Web Audio lacks a native pause/resume for `AudioBufferSourceNode`. Once started it plays through. Recreating sources is the stable, low-complexity strategy when combined with accurate timing from the context.

### Hook API

```typescript
const {
  isLoading, isPlaying, currentTime, duration, stems,
  play, pause, stop, seek,
  setStemGain, resetStemGain, formatTime,
} = useStemPlayer({ profileName, fileName, stems });
```

## Deployment Architecture

### Local Processing
```bash
uv run stemset process h4n          # Process new files
uv run stemset build                # Generate manifests
```

### Cloudflare Pages Deployment
```bash
uv run stemset deploy               # Wraps: wrangler pages deploy media/
```

**Why Cloudflare Pages:**
- Unlimited bandwidth (free tier)
- Unlimited static requests (free tier)
- Global CDN
- No server maintenance
- Simple deployment workflow

## Future Enhancements

### Frontend
- Waveform/spectrogram display synchronized with playback time
- A/B loop region (define start/end loop points)
- Crossfade on seek to avoid abrupt transitions
- Mute/solo controls per stem
- Peak/RMS metering using `AnalyserNode`
- Offline rendering for exporting custom mixes
- Optional latency compensation if adding live input monitoring

### Effects
- True peak limiter/compressor (ScriptProcessor or AudioWorklet with lookahead)
- Adjustable frequencies & Q for bands (turning graphic EQ into parametric EQ)
- Preset management (save/load multiple EQ/limiter profiles)
- Spectrum analyzer visualized with `AnalyserNode` beneath controls

### Backend
- Watch mode for automatic processing
- Multi-profile batch processing
- Strategy presets library
- Progress tracking for long-running separations
