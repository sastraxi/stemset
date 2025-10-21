# Stemset Development Guide

## What This Is

Stemset is an AI-powered audio stem separation application with Google OAuth authentication:
1. **Backend**: Python/Litestar service that serves stems via authenticated REST API and hosts the frontend
2. **Frontend**: React/TypeScript web player with Google OAuth for secure access and independent stem volume controls
3. **Processing**: CLI-based audio separation (`uv run stemset process <profile> [file]`) runs locally; processed stems are stored in `media/` and served by the backend

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
- `OutputConfig` - Format and bitrate settings
- `StrategyNode` - Recursive tree node (model + output mappings)
- `Strategy` - Named strategy with validation
- `Profile` - User profile linking source folder to strategy
- `Config` - Top-level config with strategies, profiles, and optional auth

**Environment Variable Substitution**: Config supports `${VAR_NAME}` syntax for secrets:
```yaml
auth:
  google_client_id: ${GOOGLE_CLIENT_ID}
  jwt_secret: ${JWT_SECRET}
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

## File Organization

```
src/
├── auth.py                # Google OAuth, JWT tokens, auth middleware
├── config.py              # Pydantic config models, YAML loading, env var substitution
├── modern_separator.py    # Public separation interface
├── cli/                   # CLI module
│   ├── __init__.py        # Main CLI entrypoint (Typer app)
│   ├── scanner.py         # File scanning and hash tracking
│   └── processor.py       # Audio processing logic
├── api/                   # API module
│   ├── app.py             # Litestar app configuration
│   ├── models.py          # Pydantic response models
│   ├── auth_routes.py     # OAuth endpoints
│   └── profile_routes.py  # Profile and file endpoints
└── models/
    ├── registry.py        # Frozen MODEL_REGISTRY mapping names to classes
    ├── audio_separator_base.py  # AudioSeparator ABC
    ├── atomic_models.py   # Concrete model implementations
    ├── strategy_executor.py     # Tree execution engine
    └── metadata.py        # Pydantic metadata models + LUFS analysis

frontend/
└── src/
    ├── contexts/
    │   └── AuthContext.tsx  # React context for OAuth state management
    ├── components/
    │   ├── LoginPage.tsx    # Google OAuth login UI
    │   └── StemPlayer.tsx   # Web Audio API player
    └── api.ts              # Fetch wrappers with credentials: 'include'
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

**Production (single origin on Render)**:
1. User clicks "Sign in with Google" → Redirects to `/auth/login`
2. Backend redirects to Google with `redirect_uri=https://app.onrender.com/auth/callback`
3. Google redirects back to backend `/auth/callback`
4. Backend validates, creates JWT, sets httpOnly cookie with secure flag
5. Backend redirects to `FRONTEND_URL` (`/` - same origin)
6. All requests include cookie automatically (same origin)

### Key Implementation Details

**Cookie Settings**:
- Development: `domain="localhost"`, `secure=False` (allows cross-port on localhost)
- Production: `domain=None`, `secure=True` (httpOnly cookie on same origin)

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
OAUTH_REDIRECT_URI=http://localhost:8000/auth/callback
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
```

**Production (Render)**:
```bash
STEMSET_BYPASS_AUTH=false
OAUTH_REDIRECT_URI=https://your-app.onrender.com/auth/callback
FRONTEND_URL=/
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
```

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

### Deployment (Render.com)

**Architecture**: Single Python web service serves both API and frontend.

**Build** (in `render.yaml`):
1. Install Python dependencies with `uv`
2. Build frontend with `bun run build` → `frontend/dist/`
3. Start: `uvicorn src.api:app`

**Static Files**:
- `/api/*` → API routes
- `/auth/*` → OAuth routes
- `/media/*` → Audio files from persistent disk
- `/*` → React app from `frontend/dist/` (catch-all for client-side routing)

**Persistent Disk**:
- Mounted at `/data`
- Stores processed audio files (`/data/media`)
- Stores ML model cache (`/data/models`)

**Processing Workflow**:
1. Run `uv run stemset process <profile>` locally to process audio files
2. Outputs are saved to local `media/<profile>/` directory
3. Use rsync or similar to sync `media/` to `/data/media` on Render
4. Backend automatically serves new files via `/media/*` static file route
5. Frontend refresh button reloads file list from `/api/profiles/{name}/files`