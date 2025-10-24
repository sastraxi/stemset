# Stemset

AI-powered audio stem separation with Google OAuth authentication for secure band practice.

## What It Does

Stemset processes audio recordings locally and separates them into individual instrument stems (vocals, drums, bass, other) using state-of-the-art ML models. It serves a web application with Google authentication where your band members can practice with independent volume control for each stem.

## Features

- **Google OAuth Authentication** - Secure access control with email allowlist
- **Multiple separation strategies** - Configure successive or parallel model pipelines
- **On-Demand GPU Processing** - Optional remote processing using Koyeb scale-to-zero GPU instances
- **LUFS normalization** - ITU-R BS.1770-4 compliant loudness analysis with per-stem gain control
- **Waveform visualization** - Auto-generated waveforms with perceptual scaling
- **Content-based deduplication** - SHA256 hashing prevents reprocessing renamed files
- **Web playback interface** - Independent volume control with master EQ and limiter
- **Flexible deployment** - Free hosting options with Cloudflare Pages + Koyeb + R2

## Architecture

- **Backend:** Python/Litestar API with Google OAuth
- **Frontend:** React/TypeScript single-page application with Web Audio API
- **Storage:** Local filesystem or Cloudflare R2 (zero egress fees!)
- **Processing:** Local CLI (CPU/GPU) or remote GPU worker (Koyeb scale-to-zero)
- **Deployment:** Hybrid cloud (Cloudflare Pages + Koyeb + R2) or traditional (Render)

### On-Demand GPU Processing (Default when configured)

Stemset can use Koyeb's scale-to-zero GPU instances for fast processing:

- **Auto-detects GPU availability** - Uses GPU if `GPU_WORKER_URL` is set, otherwise processes locally
- **Pay only for processing time** - ~$0.0007 per 5-second job (99% idle = ~$2/month)
- **Works everywhere** - CLI uploads to R2, processes on GPU, results available in web UI
- **Web upload support** - Drag-and-drop files directly in the web interface
- **Force local** - Use `--local` flag to override GPU and process locally

**Configuration:**

```yaml
gpu_worker_url: ${GPU_WORKER_URL}  # Optional: set to enable GPU processing

profiles:
  - name: "h4n"
    strategy: "hdemucs_mmi"
```

**Behavior:**
- `GPU_WORKER_URL` set → uses GPU worker automatically
- `GPU_WORKER_URL` not set → processes locally
- `--local` flag → always processes locally (even if GPU_WORKER_URL is set)

See [docs/gpu-worker-deployment.md](docs/gpu-worker-deployment.md) for deployment guide and cost optimization.

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

## Quick Start

### Prerequisites

- **Python 3.13+** with [uv](https://docs.astral.sh/uv/)
- **Node.js** with [bun](https://bun.sh/)
- **ffmpeg** for Opus encoding (`brew install ffmpeg` on macOS)

### Setup

```bash
./setup.sh
```

This installs:
- **API dependencies** (lightweight - Litestar, Pydantic, boto3, etc.)
- **Processing dependencies** (heavy ML libraries - audio-separator, onnxruntime, etc.)
- **Frontend dependencies** (React, Vite, etc.)

**Note**: Koyeb API deployment only installs API dependencies (~100MB), not processing dependencies (~2GB+). If using remote GPU processing, the GPU worker service installs full processing dependencies with CUDA support.

### Configuration

**1. Create `.env` file:**

```bash
cp .env.example .env
```

For local development, `.env` should have:
```bash
STEMSET_BYPASS_AUTH=true  # Skip authentication locally
STEMSET_MODEL_CACHE_DIR=~/.stemset/models
```

**2. Set up Google OAuth (for production):**

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select existing
3. Configure the OAuth consent screen:
   - Go to "OAuth consent screen" in the left menu
   - Select "External" user type
   - Fill in App name, User support email, and Developer contact
   - Add scopes: `email`, `profile`, `openid`
   - Add test users (your band members' Gmail addresses)
4. Create OAuth 2.0 Client ID:
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: Web application
   - Add authorized redirect URIs:
     - `http://localhost:8000/auth/callback` (for local testing with auth)
     - `https://your-app.onrender.com/auth/callback` (for production)
5. Copy the Client ID and Client Secret

**3. Add credentials to `.env` file:**

```bash
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
OAUTH_REDIRECT_URI=http://localhost:8000/auth/callback
JWT_SECRET=$(python -c "import secrets; print(secrets.token_hex(32))")
STEMSET_BYPASS_AUTH=false  # Enable auth
```

**4. Edit `config.yaml`:**

```yaml
# Authentication configuration
auth:
  allowed_emails:
    - bandmember1@gmail.com
    - bandmember2@gmail.com
  google_client_id: ${GOOGLE_CLIENT_ID}
  google_client_secret: ${GOOGLE_CLIENT_SECRET}
  jwt_secret: ${JWT_SECRET}
  redirect_uri: ${OAUTH_REDIRECT_URI}

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
    source_folder: "/path/to/local/recordings"
    strategy: "successive"
    output:
      format: "opus"
      bitrate: 192
```

**Configure R2 storage and GPU worker (optional - enables GPU processing):**

```yaml
r2:
  account_id: ${R2_ACCOUNT_ID}
  access_key_id: ${R2_ACCESS_KEY_ID}
  secret_access_key: ${R2_SECRET_ACCESS_KEY}
  bucket_name: stemset-media
  public_url: ${R2_PUBLIC_URL}  # Optional

gpu_worker_url: ${GPU_WORKER_URL}  # Optional: enables GPU processing
```

If `gpu_worker_url` is not set, processing happens locally on your machine.

## Workflow

### 1. Process Audio Locally

```bash
# Process all new files in source folder
uv run stemset process band-practice

# Or process a specific file
uv run stemset process band-practice path/to/recording.wav
```

This separates stems, generates waveforms, and computes LUFS metadata. Output goes to `media/band-practice/`.

### 2. Run Locally for Development

We run the servers separately to allow for hot reload of both backend and frontend code.

```bash
# Terminal 1: Run backend (with auth bypass)
export STEMSET_BYPASS_AUTH=true
./dev.sh

# Terminal 2: Run frontend dev server
cd frontend
bun run dev
```

Visit http://localhost:5173 (frontend proxies API requests to port 8000).

> **Note:** The `dev.sh` script is shorthand for `uv run litestar --app src.api.app:app run --reload`

### 3. Deploy to Production

**Recommended: Cloudflare + Koyeb + R2 (FREE)**

The recommended deployment uses a hybrid cloud architecture for zero-cost hosting:

```bash
# Check configuration
python scripts/check_deployment.py

# Follow deployment guide
# See DEPLOYMENT.md for complete step-by-step instructions
```

- **Frontend**: Cloudflare Pages (unlimited bandwidth, global CDN)
- **Backend API**: Koyeb (free tier, no spin-down)
- **Audio Storage**: Cloudflare R2 (10GB free, zero egress fees!)

**Benefits over traditional hosting:**
- ✅ $0/month (vs $7+/month for alternatives)
- ✅ Zero egress fees for audio streaming
- ✅ Global CDN for faster loading
- ✅ No cold starts

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment guide.
See [MIGRATION_SUMMARY.md](MIGRATION_SUMMARY.md) for migration from Render.

**Alternative: Render.com (Traditional)**

If you prefer a single-server deployment, see the Render configuration in `render.yaml`.
Note: Free tier doesn't support persistent disks; requires paid plan (~$7/month).

## Local Development

### Run Backend Only (Production Mode)

```bash
# Build frontend first
cd frontend && bun run build && cd ..

# Run Litestar (serves both API and built frontend)
STEMSET_BYPASS_AUTH=true uv run litestar --app src.api.app:app run
```

Visit http://localhost:8000

### Run with Authentication Locally

```bash
# Set OAuth credentials in .env
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
OAUTH_REDIRECT_URI=http://localhost:8000/auth/callback
JWT_SECRET=xxx
STEMSET_BYPASS_AUTH=false

# Then run:
./dev.sh
```

## Project Structure

```
stemset/
├── src/
│   ├── auth.py                # Google OAuth + JWT auth
│   ├── api.py                 # Litestar API (serves frontend too)
│   ├── config.py              # Pydantic configuration with env vars
│   ├── cli.py                 # Typer-based CLI
│   ├── scanner.py             # SHA256-based deduplication
│   ├── modern_separator.py    # Separation orchestration
│   └── models/
│       ├── registry.py        # Model registry
│       ├── atomic_models.py   # Concrete model implementations
│       ├── strategy_executor.py # Strategy tree execution
│       └── metadata.py        # LUFS analysis & waveforms
├── frontend/
│   └── src/
│       ├── contexts/
│       │   └── AuthContext.tsx  # Auth state management
│       ├── components/
│       │   ├── LoginPage.tsx    # Google OAuth login UI
│       │   └── StemPlayer.tsx   # Audio player
│       └── App.tsx
├── media/                     # Generated stems (gitignored, upload to Render)
│   └── {profile}/
│       └── {track}/
│           ├── vocals.opus
│           ├── drums.opus
│           ├── bass.opus
│           ├── other.opus
│           ├── {stem}_waveform.png
│           └── metadata.json
├── render.yaml                # Render.com deployment config
└── config.yaml                # Strategy and profile configuration
```

## CLI Commands

```bash
# Process audio files (auto-detects GPU vs local based on GPU_WORKER_URL)
uv run stemset process <profile> [file]

# Process all new files (uses GPU if configured, otherwise local)
uv run stemset process band-practice

# Force local processing (even if GPU is configured)
uv run stemset process band-practice --local

# Process a specific file
uv run stemset process band-practice path/to/recording.wav

# Process a specific file locally
uv run stemset process band-practice path/to/recording.wav --local

# Note: Local processing (--local) automatically uploads results to R2 if configured

# Help
uv run stemset --help
```

## How It Works

1. **Separation**: Uses ML models (BS-RoFormer, Demucs, etc.) via `audio-separator`
2. **Strategy Trees**: Config defines successive or parallel model pipelines
3. **LUFS Analysis**: Measures integrated loudness per stem using `pyloudnorm`
4. **Waveform Generation**: Creates grayscale PNGs with perceptual scaling
5. **Authentication**: Google OAuth with JWT tokens, email allowlist in config
6. **Deployment**: Render builds frontend + backend, serves as single app

## Security

- **Google OAuth:** Only allowlisted emails can log in
- **JWT Tokens:** 30-day expiration, httpOnly cookies
- **No Database:** User allowlist in `config.yaml`, validated on every request
- **Auth Bypass:** Available for local dev only (environment variable)

## Deployment Costs

**Recommended (Cloudflare + Koyeb + R2):**
- **$0-2/month** for most use cases
- Cloudflare Pages: Unlimited bandwidth (free)
- Koyeb API: 100GB bandwidth/month (free tier)
- Koyeb GPU Worker: Scale-to-zero A100 GPU (~$0.0007/job, ~$2/month for 100 jobs/day)
- R2 Storage: 10GB + zero egress fees (free tier)
- Scales cost-effectively as you grow

**GPU Processing Costs (Optional):**
- GPU processing (when configured): ~$0.50/hour when active, $0 when sleeping
- Example: 100 five-second jobs/day = ~$2/month
- Local processing (default or --local flag): $0/month (uses your CPU/GPU)

**Alternative (Render.com):**
- Free tier: Spins down after 15min, no persistent disk
- Paid tier: ~$7/month + storage costs
- Bandwidth: 100GB included, then $0.10/GB
- No GPU support

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed cost comparison.
See [docs/gpu-worker-deployment.md](docs/gpu-worker-deployment.md) for GPU worker setup.

## License

MIT
