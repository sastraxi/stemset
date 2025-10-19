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
python -m backend.main
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

## Project Structure

```
stemset/
├── backend/
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
