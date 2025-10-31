# Stemset Development Guide

## What This Is

Stemset is an AI-powered audio stem separation application with Google OAuth authentication:
1. **Backend**: Python/Litestar service that serves stems via authenticated REST API and hosts the frontend
2. **Frontend**: React/TypeScript web player with Google OAuth for secure access and independent stem volume controls
3. **Processing**: Audio separation can run either:
   - **Locally**: `uv run stemset process <profile>` (default)
   - **Remotely**: On-demand Modal serverless GPU functions (pay-per-second, no idle charges)
   - Processed stems stored in R2 and optionally downloaded to local `media/`

## Core Principles

### Fail Fast
We do not catch exceptions to provide fallbacks. If something fails, we want to know immediately. No `try/except` blocks unless absolutely necessary for resource cleanup.

### Modern Python
- Use Python 3.13+ features: `from __future__ import annotations`, type unions with `|`, no `Optional`
- Type everything. No `Any` unless interfacing with untyped third-party code. Check with `basedpyright`
- Pydantic for all data models, configuration, and serialization
- `uv` for package management, not pip

### Clean Architecture Layers

**Unidirectional dependencies only.** Higher layers can import from lower layers, never the reverse.

```
Configuration (config.py)
    ↓
Registry (models/registry.py)
    ↓
Base Abstractions (models/audio_separator_base.py)
    ↓
Concrete Models (models/atomic_models.py)
    ↓
Executors (models/strategy_executor.py)
    ↓
Public Interface (modern_separator.py)
    ↓
API (api.py)
```

Use `TYPE_CHECKING` imports only when necessary to break circular dependencies at the lowest possible layer.

## How We Structure Code

### Separation Models

All audio separation models inherit from `AudioSeparator` ABC which defines:
- `output_slots: dict[str, str]` - What this model produces (e.g., `{"vocals": "Vocal track", "not_vocals": "Instrumental"}`)
- `model_filename: str` - Which model file to load
- `separate(input_file, output_dir) -> dict[str, Path]` - Performs separation

We use `AudioSeparatorLibraryModel` as the base for models using the `audio-separator` library, so concrete models only need to define `output_slots` and `model_filename`.

### Strategy Trees

Strategies are defined in `config.yaml` as recursive trees:
```yaml
successive:
  _: "vocals_mel_band_roformer.ckpt"  # Model to use
  vocals: vocals                       # Final output
  not_vocals:                          # Feed into next model
    _: "kuielab_b_drums.onnx"
    drums: drums
    not_drums:
      _: "kuielab_a_bass.onnx"
      bass: bass
      not_bass: other
```

The `_` key specifies which model to use. Other keys map that model's output slots to either:
- **String values**: Final stem names (leaf nodes)
- **Dict values**: Subtrees that process that output further

**Validation**: At execution time, we verify output slots in the config match what the model actually produces. Config errors fail immediately with clear messages.

**Intermediate Processing**: All intermediate files use lossless WAV format. Only final outputs use the user's configured format (Opus, WAV, etc.).

### Metadata

We use Pydantic models for all metadata:
```python
class StemMetadata(BaseModel):
    stem_type: str
    measured_lufs: float

class StemsMetadata(BaseModel):
    stems: dict[str, StemMetadata]

    def to_file(self, path: Path) -> None: ...
    @classmethod
    def from_file(cls, path: Path) -> StemsMetadata: ...
```

After separation, we:
1. Compute LUFS for each final stem using `pyloudnorm`
2. Create `StemsMetadata` model
3. Write to `metadata.json` using Pydantic serialization

The frontend reads this same typed structure.

### Configuration

All configuration uses Pydantic models in `config.py`:
- `AuthConfig` - Google OAuth credentials and email allowlist
- `R2Config` - Cloudflare R2 storage credentials (optional, required for remote processing)
- `OutputConfig` - Format and bitrate settings
- `StrategyNode` - Recursive tree node (model + output mappings)
- `Strategy` - Named strategy with validation
- `Profile` - User profile linking source folder to strategy, with optional `remote: bool` flag
- `Config` - Top-level config with strategies, profiles, optional auth, R2, and `gpu_worker_url`

**Environment Variable Substitution**: Config supports `${VAR_NAME}` syntax for secrets:
```yaml
auth:
  google_client_id: ${GOOGLE_CLIENT_ID}
  jwt_secret: ${JWT_SECRET}
```

**Remote Processing**: Enable GPU processing per profile:
```yaml
gpu_worker_url: ${GPU_WORKER_URL}  # Modal endpoint
profiles:
  - name: "h4n"
    remote: true  # Use Modal GPU worker instead of local processing
    strategy: "hdemucs_mmi"
```

**Fail-Fast Validation**: On startup, we scan the config for all `${VAR_NAME}` references and validate they're set in the environment. Missing variables cause immediate failure with a clear error message listing what's needed.

We load and validate the entire config at startup using `dotenv` to load `.env` files. Invalid configs fail immediately with clear error messages.

### API Responses

Every API endpoint returns a Pydantic model. We never return raw dicts from endpoints:
```python
class ProfileResponse(BaseModel):
    name: str
    source_folder: str

@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    ...
```

Litestar integrates natively with Pydantic for request/response serialization.

We use `NotFoundException` instead of returning error response objects with status codes.

## Database Architecture

### PostgreSQL with SQLModel

Stemset uses PostgreSQL for persistent metadata storage, replacing the previous JSON file-based approach. This provides better queryability, referential integrity, and multi-user support.

**Core Principles**:
- **Async-first**: All database operations use `asyncpg` driver with `AsyncSession`
- **Type-safe**: SQLModel (Pydantic + SQLAlchemy) provides full type safety
- **UUIDv4 primary keys**: Distributed scalability, no auto-increment
- **Fail-fast**: Critical fields like `duration_seconds` are NOT NULL
- **Denormalized**: Profile ID duplicated across tables for query performance

### Database Schema

```
users                    profiles                 audio_files
├── id (UUID, PK)       ├── id (UUID, PK)       ├── id (UUID, PK)
├── email (unique)      ├── name (unique)       ├── profile_id (FK)
├── name                ├── source_folder       ├── filename
├── picture_url         ├── strategy_name       ├── file_hash (unique, SHA256)
├── created_at          ├── created_at          ├── storage_url
└── last_login_at       └── users (M:M)         ├── file_size_bytes
                                                 ├── duration_seconds (NOT NULL)
                                                 └── uploaded_at

recordings               stems
├── id (UUID, PK)       ├── id (UUID, PK)
├── profile_id (FK)     ├── recording_id (FK)
├── output_name         ├── audio_file_id (FK)
├── display_name        ├── stem_type
├── created_at          ├── measured_lufs
├── updated_at          ├── peak_amplitude
└── stems (1:M)         ├── stem_gain_adjustment_db
                        ├── audio_url (relative)
                        ├── waveform_url (relative)
                        ├── file_size_bytes
                        ├── duration_seconds (NOT NULL)
                        └── created_at
```

**Key Relationships**:
- `User ↔ Profile`: Many-to-many via `user_profiles` join table
- `Profile → AudioFile`: One-to-many (all source files for a profile)
- `Profile → Recording`: One-to-many (all processed outputs for a profile)
- `Recording → Stem`: One-to-many (all stems for a recording)
- `AudioFile → Stem`: One-to-many (tracks which source file each stem came from)

### Database Operations

**CLI Processing Flow**:
1. Scanner queries `audio_files` by hash to check if already processed
2. After successful separation, processor creates:
   - `Profile` record (if not exists)
   - `AudioFile` record with SHA256 hash
   - `Recording` record with output folder name
   - `Stem` records for each separated track

**API Query Patterns**:
```python
# Get recordings with stems (use selectinload to avoid N+1)
stmt = (
    select(Recording)
    .where(Recording.profile_id == profile.id)
    .options(selectinload(Recording.stems))
    .order_by(Recording.created_at.desc())
)
result = await session.exec(stmt)
```

**Auth Integration**:
- OAuth login upserts `User` record and updates `last_login_at`
- Future: User-profile access control via `user_profiles` join table

### Database Configuration

**Connection Management**:
- Lazy engine initialization in `src/db/config.py`
- Connection pooling: 10 base + 20 overflow
- Lifespan management in Litestar app (init on startup, dispose on shutdown)

**Environment Variables**:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/stemset
```

**Migrations** (Alembic):
```bash
# Apply migrations
alembic upgrade head

# Create new migration after model changes
alembic revision --autogenerate -m "Description"
```

**Local Development**:
```bash
# Start PostgreSQL with Docker Compose
docker compose up -d

# Run migrations
alembic upgrade head

# Migrate existing JSON files to database
uv run stemset migrate
```

### Transition State

**Current Implementation**:
- ✅ Database writes: All processing results saved to PostgreSQL
- ✅ Database reads: API queries database for recordings/stems
- ✅ Hash tracking: Scanner uses database instead of `.processed_hashes.json`
- ⚠️ JSON files: Still written for backward compatibility during transition

**Rollback Plan**:
- JSON files preserved in `media/<profile>/<output_name>/metadata.json`
- Database and JSON coexist (dual writes)
- Can revert to JSON-only by reverting code changes
- No data loss during transition period

### Performance Optimizations

- **Indexes**: All foreign keys indexed, unique constraints on `file_hash` and `email`
- **Connection pooling**: Reuses database connections across requests
- **Lazy loading disabled**: Explicit `selectinload()` or `joinedload()` required
- **Query optimization**: N+1 prevention with eager loading

### Future Enhancements

- Activity logging table for user actions
- Processing job persistence (survive server restarts)
- OAuth session persistence
- User preferences table
- Song entity (many recordings → one song for different takes)
- Tags/labels for recordings
- Playlists and sharing

## File Organization

```
src/
├── auth.py                # Google OAuth, JWT tokens, auth middleware
├── config.py              # Pydantic config models, YAML loading, env var substitution
├── storage.py             # Storage abstraction (local filesystem or Cloudflare R2)
├── modern_separator.py    # Public separation interface
├── cli/                   # CLI module
│   ├── __init__.py        # Main CLI entrypoint (Typer app)
│   ├── scanner.py         # File scanning via database hash queries
│   ├── processor.py       # Audio processing with database writes
│   ├── remote_processor.py # Remote GPU processing implementation
│   └── db_migrate.py      # CLI command to migrate JSON → PostgreSQL
├── db/                    # Database layer
│   ├── config.py          # Async engine, connection pooling, session management
│   └── models.py          # SQLModel definitions (User, Profile, Recording, Stem, etc.)
├── api/                   # API module
│   ├── app.py             # Litestar app with database lifespan
│   ├── models.py          # Pydantic response models
│   ├── auth_routes.py     # OAuth endpoints with User upserts
│   ├── profile_routes.py  # Profile and file endpoints querying database
│   └── job_routes.py      # Job callbacks and processing triggers
├── processor/          # Modal serverless GPU worker
│   ├── worker.py             # Modal function with R2 mount and GPU processing
│   └── __init__.py
├── gpu_worker/            # Shared models (used by CLI, API, and Modal worker)
│   ├── models.py          # Job payload and result models (ProcessingJob, ProcessingResult)
│   └── __init__.py
└── models/
    ├── registry.py        # Frozen MODEL_REGISTRY mapping names to classes
    ├── audio_separator_base.py  # AudioSeparator ABC
    ├── atomic_models.py   # Concrete model implementations
    ├── strategy_executor.py     # Tree execution engine
    └── metadata.py        # Pydantic metadata models + LUFS analysis

alembic/                   # Database migrations
├── env.py                 # Async migration environment
└── versions/              # Migration files
    └── 001_initial_schema.py

frontend/
└── src/
    ├── contexts/
    │   └── AuthContext.tsx  # React context for OAuth state management
    ├── components/
    │   ├── LoginPage.tsx    # Google OAuth login UI
    │   └── StemPlayer.tsx   # Web Audio API player
    └── api.ts              # Fetch wrappers with credentials: 'include'

scripts/
├── upload_to_r2.py        # Helper script for uploading media files to R2
└── check_deployment.py    # Deployment configuration checker

docs/
├── modal-deployment.md    # Modal GPU worker deployment guide
└── postgresql-migration.md # Database migration implementation summary
```

## What We Don't Do

- **No backwards compatibility layers**: We delete old code when we refactor. No `separator.py` alongside `modern_separator.py`.
- **No validation in multiple places**: Validate once at the boundary (config load, API input). Trust validated data downstream.
- **No YAML/JSON by hand**: Use Pydantic's `model_dump_json()` and `model_validate_json()`.
- **No print debugging**: Use proper logging levels when needed. Print statements for user-facing progress only.
- **No magic**: Explicit is better than implicit. No metaclasses, no dynamic imports, no `__getattr__` tricks.

## Dependencies We Use

### Python (Backend)
- **`audio-separator`**: Core ML separation, handles model loading and PyTorch
- **`pyloudnorm`**: LUFS measurement per ITU-R BS.1770-4
- **`soundfile`**: Audio I/O, supports Opus via system libsndfile
- **`Litestar`**: Modern async web framework with excellent Pydantic integration
- **`pydantic`**: Data validation, serialization, configuration
- **`python-dotenv`**: Load `.env` files for environment variables
- **`PyJWT`**: JWT token generation and validation for authentication
- **`httpx`**: Async HTTP client for Google OAuth token exchange
- **`typer`**: CLI framework for audio processing commands
- **`watchdog`**: File system monitoring (for future auto-scanning)
- **`boto3`**: S3-compatible client for Cloudflare R2 storage
- **`sqlmodel`**: Type-safe ORM combining Pydantic and SQLAlchemy
- **`asyncpg`**: Async PostgreSQL driver
- **`alembic`**: Database migration tool
- **`psycopg2-binary`**: PostgreSQL adapter (required by alembic)
- **`greenlet`**: Coroutine support for SQLAlchemy

### TypeScript/JavaScript (Frontend)
- **React 18**: UI framework
- **TypeScript**: Type safety
- **Vite**: Fast dev server with HMR, proxies `/api`, `/auth`, `/media` to backend
- **Bun**: Package manager and bundler

## Testing Philosophy

When testing, create actual files, run actual separation, verify actual outputs. No mocks for core business logic.

Test configuration loading with real YAML files. Test strategy execution with real (small) audio files.

## Performance Considerations

**Thread Limiting**: We limit PyTorch to `(cpu_count - 2)` threads in `AudioSeparator._get_separator()` to keep the system responsive during separation.

**Sequential Processing**: One separation job at a time. Audio separation is CPU/GPU intensive; parallelism doesn't help.

**Temporary Files**: Strategy executor creates a temp directory, executes the tree, moves finals to destination, cleans up intermediates. No manual cleanup needed.

**Content Hashing**: Scanner uses SHA256 of file contents to detect duplicates regardless of filename changes (recording devices rename files).

## Evolution

This codebase values clarity over cleverness. When adding features:
1. Add the Pydantic model first
2. Add it to the config if needed
3. Implement the core logic with proper types
4. Wire it through the API with Pydantic responses
5. Delete any code made obsolete by the change

We refactor aggressively. If a pattern emerges three times, abstract it. If an abstraction is only used once, inline it.

## Authentication Architecture

### Google OAuth Flow

**Development (localhost:5173 → localhost:8000)**:
1. User clicks "Sign in with Google" → Frontend redirects to `/auth/login`
2. Vite proxies to backend `localhost:8000/auth/login`
3. Backend redirects to Google with `redirect_uri=http://localhost:8000/auth/callback`
4. Google redirects back to `localhost:8000/auth/callback` (direct, not proxied)
5. Backend validates, creates JWT, sets cookie with `domain="localhost"` (works across all ports!)
6. Backend redirects to `FRONTEND_URL` (http://localhost:5173)
7. Frontend makes `/auth/status` request with cookie
8. Vite proxies to backend, cookie sent because `domain="localhost"`

**Production (split frontend/backend on Cloudflare + Koyeb)**:
1. User clicks "Sign in with Google" → Frontend redirects to backend `/auth/login`
2. Backend redirects to Google with `redirect_uri=https://stemset-api.koyeb.app/auth/callback`
3. Google redirects back to backend `/auth/callback`
4. Backend validates, creates JWT, sets httpOnly cookie with `secure=True`, `SameSite=None`
5. Backend redirects to `FRONTEND_URL` (https://stemset.pages.dev)
6. Frontend makes API requests to backend with `credentials: 'include'`
7. Browser sends cookie with cross-origin requests (due to CORS configuration)

### Key Implementation Details

**Cookie Settings**:
- Development: `domain="localhost"`, `secure=False` (allows cross-port on localhost)
- Production: `domain=None`, `secure=True`, `SameSite=None` (httpOnly cookie for cross-origin)

**Auth Middleware** (`auth.py`):
- Bypasses all `/auth/*` routes (allows login/callback without token)
- Validates JWT on all other routes
- Checks email against allowlist in `config.yaml`
- Environment variable `STEMSET_BYPASS_AUTH=true` disables auth for local dev

**Special Case - `/auth/status`**:
- Allowed through middleware without auth (to check if user is logged in)
- Manually validates JWT token from cookie and returns auth status
- Used by frontend to determine whether to show login page or app

### Environment Variables

**Development `.env`**:
```bash
STEMSET_BYPASS_AUTH=true  # Or false to test OAuth locally
STEMSET_SYNC=true  # Sync local media/ with R2 before/after processing (default: true)
OAUTH_REDIRECT_URI=http://localhost:8000/auth/callback
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
R2_ACCOUNT_ID=...  # For upload script
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=stemset-media
R2_PUBLIC_URL=...  # Optional
```

**Production (Cloudflare + Koyeb)**:

Backend (Koyeb):
```bash
STEMSET_BYPASS_AUTH=false
STEMSET_SYNC=false  # No local sync in production - R2 only
BACKEND_URL=https://stemset-api.koyeb.app  # For Modal GPU worker callbacks
OAUTH_REDIRECT_URI=https://stemset-api.koyeb.app/auth/callback
FRONTEND_URL=https://stemset.pages.dev
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
GPU_WORKER_URL=https://sastraxi--stemset-gpu-process.modal.run
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=stemset-media
R2_PUBLIC_URL=...  # Optional
```

Frontend (Cloudflare Pages - set in `wrangler.toml`):
```toml
[vars]
VITE_API_URL = "https://stemset-api.koyeb.app"  # No /api or /auth suffix
```

Note: Frontend code adds `/api` and `/auth` prefixes as needed. Don't include them in `VITE_API_URL`.

### Build Optimization (Monorepo)

Both Cloudflare Pages and Koyeb support path-based build triggers to avoid unnecessary deployments:

**Cloudflare Pages** (frontend):
- Watches: `frontend/**` (configured in dashboard)
- Changes to backend code won't trigger frontend rebuilds

**Koyeb** (backend):
- Watches: `src/`, `Dockerfile`, `pyproject.toml`, etc. (configured in `.koyeb/config.yaml`)
- Changes to frontend code won't trigger backend rebuilds

This means you can push frontend and backend changes independently without rebuilding everything!

### Development Workflow

**Two-server development** (recommended):
```bash
# Terminal 1: Backend with auto-reload
./dev.sh

# Terminal 2: Frontend with HMR
cd frontend && bun run dev
```

Visit `http://localhost:5173` - Vite proxies `/api`, `/auth`, `/media` to `:8000`.

**Single-server development** (production-like):
```bash
cd frontend && bun run build && cd ..
./dev.sh
```

Visit `http://localhost:8000` - Backend serves both API and static frontend.

### Deployment (Hybrid Cloud - Recommended)

**Architecture**: Split frontend, backend, storage, and GPU processing across optimized platforms.

**Components**:
1. **Frontend** (Cloudflare Pages): Serves static React app from global CDN
2. **Backend API** (Koyeb free tier): Python/Litestar service with OAuth and API endpoints
3. **GPU Worker** (Modal): Serverless GPU functions with pay-per-second billing, R2 mount
4. **Storage** (Cloudflare R2): S3-compatible object storage for audio files

**Build** (automated via git push):
- **Cloudflare Pages**: `cd frontend && bun install && bun run build` → serves `dist/`
- **Koyeb API**: Buildpack auto-detects Python, runs `uv sync`, starts uvicorn (target: `api`)
- **Modal GPU Worker**: `modal deploy src/processor/worker.py` → creates HTTPS endpoint

**Storage Abstraction** (`storage.py`):
- Protocol-based interface supports both local filesystem and R2
- `LocalStorage`: Serves files from `media/` directory (development)
- `R2Storage`: Generates presigned URLs or public URLs for R2 (production/remote processing)
- Always uses R2 if `config.yaml` has `r2` section configured
- **Input storage**: `inputs/<profile>/<filename>` for source files
- **Output storage**: `<profile>/<output_name>/` for processed stems
- **Sync behavior** (`STEMSET_SYNC` environment variable):
  - Default: `true` - CLI syncs local `media/` with R2 before/after processing
  - Set to `false` to disable bidirectional sync (production API servers)

**API Routes**:
- `/api/profiles` → List all profiles
- `/api/profiles/{name}/files` → List files with R2 URLs for stems
- `/api/profiles/{name}/files/{file}/metadata` → Redirect to R2 metadata.json
- `/api/profiles/{name}/songs/{song}/stems/{stem}/waveform` → Redirect to R2 waveform PNG
- `/api/upload` → Upload file and trigger remote GPU processing (returns job_id for polling)
- `/api/jobs/{job_id}/status` → Poll job status
- `/api/jobs/{job_id}/complete` → Callback from GPU worker
- `/auth/*` → OAuth endpoints

**Processing Workflows**:

**Local Processing (default)**:
1. Run `uv run stemset process <profile>` locally
2. Outputs saved to local `media/<profile>/`
3. Upload to R2: `python scripts/upload_to_r2.py <profile>`

**Remote GPU Processing** (Modal):
1. Set `remote: true` in profile config
2. Run `uv run stemset process <profile>`
3. CLI uploads input to R2 (`inputs/<profile>/`)
4. CLI triggers Modal worker via HTTP
5. Modal worker processes with GPU (pay-per-second, <1s cold start)
6. Modal uploads stems to R2
7. CLI downloads results to local `media/<profile>/`

**Web Upload Processing** (Modal):
1. Frontend uploads file to backend
2. Backend uploads to R2 (`inputs/<profile>/`)
3. Backend triggers Modal worker
4. Modal processes and uploads stems
5. Modal calls back to API
6. Frontend polls for completion
7. Frontend streams stems from R2

**Local Development with R2 Configured**:
- Keep `r2` section uncommented in `config.yaml` (needed for remote processing)
- Set `STEMSET_SYNC=true` in `.env` (default) to sync local media with R2
- Can test remote processing: set `remote: true` in profile config
- Sync happens automatically before/after CLI processing

**Modal Worker Deployment**:
- Deploy with: `modal deploy src/processor/worker.py`
- Creates serverless HTTPS endpoint automatically
- Mounts R2 bucket via CloudBucketMount (no egress fees)
- Pay-per-second billing with no idle charges
- See `docs/modal-deployment.md` for full deployment guide

**Alternative: Single-Server (Render.com)**:
See `render.yaml` for traditional deployment where backend serves both API and static files.
Note: Render free tier doesn't support persistent disks; requires paid plan (~$7/month).