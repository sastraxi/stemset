# Stemset

AI-powered audio stem separation with static site generation for band practice and critical listening.

## What It Does

Stemset processes audio recordings locally and separates them into individual instrument stems (vocals, drums, bass, other) using state-of-the-art ML models. It generates a static website deployed to Cloudflare Pages where your band can practice with independent volume control for each stem.

## Features

- **Multiple separation strategies** - Configure successive or parallel model pipelines
- **LUFS normalization** - ITU-R BS.1770-4 compliant loudness analysis with per-stem gain control
- **Waveform visualization** - Auto-generated waveforms with perceptual scaling
- **Content-based deduplication** - SHA256 hashing prevents reprocessing renamed files
- **Static site generation** - No backend server needed, deploys to Cloudflare Pages CDN
- **Web playback interface** - Independent volume control with master EQ and limiter

## Quick Start

### Prerequisites

- **Python 3.13+** with [uv](https://docs.astral.sh/uv/)
- **Node.js** with [bun](https://bun.sh/)
- **ffmpeg** for Opus encoding (`brew install ffmpeg` on macOS)
- **wrangler** for deployment (`npm install -g wrangler`)

### Setup

```bash
./setup.sh
```

This installs all Python and frontend dependencies.

### Configuration

**1. Create `.env` file (optional):**

```bash
cp .env.example .env
```

Edit `.env` to customize:
- `STEMSET_MODEL_CACHE_DIR` - Where AI models are cached (default: `~/.stemset/models`)
- `TORCH_NUM_THREADS` - Override CPU thread count (default: auto)

**2. Edit `config.yaml` to set up your profiles:**

```yaml
strategies:
  successive:
    _: "vocals_mel_band_roformer.ckpt"
    vocals: vocals
    not_vocals:
      _: "kuielab_b_drums.onnx"
      drums: drums
      not_drums:
        _: "kuielab_a_bass.onnx"
        bass: bass
        not_bass: other

profiles:
  - name: "band-practice"
    source_folder: "/path/to/recordings"
    strategy: "successive"
    output:
      format: "opus"
      bitrate: 192
```

**Output Format Options:**
- `opus` - Highly efficient (192 kbps recommended for music)
- `wav` - Uncompressed PCM (much larger)

## Workflow

### 1. Process New Recordings

```bash
# Scan source folder and process all new files
uv run stemset process band-practice

# Or process a specific file
uv run stemset process band-practice path/to/recording.wav
```

This separates stems, generates waveforms, and computes LUFS metadata.

### 2. Build Static Manifests

```bash
uv run stemset build
```

Generates `media/profiles.json` and `media/{profile}/tracks.json` for the frontend.

### 3. Deploy to Cloudflare Pages

**Option A: Using API Token (for shared accounts)**

```bash
# Get API token from: https://dash.cloudflare.com/profile/api-tokens
# Create token with "Cloudflare Pages - Edit" permissions
export CLOUDFLARE_API_TOKEN=your-token-here

# Deploy (builds frontend + copies media + deploys)
uv run stemset deploy
```

**Option B: Using personal account**

```bash
# First time: login with your Cloudflare account
wrangler login

# Deploy (builds frontend + copies media + deploys)
uv run stemset deploy
```

**Dry run to preview:**
```bash
uv run stemset deploy --dry-run
```

The deploy command automatically:
1. Builds the frontend (`bun run build`)
2. Copies `media/` into `frontend/dist/media/`
3. Deploys `frontend/dist/` to Cloudflare Pages

## Development

### Run Frontend Locally

```bash
cd frontend
bun run dev
```

Opens http://localhost:5173 with hot reload.

### Frontend Development

The frontend serves static files from `./media` during development. Vite is configured to proxy media requests.

To test with production-like paths:
```bash
cd frontend
bun run preview
```

## Project Structure

```
stemset/
├── src/
│   ├── cli.py                 # Typer-based CLI
│   ├── config.py              # Pydantic configuration models
│   ├── scanner.py             # SHA256-based deduplication
│   ├── modern_separator.py    # Separation orchestration
│   ├── models/
│   │   ├── registry.py        # Model registry
│   │   ├── atomic_models.py   # Concrete model implementations
│   │   ├── strategy_executor.py # Strategy tree execution
│   │   ├── metadata.py        # LUFS analysis & waveforms
│   │   └── manifest.py        # Static manifest models
├── frontend/
│   └── src/
│       ├── components/
│       └── App.tsx
├── media/                     # Generated stems (gitignored)
│   ├── profiles.json
│   └── {profile}/
│       ├── tracks.json
│       └── {track}/
│           ├── vocals.opus
│           ├── drums.opus
│           ├── bass.opus
│           ├── other.opus
│           ├── {stem}_waveform.png
│           └── metadata.json
├── docs/
│   ├── goal.md                # Original design prompt
│   └── architecture.md        # Implementation details
└── config.yaml
```

## CLI Commands

```bash
# Process audio files
uv run stemset process <profile> [file]

# Generate static manifests
uv run stemset build

# Deploy to Cloudflare Pages
uv run stemset deploy [--dry-run]

# Help
uv run stemset --help
```

## How It Works

1. **Separation**: Uses ML models (BS-RoFormer, Demucs) via `audio-separator` library
2. **Strategy Trees**: Config defines successive or parallel model pipelines
3. **LUFS Analysis**: Measures integrated loudness per stem using `pyloudnorm`
4. **Waveform Generation**: Creates grayscale PNGs with perceptual scaling
5. **Manifest Generation**: Pydantic models serialize to JSON
6. **Deployment**: Wrangler uploads `media/` to Cloudflare Pages

## Documentation

- [Architecture Details](docs/architecture.md) - Frontend audio implementation, effects chain, future enhancements
- [Original Design](docs/goal.md) - Research and decision log

## Why Static?

- **No server costs** - Cloudflare Pages free tier has unlimited bandwidth
- **Global CDN** - Fast audio delivery worldwide
- **Simple deployment** - Just `wrangler pages deploy media/`
- **Perfect for band use** - Add tracks manually, not constantly streaming

## License

MIT
