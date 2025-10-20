# Stemset

AI-powered audio stem separation with web playback interface for band practice and critical listening.

## Features

- **Profile-based configuration**: Multiple source folders with independent settings
- **BS-RoFormer stem separation**: State-of-the-art AI model for vocals, drums, bass, and other instruments
- **Loudness normalization**: ITU-R BS.1770-4 compliant LUFS normalization with per-stem gain control
- **Duplicate detection**: Content-based hashing prevents reprocessing
- **Web playback interface**: Independent volume control for each stem with synchronized playback

## Setup

### Prerequisites

- [uv](https://docs.astral.sh/uv/) - Fast Python package installer
- [bun](https://bun.sh/) - Fast JavaScript runtime and package manager
- Python 3.10 or higher
- [ffmpeg](https://ffmpeg.org/) - Required for Opus encoding (install via `brew install ffmpeg` on macOS)

### Quick Start

```bash
# Run the setup script
./setup.sh
```

Or manually:

```bash
# Install Python dependencies
uv pip install -e .

# Install frontend dependencies
cd frontend
bun install
cd ..
```

## Configuration

Edit `config.yaml` to set up your profiles:

```yaml
profiles:
  - name: "band-practice"
    source_folder: "/path/to/recordings"
    target_lufs: -23.0
    stem_gains:
      vocals: 0.0
      drums: -2.0
      bass: 1.0
      other: -1.0
    output_format: "opus"  # "opus" or "wav"
    opus_bitrate: 192      # Bitrate in kbps (recommended: 128-256 for music)
```

**Output Format Options:**
- `opus`: Highly efficient compression, 192 kbps gives near-transparent quality for music (recommended)
- `wav`: Uncompressed PCM audio (much larger file sizes)

**Opus Bitrate Guide:**
- 128 kbps: Good quality, smaller files
- 192 kbps: Excellent quality (recommended default)
- 256 kbps: Nearly transparent quality
- 320 kbps: Maximum quality (overkill for most use cases)

## Usage

### 1. Configure your profiles

Edit `config.yaml` and update the `source_folder` path to point to your audio recordings folder:

```yaml
profiles:
  - name: "my-band"
    source_folder: "/path/to/your/recordings"  # Update this!
    target_lufs: -23.0
    stem_gains:
      vocals: 0.0
      drums: -2.0
      bass: 1.0
      other: -1.0
```

### 2. Start the backend

```bash
python -m src.main
```

The backend will start on http://localhost:8000

### 3. Start the frontend (in a new terminal)

```bash
cd frontend
bun run dev
```

The frontend will start on http://localhost:5173

### 4. Use the application

1. Open http://localhost:5173 in your browser
2. Select your profile from the dropdown
3. Click "Scan for New Files" to find and queue audio files for processing
4. Wait for processing to complete (you can see the queue status in the sidebar)
5. Select a processed file from the list
6. Use the player to control individual stem volumes during playback

## Frontend Audio Architecture (React + Web Audio)

The stem player follows a few key patterns that keep the logic predictable and performant:

1. AudioContext as Time Authority: Progress time derives from `audioContext.currentTime - startTimeRef`. No manual timers to advance playback.
2. Persistent AudioContext: We keep a single context instance alive across stem loads to avoid creating nodes against a closed context (removing prior warnings).
3. One-Shot BufferSources: On play / seek we recreate sources starting at an offset; decoded `AudioBuffer`s are cached and never mutated.
4. Playback Generation Token: Each new playback gets a generation number. Old `onended` callbacks and RAF loops ignore updates if their generation is stale—prevents overlapping streams after rapid seeks.
5. Ref Storage for Nodes: `Map` refs hold Gain nodes & sources; state only reflects lightweight UI fields (time, play status, gains) reducing render churn.
6. requestAnimationFrame Loop: Single loop per playback generation updates `currentTime` until completion or invalidation.
7. Seek Semantics: Seek adjusts `pausedAt`; if currently playing we restart sources at the new offset atomically (stopAllSources + startSources) ensuring no double audio.
8. Volume Management: Gain clamped (0–2 UI range) and applied directly; initial gain (metadata dB converted to linear) stored for reset.
9. Cleanup: On file/profile change we tear down stems & sources but keep the context. Full context close only occurs when the hook unmounts (optional extension).

### Master Effects Chain

Below the stem controls the player provides a master processing "island" composed of:

- 5-Band Musical Graphic EQ (Low Shelf 80Hz, Low Mid 250Hz, Mid 1kHz, High Mid 3.5kHz, High Shelf 10kHz)
  - Implemented via `BiquadFilterNode`s in series.
  - Adjustable gain per band (-12dB to +12dB); frequency & Q could be extended later.
  - Persisted in `localStorage` under key `stemset.master.eq.v1`.
- Simple Limiter (Ceiling control 50–100%, enable toggle)
  - Currently a soft ceiling using a final `GainNode` (placeholder for true dynamics processing).
  - Persisted in `localStorage` under key `stemset.master.limiter.v1`.

Routing: Each stem's gain node feeds a master input gain. The chain is Master Gain → EQ Filters (in order) → Limiter Gain → `AudioContext.destination`.

Persistence Strategy: Settings are loaded on hook initialization; updates trigger writes to `localStorage` immediately (no debounce needed due to small payload).

Future Enhancements for Effects:
- True peak limiter / compressor (ScriptProcessor or AudioWorklet with lookahead).
- Adjustable frequencies & Q for bands (turning graphic EQ into parametric EQ).
- Preset management (save/load multiple EQ/limiter profiles).
- Spectrum analyzer visualized with `AnalyserNode` beneath controls.

### Why Not Single Source Pause?
Web Audio lacks a native pause/resume for `AudioBufferSourceNode`; once started it plays through. Recreating sources is the stable, low-complexity strategy when combined with accurate timing from the context.

### Hook API Snapshot

```ts
const {
  isLoading, isPlaying, currentTime, duration, stems,
  play, pause, stop, seek,
  setStemGain, resetStemGain, formatTime,
} = useStemPlayer({ profileName, fileName, stems });
```

## Future Enhancements

- Waveform / spectrogram display synchronized with playback time
- A/B loop region (define start/end loop points)
- Persist user-adjusted stem gains between sessions (localStorage or backend)
- Crossfade on seek to avoid abrupt transitions
- Mute / solo controls per stem
- Peak/RMS metering using an `AnalyserNode`
- Offline rendering for exporting custom mixes
- Optional latency compensation if adding live input monitoring

These can be layered without changing the core timing model.

## Project Structure

```
stemset/
├── src/
│   ├── config.py          # Configuration management
│   ├── scanner.py         # File scanning and hashing
│   ├── separator.py       # BS-RoFormer integration
│   ├── queue.py           # Processing queue
│   └── api.py             # Litestar API
├── frontend/
│   └── src/
│       ├── components/
│       └── App.tsx
├── media/                 # Generated stems (gitignored)
│   └── {profile}/
│       └── {file}/
│           ├── vocals.wav
│           ├── drums.wav
│           ├── bass.wav
│           └── other.wav
└── config.yaml
```
