# Stemset

AI-powered audio stem separation with Google OAuth authentication for secure band practice.

## What It Does

Stemset processes audio recordings locally and separates them into individual instrument stems (vocals, drums, bass, other) using state-of-the-art ML models. It serves a web application with Google authentication where your band members can practice with independent volume control for each stem.

## Features

- **Google OAuth Authentication** - Secure access control with email allowlist
- **Multiple separation strategies** - Configure successive or parallel model pipelines
- **LUFS normalization** - ITU-R BS.1770-4 compliant loudness analysis with per-stem gain control
- **Waveform visualization** - Auto-generated waveforms with perceptual scaling
- **Content-based deduplication** - SHA256 hashing prevents reprocessing renamed files
- **Web playback interface** - Independent volume control with master EQ and limiter
- **Render.com deployment** - Free hosting with persistent storage for media files

## Architecture

- **Backend:** Python/Litestar API with Google OAuth, serves both API and frontend
- **Frontend:** React/TypeScript single-page application with Web Audio API
- **Processing:** Local CLI for stem separation (upload media files to server)
- **Deployment:** Render.com web service with persistent disk for media storage

## Quick Start

### Prerequisites

- **Python 3.13+** with [uv](https://docs.astral.sh/uv/)
- **Node.js** with [bun](https://bun.sh/)
- **ffmpeg** for Opus encoding (`brew install ffmpeg` on macOS)

### Setup

```bash
./setup.sh
```

This installs all Python and frontend dependencies.

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

```bash
# Terminal 1: Run backend (with auth bypass)
export STEMSET_BYPASS_AUTH=true
uv run litestar run --reload

# Terminal 2: Run frontend dev server
cd frontend
bun run dev
```

Visit http://localhost:5173 (frontend proxies API requests to port 8000).

### 3. Deploy to Render.com

**Initial Setup:**

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Render will detect `render.yaml` automatically
6. Set environment variables in Render dashboard:
   - `GOOGLE_CLIENT_ID`: Your OAuth client ID
   - `GOOGLE_CLIENT_SECRET`: Your OAuth client secret
   - `OAUTH_REDIRECT_URI`: `https://your-app-name.onrender.com/auth/callback`
   - `JWT_SECRET`: Random secret (generate with `python -c "import secrets; print(secrets.token_hex(32))"`)
   - Render auto-generates other required vars
7. Click "Create Web Service"

**Deploying Media Files:**

After processing audio locally, upload to Render:

```bash
# Sync media directory to Render persistent disk
rsync -avz --progress media/ your-render-ssh:/ data/media/
```

Alternatively, process audio on Render directly (requires paid plan for sufficient CPU/memory).

**Subsequent Deploys:**

Just push to GitHub - Render auto-deploys on git push.

## Local Development

### Run Backend Only (Production Mode)

```bash
# Build frontend first
cd frontend && bun run build && cd ..

# Run Litestar (serves both API and built frontend)
STEMSET_BYPASS_AUTH=true uv run litestar run
```

Visit http://localhost:8000

### Run with Authentication Locally

```bash
# Set OAuth credentials in .env
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
JWT_SECRET=xxx
STEMSET_BYPASS_AUTH=false

# Update config.yaml redirect_uri to localhost
# Then run:
uv run litestar run
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
# Process audio files
uv run stemset process <profile> [file]

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

**Render.com Free Tier:**
- Web service: Free (spins down after inactivity)
- Persistent disk: Free for first 1GB, then $0.25/GB/month
- Bandwidth: 100GB/month free

For a small band (< 10 members, < 50 tracks), free tier is sufficient.

## License

MIT
