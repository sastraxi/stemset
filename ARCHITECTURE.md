# Stemset Architecture

## Overview

Stemset uses a **hybrid cloud architecture** optimized for cost and performance:

```
┌─────────────────────────────────────────────────────────────┐
│                         Users                                │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌─────────────────┐            ┌──────────────────┐
│  Static Assets  │            │   API Requests   │
│ (HTML/CSS/JS)   │            │  (Profiles/Auth) │
└────────┬────────┘            └────────┬─────────┘
         │                               │
         ▼                               ▼
┌─────────────────┐            ┌──────────────────┐
│ Cloudflare Pages│            │  Koyeb (API)     │
│  (Frontend)     │            │  Litestar/Python │
│  FREE           │────────────│  FREE TIER       │
└─────────────────┘   CORS     └────────┬─────────┘
                                        │
                           ┌────────────┴────────────┐
                           ▼                         ▼
                  ┌─────────────────┐     ┌──────────────────┐
                  │  Cloudflare R2  │     │  Local Storage   │
                  │  (Audio Files)  │     │  (Development)   │
                  │  FREE (10GB)    │     │                  │
                  └─────────────────┘     └──────────────────┘
```

## Components

### 1. Frontend (Cloudflare Pages)

**Location**: `frontend/`

**Technology**: React + TypeScript + Vite + Bun

**Features**:
- Global CDN (300+ edge locations)
- Unlimited bandwidth (free!)
- Automatic HTTPS
- Git-based deployments
- Environment variables for API URL

**Serves**:
- Static HTML/CSS/JS bundles
- No server-side rendering needed

**Configuration**:
- `frontend/wrangler.toml` - Cloudflare Pages config
- `frontend/.env.example` - Environment variable template

### 2. Backend API (Koyeb)

**Location**: `src/api/`

**Technology**: Python 3.13 + Litestar + Uvicorn

**Features**:
- 512MB RAM, 0.1 vCPU (free tier)
- 100GB bandwidth/month
- Automatic HTTPS
- Buildpack auto-detection
- No cold starts (always running)

**Responsibilities**:
- Google OAuth authentication
- Profile management API
- Serve metadata endpoints
- Generate presigned R2 URLs (or redirect to public URLs)

**Configuration**:
- `.koyeb/config.yaml` - Koyeb deployment config
- `config.yaml` - Application configuration
- `.env` - Environment variables (local dev)

### 3. Audio Storage (Cloudflare R2)

**Technology**: S3-compatible object storage

**Features**:
- 10GB free storage
- **Zero egress fees** (unlimited downloads!)
- 1M write operations/month
- 10M read operations/month
- Optional public access

**File Structure**:
```
bucket/
  profile-name/
    song-name/
      vocals.opus
      drums.opus
      bass.opus
      other.opus
      vocals_waveform.png
      drums_waveform.png
      bass_waveform.png
      other_waveform.png
```

**Access Modes**:
1. **Public bucket**: Direct URLs (faster, less secure)
2. **Private bucket**: Presigned URLs via API (secure, 1-hour expiry)

**Configuration**:
- R2 credentials in `config.yaml` (via environment variables)
- Boto3 SDK for uploads/access

### 4. Processing Pipeline (Local)

**Location**: `src/cli/`, `src/models/`

**Technology**: Python + Audio Separator + ML models

**Runs**:
- Locally on your machine (CPU/GPU intensive)
- NOT deployed to cloud

**Process**:
1. `uv run stemset process <profile>` - Separate audio stems
2. Outputs saved to `media/<profile>/`
3. Upload to R2 using `scripts/upload_to_r2.py` or AWS CLI

**Why Local?**:
- ML model separation is CPU/GPU intensive
- Would exceed free tier compute quickly
- Better to process locally, upload results

## Data Flow

### Processing Audio (Local)

```
1. User runs: uv run stemset process h4n
2. CLI reads source files from configured folder
3. Stems separated using ML models (vocals, drums, bass, other)
4. LUFS normalization analysis
5. Outputs saved to media/h4n/song-name/
6. User uploads to R2: python scripts/upload_to_r2.py h4n
```

### Serving Audio (Production)

```
1. User visits https://stemset.pages.dev
2. Frontend loads from Cloudflare Pages CDN
3. User clicks "Sign in with Google"
4. Frontend → Koyeb API → Google OAuth
5. Backend sets httpOnly JWT cookie
6. Frontend requests: GET /api/profiles
7. Koyeb returns profile list
8. Frontend requests: GET /api/profiles/h4n/files
9. Koyeb returns file list with R2 URLs
10. Frontend loads audio directly from R2 (zero egress fees!)
11. Web Audio API plays stems with independent volume controls
```

### Authentication Flow

```
1. User → Frontend: Click "Sign in"
2. Frontend → Backend: Redirect to /auth/login
3. Backend → Google: OAuth request
4. Google → Backend: OAuth callback with code
5. Backend → Google: Exchange code for user info
6. Backend: Verify email in allowlist
7. Backend: Create JWT token
8. Backend → Frontend: Set httpOnly cookie + redirect
9. Frontend: All requests include JWT cookie
10. Backend: Validate JWT on every API request
```

## Storage Abstraction

The backend uses a storage abstraction layer (`src/storage.py`) that supports both:

### Local Storage (Development)

```python
storage = LocalStorage()
url = storage.get_file_url("h4n", "song", "vocals", ".opus")
# Returns: "/media/h4n/song/vocals.opus"
```

- Files served from `media/` directory
- Static file router in Litestar
- No cloud dependencies

### R2 Storage (Production)

```python
storage = R2Storage(config.r2)
url = storage.get_file_url("h4n", "song", "vocals", ".opus")
# Returns: "https://pub-xxxxx.r2.dev/h4n/song/vocals.opus"
# OR: "https://r2.cloudflare.../...?X-Amz-Signature=..." (presigned)
```

- Files served from Cloudflare R2
- Presigned URLs or public URLs
- Zero egress fees

**Switching**: Set `r2` section in `config.yaml` to enable R2.

## Cost Analysis

### Current Architecture (FREE)

| Component | Cost | Limit |
|-----------|------|-------|
| Cloudflare Pages | $0 | Unlimited bandwidth |
| Koyeb API | $0 | 100GB bandwidth/month |
| Cloudflare R2 | $0 | 10GB storage, zero egress |
| **Total** | **$0/month** | |

### If You Exceed Free Tier

| Component | Overage Cost | When |
|-----------|--------------|------|
| Pages | Still $0 | Unlimited for personal use |
| Koyeb | Contact support | If >100GB bandwidth/month |
| R2 Storage | $0.015/GB/month | After 10GB |
| R2 Operations | $4.50/1M writes | After 1M/month |
| R2 Egress | **$0** | Always free! |

### Alternative: Render (OLD)

| Component | Cost | Notes |
|-----------|------|-------|
| Render Web Service | $0 (free tier) | Spins down after 15min |
| Render Persistent Disk | **NOT AVAILABLE** | Free tier doesn't support |
| Render Paid Tier | ~$7/month | Required for disk |
| Bandwidth | 100GB included | $0.10/GB after |
| **Total** | **$7+/month** | + bandwidth overages |

**Savings**: ~$84/year by switching to Cloudflare + Koyeb!

## Development vs Production

### Local Development

```bash
# Terminal 1: Backend
./dev.sh

# Terminal 2: Frontend
cd frontend && bun run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Vite proxies `/api` to backend
- Auth can be bypassed with `STEMSET_BYPASS_AUTH=true`
- Storage: Local filesystem (`media/`)

### Production

- Frontend: `https://stemset.pages.dev`
- Backend: `https://stemset-api.koyeb.app`
- CORS configured for cross-origin requests
- Auth required (Google OAuth)
- Storage: Cloudflare R2

## Environment Variables

### Backend (.env)

```bash
# Development
STEMSET_BYPASS_AUTH=true
FRONTEND_URL=http://localhost:5173
OAUTH_REDIRECT_URI=http://localhost:8000/auth/callback

# Production (set in Koyeb dashboard)
STEMSET_BYPASS_AUTH=false
FRONTEND_URL=https://stemset.pages.dev
OAUTH_REDIRECT_URI=https://stemset-api.koyeb.app/auth/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=stemset-media
R2_PUBLIC_URL=...  # Optional
```

### Frontend (.env)

```bash
# Development - leave empty (proxied)
VITE_API_URL=

# Production (set in Cloudflare Pages)
VITE_API_URL=https://stemset-api.koyeb.app
```

## Deployment Workflow

1. **Process audio locally**: `uv run stemset process <profile>`
2. **Upload to R2**: `python scripts/upload_to_r2.py <profile>`
3. **Update backend**: `git push` → Koyeb auto-deploys
4. **Update frontend**: `git push` → Cloudflare Pages auto-deploys
5. **Test**: Visit frontend URL, sign in, play audio

## Security

- **Authentication**: Google OAuth with email allowlist
- **JWT tokens**: httpOnly cookies (XSS protection)
- **CORS**: Configured for specific origins only
- **R2 access**: Private bucket with presigned URLs (or public if configured)
- **No API keys in frontend**: All R2 access goes through backend

## Monitoring

- **Koyeb**: Built-in metrics, logs, health checks
- **Cloudflare Pages**: Build logs, deployment history
- **R2**: Usage dashboard, operation metrics

## Scaling

- **Frontend**: Auto-scales globally (CDN)
- **Backend**: Free tier is 1 instance, paid tier supports auto-scaling
- **Storage**: R2 scales infinitely (pay per GB after 10GB)

## Future Improvements

1. **Automatic R2 sync**: Watch `media/` folder, auto-upload new files
2. **CDN caching**: Add cache headers for R2 files
3. **Custom domains**: Use your own domain instead of `.pages.dev`
4. **Background workers**: Offload processing to cloud workers
5. **Database**: Add Postgres for user preferences, playlists
6. **Observability**: Add Sentry, Datadog, or similar
