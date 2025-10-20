# Stemset Development Guide

## What This Is

Stemset is an AI-powered audio stem separation application with two components:
1. **Backend**: Python service that monitors directories, separates audio into stems using ML models, and serves results via REST API
2. **Frontend**: Minimal web player for bandmates to practice with independent stem volume controls

## Core Principles

### Fail Fast
We do not catch exceptions to provide fallbacks. If something fails, we want to know immediately. No `try/except` blocks unless absolutely necessary for resource cleanup.

### Modern Python
- Use Python 3.13+ features: `from __future__ import annotations`, type unions with `|`, no `Optional`
- Type everything. No `Any` unless interfacing with untyped third-party code.
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
- `OutputConfig` - Format and bitrate settings
- `StrategyNode` - Recursive tree node (model + output mappings)
- `Strategy` - Named strategy with validation
- `Profile` - User profile linking source folder to strategy
- `Config` - Top-level config with strategies and profiles

We load and validate the entire config at startup. Invalid configs fail immediately with clear error messages.

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
├── config.py              # Pydantic config models, YAML loading
├── api.py                 # Litestar API with Pydantic responses
├── queue.py               # Job queue management
├── scanner.py             # Directory scanning, content-based deduplication
├── modern_separator.py    # Public separation interface
└── models/
    ├── registry.py        # Frozen MODEL_REGISTRY mapping names to classes
    ├── audio_separator_base.py  # AudioSeparator ABC
    ├── atomic_models.py   # Concrete model implementations
    ├── strategy_executor.py     # Tree execution engine
    └── metadata.py        # Pydantic metadata models + LUFS analysis
```

## What We Don't Do

- **No backwards compatibility layers**: We delete old code when we refactor. No `separator.py` alongside `modern_separator.py`.
- **No validation in multiple places**: Validate once at the boundary (config load, API input). Trust validated data downstream.
- **No YAML/JSON by hand**: Use Pydantic's `model_dump_json()` and `model_validate_json()`.
- **No print debugging**: Use proper logging levels when needed. Print statements for user-facing progress only.
- **No magic**: Explicit is better than implicit. No metaclasses, no dynamic imports, no `__getattr__` tricks.

## Dependencies We Use

- **`audio-separator`**: Core ML separation, handles model loading and PyTorch
- **`pyloudnorm`**: LUFS measurement per ITU-R BS.1770-4
- **`soundfile`**: Audio I/O, supports Opus via system libsndfile
- **`Litestar`**: Modern async web framework with excellent Pydantic integration
- **`pydantic`**: Data validation, serialization, configuration
- **`watchdog`**: File system monitoring (for future auto-scanning)

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
